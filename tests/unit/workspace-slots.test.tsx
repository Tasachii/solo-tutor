import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import {
  ACTIVE_MODE_KEY, DEMO_SLOT_KEY, REAL_SLOT_KEY, StoreProvider, SCHEMA, useStore,
} from '../../src/core/store'
import { buildScenario } from '../../src/core/scenarios'
import { ledgerFingerprint, packSnapshot, writePrePullBackup } from '../../src/core/cloudSync'
import { fromBackup, toBackup } from '../../src/core/backup'
import type { AppState } from '../../src/core/types'

let store!: ReturnType<typeof useStore>
function Probe() { store = useStore(); return null }
const mount = () => render(<StoreProvider><Probe /></StoreProvider>)
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); history.replaceState({}, '', '/') })

const read = (key: string): AppState => JSON.parse(localStorage.getItem(key)!) as AppState
/** ตัวชี้วัดที่โจทย์ขอ: จำนวนรายการ + ลายนิ้วมือเนื้อหา ต้องไม่ขยับหลังรีเซ็ตเดโม */
/** ตารางที่ครูกรอกเอง — ใช้เทียบตอนย้ายช่อง ซึ่ง store จะ normalize ร่างข้อความใหม่เสมอ */
const ledger = (s: AppState) => ({
  clients: s.clients.map(x => x.id), subjects: s.subjects.map(x => x.id),
  invoices: s.invoices.map(x => x.id), payments: s.payments.map(x => x.id),
  receipts: s.receipts.map(x => x.id), completions: s.completions.length,
})
const shape = (s: AppState) => ({
  subjects: s.subjects.length, clients: s.clients.length, invoices: s.invoices.length,
  payments: s.payments.length, receipts: s.receipts.length, fingerprint: ledgerFingerprint(s),
})

/** สมุดบัญชีจริงที่มีข้อมูลจริงของครู — สร้างผ่าน store ไม่ใช่ยัด JSON เอง */
async function enterRealWithData(): Promise<void> {
  mount()
  await waitFor(() => expect(store.writeStatus).toBe('writable'))
  act(() => { expect(store.dispatch({ type: 'startReal' })).toBe(true) })
  await waitFor(() => expect(store.writeStatus).toBe('writable'))
  act(() => {
    expect(store.dispatch({
      type: 'finishOnboarding',
      provider: { name: 'ครูพลอย', promptpayId: '0891234567' },
      rows: [{ name: 'น้องจริง', clientName: 'คุณแม่จริง' }, { name: 'น้องจริงสอง', clientName: 'คุณพ่อจริง' }],
      billing: { mode: 'per_unit', rate: 550 },
    })).toBe(true)
  })
  expect(store.state.mode).toBe('real')
  expect(store.state.subjects).toHaveLength(2)
}

