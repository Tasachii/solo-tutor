import { describe, expect, it } from 'vitest'
import { reducer, SCHEMA } from '../../src/core/store'
import { buildReal, buildScenario } from '../../src/core/scenarios'
import { fromBackup, toBackup } from '../../src/core/backup'
import { deriveKey } from '../../src/core/cloudCrypto'
import { ledgerFingerprint, packSnapshot, unpackSnapshot } from '../../src/core/cloudSync'
import { validateState } from '../../src/core/validation'
import {
  applyTombstones, clientTombstonesOf, erasableClientKeys, keptForRecords, mergeTombstones,
  pruneTombstones, TOMBSTONE_MAX, TOMBSTONE_TTL_DAYS, tombstonesOf, type SubjectTombstone,
} from '../../src/core/tombstones'
import type { AppState, Subject } from '../../src/core/types'

const TODAY = '2026-09-01'

/** ครูคนหนึ่ง นักเรียนสองคน ยังไม่มีบิลและยังไม่มีงานที่ทำแล้ว = ลบได้จริง ไม่ใช่แค่ปิดรายการ */
function twoStudents(): AppState {
  let s: AppState = { ...buildReal({ name: 'ครูเอ', promptpayId: '0812345678' }), today: TODAY, onboarded: true }
  const add = (id: string, name: string, clientId: string, clientName: string, rate: number) => {
    const subject: Subject = { id, name, clientId, billing: { mode: 'per_unit', rate }, active: true, createdAt: TODAY }
    s = reducer(s, { type: 'upsertSubject', subject, clientName })
  }
  add('sub-mint', 'น้องมิ้นท์', 'cli-mint', 'แม่มิ้นท์', 500)
  add('sub-bow', 'น้องโบว์', 'cli-bow', 'แม่โบว์', 400)
  return s
}

/** เพิ่มงานที่ทำแล้วหนึ่งคาบ — คนนี้จะมีประวัติการเงินทันที การกดลบจึงกลายเป็น "ปิดรายการ" */
function withCompletedSession(s: AppState, subjectId: string): AppState {
  const withUnit = reducer(s, { type: 'addUnit', subjectId, time: '10:00', date: TODAY })
  const unit = withUnit.units.find((u) => u.subjectId === subjectId)!
  return reducer(withUnit, { type: 'complete', unitId: unit.id })
}

const has = (s: AppState, id: string): boolean => s.subjects.some((x) => x.id === id)
const roundTrip = (s: AppState): AppState => {
  const result = fromBackup(toBackup(s, '2026-09-01T00:00:00Z'), SCHEMA)
  if (!result.ok) throw new Error(`backup rejected: ${result.reason}`)
  return result.state
}

