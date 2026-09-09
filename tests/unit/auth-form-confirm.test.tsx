import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AuthForm } from '../../src/app/components/AuthForm'

/**
 * รหัสผ่านตอนสมัครคือกุญแจถอดสมุดบัญชีบนคลาวด์ด้วย — พิมพ์ผิดครั้งเดียวคือล็อกตัวเองออกจากข้อมูล
 * ฟอร์มสมัครจึงต้องให้พิมพ์สองครั้งและปฏิเสธถ้าไม่ตรง ก่อนจะยิงอะไรไปเซิร์ฟเวอร์
 */
const mocks = vi.hoisted(() => ({ signUp: vi.fn(), signIn: vi.fn(), remember: vi.fn() }))
vi.mock('../../src/integrations/supabaseRest', async original => ({
  ...await original<typeof import('../../src/integrations/supabaseRest')>(),
  signUp: mocks.signUp, signIn: mocks.signIn,
}))
vi.mock('../../src/core/cloudKey', () => ({ rememberKeyFromPassword: mocks.remember }))

beforeEach(() => Object.values(mocks).forEach(m => m.mockReset()))
afterEach(cleanup)

const session = { user: { id: 'u1', email: 'kru@example.com' } }
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('ยืนยันรหัสผ่านตอนสมัคร', () => {
  it('สองช่องไม่ตรงกัน → บอกตรง ๆ และไม่ยิงสมัครไปเซิร์ฟเวอร์เลย', async () => {
    render(<AuthForm onSession={vi.fn()} initialMode="signup" />)
    type('อีเมล', 'kru@example.com')
    type('รหัสผ่าน', 'first-password')
    type('ยืนยันรหัสผ่าน', 'second-password')
    fireEvent.submit(document.querySelector('form')!)
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('ไม่ตรงกัน'))
    expect(mocks.signUp).not.toHaveBeenCalled()
    expect(mocks.remember).not.toHaveBeenCalled()
    // ช่องยืนยันถูกล้างให้พิมพ์ใหม่ ส่วนช่องแรกยังอยู่ ไม่ต้องพิมพ์ทั้งหมดซ้ำ
    expect((screen.getByLabelText('ยืนยันรหัสผ่าน') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('รหัสผ่าน') as HTMLInputElement).value).toBe('first-password')
  })

  it('สองช่องตรงกัน → สมัครด้วยรหัสนั้นครั้งเดียว', async () => {
    mocks.signUp.mockResolvedValue(session); mocks.remember.mockResolvedValue(undefined)
    const onSession = vi.fn()
    render(<AuthForm onSession={onSession} initialMode="signup" />)
    type('อีเมล', 'kru@example.com')
    type('รหัสผ่าน', 'same-password')
    type('ยืนยันรหัสผ่าน', 'same-password')
    fireEvent.submit(document.querySelector('form')!)
    await waitFor(() => expect(onSession).toHaveBeenCalledWith(session))
    expect(mocks.signUp).toHaveBeenCalledTimes(1)
    expect(mocks.signUp).toHaveBeenCalledWith('kru@example.com', 'same-password')
  })

  it('เข้าสู่ระบบไม่มีช่องยืนยัน — ครูเดิมไม่ต้องพิมพ์สองครั้ง', () => {
    render(<AuthForm onSession={vi.fn()} initialMode="signin" />)
    expect(screen.queryByLabelText('ยืนยันรหัสผ่าน')).toBeNull()
  })

  it('สลับโหมดแล้วช่องรหัสทั้งสองถูกล้าง ไม่ค้างค่าจากโหมดก่อน', () => {
    render(<AuthForm onSession={vi.fn()} initialMode="signup" />)
    type('รหัสผ่าน', 'abcdef'); type('ยืนยันรหัสผ่าน', 'abcdef')
    fireEvent.click(screen.getByRole('button', { name: 'มีบัญชีอยู่แล้ว เข้าสู่ระบบ' }))
    expect((screen.getByLabelText('รหัสผ่าน') as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'ยังไม่มีบัญชี สมัครใช้งาน' }))
    expect((screen.getByLabelText('ยืนยันรหัสผ่าน') as HTMLInputElement).value).toBe('')
  })
})
