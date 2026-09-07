import { afterEach, describe, expect, it, vi } from 'vitest'
import { anonymousTeacherId, sendUsage, usagePayload } from '../../src/core/usage'

const configure = () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://project-ref.supabase.co')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_browser_test')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); localStorage.clear() })

/** ตัวนับต้องไม่มีทางพาข้อมูลนักเรียนออกไป — ตรึงรูปร่าง payload ไว้ */
describe('ตัวนับการใช้งาน', () => {
  it('teacher_id สุ่มครั้งเดียวแล้วคงที่ในเครื่องเดิม', () => {
    const a = anonymousTeacherId(); const b = anonymousTeacherId()
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    localStorage.clear()
    expect(anonymousTeacherId()).not.toBe(a)
  })

  it('payload มีแค่ teacher_id · event · count · time (· mode) ไม่มีอย่างอื่น', () => {
    const p = usagePayload('invoice_issued', 3, 'real', new Date('2026-09-08T10:00:00+07:00'))
    expect(Object.keys(p).sort()).toEqual(['count', 'event', 'mode', 'teacher_id', 'time'])
    expect(p.count).toBe(3)
    expect(p.time).toBe('2026-09-08T03:00:00.000Z')
    expect(JSON.stringify(p)).not.toMatch(/น้อง|ครู|บาท|[0-9]{3},[0-9]{3}/)
  })

  it('count ติดลบหรือทศนิยมถูกทำให้เป็นจำนวนเต็มไม่ติดลบ', () => {
    expect(usagePayload('students_changed', -2).count).toBe(0)
    expect(usagePayload('students_changed', 4.7).count).toBe(4)
  })

  it('ส่งไปที่ /functions/v1/usage ของโปรเจกต์เดียวกัน', () => {
    configure()
    const send = vi.fn().mockResolvedValue(new Response('{}'))
    expect(sendUsage('payment_recorded', 1, 'real', send as unknown as typeof fetch)).toBe(true)
    const [url, init] = send.mock.calls[0]
    expect(url).toBe('https://project-ref.supabase.co/functions/v1/usage')
    expect(JSON.parse((init as RequestInit).body as string).event).toBe('payment_recorded')
  })

  it('ไม่มีโปรเจกต์ = ไม่ส่ง และไม่โยน error', () => {
    vi.stubEnv('VITE_SUPABASE_URL', ''); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    const send = vi.fn()
    expect(sendUsage('app_open', 1, 'demo', send as unknown as typeof fetch)).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})