describe('ช่องเก็บข้อมูลของเดโมกับของจริงแยกกัน', () => {
  it('เดโมยังโชว์ร่างค้าง 3 ใบเท่าเดิม', async () => {
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    expect(store.state.messages.filter(m => m.status === 'draft')).toHaveLength(3)
  })

  it('เริ่มใช้จริงไม่ลบเดโม และเดโมไม่ลบสมุดบัญชีจริง — คนละคีย์', async () => {
    await enterRealWithData()
    expect(read(DEMO_SLOT_KEY).mode).toBe('demo')
    expect(read(DEMO_SLOT_KEY).subjects.length).toBeGreaterThan(0)
    expect(read(REAL_SLOT_KEY).mode).toBe('real')
    expect(localStorage.getItem(ACTIVE_MODE_KEY)).toBe('real')
  })

  it('รีเซ็ตเดโมไม่แตะสมุดบัญชีจริงเลย — จำนวนรายการและลายนิ้วมือเท่าเดิม', async () => {
    await enterRealWithData()
    const before = shape(read(REAL_SLOT_KEY))

    act(() => { expect(store.backToDemo()).toBe(true) })
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    expect(store.state.mode).toBe('demo')

    act(() => { expect(store.resetDemo('package-heavy')).toBe(true) })
    act(() => { expect(store.resetDemo('default')).toBe(true) })

    expect(shape(read(REAL_SLOT_KEY))).toEqual(before)
  })

  it('รีเซ็ตเดโมจากโหมดใช้จริงถูกปฏิเสธ ไม่ว่า UI จะเผลอเรียกหรือไม่', async () => {
    await enterRealWithData()
    const before = shape(store.state)
    act(() => { expect(store.resetDemo('default')).toBe(false) })
    expect(shape(store.state)).toEqual(before)
    expect(read(REAL_SLOT_KEY).mode).toBe('real')
  })

  it('เดโม → ใช้จริง → เดโม ได้เดโมชุดเดิมที่ทำค้างไว้กลับมา', async () => {
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    const clientId = store.state.clients[0].id
    act(() => { expect(store.dispatch({ type: 'chat', clientId, from: 'provider', text: 'งานที่ทำไว้ตอนสาธิต' })).toBe(true) })
    const demoBefore = shape(store.state)

    act(() => { expect(store.dispatch({ type: 'startReal' })).toBe(true) })
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    expect(store.state.mode).toBe('real')

    act(() => { expect(store.backToDemo()).toBe(true) })
    await waitFor(() => expect(store.writeStatus).toBe('writable'))

    expect(store.state.mode).toBe('demo')
    expect(store.state.chats.some(c => c.text === 'งานที่ทำไว้ตอนสาธิต')).toBe(true)
    expect(shape(store.state)).toEqual(demoBefore)
  })

  it('ใช้จริง → เดโม → ใช้จริง ได้สมุดบัญชีจริงคืนครบ ไม่ใช่เริ่มจากศูนย์', async () => {
    await enterRealWithData()
    const realBefore = shape(store.state)

    act(() => { expect(store.backToDemo()).toBe(true) })
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    act(() => { expect(store.dispatch({ type: 'startReal' })).toBe(true) })
    await waitFor(() => expect(store.writeStatus).toBe('writable'))

    expect(store.state.mode).toBe('real')
    expect(store.state.subjects.map(s => s.name)).toEqual(['น้องจริง', 'น้องจริงสอง'])
    expect(shape(store.state)).toEqual(realBefore)
  })

  it('STORAGE_KEY ที่จอพังอ่าน ชี้ไปช่องที่ครูอยู่จริง ไม่ใช่ช่องที่โมดูลเปิดมาตอนโหลด', async () => {
    const store0 = await import('../../src/core/store')
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    expect(store0.STORAGE_KEY).toBe(DEMO_SLOT_KEY)
    act(() => { expect(store.dispatch({ type: 'startReal' })).toBe(true) })
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    // ES module binding เป็นแบบ live — ErrorBoundary ที่ import ค่านี้ต้องเห็นช่องของโหมดจริง
    expect(store0.STORAGE_KEY).toBe(REAL_SLOT_KEY)
    expect(JSON.parse(localStorage.getItem(store0.STORAGE_KEY)!).mode).toBe('real')
  })

  it('สลับช่องนับเป็นการยกสมุดบัญชี ตัวนับการใช้งานจึงตั้งฐานใหม่', async () => {
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    const before = store.ledgerReplacements
    act(() => { expect(store.dispatch({ type: 'startReal' })).toBe(true) })
    expect(store.ledgerReplacements).toBeGreaterThan(before)
  })
})

