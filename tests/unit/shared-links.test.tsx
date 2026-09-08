import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SharedLinks from '../../src/app/SharedLinks'
import { ToastProvider } from '../../src/app/components/Toast'
import { signIn, signOut } from '../../src/integrations/supabaseRest'
import { deriveKey } from '../../src/core/cloudCrypto'
import { rememberKey } from '../../src/core/cloudKey'
import { sealLabel } from '../../src/core/documentShare'
import { copy } from '../../src/copy'

const projectUrl = 'https://project-ref.supabase.co'
const userId = '11111111-1111-4111-8111-111111111111'
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const authBody = { access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { id: userId, email: 't@example.com' } }

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); signOut(); vi.unstubAllEnvs() })

const configure = () => {
  vi.stubEnv('VITE_SUPABASE_URL', projectUrl)
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_browser_test')
}
const login = async () => {
  configure()
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(authBody))
  await signIn('t@example.com', 'password')
  return fetchMock
}
const show = () => render(<ToastProvider><SharedLinks /></ToastProvider>)

const row = (over: Record<string, unknown> = {}) => ({
  token: 'A'.repeat(22), kind: 'invoice', label: null, label_iv: null,
  created_at: '2025-09-01T03:00:00Z', expires_at: '2025-12-01T03:00:00Z', revoked_at: null, ...over,
})

describe('รายการลิงก์ที่ครูแชร์ไว้', () => {
  it('ทุกจอบอกขอบเขตของการปิดลิงก์ตั้งแต่ก่อนกด ไม่ใช่ตอนกดแล้ว', async () => {
    const fetchMock = await login()
    fetchMock.mockResolvedValueOnce(json([]))
    show()
    expect(screen.getByText(copy.sharedLinks.honesty)).toBeTruthy()
    expect(screen.getByText(copy.sharedLinks.expiryNote.replace('{days}', '90'))).toBeTruthy()
    expect(await screen.findByText(copy.sharedLinks.empty)).toBeTruthy()
    // ต้องไม่มีที่ไหนสัญญาว่าลบสำเนาของผู้รับได้
    expect(document.body.textContent).not.toMatch(/ลบสำเนา|ลบข้อความที่ส่งไปแล้ว|เรียกคืนสำเนา/)
  })

  it('ป้ายชื่อถูกถอดรหัสด้วยกุญแจคลาวด์ในเครื่องครู เซิร์ฟเวอร์ส่งมาแต่ ciphertext', async () => {
    const fetchMock = await login()
    const key = await deriveKey('teacher-secret', userId)
    await rememberKey(userId, key)
    const sealed = await sealLabel(key, 'ใบแจ้งยอด · คุณแม่แพรว · น้องภูมิ · 2025-08')
    expect(sealed.cipher).not.toContain('แพรว')
    fetchMock.mockResolvedValueOnce(json([row({ label: sealed.cipher, label_iv: sealed.iv })]))
    show()
    expect(await screen.findByText(/คุณแม่แพรว/)).toBeTruthy()
  })

  it('เครื่องที่ไม่มีกุญแจยังปิดลิงก์ได้ แค่ไม่เห็นป้ายชื่อและคัดลอกลิงก์ไม่ได้', async () => {
    const fetchMock = await login()
    fetchMock.mockResolvedValueOnce(json([row({ label: 'cipher', label_iv: 'iv' })]))
    show()
    expect(await screen.findByRole('button', { name: copy.sharedLinks.revoke })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: copy.sharedLinks.copyLink }))
    expect(await screen.findByText(copy.sharedLinks.noKeyHere)).toBeTruthy()
  })

  it('ปิดลิงก์ต้องยืนยันก่อน ยิงคำสั่งเพิกถอน แล้วแถวนั้นขึ้นว่าปิดแล้ว', async () => {
    const fetchMock = await login()
    fetchMock.mockResolvedValueOnce(json([row()]))
    show()
    fireEvent.click(await screen.findByRole('button', { name: copy.sharedLinks.revoke }))
    expect(screen.getByText(copy.sharedLinks.revokeConfirm)).toBeTruthy()

    fetchMock.mockResolvedValueOnce(json(true))
    fireEvent.click(screen.getByRole('button', { name: copy.common.confirm }))
    await waitFor(() => expect(screen.getByText(copy.sharedLinks.revokedTag)).toBeTruthy())
    const revoke = fetchMock.mock.calls.find(([url]) => String(url).includes('revoke_shared_document'))!
    expect(JSON.parse(String(revoke[1]?.body))).toEqual({ p_token: 'A'.repeat(22) })
    expect(screen.queryByRole('button', { name: copy.sharedLinks.revoke })).toBeNull()
  })

  it('เพิกถอนที่ไม่เปลี่ยนอะไรต้องบอกว่าไม่สำเร็จ ไม่ใช่แสดงว่าปิดแล้ว', async () => {
    const fetchMock = await login()
    fetchMock.mockResolvedValueOnce(json([row()]))
    show()
    fireEvent.click(await screen.findByRole('button', { name: copy.sharedLinks.revoke }))
    fetchMock.mockResolvedValueOnce(json({ message: 'nope' }, 500))
    fireEvent.click(screen.getByRole('button', { name: copy.common.confirm }))
    expect(await screen.findByText(copy.sharedLinks.revokeFailed)).toBeTruthy()
  })

  it('ยังไม่เข้าสู่ระบบหรือยังไม่ได้ตั้งค่าโปรเจกต์ บอกเหตุผลและไม่ยิงคำขอ', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    show()
    expect(await screen.findByText(copy.sharedLinks.unavailable)).toBeTruthy()
    cleanup()
    configure()
    show()
    expect(await screen.findByText(copy.sharedLinks.signedOut)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('โหลดรายการไม่สำเร็จมีปุ่มลองใหม่ที่ยิงคำขออีกครั้ง', async () => {
    const fetchMock = await login()
    fetchMock.mockResolvedValueOnce(json({ message: 'boom' }, 500))
    show()
    const reload = await screen.findByRole('button', { name: copy.sharedLinks.reload })
    fetchMock.mockResolvedValueOnce(json([row()]))
    fireEvent.click(reload)
    await waitFor(() => expect(screen.getByRole('button', { name: copy.sharedLinks.revoke })).toBeTruthy())
  })
})
