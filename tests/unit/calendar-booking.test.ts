import { describe, expect, it } from 'vitest'
import { buildScenario } from '../../src/core/scenarios'
import { reducer } from '../../src/core/store'
import { dayIn, daysInPeriod, monthGrid, periodOf, shiftPeriod, weekday } from '../../src/core/format'
import { BOOK_SERIES_MAX_WEEKS, bookSeriesPlan, slotTaken } from '../../src/core/booking'
import { courseProgress, subjectById, unitsOn } from '../../src/core/ledger'
import { FROZEN_TODAY } from '../setup'

/**
 * ปฏิทินหน้าแรกและการจองล่วงหน้า
 *
 * ตัวเลขที่ครูเห็นก่อนกด ("จะเพิ่ม 8 คาบ") กับสิ่งที่ถูกบันทึกจริงต้องมาจาก `bookSeriesPlan` ตัวเดียวกัน
 * เทสชุดนี้จึงไล่ทั้งตัวช่วยวาดปฏิทิน ตัวคำนวณวันจอง และ reducer ที่บันทึกจริง
 */
const base = buildScenario('default')
const period = periodOf(FROZEN_TODAY)

describe('ตารางเดือนของปฏิทิน', () => {
  it('ช่องว่างนำหน้าเท่ากับวันในสัปดาห์ของวันที่ 1 และช่องทั้งหมดลงตัวเป็นสัปดาห์', () => {
    const cells = monthGrid(period)
    const lead = cells.findIndex((cell) => cell !== null)
    expect(lead).toBe(weekday(dayIn(period, 1)))
    expect(cells.length % 7).toBe(0)
    expect(cells.filter((cell) => cell !== null)).toHaveLength(daysInPeriod(period))
  })

  it('กุมภาพันธ์ปีอธิกสุรทินมี 29 ช่อง และเดือนธรรมดามี 28', () => {
    expect(monthGrid('2024-02').filter(Boolean)).toHaveLength(29)
    expect(monthGrid('2025-02').filter(Boolean)).toHaveLength(28)
  })

  it('เลื่อนเดือนข้ามปีได้ทั้งสองทาง', () => {
    expect(shiftPeriod('2025-12', 1)).toBe('2026-01')
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12')
    expect(shiftPeriod('2025-09', 4)).toBe('2026-01')
  })

  it('วันที่ 31 ของเดือนที่มี 30 วัน ถูกยึดไว้ที่สิ้นเดือน ไม่ไหลไปเดือนถัดไป', () => {
    expect(dayIn('2025-11', 31)).toBe('2025-11-30')
  })
})