describe('เครื่องเดิมที่มีคีย์เดียว ย้ายมาช่องใหม่โดยไม่เสียข้อมูล', () => {
  it('เครื่องที่ค้างอยู่โหมดเดโม อยู่ช่องเดโมและครบเหมือนเดิม', async () => {
    const legacy = { ...buildScenario('package-heavy') }
    localStorage.setItem(DEMO_SLOT_KEY, JSON.stringify(legacy))
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    expect(store.state.mode).toBe('demo')
    expect(store.state.scenarioId).toBe('package-heavy')
    expect(store.state.subjects.map(s => s.id)).toEqual(legacy.subjects.map(s => s.id))
    expect(localStorage.getItem(ACTIVE_MODE_KEY)).toBe('demo')
    expect(localStorage.getItem(REAL_SLOT_KEY)).toBeNull()
  })

  it('เครื่องที่ค้างอยู่โหมดจริง ย้ายสมุดบัญชีไปช่องจริงและล้างคีย์เดิม', async () => {
    const legacy: AppState = { ...buildScenario('default'), mode: 'real', scenarioId: 'real', schemaVersion: SCHEMA as 5 }
    const before = ledger(legacy)
    localStorage.setItem(DEMO_SLOT_KEY, JSON.stringify(legacy))
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))

    expect(store.state.mode).toBe('real')
    expect(ledger(store.state)).toEqual(before)
    expect(localStorage.getItem(ACTIVE_MODE_KEY)).toBe('real')
    expect(read(REAL_SLOT_KEY).mode).toBe('real')
    // คีย์เดิมกลายเป็นช่องเดโม — ข้อมูลจริงต้องไม่ค้างอยู่ในนั้นให้เดโมทับ
    const demoSlot = localStorage.getItem(DEMO_SLOT_KEY)
    expect(demoSlot === null || JSON.parse(demoSlot).mode === 'demo').toBe(true)
  })

  it('คีย์เดิมที่อ่านไม่ออก ไม่ถูกลบและยังเข้าเส้นทางกู้คืนเหมือนเดิม', () => {
    localStorage.setItem(DEMO_SLOT_KEY, '{broken')
    mount()
    act(() => { expect(store.dispatch({ type: 'track', name: 'app_open' })).toBe(false) })
    expect(localStorage.getItem(DEMO_SLOT_KEY)).toBe('{broken')
    expect(store.recoveryRaw).toBe('{broken')
    expect(store.didReset).toBe(true)
  })

  it('ย้ายแล้วเปิดใหม่ ไม่ย้ายซ้ำและไม่เปลี่ยนช่อง', async () => {
    localStorage.setItem(DEMO_SLOT_KEY, JSON.stringify({ ...buildScenario('default'), mode: 'real', scenarioId: 'real' }))
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    const afterFirst = localStorage.getItem(REAL_SLOT_KEY)
    cleanup()

    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    expect(store.state.mode).toBe('real')
    expect(ledger(store.state)).toEqual(ledger(JSON.parse(afterFirst!) as AppState))
  })
})

describe('สองแท็บคนละโหมด เขียนพร้อมกันได้และไม่ทับกัน', () => {
  it('แท็บเดโมกับแท็บใช้จริงต่างเป็นผู้เขียนของช่องตัวเอง', async () => {
    const tabs: Record<string, ReturnType<typeof useStore>> = {}
    function Tab({ id }: { id: string }) { tabs[id] = useStore(); return null }

    render(<StoreProvider><Tab id="demo" /></StoreProvider>)
    await waitFor(() => expect(tabs.demo.writeStatus).toBe('writable'))
    expect(tabs.demo.state.mode).toBe('demo')

    // แท็บที่สองเปิดมาที่โหมดจริง (pointer ชี้ไว้แล้ว) — ล็อกคนละดอกจึงได้สิทธิ์เขียนพร้อมกัน
    localStorage.setItem(REAL_SLOT_KEY, JSON.stringify({ ...buildScenario('default'), mode: 'real', scenarioId: 'real' }))
    localStorage.setItem(ACTIVE_MODE_KEY, 'real')
    render(<StoreProvider><Tab id="real" /></StoreProvider>)
    await waitFor(() => expect(tabs.real.writeStatus).toBe('writable'))
    expect(tabs.real.state.mode).toBe('real')

    const realBefore = shape(read(REAL_SLOT_KEY))
    act(() => { expect(tabs.demo.resetDemo('per-unit')).toBe(true) })
    expect(shape(read(REAL_SLOT_KEY))).toEqual(realBefore)

    const demoBefore = shape(read(DEMO_SLOT_KEY))
    act(() => { expect(tabs.real.dispatch({ type: 'track', name: 'real-tab-work' })).toBe(true) })
    expect(shape(read(DEMO_SLOT_KEY))).toEqual(demoBefore)

    expect(read(DEMO_SLOT_KEY).mode).toBe('demo')
    expect(read(REAL_SLOT_KEY).mode).toBe('real')
    expect(read(REAL_SLOT_KEY).events.some(e => e.name === 'real-tab-work')).toBe(true)
  })

  it('ข้อความ storage ของอีกช่องไม่ทำให้แท็บนี้เปลี่ยนข้อมูล', async () => {
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    const before = shape(store.state)
    const foreign = JSON.stringify({ ...buildScenario('default'), mode: 'real', scenarioId: 'real' })
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: REAL_SLOT_KEY, newValue: foreign })) })
    expect(shape(store.state)).toEqual(before)
    expect(store.state.mode).toBe('demo')
  })
})

