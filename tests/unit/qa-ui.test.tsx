import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildScenario } from '../../src/core/scenarios'
import { availableBillingPeriods } from '../../src/app/Billing'
import { overlappingUnits } from '../../src/app/Today'
import { parseRoster } from '../../src/app/Onboarding'
import { waitlistDate, waitlistDeliveryResult } from '../../src/platform/WaitlistSheet'
import SubjectSheet from '../../src/app/SubjectSheet'

const mocks = vi.hoisted(() => ({
  state: null as unknown as ReturnType<typeof buildScenario>,
  dispatch: vi.fn(() => true),
}))

vi.mock('../../src/core/store', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/store')>('../../src/core/store')
  return { ...actual, useStore: () => ({ state: mocks.state, dispatch: mocks.dispatch }) }
})

afterEach(() => cleanup())
beforeEach(() => {
  mocks.state = buildScenario('default')
  mocks.dispatch.mockClear()
})

describe('QA UI regression guards', () => {
  it('offers current and historical billing periods with work or invoices', () => {
    const state = buildScenario('default')
    expect(availableBillingPeriods(state)).toEqual(expect.arrayContaining(['2025-09', '2025-08']))
    expect(availableBillingPeriods(state)[0]).toBe('2025-09')
  })

  it('offers a zero-session flat month inside the agreement interval', () => {
    const state = { ...buildScenario('empty'), today: '2025-09-01', clients: [{ id: 'c', name: 'ผู้จ่าย' }], subjects: [{
      id: 'flat', clientId: 'c', name: 'เหมา', active: true, createdAt: '2025-07-15',
      billing: { mode: 'flat_monthly' as const, amount: 3000 },
    }] }
    expect(availableBillingPeriods(state)).toEqual(['2025-09', '2025-08', '2025-07'])
  })

  it('warns about an overlapping appointment while allowing the save', () => {
    const state = buildScenario('default')
    const occupied = state.units[0]
    expect(overlappingUnits(state, occupied.scheduledAt, occupied.time, occupied.id)).toHaveLength(0)
    expect(overlappingUnits(state, occupied.scheduledAt, occupied.time)).toContainEqual(occupied)
  })

  it('keeps invalid onboarding rows visible for explicit confirmation', () => {
    const rows = parseRoster('น้องเอ,คุณแม่เอ\nน้องบี')
    expect(rows).toHaveLength(2)
    expect(rows[1].error).toBeTruthy()
  })

  it('stores waitlist dates as date-only values and trusts only an inspectable 2xx response', () => {
    expect(waitlistDate(new Date('2026-09-06T23:30:00+07:00'))).toBe('2026-09-06')
    expect(waitlistDeliveryResult('', null)).toBe('local')
    expect(waitlistDeliveryResult('https://example.test/form', { ok: true, type: 'basic' } as Response)).toBe('remote')
    expect(waitlistDeliveryResult('https://example.test/form', { ok: false, type: 'basic' } as Response)).toBe('local')
    expect(waitlistDeliveryResult('https://example.test/form', { ok: true, type: 'opaque' } as Response)).toBe('local')
  })

  it('reuses an existing payer and sends null when LINE is explicitly cleared', () => {
    render(<MemoryRouter><SubjectSheet onClose={vi.fn()} /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('เลือกผู้จ่ายที่มีอยู่'), { target: { value: mocks.state.clients[0].id } })
    fireEvent.change(screen.getByLabelText('ชื่อ'), { target: { value: 'น้องใหม่' } })
    fireEvent.change(screen.getByLabelText('LINE ID'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))

    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'upsertSubject', clientName: mocks.state.clients[0].name, lineId: null,
      subject: expect.objectContaining({ clientId: mocks.state.clients[0].id }),
    }))
  })

  it('creates a distinct payer when editing an unbilled subject instead of renaming the shared payer', () => {
    const subject = { ...mocks.state.subjects[0], id: 'qa-unbilled' }
    mocks.state.subjects.push(subject)
    render(<MemoryRouter><SubjectSheet subject={subject} onClose={vi.fn()} /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('เลือกผู้จ่ายที่มีอยู่'), { target: { value: 'new' } })
    expect((screen.getByLabelText('ชื่อผู้จ่าย') as HTMLInputElement).value).toBe('')
    fireEvent.change(screen.getByLabelText('ชื่อผู้จ่าย'), { target: { value: 'QA New Payer' } })
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      clientName: 'QA New Payer', subject: expect.objectContaining({ clientId: expect.not.stringMatching(`^${subject.clientId}$`) }),
    }))
  })

  it('keeps payer identity fixed once invoices exist', () => {
    render(<MemoryRouter><SubjectSheet subject={mocks.state.subjects[0]} onClose={vi.fn()} /></MemoryRouter>)
    expect((screen.getByLabelText('เลือกผู้จ่ายที่มีอยู่') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getByText(/มีประวัติบิลแล้ว/)).toBeTruthy()
  })
})
