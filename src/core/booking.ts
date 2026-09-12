import type { AppState, ISODate } from './types'
import { addDays, periodOf, weekday } from './format'
import { isFinalizedPeriod } from './billing'
import { isISODate, isTime } from './validation'

/**
 * การจองคาบล่วงหน้าเป็นชุด — "ทุกจันทร์กับพฤหัส 17:00 อีก 8 สัปดาห์"
 *
 * อยู่ในไฟล์ของตัวเองเพราะหน้าจอกับ reducer ต้องตอบตรงกันเป๊ะ:
 * ครูเห็น "จะเพิ่ม 16 คาบ" ก่อนกด แล้วต้องได้ 16 คาบจริง ไม่ใช่ 14 เพราะสองคาบชนของเดิม
 * ถ้าปล่อยให้สองที่คำนวณเอง วันหนึ่งกฎข้างหนึ่งเปลี่ยนแล้วตัวเลขบนปุ่มจะโกหกเงียบ ๆ
 */
export const BOOK_SERIES_MAX_WEEKS = 26
export const BOOK_SERIES_MAX_UNITS = 120

export interface BookSeriesInput {
  subjectId: string
  time: string
  /** 0 = อาทิตย์ … 6 = เสาร์ ตรงกับ `weekday()` */
  weekdays: number[]
  from: ISODate
  weeks: number
  /** ยอมให้ชนคิวของนักเรียนคนอื่น (สอนเป็นกลุ่ม) — ไม่ตั้ง = คิวถูกล็อกไว้ให้คนที่จองก่อน */
  allowClash?: boolean
}

export interface BookSeriesPlan {
  /** วันที่จะถูกเพิ่มจริง เรียงจากเก่าไปใหม่ */
  dates: ISODate[]
  /** วันที่เวลานั้นมีนักเรียนคนอื่นจองไว้แล้ว — ถูกกันออกไว้จนกว่าครูจะยืนยันว่าสอนกลุ่ม */
  clashes: ISODate[]
}

/** ช่วงเวลาที่ถูกจองไว้แล้วในวันนั้น ๆ ของนักเรียนคนอื่น — คิวหนึ่งช่องเป็นของคนเดียว */
export const slotTaken = (state: AppState, date: ISODate, time: string, exceptSubjectId?: string): boolean =>
  state.units.some((unit) => !unit.cancelled && unit.scheduledAt === date && unit.time === time
    && unit.subjectId !== exceptSubjectId
    && state.subjects.find((subject) => subject.id === unit.subjectId)?.active !== false)

/**
 * แผนการจอง — คืน `null` เมื่อคำสั่งไม่ถูกต้อง (ห้ามบันทึก)
 *
 * ข้ามสามอย่างโดยตั้งใจ:
 * - รอบบิลที่ปิดไปแล้ว — ย้อนไปเพิ่มคาบในเดือนที่ออกบิลให้ผู้ปกครองไปแล้วทำให้ยอดกับบิลไม่ตรงกัน
 * - คาบที่ซ้ำวันและเวลาเดิมของนักเรียนคนเดียวกัน — ครูกดสองรอบต้องไม่ได้ตารางซ้อน
 * - คิวที่เป็นของนักเรียนคนอื่นแล้ว — ครูสอนได้ทีละคน การจองทับต้องเป็นการตัดสินใจ ไม่ใช่อุบัติเหตุ
 */
export function bookSeriesPlan(state: AppState, input: BookSeriesInput): BookSeriesPlan | null {
  const subject = state.subjects.find((row) => row.id === input.subjectId)
  if (!subject?.active || !isTime(input.time) || !isISODate(input.from)) return null
  if (!Number.isSafeInteger(input.weeks) || input.weeks < 1 || input.weeks > BOOK_SERIES_MAX_WEEKS) return null
  const weekdays = [...new Set(input.weekdays)]
  if (weekdays.length === 0 || weekdays.length > 7
    || weekdays.some((day) => !Number.isSafeInteger(day) || day < 0 || day > 6)) return null

  const mine = new Set(state.units
    .filter((unit) => unit.subjectId === input.subjectId && !unit.cancelled)
    .map((unit) => `${unit.scheduledAt} ${unit.time}`))
  const dates: ISODate[] = []
  const clashes: ISODate[] = []
  const last = addDays(input.from, input.weeks * 7 - 1)
  for (let date = input.from; date <= last; date = addDays(date, 1)) {
    if (!weekdays.includes(weekday(date))) continue
    if (isFinalizedPeriod(state, input.subjectId, periodOf(date))) continue
    if (mine.has(`${date} ${input.time}`)) continue
    if (!input.allowClash && slotTaken(state, date, input.time, input.subjectId)) { clashes.push(date); continue }
    mine.add(`${date} ${input.time}`)
    dates.push(date)
    if (dates.length > BOOK_SERIES_MAX_UNITS) return null
  }
  return { dates, clashes }
}
