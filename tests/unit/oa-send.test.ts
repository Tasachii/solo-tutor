import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildScenario } from '../../src/core/scenarios'
import { reducer, type Action } from '../../src/core/store'
import type { AppState, Message } from '../../src/core/types'

/**
 * ส่งผ่าน LINE OA ที่ใช้ร่วมกันระหว่างการ์ดข้อความและการส่งเป็นชุด —
 * ห้ามมีอะไรออกจากเครื่องก่อน oaStart ถูกบันทึก, รายการเดิมไม่ enqueue ซ้ำ, ผลไม่ชัด = pending
 */
const providerId = '11111111-1111-4111-8111-111111111111'
const workspaceId = '22222222-2222-4222-8222-222222222222'
const recipientId = '33333333-3333-4333-8333-333333333333'

type Row = { id: string; status: string; recipient_id: string; body: string; message_id: string; last_error: string | null }
type Target = { recipient_id: string | null; eligible: boolean; reason: string; client_id: string; channel_status: string | null; unfollowed_at: string | null; quota_used: number; quota_limit: number }
const api = vi.hoisted(() => ({
  session: { user: { id: '11111111-1111-4111-8111-111111111111' } } as { user: { id: string } } | null,
  config: { url: 'https://qa.supabase.co', publishableKey: 'sb_publishable_qa' } as object | null,
  findDelivery: vi.fn<() => Promise<Row | null>>(async () => null),
  deliveryTarget: vi.fn<() => Promise<Target | null>>(async () => ({ recipient_id: '33333333-3333-4333-8333-333333333333', eligible: true, reason: 'ok', client_id: 'x', channel_status: 'active', unfollowed_at: null, quota_used: 0, quota_limit: 300 })),
  deliverOa: vi.fn<() => Promise<Row | null>>(async () => ({ id: 'out-1', status: 'sent', recipient_id: '33333333-3333-4333-8333-333333333333', body: '', message_id: '', last_error: null })),
  // ข้อความบิลมีลิงก์เอกสาร การส่งจริงจึงต้องเผยแพร่ลิงก์ที่ปิดได้ก่อน — ที่นี่คุมผลของขั้นนั้น
  secureDraft: vi.fn<(state: unknown, draft: string) => Promise<{ draft: string; links: never[]; skipped: string | null }>>(
    async (_state, draft) => ({ draft, links: [], skipped: null }),
  ),
}))
vi.mock('../../src/integrations/supabaseRest', () => ({
  getSession: () => api.session, getSupabaseConfig: () => api.config, rpc: vi.fn(),
}))
// ต้อง partial mock — oaSend ใช้ publishBlocks จากโมดูลเดียวกัน ถ้า mock ทับทั้งก้อนจะกลายเป็น undefined
vi.mock('../../src/core/documentPublish', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/documentPublish')>()
  return { ...actual, secureDraft: (...a: unknown[]) => api.secureDraft(...(a as [never, string])) }
})
vi.mock('../../src/integrations/lineApi', () => ({
  findDelivery: (...a: unknown[]) => api.findDelivery(...(a as [])),
  deliveryTarget: (...a: unknown[]) => api.deliveryTarget(...(a as [])),
  deliverOa: (...a: unknown[]) => api.deliverOa(...(a as [])),
}))

import { oaAvailable, sendMessageViaOa, linkStates } from '../../src/app/oaSend'

/** โหมดจริงตั้งแต่ก่อน derive — ร่างจึงมี financialRevision ของโหมด/ผู้รับเงินชุดเดียวกับตอนส่ง */
const realState = (): AppState => reducer({
  ...buildScenario('default'), mode: 'real', provider: { name: 'ครู QA', promptpayId: '0812345678' },
  lineWorkspaceId: workspaceId, lineProviderId: providerId, sending: undefined,
}, { type: 'track', name: 'init' })
/** dispatch ที่ทำงานเหมือน store: reducer จริง + สถานะล่าสุดในตัวแปรเดียว */
const makeDispatch = (initial: AppState) => {
  let current = initial
  const dispatch = (action: Action): boolean => { const next = reducer(current, action); if (next === current) return false; current = next; return true }
  return { dispatch, state: () => current }
}

beforeEach(() => {
  api.session = { user: { id: providerId } }
  api.config = { url: 'https://qa.supabase.co', publishableKey: 'sb_publishable_qa' }
  api.findDelivery.mockReset().mockResolvedValue(null)
  api.deliveryTarget.mockReset().mockResolvedValue({ recipient_id: recipientId, eligible: true, reason: 'ok', client_id: 'x', channel_status: 'active', unfollowed_at: null, quota_used: 0, quota_limit: 300 })
  api.deliverOa.mockReset().mockResolvedValue({ id: 'out-1', status: 'sent', recipient_id: recipientId, body: '', message_id: '', last_error: null })
  api.secureDraft.mockReset().mockImplementation(async (_state, draft) => ({ draft, links: [], skipped: null }))
})

