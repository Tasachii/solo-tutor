import type { AppMode } from './types'

/**
 * หน้าแรกเป็นของคนใหม่ — ครูที่ใช้จริงอยู่แล้วไม่ควรเจอหน้าขายทุกครั้งที่เปิด
 * กฎเดียวใช้ทั้งแอปที่ติดตั้งแล้วและแท็บเบราว์เซอร์ ทดสอบได้โดยไม่ต้องมี DOM
 */
export interface EntryInput {
  /** เปิดจากไอคอนบนโฮมสกรีน (PWA) */
  standalone: boolean
  mode: AppMode
  onboarded: boolean
  hasSubjects: boolean
  /** query ของหน้าแรก เช่น "?stay=1" — ทางกลับมาดูหน้าขายสำหรับครูที่อยู่โหมดจริง */
  search: string
}

export const LANDING_STAY_PARAM = 'stay'
/** ลิงก์กลับหน้าแรกจากหน้าอื่น ๆ ต้องไม่เด้งครูโหมดจริงเข้าแอปทันที */
export const LANDING_STAY_HREF = `/?${LANDING_STAY_PARAM}=1`

export const wantsToStay = (search: string): boolean => {
  try { return new URLSearchParams(search).get(LANDING_STAY_PARAM) === '1' } catch { return false }
}

/** true = พาเข้า /app/today แทนหน้าแรก */
export function shouldEnterApp(input: EntryInput): boolean {
  if (input.standalone) return true
  if (input.mode !== 'real') return false
  if (wantsToStay(input.search)) return false
  return input.onboarded || input.hasSubjects
}
