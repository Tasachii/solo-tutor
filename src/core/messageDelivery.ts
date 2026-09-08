import type { AppState, Message } from './types'
import { isPaymentDestination } from './paymentDestination'
import { LINE_TEXT_LIMIT } from './share'

export const isFinancialMessage = (message: Message): boolean =>
  ['invoice', 'reminder', 'nudge', 'renewal', 'renewal_exhausted', 'receipt'].includes(message.kind)
  || (message.kind === 'faq_reply' && ['currentInvoice', 'paymentStatus'].includes(String(message.meta?.answerFrom)))

/** Revision of recipient data used to author a financial message, independent of custom prose. */
export function financialRevision(state: AppState, message: Message): string | null {
  if (!isFinancialMessage(message)) return null
  const invoices = state.invoices.filter(i => i.clientId === message.clientId)
  const invoiceIds = new Set(invoices.map(i => i.id))
  const payments = state.payments.filter(p => invoiceIds.has(p.invoiceId))
  const paymentIds = new Set(payments.map(p => p.id))
  const serialized = JSON.stringify([state.today, state.provider, state.professionId,
    state.clients.find(c => c.id === message.clientId),
    state.subjects.filter(s => s.clientId === message.clientId), invoices, payments,
    state.receipts.filter(r => paymentIds.has(r.paymentId))])
  // Compact change detection only, never an authentication/signature mechanism.
  // Avoid copying a client's entire financial history into every draft.
  let first = 0x811c9dc5, second = 0x9e3779b9
  for (let i = 0; i < serialized.length; i++) {
    const code = serialized.charCodeAt(i)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x5bd1e995)
  }
  return `v1:${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

export function messageSendIssue(state: AppState, message: Message): string | null {
  if (!message.draft.trim()) return 'กรุณาเขียนข้อความก่อนส่ง'
  if (!state.clients.some(client => client.id === message.clientId)) return 'ไม่พบผู้รับข้อความ กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่'
  if (message.draft.length > LINE_TEXT_LIMIT) return 'ข้อความยาวเกินที่ LINE รับได้ กรุณาย่อข้อความหรือส่งเอกสาร PDF แยกก่อนส่ง'
  if (state.mode !== 'real') return null
  if (isFinancialMessage(message) && message.meta?.financialRevision !== financialRevision(state, message)) {
    return 'ยอดหรือข้อมูลเปลี่ยนหลังเขียนข้อความ กรุณาสร้างข้อความจากยอดล่าสุดก่อนส่ง (ข้อความที่แก้เองยังถูกเก็บไว้)'
  }
  const financial = ['invoice', 'reminder', 'nudge', 'renewal', 'renewal_exhausted'].includes(message.kind)
    || (message.kind === 'faq_reply' && ['currentInvoice', 'paymentStatus'].includes(String(message.meta?.answerFrom)))
  if (financial && (!state.provider.name.trim() || !isPaymentDestination(state.provider.promptpayId))) {
    return 'กรุณาตั้งชื่อผู้รับเงินและเลขพร้อมเพย์ที่ถูกต้องก่อนส่งข้อมูลชำระเงิน'
  }
  if (/#\/(client|receipt)\//.test(message.draft)) return 'ข้อความนี้ยังใช้ลิงก์เดิมที่เปิดได้เฉพาะเครื่องนี้ กรุณาสร้างข้อความใหม่ก่อนส่ง'
  return null
}
