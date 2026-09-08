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

describe('LINE demo walkthrough isolation', () => {
  it('simulates pairing locally without calling Supabase or LINE', () => {
    render(<MemoryRouter><LineSettings /></MemoryRouter>)
    expect(screen.getByRole('status').textContent).toContain('ไม่ส่งข้อความไป LINE จริง')
    expect(screen.getByText('ยังไม่เชื่อม (จำลอง)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'จำลองผู้ปกครองพิมพ์รหัส' }))
    expect(screen.getByText('เชื่อมแล้ว (จำลอง)')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'ดูร่างบิลในหน้าแอดมิน' }).getAttribute('href')).toBe('/app/admin')
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.readChannel).not.toHaveBeenCalled()
    expect(mocks.deliveryTarget).not.toHaveBeenCalled()
    expect(mocks.syncClients).not.toHaveBeenCalled()
  })
})
