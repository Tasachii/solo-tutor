import { beforeEach, describe, expect, it } from 'vitest'
import { buildScenario } from '../../src/core/scenarios'
import { deriveKey } from '../../src/core/cloudCrypto'
import { decideSync, hasLedgerData, packSnapshot, readSyncMeta, unpackSnapshot, writeSyncMeta, SYNC_META_KEY, type SyncMeta } from '../../src/core/cloudSync'
import { SCHEMA } from '../../src/core/store'

const uid = 'teacher-1'
const meta = (cloudRevision: number, localRevision: number, providerId = uid): SyncMeta =>
  ({ providerId, cloudRevision, localRevision, at: '2025-09-02T02:00:00.000Z' })

describe('decideSync', () => {
  it('ไม่มีอะไรบนคลาวด์ → push เสมอ', () => {
    expect(decideSync({ revision: 5, hasData: true }, null, null, uid)).toBe('push')
    expect(decideSync({ revision: 5, hasData: false }, meta(3, 5), null, uid)).toBe('push')
  })
  it('เครื่องที่ไม่เคยซิงก์: เครื่องเปล่าดึงลงมา เครื่องมีข้อมูลต้องถาม', () => {
    expect(decideSync({ revision: 1, hasData: false }, null, { revision: 4 }, uid)).toBe('pull')
    expect(decideSync({ revision: 9, hasData: true }, null, { revision: 4 }, uid)).toBe('conflict')
  })
  it('meta ของอีกบัญชีไม่นับ — เหมือนไม่เคยซิงก์', () => {
    expect(decideSync({ revision: 9, hasData: true }, meta(4, 9, 'someone-else'), { revision: 4 }, uid)).toBe('conflict')
  })
  it('เคยซิงก์แล้ว: เปลี่ยนฝั่งเดียวตามฝั่งนั้น ทั้งสองฝั่งต้องถาม ไม่เปลี่ยนก็นิ่ง', () => {
    expect(decideSync({ revision: 10, hasData: true }, meta(4, 9), { revision: 4 }, uid)).toBe('push')
    expect(decideSync({ revision: 9, hasData: true }, meta(4, 9), { revision: 5 }, uid)).toBe('pull')
    expect(decideSync({ revision: 10, hasData: true }, meta(4, 9), { revision: 5 }, uid)).toBe('conflict')
    expect(decideSync({ revision: 9, hasData: true }, meta(4, 9), { revision: 4 }, uid)).toBe('idle')
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
  it('hasLedgerData: เดโมมีข้อมูล เครื่องเปล่าไม่มี', () => {
    expect(hasLedgerData(real)).toBe(true)
    expect(hasLedgerData({ ...real, subjects: [], completions: [], invoices: [] })).toBe(false)
  })
})

describe('sync meta', () => {
  beforeEach(() => localStorage.removeItem(SYNC_META_KEY))
  it('เขียนแล้วอ่านกลับ · ค่าขยะอ่านเป็น null', () => {
    writeSyncMeta(meta(2, 7))
    expect(readSyncMeta()).toEqual(meta(2, 7))
    localStorage.setItem(SYNC_META_KEY, '{"providerId":1}')
    expect(readSyncMeta()).toBeNull()
    writeSyncMeta(null)
    expect(localStorage.getItem(SYNC_META_KEY)).toBeNull()
  })
})
