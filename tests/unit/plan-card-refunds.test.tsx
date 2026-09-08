import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildScenario } from '../../src/core/scenarios'

const mocks = vi.hoisted(() => ({
  push: vi.fn(), list: vi.fn(), rpc: vi.fn(),
  request: vi.fn(), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(), refresh: vi.fn(),
}))

vi.mock('../../src/core/store', () => ({ useStore: () => ({ state: buildScenario('default') }) }))
vi.mock('../../src/platform/config', () => ({
  PAID_PLAN_AVAILABLE: true, PROVIDER_LEGAL_NAME: 'Solo Tutor QA', SOLO_PROMPTPAY: '0812345678', SUPPORT_CONTACT: 'qa@solo.test',
  PROVIDER_NAME: 'ครูเบนซ์', PROMPTPAY_DISPLAY: '08x-xxx-xxxx', LEGACY_TOKEN_FILE: '',
}))
vi.mock('../../src/app/components/Toast', () => ({ useToast: () => ({ push: mocks.push }) }))
vi.mock('../../src/app/CloudSync', () => ({ useCloudSync: () => ({
  plan: { plan: 'pro', planUntil: '2025-12-31', pausedAt: null, fetchedAt: 'x' },
  session: { user: { id: 'u1', email: 'qa@solo.test' } }, refreshPlan: mocks.refresh,
}) }))
vi.mock('../../src/integrations/planApi', () => ({
  listPlanRequests: mocks.list, requestPlan: mocks.request, cancelPlanRequest: mocks.cancel,
  pausePlan: mocks.pause, resumePlan: mocks.resume,
}))
// rpc ตัวจริงถูกแทน แต่การอ่าน/รวมยอดใน core/planRefunds ยังเป็นของจริง
vi.mock('../../src/integrations/supabaseRest', async (actual) => ({
  ...(await actual<object>()),
  rpc: mocks.rpc,
}))

import { PlanCard } from '../../src/app/PlanCard'
import { copy } from '../../src/copy'
import { money } from '../../src/core/format'
import { SupabaseRestError } from '../../src/integrations/supabaseRest'

// ยอดสมมติทั้งหมด — 1200 ไม่ใช่ราคาแพ็กจริง และ 9999 คือยอดผิดที่ตั้งใจใส่ให้หลักฐานหักล้าง
const APPROVED = {
  id: 'request-synthetic-1', months: 1, amount: 9999, note: null,
  status: 'approved' as const, created_at: '2025-08-01T03:00:00Z',
  decided_at: '2025-08-02T03:00:00Z', receipt_no: 'SP-SYNTHETIC-0001',
}
const refundRow = (over: Record<string, unknown> = {}) => ({
  refund_id: 'refund-synthetic-1', plan_request_id: APPROVED.id, receipt_no: APPROVED.receipt_no,
  paid_amount: 1200, refunded_amount: 500, refunded_total: 500,
  occurred_at: '2025-08-20T03:00:00Z', ...over,
})

const openReceipt = () => fireEvent.click(screen.getByRole('button', { name: copy.plan.receipt }))

