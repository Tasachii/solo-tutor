import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { signIn, signOut } from '../../src/integrations/supabaseRest'
import { copy } from '../../src/copy'
import Insights from '../../src/app/Insights'

/**
 * P09 · หน้าจอต้องเล่าความจริงสามอย่าง
 *   1) ศูนย์คือศูนย์ ไม่ใช่ช่องว่างและไม่ใช่ค่าประมาณ
 *   2) นิยามและข้อจำกัดอยู่ข้างตัวเลข ไม่ใช่ท้ายหน้า
 *   3) เมื่อฐานข้อมูลปฏิเสธ ต้องบอกว่าถูกปฏิเสธ และต้องไม่มีตัวเลขค้างบนจอ
 */
const projectUrl = 'https://project-ref.supabase.co'
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const authBody = {
  access_token: 'access-one', refresh_token: 'refresh-one', expires_in: 3600,
  user: { id: 'owner-1', email: 'owner@example.com' },
}

const zeros = {
  generated_at: '2025-09-02T09:00:00+07:00',
  filters: { from: '2025-08-04', to: '2025-09-02', audience: 'public', mode: null, campaign: null },
  traffic: { visitors: 0, sessions: 0, landing_views: 0, pricing_views: 0 },
  demo: { started: 0, completed: 0 },
  accounts: { signup_started: 0, signup_completed: 0, email_verified: 0, onboarding_completed: 0 },
  teachers: { opened_app: 0, activated: 0, returning: 0 },
  campaigns: [],
  money: {
    pending_requests: 0, pro_requested: 0, paying_customers: 0,
    verified_payments: 0, gross_baht: 0, refund_baht: 0, net_baht: 0,
  },
  renewal: [],
}

const login = async () => {
  vi.stubEnv('VITE_SUPABASE_URL', projectUrl)
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_browser_test')
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(authBody))
  await signIn('owner@example.com', 'password')
  return fetchMock
}

const open = () => render(<MemoryRouter><Insights /></MemoryRouter>)

type FetchMock = Awaited<ReturnType<typeof login>>

const analyticsBodies = (fetchMock: FetchMock): Record<string, unknown>[] =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).includes('/rest/v1/rpc/owner_analytics'))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>)

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); signOut(); vi.unstubAllEnvs() })

describe('แดชบอร์ดเจ้าของ', () => {
  it('ช่วงที่ไม่มีข้อมูลแสดง 0 ทุกช่อง พร้อมนิยามและข้อจำกัดข้างตัวเลข', async () => {
    const fetchMock = await login()
    fetchMock.mockResolvedValueOnce(jsonResponse(zeros))
    open()
    await waitFor(() => expect(screen.getByText(copy.insights.traffic.title)).toBeTruthy())

    // ตัวเลขทั้งหมดของช่วงเปล่าคือ 0 และไม่มีช่องไหนกลายเป็น "ไม่มีข้อมูล"
    // 4 คนเข้าเว็บ + 2 เดโม + 4 สมัคร + 3 ครู + 7 เงิน = 20 ช่อง ทุกช่องเป็น 0 จริง ๆ
    expect(screen.getAllByText('0').length).toBe(20)
    expect(screen.queryByText(copy.insights.noValue)).toBeNull()
    // นิยามและข้อจำกัดต้องอยู่บนจอ ไม่ใช่ในเอกสารที่ไม่มีใครเปิด
    expect(screen.getByText(copy.insights.traffic.visitors.d)).toBeTruthy()
    expect(screen.getByText(copy.insights.teachers.note)).toBeTruthy()
    expect(screen.getByText(copy.insights.money.note)).toBeTruthy()
    expect(screen.getByText(copy.insights.retentionNote)).toBeTruthy()
    // ตารางที่ไม่มีแถวบอกว่าไม่มี ไม่ใช่เดาแถวขึ้นมา
    expect(screen.getByText(copy.insights.sourcesTable.empty)).toBeTruthy()
    expect(screen.getByText(copy.insights.renewal.empty)).toBeTruthy()

    const body = analyticsBodies(fetchMock)[0]
    expect(body).toEqual({
      p_from: '2025-08-04', p_to: '2025-09-02', p_audience: 'public', p_mode: null, p_campaign: null,
    })
  })

  it('ครูที่ไม่ใช่เจ้าของถูกฐานข้อมูลปฏิเสธ — ขึ้นข้อความว่าเปิดไม่ได้ และไม่มีตัวเลขให้เห็น', async () => {
    const fetchMock = await login()
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'owner analytics is restricted' }, 403))
    open()
    await waitFor(() => expect(screen.getByText(copy.insights.denied)).toBeTruthy())
    expect(screen.queryByText(copy.insights.traffic.title)).toBeNull()
    expect(screen.queryAllByText('0')).toHaveLength(0)
    // ข้อความต้องไม่โทษ session หมดอายุ ทั้งที่บัญชียังใช้ได้ปกติ
    expect(screen.queryByText(copy.insights.signedOut)).toBeNull()
  })

  it('เปลี่ยนช่วงเวลาแล้วถามเซิร์ฟเวอร์ใหม่ด้วยช่วงใหม่ ไม่ใช่คำนวณต่อจากตัวเลขเดิม', async () => {
    const fetchMock = await login()
    fetchMock.mockResolvedValue(jsonResponse(zeros))
    open()
    await waitFor(() => expect(analyticsBodies(fetchMock)).toHaveLength(1))

    fireEvent.change(screen.getByLabelText(copy.insights.filters.range), { target: { value: '7' } })
    await waitFor(() => expect(analyticsBodies(fetchMock)).toHaveLength(2))
    expect(analyticsBodies(fetchMock)[1]).toMatchObject({ p_from: '2025-08-27', p_to: '2025-09-02' })

    fireEvent.change(screen.getByLabelText(copy.insights.filters.campaign), { target: { value: 'line' } })
    await waitFor(() => expect(analyticsBodies(fetchMock)).toHaveLength(3))
    expect(analyticsBodies(fetchMock)[2]).toMatchObject({ p_campaign: 'line' })

    fireEvent.change(screen.getByLabelText(copy.insights.filters.audience), { target: { value: 'team' } })
    await waitFor(() => expect(analyticsBodies(fetchMock)).toHaveLength(4))
    expect(analyticsBodies(fetchMock)[3]).toMatchObject({ p_audience: 'team' })
  })

  it('ตัวเลขที่เซิร์ฟเวอร์ไม่ได้ส่งมา ขึ้นว่าไม่มีข้อมูล ไม่ใช่ 0', async () => {
    const fetchMock = await login()
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...zeros, traffic: {} }))
    open()
    await waitFor(() => expect(screen.getByText(copy.insights.traffic.title)).toBeTruthy())
    expect(screen.getAllByText(copy.insights.noValue)).toHaveLength(4)
  })
})
