import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CAMPAIGNS, CLIENT_EVENTS, QA_PARAM, ROUTE_CATEGORIES, SERVER_EVENTS, SESSION_IDLE_MS, USAGE_VERSION,
  adoptAudience, adoptCampaign, anonymousTeacherId, currentAudience, currentSessionId, postUsage,
  resetUsageKeys, routeCategory, sendUsage, usagePayload,
} from '../../src/core/usage'

const configure = () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://project-ref.supabase.co')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_browser_test')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); localStorage.clear(); resetUsageKeys() })

const bodyOf = (send: ReturnType<typeof vi.fn>, call = 0) =>
  JSON.parse(String((send.mock.calls[call][1] as RequestInit).body))

/**
 * รายการช่องที่ตกลงกันไว้ — เขียนด้วยมือโดยตั้งใจ ห้ามดึงจากโค้ดที่กำลังทดสอบ
 * ถ้าอ่านรายการจากตัว payload เอง การเพิ่มช่องใหม่จะผ่านเทสเงียบ ๆ ซึ่งเป็นสิ่งเดียวที่เทสนี้มีไว้กัน
 * เพิ่มหรือลบช่องที่นี่ = ต้องไปแก้แถวตัวนับการใช้งานใน docs/data-inventory.md ให้ตรงกันด้วย
 */
const AGREED_FIELDS = ['audience', 'campaign', 'count', 'event', 'event_id', 'mode', 'route',
  'session_id', 'teacher_id', 'v'] as const

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * ค่าที่แต่ละช่องมีได้จริง — คำในรายการที่ตกลงไว้ ตัวเลข หรือ id สุ่มเท่านั้น
 * ไม่มีช่องไหนรับข้อความอิสระ ช่องที่เริ่มพาข้อความที่ผู้ใช้พิมพ์เองจึงตกเทสนี้ทันที
 */
const agreedValue = (key: string, value: unknown): boolean => {
  if (value === null) return true
  switch (key) {
    case 'v': case 'count': return typeof value === 'number' && Number.isFinite(value)
    case 'event': return (CLIENT_EVENTS as readonly string[]).includes(String(value))
    case 'route': return (ROUTE_CATEGORIES as readonly string[]).includes(String(value))
    case 'audience': return value === 'public' || value === 'team'
    case 'mode': return value === 'demo' || value === 'real'
    case 'campaign': return value === 'unknown' || (CAMPAIGNS as readonly string[]).includes(String(value))
    case 'event_id': case 'teacher_id': case 'session_id': return UUID_SHAPE.test(String(value))
    default: return false
  }
}

