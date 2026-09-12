import type { AppState, CompletionEvent, ServiceUnit, Subject } from './types'
import { periodOf } from './format'

export const unitById = (s: AppState, id: string): ServiceUnit | undefined => s.units.find((u) => u.id === id)
export const subjectById = (s: AppState, id: string): Subject | undefined => s.subjects.find((x) => x.id === id)
export const clientById = (s: AppState, id: string) => s.clients.find((c) => c.id === id)
export const paidAmount = (s: AppState, invoiceId: string): number =>
  s.payments.filter((payment) => payment.invoiceId === invoiceId).reduce((sum, payment) => sum + payment.amount, 0)
export const balanceDue = (s: AppState, invoiceId: string): number => {
  const invoice = s.invoices.find((row) => row.id === invoiceId)
  return invoice ? Math.max(invoice.total - paidAmount(s, invoiceId), 0) : 0
}
/**
 * วันที่เรียนจริง — อ่านจาก unit เสมอ ไม่ใช่จาก completedAt ที่ถูกแช่ไว้ตอนเช็คชื่อ
 * ถ้าอ่านสองที่ พอเลื่อนคาบแล้วบิลกับแพ็กจะนับคนละวัน
 */
export const occurredAt = (s: AppState, c: CompletionEvent): string =>
  unitById(s, c.unitId)?.scheduledAt ?? c.completedAt

/** คาบที่ถูกงดยังเก็บ completion ไว้ให้กู้คืนได้ แต่ต้องไม่ถูกนับที่ไหนเลย */
const live = (s: AppState, c: CompletionEvent): boolean => !unitById(s, c.unitId)?.cancelled

export const isCompleted = (s: AppState, unitId: string): boolean =>
  s.completions.some((c) => c.unitId === unitId && live(s, c))

export const unitsOn = (s: AppState, date: string): ServiceUnit[] =>
  s.units
    .filter((u) => u.scheduledAt === date && !u.cancelled)
    .filter((u) => subjectById(s, u.subjectId)?.active !== false)
    .sort((a, b) => a.time.localeCompare(b.time))

/** completions ของ subject ในเดือนหนึ่ง — นับตาม scheduledAt ของ unit */
export function completionsIn(s: AppState, subjectId: string, period: string): CompletionEvent[] {
  return s.completions.filter((c) => {
    const u = unitById(s, c.unitId)
    return !!u && !u.cancelled && u.subjectId === subjectId && periodOf(u.scheduledAt) === period
  })
}

export function completionsOfSubject(s: AppState, subjectId: string): CompletionEvent[] {
  return s.completions.filter((c) => {
    const u = unitById(s, c.unitId)
    return !!u && !u.cancelled && u.subjectId === subjectId
  })
}

/** complete แบบ idempotent — กดซ้ำไม่เพิ่มซ้ำ */
export function complete(s: AppState, unitId: string): AppState {
  if (isCompleted(s, unitId)) return s
  const u = unitById(s, unitId)
  if (!u || u.cancelled) return s // คาบที่ยกเลิกแล้วเช็คชื่อไม่ได้
  const subject = subjectById(s, u.subjectId)
  const unitPrice = subject?.billing.mode === 'per_unit' ? subject.billing.rate : undefined
  return { ...s, completions: [...s.completions, {
    unitId, completedAt: u.scheduledAt, ...(unitPrice !== undefined ? { unitPrice } : {}),
  }] }
}

export function uncomplete(s: AppState, unitId: string): AppState {
  if (!isCompleted(s, unitId)) return s
  return { ...s, completions: s.completions.filter((c) => c.unitId !== unitId) }
}

/** เติมราคาให้ข้อมูลเก่าก่อนอนุญาตให้แก้เรต เพื่อให้ประวัติเดิมหยุดนิ่ง */
export function snapshotLegacyPrices(s: AppState, onlySubjectId?: string): AppState {
  let changed = false
  const completions = s.completions.map((completion) => {
    if (completion.unitPrice !== undefined) return completion
    const unit = unitById(s, completion.unitId)
    if (!unit || (onlySubjectId && unit.subjectId !== onlySubjectId)) return completion
    const subject = subjectById(s, unit.subjectId)
    if (subject?.billing.mode !== 'per_unit') return completion
    changed = true
    return { ...completion, unitPrice: subject.billing.rate }
  })
  return changed ? { ...s, completions } : s
}