describe('sendMessageViaOa', () => {
  it('ทางปกติ: บันทึก oaStart ก่อน → enqueue+send → sent และข้อความถูกทำเครื่องหมายส่งแล้ว', async () => {
    const s = realState()
    const { dispatch, state } = makeDispatch(s)
    const draft = s.messages.find(m => m.status === 'draft' && m.kind === 'reminder')!
    const outcome = await sendMessageViaOa(s, dispatch, draft)
    expect(outcome).toEqual({ status: 'sent' })
    expect(api.deliverOa).toHaveBeenCalledTimes(1)
    const [intent] = api.deliverOa.mock.calls[0] as unknown as [{ dedupeKey: string; recipientId: string; body: string }]
    expect(intent.dedupeKey).toBe(`${workspaceId}:${draft.dedupeKey}`)
    expect(intent.recipientId).toBe(recipientId)
    expect(intent.body).toBe(draft.draft)
    const after = state().messages.find(m => m.id === draft.id)!
    expect(after.status).toBe('sent')
    expect(after.oaDelivery).toBeUndefined()
  })

  it('ผู้ปกครองยังไม่เชื่อม → blocked not-linked โดยไม่แตะ storage และไม่ enqueue', async () => {
    api.deliveryTarget.mockResolvedValue({ recipient_id: null, eligible: false, reason: 'recipient-not-linked', client_id: 'x', channel_status: 'active', unfollowed_at: null, quota_used: 0, quota_limit: 300 })
    const s = realState()
    const dispatch = vi.fn(() => true)
    const draft = s.messages.find(m => m.status === 'draft')!
    const outcome = await sendMessageViaOa(s, dispatch, draft)
    expect(outcome.status).toBe('blocked')
    if (outcome.status === 'blocked') expect(outcome.reason).toBe('not-linked')
    expect(dispatch).not.toHaveBeenCalled()
    expect(api.deliverOa).not.toHaveBeenCalled()
  })

  it('เคยเข้าคิวแล้ว → ใช้รายการเดิม ไม่ enqueue ซ้ำ; ผลยังไม่ชัด = pending; failed = review', async () => {
    const s = realState()
    const draft = s.messages.find(m => m.status === 'draft' && m.kind === 'reminder')!
    api.findDelivery.mockResolvedValue({ id: 'out-9', status: 'sent', recipient_id: recipientId, body: draft.draft, message_id: draft.dedupeKey, last_error: null })
    const { dispatch, state } = makeDispatch(s)
    expect(await sendMessageViaOa(s, dispatch, draft)).toEqual({ status: 'sent' })
    expect(api.deliverOa).not.toHaveBeenCalled()
    expect(state().messages.find(m => m.id === draft.id)!.status).toBe('sent')

    const s2 = realState()
    const other = s2.messages.find(m => m.status === 'draft' && m.kind !== 'reminder')!
    api.findDelivery.mockResolvedValue(null)
    api.deliverOa.mockResolvedValue({ id: 'out-2', status: 'processing', recipient_id: recipientId, body: '', message_id: '', last_error: null })
    const d2 = makeDispatch(s2)
    const pending = await sendMessageViaOa(s2, d2.dispatch, other)
    expect(pending.status).toBe('pending')
    // ความตั้งใจส่งถูกบันทึกไว้แล้ว — การส่งซ้ำ/แก้ไขจะถูกกันจนกว่าจะตรวจผล
    expect(d2.state().messages.find(m => m.id === other.id)!.oaDelivery).toBeTruthy()

    const s3 = realState()
    const third = s3.messages.find(m => m.status === 'draft')!
    api.deliverOa.mockResolvedValue({ id: 'out-3', status: 'failed', recipient_id: recipientId, body: '', message_id: '', last_error: 'blocked' })
    const review = await sendMessageViaOa(s3, makeDispatch(s3).dispatch, third)
    expect(review.status).toBe('review')
  })

  it('ไม่มี session / บัญชีไม่ตรง / ยังไม่มี workspace / ยกเลิกไว้แล้ว / เครือข่ายล้ม → blocked พร้อมเหตุผล', async () => {
    const s = realState()
    const draft = s.messages.find(m => m.status === 'draft')!
    const dispatch = vi.fn(() => true)
    api.session = null
    expect((await sendMessageViaOa(s, dispatch, draft)).status).toBe('blocked')
    api.session = { user: { id: '99999999-9999-4999-8999-999999999999' } }
    const wrong = await sendMessageViaOa(s, dispatch, draft)
    expect(wrong.status === 'blocked' && wrong.reason).toBe('wrong-account')
    api.session = { user: { id: providerId } }
    const noWs = await sendMessageViaOa({ ...s, lineWorkspaceId: undefined, lineProviderId: undefined }, dispatch, draft)
    expect(noWs.status === 'blocked' && noWs.reason).toBe('no-workspace')
    api.findDelivery.mockResolvedValue({ id: 'out-c', status: 'skipped', recipient_id: recipientId, body: '', message_id: '', last_error: 'user-cancelled' })
    const cancelled = await sendMessageViaOa(s, dispatch, draft)
    expect(cancelled.status === 'blocked' && cancelled.reason).toBe('cancelled')
    api.findDelivery.mockRejectedValue(new Error('offline'))
    // เน็ตตายก่อนมีรายการใดถูกบันทึก = ยังไม่มีอะไรออกจากเครื่อง → 'offline' (เปิด LINE ส่งเองได้)
    const offline = await sendMessageViaOa(s, dispatch, draft)
    expect(offline.status === 'blocked' && offline.reason).toBe('offline')
    expect(dispatch).not.toHaveBeenCalled()
    expect(api.deliverOa).not.toHaveBeenCalled()
  })

  it('เน็ตตายหลังบันทึกความตั้งใจส่งแล้ว → network (ห้ามเสนอทางแชร์เอง เพราะอาจถึงผู้รับแล้ว)', async () => {
    // การส่งที่ถูกบันทึกแล้วอาจถึงผู้ปกครองจริง แม้คำตอบ HTTP จะไม่กลับมา
    // ต่างจาก 'offline' ที่ยังไม่มีรายการใดถูกบันทึกเลย — สองกรณีนี้ต้องไม่ใช้ทางเดียวกัน
    const s = realState()
    const { dispatch, state } = makeDispatch(s)
    const draft = s.messages.find(m => m.status === 'draft' && m.kind === 'reminder')!
    api.deliverOa.mockRejectedValue(new Error('gateway timeout'))
    const outcome = await sendMessageViaOa(s, dispatch, draft)
    expect(outcome.status === 'blocked' && outcome.reason).toBe('network')
    // ความตั้งใจส่งยังอยู่ในเครื่อง ครูจึงกด "ตรวจสอบผลส่ง" ต่อได้ ไม่ใช่ส่งซ้ำ
    expect(state().messages.find(m => m.id === draft.id)!.oaDelivery).toBeTruthy()
  })

  it('เดโมที่ล็อกอินแล้ว: ส่งผ่าน OA ได้ และคีย์กันส่งซ้ำมี demo: นำหน้า', async () => {
    // เกณฑ์ผ่านชุด A-demo — ตัวเลขจากเดโมต้องไม่ปนกับของจริงในรายงาน
    const s = reducer({
      ...buildScenario('default'), lineWorkspaceId: workspaceId, lineProviderId: providerId, sending: undefined,
    }, { type: 'track', name: 'init' })
    const { dispatch, state } = makeDispatch(s)
    const draft = s.messages.find(m => m.status === 'draft')!
    expect(await sendMessageViaOa(s, dispatch, draft)).toEqual({ status: 'sent' })
    const [intent] = api.deliverOa.mock.calls[0] as unknown as [{ dedupeKey: string }]
    expect(intent.dedupeKey).toBe(`${workspaceId}:demo:${draft.dedupeKey}`)
    expect(state().messages.find(m => m.id === draft.id)!.status).toBe('sent')
  })

  it('ยอดเปลี่ยนหลังร่าง → blocked issue ก่อนแตะเครือข่ายส่ง', async () => {
    let s = realState()
    const draft = s.messages.find(m => m.status === 'draft' && m.kind === 'reminder')!
    s = reducer(s, { type: 'editMessage', id: draft.id, draft: `${draft.draft} เพิ่ม` })
    s = reducer(s, { type: 'recordPayment', invoiceId: String(draft.meta!.invoiceId), amount: 100, slipVerified: false })
    const stale = s.messages.find(m => m.id === draft.id)! as Message
    const outcome = await sendMessageViaOa(s, makeDispatch(s).dispatch, stale)
    expect(outcome.status === 'blocked' && outcome.reason).toBe('issue')
    expect(api.deliverOa).not.toHaveBeenCalled()
  })
  it('เผยแพร่ลิงก์ที่ปิดได้ไม่สำเร็จ → ไม่ส่ง และบอกเหตุผล ไม่ปล่อยลิงก์ถาวรออกไปแทน', async () => {
    // ลิงก์ที่ส่งไปแล้วตามกลับมาปิดไม่ได้ ถ้าเผยแพร่ไม่สำเร็จจึงต้องหยุด ไม่ใช่ส่งลิงก์รุ่นเดิมเงียบ ๆ
    const s = realState()
    const { dispatch, state } = makeDispatch(s)
    const draft = s.messages.find(m => m.status === 'draft' && m.kind === 'reminder')!
    api.secureDraft.mockResolvedValueOnce({ draft: draft.draft, links: [], skipped: 'failed' })
    const outcome = await sendMessageViaOa(state(), dispatch, draft)
    expect(outcome.status).toBe('blocked')
    expect(api.deliverOa).not.toHaveBeenCalled()
    // ยังไม่มีอะไรออกจากเครื่อง และข้อความยังเป็นร่างรอส่งเหมือนเดิม
    expect(state().messages.find(m => m.id === draft.id)?.status).toBe('draft')
  })
})

