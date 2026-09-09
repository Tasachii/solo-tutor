import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildScenario } from '../../src/core/scenarios'
import type { AppState } from '../../src/core/types'

/**
 * หน้า LINE OA หลังเข้าสู่ระบบ — อ่านครั้งเดียวต้องรู้ว่าทำอะไรก่อนหลัง
 *
 * ที่ต้องกันไม่ให้หาย:
 * - ฟอร์ม secret/token พับเมื่อเชื่อมแล้ว แต่ห้ามพับทันทีหลังเพิ่งกดเชื่อม
 *   ครูต้องเห็นว่าช่องถูกล้างจริง (e2e line-oa.spec ตรวจค่าในช่องหลังกดเชื่อม)
 * - แถวผู้ปกครองใช้ปุ่มเดียวกับการ์ดในแอดมิน และปุ่ม "สร้างรหัสเชื่อม" เดิมยังอยู่
 */
const providerId = '11111111-1111-4111-8111-111111111111'
const workspaceId = '22222222-2222-4222-8222-222222222222'
const recipientId = '33333333-3333-4333-8333-333333333333'

const api = vi.hoisted(() => ({
  session: null as { user: { id: string; email?: string } } | null,
  readChannel: vi.fn(),
  deliveryTarget: vi.fn(),
  syncClients: vi.fn(),
  eraseClients: vi.fn(),
  rpc: vi.fn(),
  invoke: vi.fn(),
  copyText: vi.fn(),
}))

vi.mock('../../src/integrations/supabaseRest', async original => ({
  ...await original<typeof import('../../src/integrations/supabaseRest')>(),
  getSession: () => api.session,
  getSupabaseConfig: () => ({ url: 'https://qa.supabase.co', publishableKey: 'sb_publishable_qa' }),
  rpc: (...a: unknown[]) => api.rpc(...a), invoke: (...a: unknown[]) => api.invoke(...a),
}))
vi.mock('../../src/integrations/lineApi', async original => ({
  ...await original<typeof import('../../src/integrations/lineApi')>(),
  readChannel: (...a: unknown[]) => api.readChannel(...a),
  deliveryTarget: (...a: unknown[]) => api.deliveryTarget(...a),
  syncClients: (...a: unknown[]) => api.syncClients(...a),
  eraseClients: (...a: unknown[]) => api.eraseClients(...a),
}))
vi.mock('../../src/app/share', () => ({ copyText: (...a: unknown[]) => api.copyText(...a), openLine: vi.fn() }))
vi.mock('../../src/app/CloudSync', () => ({
  useCloudSync: () => ({ refreshSession: vi.fn(), signOutDevice: vi.fn(() => true) }),
}))

let state: AppState
vi.mock('../../src/core/store', async original => ({
  ...await original<typeof import('../../src/core/store')>(),
  useStore: () => ({ state, dispatch: () => true, track: () => undefined, hydrated: true }),
}))

import LineSettings from '../../src/app/LineSettings'
import { __resetLineLinkCache } from '../../src/app/useLineLink'
import { lineLinkCopy } from '../../src/app/lineLinkCopy'

const channel = (status = 'active') => ({
  status, display_name: 'OA ของครู QA', basic_id: '@solotutorqa',
  quota_used: 2, quota_limit: 300, quota_month: '2026-09', last_verified_at: null,
})
const show = () => render(<MemoryRouter><LineSettings /></MemoryRouter>)