describe('ไฟล์สำรองและคลาวด์ยังทำงานกับสมุดบัญชีจริงเท่านั้น', () => {
  it('สำรองแล้วกู้คืนสมุดบัญชีจริงได้ครบเหมือนเดิม', async () => {
    await enterRealWithData()
    const exported = toBackup(store.state, new Date().toISOString())
    const before = shape(store.state)

    act(() => { expect(store.dispatch({ type: 'clearMessages' })).toBe(true) })
    const parsed = fromBackup(exported, SCHEMA)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    act(() => { expect(store.dispatch({ type: 'restore', state: parsed.state })).toBe(true) })

    expect(store.state.mode).toBe('real')
    expect(shape(store.state)).toEqual(before)
    expect(read(REAL_SLOT_KEY).mode).toBe('real')
  })

  it('กู้คืนไฟล์เดโมขณะอยู่โหมดจริง ลงช่องเดโม ไม่ทับสมุดบัญชีจริง', async () => {
    await enterRealWithData()
    const realBefore = shape(read(REAL_SLOT_KEY))
    const demoFile = buildScenario('flat-heavy')

    act(() => { expect(store.dispatch({ type: 'restore', state: demoFile })).toBe(true) })
    await waitFor(() => expect(store.writeStatus).toBe('writable'))

    expect(store.state.mode).toBe('demo')
    expect(store.state.scenarioId).toBe('flat-heavy')
    expect(shape(read(REAL_SLOT_KEY))).toEqual(realBefore)
  })

  it('คลาวด์ไม่มีทางรับข้อมูลเดโม', async () => {
    const demo = buildScenario('default')
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await expect(packSnapshot(demo, key, new Date().toISOString())).rejects.toThrow()
    expect(writePrePullBackup(demo, new Date().toISOString())).toBe(false)

    const real: AppState = { ...demo, mode: 'real', scenarioId: 'real' }
    await expect(packSnapshot(real, key, new Date().toISOString())).resolves.toBeTruthy()
    expect(writePrePullBackup(real, new Date().toISOString())).toBe(true)
  })

  it('แท็บเดโมไม่เขียนอะไรลงช่องของสมุดบัญชีจริงเลย', async () => {
    localStorage.setItem(REAL_SLOT_KEY, JSON.stringify({ ...buildScenario('default'), mode: 'real', scenarioId: 'real' }))
    localStorage.setItem(ACTIVE_MODE_KEY, 'demo')
    const untouched = localStorage.getItem(REAL_SLOT_KEY)
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    act(() => { store.dispatch({ type: 'chat', clientId: store.state.clients[0].id, from: 'provider', text: 'เดโม' }) })
    act(() => { store.resetDemo('per-unit') })
    expect(localStorage.getItem(REAL_SLOT_KEY)).toBe(untouched)
  })
})

describe('การลบบัญชีแตะเฉพาะ workspace จริง', () => {
  it('แท็บที่กำลังดูเดโมไม่ถูกหลุมฝังศพของบัญชีดึงไป', async () => {
    localStorage.setItem(REAL_SLOT_KEY, JSON.stringify({ ...buildScenario('default'), mode: 'real', scenarioId: 'real' }))
    localStorage.setItem(ACTIVE_MODE_KEY, 'demo')
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    const before = shape(store.state)

    const tombstone = JSON.stringify({ version: 1, state: { ...buildScenario('empty'), mode: 'real', scenarioId: 'real',
      clients: [], subjects: [], units: [], completions: [], invoices: [], payments: [], receipts: [], messages: [], chats: [], homework: [] } })
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'solo-tutor:account-deleted', newValue: tombstone })) })

    expect(store.state.mode).toBe('demo')
    expect(shape(store.state)).toEqual(before)
  })

  it('ลบบัญชีจากแท็บที่อยู่เดโมถูกปฏิเสธ', async () => {
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    expect(store.state.mode).toBe('demo')
    act(() => { expect(store.dispatch({ type: 'deleteAccountLocal' })).toBe(false) })
    expect(store.state.subjects.length).toBeGreaterThan(0)
  })
})

