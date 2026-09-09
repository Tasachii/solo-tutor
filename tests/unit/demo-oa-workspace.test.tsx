import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import {
  ACTIVE_MODE_KEY, DEMO_SLOT_KEY, REAL_SLOT_KEY, StoreProvider, useStore,
} from '../../src/core/store'
import { buildScenario } from '../../src/core/scenarios'
import { reducer } from '../../src/core/store'
import type { AppState } from '../../src/core/types'
import { FROZEN_TODAY } from '../setup'

/**
 * สมุด LINE ของช่องเดโมต้องรอดทุกครั้งที่ชุดข้อมูลถูกสร้างใหม่ (`docs/line-oa-v2-plan.md` §4 ขั้น 4)
 *
 * ทำไมสำคัญ: ผู้ปกครองพิมพ์รหัส 6 หลักครั้งเดียว การจับคู่ผูกกับ `lineWorkspaceId`
 * ถ้าสลับชุดข้อมูล/รีเซ็ต/ข้ามเดือนแล้ว id หลุด ครูต้องออกรหัสใหม่ให้ผู้ปกครองกลางเวทีพิทช์
 *
 * และเมื่อบัญชีครูถูกลบ id คู่นี้ต้องหายจากช่องเดโม — สมุด LINE นั้นอยู่ใต้ provider ที่ไม่มีแล้ว
 */
const providerId = '11111111-1111-4111-8111-111111111111'
const workspaceId = '22222222-2222-4222-8222-222222222222'

let store!: ReturnType<typeof useStore>
function Probe() { store = useStore(); return null }
const mount = () => render(<StoreProvider><Probe /></StoreProvider>)
const read = (key: string): AppState => JSON.parse(localStorage.getItem(key)!) as AppState
const on = (date: string) => vi.setSystemTime(new Date(`${date}T09:00:00+07:00`))

/** ช่องเดโมที่ครูเคยเชิญผู้ปกครองไปแล้ว — เขียนตรงเพื่อคุมวันที่ของชุดที่ค้างอยู่ */
const seedPairedDemo = (over: Partial<AppState> = {}): void => {
  localStorage.setItem(DEMO_SLOT_KEY, JSON.stringify({
    ...buildScenario('default'), lineWorkspaceId: workspaceId, lineProviderId: providerId, ...over,
  }))
  localStorage.setItem(ACTIVE_MODE_KEY, 'demo')
}
const recipientId = '33333333-3333-4333-8333-333333333333'
/**
 * ร่างข้อความถูก derive ตอน normalize ไม่ได้อยู่ใน buildScenario ดิบ ๆ — ต้องเดิน reducer ก่อน
 * แล้วค่อยติด oaDelivery ให้ใบหนึ่ง เพื่อจำลอง "ครูกดส่งแล้ว รอยืนยันผล"
 */
const withPendingSend = (): { messages: AppState['messages']; id: string } => {
  const derived = reducer(buildScenario('default'), { type: 'track', name: 'seed' })
  const draft = derived.messages.find(m => m.status === 'draft')!
  return {
    id: draft.id,
    messages: derived.messages.map(m => m.id === draft.id
      ? { ...m, oaDelivery: { providerId, workspaceId, recipientId, dedupeKey: `${workspaceId}:demo:${m.dedupeKey}`, body: m.draft } }
      : m),
  }
}
const ids = (s: AppState) => ({ workspace: s.lineWorkspaceId, provider: s.lineProviderId })
const PAIRED = { workspace: workspaceId, provider: providerId }

afterEach(() => {
  cleanup(); vi.restoreAllMocks(); localStorage.clear()
  history.replaceState({}, '', '/'); on(FROZEN_TODAY)
})

