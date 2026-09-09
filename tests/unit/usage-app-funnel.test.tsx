import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { buildScenario } from '../../src/core/scenarios'
import { DEMO_SLOT_KEY, StoreProvider, useStore } from '../../src/core/store'
import type { AppState, Invoice } from '../../src/core/types'
import { SERVER_EVENTS, resetUsageKeys, sendUsage } from '../../src/core/usage'
import { ToastProvider } from '../../src/app/components/Toast'
import { FROZEN_TODAY } from '../setup'

vi.mock('../../src/core/usage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/usage')>()
  return { ...actual, sendUsage: vi.fn(() => true) }
})

import App from '../../src/App'
import Login from '../../src/platform/Login'
import Onboarding from '../../src/app/Onboarding'
import StylePicker from '../../src/platform/StylePicker'

const sent = vi.mocked(sendUsage)
let store!: ReturnType<typeof useStore>
let go!: (to: string) => void
function Probe() { store = useStore(); return null }
function Nav() { go = useNavigate(); return null }

const names = (): string[] => sent.mock.calls.map(([event]) => event)
const callsFor = (event: string) => sent.mock.calls.filter(([name]) => name === event)

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); resetUsageKeys() })
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllEnvs(); localStorage.clear(); resetUsageKeys() })

async function openApp(scenarioId: string, entry = '/'): Promise<void> {
  localStorage.setItem(DEMO_SLOT_KEY, JSON.stringify(buildScenario(scenarioId)))
  render(<StoreProvider><ToastProvider><MemoryRouter initialEntries={[entry]}><Nav /><Probe /><App /></MemoryRouter></ToastProvider></StoreProvider>)
  await waitFor(() => expect(store.writeStatus).toBe('writable'))
  sent.mockClear()
}

describe('app_open นับการเปิดแอปจริง ไม่ใช่การเปิดหน้าขาย', () => {
  it('อยู่หน้าแรกไม่ส่ง app_open · เข้า /app แล้วส่งครั้งเดียวต่อ session ต่อโหมด', async () => {
    await openApp('default')
    expect(callsFor('app_open')).toEqual([])

    act(() => go('/app/today'))
    await waitFor(() => expect(callsFor('app_open')).toHaveLength(1))
    expect(callsFor('app_open')[0][2]).toMatchObject({ route: 'app', mode: 'demo' })

    act(() => go('/pricing'))
    act(() => go('/app/billing'))
    await act(async () => { await Promise.resolve() })
    expect(callsFor('app_open')).toHaveLength(1)
  })

  it('เปลี่ยนมาโหมดจริงนับการเปิดแอปของโหมดจริงอีกครั้ง — pitch-metrics ถามหาโหมดจริงโดยเฉพาะ', async () => {
    await openApp('default', '/app/today')

    act(() => { expect(store.dispatch({ type: 'startReal' })).toBe(true) })

    await waitFor(() => expect(callsFor('app_open')).toHaveLength(1))
    expect(callsFor('app_open')[0][2]).toMatchObject({ route: 'app', mode: 'real' })
  })
})

describe('funnel ของคนลอง Demo', () => {
  it('demo_completed ขึ้นเมื่อผู้ใช้กดบันทึกคาบและปิดยอดจริงเท่านั้น', async () => {
    await openApp('default', '/app/today')

    act(() => { store.track('complete_unit', { subjectId: 's1' }) })
    expect(names()).not.toContain('demo_completed')

    act(() => { store.track('close_month', { period: FROZEN_TODAY.slice(0, 7), count: 3 }) })
    await waitFor(() => expect(callsFor('demo_completed')).toHaveLength(1))
    expect(callsFor('demo_completed')[0][2]).toMatchObject({ mode: 'demo' })

    // ครบลูปแล้วทำอีก ใช้กุญแจเดิมเสมอ ตัวนับจริงจึงส่งออกครั้งเดียว (ดู usage-pageviews.test.tsx)
    act(() => { store.track('complete_unit', { subjectId: 's2' }) })
    const keys = new Set(callsFor('demo_completed').map(([, , options]) => options?.key))
    expect(keys.size).toBe(1)
    expect([...keys][0]).toMatch(/^demo_completed:[0-9a-f-]{36}$/)
  })

  it('ก้อนที่กู้คืนมาพร้อมประวัติครบลูป ไม่ทำให้กลายเป็นคนที่ลองสำเร็จ', async () => {
    await openApp('empty', '/app/today')
    const carried: AppState = {
      ...buildScenario('default'),
      events: [
        { at: `${FROZEN_TODAY}T02:00:00.000Z`, name: 'close_month' },
        { at: `${FROZEN_TODAY}T01:00:00.000Z`, name: 'complete_unit' },
      ],
    }

    act(() => { expect(store.dispatch({ type: 'restore', state: carried })).toBe(true) })

    expect(store.state.events.some((row) => row.name === 'close_month')).toBe(true)
    expect(names()).not.toContain('demo_completed')

    // ตั้งฐานใหม่ ไม่ใช่ปิดตายถาวร — ลงมือทำเองอีกครั้งยังนับให้
    act(() => { store.track('complete_unit', { subjectId: 's1' }) })
    act(() => { store.track('close_month', { period: FROZEN_TODAY.slice(0, 7), count: 1 }) })
    await waitFor(() => expect(callsFor('demo_completed')).toHaveLength(1))
  })
})

