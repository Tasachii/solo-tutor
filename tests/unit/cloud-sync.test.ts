import { beforeEach, describe, expect, it } from 'vitest'
import { buildScenario } from '../../src/core/scenarios'
import { deriveKey } from '../../src/core/cloudCrypto'
import { clearAccountLocalArtifacts, decideSync, hasLedgerData, ledgerFingerprint, packSnapshot, PRE_PULL_BACKUP_KEY, readSyncMeta, unpackSnapshot, writePrePullBackup, writeSyncMeta, SYNC_META_KEY, type SyncMeta } from '../../src/core/cloudSync'
import { reducer } from '../../src/core/store'
import { SCHEMA } from '../../src/core/store'

const uid = 'teacher-1'
const meta = (cloudRevision: number, localFingerprint: string, providerId = uid): SyncMeta =>
  ({ providerId, cloudRevision, localFingerprint, at: '2025-09-02T02:00:00.000Z' })

describe('decideSync', () => {
  it('ไม่มีอะไรบนคลาวด์ → push เสมอ', () => {
    expect(decideSync({ fingerprint: 'f5', hasData: true }, null, null, uid)).toBe('push')
    expect(decideSync({ fingerprint: 'f5', hasData: false }, meta(3, 'f5'), null, uid)).toBe('push')
  })
  it('เครื่องที่ไม่เคยซิงก์: เครื่องเปล่าดึงลงมา เครื่องมีข้อมูลต้องถาม', () => {
    expect(decideSync({ fingerprint: 'f1', hasData: false }, null, { revision: 4 }, uid)).toBe('pull')
    expect(decideSync({ fingerprint: 'f9', hasData: true }, null, { revision: 4 }, uid)).toBe('conflict')
  })
  it('meta ของอีกบัญชีไม่นับ — เหมือนไม่เคยซิงก์', () => {
    expect(decideSync({ fingerprint: 'f9', hasData: true }, meta(4, 'f9', 'someone-else'), { revision: 4 }, uid)).toBe('conflict')
  })
  it('เคยซิงก์แล้ว: เปลี่ยนฝั่งเดียวตามฝั่งนั้น ทั้งสองฝั่งต้องถาม ไม่เปลี่ยนก็นิ่ง', () => {
    expect(decideSync({ fingerprint: 'f10', hasData: true }, meta(4, 'f9'), { revision: 4 }, uid)).toBe('push')
    expect(decideSync({ fingerprint: 'f9', hasData: true }, meta(4, 'f9'), { revision: 5 }, uid)).toBe('pull')
    expect(decideSync({ fingerprint: 'f10', hasData: true }, meta(4, 'f9'), { revision: 5 }, uid)).toBe('conflict')
    expect(decideSync({ fingerprint: 'f9', hasData: true }, meta(4, 'f9'), { revision: 4 }, uid)).toBe('idle')
  })
})

describe('ledgerFingerprint', () => {
  const real = { ...buildScenario('default'), mode: 'real' as const }
  it('เปิดแอป (track) หรือวันเปลี่ยน ไม่ถือว่าสมุดบัญชีเปลี่ยน — เช็คชื่อถือว่าเปลี่ยน', () => {
    // reducer normalize ก่อนทุกครั้ง (เติมร่าง/สถานะค้าง) — เทียบจาก state ที่ผ่าน reducer แล้วเหมือนกัน
    const settled = reducer(real, { type: 'track', name: 'storage_ready' })
    const base = ledgerFingerprint(settled)
    const opened = reducer(settled, { type: 'track', name: 'app_open' })
    expect(opened.events.length).toBeGreaterThan(settled.events.length)
    expect(ledgerFingerprint({ ...opened, revision: settled.revision + 7, today: '2025-09-03' })).toBe(base)
    const unit = settled.units.find((u) => u.scheduledAt === settled.today && !settled.completions.some((c) => c.unitId === u.id))!
    expect(ledgerFingerprint(reducer(settled, { type: 'complete', unitId: unit.id }))).not.toBe(base)
    expect(ledgerFingerprint({ ...settled, provider: { ...settled.provider, name: 'ครูใหม่' } })).not.toBe(base)
  })
})

