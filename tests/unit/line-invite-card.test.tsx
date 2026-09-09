import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildScenario } from '../../src/core/scenarios'
import { deriveDrafts } from '../../src/core/messages'
import type { AppState } from '../../src/core/types'
import { ToastProvider } from '../../src/app/components/Toast'

/**
 * ปุ่ม "เชิญผู้ปกครองเข้า LINE" บนการ์ดข้อความในแท็บรอส่ง
 *
 * กับดัก J-44: ปุ่มเชิญต้องเป็นพี่น้องที่ต่อ*ท้าย* ห้ามครอบหรือขยับ LineMessageAction
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
import { __resetLineLinkCache } from '../../src/app/useLineLink'
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

describe('ปุ่มเชิญผู้ปกครองบนการ์ดข้อความ', () => {
  it('เข้าสู่ระบบ + ช่อง OA พร้อม + ผู้ปกครองยังไม่ผูก → ขึ้นปุ่มเชิญ', async () => {
    show()
    await waitFor(() => expect(screen.getAllByRole('button', { name: lineLinkCopy.invite }).length).toBeGreaterThan(0))
  })

  it('ผู้ปกครองผูกแล้ว → ไม่มีปุ่มเชิญ (ปุ่มส่งใน LINE จะไปทาง OA ให้เอง)', async () => {
    api.deliveryTarget.mockResolvedValue(target(true))
    show()
    await waitFor(() => expect(api.deliveryTarget).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('button', { name: lineLinkCopy.invite })).toBeNull())
  })

  it('ยังไม่ได้เชื่อมช่อง OA → เป็นทางไปหน้าตั้งค่า ไม่ใช่ปุ่มเชิญที่กดแล้วไม่เกิดอะไร', async () => {
    api.readChannel.mockResolvedValue(null)
    show()
    await waitFor(() => expect(screen.getAllByRole('link', { name: lineLinkCopy.setup }).length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: lineLinkCopy.invite })).toBeNull()
  })

  it('ยังไม่เข้าสู่ระบบ → ชวนไปหน้าตั้งค่า และปุ่มส่งเดิมยังอยู่ครบ', async () => {
    api.session = null
    show()
    await waitFor(() => expect(screen.getAllByRole('link', { name: lineLinkCopy.inviteSignedOut }).length).toBeGreaterThan(0))
    expect(api.readChannel).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: 'ส่งใน LINE' }).length).toBeGreaterThan(0)
  })

  it('ระหว่างที่ยังไม่รู้สถานะ ไม่ขึ้นปุ่มอะไรเพิ่ม (จอไม่กระโดดไปสถานะที่ผิด)', () => {
    api.readChannel.mockReturnValue(new Promise(() => undefined))
    api.deliveryTarget.mockReturnValue(new Promise(() => undefined))
    show()
    expect(screen.queryByRole('button', { name: lineLinkCopy.invite })).toBeNull()
    expect(screen.queryByRole('link', { name: lineLinkCopy.setup })).toBeNull()
  })

  /** กดเชิญบนการ์ดใบแรก แล้วคืนการ์ดใบนั้น — การ์ดใบอื่นเป็นของผู้จ่ายคนอื่น สถานะจึงไม่เปลี่ยนตาม */
  const inviteFirst = async (): Promise<HTMLElement> => {
    show()
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

    await waitFor(() => expect(api.deliveryTarget.mock.calls.length).toBeGreaterThan(1))
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

  it('ปุ่มเชิญเป็นพี่น้องที่ต่อท้าย ไม่ครอบและไม่ขยับปุ่มส่งใน LINE (J-44)', async () => {
    show()
    await waitFor(() => expect(screen.getAllByRole('button', { name: lineLinkCopy.invite }).length).toBeGreaterThan(0))

    const send = screen.getAllByRole('button', { name: 'ส่งใน LINE' })[0]
    const invite = screen.getAllByRole('button', { name: lineLinkCopy.invite })[0]
    const card = send.closest('li.msg')!
    expect(invite.closest('li.msg')).toBe(card)
    // ปุ่มส่งยังอยู่ใน .btnrow ใบแรกของการ์ดเหมือนเดิม และปุ่มเชิญอยู่คนละกล่องที่มาทีหลัง
    const rows = [...card.querySelectorAll(':scope > .btnrow')]
    expect(rows[0].contains(send)).toBe(true)
    expect(rows[0].contains(invite)).toBe(false)
    expect(invite.closest('.btnrow')!.compareDocumentPosition(rows[0]) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })
})
