import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildReal, buildScenario } from '../../src/core/scenarios'
import { deriveKey } from '../../src/core/cloudCrypto'
import { packSnapshot, PRE_PULL_BACKUP_KEY, readSyncMeta, SYNC_META_KEY, toBackupForTests, writeSyncMeta } from './helpers/cloud-sync-helpers'
import type { AppState } from '../../src/core/types'
import type { CloudSnapshot } from '../../src/core/cloudSync'

/**
 * เทสระดับ provider: guard ที่เคยมีแต่โค้ด ไม่มีเทส —
 * แก้ระหว่างรอเน็ต (A-06), สลับบัญชีกลางคัน (A-06), กุญแจกู้คืนกับบัญชีที่ยังไม่มี snapshot (A-01),
 * กู้สำเนาก่อนดึงคลาวด์ (A-03)
 */
type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void }
const deferred = <T,>(): Deferred<T> => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }

const mocks = vi.hoisted(() => ({
  state: null as unknown as AppState,
  writeStatus: 'writable' as 'writable' | 'readonly',
  session: { access_token: 'token', refresh_token: 'refresh', expires_at: 9_999_999_999, user: { id: 'teacher-1', email: 'a@example.test' } } as
    { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email: string } } | null,
  dispatch: vi.fn(() => true),
  readSnapshot: vi.fn(), saveSnapshot: vi.fn(), signOut: vi.fn(),
  loadKey: vi.fn(), rememberKey: vi.fn(), importRecoveryKey: vi.fn(),
  unpackGates: [] as Promise<void>[],
  unpackWaits: 0,
}))

vi.mock('../../src/core/store', () => ({
  SCHEMA: 5, ACCOUNT_DELETED_KEY: 'solo-tutor:account-deleted', ACCOUNT_DELETED_EVENT: 'solo-tutor:account-deleted',
  useStore: () => ({
    state: mocks.state, hydrated: true, writeStatus: mocks.writeStatus, dispatch: mocks.dispatch,
    prepareAccountDeletion: vi.fn(), commitAccountDeletion: vi.fn(), cancelAccountDeletion: vi.fn(),
  }),
}))
vi.mock('../../src/integrations/supabaseRest', () => ({
  getSupabaseConfig: () => ({ url: 'https://qa.supabase.co', publishableKey: 'qa' }),
  getSession: () => mocks.session,
  signOut: mocks.signOut,
  SupabaseRestError: class SupabaseRestError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code } },
}))
vi.mock('../../src/integrations/cloudApi', () => ({
  deleteTeacherAccount: vi.fn(), deleteSnapshot: vi.fn(), readSnapshot: mocks.readSnapshot, saveSnapshot: mocks.saveSnapshot,
}))
vi.mock('../../src/core/cloudKey', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/cloudKey')>()
  return { ...actual, loadKey: mocks.loadKey, rememberKey: mocks.rememberKey, importRecoveryKey: mocks.importRecoveryKey, forgetKey: vi.fn(), forgetKeys: vi.fn() }
})
vi.mock('../../src/core/cloudSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/cloudSync')>()
  return {
    ...actual,
    // ประตูให้เทสแทรก "ครูแก้ข้อมูล" ระหว่างที่ pull กำลังถอดรหัส
    unpackSnapshot: async (...args: Parameters<typeof actual.unpackSnapshot>) => {
      const gate = mocks.unpackGates.shift()
      if (gate) { mocks.unpackWaits += 1; await gate }
      return actual.unpackSnapshot(...args)
    },
  }
})
vi.mock('../../src/integrations/planApi', () => ({ readPlan: vi.fn().mockResolvedValue(null) }))

import { CloudSyncProvider, useCloudSync } from '../../src/app/CloudSync'

let cloud!: ReturnType<typeof useCloudSync>
function Probe() { cloud = useCloudSync(); return null }
const mount = () => render(<CloudSyncProvider><Probe /></CloudSyncProvider>)

const uid = 'teacher-1'
let key: CryptoKey
const cloudState = (): AppState => ({ ...buildScenario('default'), mode: 'real' })
const snapshotOf = async (state: AppState, revision = 3): Promise<CloudSnapshot> => {
  const sealed = await packSnapshot(state, key, '2025-09-02T01:00:00.000Z')
  return { revision, schema_version: 5, ...sealed, updated_at: '2025-09-02T01:00:00.000Z', device: 'Mac', kdf: 'pbkdf2-sha256-310000' }
}

