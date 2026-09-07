import type { AppState, Invoice, Message, MessageKind, Subject } from './types'
import { professionById, templatesFor } from '../professions'
import { balanceDue, clientById, completionsIn, packageStatus, subjectById } from './ledger'
import { daysOverdue, dueDaysOf, invoiceFor, ladderFor } from './billing'
import { addDays, dateThai, dayThai, money, periodThai } from './format'

import { documentUrl, invoiceDocument, receiptDocument } from './documents'
import { financialRevision } from './messageDelivery'
import { answer } from './faq'
import { particleVars } from './particle'

type Vars = Record<string, string | number>

/** แทนตัวแปรใน template — dev: throw ถ้าขาด · prod: ใส่ "—" แล้ว log */
export function render(template: string, vars: Vars): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = vars[key]
    if (v === undefined || v === null || v === '') {
      if (import.meta.env?.DEV) throw new Error(`missing template var: ${key}`)
      console.error(`[solo] missing template var: ${key}`)
      return '—'
    }
    return String(v)
  })
}

/**
 * ลิงก์ในข้อความต้องเป็น URL เต็ม — ผู้รับกดจากแชท จึงไม่มี origin ให้อ้างอิง
 * BASE_URL ทำให้ path ที่ deploy อยู่ติดไปด้วย
 */
const appUrl = (hashPath: string): string => {
  const base = import.meta.env?.BASE_URL ?? '/'
  const origin = typeof location !== 'undefined' ? location.origin : ''
  return `${origin}${base}#${hashPath}`
}
export function invoiceUrlOf(clientId: string, state?: AppState, invoiceId?: string): string {
  if (state?.mode !== 'real') return appUrl(`/client/${clientId}`)
  const inv = invoiceId ? state.invoices.find(i => i.id === invoiceId && i.clientId === clientId)
    : state.invoices.filter(i => i.clientId === clientId)
      .sort((a, b) => Number(a.status === 'paid') - Number(b.status === 'paid') || a.period.localeCompare(b.period))[0]
  const doc = inv && invoiceDocument(state, inv.id)
  if (!doc) return 'ติดต่อผู้ให้บริการในแชทนี้เพื่อขอรายละเอียด'
  try { return documentUrl(doc) } catch { return 'ติดต่อผู้ให้บริการในแชทนี้เพื่อขอเอกสาร PDF' }
}
export function receiptUrlOf(receiptId: string, state?: AppState): string {
  if (state?.mode !== 'real') return appUrl(`/receipt/${receiptId}`)
  const doc = receiptDocument(state, receiptId)
  if (!doc) return 'ติดต่อผู้ให้บริการในแชทนี้เพื่อขอใบเสร็จ'
  try { return documentUrl(doc) } catch { return 'ติดต่อผู้ให้บริการในแชทนี้เพื่อขอใบเสร็จ PDF' }
}

const stripHonorific = (name: string | undefined, honorific: string): string => {
  if (!name) return '—'
  const rest = name.startsWith(honorific) ? name.slice(honorific.length) : name
  return rest.trim() || name
}

function baseVars(state: AppState, subject: Subject): Vars {
  const prof = professionById(state.professionId)
  const client = clientById(state, subject.clientId)
  return {
    // ชื่อที่บันทึกไว้มักมีคำนำหน้าติดมาแล้ว ("คุณแม่แพรว") — ตัดออกก่อน
    // ไม่งั้น {clientHonorific}{clientName} จะกลายเป็น "คุณคุณแม่แพรว"
    ...particleVars(state.provider.particle),
    clientHonorific: prof.vocab.clientHonorific,
    clientName: stripHonorific(client?.name, prof.vocab.clientHonorific),
    subjectName: subject.name,
    invoiceUrl: invoiceUrlOf(subject.clientId, state),
  }
}

export function invoiceText(state: AppState, inv: Invoice): string {
  const templates = templatesFor(state.professionId)
  const subject = subjectById(state, inv.subjectId)!
  const vars = {
    ...baseVars(state, subject),
    invoiceUrl: invoiceUrlOf(subject.clientId, state, inv.id),
    periodThai: periodThai(inv.period),
    qty: inv.kind === 'monthly' ? completionsIn(state, inv.subjectId, inv.period).length : inv.lines.reduce((n, l) => n + l.qty, 0),
    total: money(balanceDue(state, inv.id)),
  }
  const flat = subject.billing.mode === 'flat_monthly'
  return render(flat ? templates.invoiceFlat : templates.invoice, vars)
}

