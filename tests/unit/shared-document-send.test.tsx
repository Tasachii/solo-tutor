import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildScenario } from '../../src/core/scenarios'
import { reducer, type Action } from '../../src/core/store'
import type { AppState, Message } from '../../src/core/types'
import { copy } from '../../src/copy'

/**
 * จุดที่ลิงก์ที่ปิดได้ถูกสร้างจริง — วินาทีที่ครูกดส่งหรือกดคัดลอก
 *
 * สองอย่างที่ห้ามพลาด:
 * - ข้อความที่เก็บไว้ต้องเท่ากับข้อความที่ผู้ปกครองได้รับ (oaStart ใน store ก็บังคับข้อนี้อยู่)
 * - เผยแพร่ไม่สำเร็จ = ไม่ส่ง และบอกเหตุผลที่ครูทำต่อได้ ไม่ใช่แอบส่งลิงก์ที่ปิดไม่ได้แทน
 */
const providerId = '11111111-1111-4111-8111-111111111111'
const workspaceId = '22222222-2222-4222-8222-222222222222'
const recipientId = '33333333-3333-4333-8333-333333333333'
const SECURE = `#/document/${'T'.repeat(22)}.${'k'.repeat(43)}`

type Row = { id: string; status: string; recipient_id: string; body: string; message_id: string; last_error: string | null }
type Secured = { draft: string; links: never[]; skipped: string | null }

const api = vi.hoisted(() => ({
  session: { user: { id: '11111111-1111-4111-8111-111111111111' } } as { user: { id: string } } | null,
  config: { url: 'https://qa.supabase.co', publishableKey: 'sb_publishable_qa' } as object | null,
  findDelivery: vi.fn<() => Promise<Row | null>>(async () => null),
  deliveryTarget: vi.fn(async () => ({ recipient_id: '33333333-3333-4333-8333-333333333333', eligible: true, reason: 'ok', client_id: 'x', channel_status: 'active', unfollowed_at: null, quota_used: 0, quota_limit: 300 })),
  deliverOa: vi.fn<(intent: { body: string }) => Promise<Row | null>>(async () => ({ id: 'out-1', status: 'sent', recipient_id: '33333333-3333-4333-8333-333333333333', body: '', message_id: '', last_error: null })),
  secureDraft: vi.fn<(state: unknown, draft: string) => Promise<Secured>>(async (_s, draft) => ({ draft, links: [], skipped: null })),
  openLine: vi.fn((_text: string) => true),
  copyText: vi.fn(async (_text: string) => true),
}))

vi.mock('../../src/integrations/supabaseRest', () => ({
  getSession: () => api.session, getSupabaseConfig: () => api.config, rpc: vi.fn(),
}))
vi.mock('../../src/core/documentPublish', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/documentPublish')>()
  return { ...actual, secureDraft: (...a: unknown[]) => api.secureDraft(...(a as [never, string])) }
})
vi.mock('../../src/integrations/lineApi', () => ({
  findDelivery: (...a: unknown[]) => api.findDelivery(...(a as [])),
  deliveryTarget: (...a: unknown[]) => api.deliveryTarget(...(a as [])),
  deliverOa: (...a: unknown[]) => api.deliverOa(...(a as [{ body: string }])),
}))
vi.mock('../../src/app/share', () => ({
  openLine: (...a: unknown[]) => api.openLine(...(a as [string])),
  copyText: (...a: unknown[]) => api.copyText(...(a as [string])),
}))

/** store จำลองที่แจ้งเตือน React จริง ๆ ไม่งั้นการ์ดยืนยันหลังกดส่งจะไม่ถูก render ใหม่ */
const store = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  return {
    current: null as unknown as AppState,
    listeners,
    emit() { for (const listener of [...listeners]) listener() },
  }
})
vi.mock('../../src/core/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/store')>()
  const { useEffect, useState } = await import('react')
  return {
    ...actual,
    useStore: () => {
      const [, bump] = useState(0)
      useEffect(() => {
        const listener = () => bump(n => n + 1)
        store.listeners.add(listener)
        return () => { store.listeners.delete(listener) }
      }, [])
      return {
        state: store.current,
        dispatch: (action: Action) => {
          const next = actual.reducer(store.current, action)
          if (next === store.current) return false
          store.current = next
          store.emit()
          return true
        },
        track: () => undefined,
        hydrated: true,
        writeStatus: 'writable',
      }
    },
  }
})