describe('จองล่วงหน้าเป็นชุด', () => {
  const subjectId = 's3' // น้องมิว เรียนจันทร์กับพฤหัส ไม่มีคาบวันนี้ในชุดตัวอย่าง
  const nextMonth = shiftPeriod(period, 1)
  const firstOfNextMonth = dayIn(nextMonth, 1)

  it('ได้ทุกวันที่ตรงกับวันในสัปดาห์ที่เลือก ตลอดจำนวนสัปดาห์ที่สั่ง', () => {
    const { dates } = bookSeriesPlan(base, { subjectId, time: '15:00', weekdays: [1, 4], from: firstOfNextMonth, weeks: 4 })!
    expect(dates).toHaveLength(8)
    expect(dates.every((date: string) => [1, 4].includes(weekday(date)))).toBe(true)
    expect(dates[0] >= firstOfNextMonth).toBe(true)
    expect([...dates].sort()).toEqual(dates)
  })

  it('คาบที่มีอยู่แล้ววันและเวลาเดียวกันถูกข้าม ครูกดสองรอบจึงไม่ได้ตารางซ้อน', () => {
    const input = { subjectId, time: '15:00', weekdays: [1, 4], from: firstOfNextMonth, weeks: 4 }
    const first = reducer(base, { type: 'bookSeries', ...input })
    expect(first.units.length).toBe(base.units.length + 8)
    expect(bookSeriesPlan(first, input)!.dates).toEqual([])
    // reducer ปฏิเสธคำสั่งที่ไม่มีอะไรใหม่ให้เพิ่ม แทนที่จะบันทึกซ้ำเงียบ ๆ
    expect(reducer(first, { type: 'bookSeries', ...input })).toBe(first)
  })

  it('เวลาอื่นของวันเดียวกันยังจองได้ — นักเรียนคนเดียวเรียนสองรอบในวันเดียวได้', () => {
    const input = { subjectId, time: '15:00', weekdays: [1], from: firstOfNextMonth, weeks: 2 }
    const first = reducer(base, { type: 'bookSeries', ...input })
    const second = bookSeriesPlan(first, { ...input, time: '18:00' })!
    expect(second.dates).toHaveLength(2)
  })

  it('รอบบิลที่ปิดไปแล้วถูกข้าม — ย้อนไปเพิ่มคาบในเดือนที่ออกบิลไปแล้วไม่ได้', () => {
    // การ "ปิดรอบ" มีผลเฉพาะสมุดจริง (isFinalizedPeriod) — เดโมแก้ย้อนหลังได้เพื่อให้ลองเล่นได้
    // s2 มีบิลเดือนก่อนสถานะ sent อยู่แล้ว เดือนนั้นจึงปิดสำหรับคนนี้เมื่ออยู่โหมดจริง
    const real = { ...base, mode: 'real' as const }
    const closed = shiftPeriod(period, -1)
    const { dates } = bookSeriesPlan(real, { subjectId: 's2', time: '17:00', weekdays: [0, 1, 2, 3, 4, 5, 6], from: dayIn(closed, 1), weeks: 8 })!
    expect(dates.some((date: string) => periodOf(date) === closed)).toBe(false)
    expect(dates.length).toBeGreaterThan(0)
  })

  it('คำสั่งที่ไม่ถูกต้องคืน null และ reducer ไม่แตะข้อมูล', () => {
    const bad = [
      { subjectId, time: '25:00', weekdays: [1], from: firstOfNextMonth, weeks: 4 },
      { subjectId, time: '15:00', weekdays: [], from: firstOfNextMonth, weeks: 4 },
      { subjectId, time: '15:00', weekdays: [7], from: firstOfNextMonth, weeks: 4 },
      { subjectId, time: '15:00', weekdays: [1], from: 'พรุ่งนี้', weeks: 4 },
      { subjectId, time: '15:00', weekdays: [1], from: firstOfNextMonth, weeks: 0 },
      { subjectId, time: '15:00', weekdays: [1], from: firstOfNextMonth, weeks: BOOK_SERIES_MAX_WEEKS + 1 },
      { subjectId: 'ไม่มีคนนี้', time: '15:00', weekdays: [1], from: firstOfNextMonth, weeks: 4 },
    ]
    for (const input of bad) {
      expect(bookSeriesPlan(base, input)).toBeNull()
      expect(reducer(base, { type: 'bookSeries', ...input })).toBe(base)
    }
  })

  it('นักเรียนที่หยุดเรียนแล้วจองไม่ได้', () => {
    const stopped = reducer(base, { type: 'deactivateSubject', subjectId })
    expect(bookSeriesPlan(stopped, { subjectId, time: '15:00', weekdays: [1], from: firstOfNextMonth, weeks: 4 })).toBeNull()
  })

  it('คาบที่จองไว้ล่วงหน้าโผล่ในตารางของวันนั้นจริง', () => {
    const booked = reducer(base, { type: 'bookSeries', subjectId, time: '15:00', weekdays: [1], from: firstOfNextMonth, weeks: 1 })
    const target = booked.units.find((unit) => unit.subjectId === subjectId && unit.scheduledAt > FROZEN_TODAY)!
    expect(unitsOn(booked, target.scheduledAt).map((unit) => unit.id)).toContain(target.id)
  })
})