export function reminderText(state: AppState, inv: Invoice, key: 'soft' | 'clear' | 'final'): string {
  const templates = templatesFor(state.professionId)
  const subject = subjectById(state, inv.subjectId)!
  return render(templates.reminder[key], {
    ...baseVars(state, subject),
    invoiceUrl: invoiceUrlOf(subject.clientId, state, inv.id),
    periodThai: periodThai(inv.period),
    total: money(balanceDue(state, inv.id)),
    daysOverdue: daysOverdue(state, inv),
  })
}

/** แจ้งเลื่อนคาบ — เกิดจากการกระทำของครู ไม่ใช่ derive จึงสร้างตอนกดเลื่อน */
export function movedText(state: AppState, subject: Subject, from: { date: string }, to: { date: string; time: string }): string {
  return render(templatesFor(state.professionId).moved, {
    ...baseVars(state, subject),
    fromDayThai: dayThai(from.date), fromDateThai: dateThai(from.date),
    dayThai: dayThai(to.date), dateThai: dateThai(to.date), time: to.time,
  })
}

export function cancelledText(state: AppState, subject: Subject, at: string): string {
  return render(templatesFor(state.professionId).cancelled, {
    ...baseVars(state, subject), dayThai: dayThai(at), dateThai: dateThai(at),
  })
}

/** สรุปกลางเดือน — ตัวเลขมาจาก ledger ทั้งหมด */
export function summaryText(state: AppState, subject: Subject, period: string): string {
  const templates = templatesFor(state.professionId)
  const qty = completionsIn(state, subject.id, period).length
  const pk = packageStatus(state, subject)
  const amountLine = pk
    ? render(templates.summaryPackage, { remaining: pk.remaining, packageTotal: pk.total })
    : render(templates.summaryAmount, { total: money(currentEstimate(state, subject, period)) })
  return render(templates.summary, {
    ...baseVars(state, subject), periodThai: periodThai(period), qty, amountLine,
  })
}

export function renewalText(state: AppState, subject: Subject, exhausted: boolean): string {
  const templates = templatesFor(state.professionId)
  const pk = packageStatus(state, subject)!
  const vars: Vars = {
    ...baseVars(state, subject),
    ...(state.mode === 'real' ? { invoiceUrl: state.provider.promptpayId ? `พร้อมเพย์ ${state.provider.promptpayId} ผู้รับ ${state.provider.name} แล้วส่งสลิปกลับในแชท` : 'ติดต่อผู้ให้บริการเพื่อขอข้อมูลชำระเงิน' } : {}),
    packageTotal: pk.total, packagePrice: money(pk.price),
    remaining: pk.remaining,
    overBy: pk.overBy,
  }
  if (exhausted) return render(templates.renewalExhausted, vars)
  return render(templates.renewal, vars)
}

export function receiptText(state: AppState, inv: Invoice, receiptId: string, total: number): string {
  const subject = subjectById(state, inv.subjectId)!
  return render(templatesFor(state.professionId).receipt, {
    ...baseVars(state, subject),
    invoiceUrl: invoiceUrlOf(subject.clientId, state, inv.id),
    periodThai: periodThai(inv.period),
    total: money(total),
    receiptUrl: receiptUrlOf(receiptId, state),
  })
}

export function slipRequestText(state: AppState, inv: Invoice, slipAmount: number): string {
  const subject = subjectById(state, inv.subjectId)!
  return render(templatesFor(state.professionId).slipRequest, {
    ...baseVars(state, subject),
    slipAmount: money(slipAmount),
    total: money(balanceDue(state, inv.id)),
  })
}

export const hasKey = (state: AppState, dedupeKey: string): boolean =>
  state.messages.some((m) => m.dedupeKey === dedupeKey)

let seq = 0
export function mkMessage(
  state: AppState, kind: MessageKind, clientId: string, subjectId: string | undefined,
  draft: string, dedupeKey: string, meta?: Record<string, unknown>,
): Message {
  seq += 1
  const message: Message = {
    id: `m-${dedupeKey}-${seq}`, clientId, subjectId, kind, draft,
    status: 'draft', createdAt: state.today, dedupeKey, ...(meta ? { meta } : {}),
  }
  const revision = financialRevision(state, message)
  return revision ? { ...message, meta: { ...meta, financialRevision: revision } } : message
}

