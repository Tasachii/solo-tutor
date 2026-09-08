import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildReal } from '../../src/core/scenarios'
import { reducer } from '../../src/core/store'
import { copy } from '../../src/copy'
import type { AppState, Subject } from '../../src/core/types'

const TODAY = '2026-09-01'

const mocks = vi.hoisted(() => ({ state: null as unknown as AppState, dispatch: vi.fn(() => true) }))

vi.mock('../../src/core/store', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/store')>('../../src/core/store')
  return { ...actual, useStore: () => ({ state: mocks.state, dispatch: mocks.dispatch, hydrated: true }) }
})

const { default: Subjects } = await import('../../src/app/Subjects')

function ledger(): AppState {
  let s: AppState = { ...buildReal({ name: 'ครูเอ', promptpayId: '0812345678' }), today: TODAY, onboarded: true }
  for (const [id, name, clientId, clientName] of [
    ['sub-mint', 'น้องมิ้นท์', 'cli-mint', 'แม่มิ้นท์'],
    ['sub-bow', 'น้องโบว์', 'cli-bow', 'แม่โบว์'],
  ]) {
    const subject: Subject = { id, name, clientId, billing: { mode: 'per_unit', rate: 500 }, active: true, createdAt: TODAY }
    s = reducer(s, { type: 'upsertSubject', subject, clientName })
  }
  return s
}

/** งานที่ทำแล้วหนึ่งคาบ = มีประวัติการเงิน การกดลบจึงกลายเป็นการเก็บแถวไว้ */
function deletedButKept(): AppState {
  let s = reducer(ledger(), { type: 'addUnit', subjectId: 'sub-mint', time: '10:00', date: TODAY })
  s = reducer(s, { type: 'complete', unitId: s.units.find((u) => u.subjectId === 'sub-mint')!.id })
  return reducer(s, { type: 'deleteSubject', subjectId: 'sub-mint' })
}

afterEach(() => cleanup())
beforeEach(() => { mocks.dispatch.mockClear() })

describe('กลุ่มหยุดเรียนแล้วต้องบอกว่าทำไมแถวนี้ยังอยู่', () => {
  it('คนที่ครูกดลบแต่มีบิลผูกอยู่ ต้องเห็นเหตุผลบนหน้าจอ', () => {
    mocks.state = deletedButKept()
    render(<MemoryRouter><Subjects /></MemoryRouter>)
    expect(screen.getByText('น้องมิ้นท์')).toBeTruthy()
    expect(screen.getAllByText(copy.subjects.keptForRecords).length).toBe(1)
  })

  it('คนที่ครูเลือกหยุดเรียนเอง ต้องไม่ถูกบอกว่าเก็บไว้เพราะบิล', () => {
    mocks.state = reducer(ledger(), { type: 'deactivateSubject', subjectId: 'sub-mint' })
    render(<MemoryRouter><Subjects /></MemoryRouter>)
    expect(screen.getByText('น้องมิ้นท์')).toBeTruthy()
    expect(screen.queryByText(copy.subjects.keptForRecords)).toBeNull()
  })
})
