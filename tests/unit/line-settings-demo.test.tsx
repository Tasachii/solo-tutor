import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildScenario } from '../../src/core/scenarios'
import type { AppState } from '../../src/core/types'

/**
 * หน้า LINE OA ในโหมดเดโม = **หน้าเดียวกับโหมดใช้จริง** (แผน `docs/line-oa-v2-plan.md` §4 ขั้น 6)
 *
 * เวอร์ชันก่อนหน้านี้เป็นคำอธิบายอย่างเดียว (`DemoLineWalkthrough`) เพราะกติกาเดิมคือ
 * "ข้อมูลเดโมห้ามถึงผู้ปกครองจริง" · กติกาใหม่ 9 ก.ย.: OA ขึ้นกับบัญชีครูที่ล็อกอิน + ช่อง OA
 * + ผู้ปกครองที่จับคู่ด้วยรหัสของครูคนนั้น ไม่ขึ้นกับว่าสมุดเป็นเดโมหรือจริง
 *
 * สองข้อที่ห้ามหลุด:
 * - ยังไม่ล็อกอิน = หน้าเดิมเป๊ะสำหรับผู้เข้าชมเว็บสาธารณะ (ฟอร์มเข้าสู่ระบบ ไม่มีอะไรวิ่งออกจากเครื่อง)
 * - ล็อกอินจากหน้านี้ในเดโม ต้องไม่ดึงข้อมูลจากคลาวด์และต้องไม่สลับโหมด
 */
const providerId = '11111111-1111-4111-8111-111111111111'
const workspaceId = '22222222-2222-4222-8222-222222222222'

const mocks = vi.hoisted(() => ({
  session: null as { user: { id: string; email?: string } } | null,
  invoke: vi.fn(), rpc: vi.fn(), readChannel: vi.fn(), deliveryTarget: vi.fn(), syncClients: vi.fn(),
  eraseClients: vi.fn(), dispatch: vi.fn(), refreshSession: vi.fn(), signOutDevice: vi.fn(),
}))

let state: AppState
vi.mock('../../src/core/store', async original => ({
  ...await original<typeof import('../../src/core/store')>(),
  useStore: () => ({ state, dispatch: mocks.dispatch, track: () => undefined, hydrated: true }),
}))
vi.mock('../../src/app/CloudSync', () => ({
  useCloudSync: () => ({ refreshSession: mocks.refreshSession, signOutDevice: mocks.signOutDevice }),
}))
vi.mock('../../src/integrations/supabaseRest', async original => ({
  ...await original<typeof import('../../src/integrations/supabaseRest')>(),
  getSession: () => mocks.session,
  getSupabaseConfig: () => ({ url: 'https://qa.supabase.co', publishableKey: 'sb_publishable_qa' }),
  invoke: mocks.invoke, rpc: mocks.rpc,
}))
/**
 * ฟอร์มเข้าสู่ระบบตัวจริงยิง fetch + คำนวณกุญแจด้วย PBKDF2 — เทสนี้สนใจแค่ว่า
 * "หน้านี้ทำอะไรตอนได้ session มา" จึงแทนด้วยปุ่มที่เรียก `onSession` ตรง ๆ
 */
vi.mock('../../src/app/components/AuthForm', () => ({
  AuthForm: ({ onSession }: { onSession: (s: { user: { id: string; email?: string } }) => void }) =>
    <button onClick={() => { mocks.session = { user: { id: providerId, email: 'teacher@example.com' } }; onSession(mocks.session) }}>เข้าสู่ระบบ (เทส)</button>,
}))
vi.mock('../../src/integrations/lineApi', async original => ({
  ...await original<typeof import('../../src/integrations/lineApi')>(),
  readChannel: mocks.readChannel, deliveryTarget: mocks.deliveryTarget,
  syncClients: mocks.syncClients, eraseClients: mocks.eraseClients,
}))

import LineSettings from '../../src/app/LineSettings'
import { __resetLineLinkCache } from '../../src/app/useLineLink'

const DEMO_WARN = 'สมุดนี้เป็นข้อมูลตัวอย่าง แต่ LINE OA ส่งจริงถึงเครื่องที่คุณจับคู่ด้วยรหัสของคุณเอง'
const show = () => render(<MemoryRouter><LineSettings /></MemoryRouter>)