function rerender(state: AppState, m: Message): string | null {
  const invOf = (id: unknown) => state.invoices.find((i) => i.id === id)
  const subjOf = () => (m.subjectId ? subjectById(state, m.subjectId) : undefined)

  if (m.kind === 'faq_reply' && m.meta?.answerFrom) {
    const question = typeof m.meta.question === 'string' ? m.meta.question
      : professionById(state.professionId).faq?.find(f => f.answerFrom === m.meta?.answerFrom)?.keywords[0]
    return question ? answer(state, m.clientId, question).text : null
  }

  if (m.kind === 'reminder') {
    const inv = invOf(m.meta?.invoiceId)
    const ladder = m.meta?.ladder as 'soft' | 'clear' | 'final' | undefined
    return inv && ladder ? reminderText(state, inv, ladder) : null
  }
  if (m.kind === 'invoice') {
    const inv = invOf(m.meta?.invoiceId)
    return inv ? invoiceText(state, inv) : null
  }
  if (m.kind === 'receipt') {
    const r = state.receipts.find((x) => x.id === m.meta?.receiptId)
    const pay = r ? state.payments.find((p) => p.id === r.paymentId) : undefined
    const inv = pay ? invOf(pay.invoiceId) : undefined
    return r && pay && inv ? receiptText(state, inv, r.id, inv.total) : null
  }
  if (m.kind === 'renewal' || m.kind === 'renewal_exhausted') {
    const subject = subjOf()
    if (!subject || !packageStatus(state, subject)) return null
    return renewalText(state, subject, m.kind === 'renewal_exhausted')
  }
  return null
}

/**
 * ร่างที่ยังไม่ส่งต้องสะกิดตัวเลขให้ตรง ledger เสมอ
 * ("ค้างมา 4 วัน" ที่ร่างไว้เมื่อวาน วันนี้ต้องเป็น 5) — ยกเว้นร่างที่ผู้ใช้แก้เอง
 * ครอบทุกชนิด เพราะร่างเก่าที่ค้างใน localStorage ต้องได้ข้อความรุ่นใหม่ด้วย
 */
export function refreshDrafts(state: AppState): Message[] {
  return state.messages.map((m) => {
    if (m.status !== 'draft' || m.edited || m.oaDelivery) return m
    const fresh = rerender(state, m)
    const revision = financialRevision(state, m)
    if (!fresh) return m
    return { ...m, draft: fresh, ...(revision ? { meta: { ...m.meta, financialRevision: revision } } : {}) }
  })
}

/**
 * สร้าง draft ที่ยังไม่มี — ไม่สร้างซ้ำถ้า dedupeKey เคยมีแล้ว (ไม่ว่าสถานะไหน)
 * reminder ระดับสูงกว่า = key ใหม่ จึงสร้างได้อีก
 */
/**
 * ร่างยังมีเหตุผลให้มีอยู่ไหม — ใช้เงื่อนไขชุดเดียวกับตอน deriveDrafts สร้างมัน
 * ร่างที่ผู้ใช้ส่งหรือข้ามไปแล้วไม่แตะ เพราะนั่นคือการตัดสินใจของเขา
 */
function stillStands(state: AppState, m: Message): boolean {
  const invOf = (id: unknown) => state.invoices.find((i) => i.id === id)

  if (m.kind === 'invoice') {
    const inv = invOf(m.meta?.invoiceId)
    return !!inv && inv.kind === 'monthly' && inv.status === 'draft'
  }
  if (m.kind === 'reminder') {
    const inv = invOf(m.meta?.invoiceId)
    if (!inv || (inv.status !== 'sent' && inv.status !== 'overdue')) return false
    return ladderFor(state, inv) === m.meta?.ladder
  }
  if (m.kind === 'renewal' || m.kind === 'renewal_exhausted') {
    const subject = m.subjectId ? subjectById(state, m.subjectId) : undefined
    if (!subject?.active) return false
    const pk = packageStatus(state, subject)
    if (!pk) return false
    return m.kind === 'renewal_exhausted'
      ? pk.overBy >= 1
      : pk.overBy === 0 && pk.remaining >= 1 && pk.remaining <= 2
  }
  // receipt ออกแล้วออกเลย · moved/cancelled/summary/faq_reply เกิดจากการกระทำ ไม่ใช่เงื่อนไข
  return true
}

