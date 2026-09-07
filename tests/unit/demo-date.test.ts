import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildScenario } from '../../src/core/scenarios'
import { dayIn, daysInPeriod, demoToday, periodBack, thisPeriod } from '../../src/mock/seed'
import { periodOf } from '../../src/core/format'
import { FROZEN_TODAY } from '../setup'

/** เทสอื่นตรึงวันไว้ ไฟล์นี้จงใจขยับนาฬิกาเพื่อพิสูจน์ว่าเดโมเดินตามปฏิทินจริง */
const on = (date: string) => vi.setSystemTime(new Date(`${date}T09:00:00+07:00`))
afterEach(() => on(FROZEN_TODAY))

describe('เดโมเดินตามปฏิทินจริง', () => {
  it('วันนี้ของเดโมคือวันนี้จริง ไม่ใช่วันที่ล็อกไว้ตอนเขียนชุดข้อมูล', () => {
    on('2027-03-15')
    expect(demoToday()).toBe('2027-03-15')
    expect(buildScenario('default').today).toBe('2027-03-15')
  })

  it('บิลของอดีตอยู่เดือนก่อนหน้าเสมอ ไม่ค้างอยู่ที่ ส.ค. 2568', () => {
    on('2027-03-15')
    const s = buildScenario('default')
    expect(s.invoices.length).toBeGreaterThan(0)
    for (const invoice of s.invoices) expect(invoice.period).toBe('2027-02')
    // ป้ายเดือนในคำอธิบายบิลต้องเดินตาม period เดียวกัน
    expect(s.invoices[0].lines[0].description).toContain('ก.พ. 2570')
  })

  it('คาบเรียนอยู่ในช่วงเดือนก่อนถึงสิ้นเดือนนี้', () => {
    on('2027-03-15')
    const s = buildScenario('default')
    const dates = s.units.map((u) => u.scheduledAt).sort()
    expect(dates[0] >= '2027-02-01').toBe(true)
    expect(dates[dates.length - 1] <= '2027-03-31').toBe(true)
    expect(s.units.some((u) => u.scheduledAt === '2027-03-15')).toBe(true)
  })

  it('ข้ามปีแล้วเดือนก่อนหน้าต้องเป็นปีที่แล้ว', () => {
    on('2027-01-10')
    expect(thisPeriod()).toBe('2027-01')
    expect(periodBack(1)).toBe('2026-12')
    expect(periodBack(2)).toBe('2026-11')
    for (const invoice of buildScenario('default').invoices) expect(invoice.period).toBe('2026-12')
  })

  it('วันที่ 31 ในเดือนที่มี 28 วัน ต้องยึดสิ้นเดือน ไม่หล่นไปเดือนถัดไป', () => {
    on('2027-03-05')
    expect(daysInPeriod('2027-02')).toBe(28)
    expect(dayIn('2027-02', 31)).toBe('2027-02-28')
    for (const invoice of buildScenario('default').invoices) {
      if (invoice.sentAt) expect(periodOf(invoice.sentAt) <= '2027-03').toBe(true)
    }
  })

  it('ไม่มีวันที่ปี 2025 หลงเหลือในชุดข้อมูลอีก', () => {
    on('2027-03-15')
    expect(JSON.stringify(buildScenario('default'))).not.toContain('2025-')
  })
})