describe('oaAvailable — ปุ่ม OA ไม่ขึ้นกับโหมดอีกแล้ว', () => {
  const demo = (): AppState => ({ ...buildScenario('default'), lineWorkspaceId: workspaceId, lineProviderId: providerId })
  const real = (): AppState => ({ ...demo(), mode: 'real' })
  const withDelivery = (state: AppState): Message => ({
    ...state.messages.find(m => m.status === 'draft')!,
    oaDelivery: { providerId, workspaceId, recipientId, dedupeKey: 'k', body: 'b' },
  })

  it('โหมดจริงไม่เปลี่ยนพฤติกรรมเลย', () => {
    expect(oaAvailable(real())).toBe(true)
    api.config = null
    expect(oaAvailable(real())).toBe(false)
    // มีรายการค้างตรวจ = ปุ่มต้องอยู่ต่อ แม้บิลด์นี้ไม่มีโปรเจกต์
    expect(oaAvailable(real(), withDelivery(real()))).toBe(true)
  })

  it('เดโม: ยังไม่เข้าสู่ระบบ = เหมือนเดิมทุกจุด · เข้าสู่ระบบแล้ว = เปิดใช้', () => {
    api.session = null
    expect(oaAvailable(demo())).toBe(false)
    api.session = { user: { id: providerId } }
    expect(oaAvailable(demo())).toBe(true)
    // ไม่มีโปรเจกต์ให้ติดต่อ = ไม่มีทางส่ง แม้ล็อกอินแล้ว
    api.config = null
    expect(oaAvailable(demo())).toBe(false)
  })

  it('รายการที่เริ่มส่งไปแล้วไม่ดู session และไม่ดูโหมด — การ์ดกลางทางต้องเหลือปุ่มตรวจผลเสมอ', () => {
    const state = demo()
    const message = withDelivery(state)
    api.session = null
    expect(oaAvailable(state, message)).toBe(true)
    api.config = null
    expect(oaAvailable(state, message)).toBe(true)
  })

  it('ที่เก็บ session อ่านไม่ได้ (โหมดส่วนตัว) = ถือว่ายังไม่ล็อกอิน ไม่ใช่ล้มทั้งปุ่ม', () => {
    api.session = null
    Object.defineProperty(api, 'session', { configurable: true, get() { throw new Error('storage blocked') } })
    try {
      expect(oaAvailable(demo())).toBe(false)
      expect(oaAvailable(real())).toBe(true)
    } finally {
      Object.defineProperty(api, 'session', { configurable: true, writable: true, value: null })
    }
  })
})

describe('linkStates', () => {
  it('บอกสถานะต่อผู้จ่ายไม่ซ้ำคน และคืน unknown เมื่อไม่มี session/workspace', async () => {
    const s = realState()
    const states = await linkStates(s, ['c1', 'c2', 'c1'])
    expect(states).toEqual({ c1: 'linked', c2: 'linked' })
    expect(api.deliveryTarget).toHaveBeenCalledTimes(2)
    api.deliveryTarget.mockResolvedValueOnce({ recipient_id: null, eligible: false, reason: 'recipient-not-linked', client_id: 'x', channel_status: 'active', unfollowed_at: null, quota_used: 0, quota_limit: 300 })
    expect((await linkStates(s, ['c3'])).c3).toBe('not-linked')
    api.session = null
    expect((await linkStates(s, ['c1'])).c1).toBe('unknown')
  })
})
