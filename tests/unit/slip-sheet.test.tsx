import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SlipSheet from '../../src/app/SlipSheet'
import { buildScenario } from '../../src/core/scenarios'
import { seedOf } from '../../src/core/share'
import { FROZEN_TODAY } from '../setup'

const mocks = vi.hoisted(() => ({
  state: null as unknown as ReturnType<typeof buildScenario>,
  dispatch: vi.fn(() => true),
  track: vi.fn(),
  push: vi.fn(),
}))

vi.mock('../../src/core/store', () => ({
  useStore: () => ({ state: mocks.state, dispatch: mocks.dispatch, track: mocks.track }),
}))
vi.mock('../../src/app/components/Toast', () => ({ useToast: () => ({ push: mocks.push }) }))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

beforeEach(() => {
  mocks.dispatch.mockClear()
  mocks.track.mockClear()
  mocks.push.mockClear()
})

describe('demo slip fallback', () => {
  it('can confirm the remaining balance when the simulated slip is unreadable', async () => {
    // เทสนี้ขอคุมทุก timer เอง — ต้องตรึงวันกลับ ไม่งั้นชุดข้อมูลเดโมเลื่อนตามปฏิทินจริง
    vi.useRealTimers()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(`${FROZEN_TODAY}T09:00:00+07:00`))
    const state = buildScenario('default')
    const original = state.invoices.find((invoice) => invoice.status !== 'paid')!
    let id = 'unreadable-0'
    for (let index = 1; seedOf(id) < 0.95; index += 1) id = `unreadable-${index}`
    const invoice = { ...original, id }
    mocks.state = {
      ...state,
      invoices: [...state.invoices.filter((row) => row.id !== original.id), invoice],
      payments: state.payments.filter((payment) => payment.invoiceId !== original.id),
    }

    render(<SlipSheet invoice={invoice} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'เลือกรูปสลิป' }))
    await act(async () => { vi.advanceTimersByTime(1500) })
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันเอง' }))

    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'recordPayment', invoiceId: id, amount: invoice.total, slipVerified: false,
    }))
  })
})

describe('demo slip mismatch', () => {
  it('สลิปเกินยอดบิล: รับได้ทันทีเท่ายอดบิล และจดยอดในสลิปไว้ — ไม่ใช่ปุ่มปิดให้ครูค้าง', async () => {
    vi.useRealTimers()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(`${FROZEN_TODAY}T09:00:00+07:00`))
    const state = buildScenario('default')
    const original = state.invoices.find((invoice) => invoice.status !== 'paid')!
    // เลือก id ที่สุ่มแล้วตกช่วง "ยอดเกิน" (0.875 ≤ seed < 0.95) — ผลผูกกับเลขที่ใบแจ้ง
    let id = 'over-0'
    for (let index = 1; !(seedOf(id) >= 0.875 && seedOf(id) < 0.95); index += 1) id = `over-${index}`
    const invoice = { ...original, id }
    mocks.state = {
      ...state,
      invoices: [...state.invoices.filter((row) => row.id !== original.id), invoice],
      payments: state.payments.filter((payment) => payment.invoiceId !== original.id),
    }

    render(<SlipSheet invoice={invoice} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'เลือกรูปสลิป' }))
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(screen.getByText(/สลิปเกินยอดบิล 500 บาท/)).toBeTruthy()
    const accept = screen.getByRole('button', { name: /รับยอดตามสลิป/ }) as HTMLButtonElement
    expect(accept.disabled).toBe(false)
    fireEvent.click(accept)

    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'recordPayment', invoiceId: id, amount: invoice.total, slipAmount: invoice.total + 500, slipVerified: true,
    }))
  })
})
