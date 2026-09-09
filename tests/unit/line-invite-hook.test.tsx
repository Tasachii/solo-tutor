import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { buildScenario } from '../../src/core/scenarios'
import type { AppState } from '../../src/core/types'

/**
 * ทางเดียวที่ครูจะรู้ว่าผู้ปกครองผูก OA แล้วหรือยัง และทางเดียวที่รหัสเชื่อมถูกออก
 *
 * สามข้อที่ห้ามหลุด:
 * - การ์ดสิบใบบนหน้าเดียวต้องถามเซิร์ฟเวอร์ครั้งเดียว และขึ้นสถานะพร้อมกันทุกใบ
 * - กด "ตรวจสถานะ" ระหว่างคำขอเดิมยังค้าง คำตอบเก่าต้องถูกทิ้ง ไม่ใช่ทับของใหม่
 * - โหมดที่ OA ใช้ไม่ได้ (เดโม / ยังไม่เข้าสู่ระบบ / คนละบัญชี) ต้องไม่มีอะไรวิ่งออกจากเครื่องเลย
 */
const providerId = '11111111-1111-4111-8111-111111111111'
const otherProviderId = '99999999-9999-4999-8999-999999999999'
const workspaceId = '22222222-2222-4222-8222-222222222222'
const recipientId = '33333333-3333-4333-8333-333333333333'
const remoteClientId = '44444444-4444-4444-8444-444444444444'

type Target = { recipient_id: string | null; unfollowed_at: string | null; eligible: boolean }

const api = vi.hoisted(() => ({
  session: null as { user: { id: string; email?: string } } | null,
  config: null as object | null,
  readChannel: vi.fn(),
  deliveryTarget: vi.fn(),
  syncClients: vi.fn(),
  eraseClients: vi.fn(),
  rpc: vi.fn(),
  copyText: vi.fn(),
  dispatch: vi.fn(),
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
  syncClients: (...a: unknown[]) => api.syncClients(...a),
  eraseClients: (...a: unknown[]) => api.eraseClients(...a),
}))
vi.mock('../../src/app/share', () => ({ copyText: (...a: unknown[]) => api.copyText(...a), openLine: vi.fn() }))

let state: AppState
vi.mock('../../src/core/store', async original => ({
  ...await original<typeof import('../../src/core/store')>(),
  useStore: () => ({ state, dispatch: api.dispatch, track: () => undefined, hydrated: true }),
}))

import { useLineLink, __resetLineLinkCache } from '../../src/app/useLineLink'
import { lineLinkCopy } from '../../src/app/lineLinkCopy'

const channel = (status = 'active') => ({
  status, display_name: 'OA ของครู QA', basic_id: '@solotutorqa',
  quota_used: 2, quota_limit: 300, quota_month: '2026-09', last_verified_at: null,
})
const target = (over: Partial<Target> = {}): Target =>
  ({ recipient_id: recipientId, unfollowed_at: null, eligible: true, ...over })

const realState = (over: Partial<AppState> = {}): AppState => ({
  ...buildScenario('default'), mode: 'real',
  provider: { name: 'ครู QA', promptpayId: '0812345678' },
  lineWorkspaceId: workspaceId, lineProviderId: providerId, ...over,
})

beforeEach(() => {
  for (const mock of [api.readChannel, api.deliveryTarget, api.syncClients, api.eraseClients, api.rpc, api.copyText, api.dispatch]) mock.mockReset()
  api.session = { user: { id: providerId, email: 'teacher@example.com' } }
  api.config = { url: 'https://qa.supabase.co', publishableKey: 'sb_publishable_qa' }
  api.readChannel.mockResolvedValue(channel())
  api.deliveryTarget.mockResolvedValue(target())
  api.syncClients.mockResolvedValue([{ local_client_key: 'c1', client_id: remoteClientId }])
  api.rpc.mockResolvedValue([{ code: '123456', expires_at: '2026-09-10T00:00:00Z' }])
  api.copyText.mockResolvedValue(true)
  api.dispatch.mockReturnValue(true)
  state = realState()
  __resetLineLinkCache()
})
afterEach(cleanup)

