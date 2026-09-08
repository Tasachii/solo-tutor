import { getSession, getSupabaseConfig } from '../integrations/supabaseRest'

/**
 * ตัวนับการใช้งานสำหรับทีม — ส่งได้แค่ชื่อเหตุการณ์ที่อนุญาต หมวดหน้า จำนวน และ id สุ่มในเครื่อง
 * ห้ามมีชื่อเด็ก ชื่อผู้จ่าย อีเมล เบอร์โทร ข้อความบิล URL เต็ม query/hash หรือ token เอกสาร
 * teacher_id/session_id เป็น pseudonymous ไม่ใช่ anonymous — ต้องมี notice และ retention ตามนโยบาย
 * เมื่ออยู่โหมดจริงส่ง bearer ให้เซิร์ฟเวอร์ผูกบัญชีที่ตรวจแล้ว ไม่ส่ง provider_id จาก client
 */
export const USAGE_VERSION = 2

/** เหตุการณ์ที่เบราว์เซอร์ส่งได้ — ทุกชื่อต้องอยู่ใน 0012_usage_events_v2.sql ด้วย */
export const CLIENT_EVENTS = [
  // acquisition ของหน้าสาธารณะ
  'landing_view', 'pricing_view',
  // funnel ของคนลอง Demo
  'demo_started', 'demo_completed',
  // funnel ของคนสมัคร (ฝั่ง client บอกได้แค่ "เริ่มสมัคร")
  'signup_started',
  // ครูตั้งค่าเสร็จ
  'onboarding_completed',
  // การใช้งานจริงในแอป
  'app_open', 'students_changed', 'invoice_issued', 'payment_recorded',
] as const
export type UsageEvent = (typeof CLIENT_EVENTS)[number]

/**
 * เหตุการณ์ที่เซิร์ฟเวอร์เท่านั้นเขียนได้ — เบราว์เซอร์อ้างเองไม่ได้
 * signup_completed/email_verified มาจากสถานะจริงใน Auth (supabase/functions/usage)
 * pro_requested/subscription_payment_verified/refund_verified ไม่เก็บเป็น event เลย
 * เพราะอ่านจากตารางการเงินฝั่งเซิร์ฟเวอร์ได้ตรงกว่า (public.plan_funnel_monthly)
 */
export const SERVER_EVENTS = ['signup_completed', 'email_verified'] as const
export type ServerUsageEvent = (typeof SERVER_EVENTS)[number]

/** หมวดหน้าที่อนุญาต — ส่งชื่อหมวด ไม่ใช่ path จริงและไม่ใช่ query/hash */
export const ROUTE_CATEGORIES = ['landing', 'pricing', 'legal', 'start', 'login', 'app', 'other'] as const
export type RouteCategory = (typeof ROUTE_CATEGORIES)[number]

export type Audience = 'public' | 'team'
export type UsageMode = 'demo' | 'real'

export interface UsagePayload {
  v: number
  event_id: string
  teacher_id: string
  session_id: string
  event: UsageEvent
  count: number
  route: RouteCategory | null
  audience: Audience
  mode: UsageMode | null
}

/**
 * null = หน้าที่ห้ามมี analytics ใด ๆ
 * ผู้ปกครองที่เปิดบิลหรือใบเสร็จไม่ใช่ผู้เยี่ยมชมเว็บของเรา และ token อยู่ใน path
 */
export function routeCategory(path: string): RouteCategory | null {
  const withoutQuery = path.split('?')[0]
  const raw = withoutQuery.startsWith('#') ? withoutQuery.slice(1) : withoutQuery
  const p = raw.replace(/\/+$/, '') || '/'
  if (/^\/(document|receipt|client)(\/|$)/.test(p)) return null
  if (p === '/') return 'landing'
  if (p === '/pricing') return 'pricing'
  if (p === '/privacy' || p === '/terms') return 'legal'
  if (p === '/start') return 'start'
  if (p === '/login') return 'login'
  if (p === '/app' || p.startsWith('/app/')) return 'app'
  return 'other'
}

const VISITOR_KEY = 'solo-usage-id'
const SESSION_KEY = 'solo-usage-session'
const AUDIENCE_KEY = 'solo-usage-audience'

/** นิยามผลิตภัณฑ์: ขาดกิจกรรม 30 นาทีถือว่าเริ่ม session ใหม่ */
export const SESSION_IDLE_MS = 30 * 60 * 1000
/** ?qa=1 ทำให้ทราฟฟิกของทีมอยู่คนละแกน ไม่ใช่ตัด Demo ของผู้สนใจทิ้ง · ?qa=0 คืนค่าเป็นผู้เยี่ยมชมปกติ */
export const QA_PARAM = 'qa'

type Store = Pick<Storage, 'getItem' | 'setItem'>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** visitor = browser ID โดยประมาณ ไม่ใช่จำนวนคน — ล้างข้อมูลหรือเปลี่ยนเครื่องแล้วนับใหม่ */
export function anonymousTeacherId(storage: Store = localStorage): string {
  try {
    const saved = storage.getItem(VISITOR_KEY)
    if (saved && UUID.test(saved)) return saved
    const fresh = crypto.randomUUID()
    storage.setItem(VISITOR_KEY, fresh)
    return fresh
  } catch {
    // โหมดส่วนตัวเขียนไม่ได้ — ใช้ id ชั่วคราว นับซ้ำได้บ้าง ดีกว่าไม่นับ
    return crypto.randomUUID()
  }
}

