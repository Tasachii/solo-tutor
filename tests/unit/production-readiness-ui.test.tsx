import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import appSource from '../../src/App.tsx?raw'
import shellSource from '../../src/app/AppShell.tsx?raw'
import { buildScenario } from '../../src/core/scenarios'
import { parsePrice } from '../../src/core/importTable'
import { validLegalName, validSoloPromptPay, validSupportContact } from '../../src/platform/config'
import { readPlanIntent, rememberPlanIntent, validPaidPlanMonths } from '../../src/platform/plans'
import StylePicker from '../../src/platform/StylePicker'
import Onboarding from '../../src/app/Onboarding'

const mocks = vi.hoisted(() => ({
  state: null as unknown as ReturnType<typeof buildScenario>,
  dispatch: vi.fn(() => true), resetDemo: vi.fn(() => true), track: vi.fn(),
}))

vi.mock('../../src/core/store', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/store')>('../../src/core/store')
  return { ...actual, useStore: () => ({ state: mocks.state, dispatch: mocks.dispatch, resetDemo: mocks.resetDemo, track: mocks.track }) }
})

beforeEach(() => {
  mocks.state = buildScenario('default')
  mocks.dispatch.mockClear(); mocks.resetDemo.mockClear(); mocks.track.mockClear()
  sessionStorage.clear()
})
afterEach(cleanup)

describe('production configuration fails closed', () => {
  it('accepts only real-looking support, legal identity, and PromptPay values', () => {
    expect(validSupportContact('owner@solo.test')).toBe('owner@solo.test')
    expect(validSupportContact('https://line.me/R/ti/p/@solo')).toBe('https://line.me/R/ti/p/@solo')
    expect(validSupportContact('TODO@example.com')).toBe('')
    expect(validSupportContact('http://insecure.test')).toBe('')
    expect(validLegalName(' บริษัท โซโล ติวเตอร์ จำกัด ')).toBe('บริษัท โซโล ติวเตอร์ จำกัด')
    expect(validLegalName('TODO')).toBe('')
    expect(validSoloPromptPay('081-234-5678')).toBe('0812345678')
    expect(validSoloPromptPay('08x-xxx-xxxx')).toBe('')
  })
})

describe('paid-plan intent survives setup without erasing demo behavior', () => {
  it('stores only supported paid durations', () => {
    expect(validPaidPlanMonths('3')).toBe(3)
    expect(validPaidPlanMonths('2')).toBeNull()
    rememberPlanIntent(12)
    expect(readPlanIntent()).toBe(12)
    rememberPlanIntent(null)
    expect(readPlanIntent()).toBeNull()
  })

  it('keeps the existing demo scenario switch and never starts real mode implicitly', () => {
    render(<MemoryRouter initialEntries={['/start?plan=3']}><StylePicker /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /เริ่มแบบนี้ รายครั้ง/ }))
    expect(mocks.resetDemo).toHaveBeenCalledWith('per-unit')
    expect(mocks.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'startReal' }))
    expect(readPlanIntent()).toBe(3)
  })

  it('changes only style when an existing real workspace follows a paid-plan link', () => {
    mocks.state = { ...buildScenario('default'), mode: 'real' }
    render(<MemoryRouter initialEntries={['/start?plan=12']}><StylePicker /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /เริ่มแบบนี้ เหมารายเดือน/ }))
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'setStyle', style: 'flat_monthly' })
    expect(mocks.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'startReal' }))
    expect(mocks.resetDemo).not.toHaveBeenCalled()
  })
})

describe('money input safety', () => {
  it('rejects decimal prices from imported files instead of rounding them', () => {
    expect(parsePrice('400.4')).toBeUndefined()
    expect(parsePrice('1,200 บาท')).toBe(1200)
  })

  it('does not let onboarding skip save an invalid decimal price', () => {
    mocks.state = buildScenario('empty')
    render(<MemoryRouter initialEntries={['/app/onboarding']}><Onboarding /></MemoryRouter>)
    const firstStepInputs = screen.getAllByRole('textbox')
    fireEvent.change(firstStepInputs[0], { target: { value: 'ครูมายด์' } })
    fireEvent.change(firstStepInputs[1], { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'ครับ' }))
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }))
    const priceInput = document.querySelector('input[inputmode="numeric"]') as HTMLInputElement
    fireEvent.change(priceInput, { target: { value: '12.5' } })
    fireEvent.click(screen.getByRole('button', { name: /ข้ามไปก่อน/ }))
    expect(screen.getByRole('alert').textContent).toContain('ใส่ตัวเลขมากกว่า 0')
    expect(mocks.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'finishOnboarding' }))
  })
})

describe('storage recovery is provider-only', () => {
  it('does not mount StorageStatus at the public router root', () => {
    expect(appSource).not.toContain("import StorageStatus")
    expect(appSource).not.toContain('<StorageStatus')
    expect(shellSource).toContain('if (didReset) return <StorageStatus />')
  })
})
