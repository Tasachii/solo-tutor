import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { buildScenario } from '../../src/core/scenarios'
import type { AppState } from '../../src/core/types'

/**
 * เดโมที่ข้ามเดือนไม่ได้เพราะยังมีข้อความรอผลส่ง — การปฏิเสธถูกแล้ว แต่ต้องมองเห็น
 *
 * ก่อนหน้านี้ครูเห็นแค่ข้อมูลเดือนก่อนค้างอยู่ ไม่มีอะไรบอกว่าทำไม กด "รีเซ็ตข้อมูลตัวอย่าง"
 * ก็ถูกปฏิเสธด้วย toast อีกใบ · คำเตือนอยู่ระดับ shell จึงขึ้นทุกหน้า ไม่ใช่เฉพาะหน้าแอดมิน
 */
const mocks = vi.hoisted(() => ({ state: null as unknown as AppState }))

vi.mock('../../src/core/store', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/store')>('../../src/core/store')
  return {
    ...actual,
    useStore: () => ({
      state: mocks.state, dispatch: () => true, track: () => undefined, mode: mocks.state.mode,
      resetDemo: () => true, backToDemo: () => true, didReset: false, writeStatus: 'writable',
      hydrated: true, persistenceError: null, recoveryRaw: null, ledgerReplacements: 0,
      retryPersistence: () => true,
    }),
  }
})
vi.mock('../../src/app/CloudSync', () => ({
  useCloudSync: () => ({ status: 'idle', session: null, refreshSession: vi.fn(), signOutDevice: vi.fn(() => true) }),
}))

import AppShell from '../../src/app/AppShell'
import { ToastProvider } from '../../src/app/components/Toast'
import { copy } from '../../src/copy'

const providerId = '11111111-1111-4111-8111-111111111111'
const workspaceId = '22222222-2222-4222-8222-222222222222'

/** สมุดตัวอย่างที่ค้างอยู่เดือนก่อน และมีข้อความหนึ่งใบที่ส่ง OA ไปแล้วแต่ยังไม่รู้ผล */
const book = (over: Partial<AppState> = {}): AppState => {
  const base = buildScenario('default')
  const draft = base.messages[0]
  return {
    ...base, today: '2025-08-15', lineWorkspaceId: workspaceId, lineProviderId: providerId,
    messages: base.messages.map(m => m.id === draft?.id
      ? { ...m, oaDelivery: { providerId, workspaceId, recipientId: 'r1', dedupeKey: `${workspaceId}:demo:${m.dedupeKey}`, body: m.draft } }
      : m),
    ...over,
  }
}

const show = () => render(<ToastProvider><MemoryRouter initialEntries={['/app/today']}>
  <Routes><Route path="/app" element={<AppShell />}>
    <Route path="today" element={<p>หน้าวันนี้</p>} />
  </Route></Routes>
</MemoryRouter></ToastProvider>)

beforeEach(() => { mocks.state = book() })
afterEach(cleanup)

describe('คำเตือน "ข้อมูลตัวอย่างยังเป็นชุดของเดือนก่อน"', () => {
  it('ยังมีข้อความรอผลส่ง: บอกเหตุผล พร้อมทางไปตรวจผล', () => {
    show()
    const bar = screen.getByTestId('demo-paused-oa')
    expect(bar.textContent).toContain(copy.demoPaused.pendingOa)
    expect(screen.getByRole('link', { name: copy.demoPaused.cta }).getAttribute('href')).toBe('/app/admin')
  })

  /**
   * `refreshDemoDay` ทำงานตอนเปิดแอปเท่านั้น — ตรวจผลการ์ดใบสุดท้ายเสร็จแล้วข้อมูลยังไม่ขยับ
   * ถ้าคำเตือนหายไปพร้อมการ์ด ครูก็กลับไปเจอปัญหาเดิมที่คำเตือนนี้มีไว้กัน ช้าไปแค่หนึ่งก้าว
   */
  it('ตรวจผลเสร็จแล้วแต่ยังไม่เปิดแอปใหม่: คำเตือนอยู่ต่อ เปลี่ยนเป็นบอกว่าเหลือแค่เปิดใหม่', () => {
    mocks.state = book({ messages: buildScenario('default').messages })
    show()
    const bar = screen.getByTestId('demo-paused-oa')
    expect(bar.textContent).toContain(copy.demoPaused.reopen)
    expect(bar.textContent).not.toContain(copy.demoPaused.pendingOa)
    // ไม่มีอะไรให้ไปกดที่แอดมินแล้ว ลิงก์จึงต้องไม่มี
    expect(screen.queryByRole('link', { name: copy.demoPaused.cta })).toBeNull()
  })

  it('โหมดจริงไม่ขึ้นเลย — สมุดจริงไม่เคยถูกสร้างใหม่ตามเดือน', () => {
    mocks.state = book({ mode: 'real' })
    show()
    expect(screen.queryByTestId('demo-paused-oa')).toBeNull()
  })

  it('เดโมที่ยังอยู่เดือนนี้ไม่ขึ้น แม้มีข้อความรอผลส่ง — ไม่มีอะไรถูกหยุด', () => {
    mocks.state = book({ today: buildScenario('default').today })
    show()
    expect(screen.queryByTestId('demo-paused-oa')).toBeNull()
  })

  it('โหมดจริงที่สมุดคนละเดือนก็ยังไม่ขึ้น แม้ไม่มีข้อความรอผลส่ง', () => {
    mocks.state = book({ mode: 'real', messages: buildScenario('default').messages })
    show()
    expect(screen.queryByTestId('demo-paused-oa')).toBeNull()
  })
})