beforeEach(() => {
  for (const mock of [mocks.invoke, mocks.rpc, mocks.readChannel, mocks.deliveryTarget, mocks.syncClients,
    mocks.eraseClients, mocks.dispatch, mocks.refreshSession, mocks.signOutDevice]) mock.mockReset()
  mocks.session = null
  mocks.dispatch.mockReturnValue(true)
  mocks.readChannel.mockResolvedValue({
    status: 'active', display_name: 'OA ของครู QA', basic_id: '@solotutorqa',
    quota_used: 2, quota_limit: 300, quota_month: '2026-09', last_verified_at: null,
  })
  mocks.deliveryTarget.mockResolvedValue({ recipient_id: null, unfollowed_at: null, eligible: false })
  __resetLineLinkCache()
  state = buildScenario('default')
})
afterEach(cleanup)

describe('หน้า LINE OA ในโหมดเดโม', () => {
  it('ยังไม่เข้าสู่ระบบ — เห็นฟอร์มเข้าสู่ระบบเหมือนโหมดจริง และไม่มีอะไรวิ่งออกจากเครื่อง', () => {
    show()
    expect(screen.getByRole('button', { name: 'เข้าสู่ระบบ (เทส)' })).toBeTruthy()
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.readChannel).not.toHaveBeenCalled()
    expect(mocks.deliveryTarget).not.toHaveBeenCalled()
    expect(mocks.syncClients).not.toHaveBeenCalled()
  })

  it('ไม่มีคำอธิบายแทนของจริงอีกแล้ว — ไม่มีปุ่มจำลอง ไม่มีเลข 6 หลักปลอม ไม่มีทางออกไปโหมดจริง', () => {
    show()
    // เจ้าของเคยคัดลอกเลขตัวอย่าง (482731) ไปพิมพ์ในแชท OA จริงแล้วได้ "รหัสไม่ถูกต้อง" กลับมา
    expect(document.body.textContent).not.toMatch(/\b\d{6}\b/)
    expect(document.body.textContent).not.toContain('จำลอง')
    expect(document.body.textContent).not.toContain('LINE OA เปิดใช้ในโหมดใช้จริง')
    expect(screen.queryByRole('button', { name: 'เริ่มใช้จริง' })).toBeNull()
  })

  it('มีแถบบอกว่าตัวเลขเป็นข้อมูลตัวอย่าง แต่ OA ส่งจริง', () => {
    show()
    expect(screen.getByText(DEMO_WARN)).toBeTruthy()
  })

  it('เข้าสู่ระบบแล้ว — หน้าเดียวกับโหมดจริง: อ่านสถานะช่อง OA และมีปุ่มเชิญผู้ปกครองจริง', async () => {
    mocks.session = { user: { id: providerId, email: 'teacher@example.com' } }
    state = { ...state, lineWorkspaceId: workspaceId, lineProviderId: providerId }
    show()
    await waitFor(() => expect(mocks.readChannel).toHaveBeenCalled())
    expect(screen.getByText('เชื่อมต่อแล้ว — ตรวจ token และ Webhook URL ผ่าน')).toBeTruthy()
    // ปุ่มเดียวกับที่อยู่บนการ์ดข้อความในแอดมิน — ออกรหัสจริงของครูคนที่ล็อกอินอยู่
    const parent = screen.getAllByRole('listitem').find(li => li.textContent?.includes('คุณแม่แพรว'))!
    expect(parent.querySelector('button')?.textContent).toContain('เชิญผู้ปกครองเข้า LINE')
    expect(screen.getByText(DEMO_WARN)).toBeTruthy()
  })

  it('มี workspace แล้ว — บอกว่าการจับคู่ผูกกับรายชื่อของชุดข้อมูลนี้ ไม่ใช่ว่าหายเมื่อสลับชุด', () => {
    mocks.session = { user: { id: providerId, email: 'teacher@example.com' } }
    state = { ...state, lineWorkspaceId: workspaceId, lineProviderId: providerId }
    show()
    const hint = screen.getByText(/การจับคู่ผูกกับรายชื่อของชุดข้อมูลนี้/)
    expect(hint.textContent).toContain('กลับมาชุดนี้แล้วการจับคู่เดิมยังอยู่')
  })

  it('เข้าสู่ระบบจากหน้านี้ในเดโม — บอก CloudSync ให้รู้ แต่หน้านี้ไม่สั่งสลับโหมดหรือทับสมุดตัวอย่าง', async () => {
    // ครูที่กำลังโชว์เดโมต้องไม่ถูกดึงข้อมูลจริงมาทับกลางเวที
    // (`CloudSync` ปิดตัวเองด้วย `state.mode === 'real'` — พิสูจน์ใน cloud-sync-provider.test.tsx)
    show()
    fireEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ (เทส)' }))
    await waitFor(() => expect(mocks.refreshSession).toHaveBeenCalledTimes(1))
    for (const call of mocks.dispatch.mock.calls) {
      expect(['startReal', 'replace', 'restore']).not.toContain((call[0] as { type: string }).type)
    }
  })
})