beforeEach(() => {
  mocks.push.mockClear()
  mocks.list.mockReset().mockResolvedValue([APPROVED])
  mocks.rpc.mockReset().mockResolvedValue([])
  mocks.request.mockReset(); mocks.cancel.mockReset(); mocks.pause.mockReset(); mocks.resume.mockReset()
  mocks.refresh.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('PlanCard refunds (D-08)', () => {
  it('ใบเสร็จที่ไม่มีการคืนเงินยังแสดงเหมือนเดิม ไม่มีคำว่าคืนเงินโผล่มา', async () => {
    render(<MemoryRouter><PlanCard /></MemoryRouter>)
    await screen.findByText(APPROVED.receipt_no, { exact: false })
    expect(screen.queryByTestId('plan-refunded')).toBeNull()
    expect(screen.queryByTestId('plan-refund-unknown')).toBeNull()
  })

  it('คืนเงินบางส่วนขึ้นในประวัติ พร้อมยอดคืนและยอดสุทธิจากหลักฐาน', async () => {
    mocks.rpc.mockResolvedValue([refundRow()])
    render(<MemoryRouter><PlanCard /></MemoryRouter>)
    const listed = await screen.findByTestId('plan-refunded')
    expect(listed.textContent).toContain(copy.plan.refund.partial)
    expect(listed.textContent).toContain(money(500))
    expect(listed.textContent).toContain(money(700))
    // ยอดที่ชำระต้องมาจากหลักฐาน (1200) ไม่ใช่ยอดในคำขอ (9999)
    expect(listed.textContent).toContain(money(1200))
    expect(listed.textContent).not.toContain(money(9999))
  })

  it('คืนเต็มจำนวนแล้วใบเสร็จบอกยอดคืน ยอดสุทธิ และรายการคืนทีละครั้ง', async () => {
    mocks.rpc.mockResolvedValue([
      refundRow({ refund_id: 'refund-synthetic-2', refunded_amount: 700, refunded_total: 1200, occurred_at: '2025-08-21T03:00:00Z' }),
      refundRow({ refunded_amount: 500, refunded_total: 1200 }),
    ])
    render(<MemoryRouter><PlanCard /></MemoryRouter>)
    await screen.findByTestId('plan-refunded')
    openReceipt()
    const sheet = await screen.findByTestId('plan-receipt-refund')
    expect(sheet.textContent).toContain(copy.plan.refund.full)
    expect(sheet.querySelectorAll('li')).toHaveLength(2)
    expect(sheet.textContent).toContain(copy.plan.refund.keepsPlan)
    expect(sheet.textContent).toContain(copy.plan.refund.source)
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain(copy.plan.refund.paid)
    expect(dialog.textContent).toContain(copy.plan.refund.refunded)
    expect(dialog.textContent).toContain(copy.plan.refund.net)
    expect(dialog.textContent).toContain(`-${money(1200)}`)
  })

  it('ใบเสร็จไม่เปิดเผยเลขอ้างอิงธนาคารหรือชื่อผู้ตรวจ แม้เซิร์ฟเวอร์จะส่งมาเกิน', async () => {
    mocks.rpc.mockResolvedValue([refundRow({ bank_reference: 'SYNTHETIC-BANK-REF', verified_by: 'synthetic-operator' })])
    render(<MemoryRouter><PlanCard /></MemoryRouter>)
    await screen.findByTestId('plan-refunded')
    openReceipt()
    await screen.findByTestId('plan-receipt-refund')
    expect(document.body.textContent).not.toContain('SYNTHETIC-BANK-REF')
    expect(document.body.textContent).not.toContain('synthetic-operator')
  })

  it('ตรวจคืนเงินไม่สำเร็จต้องเตือน ไม่ใช่ปล่อยให้ใบเสร็จอ่านเป็นยอดเต็มเงียบ ๆ', async () => {
    mocks.rpc.mockRejectedValue(new Error('offline'))
    render(<MemoryRouter><PlanCard /></MemoryRouter>)
    await screen.findByTestId('plan-refund-unknown')
    expect(screen.queryByText(copy.plan.loadFailed)).toBeNull()
    expect(screen.queryByTestId('plan-refunded')).toBeNull()
  })

  it('คำขอที่ล้มด้วยสถานะอื่นยังนับเป็นความล้มเหลว ไม่ใช่ฐานที่ยังไม่มีคำสั่ง', async () => {
    mocks.rpc.mockRejectedValue(new SupabaseRestError('unauthorized', 'เซสชันหมดอายุ', 401))
    render(<MemoryRouter><PlanCard /></MemoryRouter>)
    await screen.findByTestId('plan-refund-unknown')
  })

  it('ฐานที่ยังไม่มีคำสั่งคืนเงิน (404) ต้องไม่เตือนอะไรเลย ใบเสร็จเหมือนก่อนมีฟีเจอร์นี้', async () => {
    mocks.rpc.mockRejectedValue(new SupabaseRestError('remote-error', 'Supabase ทำรายการไม่สำเร็จ (HTTP 404)', 404))
    render(<MemoryRouter><PlanCard /></MemoryRouter>)
    const listed = await screen.findByText(APPROVED.receipt_no, { exact: false })
    expect(screen.queryByTestId('plan-refund-unknown')).toBeNull()
    expect(screen.queryByTestId('plan-refunded')).toBeNull()
    expect(screen.queryByText(copy.plan.loadFailed)).toBeNull()
    // ยอดในประวัติกลับไปอ่านจากคำขอตามเดิม และไม่มีคำว่าคืนเงินโผล่ที่ไหน
    expect(listed.closest('li')?.textContent).toContain(money(APPROVED.amount))
    expect(document.body.textContent).not.toContain(copy.plan.refund.partial)
    expect(document.body.textContent).not.toContain(copy.plan.refund.full)
    openReceipt()
    const dialog = await screen.findByRole('dialog')
    expect(screen.queryByTestId('plan-receipt-refund')).toBeNull()
    expect(dialog.textContent).toContain(copy.receipt.amount)
    expect(dialog.textContent).not.toContain(copy.plan.refund.paid)
    expect(dialog.textContent).not.toContain(copy.plan.refund.net)
  })

  it('ไม่มีใบเสร็จก็ไม่ต้องเตือนเรื่องคืนเงิน — ไม่มียอดใดให้เข้าใจผิด', async () => {
    mocks.list.mockResolvedValue([])
    mocks.rpc.mockRejectedValue(new Error('offline'))
    render(<MemoryRouter><PlanCard /></MemoryRouter>)
    await screen.findByRole('radiogroup')
    expect(screen.queryByTestId('plan-refund-unknown')).toBeNull()
  })

  it('สรุปคืนเงินที่โหลดสำเร็จแล้วไม่หายไปเมื่อรอบถัดไปตรวจไม่ได้', async () => {
    mocks.rpc.mockResolvedValueOnce([refundRow()]).mockRejectedValue(new Error('offline'))
    mocks.request.mockResolvedValue([{ ...APPROVED, id: 'request-synthetic-2', status: 'pending', decided_at: null, receipt_no: null }])
    render(<MemoryRouter><PlanCard /></MemoryRouter>)
    await screen.findByTestId('plan-refunded')
    fireEvent.click(screen.getByRole('button', { name: /ส่งคำขอ/ }))
    // คำขอยิงจริง ต้องรอให้จบก่อนจบเทส ไม่งั้น teardown จะชนกับ state update
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({ text: copy.plan.submitted })))
    await screen.findByTestId('plan-refund-unknown')
    expect(screen.getByTestId('plan-refunded').textContent).toContain(copy.plan.refund.partial)
  })
})