describe('สมุด LINE ของช่องเดโมรอดทุกทางที่สร้างชุดข้อมูลใหม่', () => {
  it('เดโมสร้างสมุด LINE ของตัวเองได้ (โหมดไม่ใช่เงื่อนไขอีกแล้ว)', async () => {
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    expect(store.state.mode).toBe('demo')
    act(() => { expect(store.dispatch({ type: 'lineWorkspace', id: workspaceId, providerId })).toBe(true) })
    expect(ids(store.state)).toEqual(PAIRED)
    expect(ids(read(DEMO_SLOT_KEY))).toEqual(PAIRED)
  })

  it('ข้ามเดือน: ชุดข้อมูลถูกสร้างใหม่ แต่ id ทั้งคู่ยังอยู่', async () => {
    on('2027-03-15')
    seedPairedDemo({ today: '2027-03-15' })
    on('2027-04-02')
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    // พิสูจน์ว่าเป็นชุดใหม่จริง ไม่ใช่ชุดเก่าที่แค่เดินวัน
    expect(store.state.today).toBe('2027-04-02')
    for (const invoice of store.state.invoices) expect(['2027-03', '2027-02', '2027-01']).toContain(invoice.period)
    expect(ids(store.state)).toEqual(PAIRED)
  })

  it('สลับชุดข้อมูลจาก URL (?scenario=): ชุดเปลี่ยน id ไม่เปลี่ยน', async () => {
    seedPairedDemo()
    history.replaceState({}, '', '/?scenario=flat-heavy')
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    expect(store.state.scenarioId).toBe('flat-heavy')
    expect(store.state.clients.every(c => c.id.startsWith('g'))).toBe(true)
    expect(ids(store.state)).toEqual(PAIRED)
    expect(ids(read(DEMO_SLOT_KEY))).toEqual(PAIRED)
  })

  it('รีเซ็ตข้อมูลตัวอย่าง / สลับชุดในเมนู: id ไม่หลุด', async () => {
    seedPairedDemo()
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    act(() => { expect(store.resetDemo('package-heavy')).toBe(true) })
    expect(store.state.scenarioId).toBe('package-heavy')
    expect(ids(store.state)).toEqual(PAIRED)
    act(() => { expect(store.resetDemo()).toBe(true) })
    expect(ids(store.state)).toEqual(PAIRED)
    expect(ids(read(DEMO_SLOT_KEY))).toEqual(PAIRED)
  })

  it('กลับจากโหมดจริงมาที่เดโม: ช่องเดิมชนะเมล็ดใหม่ จึงยังถือ id เดิม', async () => {
    seedPairedDemo()
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    act(() => { expect(store.dispatch({ type: 'startReal' })).toBe(true) })
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    expect(store.state.mode).toBe('real')
    // สมุดบัญชีจริงเริ่มจากศูนย์ — ไม่มี id ของเดโมไหลข้ามช่องมา
    expect(ids(store.state)).toEqual({ workspace: undefined, provider: undefined })

    act(() => { expect(store.backToDemo()).toBe(true) })
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    expect(store.state.mode).toBe('demo')
    expect(ids(store.state)).toEqual(PAIRED)
  })

  it('มีรายการ OA ค้างตรวจ: ข้ามเดือนก็ไม่สร้างชุดใหม่ทับ แค่เดินวันให้ทัน', async () => {
    // reducer กัน replace/restore ไว้แล้ว แต่ทางข้ามเดือนไม่ผ่าน reducer เลย
    // ถ้าสร้างใหม่ทับ การ์ดที่ค้างจะกลับมาเป็นปุ่ม "ส่งใน LINE" แล้วครูแชร์เองซ้ำได้
    on('2027-03-15')
    const pending = withPendingSend()
    seedPairedDemo({ today: '2027-03-15', messages: pending.messages })
    on('2027-04-02')
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    expect(store.state.today).toBe('2027-04-02')
    expect(store.state.messages.find(m => m.id === pending.id)!.oaDelivery).toBeTruthy()
    // ชุดเดิมยังอยู่ ไม่ได้ถูกสร้างใหม่ (บิลยังเป็นของเดือนเก่า)
    expect(store.state.invoices.some(i => i.period === '2027-02')).toBe(true)
    expect(ids(store.state)).toEqual(PAIRED)
  })

  it('มีรายการ OA ค้างตรวจ: ?scenario= ก็ทับไม่ได้ และรีเซ็ตเดโมคืน false', async () => {
    const pending = withPendingSend()
    seedPairedDemo({ messages: pending.messages })
    history.replaceState({}, '', '/?scenario=flat-heavy')
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    expect(store.state.scenarioId).toBe('default')
    expect(store.state.messages.find(m => m.id === pending.id)!.oaDelivery).toBeTruthy()
    // ทางที่ผ่าน reducer ก็ต้องปฏิเสธเหมือนกัน — ครูต้องตรวจผลส่งให้จบก่อน
    act(() => { expect(store.resetDemo('package-heavy')).toBe(false) })
  })

  it('ลบบัญชีครู: id ทั้งคู่หายจากช่องเดโม พร้อมรายการ OA ที่ค้างอยู่ใต้บัญชีนั้น', async () => {
    // แท็บอยู่ในสมุดบัญชีจริง (การลบบัญชีทำได้จากที่นั่นเท่านั้น) ส่วนช่องเดโมยังถือรายการค้างจากรอบก่อน
    // สลับมาด้วย startReal ไม่ได้ตอนมีรายการค้าง (reducer กันไว้ถูกแล้ว) จึงตั้งสองช่องตรง ๆ
    seedPairedDemo({ messages: withPendingSend().messages })
    localStorage.setItem(REAL_SLOT_KEY, JSON.stringify({ ...buildScenario('default'), mode: 'real', scenarioId: 'real' }))
    localStorage.setItem(ACTIVE_MODE_KEY, 'real')
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    expect(store.state.mode).toBe('real')
    expect(ids(read(DEMO_SLOT_KEY))).toEqual(PAIRED)

    let result: ReturnType<typeof store.commitAccountDeletion> | undefined
    act(() => {
      expect(store.prepareAccountDeletion()).toBe(true)
      result = store.commitAccountDeletion()
    })
    expect(result).toBe('cleared')
    expect(ids(read(DEMO_SLOT_KEY))).toEqual({ workspace: undefined, provider: undefined })
    // ไม่เหลือการ์ดที่กดตรวจผลก็ไม่ได้ กดยกเลิกก็ไม่ได้ เพราะบัญชีเจ้าของรายการถูกลบไปแล้ว
    expect(read(DEMO_SLOT_KEY).messages.every(m => !m.oaDelivery)).toBe(true)
    // ข้อมูลตัวอย่างที่เหลือไม่ใช่ของบัญชีใคร จึงต้องไม่ถูกล้างไปด้วย
    expect(read(DEMO_SLOT_KEY).subjects.length).toBeGreaterThan(0)
    expect(read(REAL_SLOT_KEY).subjects).toEqual([])
  })
})
