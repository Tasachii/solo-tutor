import type { AppState, BillingMode } from './types'
import { isParticle } from './particle'
import { isStyle } from './style'

export const isMoney = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

export const isNonNegativeMoney = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function isISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export const isTime = (value: unknown): value is string =>
  typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)

export function isBillingMode(value: unknown): value is BillingMode {
  if (!value || typeof value !== 'object') return false
  const billing = value as Record<string, unknown>
  if (billing.mode === 'per_unit') return isMoney(billing.rate)
  if (billing.mode === 'flat_monthly') return isMoney(billing.amount)
  if (billing.mode !== 'package') return false
  if (!Number.isSafeInteger(billing.total) || Number(billing.total) <= 0) return false
  if (!isMoney(billing.price) || Math.round(billing.price / Number(billing.total)) <= 0 || !isISODate(billing.purchasedAt)) return false
  if (billing.carriedCredits !== undefined
    && (!Number.isSafeInteger(billing.carriedCredits) || Number(billing.carriedCredits) < 0)) return false
  return billing.carriedUnitIds === undefined
    || (Array.isArray(billing.carriedUnitIds) && billing.carriedUnitIds.every((id) => typeof id === 'string' && id.length > 0))
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const hasUniqueStrings = (rows: unknown[], key: string): boolean => {
  const ids = rows.map((row) => isRecord(row) ? row[key] : undefined)
  return ids.every((id) => isString(id) && id.length > 0) && new Set(ids).size === ids.length
}

export interface StateValidation { ok: boolean; errors: string[] }

export const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

/** ตรวจทั้ง shape และความสัมพันธ์ก่อน state ถูก hydrate/restore */
export function validateState(value: unknown): StateValidation {
  const errors: string[] = []
  if (!isRecord(value)) return { ok: false, errors: ['app: ต้องเป็น object'] }
  const app = value as Record<string, unknown>
  const arrays = ['clients', 'subjects', 'units', 'completions', 'invoices', 'payments', 'receipts', 'messages', 'chats', 'waitlist', 'events'] as const
  for (const key of arrays) if (!Array.isArray(app[key])) errors.push(`${key}: ต้องเป็น array`)
  if (errors.length) return { ok: false, errors }
  for (const key of arrays) {
    const rows = app[key] as unknown[]
    if (rows.length > 100_000) errors.push(`${key}: มีข้อมูลมากเกินขีดจำกัด`)
    if (rows.some((row) => !isRecord(row))) errors.push(`${key}: ทุกแถวต้องเป็น object`)
  }
  if (arrays.reduce((total, key) => total + (app[key] as unknown[]).length, 0) > 100_000) errors.push('app: มีข้อมูลรวมมากเกินขีดจำกัด')
  if (errors.length) return { ok: false, errors }

  const state = value as unknown as AppState
  if (state.schemaVersion !== 5) errors.push('schemaVersion: ไม่รองรับ')
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) errors.push('revision: ต้องเป็นจำนวนเต็มไม่ติดลบ')
  if ((state.lineWorkspaceId === undefined) !== (state.lineProviderId === undefined)
    || (state.lineProviderId !== undefined && !isUuid(state.lineProviderId))) errors.push('lineProviderId: ไม่ถูกต้อง')
  if (state.lineWorkspaceId !== undefined && !isUuid(state.lineWorkspaceId)) errors.push('lineWorkspaceId: ไม่ถูกต้อง')
  if (state.mode !== 'demo' && state.mode !== 'real') errors.push('mode: ไม่ถูกต้อง')
  if (!isString(state.professionId) || !state.professionId) errors.push('professionId: ไม่ถูกต้อง')
  if (!isString(state.scenarioId)) errors.push('scenarioId: ไม่ถูกต้อง')
  if (!isISODate(state.today)) errors.push('today: ต้องเป็นวันที่จริงรูปแบบ YYYY-MM-DD')
  if (!isRecord(state.provider) || !isString(state.provider.name) || !isString(state.provider.promptpayId)
    || (state.provider.particle !== undefined && !isParticle(state.provider.particle))) errors.push('provider: ไม่ถูกต้อง')
  if (typeof state.onboarded !== 'boolean') errors.push('onboarded: ไม่ถูกต้อง')
  if (state.style !== undefined && !isStyle(state.style)) errors.push('style: ไม่ถูกต้อง')
  if (state.lastBackupAt !== undefined && !isISODate(state.lastBackupAt)) errors.push('lastBackupAt: ไม่ถูกต้อง')
  if (!isRecord(state.counters)
    || !isNonNegativeMoney(state.counters.receipt) || !isNonNegativeMoney(state.counters.invoice)) errors.push('counters: ต้องเป็นจำนวนเต็มไม่ติดลบ')

  for (const [key, rows] of [['clients', state.clients], ['subjects', state.subjects], ['units', state.units],
    ['invoices', state.invoices], ['payments', state.payments], ['receipts', state.receipts],
    ['messages', state.messages], ['chats', state.chats]] as const) {
    if (!hasUniqueStrings(rows, 'id')) errors.push(`${key}: id ต้องมีค่าและไม่ซ้ำ`)
  }
  const completionIds = state.completions
    .filter(isRecord)
    .map((completion) => completion.unitId)
    .filter(isString)
  if (completionIds.length !== state.completions.length || new Set(completionIds).size !== completionIds.length) errors.push('completions: unitId ต้องมีค่าและไม่ซ้ำ')
  const completionIdSet = new Set(completionIds)

  const clientIds = new Set(state.clients.map((row) => row.id))
  const subjectIds = new Set(state.subjects.map((row) => row.id))
  const unitIds = new Set(state.units.map((row) => row.id))
  const invoiceIds = new Set(state.invoices.map((row) => row.id))
  const paymentIds = new Set(state.payments.map((row) => row.id))
  const messageIds = new Set(state.messages.map((row) => row.id))
  const subjectsById = new Map(state.subjects.map((row) => [row.id, row]))
  const unitsById = new Map(state.units.map((row) => [row.id, row]))
  const invoicesById = new Map(state.invoices.map((row) => [row.id, row]))
  const paymentsById = new Map(state.payments.map((row) => [row.id, row]))
  const receiptsById = new Map(state.receipts.map((row) => [row.id, row]))
  const paymentsByInvoiceId = new Map<string, typeof state.payments>()
  for (const payment of state.payments) {
    const grouped = paymentsByInvoiceId.get(payment.invoiceId) ?? []
    grouped.push(payment)
    paymentsByInvoiceId.set(payment.invoiceId, grouped)
  }

  state.clients.forEach((row, index) => {
    if (!isRecord(row)) { errors.push(`clients[${index}]: ต้องเป็น object`); return }
    if (!isString(row.name) || !row.name.trim()) errors.push(`clients[${index}].name: ต้องมีค่า`)
    if ((row.lineId !== undefined && !isString(row.lineId)) || (row.phone !== undefined && !isString(row.phone))) errors.push(`clients[${index}]: ช่องทางติดต่อไม่ถูกต้อง`)
  })
  state.subjects.forEach((row, index) => {
    if (!isRecord(row)) { errors.push(`subjects[${index}]: ต้องเป็น object`); return }
    if (!isString(row.name) || !row.name.trim()) errors.push(`subjects[${index}].name: ต้องมีค่า`)
    if (!clientIds.has(row.clientId)) errors.push(`subjects[${index}].clientId: ไม่พบผู้จ่าย`)
    if (!isBillingMode(row.billing)) errors.push(`subjects[${index}].billing: ไม่ถูกต้อง`)
    if (isBillingMode(row.billing) && row.billing.mode === 'package' && row.billing.carriedUnitIds) {
      const carried = row.billing.carriedUnitIds
      if (new Set(carried).size !== carried.length || carried.some((unitId) =>
        unitsById.get(unitId)?.subjectId !== row.id || !completionIdSet.has(unitId))) {
        errors.push(`subjects[${index}].billing.carriedUnitIds: ต้องเป็นงานที่ทำแล้วของรายการนี้และไม่ซ้ำ`)
      }
    }
    if (typeof row.active !== 'boolean' || !isISODate(row.createdAt)) errors.push(`subjects[${index}]: สถานะหรือวันที่ไม่ถูกต้อง`)
    if (row.label !== undefined && !isString(row.label)) errors.push(`subjects[${index}].label: ไม่ถูกต้อง`)
  })
  state.units.forEach((row, index) => {
    if (!isRecord(row)) { errors.push(`units[${index}]: ต้องเป็น object`); return }
    if (!subjectIds.has(row.subjectId)) errors.push(`units[${index}].subjectId: ไม่พบรายการ`)
    if (!isISODate(row.scheduledAt) || !isTime(row.time)) errors.push(`units[${index}]: วันหรือเวลาไม่ถูกต้อง`)
    if (!Number.isSafeInteger(row.durationMin) || row.durationMin <= 0) errors.push(`units[${index}].durationMin: ไม่ถูกต้อง`)
    if ((row.label !== undefined && !isString(row.label)) || (row.adHoc !== undefined && typeof row.adHoc !== 'boolean')
      || (row.cancelled !== undefined && typeof row.cancelled !== 'boolean')
      || (row.movedFrom !== undefined && !isISODate(row.movedFrom))) errors.push(`units[${index}]: ข้อมูลเสริมไม่ถูกต้อง`)
  })
  state.completions.forEach((row, index) => {
    if (!isRecord(row)) { errors.push(`completions[${index}]: ต้องเป็น object`); return }
    if (!unitIds.has(row.unitId)) errors.push(`completions[${index}].unitId: ไม่พบงาน`)
    if (!isISODate(row.completedAt)) errors.push(`completions[${index}].completedAt: ไม่ถูกต้อง`)
    if (row.unitPrice !== undefined && !isMoney(row.unitPrice)) errors.push(`completions[${index}].unitPrice: ไม่ถูกต้อง`)
    if (row.note !== undefined && !isString(row.note)) errors.push(`completions[${index}].note: ไม่ถูกต้อง`)
  })
  state.invoices.forEach((row, index) => {
    if (!isRecord(row)) { errors.push(`invoices[${index}]: ต้องเป็น object`); return }
    if (!clientIds.has(row.clientId) || !subjectIds.has(row.subjectId)) errors.push(`invoices[${index}]: ผู้จ่ายหรือรายการไม่พบ`)
    if (subjectsById.get(row.subjectId)?.clientId !== row.clientId) errors.push(`invoices[${index}].clientId: ไม่ใช่ผู้จ่ายของรายการนี้`)
    if (!isString(row.period) || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(row.period) || !isISODate(row.createdAt)) errors.push(`invoices[${index}]: รอบหรือวันที่ไม่ถูกต้อง`)
    if (!['monthly', 'package'].includes(row.kind) || !['draft', 'sent', 'paid', 'overdue'].includes(row.status)) errors.push(`invoices[${index}]: ชนิดหรือสถานะไม่ถูกต้อง`)
    if ((row.sentAt !== undefined && !isISODate(row.sentAt)) || (row.dueAt !== undefined && !isISODate(row.dueAt))) errors.push(`invoices[${index}]: วันส่งหรือวันครบกำหนดไม่ถูกต้อง`)
    if ((isISODate(row.sentAt) && row.sentAt < row.createdAt)
      || (isISODate(row.dueAt) && (!isISODate(row.sentAt) || row.dueAt < row.sentAt))) errors.push(`invoices[${index}]: ลำดับเวลาไม่ถูกต้อง`)
    if (!Array.isArray(row.lines) || row.lines.length === 0 || row.lines.some((line) =>
      !isRecord(line) || !isString(line.description) || !line.description.trim() || !Number.isSafeInteger(line.qty) || Number(line.qty) <= 0 || !isMoney(line.unitPrice) || !isMoney(line.amount))) {
      errors.push(`invoices[${index}].lines: ไม่ถูกต้อง`)
    } else if (!isMoney(row.total) || row.lines.reduce((sum, line) => sum + line.amount, 0) !== row.total) {
      errors.push(`invoices[${index}].total: ไม่ตรงกับรายการ`)
    }
  })
  state.payments.forEach((row, index) => {
    if (!isRecord(row)) { errors.push(`payments[${index}]: ต้องเป็น object`); return }
    if (!invoiceIds.has(row.invoiceId)) errors.push(`payments[${index}].invoiceId: ไม่พบบิล`)
    if (!isMoney(row.amount) || !isISODate(row.paidAt) || typeof row.slipVerified !== 'boolean') errors.push(`payments[${index}]: ยอดหรือวันที่ไม่ถูกต้อง`)
    const invoice = invoicesById.get(String(row.invoiceId))
    if (invoice && isISODate(row.paidAt) && row.paidAt < invoice.createdAt) errors.push(`payments[${index}].paidAt: เกิดก่อนสร้างบิล`)
    if (row.slipAmount !== undefined && !isNonNegativeMoney(row.slipAmount)) errors.push(`payments[${index}].slipAmount: ไม่ถูกต้อง`)
  })
  state.receipts.forEach((row, index) => {
    if (!isRecord(row)) { errors.push(`receipts[${index}]: ต้องเป็น object`); return }
    if (!paymentIds.has(row.paymentId)) errors.push(`receipts[${index}].paymentId: ไม่พบการชำระ`)
    if (!isString(row.number) || !isISODate(row.issuedAt)) errors.push(`receipts[${index}]: เลขหรือวันที่ไม่ถูกต้อง`)
    const snapshot = row.snapshot
    if (!isRecord(snapshot) || !isString(snapshot.provider) || !isString(snapshot.destination)
      || !isString(snapshot.payer) || !isString(snapshot.subject)
      || !isString(snapshot.period) || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(snapshot.period)
      || !Array.isArray(snapshot.lines) || snapshot.lines.length === 0
      || !snapshot.payer.trim() || !snapshot.subject.trim()
      || snapshot.lines.some(line => !isRecord(line) || !isString(line.description) || !line.description.trim()
        || !Number.isSafeInteger(line.qty) || Number(line.qty) <= 0 || !isMoney(line.unitPrice) || !isMoney(line.amount))
      || !isMoney(snapshot.total) || snapshot.lines.reduce((sum, line) => sum + Number(line.amount), 0) !== snapshot.total
      || !isMoney(snapshot.paid) || snapshot.paid !== snapshot.total || typeof snapshot.slipVerified !== 'boolean'
      || (snapshot.slipAmount !== undefined && !isNonNegativeMoney(snapshot.slipAmount))
      || (snapshot.legacyBackfill !== undefined && snapshot.legacyBackfill !== true)) {
      errors.push(`receipts[${index}].snapshot: ไม่ถูกต้อง`)
    }
    const payment = paymentsById.get(String(row.paymentId))
    const invoice = payment && invoicesById.get(payment.invoiceId)
    const invoicePayments = invoice ? paymentsByInvoiceId.get(invoice.id) ?? [] : []
    const aggregateVerified = invoicePayments.length > 0 && invoicePayments.every(candidate => candidate.slipVerified)
    const aggregateSlipAmount = invoicePayments.length > 0 && invoicePayments.every(candidate => candidate.slipAmount !== undefined)
      ? invoicePayments.reduce((sum, candidate) => sum + candidate.slipAmount!, 0)
      : undefined
    if (payment && isRecord(snapshot) && (snapshot.slipVerified !== aggregateVerified
      || snapshot.slipAmount !== aggregateSlipAmount)) {
      errors.push(`receipts[${index}].snapshot: หลักฐานตรวจยอดไม่ตรงกับการชำระ`)
    }
    if (invoice && isRecord(snapshot) && (snapshot.period !== invoice.period || snapshot.total !== invoice.total
      || JSON.stringify(snapshot.lines) !== JSON.stringify(invoice.lines))) {
      errors.push(`receipts[${index}].snapshot: รายการไม่ตรงกับบิลที่ออก`)
    }
    if (invoice?.status !== 'paid') errors.push(`receipts[${index}]: ออกได้เมื่อบิลชำระครบแล้วเท่านั้น`)
    if (payment && row.issuedAt !== payment.paidAt) errors.push(`receipts[${index}].issuedAt: ต้องตรงกับการชำระที่ปิดยอด`)
    if (invoicePayments.some((candidate) => candidate.paidAt > row.issuedAt)
      || (invoicePayments.length > 0 && invoicePayments.at(-1)?.id !== row.paymentId)) {
      errors.push(`receipts[${index}]: ไม่ได้ผูกกับการชำระครั้งสุดท้าย`)
    }
  })
  if (new Set(state.receipts.map((receipt) => receipt.number)).size !== state.receipts.length) errors.push('receipts: เลขใบเสร็จซ้ำ')
  if (new Set(state.receipts.map((receipt) => receipt.paymentId)).size !== state.receipts.length) errors.push('receipts: การชำระหนึ่งรายการมีใบเสร็จซ้ำ')
  const receiptInvoiceIds = state.receipts.map((receipt) => {
    const payment = paymentsById.get(receipt.paymentId)
    return payment?.invoiceId
  }).filter(isString)
  if (new Set(receiptInvoiceIds).size !== receiptInvoiceIds.length) errors.push('receipts: บิลหนึ่งใบมีใบเสร็จซ้ำ')
  state.messages.forEach((row, index) => {
    if (!isRecord(row)) { errors.push(`messages[${index}]: ต้องเป็น object`); return }
    if (!clientIds.has(row.clientId)) errors.push(`messages[${index}].clientId: ไม่พบผู้จ่าย`)
    if (row.subjectId !== undefined && !subjectIds.has(row.subjectId)) errors.push(`messages[${index}].subjectId: ไม่พบรายการ`)
    if (isString(row.subjectId) && subjectsById.get(row.subjectId)?.clientId !== row.clientId) errors.push(`messages[${index}].clientId: ไม่ใช่ผู้จ่ายของรายการนี้`)
    if (!['invoice', 'reminder', 'renewal', 'renewal_exhausted', 'receipt', 'faq_reply', 'moved', 'cancelled', 'summary'].includes(row.kind)
      || !['draft', 'sent', 'skipped'].includes(row.status) || !isISODate(row.createdAt)
      || !isString(row.draft) || !row.draft.trim() || !isString(row.dedupeKey) || !row.dedupeKey.trim()) errors.push(`messages[${index}]: สถานะหรือข้อมูลไม่ถูกต้อง`)
    if (row.oaDelivery !== undefined) {
      const d = row.oaDelivery
      if (!isRecord(d) || row.status !== 'draft' || state.mode !== 'real'
        || d.workspaceId !== state.lineWorkspaceId || d.providerId !== state.lineProviderId
        || !['providerId', 'workspaceId', 'recipientId'].every(k => isUuid(d[k]))
        || !isString(d.body) || !d.body.trim() || d.body !== row.draft
        || d.dedupeKey !== `${state.lineWorkspaceId}:${row.dedupeKey}`) errors.push(`messages[${index}].oaDelivery: ไม่ถูกต้อง`)
    }
    if ((row.sentAt !== undefined && !isISODate(row.sentAt)) || (row.edited !== undefined && typeof row.edited !== 'boolean')
      || (row.meta !== undefined && !isRecord(row.meta))) errors.push(`messages[${index}]: ข้อมูลเสริมไม่ถูกต้อง`)
    if ((row.kind === 'invoice' || row.kind === 'reminder')
      && (!isRecord(row.meta) || !isString(row.meta.invoiceId) || !invoiceIds.has(row.meta.invoiceId))) {
      errors.push(`messages[${index}].meta.invoiceId: ไม่พบบิล`)
    }
    if ((row.kind === 'invoice' || row.kind === 'reminder') && isRecord(row.meta) && isString(row.meta.invoiceId)) {
      const invoice = invoicesById.get(row.meta.invoiceId)
      if (invoice && (invoice.clientId !== row.clientId || invoice.subjectId !== row.subjectId)) {
        errors.push(`messages[${index}].meta.invoiceId: บิลไม่ตรงกับผู้รับหรือรายการ`)
      }
    }
    if (row.kind === 'receipt'
      && (!isRecord(row.meta) || !isString(row.meta.receiptId)
        || !receiptsById.has(row.meta.receiptId))) {
      errors.push(`messages[${index}].meta.receiptId: ไม่พบใบเสร็จ`)
    }
    if (row.kind === 'receipt' && isRecord(row.meta) && isString(row.meta.receiptId)) {
      const receipt = receiptsById.get(row.meta.receiptId)
      const payment = receipt && paymentsById.get(receipt.paymentId)
      const invoice = payment && invoicesById.get(payment.invoiceId)
      if (invoice && (invoice.clientId !== row.clientId || invoice.subjectId !== row.subjectId)) {
        errors.push(`messages[${index}].meta.receiptId: ใบเสร็จไม่ตรงกับผู้รับหรือรายการ`)
      }
    }
  })
  if (new Set(state.messages.map(message => message.dedupeKey)).size !== state.messages.length) errors.push('messages: dedupeKey ต้องไม่ซ้ำ')
  state.chats.forEach((row, index) => {
    if (!isRecord(row)) { errors.push(`chats[${index}]: ต้องเป็น object`); return }
    if (!clientIds.has(row.clientId) || !['client', 'provider'].includes(row.from)
      || !isString(row.text) || !row.text.trim() || !isISODate(row.at)) errors.push(`chats[${index}]: ไม่ถูกต้อง`)
    if (row.viaAdmin !== undefined && typeof row.viaAdmin !== 'boolean') errors.push(`chats[${index}].viaAdmin: ไม่ถูกต้อง`)
  })
  state.waitlist.forEach((row, index) => {
    if (!isRecord(row)) { errors.push(`waitlist[${index}]: ต้องเป็น object`); return }
    if (!isString(row.professionId) || !row.professionId.trim() || !isString(row.name) || !row.name.trim()
      || !isString(row.contact) || !row.contact.trim() || !isISODate(row.at)) errors.push(`waitlist[${index}]: ไม่ถูกต้อง`)
    if ((row.size !== undefined && !isString(row.size))
      || (row.modes !== undefined && (!Array.isArray(row.modes) || row.modes.some((mode) => !isString(mode))))
      || (row.concierge !== undefined && typeof row.concierge !== 'boolean')) errors.push(`waitlist[${index}]: ข้อมูลเสริมไม่ถูกต้อง`)
  })
  state.events.forEach((row, index) => {
    if (!isRecord(row)) { errors.push(`events[${index}]: ต้องเป็น object`); return }
    if (!isString(row.at) || Number.isNaN(Date.parse(row.at)) || !isString(row.name) || !row.name.trim()
      || (row.props !== undefined && !isRecord(row.props))) errors.push(`events[${index}]: ไม่ถูกต้อง`)
  })
  const paidByInvoice = new Map<string, number>()
  for (const [invoiceId, payments] of paymentsByInvoiceId) {
    paidByInvoice.set(invoiceId, payments.reduce((total, payment) => total + (isMoney(payment.amount) ? payment.amount : 0), 0))
  }
  for (const invoice of state.invoices) {
    if (!isRecord(invoice) || !isString(invoice.id) || !isMoney(invoice.total)) continue
    const paid = paidByInvoice.get(invoice.id) ?? 0
    if (paid > invoice.total) errors.push(`invoices.${invoice.id}: รับเงินเกินยอดบิล`)
    if (invoice.status === 'paid' && paid !== invoice.total) errors.push(`invoices.${invoice.id}: สถานะจ่ายแล้วแต่ยอดไม่ครบ`)
    if (invoice.status !== 'paid' && paid >= invoice.total) errors.push(`invoices.${invoice.id}: ยอดครบแต่สถานะยังไม่ปิด`)
  }
  if (state.sending !== undefined && (!isRecord(state.sending)
    || !isString(state.sending.awaiting) || !Array.isArray(state.sending.queue)
    || state.sending.queue.some((id) => !isString(id))
    || (isString(state.sending.awaiting) && !messageIds.has(state.sending.awaiting))
    || (Array.isArray(state.sending.queue) && state.sending.queue.some((id) => isString(id) && !messageIds.has(id))))) errors.push('sending: ไม่ถูกต้อง')
  const maxReceiptSequence = state.receipts.reduce((max, receipt) => {
    const idSequence = isString(receipt.id) ? Number(receipt.id.match(/^rc-(\d+)$/)?.[1] ?? 0) : 0
    const numberSequence = isString(receipt.number) ? Number(receipt.number.match(/-(\d+)$/)?.[1] ?? 0) : 0
    return Math.max(max, idSequence, numberSequence)
  }, 0)
  if (isRecord(state.counters) && Number.isSafeInteger(state.counters.receipt)
    && state.counters.receipt < Math.max(state.receipts.length, maxReceiptSequence)) {
    errors.push('counters.receipt: ต่ำกว่าจำนวนใบเสร็จ')
  }
  return { ok: errors.length === 0, errors }
}