describe('snapshot pack/unpack', () => {
  const real = { ...buildScenario('default'), mode: 'real' as const }
  it('ห่อ เข้ารหัส ถอด แล้วได้ state ที่ validate ผ่าน', async () => {
    const key = await deriveKey('pw-123456', uid)
    const sealed = await packSnapshot(real, key, '2025-09-02T02:00:00.000Z')
    expect(sealed.cipher).not.toContain('น้องภูมิ')
    const r = await unpackSnapshot(sealed, key, SCHEMA)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.state.subjects.map((s) => s.name)).toEqual(real.subjects.map((s) => s.name))
  })
  it('กุญแจผิด → locked · ถอดได้แต่ข้างในไม่ใช่ไฟล์สำรอง → wrongFile', async () => {
    const key = await deriveKey('pw-123456', uid)
    const sealed = await packSnapshot(real, key, '2025-09-02T02:00:00.000Z')
    expect(await unpackSnapshot(sealed, await deriveKey('pw-000000', uid), SCHEMA)).toEqual({ ok: false, reason: 'locked' })
    const { seal } = await import('../../src/core/cloudCrypto')
    const junk = await seal(key, JSON.stringify({ format: 'solo-backup-1', exportedAt: 'x', app: { schemaVersion: SCHEMA, subjects: 'nope' } }))
    const r = await unpackSnapshot(junk, key, SCHEMA)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('wrongFile')
  })
  it('ยอม snapshot เก่าที่ไม่มี kdf แต่ปฏิเสธอัลกอริทึมที่ไม่รองรับก่อนถอด', async () => {
    const key = await deriveKey('pw-123456', uid)
    const sealed = await packSnapshot(real, key, '2025-09-02T02:00:00.000Z')
    expect((await unpackSnapshot(sealed, key, SCHEMA)).ok).toBe(true)
    expect(await unpackSnapshot({ ...sealed, kdf: 'future-kdf' }, key, SCHEMA))
      .toEqual({ ok: false, reason: 'unsupportedKdf' })
  })
  it('hasLedgerData: เดโมมีข้อมูล เครื่องเปล่าไม่มี', () => {
    expect(hasLedgerData(real)).toBe(true)
    expect(hasLedgerData({ ...real, subjects: [], completions: [], invoices: [] })).toBe(false)
  })
})

describe('sync meta', () => {
  beforeEach(() => { localStorage.removeItem(SYNC_META_KEY); localStorage.removeItem(PRE_PULL_BACKUP_KEY) })
  it('เขียนแล้วอ่านกลับ · ค่าขยะอ่านเป็น null', () => {
    writeSyncMeta(meta(2, 'f7'))
    expect(readSyncMeta()).toEqual(meta(2, 'f7'))
    localStorage.setItem(SYNC_META_KEY, '{"providerId":1}')
    expect(readSyncMeta()).toBeNull()
    writeSyncMeta(null)
    expect(localStorage.getItem(SYNC_META_KEY)).toBeNull()
  })
  it('เก็บไฟล์สำรอง local แยกไว้ก่อน pull', () => {
    const real = { ...buildScenario('empty'), mode: 'real' as const }
    expect(writePrePullBackup(real, '2025-09-02T02:00:00.000Z')).toBe(true)
    const saved = JSON.parse(localStorage.getItem(PRE_PULL_BACKUP_KEY)!)
    expect(saved).toMatchObject({ format: 'solo-backup-1', app: { mode: 'real' } })
  })
  it('ลบบัญชีแล้วล้างเฉพาะ artifact ที่ผูกบัญชี ไม่ล้างค่าหน้าตาหรือข้อมูลเว็บอื่น', () => {
    for (const key of [PRE_PULL_BACKUP_KEY, 'solo-demo-v3-before-restore', 'solo-sheets', 'solo-usage-id', 'unrelated']) {
      localStorage.setItem(key, 'value')
    }
    sessionStorage.setItem('solo-tutor:requested-plan', '3')
    clearAccountLocalArtifacts()
    expect(localStorage.getItem(PRE_PULL_BACKUP_KEY)).toBeNull()
    expect(localStorage.getItem('solo-demo-v3-before-restore')).toBeNull()
    expect(localStorage.getItem('solo-sheets')).toBeNull()
    expect(localStorage.getItem('solo-usage-id')).toBeNull()
    expect(sessionStorage.getItem('solo-tutor:requested-plan')).toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('value')
  })
})
