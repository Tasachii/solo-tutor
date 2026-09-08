import { describe, expect, it } from 'vitest'
import { SupabaseRestError } from '../../src/integrations/supabaseRest'
import {
  DEFAULT_OWNER_FILTERS, fetchOwnerAnalytics, ownerFailure, ownerRange, ownerRequest, parseOwnerAnalytics,
} from '../../src/core/ownerMetrics'

/**
 * P09 · ตัวเลขต้องเดินทางจากฐานข้อมูลถึงจอโดยไม่ถูกแต่ง
 * สองกรณีที่ห้ามปนกันเด็ดขาด: เซิร์ฟเวอร์ตอบว่า 0 กับ เราไม่ได้ตัวเลขนั้นมา
 */
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

describe('อ่านคำตอบของ owner_analytics', () => {
  it('ศูนย์ที่เซิร์ฟเวอร์ตอบมา ยังเป็นศูนย์ ไม่ใช่ "ไม่มีข้อมูล"', () => {
    const parsed = parseOwnerAnalytics(zeros)
    expect(parsed.traffic.visitors).toBe(0)
    expect(parsed.money.netBaht).toBe(0)
    expect(parsed.teachers.activated).toBe(0)
    expect(parsed.campaigns).toEqual([])
    expect(parsed.renewal).toEqual([])
    expect(parsed.from).toBe('2025-08-04')
  })

  it('ช่องที่หายไปหรือไม่ใช่ตัวเลข เป็น null ไม่ใช่ 0 — จะได้ไม่แต่งเลขให้ผู้อ่าน', () => {
    const parsed = parseOwnerAnalytics({ ...zeros, traffic: { visitors: '12', sessions: null } })
    expect(parsed.traffic.visitors).toBeNull()
    expect(parsed.traffic.sessions).toBeNull()
    expect(parsed.traffic.landingViews).toBeNull()
    expect(parseOwnerAnalytics(null).money.grossBaht).toBeNull()
  })

  it('แถวแหล่งที่มาและแถวต่ออายุถูกอ่านครบ', () => {
    const parsed = parseOwnerAnalytics({
      ...zeros,
      campaigns: [{ source: 'line', visitors: 4, sessions: 5, pageviews: 9, signup_started: 1 }],
      renewal: [{ cohort_month: '2025-07-01', first_month_payers: 3, renewed_month_2: 1, percent: 33.3 }],
    })
    expect(parsed.campaigns[0]).toEqual({ source: 'line', visitors: 4, sessions: 5, pageviews: 9, signupStarted: 1 })
    expect(parsed.renewal[0]).toEqual({
      cohortMonth: '2025-07-01', firstMonthPayers: 3, renewedMonth2: 1, percent: 33.3,
    })
  })
})

describe('ตัวกรองที่ส่งไปให้เซิร์ฟเวอร์', () => {
  it('ช่วงเวลานับรวมวันนี้ และยาวเท่าที่เลือก', () => {
    expect(ownerRange(30, '2025-09-02')).toEqual({ from: '2025-08-04', to: '2025-09-02' })
    expect(ownerRange(7, '2025-09-02')).toEqual({ from: '2025-08-27', to: '2025-09-02' })
  })

  it('"ทั้งหมด" แปลว่าไม่กรอง จึงส่ง null ไม่ใช่ส่งคำว่า all', () => {
    expect(ownerRequest({ days: 7, audience: 'all', mode: 'all', campaign: 'all' }, '2025-09-02')).toEqual({
      p_from: '2025-08-27', p_to: '2025-09-02', p_audience: null, p_mode: null, p_campaign: null,
    })
    expect(ownerRequest({ ...DEFAULT_OWNER_FILTERS, campaign: 'none' }, '2025-09-02')).toMatchObject({
      p_audience: 'public', p_campaign: 'none',
    })
  })

  it('เรียกฟังก์ชันชื่อเดียวกับใน migration และอ่านคำตอบกลับมาเป็นตัวเลข', async () => {
    const calls: [string, unknown][] = []
    const parsed = await fetchOwnerAnalytics(DEFAULT_OWNER_FILTERS, async (name, body) => {
      calls.push([name, body])
      return zeros as never
    }, '2025-09-02')
    expect(calls[0][0]).toBe('owner_analytics')
    expect(parsed.traffic.visitors).toBe(0)
  })
})

describe('คำปฏิเสธของฐานข้อมูลต้องไม่ถูกเล่าเป็นเรื่องอื่น', () => {
  it('403 = บัญชีนี้ไม่ใช่เจ้าของ · 401 = ยังไม่ได้เข้าสู่ระบบ', () => {
    expect(ownerFailure(new SupabaseRestError('unauthorized', 'x', 403))).toBe('denied')
    expect(ownerFailure(new SupabaseRestError('unauthorized', 'x', 401))).toBe('signed-out')
    expect(ownerFailure(new SupabaseRestError('auth-required', 'x'))).toBe('signed-out')
    expect(ownerFailure(new SupabaseRestError('not-configured', 'x'))).toBe('not-configured')
    expect(ownerFailure(new SupabaseRestError('network', 'x'))).toBe('failed')
    expect(ownerFailure(new Error('boom'))).toBe('failed')
  })
})
