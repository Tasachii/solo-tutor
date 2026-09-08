import { describe, expect, it } from 'vitest'
import {
  DEMO_LOOP_STEPS, countDemoSteps, demoLoopComplete, earnedSteps, emptyStepCounts,
} from '../../src/core/funnel'
import type { EventLog } from '../../src/core/types'

const log = (...names: string[]): EventLog[] => names.map((name) => ({ at: '2026-09-08T03:00:00.000Z', name }))

describe('ลูป Demo — วัดจาก action ที่กดจริง', () => {
  it('นับเฉพาะสองขั้นที่ตกลงไว้ ไม่นับ action อื่นในบันทึกเดียวกัน', () => {
    const counts = countDemoSteps(log('app_open', 'complete_unit', 'theme_switch', 'close_month', 'complete_unit'))
    expect(counts).toEqual({ complete_unit: 2, close_month: 1 })
    expect(countDemoSteps([])).toEqual(emptyStepCounts())
    expect([...DEMO_LOOP_STEPS]).toEqual(['complete_unit', 'close_month'])
  })

  it('ขั้นจะได้มาก็ต่อเมื่อจำนวนเพิ่มขึ้น ไม่ใช่เพราะมีอยู่ในก้อนที่ยกมา', () => {
    const carried = countDemoSteps(log('complete_unit', 'close_month'))
    expect(earnedSteps(carried, carried, [])).toEqual([])
    expect(demoLoopComplete(earnedSteps(carried, carried, []))).toBe(false)
  })

  it('กดครบสองขั้นทีละขั้น ถือว่าครบลูป', () => {
    const start = emptyStepCounts()
    const afterUnit = countDemoSteps(log('complete_unit'))
    const one = earnedSteps(start, afterUnit, [])
    expect(one).toEqual(['complete_unit'])
    expect(demoLoopComplete(one)).toBe(false)
    const afterBill = countDemoSteps(log('complete_unit', 'close_month'))
    const both = earnedSteps(afterUnit, afterBill, one)
    expect(both).toEqual(['complete_unit', 'close_month'])
    expect(demoLoopComplete(both)).toBe(true)
  })

  it('บันทึกที่ถูกตัดจนจำนวนลดลง ไม่ถอนขั้นที่ได้มาแล้วและไม่แจกขั้นใหม่', () => {
    const many = countDemoSteps(log('complete_unit', 'complete_unit', 'close_month'))
    const trimmed = countDemoSteps(log('complete_unit'))
    expect(earnedSteps(many, trimmed, ['complete_unit'])).toEqual(['complete_unit'])
  })
})