describe('จำนวนครั้งต่อคอร์สในสมุด', () => {
  it('ค่าเริ่มต้นของครูใช้กับคนที่ไม่ได้ตั้งเอง และไม่ทับคนที่ตั้งไว้แล้ว', () => {
    const withDefault = reducer(base, { type: 'setCourseDefault', sessions: 20 })
    expect(withDefault.courseSessionsDefault).toBe(20)
    // s3 ไม่ได้ตั้งเอง → ตามค่าเริ่มต้น · s2 ตั้งไว้ 8 ครั้งในชุดตัวอย่าง → คงเดิม
    expect(courseProgress(withDefault, subjectById(withDefault, 's3')!)!.total).toBe(20)
    expect(courseProgress(withDefault, subjectById(withDefault, 's2')!)!.total).toBe(8)
  })

  it('ตั้งรายคนได้ และล้างกลับไปใช้ค่าเริ่มต้นได้', () => {
    const set = reducer(base, { type: 'setCourseSessions', subjectId: 's3', sessions: 30 })
    expect(courseProgress(set, subjectById(set, 's3')!)!.total).toBe(30)
    const cleared = reducer(set, { type: 'setCourseSessions', subjectId: 's3', sessions: null })
    expect(cleared.subjects.find((row) => row.id === 's3')!.courseSessions).toBeUndefined()
    expect(courseProgress(cleared, subjectById(cleared, 's3')!)!.total).toBe(10)
  })

  it('ค่าที่ใช้ไม่ได้ถูกปฏิเสธทั้งค่าเริ่มต้นและรายคน', () => {
    for (const sessions of [0, -3, 2.5, 501]) {
      expect(reducer(base, { type: 'setCourseDefault', sessions })).toBe(base)
      expect(reducer(base, { type: 'setCourseSessions', subjectId: 's3', sessions })).toBe(base)
    }
  })

  it('เช็คชื่อครั้งแรกของนักเรียนใหม่ขึ้น 1 จากจำนวนครั้งทั้งคอร์ส', () => {
    const created = reducer(base, {
      type: 'upsertSubject',
      subject: { id: 'new-1', name: 'น้องใหม่', clientId: 'new-c1', billing: { mode: 'per_unit', rate: 400 },
        active: true, createdAt: FROZEN_TODAY, courseSessions: 10 },
      clientName: 'คุณแม่ใหม่',
    })
    expect(courseProgress(created, subjectById(created, 'new-1')!)).toMatchObject({ done: 0, total: 10 })
    const withUnit = reducer(created, { type: 'addUnit', subjectId: 'new-1', time: '17:00' })
    const unit = withUnit.units.find((row) => row.subjectId === 'new-1')!
    const checked = reducer(withUnit, { type: 'complete', unitId: unit.id })
    expect(courseProgress(checked, subjectById(checked, 'new-1')!)).toMatchObject({ done: 1, total: 10 })
  })

  it('แพ็กไม่มีตัวนับคอร์ส — ตัวนับของแพ็กเป็นตัวเดียวที่ถูกต้องสำหรับคนนั้น', () => {
    expect(courseProgress(base, subjectById(base, 's6')!)).toBeNull()
  })

  it('คอร์สที่ครบแล้วและใกล้ครบบอกสถานะต่างกัน', () => {
    const near = reducer(base, { type: 'setCourseSessions', subjectId: 's1', sessions: 10 }) // สอนไปแล้ว 9
    expect(courseProgress(near, subjectById(near, 's1')!)).toMatchObject({ done: 9, state: 'near' })
    const finished = reducer(base, { type: 'setCourseSessions', subjectId: 's1', sessions: 9 })
    expect(courseProgress(finished, subjectById(finished, 's1')!)!.state).toBe('done')
  })
})

/**
 * ต่อคอร์สและแถมครั้ง (เจ้าของ 12 ก.ย.: "เขียนว่าครบแล้ว แล้วมีปุ่มต่อคอร์สเพิ่ม หรือแถมคอร์สให้เพิ่ม")
 *
 * ต่อคอร์ส = เริ่มนับใหม่ที่ 0 โดยไม่ลบประวัติ · แถม = เพิ่มเพดานของคอร์สรอบนี้
 * ทั้งสองอย่างห้ามแตะบิล ใบเสร็จ หรือจำนวนครั้งที่เช็คชื่อไปแล้ว
 */
