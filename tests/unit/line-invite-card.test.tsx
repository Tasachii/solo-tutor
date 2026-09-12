import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildScenario } from '../../src/core/scenarios'
import { deriveDrafts } from '../../src/core/messages'
import type { AppState } from '../../src/core/types'
import { ToastProvider } from '../../src/app/components/Toast'

/**
 * การ์ดข้อความในแท็บรอส่ง: ไม่มีปุ่มเชิญแล้ว (เจ้าของ 13 ก.ย. 04:43 "เชิญผู้ปกครองเข้ากลุ่มไม่เอา")
 * บอกแค่ "ยังไม่ได้แอด LINE OA" เฉพาะคนที่ยังไม่ผูก และหัวแท็บบอกว่าครูเชื่อม OA แล้วหรือยัง
 * ปุ่มเชิญตัวจริงยังอยู่ที่หน้านักเรียน/หน้าตั้งค่า — ทดสอบพฤติกรรมปุ่มโดย render ตรง ๆ ด้านล่าง
 *
 * กับดัก J-44: สิ่งที่ต่อท้ายการ์ดต้องเป็นพี่น้องที่ต่อ*ท้าย* ห้ามครอบหรือขยับ LineMessageAction
 * ถ้าย้าย React จะ mount ปุ่มส่งใหม่ แล้วข้อความแจ้งผลที่เพิ่งตั้งไว้หายทันที
 */
const providerId = '11111111-1111-4111-8111-111111111111'
const workspaceId = '22222222-2222-4222-8222-222222222222'
const recipientId = '33333333-3333-4333-8333-333333333333'

const api = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  config: null as object | null,
  readChannel: vi.fn(),
  deliveryTarget: vi.fn(),
  syncClients: vi.fn(),
  rpc: vi.fn(),
  copyText: vi.fn(),
}))

vi.mock('../../src/integrations/supabaseRest', async original => ({
  ...await original<typeof import('../../src/integrations/supabaseRest')>(),
  getSession: () => api.session, getSupabaseConfig: () => api.config,
  rpc: (...a: unknown[]) => api.rpc(...a), invoke: vi.fn(),
}))
vi.mock('../../src/integrations/lineApi', async original => ({
  ...await original<typeof import('../../src/integrations/lineApi')>(),
  readChannel: (...a: unknown[]) => api.readChannel(...a),
  deliveryTarget: (...a: unknown[]) => api.deliveryTarget(...a),
  findDelivery: vi.fn(async () => null),
  syncClients: (...a: unknown[]) => api.syncClients(...a),
  eraseClients: vi.fn(),
}))
vi.mock('../../src/app/share', async original => ({
  ...await original<typeof import('../../src/app/share')>(),
  copyText: (...a: unknown[]) => api.copyText(...a),
}))

let state: AppState
vi.mock('../../src/core/store', async original => ({
  ...await original<typeof import('../../src/core/store')>(),
  useStore: () => ({ state, dispatch: () => true, track: () => undefined, hydrated: true }),
}))

import Admin from '../../src/app/Admin'
import { LineInviteAction, __resetLineLinkCache } from '../../src/app/useLineLink'
import { lineLinkCopy } from '../../src/app/lineLinkCopy'

const channel = (status = 'active') => ({
  status, display_name: 'OA ของครู QA', basic_id: '@solotutorqa',
  quota_used: 2, quota_limit: 300, quota_month: '2026-09', last_verified_at: null,
})
const target = (linked: boolean) => ({
  recipient_id: linked ? recipientId : null, unfollowed_at: null, eligible: linked,
})

const show = () => render(
  <MemoryRouter initialEntries={['/app/admin?tab=drafts']}><ToastProvider><Admin /></ToastProvider></MemoryRouter>,
)
/** ปุ่มเชิญตัวจริง (หน้านักเรียน/ตั้งค่า) — ห่อด้วย li.msg ให้เทสเดิมที่หา card ทำงานเหมือนเดิม */
const showButton = () => render(
  <MemoryRouter><ToastProvider><ul><li className="msg"><div className="btnrow"><button>ส่งใน LINE</button></div><LineInviteAction clientId="c2" /></li></ul></ToastProvider></MemoryRouter>,
)