describe('ทางออกของครูเมื่อแท็บยังเขียนไม่ได้ หรืออยู่ผิด workspace', () => {
  it('ลบบัญชีจากแท็บที่อยู่เดโมถูกหยุด "ก่อน" ยิงลบบนเซิร์ฟเวอร์ และบอกวิธีไปต่อ', async () => {
    localStorage.setItem(REAL_SLOT_KEY, JSON.stringify({ ...buildScenario('default'), mode: 'real', scenarioId: 'real' }))
    localStorage.setItem(ACTIVE_MODE_KEY, 'demo')
    const untouched = localStorage.getItem(REAL_SLOT_KEY)
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    expect(store.state.mode).toBe('demo')

    // prepare คือด่านก่อนการลบที่ย้อนไม่ได้ — ต้องคืน false ที่นี่ ไม่ใช่ไปตกตอน commit
    act(() => { expect(store.prepareAccountDeletion()).toBe(false) })
    expect(store.persistenceError).toContain('เริ่มใช้จริง')
    expect(localStorage.getItem('solo-tutor:account-deleted')).toBeNull()
    expect(localStorage.getItem(REAL_SLOT_KEY)).toBe(untouched)
  })

  it('สลับไปโหมดจริงแล้วลบบัญชีได้ตามปกติ ไม่ต้องรู้เรื่องช่องเก็บข้อมูล', async () => {
    localStorage.setItem(REAL_SLOT_KEY, JSON.stringify({ ...buildScenario('default'), mode: 'real', scenarioId: 'real' }))
    localStorage.setItem(ACTIVE_MODE_KEY, 'demo')
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))

    act(() => { expect(store.dispatch({ type: 'startReal' })).toBe(true) })
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    expect(store.state.mode).toBe('real')

    let result: 'cleared' | 'local-retained' | undefined
    act(() => {
      expect(store.prepareAccountDeletion()).toBe(true)
      result = store.commitAccountDeletion()
    })
    expect(result).toBe('cleared')
    expect(read(REAL_SLOT_KEY).subjects).toEqual([])
    // เดโมไม่เกี่ยวกับบัญชี ต้องอยู่ครบ
    expect(read(DEMO_SLOT_KEY).mode).toBe('demo')
    expect(read(DEMO_SLOT_KEY).subjects.length).toBeGreaterThan(0)
  })

  it('อีกแท็บถือช่องจริงอยู่ — แท็บที่สลับมาไม่เงียบ บอกว่ายังเขียนไม่ได้ และไม่แตะข้อมูล', async () => {
    localStorage.setItem(REAL_SLOT_KEY, JSON.stringify({ ...buildScenario('default'), mode: 'real', scenarioId: 'real' }))
    localStorage.setItem(ACTIVE_MODE_KEY, 'real')
    const tabs: Record<string, ReturnType<typeof useStore>> = {}
    function Tab({ id }: { id: string }) { tabs[id] = useStore(); return null }
    const owner = render(<StoreProvider><Tab id="owner" /></StoreProvider>)
    await waitFor(() => expect(tabs.owner.writeStatus).toBe('writable'))
    expect(tabs.owner.state.mode).toBe('real')
    const realBefore = localStorage.getItem(REAL_SLOT_KEY)

    localStorage.setItem(ACTIVE_MODE_KEY, 'demo')
    render(<StoreProvider><Tab id="visitor" /></StoreProvider>)
    await waitFor(() => expect(tabs.visitor.writeStatus).toBe('writable'))
    expect(tabs.visitor.state.mode).toBe('demo')

    act(() => { expect(tabs.visitor.dispatch({ type: 'startReal' })).toBe(true) })
    expect(tabs.visitor.state.mode).toBe('real')
    // ล็อกยังอยู่กับอีกแท็บ — สถานะต้องบอกว่ากำลังรอ ไม่ใช่เงียบแล้วปล่อยให้กดต่อ
    expect(tabs.visitor.writeStatus).toBe('acquiring')
    act(() => { expect(tabs.visitor.dispatch({ type: 'track', name: 'must-not-write' })).toBe(false) })
    expect(tabs.visitor.persistenceError).toBeTruthy()
    expect(localStorage.getItem(REAL_SLOT_KEY)).toBe(realBefore)

    // แท็บเจ้าของปิดไป สิทธิ์ย้ายมาเอง ไม่ต้องโหลดหน้าใหม่
    owner.unmount()
    await waitFor(() => expect(tabs.visitor.writeStatus).toBe('writable'))
    act(() => { expect(tabs.visitor.dispatch({ type: 'track', name: 'now-allowed' })).toBe(true) })
    expect(read(REAL_SLOT_KEY).events.some(e => e.name === 'now-allowed')).toBe(true)
  })

  it('หน้าแอปแสดงสถานะการเขียนไว้เหนือเนื้อหาเสมอ ไม่ใช่เฉพาะตอนข้อมูลพัง', async () => {
    const shellSource = (await import('../../src/app/AppShell.tsx?raw')).default
    // จอเต็มสำหรับข้อมูลที่กู้ไม่ได้ ยังอยู่เหมือนเดิม
    expect(shellSource).toContain('if (didReset) return <StorageStatus />')
    // และมีอีกจุดในเชลล์ ไม่งั้นสถานะ acquiring/conflict จะไม่มีที่แสดงเลย
    const shellBody = shellSource.slice(shellSource.indexOf('if (didReset)') + 1)
    expect(shellBody).toContain('<StorageStatus />')
    // Outlet มี props (outlet context) ได้ — ยึดแค่ว่าสถานะการเขียนอยู่ก่อนจุดที่หน้าลูก render
    expect(shellBody.indexOf('<StorageStatus />')).toBeLessThan(shellBody.indexOf('<Outlet'))
  })
})

