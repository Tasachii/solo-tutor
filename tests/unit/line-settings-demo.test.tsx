import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildScenario } from '../../src/core/scenarios'
import LineSettings from '../../src/app/LineSettings'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), rpc: vi.fn(), readChannel: vi.fn(), deliveryTarget: vi.fn(), syncClients: vi.fn(),
}))

vi.mock('../../src/core/store', async original => ({
  ...await original<typeof import('../../src/core/store')>(),
  useStore: () => ({ state: buildScenario('default'), dispatch: vi.fn() }),
}))
vi.mock('../../src/app/CloudSync', () => ({
  useCloudSync: () => ({ refreshSession: vi.fn(), signOutDevice: vi.fn() }),
}))
vi.mock('../../src/integrations/supabaseRest', async original => ({
  ...await original<typeof import('../../src/integrations/supabaseRest')>(),
  getSession: () => null, getSupabaseConfig: () => ({ url: 'https://example.test', publishableKey: 'public' }),
  invoke: mocks.invoke, rpc: mocks.rpc,
}))
vi.mock('../../src/integrations/lineApi', async original => ({
  ...await original<typeof import('../../src/integrations/lineApi')>(),
  readChannel: mocks.readChannel, deliveryTarget: mocks.deliveryTarget, syncClients: mocks.syncClients,
}))

beforeEach(() => Object.values(mocks).forEach(mock => mock.mockReset()))
afterEach(cleanup)

describe('หน้า LINE OA ในโหมดเดโม', () => {
  // กติกาจากเจ้าของ: ปุ่มที่กดแล้วไม่เกิดของจริง ห้ามมี
  it('ไม่มีปุ่มจำลอง ไม่มีสถานะจำลอง และไม่เรียก Supabase หรือ LINE เลย', () => {
    render(<MemoryRouter><LineSettings /></MemoryRouter>)
    expect(screen.getByRole('status').textContent).toContain('ไม่มีรหัสจริงให้ใช้')
    expect(document.body.textContent).not.toContain('จำลอง')
    expect(screen.queryByRole('button', { name: /จำลอง/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'ดูร่างบิลในหน้าแอดมิน' }).getAttribute('href')).toBe('/app/admin')
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.readChannel).not.toHaveBeenCalled()
    expect(mocks.deliveryTarget).not.toHaveBeenCalled()
    expect(mocks.syncClients).not.toHaveBeenCalled()
  })

  // เจ้าของโปรเจกต์เคยคัดลอกเลขตัวอย่างเดิม (482731) ไปพิมพ์ในแชท OA จริง แล้วได้ "รหัสไม่ถูกต้อง" กลับมา
  it('ไม่แสดงเลข 6 หลักที่หน้าตาเหมือนรหัสจริง', () => {
    render(<MemoryRouter><LineSettings /></MemoryRouter>)
    expect(document.body.textContent).not.toMatch(/\b\d{6}\b/)
  })

  // นอก AppShell ไม่มีตัวเปิดชีทยืนยัน — ต้องไม่พังและไม่โชว์ปุ่มที่กดแล้วไม่มีอะไรเกิด
  it('นอก AppShell ไม่มีปุ่มเริ่มใช้จริง (ไม่มี outlet context ให้เรียก)', () => {
    render(<MemoryRouter><LineSettings /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'เริ่มใช้จริง' })).toBeNull()
  })

  // ใน AppShell ปุ่มต้องเรียกตัวเปิดชีทยืนยันของ shell ไม่ใช่เปลี่ยนโหมดเองเงียบ ๆ
  it('ใน AppShell กดเริ่มใช้จริงจากหน้านี้ได้เลย โดยส่งต่อให้ shell เปิดชีทยืนยัน', async () => {
    const { Outlet, Route, Routes } = await import('react-router-dom')
    const startReal = vi.fn()
    render(
      <MemoryRouter initialEntries={['/app/settings/line']}>
        <Routes>
          <Route element={<Outlet context={{ startReal }} />}>
            <Route path="/app/settings/line" element={<LineSettings />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มใช้จริง' }))
    expect(startReal).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
