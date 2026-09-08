import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { buildScenario } from '../../src/core/scenarios'
import { StoreProvider, STORAGE_KEY, useStore } from '../../src/core/store'
import type { Subject } from '../../src/core/types'
import { sendUsage } from '../../src/core/usage'
import { FROZEN_TODAY } from '../setup'

vi.mock('../../src/core/usage', () => ({ sendUsage: vi.fn(() => true) }))

import App from '../../src/App'

const sent = vi.mocked(sendUsage)
let store!: ReturnType<typeof useStore>
function Probe() { store = useStore(); return null }

afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); history.replaceState({}, '', '/') })

/** เปิดแอปจริงบน store จริง แล้วรอสิทธิ์เขียน — ล้างการนับตอนเปิดแอปทิ้ง เทสนี้วัดเฉพาะสิ่งที่เกิดหลังจากนั้น */
async function open(scenarioId: string): Promise<void> {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(buildScenario(scenarioId)))
  render(<StoreProvider><MemoryRouter initialEntries={['/']}><Probe /><App /></MemoryRouter></StoreProvider>)
  await waitFor(() => expect(store.writeStatus).toBe('writable'))
  sent.mockClear()
}

const counts = () => ({
  subjects: store.state.subjects.length,
  invoices: store.state.invoices.length,
  payments: store.state.payments.length,
})

/** นักเรียนใหม่แบบเหมาแพ็กจ่ายแล้ว — หนึ่ง action ได้ทั้งรายชื่อ บิล และยอดชำระอย่างละหนึ่ง */
const newPackageStudent = (id: string): Subject => ({
  id, name: `น้องใหม่-${id}`, clientId: `client-${id}`, active: true, createdAt: FROZEN_TODAY,
  billing: { mode: 'package', total: 8, price: 4000, purchasedAt: FROZEN_TODAY },
})

const addPackageStudent = (id: string): boolean => store.dispatch({
  type: 'upsertSubject', subject: newPackageStudent(id),
  clientName: `ผู้ปกครอง-${id}`, packageIntent: 'paid_purchase',
})

describe('ตัวนับการใช้งาน — ยกสมุดบัญชีทั้งก้อนไม่ใช่งานที่ครูเพิ่งทำ', () => {
  it('กู้คืนไฟล์สำรองที่มีนักเรียน บิล และยอดชำระเต็มก้อน ไม่ส่งเหตุการณ์ใดเลย', async () => {
    await open('empty')
    const backup = buildScenario('default')
    expect(backup.subjects.length).toBeGreaterThan(1)
    expect(backup.invoices.length).toBeGreaterThan(1)
    expect(backup.payments.length).toBeGreaterThan(1)

    act(() => { expect(store.dispatch({ type: 'restore', state: backup })).toBe(true) })

    expect(counts().invoices).toBeGreaterThan(1)
    expect(sent).not.toHaveBeenCalled()
  })

  it('ดึงข้อมูลลงเครื่องใหม่แล้วรับเงินจริงหนึ่งครั้ง ส่งหนึ่งใบที่ส่วนต่างถูกต้อง ไม่ใช่ยอดรวมหลังกู้คืน', async () => {
    await open('empty')
    act(() => { expect(store.dispatch({ type: 'restore', state: buildScenario('default') })).toBe(true) })
    expect(sent).not.toHaveBeenCalled()

    const before = counts()
    expect(before.payments).toBeGreaterThan(1)
    const invoice = store.state.invoices.find(row => row.status === 'overdue' || row.status === 'sent')!
    act(() => {
      expect(store.dispatch({ type: 'recordPayment', invoiceId: invoice.id, amount: 100, slipVerified: false })).toBe(true)
    })

    expect(counts().payments).toBe(before.payments + 1)
    expect(sent.mock.calls).toEqual([['payment_recorded', 1, 'demo']])
  })

  it('กู้คืนก้อนที่เล็กกว่าเดิม แล้วออกบิลจริงหนึ่งใบ ยังรายงานหนึ่งใบ ไม่เงียบหายไปกับฐานเก่า', async () => {
    await open('default')
    const big = counts()
    expect(big.invoices).toBeGreaterThan(1)
    act(() => { expect(store.dispatch({ type: 'restore', state: buildScenario('empty') })).toBe(true) })
    expect(counts()).toEqual({ subjects: 0, invoices: 0, payments: 0 })
    expect(sent).not.toHaveBeenCalled()

    act(() => { expect(addPackageStudent('s-after-restore')).toBe(true) })

    expect(counts()).toEqual({ subjects: 1, invoices: 1, payments: 1 })
    expect(sent.mock.calls).toEqual([
      ['students_changed', 1, 'demo'],
      ['invoice_issued', 1, 'demo'],
      ['payment_recorded', 1, 'demo'],
    ])
  })

  it('เริ่มใช้จริงที่ล้างข้อมูลตัวอย่างทิ้ง ไม่ส่งอะไร แล้วนักเรียนจริงคนแรกยังนับถูก', async () => {
    await open('default')
    expect(counts().subjects).toBeGreaterThan(1)

    act(() => { expect(store.dispatch({ type: 'startReal' })).toBe(true) })

    expect(store.state.mode).toBe('real')
    expect(counts()).toEqual({ subjects: 0, invoices: 0, payments: 0 })
    expect(sent).not.toHaveBeenCalled()

    act(() => { expect(addPackageStudent('s-first-real')).toBe(true) })

    expect(sent.mock.calls).toEqual([
      ['students_changed', 1, 'real'],
      ['invoice_issued', 1, 'real'],
      ['payment_recorded', 1, 'real'],
    ])
  })

  it('รีเซ็ตชุดตัวอย่างเป็นชุดที่ใหญ่กว่า ไม่ส่งอะไร', async () => {
    await open('empty')

    act(() => { expect(store.resetDemo('default')).toBe(true) })

    expect(counts().invoices).toBeGreaterThan(1)
    expect(sent).not.toHaveBeenCalled()
  })

  it('ลบบัญชีในเครื่องแล้วสมุดบัญชีว่าง ไม่ส่งอะไร', async () => {
    await open('default')

    act(() => { expect(store.dispatch({ type: 'deleteAccountLocal' })).toBe(true) })

    expect(counts()).toEqual({ subjects: 0, invoices: 0, payments: 0 })
    expect(sent).not.toHaveBeenCalled()
  })
})