describe('ต่อคอร์สและแถมครั้ง', () => {
  const finished = reducer(base, { type: 'setCourseSessions', subjectId: 's1', sessions: 9 }) // สอนไปแล้ว 9/9

  it('ต่อคอร์สแล้วเริ่มนับใหม่ที่ 0 โดยการเช็คชื่อเดิมยังอยู่ครบ', () => {
    expect(courseProgress(finished, subjectById(finished, 's1')!)).toMatchObject({ done: 9, total: 9, state: 'done' })
    const renewed = reducer(finished, { type: 'renewCourse', subjectId: 's1' })
    expect(courseProgress(renewed, subjectById(renewed, 's1')!)).toMatchObject({ done: 0, total: 9, state: 'ok' })
    expect(renewed.completions).toHaveLength(finished.completions.length)
    expect(renewed.invoices).toEqual(finished.invoices)
  })

  it('ต่อคอร์สแล้วเช็คชื่อครั้งถัดไปนับเป็น 1', () => {
    const renewed = reducer(finished, { type: 'renewCourse', subjectId: 's1' })
    const open = renewed.units.find((row) => row.subjectId === 's1' && !row.cancelled
      && !renewed.completions.some((done) => done.unitId === row.id))
    const checked = open
      ? reducer(renewed, { type: 'complete', unitId: open.id })
      : (() => {
        const added = reducer(renewed, { type: 'addUnit', subjectId: 's1', time: '09:00' })
        const unit = added.units.find((row) => !added.completions.some((done) => done.unitId === row.id) && row.subjectId === 's1')!
        return reducer(added, { type: 'complete', unitId: unit.id })
      })()
    expect(courseProgress(checked, subjectById(checked, 's1')!)!.done).toBe(1)
  })

  it('ยกเลิกเช็คชื่อเก่าจนต่ำกว่าจุดเริ่มใหม่ ตัวนับเป็น 0 ไม่ใช่ติดลบ', () => {
    const renewed = reducer(finished, { type: 'renewCourse', subjectId: 's1' })
    const old = renewed.completions.find((row) => subjectById(renewed, 's1')
      && renewed.units.some((unit) => unit.id === row.unitId && unit.subjectId === 's1'))!
    const undone = reducer(renewed, { type: 'uncomplete', unitId: old.unitId })
    expect(courseProgress(undone, subjectById(undone, 's1')!)!.done).toBe(0)
  })

  it('แถมครั้งเพิ่มเพดานของคอร์สรอบนี้ และกดซ้ำบวกทบ', () => {
    const once = reducer(finished, { type: 'bonusCourse', subjectId: 's1', sessions: 2 })
    expect(courseProgress(once, subjectById(once, 's1')!)).toMatchObject({ done: 9, total: 11 })
    const twice = reducer(once, { type: 'bonusCourse', subjectId: 's1', sessions: 3 })
    expect(courseProgress(twice, subjectById(twice, 's1')!)!.total).toBe(14)
  })

  it('ต่อคอร์สล้างครั้งที่แถมของรอบเก่าทิ้ง', () => {
    const withBonus = reducer(finished, { type: 'bonusCourse', subjectId: 's1', sessions: 5 })
    const renewed = reducer(withBonus, { type: 'renewCourse', subjectId: 's1' })
    expect(subjectById(renewed, 's1')!.courseBonus).toBeUndefined()
    expect(courseProgress(renewed, subjectById(renewed, 's1')!)).toMatchObject({ done: 0, total: 9 })
  })

  it('ค่าที่ใช้ไม่ได้และแพ็กถูกปฏิเสธ ไม่ใช่บันทึกเงียบ ๆ', () => {
    for (const sessions of [0, -1, 1.5, 501, Number.NaN]) {
      expect(reducer(finished, { type: 'bonusCourse', subjectId: 's1', sessions })).toBe(finished)
    }
    expect(reducer(base, { type: 'renewCourse', subjectId: 's6' })).toBe(base)      // แพ็ก
    expect(reducer(base, { type: 'bonusCourse', subjectId: 's6', sessions: 5 })).toBe(base)
    expect(reducer(base, { type: 'renewCourse', subjectId: 'ไม่มีคนนี้' })).toBe(base)
  })
})

describe('ล็อกคิวในปฏิทิน', () => {
  const nextMonth = shiftPeriod(period, 1)
  const monday = (() => {
    let date = dayIn(nextMonth, 1)
    while (weekday(date) !== 1) date = dayIn(nextMonth, Number(date.slice(8)) + 1)
    return date
  })()

  it('ช่วงเวลาที่นักเรียนคนอื่นจองแล้วถูกกันไว้ ไม่ใช่จองทับเงียบ ๆ', () => {
    const held = reducer(base, { type: 'bookSeries', subjectId: 's3', time: '15:00', weekdays: [1], from: monday, weeks: 2 })
    expect(slotTaken(held, monday, '15:00', 's2')).toBe(true)
    const plan = bookSeriesPlan(held, { subjectId: 's2', time: '15:00', weekdays: [1], from: monday, weeks: 2 })!
    expect(plan.dates).toEqual([])
    expect(plan.clashes).toHaveLength(2)
    expect(reducer(held, { type: 'bookSeries', subjectId: 's2', time: '15:00', weekdays: [1], from: monday, weeks: 2 })).toBe(held)
  })

  it('ครูยืนยันว่าสอนกลุ่มแล้วจองทับได้', () => {
    const held = reducer(base, { type: 'bookSeries', subjectId: 's3', time: '15:00', weekdays: [1], from: monday, weeks: 2 })
    const shared = reducer(held, { type: 'bookSeries', subjectId: 's2', time: '15:00', weekdays: [1], from: monday, weeks: 2, allowClash: true })
    expect(shared.units.length).toBe(held.units.length + 2)
    expect(unitsOn(shared, monday).filter((unit) => unit.time === '15:00')).toHaveLength(2)
  })

  it('คิวของตัวเองไม่นับว่าชน — เลื่อนเวลาเดิมของคนเดิมยังทำได้', () => {
    const held = reducer(base, { type: 'bookSeries', subjectId: 's3', time: '15:00', weekdays: [1], from: monday, weeks: 2 })
    expect(slotTaken(held, monday, '15:00', 's3')).toBe(false)
  })

  it('คาบที่งดแล้วคืนคิวให้คนอื่น', () => {
    const held = reducer(base, { type: 'bookSeries', subjectId: 's3', time: '15:00', weekdays: [1], from: monday, weeks: 1 })
    const unit = held.units.find((row) => row.subjectId === 's3' && row.scheduledAt === monday)!
    const off = reducer(held, { type: 'cancelUnit', unitId: unit.id })
    expect(slotTaken(off, monday, '15:00', 's2')).toBe(false)
  })
})