describe('useLineLink — สถานะที่ทุกการ์ดใช้ร่วมกัน', () => {
  it('การ์ดสองใบที่ถามผู้จ่ายคนเดียวกัน ถามเซิร์ฟเวอร์ครั้งเดียว และเห็นสถานะเดียวกัน', async () => {
    const first = renderHook(() => useLineLink(['c1']))
    const second = renderHook(() => useLineLink(['c1']))

    await waitFor(() => expect(first.result.current.status('c1')).toBe('linked'))
    expect(second.result.current.status('c1')).toBe('linked')
    expect(api.deliveryTarget).toHaveBeenCalledTimes(1)
    // ช่อง OA ก็อ่านครั้งเดียวเหมือนกัน ไม่ใช่ใบละครั้ง
    expect(api.readChannel).toHaveBeenCalledTimes(1)
  })

  it('ถามเฉพาะผู้จ่ายที่การ์ดนั้นสนใจ ไม่ใช่ทั้งสมุด', async () => {
    const { result } = renderHook(() => useLineLink(['c1']))
    await waitFor(() => expect(result.current.status('c1')).toBe('linked'))
    expect(api.deliveryTarget.mock.calls.map(call => call[1])).toEqual(['c1'])
    expect(result.current.status('c2')).toBe('unknown')
  })

  it('ยังไม่มีสมุด LINE = ยังไม่มีใครจับคู่ ปุ่มเชิญจึงต้องขึ้น และไม่ต้องถามเซิร์ฟเวอร์', async () => {
    state = realState({ lineWorkspaceId: undefined, lineProviderId: undefined })
    const { result } = renderHook(() => useLineLink(['c1']))
    await waitFor(() => expect(api.readChannel).toHaveBeenCalled())
    expect(result.current.status('c1')).toBe('unlinked')
    expect(api.deliveryTarget).not.toHaveBeenCalled()
  })

  it('กดตรวจสถานะแล้วถามใหม่จริง และคำตอบเก่าที่ค้างอยู่ต้องไม่ทับของใหม่', async () => {
    let release: (value: Target) => void = () => undefined
    api.deliveryTarget.mockImplementationOnce(() => new Promise<Target>(resolve => { release = resolve }))
    const { result } = renderHook(() => useLineLink(['c1']))
    await waitFor(() => expect(api.deliveryTarget).toHaveBeenCalledTimes(1))
    expect(result.current.status('c1')).toBe('unknown')

    api.deliveryTarget.mockResolvedValue(target({ recipient_id: null, eligible: false }))
    await act(async () => { await result.current.refresh(['c1']) })
    expect(result.current.status('c1')).toBe('unlinked')

    // คำตอบของคำขอที่ถูกทิ้งไปแล้วกลับมาทีหลัง ต้องไม่เปลี่ยนอะไร
    await act(async () => { release(target()); await Promise.resolve() })
    expect(result.current.status('c1')).toBe('unlinked')
    expect(api.deliveryTarget).toHaveBeenCalledTimes(2)
  })

  it('อ่านช่อง OA ไม่สำเร็จหนึ่งครั้ง ต้องไม่แปลว่า "ยังไม่เชื่อม" ไปทั้งเซสชัน — ถามใหม่ได้', async () => {
    api.readChannel.mockRejectedValueOnce(new Error('offline'))
    const first = renderHook(() => useLineLink(['c1']))
    await waitFor(() => expect(api.readChannel).toHaveBeenCalledTimes(1))
    // ยังไม่รู้ ≠ ไม่มีช่อง — ปุ่มเชิญจึงยังไม่ถูกลดชั้นเป็นลิงก์ "ตั้งค่า LINE OA"
    expect(first.result.current.channelLoaded).toBe(false)
    expect(first.result.current.channel).toBeNull()

    const second = renderHook(() => useLineLink(['c1']))

    await waitFor(() => expect(second.result.current.channel?.status).toBe('active'))
    expect(second.result.current.channelLoaded).toBe(true)
    expect(first.result.current.channel?.status).toBe('active')
  })

  it('แคชถูกทิ้งทั้งก้อน (สลับบัญชีระหว่างซิงก์) — การ์ดที่ยัง mount อยู่ถามใหม่เอง ไม่ค้างที่ยังไม่รู้', async () => {
    const first = renderHook(() => useLineLink(['c1']))
    const second = renderHook(() => useLineLink(['c1']))
    await waitFor(() => expect(second.result.current.status('c1')).toBe('linked'))
    expect(api.deliveryTarget).toHaveBeenCalledTimes(1)

    act(() => { __resetLineLinkCache() })
    expect(second.result.current.status('c1')).toBe('unknown')

    await waitFor(() => expect(second.result.current.status('c1')).toBe('linked'))
    expect(first.result.current.status('c1')).toBe('linked')
    // ถามใหม่ครั้งเดียวสำหรับทุกการ์ด ไม่ใช่ใบละครั้ง
    expect(api.deliveryTarget).toHaveBeenCalledTimes(2)
  })

  it('เลิกติดตาม OA แล้ว = ยังไม่เชื่อม ไม่ใช่เชื่อมแล้ว', async () => {
    api.deliveryTarget.mockResolvedValue(target({ unfollowed_at: '2026-09-08T00:00:00Z' }))
    const { result } = renderHook(() => useLineLink(['c1']))
    await waitFor(() => expect(result.current.status('c1')).toBe('unlinked'))
  })

  it('ตรวจสถานะรายคน: ล้างข้อความเก่าก่อน แล้วตอบว่าเปลี่ยนหรือไม่เปลี่ยน', async () => {
    const { result } = renderHook(() => useLineLink(['c1']))
    await waitFor(() => expect(result.current.status('c1')).toBe('linked'))

    api.deliveryTarget.mockResolvedValue(target({ recipient_id: null, eligible: false }))
    await act(async () => { await result.current.refresh(['c1']) })
    expect(result.current.notice).toBe(lineLinkCopy.stillWaiting)

    api.deliveryTarget.mockResolvedValue(target())
    await act(async () => { await result.current.refresh(['c1']) })
    expect(result.current.notice).toBe(lineLinkCopy.linkedNow)

    // ถามไม่สำเร็จต้องไม่ถูกอ่านว่า "ยังไม่ผูก"
    api.deliveryTarget.mockRejectedValue(new Error('offline'))
    await act(async () => { await result.current.refresh(['c1']) })
    expect(result.current.notice).toBe(lineLinkCopy.failed)
    expect(result.current.status('c1')).toBe('linked')
  })
})