/**
 * ความคืบหน้าของคอร์ส — "สอนไปแล้ว 3/10"
 *
 * นับจากการเช็คชื่อจริงของนักเรียนคนนั้นทั้งหมด ไม่ใช่รายเดือน เพราะคอร์สหนึ่งกินหลายเดือน
 * คาบที่งดไปแล้วไม่ถูกนับ (completionsOfSubject กรองให้) — ครูจึงเชื่อตัวเลขนี้ได้เท่าที่เช็คชื่อจริง
 * แพ็กคืน null เพราะมีตัวนับของตัวเองอยู่แล้ว สองตัวนับบนการ์ดเดียวกันทำให้ครูอ่านผิด
 */
export interface CourseProgress { done: number; total: number; state: 'ok' | 'near' | 'done' }

/** ไม่ตั้งทั้งรายคนและค่าเริ่มต้นของครู = ใช้ค่านี้ (เจ้าของ 12 ก.ย.: "default เปน 0/10 ก็ได้") */
export const COURSE_SESSIONS_FALLBACK = 10

export function courseProgress(s: AppState, subject: Subject): CourseProgress | null {
  if (subject.billing.mode === 'package') return null
  const base = subject.courseSessions ?? s.courseSessionsDefault ?? COURSE_SESSIONS_FALLBACK
  if (!Number.isSafeInteger(base) || base <= 0) return null
  const bonus = Number.isSafeInteger(subject.courseBonus) && subject.courseBonus! > 0 ? subject.courseBonus! : 0
  const total = base + bonus
  // ต่อคอร์สแล้วนับใหม่จาก 0 — ถ้ายกเลิกเช็คชื่อเก่าจนต่ำกว่าจุดเริ่ม ให้เป็น 0 ไม่ใช่ติดลบ
  const baseline = Number.isSafeInteger(subject.courseBaseline) && subject.courseBaseline! > 0 ? subject.courseBaseline! : 0
  const done = Math.max(0, completionsOfSubject(s, subject.id).length - baseline)
  return { done, total, state: done >= total ? 'done' : total - done <= 2 ? 'near' : 'ok' }
}

export interface PackageStatus {
  total: number; used: number; remaining: number; overBy: number; price: number
  purchasedUnits: number; carriedCredits: number; entitlementTotal: number
  purchasedAt: string; state: 'ok' | 'low' | 'exhausted'
}

/** ราคาต่อครั้งของแพ็ก — ที่เดียวในระบบ ห้ามคำนวณซ้ำที่อื่น */
export const packageUnitPrice = (b: { total: number; price: number }): number =>
  b.total > 0 ? Math.round(b.price / b.total) : 0

/** used = completions ที่ completedAt >= purchasedAt และยังไม่ถูกแพ็กก่อนหน้านับไป */
export function packageStatus(s: AppState, subject: Subject): PackageStatus | null {
  const b = subject.billing
  if (b.mode !== 'package') return null
  const carried = new Set(b.carriedUnitIds ?? [])
  const carriedCredits = b.carriedCredits ?? 0
  const entitlementTotal = b.total + carriedCredits
  const used = completionsOfSubject(s, subject.id)
    .filter((c) => occurredAt(s, c) >= b.purchasedAt && !carried.has(c.unitId)).length
  const remaining = Math.max(entitlementTotal - used, 0)
  const overBy = Math.max(used - entitlementTotal, 0)
  const state = overBy > 0 || remaining === 0 ? 'exhausted' : remaining <= 2 ? 'low' : 'ok'
  return { total: entitlementTotal, purchasedUnits: b.total, carriedCredits, entitlementTotal,
    used, remaining, overBy, price: b.price, purchasedAt: b.purchasedAt, state }
}

/**
 * ต่อแพ็ก: purchasedAt = today ทำให้ used กลับเป็น 0 เพราะ derive
 * คาบที่เรียนไปแล้ว "วันนี้" ถูกแพ็กเก่านับ (และอาจคิดเป็นส่วนเกินไปแล้ว)
 * จึงจดไว้ใน carriedUnitIds ไม่ให้แพ็กใหม่นับซ้ำ
 */
export function renewPackage(s: AppState, subjectId: string, carriedCredits?: number): AppState {
  const subject = subjectById(s, subjectId)
  if (!subject || subject.billing.mode !== 'package') return s
  const previous = packageStatus(s, subject)
  const carried = completionsOfSubject(s, subjectId)
    .filter((c) => occurredAt(s, c) >= s.today)
    .map((c) => c.unitId)
  return {
    ...s,
    subjects: s.subjects.map((x) =>
      x.id === subjectId && x.billing.mode === 'package'
        ? { ...x, billing: { ...x.billing, purchasedAt: s.today,
            carriedCredits: carriedCredits ?? previous?.remaining ?? 0, carriedUnitIds: carried } }
        : x),
  }
}
