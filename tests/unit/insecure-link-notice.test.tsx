import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildScenario } from '../../src/core/scenarios'
import { ToastProvider } from '../../src/app/components/Toast'
import Admin from '../../src/app/Admin'
import { deriveDrafts } from '../../src/core/messages'
import { signIn, signOut } from '../../src/integrations/supabaseRest'
import { copy } from '../../src/copy'

/**
 * ครูต้องไม่มีวันส่งลิงก์ถาวรที่มีชื่อเด็กและยอดเงิน โดยเข้าใจว่าลิงก์นั้นปิดได้
 * เทสนี้มีไว้กันไม่ให้ใครลบคำเตือนทิ้งเพราะคิดว่าเป็นแค่ของประดับ
 *
 * สองสถานการณ์นี้ต่างกัน และห้ามพูดเหมือนกัน:
 * - บิลด์ไม่มีโปรเจกต์เลย = ออกลิงก์ที่ปิดได้ไม่ได้ทั้งเครื่อง จึงส่งลิงก์รุ่นเดิมได้แต่ต้องประกาศข้อจำกัด
 * - มีโปรเจกต์แต่ยังไม่เข้าสู่ระบบ = ออกลิงก์ที่ปิดได้เมื่อเข้าสู่ระบบ การส่งจึงถูกหยุดไว้ก่อน ไม่ลดระดับเงียบ ๆ
 */
const projectUrl = 'https://project-ref.supabase.co'
const userId = '11111111-1111-4111-8111-111111111111'
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

const mocks = vi.hoisted(() => ({ state: null as unknown as ReturnType<typeof buildScenario> }))
vi.mock('../../src/core/store', () => ({
  useStore: () => ({ state: mocks.state, dispatch: () => false, track: () => {}, hydrated: true }),
}))

const configure = () => {
  vi.stubEnv('VITE_SUPABASE_URL', projectUrl)
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_browser_test')
}

const show = () => render(
  <MemoryRouter><ToastProvider><Admin /></ToastProvider></MemoryRouter>,
)

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs(); localStorage.clear(); signOut() })
beforeEach(() => {
  const state = buildScenario('default')
  mocks.state = { ...state, mode: 'real', messages: deriveDrafts(state) }
})

describe('คำเตือนเรื่องลิงก์ที่ปิดไม่ได้', () => {
  it('มีโปรเจกต์แต่ยังไม่เข้าสู่ระบบ — บอกให้เข้าสู่ระบบก่อน ไม่ใช่บอกว่าลิงก์ปิดไม่ได้แล้วปล่อยส่ง', () => {
    configure()
    show()
    expect(screen.getByTestId('signed-out-link-notice').textContent).toContain('เข้าสู่ระบบ')
    expect(screen.queryByTestId('insecure-link-notice')).toBeNull()
  })

  it('ยังไม่ได้ตั้งค่าระบบเชื่อมต่อเลย — ส่งลิงก์รุ่นเดิมได้ แต่ต้องประกาศข้อจำกัด ไม่ใช่เงียบ', () => {
    show()
    expect(screen.getByTestId('insecure-link-notice').textContent).toBe(copy.sharedLinks.insecureNotice)
    expect(screen.queryByTestId('signed-out-link-notice')).toBeNull()
  })

  it('เข้าสู่ระบบแล้ว — คำเตือนหายไป เพราะลิงก์ที่ออกไปปิดได้จริง', async () => {
    configure()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({
      access_token: 'a', refresh_token: 'r', expires_in: 3600,
      user: { id: userId, email: 'teacher@example.com' },
    }))
    await signIn('teacher@example.com', 'password')
    show()
    expect(screen.queryByTestId('insecure-link-notice')).toBeNull()
    expect(screen.queryByTestId('signed-out-link-notice')).toBeNull()
  })

  it('โหมดเดโมไม่ต้องเตือน เพราะไม่ได้ส่งถึงผู้ปกครองจริง', () => {
    configure()
    mocks.state = { ...mocks.state, mode: 'demo' }
    show()
    expect(screen.queryByTestId('insecure-link-notice')).toBeNull()
    expect(screen.queryByTestId('signed-out-link-notice')).toBeNull()
  })

  it('ข้อความเตือนต้องไม่สัญญาว่าลบสำเนาของผู้รับได้', () => {
    expect(copy.sharedLinks.insecureNotice).not.toMatch(/ลบสำเนา|เรียกคืน/)
    expect(copy.sharedLinks.signedOutNotice).not.toMatch(/ลบสำเนา|เรียกคืน/)
    // ทุกข้อความที่หยุดการส่งต้องบอกชัดว่ายังไม่ได้ส่ง ครูจะได้ไม่เดาว่าส่งไปแล้วหรือยัง
    for (const notice of [copy.sharedLinks.publishFailed, copy.sharedLinks.publishSignedOut,
      copy.sharedLinks.publishStale, copy.sharedLinks.publishStoreFailed]) {
      expect(notice).toMatch(/ยังไม่ได้ส่ง/)
    }
  })

  it('ยังไม่เข้าสู่ระบบ — ต้องส่งได้ตามปกติ ไม่ใช่ถูกปิดทาง', async () => {
    // โหมดจริงแบบไม่สมัครบัญชีคือเส้นทางที่แอปรองรับมาตลอด การหยุดส่งคือการถอยหลัง
    const { publishBlocks } = await import('../../src/core/documentPublish')
    expect(publishBlocks('signed-out')).toBe(false)
    expect(publishBlocks('not-configured')).toBe(false)
    expect(publishBlocks('demo')).toBe(false)
    expect(publishBlocks('no-link')).toBe(false)
    // ฐานยังไม่ได้อัปเดต: ลองใหม่กี่ครั้งก็ไม่ผ่าน หยุดส่งเท่ากับส่งบิลไม่ได้เลย
    expect(publishBlocks('unsupported')).toBe(false)
    // ส่วนที่ต้องหยุดจริง คือครูมีสิทธิ์ออกลิงก์ที่ปิดได้อยู่แล้วแต่รอบนี้ไม่สำเร็จ
    expect(publishBlocks('failed')).toBe(true)
    expect(publishBlocks('stale')).toBe(true)
  })

  it('คำเตือนตอนยังไม่เข้าสู่ระบบต้องไม่ทำให้เข้าใจว่าส่งไม่ได้', () => {
    expect(copy.sharedLinks.signedOutNotice).toMatch(/ส่งได้ตามปกติ/)
    expect(copy.sharedLinks.unsupportedNotice).toMatch(/ส่งได้ตามปกติ/)
  })
})