describe('useLineLink — เชิญผู้ปกครอง', () => {
  it('กดครั้งเดียวได้ทั้งรหัสและข้อความเชิญที่มีลิงก์แอดเพื่อน พร้อมวางในแชท', async () => {
    const { result } = renderHook(() => useLineLink(['c1']))
    await waitFor(() => expect(result.current.channel?.status).toBe('active'))

    const outcome = await act(async () => result.current.invite('c1'))

    expect(outcome).toMatchObject({ ok: true })
    expect(api.rpc).toHaveBeenCalledWith('issue_line_link_code', { p_client_id: remoteClientId })
    const copied = String(api.copyText.mock.calls[0][0])
    expect(copied).toContain('123456')
    expect(copied).toContain('https://line.me/R/ti/p/%40solotutorqa')
    // ข้อความถึงผู้ปกครองห้ามมีคำว่าระบบ/อัตโนมัติ/Solo — เป็นเสียงครูล้วน
    expect(copied).not.toMatch(/ระบบ|อัตโนมัติ|Solo/)
    expect(outcome.notice).toContain('คัดลอกข้อความเชิญแล้ว')
    expect(result.current.codes.c1.code).toBe('123456')
  })

  it('ครั้งแรกของครูยังไม่มีสมุด LINE — การเชิญสร้างให้เอง แล้วออกรหัสต่อได้เลย', async () => {
    state = realState({ lineWorkspaceId: undefined, lineProviderId: undefined })
    const { result } = renderHook(() => useLineLink(['c1']))

    const outcome = await act(async () => result.current.invite('c1'))

    expect(outcome.ok).toBe(true)
    expect(api.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'lineWorkspace', providerId }))
    expect(api.syncClients).toHaveBeenCalled()
  })

  it('คัดลอกไม่ผ่าน = รหัสออกไปแล้ว ครูต้องเห็นรหัสนั้นเพื่อส่งเอง', async () => {
    api.copyText.mockResolvedValue(false)
    const { result } = renderHook(() => useLineLink(['c1']))

    const outcome = await act(async () => result.current.invite('c1'))

    expect(outcome.ok).toBe(true)
    expect(outcome.notice).toContain('123456')
  })

  it('สมุดนี้ผูกกับบัญชีอื่น — ไม่ออกรหัสให้ และบอกให้เข้าบัญชีเดิม', async () => {
    state = realState({ lineProviderId: otherProviderId })
    const { result } = renderHook(() => useLineLink(['c1']))

    const outcome = await act(async () => result.current.invite('c1'))

    expect(outcome.ok).toBe(false)
    expect(outcome.notice).toContain('บัญชีอื่น')
    expect(api.rpc).not.toHaveBeenCalled()
    expect(api.syncClients).not.toHaveBeenCalled()
    // และสถานะของบัญชีที่ไม่ใช่เจ้าของสมุดต้องไม่ถูกถามเลย
    expect(api.deliveryTarget).not.toHaveBeenCalled()
  })

  it('ออกรหัสไม่สำเร็จ → บอกเหตุผลที่ครูทำต่อได้ และไม่ค้าง busy', async () => {
    api.rpc.mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => useLineLink(['c1']))

    const outcome = await act(async () => result.current.invite('c1'))

    expect(outcome.ok).toBe(false)
    expect(outcome.notice).toContain('ทำรายการไม่สำเร็จ')
    expect(result.current.busy).toBe(false)
  })
})

