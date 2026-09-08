import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildScenario } from '../../src/core/scenarios'
import { ToastProvider } from '../../src/app/components/Toast'
import Account from '../../src/app/Account'
import { copy } from '../../src/copy'

/**
 * ครูที่อยากลบบัญชีต้องไม่เจอปุ่มที่กดแล้วล้มเปล่า ๆ
 * การลบต้องเกิดในช่องที่บัญชีอยู่จริง หน้าจอจึงต้องบอกเหตุผลและพาไปเองด้วยการกดครั้งเดียว
 */
const mocks = vi.hoisted(() => ({
  state: null as unknown as ReturnType<typeof buildScenario>,
  dispatch: vi.fn<(action: { type: string }) => boolean>(() => true),
}))
vi.mock('../../src/core/store', () => ({
  useStore: () => ({ state: mocks.state, dispatch: mocks.dispatch, track: () => {},
    hydrated: true, writeStatus: 'writable' as const }),
}))
vi.mock('../../src/app/CloudSync', () => ({
  useCloudSync: () => ({
    enabled: true, session: { user: { id: 'u1', email: 't@example.com' } }, status: 'synced' as const,
    lastAt: null, cloud: null, conflictCounts: null, error: '', plan: null,
    refreshPlan: async () => {}, refreshSession: () => {}, syncNow: async () => {},
    resolve: async () => false, unlock: async () => false, exportRecovery: async () => null,
    importRecovery: async () => false, prePullBackupAt: null, restorePrePullBackup: async () => false,
    deleteAccount: async () => ({ ok: false as const, reason: 'network' as const }),
    deleteCloud: async () => false, signOutDevice: () => true,
  }),
}))
vi.mock('../../src/integrations/supabaseRest', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getSupabaseConfig: () => ({ url: 'https://qa.supabase.co', publishableKey: 'sb_publishable_qa' }),
}))

const show = () => render(<MemoryRouter><ToastProvider><Account /></ToastProvider></MemoryRouter>)
afterEach(() => { cleanup(); mocks.dispatch.mockClear() })
beforeEach(() => { mocks.state = { ...buildScenario('default'), mode: 'real' } })

describe('ลบบัญชีจากช่องที่ถูกต้อง', () => {
  it('อยู่ในสมุดบัญชีจริง — ปุ่มลบบัญชีใช้ได้ตามปกติ', () => {
    show()
    expect(screen.getAllByRole('button', { name: copy.account.deleteAccountTitle }).length).toBeGreaterThan(0)
    expect(screen.queryByTestId('delete-needs-real')).toBeNull()
  })

  it('อยู่ในข้อมูลตัวอย่าง — ทั้งหน้าใช้ไม่ได้ จึงต้องบอกเหตุผลและพาไปด้วยการกดครั้งเดียว', () => {
    mocks.state = { ...mocks.state, mode: 'demo' }
    show()
    expect(screen.getByTestId('account-needs-real').textContent).toBe(copy.account.demoOnly)
    // ไม่มีปุ่มลบบัญชีให้กดในช่องที่บัญชีไม่ได้อยู่ ครูจึงไม่มีทางกดแล้วล้มเปล่า ๆ
    expect(screen.queryByRole('button', { name: copy.account.deleteAccountTitle })).toBeNull()
    screen.getByTestId('account-switch-real').click()
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'startReal' })
  })
})
