import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { buildScenario } from '../../src/core/scenarios'

const track = vi.fn()
vi.mock('../../src/core/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/store')>()
  return { ...actual, useStore: () => ({ state: buildScenario('default'), track }) }
})
vi.mock('../../src/core/usage', () => ({ sendUsage: vi.fn() }))

import App from '../../src/App'

afterEach(() => { cleanup(); track.mockClear() })

describe('route code splitting', () => {
  it('announces route loading and then renders the requested lazy page', async () => {
    render(<MemoryRouter initialEntries={['/pricing']}><App /></MemoryRouter>)
    expect(screen.getByRole('status').textContent).toContain('กำลังเปิดหน้า')
    expect(await screen.findByRole('heading', { level: 1, name: 'ราคา' })).toBeTruthy()
  })
})
