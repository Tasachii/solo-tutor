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
  mocks.dispatch.mockReset().mockReturnValue(true)
  mocks.track.mockClear()
  mocks.push.mockClear()
})

describe('payment confirmation single-flight', () => {
  const realInvoice = () => {
    const state = { ...buildScenario('default'), mode: 'real' as const }
    const invoice = state.invoices.find(row => row.status === 'sent' || row.status === 'overdue')!
    mocks.state = state
    return invoice
  }

  it('accepts only one full payment from two same-tick clicks', () => {
    const invoice = realInvoice()
    const onClose = vi.fn()
    render(<SlipSheet invoice={invoice} onClose={onClose} />)
    const confirm = screen.getByRole('button', { name: 'ยอดตรง รับเงินแล้ว' })

    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(mocks.dispatch).toHaveBeenCalledOnce()
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'recordPayment', invoiceId: invoice.id, amount: invoice.total,
    }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('accepts only one partial payment from two same-tick clicks', () => {
    const invoice = realInvoice()
    const onClose = vi.fn()
    render(<SlipSheet invoice={invoice} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'ยอดไม่ตรง ใส่ยอดเอง' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '100' } })
    const confirm = screen.getByRole('button', { name: 'ยืนยันรับยอด' })

    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(mocks.dispatch).toHaveBeenCalledOnce()
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'recordPayment', invoiceId: invoice.id, amount: 100,
    }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('releases the guard after a failed durable write so the teacher can retry', () => {
    const invoice = realInvoice()
    const onClose = vi.fn()
    mocks.dispatch.mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<SlipSheet invoice={invoice} onClose={onClose} />)
    const confirm = screen.getByRole('button', { name: 'ยอดตรง รับเงินแล้ว' })

    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(mocks.dispatch).toHaveBeenCalledTimes(2)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not carry the successful guard to a different invoice prop', () => {
    const state = { ...buildScenario('default'), mode: 'real' as const }
    const invoices = state.invoices.filter(row => row.status === 'sent' || row.status === 'overdue')
    expect(invoices.length).toBeGreaterThanOrEqual(2)
    mocks.state = state
    const onClose = vi.fn()
    const view = render(<SlipSheet invoice={invoices[0]} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'ยอดตรง รับเงินแล้ว' }))

    view.rerender(<SlipSheet invoice={invoices[1]} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'ยอดตรง รับเงินแล้ว' }))

    expect(mocks.dispatch).toHaveBeenCalledTimes(2)
    expect(mocks.dispatch).toHaveBeenNthCalledWith(1, expect.objectContaining({ invoiceId: invoices[0].id }))
    expect(mocks.dispatch).toHaveBeenNthCalledWith(2, expect.objectContaining({ invoiceId: invoices[1].id }))
  })
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