describe('ตัวนับการใช้งาน — งานที่ครูลงมือทำยังนับเหมือนเดิม', () => {
  it('เพิ่มนักเรียน ออกบิล และรับเงิน ส่งครบสามเหตุการณ์ตามส่วนต่างจริง', async () => {
    await open('default')
    const before = counts()

    act(() => { expect(store.dispatch({ type: 'upsertSubject', subject: { ...newPackageStudent('s-new'), billing: { mode: 'per_unit', rate: 500 } }, clientName: 'ผู้ปกครองใหม่' })).toBe(true) })
    expect(sent.mock.calls).toEqual([['students_changed', before.subjects + 1, 'demo']])
    sent.mockClear()

    const period = FROZEN_TODAY.slice(0, 7)
    const beforeClose = counts()
    act(() => { expect(store.dispatch({ type: 'closeMonth', period })).toBe(true) })
    const created = counts().invoices - beforeClose.invoices
    expect(created).toBeGreaterThan(0)
    expect(created).toBeLessThan(counts().invoices)
    expect(sent.mock.calls).toEqual([['invoice_issued', created, 'demo']])
    sent.mockClear()

    const invoice = store.state.invoices.find(row => row.status === 'overdue' || row.status === 'sent')!
    act(() => { expect(store.dispatch({ type: 'recordPayment', invoiceId: invoice.id, amount: 100, slipVerified: false })).toBe(true) })
    expect(sent.mock.calls).toEqual([['payment_recorded', 1, 'demo']])
  })

  it('งานที่ไม่แตะรายชื่อ บิล หรือยอดเงิน ไม่ส่งอะไร', async () => {
    await open('default')
    const message = store.state.messages.find(row => row.status === 'draft')!

    act(() => { expect(store.dispatch({ type: 'skipMessage', id: message.id })).toBe(true) })

    expect(sent).not.toHaveBeenCalled()
  })
})

describe('ตัวนับการใช้งาน — สองแท็บต้องไม่นับงานชิ้นเดียวกันสองครั้ง', () => {
  it('แท็บที่อ่านก้อนใหม่จากแท็บอื่น นับเป็นการยกสมุดบัญชี', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildScenario('empty')))
    const tabs: Record<string, ReturnType<typeof useStore>> = {}
    function Tab({ id }: { id: string }) { tabs[id] = useStore(); return null }
    render(<StoreProvider><Tab id="leader" /></StoreProvider>)
    await waitFor(() => expect(tabs.leader.writeStatus).toBe('writable'))
    render(<StoreProvider><Tab id="follower" /></StoreProvider>)
    expect(tabs.follower.writeStatus).toBe('acquiring')
    const before = tabs.follower.ledgerReplacements

    const fromOtherTab = JSON.stringify(buildScenario('default'))
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: fromOtherTab })) })

    await waitFor(() => expect(tabs.follower.state.invoices.length).toBeGreaterThan(1))
    expect(tabs.follower.ledgerReplacements).toBe(before + 1)
  })

  it('แท็บที่ได้สิทธิ์เขียนแล้วอ่านข้อมูลล่าสุดใหม่ นับเป็นการยกสมุดบัญชี', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildScenario('default')))
    render(<StoreProvider><Probe /></StoreProvider>)
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    const before = store.ledgerReplacements

    act(() => { expect(store.retryPersistence()).toBe(true) })

    expect(store.ledgerReplacements).toBe(before + 1)
  })
})