export function currentSessionId(now: number = Date.now(), storage: Store = localStorage): string {
  const fresh = (): string => {
    const id = crypto.randomUUID()
    try { storage.setItem(SESSION_KEY, JSON.stringify({ id, at: now })) } catch { /* จำไม่ได้ = นับเป็น session ใหม่ */ }
    return id
  }
  try {
    const raw = storage.getItem(SESSION_KEY)
    if (!raw) return fresh()
    const saved = JSON.parse(raw) as { id?: unknown; at?: unknown }
    if (typeof saved.id !== 'string' || !UUID.test(saved.id)) return fresh()
    if (typeof saved.at !== 'number' || !Number.isFinite(saved.at)) return fresh()
    if (now < saved.at || now - saved.at > SESSION_IDLE_MS) return fresh()
    storage.setItem(SESSION_KEY, JSON.stringify({ id: saved.id, at: now }))
    return saved.id
  } catch {
    return fresh()
  }
}

/** อ่าน ?qa= จาก query แล้วจำไว้ — เก็บแค่ค่าที่อนุญาต ไม่เก็บ query string */
export function adoptAudience(search: string, storage: Store = localStorage): void {
  let flag: string | null = null
  try { flag = new URLSearchParams(search).get(QA_PARAM) } catch { return }
  if (flag !== '1' && flag !== '0') return
  try { storage.setItem(AUDIENCE_KEY, flag === '1' ? 'team' : 'public') } catch { /* จำไม่ได้ก็ใช้การตรวจอัตโนมัติต่อ */ }
}

/** เครื่องที่รันอัตโนมัติหรือเครื่องนักพัฒนา = ทีม จนกว่าจะบอกเป็นอย่างอื่นด้วย ?qa=0 */
function automated(): boolean {
  try {
    if (navigator.webdriver) return true
    const host = location.hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.local')
  } catch {
    return false
  }
}

export function currentAudience(storage: Store = localStorage): Audience {
  try {
    const saved = storage.getItem(AUDIENCE_KEY)
    if (saved === 'team' || saved === 'public') return saved
  } catch { /* อ่านไม่ได้ — ใช้การตรวจอัตโนมัติ */ }
  return automated() ? 'team' : 'public'
}

/**
 * กุญแจของเหตุการณ์เชิงตรรกะ → event_id หนึ่งค่า
 * เรียกซ้ำด้วยกุญแจเดิมแปลว่าส่งไปแล้ว: re-render ที่ไม่เปลี่ยนหน้าและ effect ที่รันสองรอบจึงไม่เพิ่ม pageview
 * คิวจำกัดขนาด ไม่มี heartbeat — ตัวนับห้ามกินทรัพยากรของเครื่องครู
 */
const MAX_TRACKED_KEYS = 50
const issued = new Map<string, string>()

export function usageEventId(key?: string): string | null {
  if (key === undefined) return crypto.randomUUID()
  if (issued.has(key)) return null
  const id = crypto.randomUUID()
  issued.set(key, id)
  if (issued.size > MAX_TRACKED_KEYS) {
    const oldest = issued.keys().next()
    if (!oldest.done) issued.delete(oldest.value)
  }
  return id
}

/** เฉพาะเทส — ล้างกุญแจที่ยิงไปแล้วของโมดูลนี้ */
export function resetUsageKeys(): void { issued.clear() }

export interface UsageOptions {
  mode?: UsageMode
  route?: RouteCategory
  audience?: Audience
  /** กุญแจของเหตุการณ์เชิงตรรกะ — ยิงซ้ำด้วยกุญแจเดิมจะไม่ส่งอีก */
  key?: string
  now?: Date
  send?: typeof fetch
}

/** ประกอบ payload — ฟังก์ชันนี้คือกำแพงกันข้อมูลรั่ว: รับแค่ตัวเลขกับชื่อที่อยู่ในรายการ */
export function usagePayload(event: UsageEvent, count: number, options: UsageOptions = {}): UsagePayload | null {
  const eventId = usageEventId(options.key)
  if (!eventId) return null
  const at = options.now ?? new Date()
  const safeCount = Number.isFinite(count) ? Math.min(10_000, Math.max(0, Math.floor(count))) : 0
  return {
    v: USAGE_VERSION,
    event_id: eventId,
    teacher_id: anonymousTeacherId(),
    session_id: currentSessionId(at.getTime()),
    event,
    count: safeCount,
    route: options.route ?? null,
    audience: options.audience ?? currentAudience(),
    mode: options.mode ?? null,
  }
}

/**
 * ส่ง payload เดิมอีกครั้ง — event_id เท่าเดิม เซิร์ฟเวอร์จึงไม่นับซ้ำ
 * ยิงแบบไม่รอผล ไม่โยน error: ตัวนับห้ามทำให้บันทึกคาบหรือรับเงินสะดุด
 */
export function postUsage(payload: UsagePayload, send: typeof fetch = fetch): boolean {
  const config = getSupabaseConfig()
  if (!config) return false
  try {
    const session = payload.mode === 'real' ? getSession() : null
    const token = session && session.expires_at > Math.floor(Date.now() / 1000) ? session.access_token : null
    void send(`${config.url}/functions/v1/usage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload), keepalive: true, signal: AbortSignal.timeout(5000),
    }).catch(() => undefined)
    return true
  } catch {
    return false
  }
}

/** ไม่มีโปรเจกต์ = ไม่ส่ง · กุญแจซ้ำ = ไม่ส่ง · ที่เหลือยิงแล้วลืม */
export function sendUsage(event: UsageEvent, count: number, options: UsageOptions = {}): boolean {
  const config = getSupabaseConfig()
  if (!config) return false
  const payload = usagePayload(event, count, options)
  if (!payload) return false
  return postUsage(payload, options.send)
}