import { sendMessageViaOa } from '../../src/app/oaSend'
import Admin from '../../src/app/Admin'
import { ToastProvider } from '../../src/app/components/Toast'

const realState = (): AppState => reducer({
  ...buildScenario('default'), mode: 'real', provider: { name: 'ครู QA', promptpayId: '0812345678' },
  lineWorkspaceId: workspaceId, lineProviderId: providerId, sending: undefined,
}, { type: 'track', name: 'init' })

const makeDispatch = (initial: AppState) => {
  let current = initial
  const dispatch = (action: Action): boolean => {
    const next = reducer(current, action)
    if (next === current) return false
    current = next
    return true
  }
  return { dispatch, state: () => current }
}

/** ร่างใบแรกที่มีลิงก์เอกสารอยู่จริง — โหมดจริงร่างส่วนใหญ่เป็นใบทวง ไม่ใช่ใบแจ้งยอด */
const linkedDraft = (state: AppState): Message =>
  state.messages.find(m => m.status === 'draft' && m.draft.includes('#/document/'))!

/** ตัดลิงก์รุ่นเดิมออกแล้วใส่ลิงก์ที่ปิดได้แทน เหมือนที่ของจริงทำ */
const rewrite = (draft: string): string => draft.replace(/#\/document\/[A-Za-z0-9_-]+/, SECURE)

afterEach(() => { cleanup(); vi.clearAllMocks() })
beforeEach(() => {
  api.session = { user: { id: providerId } }
  api.config = { url: 'https://qa.supabase.co', publishableKey: 'sb_publishable_qa' }
  api.findDelivery.mockReset().mockResolvedValue(null)
  api.deliverOa.mockReset().mockResolvedValue({ id: 'out-1', status: 'sent', recipient_id: recipientId, body: '', message_id: '', last_error: null })
  api.secureDraft.mockReset().mockImplementation(async (_s, draft) => ({ draft, links: [], skipped: null }))
  api.openLine.mockReset().mockReturnValue(true)
  api.copyText.mockReset().mockResolvedValue(true)
})

describe('ส่งผ่าน LINE OA', () => {
  it('ลิงก์ที่เพิ่งเผยแพร่ต้องถูกบันทึกลงร่างก่อน ไม่งั้น oaStart ปฏิเสธคิวทั้งใบ', async () => {
    // store ตรวจว่า delivery.body ต้องตรงกับร่างที่เก็บไว้ · แนบลิงก์ใหม่ไปเฉย ๆ = ส่งไม่ออกเลย
    const dispatch = makeDispatch(realState())
    const message = linkedDraft(dispatch.state())
    api.secureDraft.mockResolvedValueOnce({ draft: rewrite(message.draft), links: [], skipped: null })

    const outcome = await sendMessageViaOa(dispatch.state(), dispatch.dispatch, message)

    expect(outcome.status).toBe('sent')
    expect(api.deliverOa).toHaveBeenCalledTimes(1)
    expect(api.deliverOa.mock.calls[0][0].body).toContain(SECURE)
    // ข้อความที่เก็บไว้ในเครื่องต้องเป็นข้อความเดียวกับที่ผู้ปกครองได้รับ
    const stored = dispatch.state().messages.find(m => m.id === message.id)!
    expect(stored.draft).toContain(SECURE)
    expect(stored.draft).toBe(api.deliverOa.mock.calls[0][0].body)
    expect(stored.status).toBe('sent')
    // และสำเนาที่เก็บลงห้องแชทก็ต้องเป็นข้อความเดียวกัน
    expect(dispatch.state().chats.at(-1)?.text).toContain(SECURE)
  })

  it('ลิงก์ถูกปิดไปแล้ว หรือเผยแพร่ล้ม → ไม่ส่ง และร่างไม่ถูกแตะ', async () => {
    // 'signed-out' ไม่อยู่ในนี้โดยตั้งใจ — ครูโหมดจริงที่ไม่ได้สมัครบัญชีต้องส่งบิลได้ตามเดิม
    // หน้าจอประกาศไว้แล้วว่าลิงก์รอบนี้ปิดไม่ได้ การหยุดส่งจะทำให้ส่งบิลไม่ได้เลย
    for (const skipped of ['stale', 'failed']) {
      const dispatch = makeDispatch(realState())
      const message = linkedDraft(dispatch.state())
      api.secureDraft.mockResolvedValueOnce({ draft: rewrite(message.draft), links: [], skipped })

      const outcome = await sendMessageViaOa(dispatch.state(), dispatch.dispatch, message)

      expect(outcome.status).toBe('blocked')
      expect(outcome.status === 'blocked' && outcome.reason).toBe('publish')
      expect(api.deliverOa).not.toHaveBeenCalled()
      const stored = dispatch.state().messages.find(m => m.id === message.id)!
      expect(stored.status).toBe('draft')
      expect(stored.draft).toBe(message.draft)
      expect(stored.oaDelivery).toBeUndefined()
    }
  })

  it('รายการที่เคยเข้าคิวแล้วใช้ข้อความเดิมที่แช่ไว้ ไม่เผยแพร่ลิงก์ใหม่ซ้อน', async () => {
    const dispatch = makeDispatch(realState())
    const message = linkedDraft(dispatch.state())
    api.findDelivery.mockResolvedValue({
      id: 'out-9', status: 'processing', recipient_id: recipientId,
      body: `ข้อความเดิมที่แช่ไว้ ${SECURE}`, message_id: '', last_error: null,
    })

    await sendMessageViaOa(dispatch.state(), dispatch.dispatch, message)

    expect(api.secureDraft).not.toHaveBeenCalled()
    expect(api.deliverOa.mock.calls[0][0].body).toBe(`ข้อความเดิมที่แช่ไว้ ${SECURE}`)
  })
})

const showAdmin = () => render(
  <MemoryRouter initialEntries={['/app/admin?tab=drafts']}>
    <ToastProvider><Admin /></ToastProvider>
  </MemoryRouter>,
)

describe('ส่งและคัดลอกจากแท็บร่าง', () => {
  beforeEach(() => { store.current = { ...realState(), lineWorkspaceId: undefined, lineProviderId: undefined } })

  it('กดส่งแล้วลิงก์ใหม่ถูกบันทึกลงร่าง เปิด LINE ด้วยข้อความเดียวกัน และไม่ติดป้ายว่าครูแก้เอง', async () => {
    const message = linkedDraft(store.current)
    api.secureDraft.mockImplementation(async (_s, draft) => ({ draft: rewrite(draft), links: [], skipped: null }))
    showAdmin()

    fireEvent.click(screen.getAllByRole('button', { name: copy.admin.sendLine })[0])

    await waitFor(() => expect(api.openLine).toHaveBeenCalled())
    expect(String(api.openLine.mock.calls[0][0])).toContain(SECURE)
    const stored = store.current.messages.find(m => m.id === message.id)!
    expect(stored.draft).toBe(String(api.openLine.mock.calls[0][0]))
    // ระบบใส่ลิงก์ให้ ไม่ใช่ครูแก้ข้อความ — ป้าย "แก้ไขแล้ว" ต้องไม่ขึ้น
    await waitFor(() => expect(screen.queryByText(copy.admin.editedTag)).toBeNull())
  })

  it('เผยแพร่ไม่สำเร็จ → ไม่เปิด LINE บอกเหตุผลที่ทำต่อได้ และร่างยังเป็นลิงก์เดิม', async () => {
    const message = linkedDraft(store.current)
    api.secureDraft.mockResolvedValue({ draft: 'ไม่ควรถูกใช้', links: [], skipped: 'failed' })
    showAdmin()

    fireEvent.click(screen.getAllByRole('button', { name: copy.admin.sendLine })[0])

    expect(await screen.findByText(copy.sharedLinks.publishFailed)).toBeTruthy()
    expect(api.openLine).not.toHaveBeenCalled()
    expect(store.current.messages.find(m => m.id === message.id)!.draft).toBe(message.draft)
    expect(store.current.sending).toBeUndefined()
  })

  it('ลิงก์ที่ครูปิดไปแล้ว: ไม่ส่ง เขียนร่างใหม่พร้อมลิงก์ใหม่ให้ แล้วบอกให้กดส่งอีกครั้ง', async () => {
    // ครูแก้ข้อความไว้เอง ร่างจึงถูกแช่ไม่ให้ refreshDrafts เขียนทับ — ต้องถูกปลดล็อกให้เอง
    const message = linkedDraft(store.current)
    store.current = {
      ...store.current,
      messages: store.current.messages.map(m => m.id === message.id ? { ...m, edited: true } : m),
    }
    api.secureDraft.mockResolvedValue({ draft: 'ไม่ควรถูกใช้', links: [], skipped: 'stale' })
    showAdmin()

    fireEvent.click(screen.getAllByRole('button', { name: copy.admin.sendLine })[0])

    expect(await screen.findByText(copy.sharedLinks.publishStale)).toBeTruthy()
    expect(api.openLine).not.toHaveBeenCalled()
    // ธงแก้เองถูกล้าง ร่างจึงถูกเขียนใหม่จาก ledger พร้อมลิงก์ชุดใหม่ในรอบถัดไป
    await waitFor(() => expect(store.current.messages.find(m => m.id === message.id)!.edited).toBe(false))
    expect(store.current.messages.find(m => m.id === message.id)!.draft).toContain('#/document/')
  })

  it('ปุ่มคัดลอกก็ผ่านการเผยแพร่ชุดเดียวกัน คัดลอกลิงก์ที่ปิดได้ ไม่ใช่ลิงก์ถาวร', async () => {
    // ปุ่มคัดลอกอยู่ในการ์ดยืนยันหลังกดส่ง — เป็นทางที่ครูใช้จริงเมื่อเปิด LINE ไม่ขึ้น
    api.secureDraft.mockImplementation(async (_s, draft) => ({ draft: rewrite(draft), links: [], skipped: null }))
    showAdmin()
    fireEvent.click(screen.getAllByRole('button', { name: copy.admin.sendLine })[0])

    const copyButton = await screen.findByRole('button', { name: copy.admin.copyText })
    fireEvent.click(copyButton)

    await waitFor(() => expect(api.copyText).toHaveBeenCalled())
    expect(String(api.copyText.mock.calls[0][0])).toContain(SECURE)
  })

  it('บิลด์ที่ไม่มีโปรเจกต์ส่งลิงก์รุ่นเดิมได้ แต่ต้องประกาศว่าลิงก์นั้นปิดไม่ได้', async () => {
    api.config = null
    showAdmin()
    expect(screen.getByTestId('insecure-link-notice').textContent).toBe(copy.sharedLinks.insecureNotice)
    expect(screen.queryByTestId('signed-out-link-notice')).toBeNull()
  })

  it('มีโปรเจกต์แต่ยังไม่เข้าสู่ระบบ บอกให้เข้าสู่ระบบก่อน แทนที่จะบอกว่าลิงก์ปิดไม่ได้', async () => {
    api.session = null
    showAdmin()
    expect(screen.getByTestId('signed-out-link-notice').textContent).toContain('90')
    expect(screen.queryByTestId('insecure-link-notice')).toBeNull()
  })

  it('ยังไม่เข้าสู่ระบบ → ส่งได้ตามปกติด้วยลิงก์รุ่นเดิม และหน้าจอประกาศข้อจำกัดไว้แล้ว', async () => {
    // ครูโหมดจริงที่ไม่ได้สมัครบัญชีคือเส้นทางที่แอปรองรับ ห้ามปิดทางส่งบิลของเขา
    const message = linkedDraft(store.current)
    api.secureDraft.mockResolvedValue({ draft: message.draft, links: [], skipped: 'signed-out' })
    showAdmin()

    fireEvent.click(screen.getAllByRole('button', { name: copy.admin.sendLine })[0])

    await waitFor(() => expect(api.openLine).toHaveBeenCalled())
    expect(String(api.openLine.mock.calls[0][0])).toBe(message.draft)
  })

  it('ฐานหลังบ้านยังไม่ได้อัปเดต → ส่งได้ และขึ้นคำเตือนที่บอกว่าเป็นเรื่องของผู้ดูแล', async () => {
    api.secureDraft.mockResolvedValue({ draft: linkedDraft(store.current).draft, links: [], skipped: 'unsupported' })
    showAdmin()

    fireEvent.click(screen.getAllByRole('button', { name: copy.admin.sendLine })[0])

    await waitFor(() => expect(api.openLine).toHaveBeenCalled())
    expect((await screen.findByTestId('unsupported-link-notice')).textContent)
      .toBe(copy.sharedLinks.unsupportedNotice)
  })
})