beforeEach(() => {
  api.readChannel.mockReset().mockResolvedValue(channel())
  api.deliveryTarget.mockReset().mockResolvedValue(target(false))
  api.syncClients.mockReset().mockImplementation(async (_ws: string, clients: { id: string }[]) =>
    clients.map(c => ({ local_client_key: c.id, client_id: `remote-${c.id}` })))
  api.rpc.mockReset().mockResolvedValue([{ code: '123456', expires_at: '2026-09-10T00:00:00Z' }])
  api.copyText.mockReset().mockResolvedValue(true)
  api.session = { user: { id: providerId } }
  api.config = { url: 'https://qa.supabase.co', publishableKey: 'sb_publishable_qa' }
  const base = buildScenario('default')
  state = {
    ...base, mode: 'real', messages: deriveDrafts(base),
    provider: { name: 'ครู QA', promptpayId: '0812345678' },
    lineWorkspaceId: workspaceId, lineProviderId: providerId,
  }
  __resetLineLinkCache()
})
afterEach(cleanup)

describe('สถานะ LINE OA บนการ์ดข้อความและหัวแท็บแอดมิน', () => {
  it('เข้าสู่ระบบ + ช่อง OA พร้อม + ผู้ปกครองยังไม่ผูก → บอก "ยังไม่ได้แอด LINE OA" ไม่มีปุ่มเชิญ และหัวแท็บบอกว่าเชื่อม OA แล้ว', async () => {
    show()
    await waitFor(() => expect(screen.getAllByTestId('line-unlinked').length).toBeGreaterThan(0))
    expect(screen.getAllByTestId('line-unlinked')[0].textContent).toBe(lineLinkCopy.unlinkedParent)
    expect(screen.queryByRole('button', { name: lineLinkCopy.invite })).toBeNull()
    expect(screen.getByTestId('oa-status').textContent).toContain(lineLinkCopy.linked)
    expect(screen.getByTestId('oa-status').textContent).toContain('OA ของครู QA')
  })

  it('ผู้ปกครองผูกแล้ว → ไม่ขึ้นอะไรบนการ์ด (ปุ่มส่งใน LINE จะไปทาง OA ให้เอง)', async () => {
    api.deliveryTarget.mockResolvedValue(target(true))
    show()
    await waitFor(() => expect(api.deliveryTarget).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('oa-status')).toBeTruthy())
    expect(screen.queryAllByTestId('line-unlinked')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: lineLinkCopy.invite })).toBeNull()
  })

  it('ยังไม่ได้เชื่อมช่อง OA → หัวแท็บเป็นทางไปหน้าตั้งค่า การ์ดไม่พูดซ้ำ', async () => {
    api.readChannel.mockResolvedValue(null)
    show()
    await waitFor(() => expect(screen.getByRole('link', { name: lineLinkCopy.oaSetup })).toBeTruthy())
    expect(screen.queryAllByTestId('line-unlinked')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: lineLinkCopy.invite })).toBeNull()
  })

  it('ยังไม่เข้าสู่ระบบ → หัวแท็บชวนเข้าสู่ระบบ การ์ดเงียบ และปุ่มส่งเดิมยังอยู่ครบ', async () => {
    api.session = null
    show()
    expect(screen.getByRole('link', { name: lineLinkCopy.oaSignIn })).toBeTruthy()
    expect(api.readChannel).not.toHaveBeenCalled()
    expect(screen.queryAllByTestId('line-unlinked')).toHaveLength(0)
    expect(screen.getAllByRole('button', { name: 'ส่งใน LINE' }).length).toBeGreaterThan(0)
  })

  it('ระหว่างที่ยังไม่รู้สถานะ ไม่ขึ้นอะไรเพิ่ม (จอไม่กระโดดไปสถานะที่ผิด)', () => {
    api.readChannel.mockReturnValue(new Promise(() => undefined))
    api.deliveryTarget.mockReturnValue(new Promise(() => undefined))
    show()
    expect(screen.queryAllByTestId('line-unlinked')).toHaveLength(0)
    expect(screen.queryByTestId('oa-status')).toBeNull()
  })

  it('สถานะต่อท้ายการ์ด ไม่ครอบและไม่ขยับปุ่มส่งใน LINE (J-44)', async () => {
    show()
    await waitFor(() => expect(screen.getAllByTestId('line-unlinked').length).toBeGreaterThan(0))
    const send = screen.getAllByRole('button', { name: 'ส่งใน LINE' })[0]
    const card = send.closest('li.msg')!
    const tag = within(card as HTMLElement).getByTestId('line-unlinked')
    const rows = [...card.querySelectorAll(':scope > .btnrow')]
    expect(rows[0].contains(send)).toBe(true)
    expect(rows[0].contains(tag)).toBe(false)
    expect(tag.compareDocumentPosition(rows[0]) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })
})

