import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildReal } from '../../src/core/scenarios'

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(), commit: vi.fn(), cancel: vi.fn(), dispatch: vi.fn(),
  deleteTeacher: vi.fn(), readSnapshot: vi.fn(), signOut: vi.fn(), clearArtifacts: vi.fn(), forgetKeys: vi.fn(),
}))

vi.mock('../../src/core/store', () => ({
  SCHEMA: 5,
  ACCOUNT_DELETED_KEY: 'solo-tutor:account-deleted',
  ACCOUNT_DELETED_EVENT: 'solo-tutor:account-deleted',
  useStore: () => ({
    state: buildReal(), hydrated: true, writeStatus: 'readonly', dispatch: mocks.dispatch,
    prepareAccountDeletion: mocks.prepare, commitAccountDeletion: mocks.commit,
    cancelAccountDeletion: mocks.cancel,
  }),
}))
vi.mock('../../src/integrations/supabaseRest', () => ({
  getSupabaseConfig: () => ({ url: 'https://qa.supabase.co', publishableKey: 'qa' }),
  getSession: () => ({ access_token: 'token', refresh_token: 'refresh', expires_at: 9_999_999_999,
    user: { id: 'teacher-1', email: 'teacher@example.test' } }),
  signOut: mocks.signOut,
  SupabaseRestError: class SupabaseRestError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code } },
}))
vi.mock('../../src/integrations/cloudApi', () => ({
  deleteTeacherAccount: mocks.deleteTeacher,
  deleteSnapshot: vi.fn(), readSnapshot: mocks.readSnapshot, saveSnapshot: vi.fn(),
}))
vi.mock('../../src/core/cloudKey', () => ({
  loadKey: vi.fn().mockResolvedValue(null), forgetKeys: mocks.forgetKeys, forgetKey: vi.fn(),
  exportRecoveryKey: vi.fn(), importRecoveryKey: vi.fn(), keyFromPassword: vi.fn(), rememberKey: vi.fn(),
}))
vi.mock('../../src/core/cloudSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/cloudSync')>()
  return { ...actual, clearAccountLocalArtifacts: mocks.clearArtifacts }
})
vi.mock('../../src/integrations/planApi', () => ({ readPlan: vi.fn().mockResolvedValue(null) }))

import { CloudSyncProvider, useCloudSync } from '../../src/app/CloudSync'

let cloud!: ReturnType<typeof useCloudSync>
function Probe() { cloud = useCloudSync(); return null }

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('account deletion server preflight', () => {
  it('does not reconcile or push from a follower tab', async () => {
    render(<CloudSyncProvider><Probe /></CloudSyncProvider>)
    await act(async () => { await cloud.syncNow() })
    expect(mocks.readSnapshot).not.toHaveBeenCalled()
  })

  it('never calls the deletion endpoint when this tab is not the writable leader', async () => {
    mocks.prepare.mockReturnValue(false)
    render(<CloudSyncProvider><Probe /></CloudSyncProvider>)
    let result: string | undefined
    await act(async () => { result = await cloud.deleteAccount('password') })
    expect(result).toBe('failed')
    expect(mocks.prepare).toHaveBeenCalledOnce()
    expect(mocks.deleteTeacher).not.toHaveBeenCalled()
  })

  it('commits the tombstone and purges credentials only after server confirmation', async () => {
    mocks.prepare.mockReturnValue(true)
    mocks.deleteTeacher.mockResolvedValue(true)
    mocks.commit.mockReturnValue('cleared')
    render(<CloudSyncProvider><Probe /></CloudSyncProvider>)
    await waitFor(() => expect(cloud.session?.user.id).toBe('teacher-1'))
    let result: string | undefined
    await act(async () => { result = await cloud.deleteAccount('password') })
    expect(result).toBe('deleted')
    expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteTeacher.mock.invocationCallOrder[0])
    expect(mocks.deleteTeacher.mock.invocationCallOrder[0]).toBeLessThan(mocks.commit.mock.invocationCallOrder[0])
    expect(mocks.clearArtifacts).toHaveBeenCalled()
    expect(mocks.forgetKeys).toHaveBeenCalled()
    expect(mocks.signOut).toHaveBeenCalled()
    expect(cloud.session).toBeNull()
  })
})
