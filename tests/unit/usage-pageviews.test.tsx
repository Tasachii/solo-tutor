import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { buildScenario } from '../../src/core/scenarios'
import { DEMO_SLOT_KEY, StoreProvider, useStore } from '../../src/core/store'
import { resetUsageKeys } from '../../src/core/usage'
import { ToastProvider } from '../../src/app/components/Toast'
import SharedDocument from '../../src/app/SharedDocument'
import App from '../../src/App'

/**
 * เทสชุดนี้ใช้ตัวนับตัวจริงและดัก fetch — จึงเห็น payload ที่จะออกจากเครื่องจริง ๆ
 * ตอบ acceptance ข้อ "Landing → Pricing → Landing", "re-render ไม่เพิ่ม pageview",
 * "reload เพิ่ม view แต่ไม่เพิ่ม visitor" และ "parent link ไม่ขึ้น marketing pageview"
 */
let fetcher: ReturnType<typeof vi.fn>
let go!: (to: string) => void
let store!: ReturnType<typeof useStore>
function Nav() { go = useNavigate(); return null }
function Probe() { store = useStore(); return null }

const usageBodies = (): Record<string, unknown>[] => fetcher.mock.calls
  .filter(([url]) => String(url).includes('/functions/v1/usage'))
  .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>)

const allBodies = (): string => fetcher.mock.calls
  .map(([, init]) => String((init as RequestInit | undefined)?.body ?? '')).join('|')

const field = (rows: Record<string, unknown>[], name: string): unknown[] => rows.map((row) => row[name])

const openPublic = (entry: string) => render(
  <StoreProvider><ToastProvider><MemoryRouter initialEntries={[entry]}><Nav /><Probe /><App /></MemoryRouter></ToastProvider></StoreProvider>,
)

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://project-ref.supabase.co')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_browser_test')
  localStorage.setItem(DEMO_SLOT_KEY, JSON.stringify(buildScenario('empty')))
  fetcher = vi.fn().mockResolvedValue(new Response('{}'))
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks()
  localStorage.clear(); sessionStorage.clear(); resetUsageKeys()
})

describe('pageview ของหน้าสาธารณะ', () => {
  it('Landing → Pricing → Landing ในการใช้งานครั้งเดียว ได้ 3 views และ 1 session', async () => {
    openPublic('/?qa=0')
    await waitFor(() => expect(usageBodies()).toHaveLength(1))
    act(() => go('/pricing'))
    await waitFor(() => expect(usageBodies()).toHaveLength(2))
    act(() => go('/'))
    await waitFor(() => expect(usageBodies()).toHaveLength(3))

    const rows = usageBodies()
    expect(field(rows, 'event')).toEqual(['landing_view', 'pricing_view', 'landing_view'])
    expect(field(rows, 'route')).toEqual(['landing', 'pricing', 'landing'])
    expect(new Set(field(rows, 'session_id')).size).toBe(1)
    expect(new Set(field(rows, 'teacher_id')).size).toBe(1)
    // กันนับซ้ำ: คนละการเปิดหน้า = คนละ event_id
    expect(new Set(field(rows, 'event_id')).size).toBe(3)
    expect(field(rows, 'audience')).toEqual(['public', 'public', 'public'])
    // ยังไม่ได้เลือกโหมด และหน้าสาธารณะไม่ผูกบัญชี
    expect(field(rows, 'mode')).toEqual([null, null, null])
    expect(allBodies()).not.toMatch(/qa=0|project-ref|token/)
  })

  it('re-render ที่ไม่เปลี่ยนหน้า ไม่เพิ่ม pageview', async () => {
    openPublic('/?qa=0')
    await waitFor(() => expect(usageBodies()).toHaveLength(1))
    await waitFor(() => expect(store.writeStatus).toBe('writable'))

    act(() => { store.track('theme_switch', { theme: 'dark' }) })
    act(() => { store.track('accent_switch', { accent: 'navy' }) })

    expect(store.state.events.length).toBeGreaterThan(1)
    expect(usageBodies()).toHaveLength(1)
  })

  it('เปิดหน้าเดิมใหม่อีกครั้งเพิ่ม view แต่ยังเป็น visitor คนเดิม', async () => {
    openPublic('/?qa=0')
    await waitFor(() => expect(usageBodies()).toHaveLength(1))
    const first = usageBodies()[0]

    // reload จริงจะโหลดโมดูลใหม่ กุญแจที่ยิงไปแล้วจึงหายไปพร้อมกับหน้าเก่า
    cleanup(); resetUsageKeys()
    openPublic('/?qa=0')
    await waitFor(() => expect(usageBodies()).toHaveLength(2))

    const rows = usageBodies()
    expect(field(rows, 'event')).toEqual(['landing_view', 'landing_view'])
    expect(rows[1].teacher_id).toBe(first.teacher_id)
    expect(rows[1].session_id).toBe(first.session_id)
    expect(rows[1].event_id).not.toBe(first.event_id)
  })

  it('?qa=1 ย้ายทราฟฟิกของทีมไปคนละแกน ไม่ใช่ตัด Demo ทุกคนทิ้ง', async () => {
    openPublic('/?qa=1')
    await waitFor(() => expect(usageBodies()).toHaveLength(1))
    expect(usageBodies()[0].audience).toBe('team')
  })
})