/** ตัวนับต้องไม่มีทางพาข้อมูลนักเรียนออกไป — ตรึงรูปร่าง payload ไว้ */
describe('ตัวนับการใช้งาน', () => {
  it('teacher_id สุ่มครั้งเดียวแล้วคงที่ในเครื่องเดิม', () => {
    const a = anonymousTeacherId(); const b = anonymousTeacherId()
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    localStorage.clear()
    expect(anonymousTeacherId()).not.toBe(a)
  })

  it('payload มีแค่ช่องที่ตกลงไว้ ไม่มีชื่อ อีเมล เบอร์ ยอดเงิน URL หรือ query', () => {
    const p = usagePayload('invoice_issued', 3,
      { mode: 'real', route: 'app', audience: 'public', campaign: 'qr' })!
    // ช่องใหม่ที่ไม่มีใครตกลงด้วยต้องทำให้เทสนี้ล้ม ไม่ใช่ไหลออกไปเงียบ ๆ
    expect(Object.keys(p).sort()).toEqual([...AGREED_FIELDS])
    // และช่องเดิมที่เริ่มพาข้อความอิสระออกไปก็ต้องล้มเช่นกัน
    for (const [key, value] of Object.entries(p)) {
      expect(agreedValue(key, value), `ช่อง ${key} ส่งค่าที่ไม่ได้ตกลงไว้: ${JSON.stringify(value)}`).toBe(true)
    }
    expect(p.v).toBe(USAGE_VERSION)
    expect(p.count).toBe(3)
    expect(JSON.stringify(p)).not.toMatch(/น้อง|ครู|บาท|@|\?|#|[0-9]{3},[0-9]{3}/)
  })

  it('ช่องที่เพิ่มเข้ามาเองในภายหลังต้องตกเทสรูปร่าง payload', () => {
    const p = usagePayload('app_open', 1, { mode: 'real', route: 'app' })!
    const smuggled = { ...p, note: 'ผู้ปกครองน้องเอ 0812345678' }
    expect(Object.keys(smuggled).sort()).not.toEqual([...AGREED_FIELDS])
    expect(agreedValue('note', smuggled.note)).toBe(false)
  })

  it('ไม่มีลิงก์แคมเปญ = ไม่มีแหล่งที่มาใน payload ไม่ใช่เดาว่ามาจากไหน', () => {
    expect(usagePayload('landing_view', 1, { route: 'landing' })!.campaign).toBeNull()
    adoptCampaign('?c=line')
    expect(usagePayload('pricing_view', 1, { route: 'pricing' })!.campaign).toBe('line')
  })

  it('count ติดลบ ทศนิยม หรือไม่ใช่ตัวเลข ถูกทำให้เป็นจำนวนเต็มไม่ติดลบที่มีเพดาน', () => {
    expect(usagePayload('students_changed', -2)!.count).toBe(0)
    expect(usagePayload('students_changed', 4.7)!.count).toBe(4)
    expect(usagePayload('students_changed', Number.NaN)!.count).toBe(0)
    expect(usagePayload('students_changed', 999_999)!.count).toBe(10_000)
  })

  it('ส่งไปที่ /functions/v1/usage ของโปรเจกต์เดียวกัน', () => {
    configure()
    const send = vi.fn().mockResolvedValue(new Response('{}'))
    expect(sendUsage('payment_recorded', 1, { mode: 'real', send })).toBe(true)
    const [url] = send.mock.calls[0]
    expect(url).toBe('https://project-ref.supabase.co/functions/v1/usage')
    expect(bodyOf(send).event).toBe('payment_recorded')
  })

  it('ไม่มีโปรเจกต์ = ไม่ส่ง และไม่โยน error', () => {
    vi.stubEnv('VITE_SUPABASE_URL', ''); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    const send = vi.fn()
    expect(sendUsage('app_open', 1, { mode: 'demo', send })).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('เครือข่ายล่มหรือถูกบล็อก ตัวนับกลืนเองไม่โยนต่อให้ผู้เรียก', () => {
    configure()
    const rejected = vi.fn().mockRejectedValue(new Error('blocked by client'))
    expect(() => sendUsage('invoice_issued', 1, { mode: 'real', send: rejected })).not.toThrow()
    const thrower = vi.fn(() => { throw new Error('offline') })
    expect(sendUsage('invoice_issued', 1, { mode: 'real', send: thrower as unknown as typeof fetch })).toBe(false)
  })
})

describe('ตัวนับการใช้งาน — ชื่อเหตุการณ์', () => {
  it('เบราว์เซอร์ส่งได้เฉพาะชื่อ client และไม่ทับกับชื่อที่เซิร์ฟเวอร์เขียนเอง', () => {
    expect([...CLIENT_EVENTS]).toEqual([
      'landing_view', 'pricing_view', 'demo_started', 'demo_completed', 'signup_started',
      'onboarding_completed', 'app_open', 'students_changed', 'invoice_issued', 'payment_recorded',
    ])
    expect([...SERVER_EVENTS]).toEqual(['signup_completed', 'email_verified'])
    for (const name of SERVER_EVENTS) expect(CLIENT_EVENTS).not.toContain(name)
  })
})

describe('ตัวนับการใช้งาน — หมวดหน้า', () => {
  it('ส่งชื่อหมวด ไม่ใช่ path จริงและไม่ใช่ query/hash', () => {
    expect(routeCategory('/')).toBe('landing')
    expect(routeCategory('/pricing')).toBe('pricing')
    expect(routeCategory('/pricing/')).toBe('pricing')
    expect(routeCategory('#/pricing?plan=3')).toBe('pricing')
    expect(routeCategory('/privacy')).toBe('legal')
    expect(routeCategory('/terms')).toBe('legal')
    expect(routeCategory('/start')).toBe('start')
    expect(routeCategory('/login')).toBe('login')
    expect(routeCategory('/app/billing')).toBe('app')
    expect(routeCategory('/somewhere-else')).toBe('other')
    for (const category of ROUTE_CATEGORIES) expect(typeof category).toBe('string')
  })

  it('หน้าเอกสารและลิงก์ของผู้ปกครองไม่มีหมวด แปลว่าไม่ส่งอะไรเลย', () => {
    expect(routeCategory('/document/8f3a-secret-token')).toBeNull()
    expect(routeCategory('/receipt/rc-1')).toBeNull()
    expect(routeCategory('/client/client-1')).toBeNull()
  })
})

describe('ตัวนับการใช้งาน — session และ visitor', () => {
  it('กิจกรรมต่อเนื่องอยู่ session เดิม ขาดไป 30 นาทีเริ่ม session ใหม่ แต่ visitor คนเดิม', () => {
    const start = Date.UTC(2026, 8, 8, 3, 0, 0)
    const visitor = anonymousTeacherId()
    const first = currentSessionId(start)
    expect(currentSessionId(start + 29 * 60_000)).toBe(first)
    const later = currentSessionId(start + 29 * 60_000 + SESSION_IDLE_MS + 1)
    expect(later).not.toBe(first)
    expect(anonymousTeacherId()).toBe(visitor)
  })

  it('นาฬิกาเครื่องถอยหลังนับเป็น session ใหม่ ไม่ใช่ยืด session เดิมไปเรื่อย', () => {
    const start = Date.UTC(2026, 8, 8, 3, 0, 0)
    const first = currentSessionId(start)
    expect(currentSessionId(start - 60_000)).not.toBe(first)
  })

  it('ค่าที่เสียหายในเครื่องไม่ทำให้พัง — ออก session ใหม่แทน', () => {
    localStorage.setItem('solo-usage-session', 'ไม่ใช่ JSON')
    expect(currentSessionId(Date.now())).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('ตัวนับการใช้งาน — แกนทีม/QA แยกจากแกน Demo/จริง', () => {
  it('?qa=1 ทำให้ทราฟฟิกของทีมอยู่คนละแกน และ ?qa=0 คืนค่าเป็นผู้เยี่ยมชมปกติ', () => {
    adoptAudience(`?${QA_PARAM}=1`)
    expect(currentAudience()).toBe('team')
    expect(usagePayload('landing_view', 1, { route: 'landing' })!.audience).toBe('team')
    adoptAudience(`?${QA_PARAM}=0`)
    expect(currentAudience()).toBe('public')
    // ผู้ที่ลอง Demo ยังเป็นผู้เยี่ยมชมจริง แค่คนละโหมด ไม่ใช่ทีม
    expect(usagePayload('demo_started', 1, { mode: 'demo', route: 'start' })!.audience).toBe('public')
  })

  it('query ที่ไม่มี ?qa= ไม่เปลี่ยนค่าที่จำไว้', () => {
    adoptAudience(`?${QA_PARAM}=1`)
    adoptAudience('?plan=3')
    expect(currentAudience()).toBe('team')
  })
})

describe('ตัวนับการใช้งาน — กันนับซ้ำ', () => {
  it('กุญแจเดิมยิงซ้ำไม่ส่งอีก', () => {
    configure()
    const send = vi.fn().mockResolvedValue(new Response('{}'))
    expect(sendUsage('landing_view', 1, { route: 'landing', key: 'view:abc:landing', send })).toBe(true)
    expect(sendUsage('landing_view', 1, { route: 'landing', key: 'view:abc:landing', send })).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('กุญแจคนละค่าได้ event_id คนละค่า แต่ retry payload เดิมใช้ event_id เดิม', () => {
    configure()
    const send = vi.fn().mockResolvedValue(new Response('{}'))
    const first = usagePayload('landing_view', 1, { route: 'landing', key: 'view:one:landing' })!
    const second = usagePayload('landing_view', 1, { route: 'landing', key: 'view:two:landing' })!
    expect(first.event_id).not.toBe(second.event_id)
    expect(postUsage(first, send)).toBe(true)
    expect(postUsage(first, send)).toBe(true)
    expect(bodyOf(send, 0).event_id).toBe(bodyOf(send, 1).event_id)
  })

  it('ไม่มีกุญแจ = เหตุการณ์คนละครั้ง ได้ event_id ใหม่ทุกครั้ง', () => {
    const a = usagePayload('invoice_issued', 1, { mode: 'real' })!
    const b = usagePayload('invoice_issued', 1, { mode: 'real' })!
    expect(a.event_id).not.toBe(b.event_id)
  })
})