describe('useLineLink — โหมดที่ OA ใช้ไม่ได้', () => {
  it('เดโมที่ยังไม่เข้าสู่ระบบ: ไม่อ่านช่อง ไม่ถามสถานะ ไม่ออกรหัส', async () => {
    // ผู้เข้าชมเว็บสาธารณะเห็นหน้าจอเดิมทุกจุด — OA ในเดโมเปิดหลังครูเข้าสู่ระบบเท่านั้น
    api.session = null
    state = realState({ mode: 'demo' })
    const { result } = renderHook(() => useLineLink(['c1']))
    const outcome = await act(async () => result.current.invite('c1'))

    expect(outcome.ok).toBe(false)
    expect(result.current.status('c1')).toBe('unknown')
    expect(api.readChannel).not.toHaveBeenCalled()
    expect(api.deliveryTarget).not.toHaveBeenCalled()
    expect(api.rpc).not.toHaveBeenCalled()
  })

  it('เดโมที่เข้าสู่ระบบแล้ว: เชิญผู้ปกครองได้เหมือนโหมดจริง (รหัสจริงของครูคนที่ล็อกอิน)', async () => {
    // หลักการใหม่ 9 ก.ย.: OA ขึ้นกับบัญชี + ช่อง + การจับคู่ ไม่ขึ้นกับว่าสมุดเป็นเดโมหรือจริง
    // ข้อความจากเดโมจึงถึงได้เฉพาะเครื่องที่ครูคนนี้จับคู่เองด้วยรหัสที่ตัวเองออก
    state = realState({ mode: 'demo' })
    const { result } = renderHook(() => useLineLink(['c1']))
    const outcome = await act(async () => result.current.invite('c1'))

    expect(outcome.ok).toBe(true)
    expect(api.rpc).toHaveBeenCalledWith('issue_line_link_code', { p_client_id: remoteClientId })
    expect(api.copyText).toHaveBeenCalled()
    expect(String(api.copyText.mock.calls[0][0])).toContain('123456')
    await waitFor(() => expect(api.readChannel).toHaveBeenCalled())
  })

  it('ยังไม่เข้าสู่ระบบ: เงียบสนิทเหมือนกัน', async () => {
    api.session = null
    const { result } = renderHook(() => useLineLink(['c1']))
    await act(async () => { await result.current.refresh() })

    expect(result.current.status('c1')).toBe('unknown')
    expect(api.readChannel).not.toHaveBeenCalled()
    expect(api.deliveryTarget).not.toHaveBeenCalled()
  })
})
