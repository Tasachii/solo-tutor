import type { AppState, InvoiceLine } from './types'
import { paidAmount } from './ledger'

/** A dated copy, not an authenticated or live ledger. Never serialize the provider workspace. */
export interface SharedDocument {
  v: 1; kind: 'invoice' | 'receipt'; asOf: string; provider: string; destination: string
  payer: string; subject: string; period: string; lines: InvoiceLine[]
  total: number; paid: number; dueAt?: string; number?: string
}
const MAX_TOKEN = 16000
const string = (x: unknown, max = 300): x is string => typeof x === 'string' && x.length <= max
const amount = (x: unknown): x is number => Number.isSafeInteger(x) && Number(x) >= 0
const date = (x: unknown): x is string => string(x) && /^\d{4}-\d{2}-\d{2}$/.test(x) &&
  Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x
/**
 * ตรวจโครงสร้างและความสอดคล้องของยอด — ไม่ใช่ลายเซ็นความแท้
 * ใช้ทั้งกับลิงก์รุ่นเดิมที่ถอดจาก URL และกับ plaintext ที่เพิ่งถอดรหัสจากลิงก์รุ่นใหม่
 */
export function isSharedDocument(x: unknown): x is SharedDocument {
  if (!x || typeof x !== 'object') return false
  const d = x as SharedDocument
  return d.v === 1 && ['invoice', 'receipt'].includes(d.kind) && date(d.asOf) &&
    string(d.provider) && string(d.destination, 30) && string(d.payer) && string(d.subject) &&
    string(d.period) && /^\d{4}-(0[1-9]|1[0-2])$/.test(d.period) &&
    amount(d.total) && amount(d.paid) && d.paid <= d.total &&
    (d.dueAt === undefined || date(d.dueAt)) &&
    (d.kind !== 'receipt' || (string(d.number) && !!d.number && d.paid === d.total)) &&
    Array.isArray(d.lines) && d.lines.length > 0 && d.lines.length <= 100 && d.lines.every(l =>
      l && string(l.description, 1000) && amount(l.qty) && l.qty > 0 && amount(l.unitPrice) && amount(l.amount)) &&
    d.lines.reduce((n, l) => n + l.amount, 0) === d.total
}
export function invoiceDocument(state: AppState, invoiceId: string): SharedDocument | null {
  const inv = state.invoices.find(i => i.id === invoiceId)
  if (!inv) return null
  const payer = state.clients.find(c => c.id === inv.clientId)
  const subject = state.subjects.find(s => s.id === inv.subjectId)
  if (!payer || !subject) return null
  return {
    v: 1, kind: 'invoice', asOf: state.today, provider: state.provider.name,
    destination: state.provider.promptpayId, payer: payer.name, subject: subject.name, period: inv.period,
    lines: inv.lines.map(l => ({ ...l })), total: inv.total,
    paid: paidAmount(state, inv.id),
    ...(inv.dueAt ? { dueAt: inv.dueAt } : {}),
  }
}
export function receiptDocument(state: AppState, receiptId: string): SharedDocument | null {
  const rc = state.receipts.find(r => r.id === receiptId)
  if (!rc) return null
  const snapshot = rc.snapshot
  return {
    v: 1, kind: 'receipt', asOf: rc.issuedAt, provider: snapshot.provider,
    destination: snapshot.destination, payer: snapshot.payer, subject: snapshot.subject,
    period: snapshot.period, lines: snapshot.lines.map(line => ({ ...line })),
    total: snapshot.total, paid: snapshot.paid, number: rc.number,
  }
}
export function documentUrl(doc: SharedDocument): string {
  if (!isSharedDocument(doc)) throw new Error('ข้อมูลเอกสารไม่ครบหรือยอดไม่ตรงกัน')
  const bytes = new TextEncoder().encode(JSON.stringify(doc))
  const token = btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  if (token.length > MAX_TOKEN) throw new Error('เอกสารยาวเกินไป กรุณาพิมพ์หรือบันทึกเป็น PDF')
  return `${typeof location === 'undefined' ? '' : location.origin}${import.meta.env.BASE_URL}#/document/${token}`
}
export function readDocument(token: string): SharedDocument | null {
  if (!token || token.length > MAX_TOKEN || !/^[\w-]+$/.test(token)) return null
  try {
    const raw = atob(token.replace(/-/g, '+').replace(/_/g, '/'))
    const doc: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(raw, c => c.charCodeAt(0))))
    return isSharedDocument(doc) ? doc : null
  } catch { return null }
}