describe('การลบนักเรียนต้องอยู่ทน', () => {
  it('กดลบแล้วสมุดบัญชีจดไว้ว่าลบ ไม่ใช่แค่ทำให้แถวหายไปเฉย ๆ', () => {
    const after = reducer(twoStudents(), { type: 'deleteSubject', subjectId: 'sub-mint' })
    expect(has(after, 'sub-mint')).toBe(false)
    expect(tombstonesOf(after)).toEqual([{ id: 'sub-mint', at: TODAY, mode: 'removed' }])
    // คนที่ไม่ได้ถูกลบต้องไม่มีใบ
    expect(tombstonesOf(after).some((row) => row.id === 'sub-bow')).toBe(false)
  })

  it('กู้ไฟล์สำรองที่ถ่ายก่อนลบ คนที่ถูกลบต้องไม่กลับมา แต่ของอื่นในไฟล์ต้องกลับมาครบ', () => {
    const before = twoStudents()
    const backup = toBackup(before, '2026-09-01T00:00:00Z')
    const afterDelete = reducer(before, { type: 'deleteSubject', subjectId: 'sub-mint' })

    const file = fromBackup(backup, SCHEMA)
    expect(file.ok).toBe(true)
    if (!file.ok) return
    const restored = reducer(afterDelete, { type: 'restore', state: file.state })

    expect(has(restored, 'sub-mint')).toBe(false)
    expect(restored.clients.some((c) => c.id === 'cli-mint')).toBe(false)
    // ทุกอย่างที่เหลือในไฟล์ต้องอยู่ครบ ไม่ใช่กู้คืนแบบครึ่ง ๆ กลาง ๆ
    expect(has(restored, 'sub-bow')).toBe(true)
    expect(restored.clients.some((c) => c.id === 'cli-bow')).toBe(true)
    expect(restored.provider.name).toBe('ครูเอ')
    expect(restored.onboarded).toBe(true)
    expect(validateState(restored).ok).toBe(true)
  })

  it('อีกเครื่องที่ยังมีคนนี้ push ทีหลัง ต้องไม่พาคนกลับมา และงานใหม่ของเครื่องนั้นต้องไม่หาย', () => {
    const shared = twoStudents()
    const deviceA = reducer(shared, { type: 'deleteSubject', subjectId: 'sub-mint' })
    // เครื่อง B ไม่รู้เรื่องการลบ และทำงานจริงต่อกับอีกคนหนึ่ง
    const deviceB = reducer(shared, { type: 'addUnit', subjectId: 'sub-bow', time: '17:00', date: '2026-09-03' })
    const newUnit = deviceB.units.find((u) => u.subjectId === 'sub-bow')!

    const merged = reducer(deviceA, { type: 'restore', state: deviceB })

    expect(has(merged, 'sub-mint')).toBe(false)
    expect(merged.units.some((u) => u.id === newUnit.id)).toBe(true)
    expect(has(merged, 'sub-bow')).toBe(true)
  })

  it('ลบที่เครื่อง A แล้วเครื่อง B ดึงข้อมูลลงมา ต้องหายทั้งสองเครื่อง', () => {
    const shared = twoStudents()
    const deviceA = reducer(shared, { type: 'deleteSubject', subjectId: 'sub-mint' })
    // B ได้ก้อนของ A มาทั้งก้อน (ผ่านรูปแบบไฟล์เดียวกับที่ใช้ซิงก์)
    const deviceB = reducer(shared, { type: 'restore', state: roundTrip(deviceA) })

    expect(has(deviceB, 'sub-mint')).toBe(false)
    expect(has(deviceA, 'sub-mint')).toBe(false)
    // B ถือใบเดียวกันต่อ — เครื่องที่สามที่ยังมีคนนี้อยู่ก็ลบตามได้
    expect(tombstonesOf(deviceB)).toEqual([{ id: 'sub-mint', at: TODAY, mode: 'removed' }])
  })

  it('เครื่องที่ออฟไลน์ตอนลบ พอได้ซิงก์ครั้งแรกก็ยังบังคับใช้การลบ และส่งการลบขึ้นคลาวด์ต่อ', () => {
    const shared = twoStudents()
    // A ลบตอนไม่มีเน็ต · คลาวด์ยังเป็นก้อนเก่าที่มีนักเรียนคนนี้อยู่
    const offlineA = reducer(shared, { type: 'deleteSubject', subjectId: 'sub-mint' })
    const cloud = reducer(shared, { type: 'addUnit', subjectId: 'sub-bow', time: '18:00', date: '2026-09-04' })

    const afterPull = reducer(offlineA, { type: 'restore', state: cloud })

    expect(has(afterPull, 'sub-mint')).toBe(false)
    expect(tombstonesOf(afterPull)).toHaveLength(1)
    // ก้อนที่ merge แล้วต่างจากก้อนบนคลาวด์ → รอบซิงก์ถัดไปเป็น push ไม่ใช่ idle การลบจึงเดินทางต่อ
    expect(ledgerFingerprint(afterPull)).not.toBe(ledgerFingerprint(cloud))
  })

  it('หลุมศพเดินทางไปกับไฟล์สำรองและก้อนที่เข้ารหัสบนคลาวด์', async () => {
    const deleted = reducer(twoStudents(), { type: 'deleteSubject', subjectId: 'sub-mint' })
    expect(tombstonesOf(roundTrip(deleted))).toEqual(tombstonesOf(deleted))

    const key = await deriveKey('pw-123456', 'teacher-1')
    const sealed = await packSnapshot(deleted, key, '2026-09-01T00:00:00Z')
    const opened = await unpackSnapshot(sealed, key, SCHEMA)
    expect(opened.ok).toBe(true)
    if (opened.ok) expect(tombstonesOf(opened.state)).toEqual(tombstonesOf(deleted))
  })

  it('ลบแล้วทุกอย่างที่ห้อยอยู่กับคนนั้นต้องไม่ตามกลับมาด้วย', () => {
    let before = twoStudents()
    before = reducer(before, { type: 'addUnit', subjectId: 'sub-mint', time: '09:00', date: '2026-09-02' })
    before = reducer(before, { type: 'addHomework', subjectIds: ['sub-mint'], text: 'ทำโจทย์บทที่ 3', dueAt: '2026-09-05' })
    before = reducer(before, { type: 'chat', clientId: 'cli-mint', from: 'client', text: 'สวัสดีค่ะ' })
    expect(before.homework?.some((h) => h.subjectId === 'sub-mint')).toBe(true)

    const afterDelete = reducer(before, { type: 'deleteSubject', subjectId: 'sub-mint' })
    const restored = reducer(afterDelete, { type: 'restore', state: before })

    expect(has(restored, 'sub-mint')).toBe(false)
    expect(restored.units.some((u) => u.subjectId === 'sub-mint')).toBe(false)
    expect(restored.homework?.some((h) => h.subjectId === 'sub-mint')).toBeFalsy()
    expect(restored.messages.some((m) => m.subjectId === 'sub-mint' || m.clientId === 'cli-mint')).toBe(false)
    expect(restored.chats.some((c) => c.clientId === 'cli-mint')).toBe(false)
    expect(validateState(restored).ok).toBe(true)
  })
})

