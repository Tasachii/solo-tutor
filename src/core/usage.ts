import { getSession, getSupabaseConfig } from '../integrations/supabaseRest'

/**
 * ตัวนับการใช้งานสำหรับทีม — ส่งแค่ 4 เหตุการณ์ ไม่มีชื่อเด็ก ชื่อครู หรือยอดเงิน
 * teacher_id เป็น uuid ของเครื่อง; เมื่อเข้าสู่ระบบส่ง bearer ให้เซิร์ฟเวอร์ผูกบัญชีที่ตรวจแล้ว
 * ไม่ส่ง provider_id จาก client เพราะใช้เป็นหลักฐานยืนยันเจ้าของไม่ได้
 */
export type UsageEvent = 'app_open' | 'students_changed' | 'invoice_issued' | 'payment_recorded'
export interface UsagePayload { teacher_id: string; event: UsageEvent; count: number; time: string; mode?: 'demo' | 'real' }

const KEY = 'solo-usage-id'

export function anonymousTeacherId(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): string {
  try {
    const saved = storage.getItem(KEY)
    if (saved && /^[0-9a-f-]{36}$/i.test(saved)) return saved
    const fresh = crypto.randomUUID()
    storage.setItem(KEY, fresh)
    return fresh
  } catch {
    // โหมดส่วนตัวเขียนไม่ได้ — ใช้ id ชั่วคราว นับซ้ำได้บ้าง ดีกว่าไม่นับ
    return crypto.randomUUID()
  }
}

/** ประกอบ payload — ฟังก์ชันนี้คือกำแพงกันข้อมูลรั่ว: รับแค่ตัวเลขกับชื่อเหตุการณ์ */
export function usagePayload(event: UsageEvent, count: number, mode?: 'demo' | 'real', now: Date = new Date()): UsagePayload {
  return { teacher_id: anonymousTeacherId(), event, count: Math.max(0, Math.floor(count)), time: now.toISOString(), mode }
}

/** ยิงแบบไม่รอผล ไม่โยน error — ตัวนับห้ามทำให้แอปสะดุด · ไม่มีโปรเจกต์ = ไม่ส่ง */
export function sendUsage(event: UsageEvent, count: number, mode?: 'demo' | 'real', send: typeof fetch = fetch): boolean {
  const config = getSupabaseConfig()
  if (!config) return false
  try {
    const session = mode === 'real' ? getSession() : null
    const token = session && session.expires_at > Math.floor(Date.now() / 1000) ? session.access_token : null
    void send(`${config.url}/functions/v1/usage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(usagePayload(event, count, mode)), keepalive: true, signal: AbortSignal.timeout(5000),
    }).catch(() => undefined)
    return true
  } catch {
    return false
  }
}