beforeEach(async () => {
  key = await deriveKey('pw-123456', uid)
  mocks.state = buildReal()
  mocks.writeStatus = 'writable'
  mocks.session = { access_token: 'token', refresh_token: 'refresh', expires_at: 9_999_999_999, user: { id: uid, email: 'a@example.test' } }
  mocks.loadKey.mockResolvedValue(key)
  mocks.saveSnapshot.mockResolvedValue({ ok: true, revision: 1 })
  mocks.unpackGates = []; mocks.unpackWaits = 0
  localStorage.removeItem(SYNC_META_KEY); localStorage.removeItem(PRE_PULL_BACKUP_KEY)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('สมุดตัวอย่างไม่ซิงก์ ไม่ว่าจะเข้าสู่ระบบหรือไม่', () => {
  it('เดโม + เข้าสู่ระบบแล้ว → ปิดตัวเอง ไม่อ่านไม่เขียนคลาวด์ ไม่ restore', async () => {
    // ครูเข้าสู่ระบบจากหน้า LINE OA ได้ทั้งสองโหมดตั้งแต่ 9 ก.ย. (เดโมส่งผ่าน OA จริงได้)
    // การเข้าสู่ระบบจึงต้องไม่ลากข้อมูลจริงจากคลาวด์มาทับสมุดตัวอย่างที่กำลังโชว์อยู่
    mocks.state = buildScenario('default')
    expect(mocks.state.mode).toBe('demo')
    mocks.readSnapshot.mockResolvedValue(await snapshotOf(cloudState()))
    mount()
    await waitFor(() => expect(cloud.status).toBe('off'))
    expect(cloud.enabled).toBe(false)
    await act(async () => { await cloud.syncNow() })
    expect(mocks.readSnapshot).not.toHaveBeenCalled()
    expect(mocks.saveSnapshot).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
})

describe('A-06 stale pull ต้องไม่ทับข้อมูลที่ครูแก้ระหว่างรอเน็ต', () => {
  it('แก้ข้อมูลตอน pull กำลังถอดรหัส → กลายเป็น conflict ไม่ restore', async () => {
    const head = await snapshotOf(cloudState())
    mocks.readSnapshot.mockResolvedValue(head)
    const gate = deferred<void>()
    const { rerender } = mount()
    await waitFor(() => expect(cloud.session?.user.id).toBe(uid))
    // ครั้งแรก reconcile ตรวจ ciphertext (ผ่านทันที) ครั้งที่สองคือใน pull → ค้างที่ประตู
    mocks.unpackGates = [Promise.resolve(), gate.promise]
    const run = cloud.syncNow()
    await waitFor(() => expect(mocks.unpackWaits).toBe(2))
    // ครูเพิ่มนักเรียนขณะ pull รอ
    await act(async () => {
      mocks.state = { ...mocks.state, subjects: [{ id: 's-new', name: 'น้องใหม่', clientId: 'c-new', billing: { mode: 'per_unit', rate: 400 }, active: true, createdAt: mocks.state.today }],
        clients: [{ id: 'c-new', name: 'คุณแม่ใหม่' }] }
      rerender(<CloudSyncProvider><Probe /></CloudSyncProvider>)
    })
    gate.resolve()
    await act(async () => { await run })
    expect(mocks.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'restore' }))
    expect(cloud.status).toBe('conflict')
  })
})

describe('A-06 สลับบัญชีกลางคัน', () => {
  it('คำขอของบัญชี A ที่ค้างอยู่ห้ามเปลี่ยนสถานะหรือ push หลังออกจากระบบ', async () => {
    const pending = deferred<CloudSnapshot | null>()
    mocks.readSnapshot.mockReturnValue(pending.promise)
    mount()
    await waitFor(() => expect(cloud.session?.user.id).toBe(uid))
    const run = cloud.syncNow()
    await waitFor(() => expect(mocks.readSnapshot).toHaveBeenCalled())
    act(() => { cloud.signOutDevice() })
    pending.resolve(null) // ตอบว่าคลาวด์ว่าง → รอบปกติจะ push
    await act(async () => { await run })
    expect(mocks.saveSnapshot).not.toHaveBeenCalled()
    expect(cloud.status).toBe('signedout')
  })
})

describe('A-01 กุญแจกู้คืนกับบัญชีที่ยังไม่มี snapshot', () => {
  it('ไฟล์ตรงบัญชีแต่คลาวด์ยังว่าง → จดกุญแจแล้วซิงก์ต่อ ไม่ฟ้องว่าไฟล์ผิด', async () => {
    mocks.loadKey.mockResolvedValue(null)
    mocks.readSnapshot.mockResolvedValue(null)
    mocks.importRecoveryKey.mockResolvedValue(key)
    mount()
    await waitFor(() => expect(cloud.status).toBe('locked'))
    let ok = false
    await act(async () => { ok = await cloud.importRecovery('{"format":"solo-tutor-recovery-1"}') })
    expect(ok).toBe(true)
    expect(mocks.rememberKey).toHaveBeenCalledWith(uid, key)
  })
  it('ไฟล์ของบัญชีอื่นยังถูกปฏิเสธ', async () => {
    mocks.loadKey.mockResolvedValue(null)
    mocks.readSnapshot.mockResolvedValue(null)
    mocks.importRecoveryKey.mockResolvedValue(null)
    mount()
    await waitFor(() => expect(cloud.status).toBe('locked'))
    let ok = true
    await act(async () => { ok = await cloud.importRecovery('{}') })
    expect(ok).toBe(false)
    expect(mocks.rememberKey).not.toHaveBeenCalled()
  })
})

describe('A-03 กู้สำเนาก่อนดึงคลาวด์', () => {
  it('วางสำเนากลับ ล้าง meta เพื่อให้ถามใหม่ และรายงานเวลาสำเนาให้หน้าจอ', async () => {
    const before = cloudState()
    localStorage.setItem(PRE_PULL_BACKUP_KEY, toBackupForTests(before, '2025-09-01T10:00:00.000Z'))
    writeSyncMeta({ providerId: uid, cloudRevision: 3, localFingerprint: 'x', at: '2025-09-02T00:00:00.000Z' })
    mocks.readSnapshot.mockResolvedValue(null)
    mount()
    await waitFor(() => expect(cloud.prePullBackupAt).toBe('2025-09-01T10:00:00.000Z'))
    let ok = false
    await act(async () => { ok = await cloud.restorePrePullBackup() })
    expect(ok).toBe(true)
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'restore', state: expect.objectContaining({ mode: 'real' }) }))
    expect(readSyncMeta()).toBeNull()
  })
  it('แท็บอ่านอย่างเดียวกู้ไม่ได้ · ไม่มีสำเนาก็ไม่ได้', async () => {
    mocks.readSnapshot.mockResolvedValue(null)
    mocks.writeStatus = 'readonly'
    mount()
    await waitFor(() => expect(cloud.session?.user.id).toBe(uid))
    let ok = true
    await act(async () => { ok = await cloud.restorePrePullBackup() })
    expect(ok).toBe(false)
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
})