describe('หลุมศพต้องไม่ลบเงินของครู', () => {
  it('คนที่มีประวัติการเงินถูกปิดรายการ ไม่ใช่ลบ และใบยังบอกว่าเป็นการปิด', () => {
    const before = withCompletedSession(twoStudents(), 'sub-mint')
    const after = reducer(before, { type: 'deleteSubject', subjectId: 'sub-mint' })

    expect(after.subjects.find((x) => x.id === 'sub-mint')?.active).toBe(false)
    expect(tombstonesOf(after)).toEqual([{ id: 'sub-mint', at: TODAY, mode: 'archived' }])
  })

  it('คนที่ถูกปิดรายการต้องไม่ถูกสำเนาเก่าเปิดกลับมาสอนต่อ', () => {
    const before = withCompletedSession(twoStudents(), 'sub-mint')
    const archived = reducer(before, { type: 'deleteSubject', subjectId: 'sub-mint' })

    const restored = reducer(archived, { type: 'restore', state: before })

    expect(restored.subjects.find((x) => x.id === 'sub-mint')?.active).toBe(false)
    expect(restored.subjects.find((x) => x.id === 'sub-mint')?.inactiveAt).toBe(TODAY)
  })

  it('ใบที่บอกให้ "ลบ" เมื่อไปเจอสำเนาที่มีบิลแล้ว ต้องกลายเป็นปิดรายการ ไม่ลบเงินทิ้ง', () => {
    // A ลบตอนยังไม่มีบิล (ลบได้จริง) · B ออกบิลและรับเงินไปแล้วก่อนหน้านั้น
    const shared = twoStudents()
    const deviceA = reducer(shared, { type: 'deleteSubject', subjectId: 'sub-mint' })
    let deviceB = withCompletedSession(shared, 'sub-mint')
    deviceB = reducer(deviceB, { type: 'closeMonth', period: '2026-09' })
    const invoice = deviceB.invoices.find((i) => i.subjectId === 'sub-mint')!
    deviceB = reducer(deviceB, { type: 'recordPayment', invoiceId: invoice.id, amount: invoice.total, slipVerified: true })
    const receipts = deviceB.receipts.length
    expect(receipts).toBeGreaterThan(0)

    const merged = reducer(deviceA, { type: 'restore', state: deviceB })

    expect(merged.subjects.find((x) => x.id === 'sub-mint')?.active).toBe(false)
    expect(merged.invoices.some((i) => i.id === invoice.id)).toBe(true)
    expect(merged.payments.filter((p) => p.invoiceId === invoice.id)).toHaveLength(1)
    expect(merged.receipts).toHaveLength(receipts)
    expect(validateState(merged).ok).toBe(true)
  })

  it('การบังคับใช้หลุมศพไม่มีทางลบบิล การชำระ หรือใบเสร็จ แม้ใบจะสั่งให้ลบ', () => {
    let ledger = withCompletedSession(twoStudents(), 'sub-mint')
    ledger = reducer(ledger, { type: 'closeMonth', period: '2026-09' })
    const invoice = ledger.invoices.find((i) => i.subjectId === 'sub-mint')!
    ledger = reducer(ledger, { type: 'recordPayment', invoiceId: invoice.id, amount: invoice.total, slipVerified: true })

    const applied = applyTombstones(ledger, [{ id: 'sub-mint', at: TODAY, mode: 'removed' }])

    expect(applied.invoices).toEqual(ledger.invoices)
    expect(applied.payments).toEqual(ledger.payments)
    expect(applied.receipts).toEqual(ledger.receipts)
  })
})

