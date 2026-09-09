import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildScenario } from '../../src/core/scenarios'
import type { AppState, Message } from '../../src/core/types'
import LineMessageAction from '../../src/app/LineMessageAction'

/**
 * ปุ่มเดียว "ส่งใน LINE" (กติกาเจ้าของ 9 ก.ย.): ครูไม่ต้องรู้ว่าข้างในเป็นทางไหน
 * - ผูก OA แล้ว → ส่งผ่าน OA แล้วจบ
 * - OA ไม่ใช่ทางของผู้รับคนนี้ (ยังไม่ผูก/ไม่มีบัญชี) → เปิดแอป LINE ให้ครูส่งเองแทน ไม่ใช่ error
 * - เผยแพร่ลิงก์ล้ม → ไม่ส่งทางไหนเลย และบอกเหตุผล (กติกา J-05 ต้องไม่ถูกทางลัดข้าม)
 * - โหมดเดโม → ปุ่มเดียวกันคือเปิดแอป LINE ตรง ๆ
 */
const mocks = vi.hoisted(() => ({ send: vi.fn(), available: vi.fn(() => true) }))
vi.mock('../../src/app/oaSend', async (original) => ({
  ...await original<typeof import('../../src/app/oaSend')>(),
  sendMessageViaOa: mocks.send, oaAvailable: mocks.available,
}))
vi.mock('../../src/integrations/supabaseRest', async (original) => ({
  ...await original<typeof import('../../src/integrations/supabaseRest')>(), getSession: () => null, rpc: vi.fn(),
}))
let state: AppState
vi.mock('../../src/core/store', async (original) => ({
  ...await original<typeof import('../../src/core/store')>(),
  useStore: () => ({ state, dispatch: vi.fn(() => true) }),
}))

const message = (): Message => ({ ...buildScenario('default').messages.find((m) => m.status === 'draft')! })
beforeEach(() => { state = { ...buildScenario('default'), mode: 'real' }; mocks.send.mockReset(); mocks.available.mockReset().mockReturnValue(true) })
afterEach(cleanup)

const mount = (m: Message, onFallback = vi.fn(), onSent = vi.fn()) => {
  render(<MemoryRouter><LineMessageAction message={m} onFallback={onFallback} onSent={onSent} /></MemoryRouter>)
  return { onFallback, onSent, click: () => fireEvent.click(screen.getByRole('button', { name: 'ส่งใน LINE' })) }
}

describe('ปุ่มเดียว ส่งใน LINE', () => {
  it('ผูก OA แล้ว → ส่งผ่าน OA แล้วเรียก onSent ไม่เปิดแอป LINE', async () => {
    mocks.send.mockResolvedValue({ status: 'sent' })
    const { onFallback, onSent, click } = mount(message())
    click()
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1))
    expect(onFallback).not.toHaveBeenCalled()
  })

  it('ผู้ปกครองยังไม่ผูก OA → ตกไปเปิดแอป LINE ให้ครูส่งเอง โดยไม่ขึ้น error', async () => {
    mocks.send.mockResolvedValue({ status: 'blocked', reason: 'not-linked', notice: 'ยังไม่เชื่อม OA' })
    const { onFallback, onSent, click } = mount(message())
    click()
    await waitFor(() => expect(onFallback).toHaveBeenCalledTimes(1))
    expect(onSent).not.toHaveBeenCalled()
    expect(screen.queryByText('ยังไม่เชื่อม OA')).toBeNull()
  })

  it('เผยแพร่ลิงก์ล้ม → ไม่ตกไปส่งเอง และบอกเหตุผล', async () => {
    mocks.send.mockResolvedValue({ status: 'blocked', reason: 'publish', notice: 'สร้างลิงก์ไม่สำเร็จ' })
    const { onFallback, click } = mount(message())
    click()
    await waitFor(() => expect(screen.getByText(/สร้างลิงก์ไม่สำเร็จ/)).toBeTruthy())
    expect(onFallback).not.toHaveBeenCalled()
  })

  it('OA ใช้ไม่ได้ในสถานะนี้ (เช่นเดโม) → ปุ่มเดียวกันเปิดแอป LINE ตรง ๆ ไม่แตะ OA', () => {
    mocks.available.mockReturnValue(false)
    const { onFallback, click } = mount(message())
    click()
    expect(onFallback).toHaveBeenCalledTimes(1)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('เน็ตตายก่อนเข้าคิว (offline) → เปิดแอป LINE ให้ครูส่งเอง — ครูบนเวทีที่ไวไฟตายยังส่งได้', async () => {
    mocks.send.mockResolvedValue({ status: 'blocked', reason: 'offline', notice: 'ยังไม่มีรายการใดเริ่มส่ง' })
    const { onFallback, click } = mount(message())
    click()
    await waitFor(() => expect(onFallback).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/ยังไม่มีรายการใดเริ่มส่ง/)).toBeNull()
  })

  it('เน็ตตายหลังเข้าคิวแล้ว (network) → ห้ามเปิดแอป LINE เพราะข้อความอาจถึงผู้รับแล้ว', async () => {
    mocks.send.mockResolvedValue({ status: 'blocked', reason: 'network', notice: 'ห้ามส่งข้อความเดิมซ้ำ' })
    const { onFallback, click } = mount(message())
    click()
    await waitFor(() => expect(screen.getByText(/ห้ามส่งข้อความเดิมซ้ำ/)).toBeTruthy())
    expect(onFallback).not.toHaveBeenCalled()
  })

  it('ไม่มีปุ่มชื่อ "ส่งด้วย LINE OA" อีกแล้ว', () => {
    mount(message())
    expect(screen.queryByRole('button', { name: /LINE OA/ })).toBeNull()
  })
})