describe('หน้าเอกสารของผู้ปกครองไม่มี marketing analytics', () => {
  it('/document/:token ไม่ส่งอะไรเลย และ token ไม่โผล่ใน network', async () => {
    render(
      <MemoryRouter initialEntries={['/document/secret-parent-token']}>
        <Routes>
          <Route path="/document/:token" element={<SharedDocument />} />
          <Route path="*" element={<StoreProvider><App /></StoreProvider>} />
        </Routes>
      </MemoryRouter>,
    )
    await act(async () => { await Promise.resolve() })

    expect(usageBodies()).toEqual([])
    expect(allBodies()).not.toContain('secret-parent-token')
  })

  it('ลิงก์ใบเสร็จและหน้าสรุปของลูกค้าไม่นับเป็นผู้เยี่ยมชมเว็บ', async () => {
    openPublic('/receipt/rc-parent-1')
    await act(async () => { await Promise.resolve() })
    expect(usageBodies()).toEqual([])

    act(() => go('/client/client-parent-1'))
    await act(async () => { await Promise.resolve() })
    expect(usageBodies()).toEqual([])
  })
})

describe('เหตุการณ์ครั้งเดียวออกจากเครื่องครั้งเดียวจริง', () => {
  it('ครบลูป Demo แล้วทำงานต่ออีกหลายอย่าง ยังส่ง demo_completed ใบเดียว', async () => {
    localStorage.setItem(DEMO_SLOT_KEY, JSON.stringify(buildScenario('default')))
    openPublic('/app/today?qa=0')
    await waitFor(() => expect(store.writeStatus).toBe('writable'))

    act(() => { store.track('complete_unit', { subjectId: 's1' }) })
    act(() => { store.track('close_month', { period: '2025-08', count: 2 }) })
    await waitFor(() => expect(usageBodies().filter((row) => row.event === 'demo_completed')).toHaveLength(1))

    act(() => { store.track('complete_unit', { subjectId: 's2' }) })
    act(() => { store.track('close_month', { period: '2025-09', count: 1 }) })
    await act(async () => { await Promise.resolve() })

    expect(usageBodies().filter((row) => row.event === 'demo_completed')).toHaveLength(1)
    // เข้า /app หลายหน้าในช่วงเดียวกันก็ยังเป็นการเปิดแอปครั้งเดียว
    act(() => go('/app/billing'))
    await act(async () => { await Promise.resolve() })
    expect(usageBodies().filter((row) => row.event === 'app_open')).toHaveLength(1)
  })
})

describe('ตัวนับที่ล้มเหลวต้องไม่กระทบงานของครู', () => {
  it('คำขอ analytics ที่ถูกบล็อก ไม่ทำให้บันทึกรับเงินล้มและไม่ขึ้นข้อความผิดพลาด', async () => {
    fetcher.mockRejectedValue(new Error('blocked by client'))
    localStorage.setItem(DEMO_SLOT_KEY, JSON.stringify(buildScenario('default')))
    openPublic('/?qa=0')
    await waitFor(() => expect(store.writeStatus).toBe('writable'))

    const invoice = store.state.invoices.find((row) => row.status === 'overdue' || row.status === 'sent')!
    let committed = false
    act(() => {
      committed = store.dispatch({ type: 'recordPayment', invoiceId: invoice.id, amount: 100, slipVerified: false })
    })
    await act(async () => { await Promise.resolve() })

    expect(committed).toBe(true)
    expect(store.state.payments.length).toBeGreaterThan(0)
    expect(store.persistenceError).toBeNull()
    expect(usageBodies().some((row) => row.event === 'payment_recorded')).toBe(true)
  })
})