describe('สิ่งที่ต้องไม่พังไปด้วย', () => {
  it('"หยุดเรียน" ไม่ใช่การลบ — ไม่มีใบ และสำเนาเก่ายังพากลับมาเรียนต่อได้ตามเดิม', () => {
    const before = twoStudents()
    const stopped = reducer(before, { type: 'deactivateSubject', subjectId: 'sub-mint' })
    expect(stopped.subjects.find((x) => x.id === 'sub-mint')?.active).toBe(false)
    expect(stopped.deletedSubjects).toBeUndefined()

    const restored = reducer(stopped, { type: 'restore', state: before })
    expect(restored.subjects.find((x) => x.id === 'sub-mint')?.active).toBe(true)
  })

  it('เปิดเรียนใหม่ให้คนที่เคยกดลบ ต้องรื้อใบนั้นทิ้ง ไม่ให้ซิงก์รอบหน้าลบซ้ำ', () => {
    const archived = reducer(withCompletedSession(twoStudents(), 'sub-mint'), { type: 'deleteSubject', subjectId: 'sub-mint' })
    expect(tombstonesOf(archived)).toHaveLength(1)

    const back = reducer(archived, { type: 'reactivateSubject', subjectId: 'sub-mint' })

    expect(back.subjects.find((x) => x.id === 'sub-mint')?.active).toBe(true)
    expect(back.deletedSubjects).toBeUndefined()
    // สำเนาเก่าที่ยังจำการลบได้ ต้องไม่ลบคนที่ครูเพิ่งเปิดกลับมา
    expect(reducer(back, { type: 'restore', state: back }).subjects.find((x) => x.id === 'sub-mint')?.active).toBe(true)
  })

  it('เพิ่มคนชื่อเดิมเข้ามาใหม่ ต้องไม่ถูกใบเก่ากลืน', () => {
    const deleted = reducer(twoStudents(), { type: 'deleteSubject', subjectId: 'sub-mint' })
    const again: Subject = { id: 'sub-mint-2', name: 'น้องมิ้นท์', clientId: 'cli-mint-2',
      billing: { mode: 'per_unit', rate: 500 }, active: true, createdAt: TODAY }
    const readded = reducer(deleted, { type: 'upsertSubject', subject: again, clientName: 'แม่มิ้นท์' })

    expect(has(readded, 'sub-mint-2')).toBe(true)
    expect(has(reducer(readded, { type: 'restore', state: roundTrip(readded) }), 'sub-mint-2')).toBe(true)
    // ใบของคนเดิมยังอยู่ — คนละคนกัน ไม่ใช่การยกเลิกการลบ
    expect(tombstonesOf(readded)).toEqual([{ id: 'sub-mint', at: TODAY, mode: 'removed' }])
  })

  it('id ที่ชนกับใบเก่าโดยบังเอิญ ต้องรื้อใบทิ้ง ไม่ใช่บันทึกไม่ลงเงียบ ๆ', () => {
    const deleted = reducer(twoStudents(), { type: 'deleteSubject', subjectId: 'sub-mint' })
    const collide: Subject = { id: 'sub-mint', name: 'คนใหม่', clientId: 'cli-new',
      billing: { mode: 'per_unit', rate: 300 }, active: true, createdAt: TODAY }
    const readded = reducer(deleted, { type: 'upsertSubject', subject: collide, clientName: 'ผู้จ่ายใหม่' })

    expect(has(readded, 'sub-mint')).toBe(true)
    expect(readded.deletedSubjects).toBeUndefined()
    expect(validateState(readded).ok).toBe(true)
  })

  it('ไฟล์เดโมที่กู้ลงช่องเดโม ต้องไม่ลากหลุมศพของสมุดบัญชีจริงไปด้วย', () => {
    const deletedReal = reducer(twoStudents(), { type: 'deleteSubject', subjectId: 'sub-mint' })
    const demo = buildScenario('default')

    const crossed = reducer(deletedReal, { type: 'restore', state: demo })

    expect(crossed.mode).toBe('demo')
    expect(crossed.deletedSubjects).toBeUndefined()
    expect(crossed.messages.filter((m) => m.status === 'draft')).toHaveLength(3)
  })

  it('ก้อนที่ใบขัดกับรายชื่อ ต้องถูกปฏิเสธทั้งก้อน ข้อมูลเดิมยังอยู่ครบ', () => {
    const local = twoStudents()
    // ใบสั่งลบคนที่ยังเปิดสอนอยู่ = ข้อมูลขัดกันเอง ยอมไม่กู้คืนดีกว่าเดาว่าฝั่งไหนถูก
    const broken = { ...local, deletedSubjects: [{ id: 'sub-bow', at: TODAY, mode: 'removed' as const }] }
    expect(validateState(broken).ok).toBe(false)
    expect(reducer(local, { type: 'restore', state: broken })).toBe(local)
    expect(has(local, 'sub-bow')).toBe(true)
  })
})