describe('ปุ่มเชิญผู้ปกครอง (หน้านักเรียน / หน้าตั้งค่า)', () => {
  it('เข้าสู่ระบบ + ช่อง OA พร้อม + ผู้ปกครองยังไม่ผูก → ขึ้นปุ่มเชิญ', async () => {
    showButton()
    await waitFor(() => expect(screen.getAllByRole('button', { name: lineLinkCopy.invite }).length).toBeGreaterThan(0))
  })

  it('ยังไม่ได้เชื่อมช่อง OA → เป็นทางไปหน้าตั้งค่า ไม่ใช่ปุ่มเชิญที่กดแล้วไม่เกิดอะไร', async () => {
    api.readChannel.mockResolvedValue(null)
    showButton()
    await waitFor(() => expect(screen.getByRole('link', { name: lineLinkCopy.setup })).toBeTruthy())
    expect(screen.queryByRole('button', { name: lineLinkCopy.invite })).toBeNull()
  })

  it('ยังไม่เข้าสู่ระบบ → ชวนไปหน้าตั้งค่า', () => {
    api.session = null
    showButton()
    expect(screen.getByRole('link', { name: lineLinkCopy.inviteSignedOut })).toBeTruthy()
    expect(api.readChannel).not.toHaveBeenCalled()
  })

  /** กดเชิญบนการ์ดใบแรก แล้วคืนการ์ดใบนั้น — การ์ดใบอื่นเป็นของผู้จ่ายคนอื่น สถานะจึงไม่เปลี่ยนตาม */
  const inviteFirst = async (): Promise<HTMLElement> => {
    showButton()
    await waitFor(() => expect(screen.getAllByRole('button', { name: lineLinkCopy.invite }).length).toBeGreaterThan(0))
    const button = screen.getAllByRole('button', { name: lineLinkCopy.invite })[0]
    const card = button.closest('li.msg') as HTMLElement
    fireEvent.click(button)
    await waitFor(() => expect(within(card).getByText(/คัดลอกข้อความเชิญแล้ว/)).toBeTruthy())
    return card
  }

  it('กดเชิญแล้วขึ้นข้อความบอกขั้นถัดไป และปุ่มต้องไม่หายใต้นิ้วตอนกดตรวจสถานะ', async () => {
    const card = await inviteFirst()
    expect(String(api.copyText.mock.calls[0][0])).toContain('123456')

    // คำตอบรอบใหม่ยังไม่กลับมา — ปุ่มที่ครูเพิ่งกดต้องยังอยู่ที่เดิม
    api.readChannel.mockReturnValue(new Promise(() => undefined))
    api.deliveryTarget.mockReturnValue(new Promise(() => undefined))
    fireEvent.click(within(card).getByRole('button', { name: lineLinkCopy.check }))

    // ระหว่างรอ (คำขอค้างไม่มีวันกลับ) ปุ่มทั้งสองต้องยังอยู่ ไม่ใช่หายแล้วค่อยโผล่
    await new Promise(r => setTimeout(r, 60))
    expect(within(card).getByRole('button', { name: lineLinkCopy.check })).toBeTruthy()
    expect(within(card).getByRole('button', { name: lineLinkCopy.invite })).toBeTruthy()
  })

  it('ตรวจแล้วผู้ปกครองยังไม่พิมพ์รหัส → บอกว่ายังไม่มีอะไรเปลี่ยน ไม่ใช่เงียบ', async () => {
    const card = await inviteFirst()
    fireEvent.click(within(card).getByRole('button', { name: lineLinkCopy.check }))
    await waitFor(() => expect(within(card).getByText(lineLinkCopy.stillWaiting)).toBeTruthy())
    expect(within(card).getByRole('button', { name: lineLinkCopy.invite })).toBeTruthy()
  })

  it('ตรวจแล้วผูกสำเร็จ → บอกว่าเชื่อมแล้ว ปุ่มเชิญหายเพราะสำเร็จ ไม่ใช่หายเฉย ๆ', async () => {
    const card = await inviteFirst()
    api.deliveryTarget.mockResolvedValue(target(true))
    fireEvent.click(within(card).getByRole('button', { name: lineLinkCopy.check }))

    await waitFor(() => expect(within(card).getByText(lineLinkCopy.linkedNow)).toBeTruthy())
    expect(within(card).queryByRole('button', { name: lineLinkCopy.invite })).toBeNull()
    expect(within(card).queryByRole('button', { name: lineLinkCopy.check })).toBeNull()
  })

})
