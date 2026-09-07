import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildScenario } from '../../src/core/scenarios'
import { ToastProvider } from '../../src/app/components/Toast'
import WaitlistSheet from '../../src/platform/WaitlistSheet'
import Admin from '../../src/app/Admin'
import { deriveDrafts } from '../../src/core/messages'
import { copy } from '../../src/copy'

const mocks = vi.hoisted(() => ({ state: null as unknown as ReturnType<typeof buildScenario> }))
vi.mock('../../src/core/store', () => ({
  useStore: () => ({ state: mocks.state,
    dispatch: () => false, track: () => {}, hydrated: true }),
}))
afterEach(cleanup)
beforeEach(() => {
  const state = buildScenario('default')
  mocks.state = { ...state, mode: 'real', messages: deriveDrafts(state) }
})

describe('failed durable writes preserve user input and explain failure', () => {
  it('does not acknowledge a waitlist submission that was not saved', () => {
    render(<WaitlistSheet onClose={() => {}} />)
    const fields = screen.getAllByRole('textbox')
    fireEvent.change(fields[0], { target: { value: 'QA Interested' } })
    fireEvent.change(fields[1], { target: { value: 'qa-contact' } })
    fireEvent.click(screen.getByRole('button', { name: /บันทึก|ส่งข้อมูล|แจ้ง/ }))
    expect(screen.getByRole('alert').textContent).toContain('บันทึกไม่สำเร็จ')
    expect((fields[0] as HTMLInputElement).value).toBe('QA Interested')
    expect(screen.queryByText('บันทึกข้อมูลไว้ในเครื่องแล้ว')).toBeNull()
  })

  it('keeps an edited message open when saving is refused', () => {
    render(<MemoryRouter><ToastProvider><Admin /></ToastProvider></MemoryRouter>)
    fireEvent.click(screen.getAllByRole('button', { name: 'แก้' })[0])
    const field = screen.getByRole('textbox')
    fireEvent.change(field, { target: { value: 'QA unsaved draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('QA unsaved draft')
    expect(screen.getAllByRole('alert').some(node => node.textContent?.includes('บันทึกไม่สำเร็จ'))).toBe(true)
  })

  it('keeps the customer question when its reply draft was not saved', () => {
    render(<MemoryRouter initialEntries={['/?tab=chat&chat=c1']}><ToastProvider><Admin /></ToastProvider></MemoryRouter>)
    const field = screen.getByRole('textbox', { name: copy.admin.realAskLabel })
    fireEvent.change(field, { target: { value: 'เดือนนี้เท่าไร' } })
    fireEvent.click(screen.getByRole('button', { name: 'ร่างคำตอบ' }))
    expect((field as HTMLInputElement).value).toBe('เดือนนี้เท่าไร')
    expect(screen.getByRole('alert').textContent).toContain('บันทึกไม่สำเร็จ')
  })
})