describe('รูปร่างของหลุมศพ', () => {
  const row = (id: string, at: string, mode: SubjectTombstone['mode'] = 'removed'): SubjectTombstone => ({ id, at, mode })

  it('รวมสองรายการแล้วได้ผลเดียวกันเสมอไม่ว่าฝั่งไหนมาก่อน — ไม่งั้นสองเครื่องซิงก์วนไม่จบ', () => {
    const a = [row('s2', '2026-08-02'), row('s1', '2026-08-05')]
    const b = [row('s3', '2026-08-01'), row('s1', '2026-08-03')]
    expect(mergeTombstones(a, b)).toEqual(mergeTombstones(b, a))
    expect(mergeTombstones(a, b).map((x) => x.id)).toEqual(['s3', 's2', 's1'])
    // id ซ้ำ: เก็บวันแรกที่ครูกดลบ
    expect(mergeTombstones(a, b).find((x) => x.id === 's1')?.at).toBe('2026-08-03')
  })

  it('เจตนาที่แรงกว่าชนะ — เคยลบได้จริงที่ไหนสักที่ ก็ยังเป็นการลบ', () => {
    expect(mergeTombstones([row('s1', '2026-08-01', 'archived')], [row('s1', '2026-08-02', 'removed')])[0].mode).toBe('removed')
    expect(mergeTombstones([row('s1', '2026-08-01', 'archived')], [row('s1', '2026-08-02', 'archived')])[0].mode).toBe('archived')
  })

  it('ใบที่เก่าเกินอายุถูกตัด ใบที่ยังไม่ถึงอายุยังอยู่', () => {
    const fresh = row('keep', '2026-08-01')
    const stale = row('drop', '2025-01-01')
    expect(pruneTombstones([fresh, stale], '2026-09-01').map((x) => x.id)).toEqual(['keep'])
    expect(TOMBSTONE_TTL_DAYS).toBeGreaterThan(365)
  })

  it('เกินเพดานเก็บใบใหม่ไว้ก่อน — สำเนาที่จะย้อนกลับมามักเป็นของใหม่', () => {
    const many = Array.from({ length: TOMBSTONE_MAX + 10 }, (_, i) => row(`s${i}`, `2026-0${(i % 8) + 1}-01`))
    const kept = pruneTombstones(many, '2026-09-01')
    expect(kept).toHaveLength(TOMBSTONE_MAX)
    expect(kept.at(-1)?.at).toBe('2026-08-01')
  })

  it('คิวส่ง LINE ที่ค้างอยู่กับคนที่ถูกลบ ต้องถูกเก็บกวาด ไม่ใช่ทำให้ทั้งก้อนกู้ไม่ได้', () => {
    let ledger = twoStudents()
    ledger = reducer(ledger, { type: 'addHomework', subjectIds: ['sub-mint', 'sub-bow'], text: 'อ่านบทที่ 1', dueAt: '2026-09-05' })
    const mine = ledger.messages.find((m) => m.subjectId === 'sub-mint')!
    const other = ledger.messages.find((m) => m.subjectId === 'sub-bow')!
    const queued = { ...ledger, sending: { awaiting: other.id, queue: [mine.id] } }

    const applied = applyTombstones(queued, [{ id: 'sub-mint', at: TODAY, mode: 'removed' }])
    expect(applied.sending).toEqual({ awaiting: other.id, queue: [] })
    expect(validateState(applied).ok).toBe(true)

    // ใบที่รออยู่เองถูกลบ = ไม่มีอะไรให้รอต่อ ต้องล้างคิวทิ้ง ไม่ใช่ปล่อยให้ชี้ไปที่ว่าง
    const awaited = applyTombstones({ ...queued, sending: { awaiting: mine.id, queue: [] } },
      [{ id: 'sub-mint', at: TODAY, mode: 'removed' }])
    expect(awaited.sending).toBeUndefined()
    expect(validateState(awaited).ok).toBe(true)
  })

  it('ใบที่เลยอายุแล้วเลิกบังคับใช้ — สัญญาคือ 400 วัน ไม่ใช่ตลอดไป', () => {
    const deleted = reducer(twoStudents(), { type: 'deleteSubject', subjectId: 'sub-mint' })
    const muchLater = { ...deleted, today: '2028-01-01' }
    // ใบถูกตัดตอน merge รอบถัดไป การกู้ไฟล์เก่ามาก ๆ หลังจากนั้นจึงเป็นการตัดสินใจของครูเอง
    expect(pruneTombstones(tombstonesOf(muchLater), muchLater.today)).toHaveLength(0)
  })

  it('สมุดบัญชีที่ไม่เคยลบใคร ต้องไม่มีคีย์นี้และได้ลายนิ้วมือเดิมทุกตัว', () => {
    const clean = twoStudents()
    expect(clean.deletedSubjects).toBeUndefined()
    expect(JSON.stringify(clean).includes('deletedSubjects')).toBe(false)
    const deleted = reducer(clean, { type: 'deleteSubject', subjectId: 'sub-mint' })
    expect(ledgerFingerprint(deleted)).not.toBe(ledgerFingerprint({ ...deleted, deletedSubjects: undefined }))
  })
})

