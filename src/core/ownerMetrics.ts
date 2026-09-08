import { addDays, todayISO } from './format'
import { rpc, SupabaseRestError } from '../integrations/supabaseRest'
import { CAMPAIGNS } from './usage'

/**
 * P09 · ตัวเลขของแดชบอร์ดเจ้าของ — โมดูลนี้ "อ่าน" อย่างเดียว ไม่คำนวณตัวเลขเอง
 *
 * ทุกตัวเลขมาจาก public.owner_analytics ซึ่งตรวจสิทธิ์ที่ฐานข้อมูล การซ่อนเมนูฝั่งเบราว์เซอร์
 * ไม่ใช่การจำกัดสิทธิ์ ไฟล์นี้จึงไม่มีการเช็คสิทธิ์ของตัวเอง มีแต่การแปลคำตอบและคำปฏิเสธ
 *
 * ค่าที่อ่านไม่ได้จะเป็น null ไม่ใช่ 0 — "เซิร์ฟเวอร์ตอบว่าศูนย์" กับ "เราไม่ได้ตัวเลขมา"
 * ต้องดูต่างกันบนหน้าจอ ไม่งั้นแดชบอร์ดจะแต่งเลขให้ผู้อ่านโดยไม่มีใครรู้
 */

export type MetricValue = number | null

export interface OwnerFilters {
  /** ความยาวช่วงเป็นวัน นับถึงวันนี้ */
  days: number
  audience: 'public' | 'team' | 'all'
  mode: 'all' | 'demo' | 'real'
  /** 'all' = ไม่กรอง · 'none' = แถวที่ไม่มี ?c= เลย */
  campaign: string
}

export const OWNER_RANGES = [7, 30, 90] as const
/** ตัวเลือกตัวกรองแหล่งที่มา — เรียงตามรายการที่ตกลงไว้ แล้วต่อด้วยสองค่าที่ไม่ได้มาจากลิงก์ */
export const CAMPAIGN_FILTERS = ['all', ...CAMPAIGNS, 'unknown', 'none'] as const

export const DEFAULT_OWNER_FILTERS: OwnerFilters = {
  days: 30, audience: 'public', mode: 'all', campaign: 'all',
}

export interface CampaignRow {
  source: string
  visitors: MetricValue
  sessions: MetricValue
  pageviews: MetricValue
  signupStarted: MetricValue
}

export interface RenewalRow {
  cohortMonth: string
  firstMonthPayers: MetricValue
  renewedMonth2: MetricValue
  percent: MetricValue
}

export interface OwnerAnalytics {
  generatedAt: string | null
  from: string | null
  to: string | null
  traffic: { visitors: MetricValue; sessions: MetricValue; landingViews: MetricValue; pricingViews: MetricValue }
  demo: { started: MetricValue; completed: MetricValue }
  accounts: {
    signupStarted: MetricValue; signupCompleted: MetricValue
    emailVerified: MetricValue; onboardingCompleted: MetricValue
  }
  teachers: { openedApp: MetricValue; activated: MetricValue; returning: MetricValue }
  campaigns: CampaignRow[]
  money: {
    pendingRequests: MetricValue; proRequested: MetricValue; payingCustomers: MetricValue
    verifiedPayments: MetricValue; grossBaht: MetricValue; refundBaht: MetricValue; netBaht: MetricValue
  }
  renewal: RenewalRow[]
}

/** ผลลัพธ์ที่หน้าเว็บต้องแยกให้ออก — คำปฏิเสธไม่ใช่ความผิดพลาด และไม่ใช่ "ยังไม่มีข้อมูล" */
export type OwnerFailure = 'not-configured' | 'signed-out' | 'denied' | 'failed'

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** ตัวเลขที่ใช้ได้เท่านั้น — ข้อความ null หรือค่าที่หายไป คืน null ให้หน้าเว็บบอกว่าไม่มีข้อมูล */
const num = (value: unknown): MetricValue =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(record) : []

export function parseOwnerAnalytics(raw: unknown): OwnerAnalytics {
  const root = record(raw)
  const filters = record(root.filters)
  const traffic = record(root.traffic)
  const demo = record(root.demo)
  const accounts = record(root.accounts)
  const teachers = record(root.teachers)
  const money = record(root.money)
  return {
    generatedAt: text(root.generated_at),
    from: text(filters.from),
    to: text(filters.to),
    traffic: {
      visitors: num(traffic.visitors), sessions: num(traffic.sessions),
      landingViews: num(traffic.landing_views), pricingViews: num(traffic.pricing_views),
    },
    demo: { started: num(demo.started), completed: num(demo.completed) },
    accounts: {
      signupStarted: num(accounts.signup_started), signupCompleted: num(accounts.signup_completed),
      emailVerified: num(accounts.email_verified), onboardingCompleted: num(accounts.onboarding_completed),
    },
    teachers: {
      openedApp: num(teachers.opened_app), activated: num(teachers.activated),
      returning: num(teachers.returning),
    },
    campaigns: rows(root.campaigns).map((row) => ({
      source: text(row.source) ?? 'none',
      visitors: num(row.visitors), sessions: num(row.sessions),
      pageviews: num(row.pageviews), signupStarted: num(row.signup_started),
    })),
    money: {
      pendingRequests: num(money.pending_requests), proRequested: num(money.pro_requested),
      payingCustomers: num(money.paying_customers), verifiedPayments: num(money.verified_payments),
      grossBaht: num(money.gross_baht), refundBaht: num(money.refund_baht), netBaht: num(money.net_baht),
    },
    renewal: rows(root.renewal).map((row) => ({
      cohortMonth: text(row.cohort_month) ?? '',
      firstMonthPayers: num(row.first_month_payers), renewedMonth2: num(row.renewed_month_2),
      percent: num(row.percent),
    })),
  }
}

/** ช่วงเวลาเป็นวันไทยของเครื่องครู — เซิร์ฟเวอร์ตัดวันด้วย Asia/Bangkok เหมือนกัน */
export function ownerRange(days: number, today: string = todayISO()): { from: string; to: string } {
  const span = Number.isFinite(days) && days > 0 ? Math.floor(days) : 30
  return { from: addDays(today, -(span - 1)), to: today }
}

export function ownerRequest(filters: OwnerFilters, today: string = todayISO()): Record<string, unknown> {
  const { from, to } = ownerRange(filters.days, today)
  return {
    p_from: from,
    p_to: to,
    p_audience: filters.audience === 'all' ? null : filters.audience,
    p_mode: filters.mode === 'all' ? null : filters.mode,
    p_campaign: filters.campaign === 'all' ? null : filters.campaign,
  }
}

/**
 * แปลความล้มเหลวให้ตรงกับสิ่งที่เกิดขึ้นจริง
 * 403 = ฐานข้อมูลปฏิเสธเพราะบัญชีนี้ไม่ใช่เจ้าของ ไม่ใช่ session หมดอายุ — ข้อความต้องต่างกัน
 */
export function ownerFailure(error: unknown): OwnerFailure {
  if (error instanceof SupabaseRestError) {
    if (error.code === 'not-configured') return 'not-configured'
    if (error.status === 403) return 'denied'
    if (error.code === 'auth-required' || error.code === 'storage-unavailable' || error.status === 401) return 'signed-out'
  }
  return 'failed'
}

export async function fetchOwnerAnalytics(
  filters: OwnerFilters,
  call: typeof rpc = rpc,
  today: string = todayISO(),
): Promise<OwnerAnalytics> {
  return parseOwnerAnalytics(await call<unknown>('owner_analytics', ownerRequest(filters, today)))
}
