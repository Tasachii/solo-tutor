import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildScenario } from '../../src/core/scenarios'

const mocks = vi.hoisted(() => ({
  plan: { plan: 'pro' as const, planUntil: '2025-08-01', pausedAt: '2025-07-01T00:00:00Z', fetchedAt: 'x' },
  push: vi.fn(), list: vi.fn(), request: vi.fn(), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(), refresh: vi.fn(),
}))

vi.mock('../../src/core/store', () => ({ useStore: () => ({ state: buildScenario('default') }) }))
vi.mock('../../src/platform/config', () => ({
  PAID_PLAN_AVAILABLE: true, PROVIDER_LEGAL_NAME: 'Solo Tutor QA', SOLO_PROMPTPAY: '0812345678', SUPPORT_CONTACT: 'qa@solo.test',
  PROVIDER_NAME: 'ครูเบนซ์', PROMPTPAY_DISPLAY: '08x-xxx-xxxx', LEGACY_TOKEN_FILE: '',
}))
vi.mock('../../src/app/components/Toast', () => ({ useToast: () => ({ push: mocks.push }) }))
vi.mock('../../src/app/CloudSync', () => ({ useCloudSync: () => ({
  plan: mocks.plan, session: { user: { id: 'u1', email: 'qa@solo.test' } }, refreshPlan: mocks.refresh,
}) }))
vi.mock('../../src/integrations/planApi', () => ({
  listPlanRequests: mocks.list, requestPlan: mocks.request, cancelPlanRequest: mocks.cancel,
  pausePlan: mocks.pause, resumePlan: mocks.resume,
}))

import { PlanCard } from '../../src/app/PlanCard'
import { copy } from '../../src/copy'

beforeEach(() => {
  mocks.push.mockClear(); mocks.list.mockReset().mockResolvedValue([])
  mocks.request.mockReset(); mocks.cancel.mockReset(); mocks.pause.mockReset(); mocks.resume.mockReset(); mocks.refresh.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('PlanCard server-state safeguards', () => {
  it('keeps resume accessible when a paused plan is past its original expiry', async () => {
    mocks.resume.mockResolvedValue({ ...mocks.plan, planUntil: '2025-10-01', pausedAt: null })
    render(<MemoryRouter><PlanCard /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: copy.plan.resume }))
    await waitFor(() => expect(mocks.resume).toHaveBeenCalledOnce())
    expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({ text: copy.plan.resumed, tone: 'ok' }))
  })

  it('reports network failure as failure, not as a duplicate or success', async () => {
    mocks.list.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    mocks.request.mockRejectedValue(new Error('offline'))
    render(<MemoryRouter><PlanCard /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /ส่งคำขอ/ }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({ text: copy.plan.requestFailed, tone: 'danger' })))
    expect(mocks.push).not.toHaveBeenCalledWith(expect.objectContaining({ text: copy.plan.submitted }))
    expect(mocks.push).not.toHaveBeenCalledWith(expect.objectContaining({ text: copy.plan.alreadyPending }))
  })

  it('keeps the cancel sheet open and explains when nothing was cancelled', async () => {
    mocks.list.mockResolvedValue([{ id: 'r1', months: 1, amount: 299, note: null, status: 'pending', created_at: 'x', decided_at: null, receipt_no: null }])
    mocks.cancel.mockResolvedValue(false)
    render(<MemoryRouter><PlanCard /></MemoryRouter>)
    await screen.findByText(/รอตรวจยอด/)
    fireEvent.click(screen.getByRole('button', { name: copy.plan.cancel }))
    fireEvent.click(screen.getAllByRole('button', { name: copy.plan.cancel }).at(-1)!)
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({ text: copy.plan.cancelFailed, tone: 'danger' })))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