beforeEach(() => {
  for (const mock of [api.readChannel, api.deliveryTarget, api.syncClients, api.eraseClients, api.rpc, api.invoke, api.copyText]) mock.mockReset()
  api.session = { user: { id: providerId, email: 'teacher@example.com' } }
  api.readChannel.mockResolvedValue(channel())
  api.deliveryTarget.mockResolvedValue({ recipient_id: null, unfollowed_at: null, eligible: false })
  api.syncClients.mockImplementation(async (_ws: string, clients: { id: string }[]) =>
    clients.map(c => ({ local_client_key: c.id, client_id: `remote-${c.id}` })))
  api.rpc.mockResolvedValue([{ code: '123456', expires_at: '2026-09-10T00:00:00Z' }])
  api.invoke.mockResolvedValue({ ok: true, displayName: 'OA ของครู QA' })
  api.copyText.mockResolvedValue(true)
  state = {
    ...buildScenario('default'), mode: 'real',
    provider: { name: 'ครู QA', promptpayId: '0812345678' },
    lineWorkspaceId: workspaceId, lineProviderId: providerId,
  }
  __resetLineLinkCache()
})
afterEach(cleanup)

describe('หน้า LINE OA หลังเข้าสู่ระบบ', () => {
  it('บนสุดมีสถานะช่องและลำดับ 3 ขั้น ครูใหม่รู้ว่าต้องทำอะไรก่อน', async () => {
    show()
    await waitFor(() => expect(screen.getByText(/เชื่อมต่อแล้ว/)).toBeTruthy())
    for (const step of lineLinkCopy.steps) expect(screen.getByText(step)).toBeTruthy()
  })

  it('ยังไม่รู้สถานะช่อง: ยังไม่วางทั้งฟอร์มและปุ่มเปิดฟอร์ม — ที่วาง secret/token ต้องไม่ขยับใต้เมาส์', () => {
    api.readChannel.mockReturnValue(new Promise(() => undefined))
    show()
    expect(screen.queryByLabelText('Channel secret')).toBeNull()
    expect(screen.queryByRole('button', { name: lineLinkCopy.reveal })).toBeNull()
    expect(screen.getAllByText(/กำลังตรวจสถานะบัญชี OA/).length).toBeGreaterThan(0)
  })

  it('เปิดหน้านี้ = ตรวจใหม่ทุกครั้ง ไม่ใช่ใช้ค่าที่แคชไว้ตอนอยู่หน้าแอดมิน', async () => {
    const first = show()
    await waitFor(() => expect(api.deliveryTarget).toHaveBeenCalled())
    const before = api.deliveryTarget.mock.calls.length
    first.unmount()

    // ระหว่างที่ครูไปทำอย่างอื่น ผู้ปกครองพิมพ์รหัสแล้ว — เปิดหน้านี้ต้องเห็นของใหม่ ไม่ใช่ของค้าง
    api.deliveryTarget.mockResolvedValue({ recipient_id: recipientId, unfollowed_at: null, eligible: true })
    show()

    await waitFor(() => expect(screen.getAllByText('เชื่อมแล้ว').length).toBeGreaterThan(0))
    expect(api.deliveryTarget.mock.calls.length).toBeGreaterThan(before)
  })

  it('เชื่อมแล้ว: ฟอร์มสิทธิ์พับไว้ กดเปิดแล้วค่อยกรอกได้', async () => {
    show()
    await waitFor(() => expect(screen.getByRole('button', { name: lineLinkCopy.reveal })).toBeTruthy())
    expect(screen.queryByLabelText('Channel secret')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: lineLinkCopy.reveal }))

    expect(screen.getByLabelText('Channel secret')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'อัปเดตสิทธิ์บัญชี OA' })).toBeTruthy()
  })

  it('ยังไม่เชื่อม: ฟอร์มเปิดอยู่ และหลังกดเชื่อมยังเห็นฟอร์มที่ถูกล้างค่าแล้ว', async () => {
    api.readChannel.mockResolvedValue(null)
    show()
    await waitFor(() => expect(screen.getByText('ยังไม่ได้เชื่อมบัญชี')).toBeTruthy())
    expect(screen.getByRole('heading', { name: 'ตั้งค่าบัญชี OA' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Channel secret'), { target: { value: 'qa-secret' } })
    fireEvent.change(screen.getByLabelText('Channel access token'), { target: { value: 'qa-token' } })
    api.readChannel.mockResolvedValue(channel())
    fireEvent.click(screen.getByRole('button', { name: 'เชื่อมบัญชี OA' }))

    await waitFor(() => expect(screen.getByText(/เชื่อมต่อแล้ว/)).toBeTruthy())
    // ช่องต้องยังอยู่บนจอและว่างเปล่า ไม่ใช่หายไปพร้อมกับฟอร์ม
    expect((screen.getByLabelText('Channel secret') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Channel access token') as HTMLInputElement).value).toBe('')
  })

  it('แถวผู้ปกครองที่ยังไม่ผูก: มีปุ่มเชิญปุ่มเดียว (ไม่มี "สร้างรหัสเชื่อม" ซ้ำ) · กดเชิญแล้วได้รหัสกับข้อความ', async () => {
    show()
    await waitFor(() => expect(screen.getAllByRole('button', { name: lineLinkCopy.invite }).length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: 'สร้างรหัสเชื่อม' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'สร้างรหัสใหม่' })).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: lineLinkCopy.invite })[0])

    await waitFor(() => expect(screen.getByText('123456')).toBeTruthy())
    expect(String(api.copyText.mock.calls[0][0])).toContain('123456')
    expect(screen.getByRole('button', { name: 'คัดลอกเฉพาะรหัส' })).toBeTruthy()
    // ข้อความเชิญเต็มต้องคัดลอกซ้ำได้จากรหัสที่มีอยู่ (กรณีผู้ปกครองย้าย LINE แล้วสร้างรหัสใหม่)
    fireEvent.click(screen.getByRole('button', { name: 'คัดลอกข้อความเชิญ' }))
    await waitFor(() => expect(api.copyText.mock.calls.length).toBe(2))
    expect(String(api.copyText.mock.calls[1][0])).toContain('123456')
  })

  it('ผูกแล้ว: ขึ้น "เชื่อมแล้ว" และไม่มีปุ่มเชิญให้กดซ้ำ', async () => {
    api.deliveryTarget.mockResolvedValue({ recipient_id: recipientId, unfollowed_at: null, eligible: true })
    show()
    await waitFor(() => expect(screen.getAllByText('เชื่อมแล้ว').length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: lineLinkCopy.invite })).toBeNull()
    // ผูกแล้วยังต้องออกรหัสใหม่ได้ เผื่อย้ายไป LINE อีกเครื่อง
    expect(screen.getAllByRole('button', { name: 'สร้างรหัสใหม่' }).length).toBeGreaterThan(0)
  })

  it('ผูกแล้วแต่ต้องย้ายเครื่อง: สร้างรหัสใหม่แล้วคัดลอกข้อความเชิญได้ ไม่ต้องพิมพ์เอง และไม่ออกรหัสซ้ำ', async () => {
    api.deliveryTarget.mockResolvedValue({ recipient_id: recipientId, unfollowed_at: null, eligible: true })
    show()
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'สร้างรหัสใหม่' }).length).toBeGreaterThan(0))

    fireEvent.click(screen.getAllByRole('button', { name: 'สร้างรหัสใหม่' })[0])
    await waitFor(() => expect(screen.getByText('123456')).toBeTruthy())
    const issued = api.rpc.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: lineLinkCopy.copyInvite }))

    await waitFor(() => expect(api.copyText).toHaveBeenCalled())
    const copied = String(api.copyText.mock.calls[0][0])
    expect(copied).toContain('123456')
    expect(copied).toContain('https://line.me/R/ti/p/%40solotutorqa')
    // คัดลอกข้อความเดิม ไม่ใช่เผารหัสใหม่ทิ้งทุกครั้งที่กด
    expect(api.rpc.mock.calls.length).toBe(issued)
    expect(screen.getByRole('button', { name: 'คัดลอกเฉพาะรหัส' })).toBeTruthy()
  })

  /** เปิดหน้าเสร็จ = คำขอชุดเปิดหน้าจบแล้ว ปุ่มตรวจสถานะกลับมากดได้ */
  const settled = async () => {
    await waitFor(() => expect(api.deliveryTarget).toHaveBeenCalled())
    await waitFor(() => expect((screen.getByRole('button', { name: 'ตรวจสถานะอีกครั้ง' }) as HTMLButtonElement).disabled).toBe(false))
  }

  /**
   * เปิดหน้านี้เคยยิง `line_delivery_target` ซ้ำจนถึงสามเท่าของจำนวนผู้จ่าย แล้วโยนคำตอบทิ้งเกือบหมด
   * - เข้าจากหน้าแอดมิน (แคชอุ่นแล้ว) = สองชุด: effect ของ hook ยิงชุดแรก แล้ว `refresh()` ของหน้านี้ยกทิ้งแล้วยิงใหม่
   * - เปิดตรงมาที่ URL นี้ (แคชเย็น) = สามชุด: `claimOwner` ของ effect รอบแรกเลื่อน generation ซึ่งเป็น dep
   *   effect จึงรันอีกรอบ เห็น pending ว่างเพราะเพิ่งถูกยก แล้วยิงชุดของตัวเองเพิ่มมาอีกชุด
   * เทสนี้เริ่มจากแคชเย็น (`__resetLineLinkCache`) จึงเป็นเส้นสามชุด
   * ครูที่มีผู้ปกครองยี่สิบคนจ่ายค่านั้นบนเน็ตงานประชุม
   */
  it('เปิดหน้านี้: ถามสถานะผู้จ่ายคนละครั้งเดียว และคำตอบชุดนั้นขึ้นจอจริง', async () => {
    api.deliveryTarget.mockResolvedValue({ recipient_id: recipientId, unfollowed_at: null, eligible: true })
    show()
    await settled()

    // ขึ้นจอครบทุกแถว = คำตอบที่ "เกาะไปด้วย" ถูกใช้จริง ไม่ใช่แค่ยิงน้อยลงแล้วค้างที่ยังไม่รู้
    expect(screen.getAllByText('เชื่อมแล้ว').length).toBe(state.clients.length)
    expect(api.deliveryTarget).toHaveBeenCalledTimes(state.clients.length)
    expect(new Set(api.deliveryTarget.mock.calls.map(call => call[1])).size).toBe(state.clients.length)
  })

  /** สิ่งที่ห้ามเสียไปพร้อมกับการตัดคำขอซ้ำ: ผู้ปกครองเพิ่งพิมพ์รหัส ครูกดตรวจแล้วต้องได้ค่าใหม่ */
  it('กด "ตรวจสถานะอีกครั้ง": ถามใหม่จริงทุกคน ไม่ใช่ตอบจากค่าที่แคชไว้', async () => {
    show()
    await settled()
    const afterOpen = api.deliveryTarget.mock.calls.length
    expect(screen.getAllByText('ยังไม่เชื่อม').length).toBe(state.clients.length)

    // ผู้ปกครองพิมพ์รหัสระหว่างที่ครูเปิดหน้านี้ค้างไว้ — ค่าที่แคชไว้ตอบผิดแล้ว
    api.deliveryTarget.mockResolvedValue({ recipient_id: recipientId, unfollowed_at: null, eligible: true })
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจสถานะอีกครั้ง' }))

    await waitFor(() => expect(screen.getAllByText('เชื่อมแล้ว').length).toBe(state.clients.length))
    expect(api.deliveryTarget.mock.calls.length).toBe(afterOpen + state.clients.length)
  })

  it('ผู้จ่ายที่ครูลบไปแล้วถูกล้างออกจากเซิร์ฟเวอร์ตอนเปิดหน้านี้', async () => {
    const gone = state.clients[0].id
    state = {
      ...state,
      clients: state.clients.slice(1),
      subjects: state.subjects.filter(subject => subject.clientId !== gone),
      deletedClients: [{ id: gone, at: '2026-09-08' }],
    }
    show()
    await waitFor(() => expect(api.eraseClients).toHaveBeenCalledWith(workspaceId, [gone]))
  })
})