/**
 * ถอนร่างที่เงื่อนไขหายไปแล้ว
 * ไม่มีขั้นนี้ ครูที่กด "แก้" ถอนเช็คชื่อจะเหลือร่างที่เขียนว่า
 * "วันนี้เรียนเป็นครั้งที่ 0 นอกแพ็ก" ค้างรอให้กดส่งหาผู้ปกครอง
 */
export function retractDrafts(state: AppState): Message[] {
  return state.messages.filter((m) => m.status !== 'draft' || !!m.oaDelivery || stillStands(state, m))
}

export function deriveDrafts(state: AppState): Message[] {
  const add: Message[] = []
  const seen = new Set(state.messages.map((m) => m.dedupeKey))
  const push = (m: Message) => { if (!seen.has(m.dedupeKey)) { seen.add(m.dedupeKey); add.push(m) } }

  for (const inv of state.invoices) {
    const subject = subjectById(state, inv.subjectId)
    if (!subject) continue

    if (inv.kind === 'monthly' && inv.status === 'draft') {
      push(mkMessage(state, 'invoice', inv.clientId, subject.id, invoiceText(state, inv), `inv:${inv.id}`, { invoiceId: inv.id }))
    }
    if (inv.status === 'sent' || inv.status === 'overdue') {
      const key = ladderFor(state, inv)
      if (key) {
        push(mkMessage(state, 'reminder', inv.clientId, subject.id, reminderText(state, inv, key),
          `rem:${inv.id}:${key}`, { invoiceId: inv.id, ladder: key }))
      }
    }
  }

  for (const p of state.payments) {
    const r = state.receipts.find((x) => x.paymentId === p.id)
    if (!r) continue
    const inv = state.invoices.find((i) => i.id === p.invoiceId)
    if (!inv) continue
    const subject = subjectById(state, inv.subjectId)
    if (!subject) continue
    // ยอดในใบเสร็จคือยอดบิล ไม่ใช่ยอดงวดสุดท้ายที่บังเอิญปิดยอดพอดี
    push(mkMessage(state, 'receipt', inv.clientId, subject.id, receiptText(state, inv, r.id, inv.total),
      `rcp:${p.id}`, { receiptId: r.id }))
  }

  for (const subject of state.subjects) {
    if (!subject.active) continue
    const pk = packageStatus(state, subject)
    if (!pk) continue
    if (pk.overBy >= 1) {
      push(mkMessage(state, 'renewal_exhausted', subject.clientId, subject.id, renewalText(state, subject, true),
        `ren:${subject.id}:${pk.purchasedAt}:ex`))
    } else if (pk.remaining >= 1 && pk.remaining <= 2) {
      push(mkMessage(state, 'renewal', subject.clientId, subject.id, renewalText(state, subject, false),
        `ren:${subject.id}:${pk.purchasedAt}:low`))
    }
  }
  return add
}

export const ORDER: MessageKind[] = ['moved', 'cancelled', 'reminder', 'invoice', 'renewal_exhausted', 'renewal', 'faq_reply', 'summary', 'receipt']
export const sortDrafts = (a: Message, b: Message): number => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)

/** ส่งข้อความแล้วผลข้างเคียงต่อ invoice */
export function applySend(state: AppState, msg: Message): AppState {
  if (msg.kind === 'invoice' && msg.meta?.invoiceId) {
    const invId = String(msg.meta.invoiceId)
    return {
      ...state,
      invoices: state.invoices.map((i) =>
        i.id === invId && i.status === 'draft'
          ? { ...i, status: 'sent' as const, sentAt: state.today, dueAt: addDays(state.today, dueDaysOf(state)) }
          : i),
    }
  }
  return state
}

export const currentEstimate = (state: AppState, subject: Subject, period: string): number => {
  const b = subject.billing
  if (b.mode === 'flat_monthly') return b.amount
  if (b.mode === 'per_unit') return completionsIn(state, subject.id, period)
    .reduce((sum, completion) => sum + (completion.unitPrice ?? b.rate), 0)
  return 0
}

export const monthlyInvoiceOf = invoiceFor