describe('สำเนาก่อนเขียนทับมีของใครของมัน', () => {
  it('กู้คืนทับเดโมและทับของจริง ไม่ลบสำเนากันเอง', async () => {
    const demoParked = `${DEMO_SLOT_KEY}-before-restore`
    const realParked = `${REAL_SLOT_KEY}-before-restore`
    await enterRealWithData()
    const realBefore = localStorage.getItem(REAL_SLOT_KEY)

    // กู้คืนไฟล์เดโมขณะอยู่โหมดจริง — เขียนทับช่องเดโม จึงเก็บสำเนาเดโมเดิมไว้
    act(() => { expect(store.dispatch({ type: 'restore', state: buildScenario('flat-heavy') })).toBe(true) })
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    expect(store.state.mode).toBe('demo')
    expect(JSON.parse(localStorage.getItem(demoParked)!).mode).toBe('demo')
    expect(localStorage.getItem(realParked)).toBeNull()

    // แล้วกู้คืนไฟล์ของจริงกลับ — เขียนทับช่องจริง สำเนาของเดโมต้องไม่ถูกลบทิ้ง
    const realFile = JSON.parse(realBefore!) as AppState
    act(() => { expect(store.dispatch({ type: 'restore', state: realFile })).toBe(true) })
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    expect(store.state.mode).toBe('real')
    expect(JSON.parse(localStorage.getItem(realParked)!).mode).toBe('real')
    expect(JSON.parse(localStorage.getItem(demoParked)!).mode).toBe('demo')
    expect(demoParked).not.toBe(realParked)
  })

  it('หน้าแอปประกาศสถานะการเขียนไว้บนราก ครูและเทสจึงรู้ว่าบันทึกได้หรือยัง', async () => {
    const shellSource = (await import('../../src/app/AppShell.tsx?raw')).default
    expect(shellSource).toContain('data-write-status={writeStatus}')
  })
})