describe('ลบผู้จ่ายต้องไปถึงเซิร์ฟเวอร์ด้วย', () => {
  it('ผู้จ่ายที่ไม่เหลือนักเรียนแล้ว ได้ใบสั่งลบของตัวเอง', () => {
    const after = reducer(twoStudents(), { type: 'deleteSubject', subjectId: 'sub-mint' })
    expect(after.clients.some((c) => c.id === 'cli-mint')).toBe(false)
    expect(clientTombstonesOf(after)).toEqual([{ id: 'cli-mint', at: TODAY }])
    expect(erasableClientKeys(after)).toEqual(['cli-mint'])
  })

  it('ผู้จ่ายที่ยังมีลูกอีกคน ต้องไม่มีใบ และต้องไม่ถูกสั่งลบบนเซิร์ฟเวอร์', () => {
    let s = twoStudents()
    const sibling: Subject = { id: 'sub-mint-2', name: 'น้องมิว', clientId: 'cli-mint',
      billing: { mode: 'per_unit', rate: 500 }, active: true, createdAt: TODAY }
    s = reducer(s, { type: 'upsertSubject', subject: sibling, clientName: 'แม่มิ้นท์' })
    const after = reducer(s, { type: 'deleteSubject', subjectId: 'sub-mint' })

    expect(after.clients.some((c) => c.id === 'cli-mint')).toBe(true)
    expect(after.deletedClients).toBeUndefined()
    expect(erasableClientKeys(after)).toEqual([])
  })

  it('ผู้จ่ายที่หายไปเฉย ๆ โดยไม่มีใบ ต้องไม่ถูกสั่งลบ — "ไม่มีอยู่" ไม่เท่ากับ "ถูกลบ"', () => {
    const stale = twoStudents()
    // สมุดบัญชีรุ่นเก่าที่ยังไม่รู้จักผู้จ่ายคนใหม่ ต้องไม่ส่งคำสั่งลบใครทั้งสิ้น
    expect(erasableClientKeys(stale)).toEqual([])
    expect(erasableClientKeys({ ...stale, clients: [], subjects: [] })).toEqual([])
  })

  it('ใบของผู้จ่ายเดินทางไปกับไฟล์สำรอง และบังคับใช้กับสำเนาที่ยังมีเขาอยู่', () => {
    const before = twoStudents()
    const deleted = reducer(before, { type: 'deleteSubject', subjectId: 'sub-mint' })
    expect(clientTombstonesOf(roundTrip(deleted))).toEqual(clientTombstonesOf(deleted))

    const merged = reducer(deleted, { type: 'restore', state: before })
    expect(merged.clients.some((c) => c.id === 'cli-mint')).toBe(false)
    expect(erasableClientKeys(merged)).toEqual(['cli-mint'])
  })

  it('ถ้าอีกเครื่องเพิ่มน้องอีกคนให้ผู้จ่ายคนเดิม ใบต้องถูกรื้อ ไม่ใช่ลบลูกค้าที่ยังอยู่', () => {
    const before = twoStudents()
    const deleted = reducer(before, { type: 'deleteSubject', subjectId: 'sub-mint' })
    const sibling: Subject = { id: 'sub-mint-2', name: 'น้องมิว', clientId: 'cli-mint',
      billing: { mode: 'per_unit', rate: 500 }, active: true, createdAt: TODAY }
    const otherDevice = reducer(before, { type: 'upsertSubject', subject: sibling, clientName: 'แม่มิ้นท์' })

    const merged = reducer(deleted, { type: 'restore', state: otherDevice })

    expect(merged.clients.some((c) => c.id === 'cli-mint')).toBe(true)
    expect(merged.deletedClients).toBeUndefined()
    expect(erasableClientKeys(merged)).toEqual([])
    expect(validateState(merged).ok).toBe(true)
  })

  it('ใบที่ชี้ไปยังผู้จ่ายที่ยังอยู่ ต้องไม่ผ่านการตรวจ', () => {
    const local = twoStudents()
    const broken = { ...local, deletedClients: [{ id: 'cli-bow', at: TODAY }] }
    expect(validateState(broken).ok).toBe(false)
    expect(reducer(local, { type: 'restore', state: broken })).toBe(local)
  })

  it('เพิ่มผู้จ่ายที่มี id เดิมกลับเข้ามา ต้องรื้อใบทิ้ง', () => {
    const deleted = reducer(twoStudents(), { type: 'deleteSubject', subjectId: 'sub-mint' })
    const again: Subject = { id: 'sub-new', name: 'น้องใหม่', clientId: 'cli-mint',
      billing: { mode: 'per_unit', rate: 500 }, active: true, createdAt: TODAY }
    const readded = reducer(deleted, { type: 'upsertSubject', subject: again, clientName: 'แม่มิ้นท์' })

    expect(readded.deletedClients).toBeUndefined()
    expect(erasableClientKeys(readded)).toEqual([])
    expect(validateState(readded).ok).toBe(true)
  })
})

describe('บอกครูว่าแถวนี้ถูกเก็บไว้เพราะอะไร', () => {
  it('คนที่กดลบแล้วถูกเก็บไว้เพราะมีเอกสารการเงิน ต้องบอกได้ว่าเป็นแบบนั้น', () => {
    const archived = reducer(withCompletedSession(twoStudents(), 'sub-mint'), { type: 'deleteSubject', subjectId: 'sub-mint' })
    expect(keptForRecords(archived, 'sub-mint')).toBe(true)
  })

  it('คนที่ครูเลือก "หยุดเรียน" เอง ต้องไม่ถูกบอกว่าเก็บไว้เพราะบิล', () => {
    const stopped = reducer(twoStudents(), { type: 'deactivateSubject', subjectId: 'sub-mint' })
    expect(keptForRecords(stopped, 'sub-mint')).toBe(false)
    // คนที่ยังเรียนอยู่ก็ไม่ใช่
    expect(keptForRecords(stopped, 'sub-bow')).toBe(false)
  })
})
