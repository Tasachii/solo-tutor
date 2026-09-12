import type { AppState, Invoice } from './types'
import { balanceDue, completionsIn, completionsOfSubject, occurredAt, packageStatus, packageUnitPrice } from './ledger'
import { daysOverdue, invoiceFor } from './billing'
import { periodOf } from './format'

export interface Dashboard {
  expected: number; received: number; outstanding: number
  recovered: number
  /** ส่วนของ "ยอดควรได้" ที่ยังไม่ได้ออกบิลในรอบนี้ — ไม่ใช่ค้าง เพราะยังไม่เคยขอ ครูต้องเห็นว่าเลขสามช่องบวกกันไม่ครบเพราะอะไร */
  unbilled: number; unbilledCount: number
  breakdown: { dunned: number; counted: number; overflow: number }
}

/** ตัวเลขทุกตัวคำนวณจาก ledger เท่านั้น — ห้าม hard-code (หลักการข้อ 2) */
export function dashboard(state: AppState, period: string): Dashboard {
  let expected = 0
  for (const inv of state.invoices) if (inv.period === period) expected += inv.total
  let unbilled = 0, unbilledCount = 0
  for (const s of state.subjects) {
    if (s.billing.mode === 'package') continue
    if (invoiceFor(state, s.id, period)) continue
    let projected = 0
    if (s.billing.mode === 'flat_monthly') projected = s.billing.amount
    else {
      const rate = s.billing.rate
      projected = completionsIn(state, s.id, period)
        .reduce((sum, completion) => sum + (completion.unitPrice ?? rate), 0)
    }
    if (projected <= 0) continue
    expected += projected; unbilled += projected; unbilledCount += 1
  }

  const received = state.payments
    .filter((p) => periodOf(p.paidAt) === period)
    .reduce((n, p) => n + p.amount, 0)

  // จ่ายบางส่วนแล้วต้องเหลือค้างเท่าส่วนที่ยังไม่ได้ ไม่ใช่เต็มใบ
  // ไม่งั้นเงิน 1,000 ที่รับมาจะถูกนับทั้งใน 'เข้าแล้ว' และ 'ค้าง' พร้อมกัน
  const outstanding = state.invoices
    .filter((i) => i.period === period && (i.status === 'sent' || i.status === 'overdue'))
    .reduce((n, i) => n + balanceDue(state, i.id), 0)

  // 1) บิลที่เก็บได้หลังเคยทวง
  let dunned = 0
  for (const inv of state.invoices) {
    if (inv.status !== 'paid') continue
    const reminded = state.messages.some(
      (m) => m.kind === 'reminder' && m.status === 'sent' && m.meta?.invoiceId === inv.id)
    if (reminded) dunned += state.payments.filter(payment => payment.invoiceId === inv.id
      && periodOf(payment.paidAt) === period).reduce((sum, payment) => sum + payment.amount, 0)
  }
  // 2) ครั้งที่นับได้ในระบบเดือนนี้ (รายครั้ง)
  let counted = 0
  for (const s of state.subjects) {
    if (s.billing.mode !== 'per_unit') continue
    const rate = s.billing.rate
    counted += completionsIn(state, s.id, period)
      .reduce((sum, completion) => sum + (completion.unitPrice ?? rate), 0)
  }
  // 3) ครั้งที่เกินแพ็กซึ่งจับได้
  let overflow = 0
  for (const s of state.subjects) {
    const pk = packageStatus(state, s)
    if (!pk || pk.overBy === 0) continue
    const carried = s.billing.mode === 'package' ? new Set(s.billing.carriedUnitIds ?? []) : new Set<string>()
    const overageInPeriod = completionsOfSubject(state, s.id)
      .filter(completion => occurredAt(state, completion) >= pk.purchasedAt && !carried.has(completion.unitId))
      .sort((a, b) => occurredAt(state, a).localeCompare(occurredAt(state, b)))
      .slice(pk.entitlementTotal)
      .filter(completion => periodOf(occurredAt(state, completion)) === period).length
    overflow += overageInPeriod * packageUnitPrice({ total: pk.purchasedUnits, price: pk.price })
  }

  return { expected, received, outstanding, unbilled, unbilledCount, recovered: dunned + counted + overflow, breakdown: { dunned, counted, overflow } }
}

export const draftCount = (state: AppState): number => state.messages.filter((m) => m.status === 'draft').length

/** ค้างนานสุดของวิชานี้ — ใบแรกในอาร์เรย์ไม่ใช่ใบที่ค้างนานสุดเสมอไป */
export function overdueDaysBySubject(state: AppState, subjectId: string): number {
  const days = state.invoices
    .filter((i) => i.subjectId === subjectId && (i.status === 'overdue' || i.status === 'sent') && i.dueAt)
    .map((i) => daysOverdue(state, i))
  return days.length ? Math.max(...days) : 0
}

export const clientsWithChats = (state: AppState): string[] => {
  const ids = new Set(state.chats.map((c) => c.clientId))
  for (const s of state.subjects) ids.add(s.clientId)
  return [...ids]
}


/**
 * ใบที่ควรโชว์ในแถวของวิชานี้ — เรียงตาม "ต้องลงมือทำแค่ไหน"
 * เกินกำหนด > ส่งแล้วรอเงิน > ร่างของเดือนนี้ > ล่าสุด
 * ถ้าเอาใบเดือนปัจจุบันมาก่อนเสมอ พอปิดยอดเดือนใหม่ บิลค้างเดือนก่อนจะหายไปจากจอ
 * ทั้งที่ยอด "ค้าง" ยังนับมันอยู่ — ครูจะเก็บเงินก้อนนั้นไม่ได้เลย
 */
export function invoiceToActOn(state: AppState, subjectId: string, period: string): Invoice | undefined {
  const mine = state.invoices.filter((i) => i.subjectId === subjectId && i.kind === 'monthly' && i.period === period)
  const rank = (i: Invoice): number =>
    i.status === 'overdue' ? 0
      : i.status === 'sent' ? 1
        : i.status === 'paid' ? 4               // จ่ายแล้วไม่ต้องลงมือทำอะไร ไปท้ายสุด
          : 2
  return [...mine].sort((a, b) =>
    rank(a) - rank(b) || b.period.localeCompare(a.period))[0]
}