describe('เริ่มลอง Demo', () => {
  const openPicker = async (scenarioId: string) => {
    localStorage.setItem(DEMO_SLOT_KEY, JSON.stringify(buildScenario(scenarioId)))
    render(<StoreProvider><ToastProvider><MemoryRouter initialEntries={['/start']}><Probe /><StylePicker /></MemoryRouter></ToastProvider></StoreProvider>)
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    sent.mockClear()
  }

  it('เลือกวิธีเก็บเงินแล้วเข้าแอปด้วยข้อมูลตัวอย่าง = เริ่มลอง Demo', async () => {
    await openPicker('empty')

    fireEvent.click(screen.getAllByRole('button', { name: /^เริ่มแบบนี้/ })[0])

    expect(callsFor('demo_started')).toHaveLength(1)
    expect(callsFor('demo_started')[0][2]).toMatchObject({ mode: 'demo', route: 'start' })
  })

  it('ครูที่ใช้จริงอยู่แล้วเปลี่ยนวิธีเก็บเงิน ไม่ใช่คนเริ่มลอง Demo', async () => {
    await openPicker('empty')
    act(() => { expect(store.dispatch({ type: 'startReal' })).toBe(true) })
    sent.mockClear()

    fireEvent.click(screen.getAllByRole('button', { name: /^เริ่มแบบนี้/ })[0])

    expect(names()).not.toContain('demo_started')
  })
})

describe('การกู้คืนสมุดบัญชีไม่ใช่ผลงานของครู', () => {
  it('กู้คืนบิล 20 ใบ ไม่สร้าง invoice_issued สักใบ', async () => {
    await openApp('empty', '/app/today')
    const base = buildScenario('default')
    // ประวัติเก่าอีก 15 ใบต่อท้ายของเดิม 5 ใบ — ยอดชำระเดิมยังชี้บิลที่มีอยู่จริง
    const older: Invoice[] = ['2025-01', '2025-02', '2025-03']
      .flatMap((period) => base.invoices.map((invoice, index) => ({
        ...invoice, id: `inv-${period}-${index}`, period, status: 'sent' as const,
      })))
    const twenty = [...base.invoices, ...older]
    expect(twenty).toHaveLength(20)

    act(() => { expect(store.dispatch({ type: 'restore', state: { ...base, invoices: twenty } })).toBe(true) })

    expect(store.state.invoices).toHaveLength(20)
    expect(names()).not.toContain('invoice_issued')
    expect(names()).not.toContain('payment_recorded')
    expect(names()).not.toContain('students_changed')
  })
})

describe('ครูตั้งค่าเสร็จ', () => {
  const fillProvider = () => {
    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[0], { target: { value: 'ครูมายด์' } })
    fireEvent.change(inputs[1], { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'ครับ' }))
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }))
  }
  const openOnboarding = () => {
    localStorage.setItem(DEMO_SLOT_KEY, JSON.stringify(buildScenario('empty')))
    render(<StoreProvider><ToastProvider><MemoryRouter initialEntries={['/app/onboarding']}><Probe /><Onboarding /></MemoryRouter></ToastProvider></StoreProvider>)
  }

  it('บันทึกรายชื่อสำเร็จส่ง onboarding_completed พร้อมจำนวนที่นำเข้าได้จริง', async () => {
    openOnboarding()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    sent.mockClear()
    fillProvider()
    const roster = document.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.change(roster, { target: { value: 'น้องเอ, แม่เอ\nน้องบี, แม่บี' } })

    fireEvent.click(screen.getByRole('button', { name: /เริ่มใช้งาน \(2\)/ }))

    expect(callsFor('onboarding_completed')).toHaveLength(1)
    expect(callsFor('onboarding_completed')[0][1]).toBe(2)
    expect(callsFor('onboarding_completed')[0][2]).toMatchObject({ route: 'app', mode: 'demo' })
  })

  it('ข้ามการนำเข้าก็ยังเป็นการตั้งค่าที่สำเร็จ แต่จำนวนเป็นศูนย์', async () => {
    openOnboarding()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    sent.mockClear()
    fillProvider()

    fireEvent.click(screen.getByRole('button', { name: /ข้ามไปก่อน/ }))

    expect(callsFor('onboarding_completed')).toHaveLength(1)
    expect(callsFor('onboarding_completed')[0][1]).toBe(0)
  })

  it('ราคาที่บันทึกไม่ได้ ไม่นับว่าตั้งค่าเสร็จ', async () => {
    openOnboarding()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    sent.mockClear()
    fillProvider()
    const price = document.querySelector('input[inputmode="numeric"]') as HTMLInputElement
    fireEvent.change(price, { target: { value: '12.5' } })

    fireEvent.click(screen.getByRole('button', { name: /ข้ามไปก่อน/ }))

    expect(names()).not.toContain('onboarding_completed')
  })
})

describe('funnel ของคนสมัคร', () => {
  const openLogin = () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project-ref.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_browser_test')
    localStorage.setItem(DEMO_SLOT_KEY, JSON.stringify(buildScenario('empty')))
    render(<StoreProvider><ToastProvider><MemoryRouter initialEntries={['/login']}><Probe /><Login /></MemoryRouter></ToastProvider></StoreProvider>)
  }
  const form = (): HTMLFormElement => document.querySelector('form') as HTMLFormElement

  it('ส่งฟอร์มสมัครที่กรอกครบ นับว่าเริ่มสมัคร และเบราว์เซอร์อ้าง signup_completed เองไม่ได้', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    openLogin()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    sent.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'ยังไม่มีบัญชี สมัครใช้งาน' }))
    fireEvent.change(screen.getByLabelText('อีเมล'), { target: { value: 'kru@example.com' } })
    fireEvent.change(screen.getByLabelText('รหัสผ่าน'), { target: { value: 'a-long-password' } })
    fireEvent.change(screen.getByLabelText('ยืนยันรหัสผ่าน'), { target: { value: 'a-long-password' } })

    fireEvent.submit(form())
    // รอจนคำขอสมัครจบจริง ไม่ใช่แค่ microtask เดียว — ไม่งั้นฟอร์มยังตั้งสถานะค้างอยู่หลังเทสจบ
    // แล้ว React จะไปแตะ window ที่ถูกรื้อไปแล้ว ซึ่งทำให้ทั้งชุดล้มแบบสุ่ม
    await waitFor(() => expect(screen.getByRole('button', { name: 'สมัครใช้งาน' })).toBeTruthy())

    expect(callsFor('signup_started')).toHaveLength(1)
    expect(callsFor('signup_started')[0][2]).toMatchObject({ route: 'login' })
    for (const name of SERVER_EVENTS) expect(names()).not.toContain(name)
    vi.unstubAllGlobals()
  })

  it('ฟอร์มสมัครที่กรอกไม่ครบ ไม่นับว่าเริ่มสมัคร', async () => {
    openLogin()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    sent.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'ยังไม่มีบัญชี สมัครใช้งาน' }))

    fireEvent.submit(form())

    expect(form().checkValidity()).toBe(false)
    expect(names()).not.toContain('signup_started')
  })

  it('ครูเดิมเข้าสู่ระบบ ไม่ใช่คนสมัครใหม่', async () => {
    openLogin()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    sent.mockClear()
    fireEvent.change(screen.getByLabelText('อีเมล'), { target: { value: 'kru@example.com' } })
    fireEvent.change(screen.getByLabelText('รหัสผ่าน'), { target: { value: 'a-long-password' } })

    fireEvent.submit(form())

    expect(form().checkValidity()).toBe(true)
    expect(names()).not.toContain('signup_started')
    // ฟอร์มนี้ผ่าน validation จึงยิงคำขอจริง ต้องรอให้จบก่อนเทสจบ ไม่งั้นงานค้างไปแตะ window ที่ถูกรื้อแล้ว
    await waitFor(() => expect(screen.getByRole('button', { name: 'เข้าสู่ระบบ' })).toBeTruthy())
  })
})
