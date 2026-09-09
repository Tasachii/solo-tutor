import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, useRef, type ReactNode,
} from 'react'
import type { AppState, Message, Subject, Particle, WorkStyle, OaDelivery } from './types'
import { isParticle } from './particle'
import { isStyle } from './style'
import { buildReal, buildScenario, isScenario } from './scenarios'
import { appendEvent } from './events'
import { periodOf, todayISO } from './format'
import { isWellFormed } from './backup'
import { urlParam } from './urlParams'
import { billingChangeIssue, buildPackageInvoice, closableSubjects, isFinalizedPeriod, markOverdue, mutationTouchesFinalizedPeriod, reconcileDraftInvoices } from './billing'
import { deriveDrafts, refreshDrafts, retractDrafts, applySend, cancelledText, mkMessage, movedText, nudgeMessage, homeworkAssignMessage, homeworkReminderMessage } from './messages'
import { HOMEWORK_TEXT_MAX, homeworkOf, homeworkStatus } from './homework'
import { balanceDue, complete as ledgerComplete, packageStatus, renewPackage, snapshotLegacyPrices, uncomplete } from './ledger'
import { issueReceipt } from './receipts'
import { isUuid, isBillingMode, isISODate, isMoney, isNonNegativeMoney, isTime } from './validation'
import { financialRevision, messageSendIssue, oaDedupeKey } from './messageDelivery'
import { migrateCanonical } from './migrations'
import { applyClientTombstones, applyTombstones, clientTombstonesOf, mergeClientTombstones,
  mergeTombstones, pruneTombstones, tombstonesOf, withClientTombstones, withTombstones,
  type SubjectTombstone } from './tombstones'
import {
  ACTIVE_MODE_KEY, DEMO_SLOT_KEY, REAL_SLOT_KEY, parkedKey, readSlot, resolveActiveMode,
  slotKey, writeActiveMode, writerLockName, type WorkspaceMode,
} from './workspace'

/**
 * คีย์ของ workspace ที่แท็บนี้ใช้อยู่ตอนนี้
 *
 * ส่งออกเป็น STORAGE_KEY และ "ตั้งค่าใหม่" ตอนสลับโหมดโดยตั้งใจ — ES module binding เป็นแบบ live
 * ผู้ import จึงเห็นค่าล่าสุด จอ ErrorBoundary อ่านค่านี้ตอนแอปพัง และต้องล้าง workspace
 * ที่ครูอยู่จริง ไม่ใช่ช่องที่โมดูลนี้บังเอิญเปิดมาตอนโหลด
 *
 * เป็นค่าระดับเอกสาร (หนึ่งแท็บ = หนึ่ง StoreProvider) — ตัวจริงที่ provider ใช้เขียนคือ activeKey ใน ref
 */
let KEY: string = DEMO_SLOT_KEY
const ACCOUNT_DELETED_KEY = 'solo-tutor:account-deleted'
const ACCOUNT_DELETED_EVENT = 'solo-tutor:account-deleted'
const SCHEMA = 5

type AccountDeletedMarker = { version: 1; state: AppState }

function readDeletedMarker(raw: string | null): AppState | null {
  if (!raw) return null
  try {
    const marker = JSON.parse(raw) as Partial<AccountDeletedMarker>
    if (marker.version !== 1) return null
    const state = migrateCanonical(marker.state)
    return state?.mode === 'real' && !hasAccountLedgerData(state) ? state : null
  } catch {
    return null
  }
}

function hasAccountLedgerData(state: AppState): boolean {
  return state.clients.length > 0 || state.subjects.length > 0 || state.units.length > 0
    || state.completions.length > 0 || state.invoices.length > 0 || state.payments.length > 0
    || state.receipts.length > 0 || state.messages.length > 0 || state.chats.length > 0
    || (state.homework?.length ?? 0) > 0
}

export type Action =
  | { type: 'complete'; unitId: string }
  | { type: 'uncomplete'; unitId: string }
  | { type: 'closeMonth'; period: string }
  | { type: 'sendMessage'; id: string }
  | { type: 'lineWorkspace'; id: string; providerId: string }
  | { type: 'oaStart'; id: string; delivery: OaDelivery }
  | { type: 'oaRecover'; id: string; delivery: OaDelivery }
  | { type: 'oaSent'; id: string; providerId: string }
  | { type: 'oaCancelled'; id: string; providerId: string }
  | { type: 'skipMessage'; id: string }
  | { type: 'editMessage'; id: string; draft: string }
  | { type: 'refreshMessage'; id: string }
  | { type: 'addMessage'; message: Message }
  | { type: 'recordPayment'; invoiceId: string; amount: number; slipVerified: boolean; slipAmount?: number }
  | { type: 'renewPackage'; subjectId: string; slipVerified?: boolean; total?: number; price?: number }
  | { type: 'upsertSubject'; subject: Subject; clientName: string; lineId?: string | null; packageIntent?: 'opening_balance' | 'paid_purchase' }
  | { type: 'deactivateSubject'; subjectId: string }
  | { type: 'reactivateSubject'; subjectId: string }
  | { type: 'deleteSubject'; subjectId: string }
  | { type: 'addUnit'; subjectId: string; time: string; label?: string; date?: string }
  | { type: 'chat'; clientId: string; from: 'client' | 'provider'; text: string; viaAdmin?: boolean }
  | { type: 'waitlist'; entry: AppState['waitlist'][number] }
  | { type: 'setToday'; date: string }
  | { type: 'setProvider'; name: string; promptpayId: string; particle?: Particle }
  | { type: 'bulkAddSubjects'; rows: { name: string; clientName: string; lineId?: string; billing?: Subject['billing'] }[]; billing: Subject['billing'] }
  | { type: 'onboarded' }
  | { type: 'finishOnboarding'; provider: AppState['provider']; rows: { name: string; clientName: string; lineId?: string; clientId?: string }[]; billing: Subject['billing']; packageIntent?: 'opening_balance' | 'paid_purchase' }
  | { type: 'startReal' }
  | { type: 'setStyle'; style: WorkStyle }
  | { type: 'backedUp' }
  | { type: 'sendingStart'; awaiting: string; queue: string[] }
  | { type: 'sendingNext'; awaiting: string }
  | { type: 'sendingStop' }
  | { type: 'restore'; state: AppState }
  | { type: 'rescheduleUnit'; unitId: string; date: string; time: string }
  | { type: 'cancelUnit'; unitId: string }
  | { type: 'restoreUnit'; unitId: string }
  | { type: 'clearMessages' }
  /** ทวงสั้นจากแท็บทวงเงิน — วันละใบต่อบิล เข้าคิวรอครูกดส่ง */
  | { type: 'nudgeInvoice'; invoiceId: string }
  /** มอบหมายการบ้านให้หลายคนพร้อมกัน — หนึ่งรายการ + หนึ่งร่างต่อคน */
  | { type: 'addHomework'; subjectIds: string[]; text: string; dueAt: string }
  | { type: 'homeworkSubmitted'; id: string }
  | { type: 'homeworkReopen'; id: string }
  | { type: 'deleteHomework'; id: string }
  /** ทวงซ้ำด้วยมือ — key ต่อวัน ไม่ชนกับใบอัตโนมัติ */
  | { type: 'remindHomework'; id: string }
  | { type: 'deleteAccountLocal' }
  | { type: 'replace'; state: AppState }
  | { type: 'track'; name: string; props?: Record<string, unknown> }

/**
 * ยกสมุดบัญชีมาทั้งก้อน — กู้คืนไฟล์ · ดึงจากคลาวด์ · เริ่มใช้จริง · ลบบัญชี
 * ครูไม่ได้เพิ่งออกบิลหรือรับเงินเท่าจำนวนที่โผล่มา ตัวนับการใช้งานจึงต้องตั้งฐานใหม่เงียบ ๆ ไม่ใช่รายงานว่ามีงานเกิดขึ้น
 */
const LEDGER_REPLACEMENT_ACTIONS = new Set<Action['type']>(['restore', 'replace', 'startReal', 'deleteAccountLocal'])

let uid = 0
const nid = (p: string): string => { uid += 1; return `${p}-${Date.now().toString(36)}${uid}` }

function recordPackagePurchase(state: AppState, subject: Subject, slipVerified = false): AppState {
  if (subject.billing.mode !== 'package') return state
  const invoice = buildPackageInvoice(subject, state, nid('inv-pkg'))
  if (!invoice) return state
  const payment = { id: nid('pay'), invoiceId: invoice.id, amount: invoice.total,
    paidAt: state.today, slipVerified }
  const withPayment = { ...state, invoices: [...state.invoices, invoice], payments: [...state.payments, payment] }
  return issueReceipt(withPayment, payment).state
}

/**
 * จดว่าครูสั่งลบคนนี้ — เก็บไว้ในสมุดบัญชีเอง จึงติดไปกับไฟล์สำรองและก้อนบนคลาวด์
 * ไม่มีบรรทัดนี้ การลบคือ "ความว่างเปล่า" ที่สำเนาเก่ากว่าทับกลับมาได้เสมอ
 */
function rememberDeletion(s: AppState, id: string, mode: SubjectTombstone['mode']): AppState {
  return withTombstones(s, pruneTombstones(mergeTombstones(tombstonesOf(s), [{ id, at: s.today, mode }]), s.today))
}

/**
 * รับสมุดบัญชีทั้งก้อนจากที่อื่น (ไฟล์สำรอง · คลาวด์ · สำเนาก่อนดึง) แล้วบังคับใช้เจตนาลบทั้งสองฝั่ง
 * คืน null เมื่อผลลัพธ์ไม่ผ่านการตรวจ — ยอมไม่กู้คืน ดีกว่ากู้คืนแล้วเดาว่าอะไรควรอยู่ควรไป
 */
function applyDeletionsOnRestore(local: AppState, incoming: AppState): AppState | null {
  // ข้ามโหมด (ไฟล์เดโมมาลงช่องเดโม) ถือเป็นคนละสมุดบัญชี — หลุมศพของอีกฝั่งไม่เกี่ยวและต้องไม่ตามไป
  const sameLedger = incoming.mode === local.mode
  const rows = pruneTombstones(sameLedger
    ? mergeTombstones(tombstonesOf(local), tombstonesOf(incoming))
    : tombstonesOf(incoming), incoming.today)
  const clientRows = pruneTombstones(sameLedger
    ? mergeClientTombstones(clientTombstonesOf(local), clientTombstonesOf(incoming))
    : clientTombstonesOf(incoming), incoming.today)
  // นักเรียนก่อน ผู้จ่ายทีหลัง — ผู้จ่ายจะถูกลบได้ก็ต่อเมื่อไม่เหลือนักเรียนของเขาแล้วจริง ๆ
  const applied = applyClientTombstones(applyTombstones(incoming, rows), clientRows)
  const merged = withClientTombstones(withTombstones(applied.state, rows), applied.kept)
  return isWellFormed(merged) ? merged : null
}

/** ทุก action วิ่งผ่านที่นี่ แล้ว normalize (markOverdue + deriveDrafts) ตอนท้ายเสมอ */
export function reducer(state: AppState, action: Action): AppState {
  if ((action.type === 'complete' || action.type === 'uncomplete' || action.type === 'cancelUnit'
    || action.type === 'restoreUnit') && mutationTouchesFinalizedPeriod(state, action.unitId)) return state
  if (action.type === 'rescheduleUnit' && mutationTouchesFinalizedPeriod(state, action.unitId, action.date)) return state
  if (['editMessage', 'skipMessage', 'refreshMessage', 'sendMessage', 'sendingStart', 'sendingNext'].includes(action.type)) {
    const id = 'id' in action ? action.id : 'awaiting' in action ? action.awaiting : undefined
    if (state.messages.some(m => m.id === id && m.oaDelivery)) return state
  }
  if (state.messages.some(m => m.oaDelivery) && ['restore', 'replace', 'startReal'].includes(action.type)) return state
  let s = state
  switch (action.type) {
    case 'complete': s = ledgerComplete(s, action.unitId); break
    case 'uncomplete': s = uncomplete(s, action.unitId); break
    case 'closeMonth': {
      if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(action.period)) return state
      const created = closableSubjects(s, action.period).map((c) => c.invoice)
      if (created.length) s = { ...s, invoices: [...s.invoices, ...created] }
      break
    }
    case 'lineWorkspace':
      // ไม่ดูโหมด — สมุดตัวอย่างมีสมุด LINE ของตัวเองได้ ใต้บัญชีครูที่ล็อกอินอยู่ (แผน v2 §2)
      if (s.lineWorkspaceId || !isUuid(action.id) || !isUuid(action.providerId)) return state
      s = { ...s, lineWorkspaceId: action.id, lineProviderId: action.providerId }; break
    case 'oaCancelled':
      if (s.sending) return state
      if (!s.messages.some(m => m.id === action.id && m.oaDelivery?.providerId === action.providerId)) return state
      s = { ...s, messages: s.messages.map(m => m.id === action.id ? { ...m, oaDelivery: undefined } : m) }; break
    case 'oaRecover':
    case 'oaStart': {
      const msg = s.messages.find(m => m.id === action.id)
      // ไม่ดูโหมด — เดโมเข้าคิว OA ได้เมื่อครูล็อกอินและผู้ปกครองจับคู่แล้ว (คีย์ของเดโมมี demo: นำหน้า)
      if (!msg || msg.status !== 'draft' || msg.oaDelivery
        || s.lineProviderId !== action.delivery.providerId
        || !!s.sending || s.lineWorkspaceId !== action.delivery.workspaceId
        || !isUuid(action.delivery.recipientId) || action.delivery.dedupeKey !== oaDedupeKey(s, msg)
        || typeof action.delivery.body !== 'string' || !action.delivery.body.trim() || action.delivery.body.length > 5000
        || (action.type === 'oaStart' && (action.delivery.body !== msg.draft || messageSendIssue(s, msg)))) return state
      s = { ...s, messages: s.messages.map(m => m.id === msg.id ? { ...m, draft: action.delivery.body, oaDelivery: action.delivery } : m) }
      break
    }
    case 'oaSent':
    case 'sendMessage': {
      const msg = s.messages.find((m) => m.id === action.id)
      if (!msg || msg.status !== 'draft') return state
      if (action.type === 'oaSent') {
        if (msg.oaDelivery?.providerId !== action.providerId) return state
      } else if (messageSendIssue(s, msg)) return state
      s = applySend(s, msg)
      s = { ...s, messages: s.messages.map((m) => (m.id === action.id ? { ...m, status: 'sent', sentAt: s.today, oaDelivery: undefined } : m)) }
      if (msg.subjectId) {
        s = { ...s, chats: [...s.chats, { id: nid('ch'), clientId: msg.clientId, from: 'provider', text: msg.draft, at: s.today, viaAdmin: true }] }
      }
      break
    }
    case 'skipMessage':
      s = { ...s, messages: s.messages.map((m) => (m.id === action.id ? { ...m, status: 'skipped' } : m)) }
      break
    case 'editMessage':
      if (!action.draft.trim()) return state
      s = { ...s, messages: s.messages.map((m) => (m.id === action.id ? { ...m, draft: action.draft, edited: true } : m)) }
      break
    case 'refreshMessage':
      s = { ...s, messages: s.messages.map(m => m.id === action.id ? { ...m, edited: false } : m) }
      break
    case 'addMessage':
      if (!action.message.draft.trim() || !s.clients.some(client => client.id === action.message.clientId)
        || (action.message.subjectId !== undefined && !s.subjects.some(subject =>
          subject.id === action.message.subjectId && subject.clientId === action.message.clientId))) return state
      if (s.messages.some((m) => m.dedupeKey === action.message.dedupeKey)) break
      s = { ...s, messages: [...s.messages, action.message] }
      break
    case 'recordPayment': {
      const inv = s.invoices.find((i) => i.id === action.invoiceId)
      if (!inv || inv.status === 'paid') break // กดยืนยันซ้ำต้องไม่ออกใบเสร็จสองใบ
      if (!isMoney(action.amount) || action.amount > balanceDue(s, inv.id)) return state
      if (typeof action.slipVerified !== 'boolean') return state
      if (action.slipAmount !== undefined && !isNonNegativeMoney(action.slipAmount)) return state
      const pay = {
        id: nid('pay'), invoiceId: inv.id, amount: action.amount, paidAt: s.today,
        slipVerified: action.slipVerified,
        ...(action.slipAmount !== undefined ? { slipAmount: action.slipAmount } : {}),
      }
      const settled = action.amount === balanceDue(s, inv.id)
      s = {
        ...s,
        payments: [...s.payments, pay],
        invoices: s.invoices.map((i) => (i.id === inv.id && settled ? { ...i, status: 'paid' } : i)),
      }
      // ใบเสร็จต้องบอกยอดของบิล ไม่ใช่ยอดงวดสุดท้ายที่บังเอิญปิดยอดพอดี
      if (settled) s = issueReceipt(s, pay).state
      break
    }
    case 'renewPackage': {
      const subject = s.subjects.find((x) => x.id === action.subjectId)
      if (!subject?.active || subject.billing.mode !== 'package') return state
      const hasTerms = action.total !== undefined || action.price !== undefined
      if (hasTerms && (!Number.isSafeInteger(action.total) || Number(action.total) <= 0 || !isMoney(action.price))) return state
      const carry = packageStatus(s, subject)?.remaining ?? 0
      const purchaseSubject: Subject = hasTerms
        ? { ...subject, billing: { ...subject.billing, total: action.total!, price: action.price! } }
        : subject
      s = recordPackagePurchase(s, purchaseSubject, action.slipVerified ?? false)
      if (hasTerms) s = { ...s, subjects: s.subjects.map(row => row.id === subject.id ? purchaseSubject : row) }
      s = renewPackage(s, action.subjectId, carry)
      break
    }
    case 'upsertSubject': {
      if (!action.subject.id || !action.subject.clientId || !action.subject.name.trim()
        || !action.clientName.trim() || !isISODate(action.subject.createdAt)
        || typeof action.subject.active !== 'boolean' || !isBillingMode(action.subject.billing)) return state
      const current = s.subjects.find((x) => x.id === action.subject.id)
      const exists = !!current
      if (current && current.active !== action.subject.active) return state
      if (!exists && action.subject.billing.mode === 'package' && action.packageIntent === undefined) return state
      if (current && current.clientId !== action.subject.clientId
        && (s.invoices.some(invoice => invoice.subjectId === current.id)
          || s.messages.some(message => message.subjectId === current.id))) return state
      if (current?.active && current.billing.mode === 'package' && action.subject.billing.mode === 'package'
        && (current.billing.total !== action.subject.billing.total || current.billing.price !== action.subject.billing.price)) return state
      if (current && billingChangeIssue(s, current, action.subject.billing)) return state
      if (current) s = snapshotLegacyPrices(s, current.id)
      const historicalBilling = current?.billing.mode === 'package' && action.subject.billing.mode === 'package'
        ? {
            ...action.subject.billing,
            purchasedAt: current.billing.purchasedAt,
            ...(current.billing.carriedCredits !== undefined ? { carriedCredits: current.billing.carriedCredits } : {}),
            ...(current.billing.carriedUnitIds ? { carriedUnitIds: current.billing.carriedUnitIds } : {}),
          }
        : action.subject.billing
      const billing = historicalBilling.mode === 'flat_monthly'
        ? { ...historicalBilling, effectiveFrom: current?.billing.mode === 'flat_monthly'
            ? current.billing.effectiveFrom ?? current.createdAt
            : current ? s.today : action.subject.createdAt }
        : historicalBilling
      const inactiveAt = action.subject.active
        ? undefined
        : action.subject.inactiveAt ?? current?.inactiveAt ?? s.today
      if (inactiveAt !== undefined && (!isISODate(inactiveAt) || inactiveAt < action.subject.createdAt)) return state
      const billingIntervals = action.subject.billingIntervals ?? current?.billingIntervals
      const subject = { ...action.subject, billing, inactiveAt, billingIntervals }
      const clientExists = s.clients.some((c) => c.id === action.subject.clientId)
      s = {
        ...s,
        clients: clientExists
          ? s.clients.map((c) => (c.id === action.subject.clientId ? { ...c, name: action.clientName,
              ...(action.lineId === null ? { lineId: undefined } : action.lineId === undefined ? {} : { lineId: action.lineId }) } : c))
          : [...s.clients, { id: action.subject.clientId, name: action.clientName,
              ...(action.lineId ? { lineId: action.lineId } : {}) }],
        subjects: exists ? s.subjects.map((x) => (x.id === subject.id ? subject : x)) : [...s.subjects, subject],
      }
      if (!exists && subject.billing.mode === 'package' && action.packageIntent === 'paid_purchase') {
        s = recordPackagePurchase(s, subject, false)
      }
      break
    }
    case 'deactivateSubject':
      s = { ...s, subjects: s.subjects.map((x) => (x.id === action.subjectId
        ? x.active
          ? { ...x, active: false, inactiveAt: s.today,
              billingIntervals: (x.billingIntervals?.length ? x.billingIntervals : [{ from: x.createdAt }])
                .map((span, index, all) => index === all.length - 1 && span.to === undefined ? { ...span, to: s.today } : span) }
          : x
        : x)) }
      break
    case 'reactivateSubject':
      if (!s.subjects.some(x => x.id === action.subjectId)) return state
      s = { ...s, subjects: s.subjects.map(x => x.id === action.subjectId
        ? x.active ? x : { ...x, active: true, inactiveAt: undefined,
            billingIntervals: (() => {
              const spans = x.billingIntervals?.length
                ? x.billingIntervals
                : x.inactiveAt ? [{ from: x.createdAt, to: x.inactiveAt }] : []
              const last = spans.at(-1)
              return last?.to === s.today
                ? [...spans.slice(0, -1), { from: last.from }]
                : [...spans, { from: s.today }]
            })() }
        : x) }
      break
    case 'addUnit':
      if (!s.subjects.some((subject) => subject.id === action.subjectId) || !isTime(action.time)
        || (action.date !== undefined && !isISODate(action.date))) return state
      if (isFinalizedPeriod(s, action.subjectId, (action.date ?? s.today).slice(0, 7))) return state
      s = {
        ...s,
        units: [...s.units, {
          id: nid('u'), subjectId: action.subjectId, scheduledAt: action.date ?? s.today,
          time: action.time, durationMin: 60, label: action.label, adHoc: true,
        }],
      }
      break
    case 'chat':
      if (!s.clients.some(client => client.id === action.clientId) || !action.text.trim()) return state
      s = { ...s, chats: [...s.chats, { id: nid('ch'), clientId: action.clientId, from: action.from, text: action.text, at: s.today, viaAdmin: action.viaAdmin }] }
      break
    case 'waitlist':
      if (!action.entry.professionId || !action.entry.name.trim() || !action.entry.contact.trim() || !isISODate(action.entry.at)) return state
      s = { ...s, waitlist: [...s.waitlist, action.entry] }
      break
    case 'setToday':
      if (!isISODate(action.date)) return state
      s = { ...s, today: action.date }
      break
    case 'setProvider':
      if (!action.name.trim() || typeof action.promptpayId !== 'string') return state
      if (action.particle !== undefined && !isParticle(action.particle)) return state
      s = { ...s, provider: { name: action.name, promptpayId: action.promptpayId, particle: action.particle ?? s.provider.particle } }
      break
    case 'bulkAddSubjects': {
      // ทั้งชุดต้องใช้ได้หมด — นำเข้าครึ่งเดียวแย่กว่าไม่นำเข้าเลย เพราะครูไม่รู้ว่าขาดใคร
      if (!isBillingMode(action.billing) || action.rows.length === 0
        || action.rows.some((row) => !row.name.trim() || !row.clientName.trim()
          || (row.billing !== undefined && !isBillingMode(row.billing)))) return state
      const clients = [...s.clients]
      const subjects = [...s.subjects]
      action.rows.forEach((r, i) => {
        const cid = nid(`c${i}`)
        clients.push({ id: cid, name: r.clientName, lineId: r.lineId })
        const selected = r.billing ?? action.billing
        const billing = selected.mode === 'flat_monthly' ? { ...selected, effectiveFrom: selected.effectiveFrom ?? s.today } : selected
        subjects.push({ id: nid(`s${i}`), name: r.name, clientId: cid, billing, active: true, createdAt: s.today })
      })
      s = { ...s, clients, subjects }
      break
    }
    case 'onboarded':
      s = { ...s, onboarded: true }
      break
    case 'finishOnboarding': {
      if (!action.provider.name.trim() || typeof action.provider.promptpayId !== 'string'
        || !isBillingMode(action.billing) || action.rows.some(row => !row.name.trim() || !row.clientName.trim())
        || (action.billing.mode === 'package' && action.packageIntent === undefined)) return state
      const clients = s.clients.map(client => ({ ...client }))
      const subjects = [...s.subjects]
      const added: Subject[] = []
      action.rows.forEach((row, index) => {
        const existing = row.clientId ? clients.find(client => client.id === row.clientId) : undefined
        const clientId = existing?.id ?? nid(`c${index}`)
        if (existing) {
          existing.name = row.clientName
          if (row.lineId !== undefined) existing.lineId = row.lineId || undefined
        } else clients.push({ id: clientId, name: row.clientName, ...(row.lineId ? { lineId: row.lineId } : {}) })
        const billing = action.billing.mode === 'flat_monthly'
          ? { ...action.billing, effectiveFrom: action.billing.effectiveFrom ?? s.today }
          : { ...action.billing }
        const subject: Subject = { id: nid(`s${index}`), name: row.name, clientId,
          billing, active: true, createdAt: s.today }
        subjects.push(subject)
        added.push(subject)
      })
      s = { ...s, provider: { ...action.provider }, clients, subjects, onboarded: true }
      if (action.packageIntent === 'paid_purchase') {
        for (const subject of added) s = recordPackagePurchase(s, subject, false)
      }
      break
    }
    case 'deleteSubject': {
      const sub = s.subjects.find((x) => x.id === action.subjectId)
      if (!sub) break
      if (s.messages.some(m => m.clientId === sub.clientId && m.oaDelivery)) return state
      const unitIds = new Set(s.units.filter((u) => u.subjectId === sub.id).map((u) => u.id))
      if (s.invoices.some((invoice) => invoice.subjectId === sub.id)
        || s.completions.some(completion => unitIds.has(completion.unitId))) {
        s = { ...s, subjects: s.subjects.map((subject) => subject.id === sub.id
          ? subject.active ? { ...subject, active: false, inactiveAt: s.today,
              billingIntervals: (subject.billingIntervals?.length ? subject.billingIntervals : [{ from: subject.createdAt }])
                .map((span, index, all) => index === all.length - 1 && span.to === undefined ? { ...span, to: s.today } : span) }
            : subject
          : subject) }
        s = rememberDeletion(s, sub.id, 'archived')
        break
      }
      const invIds = new Set(s.invoices.filter((i) => i.subjectId === sub.id).map((i) => i.id))
      const payIds = new Set(s.payments.filter((p) => invIds.has(p.invoiceId)).map((p) => p.id))
      // ลบทุกอย่างที่ห้อยอยู่กับคนนี้ ไม่ให้เหลือแถวกำพร้าที่ทำหน้าจอพัง
      s = {
        ...s,
        subjects: s.subjects.filter((x) => x.id !== sub.id),
        units: s.units.filter((u) => u.subjectId !== sub.id),
        completions: s.completions.filter((c) => !unitIds.has(c.unitId)),
        invoices: s.invoices.filter((i) => i.subjectId !== sub.id),
        payments: s.payments.filter((p) => !invIds.has(p.invoiceId)),
        receipts: s.receipts.filter((r) => !payIds.has(r.paymentId)),
        messages: s.messages.filter((m) => m.subjectId !== sub.id),
        ...(s.homework ? { homework: s.homework.filter((h) => h.subjectId !== sub.id) } : {}),
      }
      // ผู้จ่ายที่ไม่เหลือคนเรียนแล้ว ลบทิ้งพร้อมแชท
      const stillUsed = s.subjects.some((x) => x.clientId === sub.clientId)
      if (!stillUsed) {
        s = {
          ...s,
          clients: s.clients.filter((c) => c.id !== sub.clientId),
          chats: s.chats.filter((c) => c.clientId !== sub.clientId),
          messages: s.messages.filter((m) => m.clientId !== sub.clientId),
        }
        // ต้องจดแยกจากใบของนักเรียน — ข้อมูลผู้ปกครองบนเซิร์ฟเวอร์ผูกกับผู้จ่าย และใบนี้คือสัญญาณเดียว
        // ที่ได้รับอนุญาตให้สั่งลบมัน (ดู erasableClientKeys และ migration 0018)
        s = withClientTombstones(s, pruneTombstones(
          mergeClientTombstones(clientTombstonesOf(s), [{ id: sub.clientId, at: s.today }]), s.today))
      }
      s = rememberDeletion(s, sub.id, 'removed')
      break
    }
    case 'sendingStart':
      s = { ...s, sending: { awaiting: action.awaiting, queue: action.queue } }
      break
    case 'sendingNext':
      s = { ...s, sending: { awaiting: action.awaiting, queue: (s.sending?.queue ?? []).slice(1) } }
      break
    case 'sendingStop':
      s = { ...s, sending: undefined }
      break
    case 'backedUp':
      s = { ...s, lastBackupAt: s.today }
      break
    case 'restore': {
      if (!isWellFormed(action.state)) return state
      // ไฟล์เก็บวันที่สำรองไว้ ถ้าเอามาทั้งก้อน 'วันนี้' จะแช่แข็งอยู่วันนั้น
      // เช็คชื่อทุกคาบหลังจากนี้จะลงวันผิดโดยไม่มีอะไรฟ้อง
      const incoming = action.state.mode === 'real' ? { ...action.state, today: todayISO() } : action.state
      // ก้อนนี้อาจเก่ากว่าการลบที่เครื่องนี้ทำไปแล้ว — บังคับใช้หลุมศพก่อนวาง ไม่ใช่วางแล้วค่อยว่ากัน
      const merged = applyDeletionsOnRestore(s, incoming)
      if (!merged) return state
      s = merged
      break
    }
    case 'rescheduleUnit': {
      const u = s.units.find((x) => x.id === action.unitId)
      if (!u) break
      if (!isISODate(action.date) || !isTime(action.time)) return state
      const subject = s.subjects.find(row => row.id === u.subjectId)
      if (!subject) return state
      // เลื่อนคาบไม่แตะเงิน — บิลคิดจาก completions ไม่ใช่ units
      s = {
        ...s,
        units: s.units.map((x) => (x.id === action.unitId
          ? { ...x, scheduledAt: action.date, time: action.time, movedFrom: x.movedFrom ?? x.scheduledAt, cancelled: false }
          : x)),
      }
      const key = `moved:${u.id}:${action.date}:${action.time}`
      if (!s.messages.some(message => message.dedupeKey === key)) {
        s = { ...s, messages: [...s.messages, mkMessage(s, 'moved', subject.clientId, subject.id,
          movedText(s, subject, { date: u.scheduledAt }, { date: action.date, time: action.time }), key)] }
      }
      break
    }
    case 'cancelUnit': {
      const unit = s.units.find(row => row.id === action.unitId)
      const subject = unit && s.subjects.find(row => row.id === unit.subjectId)
      if (!unit || !subject) return state
      // เก็บ completion ไว้ ไม่ลบ — ledger มองข้ามคาบที่ถูกงดอยู่แล้ว
      // ถ้าลบทิ้ง กดงดผิดครั้งเดียวแล้วเงินหายถาวร กู้ไม่ได้
      s = { ...s, units: s.units.map((x) => (x.id === action.unitId ? { ...x, cancelled: true } : x)) }
      const key = `cancelled:${unit.id}:${unit.scheduledAt}`
      if (!s.messages.some(message => message.dedupeKey === key)) {
        s = { ...s, messages: [...s.messages, mkMessage(s, 'cancelled', subject.clientId, subject.id,
          cancelledText(s, subject, unit.scheduledAt), key)] }
      }
      break
    }
    case 'restoreUnit':
      s = { ...s, units: s.units.map((x) => (x.id === action.unitId ? { ...x, cancelled: false } : x)) }
      break
    case 'startReal':
      // เก็บชื่อ/พร้อมเพย์ที่กรอกไว้ ทิ้งข้อมูลสมมติทั้งหมด
      s = buildReal(s.provider, s.style)
      break
    case 'deleteAccountLocal':
      // Server deletion succeeded before this action is allowed. Clear all teacher data and identity.
      s = buildReal()
      break
    case 'setStyle':
      // เปลี่ยนแค่หน้าจอและค่าเริ่มต้น — ข้อมูลลูกค้าและบิลอยู่ครบ
      if (!isStyle(action.style)) return state
      s = { ...s, style: action.style }
      break
    case 'clearMessages':
      // เก็บ skipped/sent ไว้ ไม่งั้น dedupe หาย ร่างที่ผู้ใช้ข้ามจะกลับมา
      // และ 'Solo ช่วยไว้' ที่นับจากข้อความทวงที่ส่งแล้วจะกลายเป็นศูนย์
      s = { ...s, messages: s.messages.filter((m) => m.status !== 'draft' || !!m.oaDelivery) }
      break
    case 'nudgeInvoice': {
      const inv = s.invoices.find(i => i.id === action.invoiceId)
      if (!inv || inv.kind !== 'monthly' || (inv.status !== 'sent' && inv.status !== 'overdue')) return state
      const message = nudgeMessage(s, inv)
      // วันละใบ — กดซ้ำวันเดียวกันไม่สร้างซ้ำ (ใบเดิมยังรออยู่ในคิว)
      if (s.messages.some(m => m.dedupeKey === message.dedupeKey)) return state
      s = { ...s, messages: [...s.messages, message] }
      break
    }
    case 'addHomework': {
      const text = action.text.trim()
      const ids = [...new Set(action.subjectIds)]
      if (!text || text.length > HOMEWORK_TEXT_MAX || ids.length === 0 || !isISODate(action.dueAt) || action.dueAt < s.today) return state
      const subjects = ids.map(id => s.subjects.find(x => x.id === id))
      if (subjects.some(x => !x || !x.active)) return state
      const items = subjects.map((subject, i) => ({
        id: nid(`hw${i}`), subjectId: subject!.id, clientId: subject!.clientId, text, assignedAt: s.today, dueAt: action.dueAt,
      }))
      s = { ...s, homework: [...homeworkOf(s), ...items] }
      const drafts = items.map(item => homeworkAssignMessage(s, item)).filter((m): m is NonNullable<typeof m> => !!m)
      s = { ...s, messages: [...s.messages, ...drafts] }
      break
    }
    case 'homeworkSubmitted': {
      const item = homeworkOf(s).find(h => h.id === action.id)
      if (!item || item.submittedAt) return state
      s = { ...s, homework: homeworkOf(s).map(h => h.id === action.id ? { ...h, submittedAt: s.today } : h) }
      break
    }
    case 'homeworkReopen': {
      const item = homeworkOf(s).find(h => h.id === action.id)
      if (!item?.submittedAt) return state
      s = { ...s, homework: homeworkOf(s).map(h => h.id === action.id ? { ...h, submittedAt: undefined } : h) }
      break
    }
    case 'deleteHomework': {
      if (!homeworkOf(s).some(h => h.id === action.id)) return state
      if (s.messages.some(m => m.meta?.homeworkId === action.id && m.oaDelivery)) return state
      // ร่างที่ยังไม่ส่งไปพร้อมกัน ประวัติที่ส่งแล้วเก็บไว้ (บอกว่าเคยแจ้งผู้ปกครองจริง)
      s = {
        ...s,
        homework: homeworkOf(s).filter(h => h.id !== action.id),
        messages: s.messages.filter(m => !(m.meta?.homeworkId === action.id && m.status === 'draft')),
      }
      break
    }
    case 'remindHomework': {
      const item = homeworkOf(s).find(h => h.id === action.id)
      if (!item || homeworkStatus(item, s.today) !== 'overdue') return state
      if (s.messages.some(m => m.kind === 'homework_reminder' && m.meta?.homeworkId === item.id && m.status === 'draft')) return state
      const message = homeworkReminderMessage(s, item, `hwrem:${item.id}:${s.today}`)
      if (!message || s.messages.some(m => m.dedupeKey === message.dedupeKey)) return state
      s = { ...s, messages: [...s.messages, message] }
      break
    }
    case 'replace':
      s = action.state
      break
    case 'track':
      s = { ...s, events: appendEvent(s.events, action.name, action.props) }
      break
  }

  /**
   * ครูเพิ่มหรือเปิดรายการคนนี้ใหม่ = เจตนาล่าสุดชนะหลุมศพเก่า ต้องรื้อใบนั้นทิ้ง
   * ไม่งั้นซิงก์รอบหน้าจะลบคนที่เพิ่งเพิ่มกลับเข้ามา — 'restore' ไม่เข้าตรงนี้เพราะการรวมข้อมูลตัดสินไปแล้ว
   */
  if (s.deletedSubjects && action.type !== 'restore') {
    const activeIds = new Set(s.subjects.filter((x) => x.active).map((x) => x.id))
    const kept = tombstonesOf(s).filter((row) => !activeIds.has(row.id))
    if (kept.length !== s.deletedSubjects.length) s = withTombstones(s, kept)
  }
  if (s.deletedClients && action.type !== 'restore') {
    const liveClients = new Set(s.clients.map((c) => c.id))
    const kept = clientTombstonesOf(s).filter((row) => !liveClients.has(row.id))
    if (kept.length !== s.deletedClients.length) s = withClientTombstones(s, kept)
  }

  s = reconcileDraftInvoices(s)
  s = markOverdue(s)
  // ถอนก่อน แล้วค่อยสะกิดตัวเลข — ไม่งั้นจะไป render ร่างที่กำลังจะถูกถอนอยู่ดี
  s = { ...s, messages: retractDrafts(s) }
  s = { ...s, messages: refreshDrafts(s) }
  const add = deriveDrafts(s)
  if (add.length) s = { ...s, messages: [...s.messages, ...add] }
  if (action.type !== 'oaSent' && action.type !== 'oaCancelled' && action.type !== 'deleteAccountLocal' && state.messages.some(m => m.oaDelivery
    && financialRevision(state, m) !== financialRevision(s, m))) return state
  return s
}

/**
 * v3 → v4: เพิ่ม mode · ข้อมูลเดิมทั้งหมดเป็นเดโม ห้ามทิ้ง
 * คืน null เมื่อกู้ไม่ได้จริง ๆ เท่านั้น
 */
export function migrate(raw: unknown): AppState | null {
  return migrateCanonical(raw)
}

/**
 * เดโมที่ค้างอยู่ในเครื่องมีวันของวันที่เปิดครั้งแรก — กลับมาเปิดอีกทีจะเห็นวันเก่า
 * ข้ามเดือนเมื่อไหร่ชุดข้อมูลทั้งชุด (เดือนก่อน + เดือนนี้) ก็ผิดช่วง ต้องสร้างใหม่
 * ยังอยู่เดือนเดิมแค่เดินวันให้ทัน งานที่กดเช็คชื่อไว้ตอนสาธิตจะได้ไม่หาย
 */
/**
 * สมุดตัวอย่างมีสมุด LINE (`lineWorkspaceId` + `lineProviderId`) ของตัวเองได้ตั้งแต่ 9 ก.ย.
 * ทุกทางที่ "สร้างชุดข้อมูลใหม่ทับของเดิม" ต้องยกคู่ id นี้มาด้วย ไม่งั้นการจับคู่ผู้ปกครองหลุด
 * ทุกครั้งที่ครูกดสลับชุดข้อมูล/รีเซ็ต/ข้ามเดือน แล้วต้องออกรหัสใหม่ให้ผู้ปกครองกลางเวที
 *
 * ยกได้เฉพาะภายในโหมดเดียวกัน — id ของสมุดจริงต้องไม่มีทางไหลเข้าช่องเดโม และกลับกัน
 * ยกทั้งคู่หรือไม่ยกเลย: `validateState` บังคับว่าสองฟิลด์นี้ต้องมีหรือไม่มีพร้อมกัน
 */
/**
 * ยังมี "ความตั้งใจส่ง" ที่บันทึกไว้และรอตรวจผลอยู่ไหม
 *
 * reducer กัน `restore`/`replace`/`startReal` ไว้แล้วเมื่อมีรายการค้าง (บรรทัด ~170) แต่สองทาง
 * ที่สร้างชุดข้อมูลใหม่ของเดโมไม่ผ่าน reducer เลย (ข้ามเดือน และ `?scenario=` ตอน hydrate)
 * ถ้าปล่อยให้สร้างใหม่ การ์ดที่ค้างอยู่จะกลับมาเป็นปุ่ม "ส่งใน LINE" ธรรมดา แล้วครูแชร์เองซ้ำได้
 * — ตัวกันส่งซ้ำฝั่งเซิร์ฟเวอร์กันได้แค่ทาง OA ไม่ได้กันการเปิดแอป LINE ส่งมือ
 */
const hasPendingOa = (state: AppState): boolean => state.messages.some(m => m.oaDelivery)

const carryLineIds = (from: AppState, to: AppState): AppState =>
  from.mode !== to.mode || !from.lineWorkspaceId || !from.lineProviderId ? to
    : { ...to, lineWorkspaceId: from.lineWorkspaceId, lineProviderId: from.lineProviderId }

/**
 * บัญชีครูถูกลบบนเซิร์ฟเวอร์แล้ว — สมุด LINE ที่ช่องเดโมชี้ไปอยู่ใต้ provider ที่ไม่มีอยู่อีกต่อไป
 * ปล่อยค้างไว้ เดโมรอบหน้าจะพยายามส่งผ่าน workspace ของบัญชีที่ตายแล้วโดยไม่มีอะไรอธิบาย
 * ล้างเฉพาะสองฟิลด์นี้ ข้อมูลตัวอย่างที่เหลือไม่ใช่ของบัญชีใคร จึงไม่ต้องแตะ
 */
const clearDemoLineIds = (): void => {
  try {
    const slot = readSlot('demo')
    if (!slot || (slot.state.lineWorkspaceId === undefined && slot.state.lineProviderId === undefined
      && !hasPendingOa(slot.state))) return
    const { lineWorkspaceId: _workspace, lineProviderId: _provider, ...rest } = slot.state
    // รายการที่ค้างตรวจผลชี้ไปที่ provider ที่ไม่มีแล้ว — เหลือไว้คือการ์ดที่กดตรวจก็ไม่ได้
    // กดยกเลิกก็ไม่ได้ (ต้องเข้าสู่ระบบด้วยบัญชีที่ถูกลบ) และ validateState จะปฏิเสธทั้งก้อน
    localStorage.setItem(DEMO_SLOT_KEY, JSON.stringify({
      ...rest, messages: rest.messages.map(m => m.oaDelivery ? { ...m, oaDelivery: undefined } : m),
    }))
  } catch { /* best effort หลังการลบบนเซิร์ฟเวอร์สำเร็จแล้ว — ล้มที่นี่ต้องไม่ทำให้การลบค้าง */ }
}

function refreshDemoDay(saved: AppState): AppState {
  const now = todayISO()
  if (saved.today === now) return saved
  // ข้ามเดือน = สร้างชุดใหม่ทั้งชุด แต่สมุด LINE ของช่องนี้ต้องอยู่ต่อ
  // ยกเว้นยังมีรายการ OA ค้างตรวจ — เดินวันให้ทันไปก่อน ชุดจะถูกสร้างใหม่รอบหน้าหลังครูตรวจผลเสร็จ
  if (periodOf(saved.today) !== periodOf(now) && !hasPendingOa(saved)) {
    return carryLineIds(saved, buildScenario(saved.scenarioId))
  }
  return { ...saved, today: now }
}

interface Hydrated {
  mode: WorkspaceMode
  state: AppState
  didReset: boolean
  recoveryRaw: string | null
  savedRaw: string | null
  applyInitialScenario: boolean
}

function hydrate(scenarioFromUrl: string | null): Hydrated {
  let raw: string | null = null
  let mode: WorkspaceMode = 'demo'
  try {
    const deleted = readDeletedMarker(localStorage.getItem(ACCOUNT_DELETED_KEY))
    if (deleted) {
      // บัญชีถูกลบแล้ว = เรื่องของ workspace จริงเท่านั้น เดโมในเครื่องไม่เกี่ยวและต้องไม่ถูกแตะ
      mode = 'real'
      KEY = slotKey(mode)
      const serialized = JSON.stringify(deleted)
      try { localStorage.setItem(KEY, serialized); raw = serialized } catch { raw = localStorage.getItem(KEY) }
      writeActiveMode(mode)
      return { mode, state: normalize(deleted), didReset: false, recoveryRaw: null, savedRaw: raw, applyInitialScenario: false }
    }
    mode = resolveActiveMode()
    KEY = slotKey(mode)
    raw = localStorage.getItem(KEY)
    if (raw) {
      const saved = migrate(JSON.parse(raw))
      if (!saved) throw new Error('invalid saved state')
      // ช่องนี้ต้องเก็บ workspace ของโหมดนี้เท่านั้น ของโหมดอื่นที่หลงมาแปลว่าการย้ายยังไม่จบ
      // ห้ามเขียนทับ ให้ไปเส้นทางกู้คืนที่เก็บ raw ไว้ครบ
      if (saved.mode !== mode) throw new Error('foreign workspace in slot')
      // A demo query parameter must never overwrite an existing real workspace.
      // สลับชุดข้อมูลจาก URL ก็เป็นการสร้างชุดใหม่ทับของเดิม — สมุด LINE ของช่องเดโมต้องอยู่ต่อ
      // และห้ามทับเมื่อยังมีรายการ OA ค้างตรวจ (กฎเดียวกับที่ reducer ใช้กับ replace/restore)
      const switchScenario = saved.mode === 'demo' && !!scenarioFromUrl && isScenario(scenarioFromUrl)
        && !hasPendingOa(saved)
      const chosen = switchScenario ? carryLineIds(saved, buildScenario(scenarioFromUrl!)) : saved
      const dated = chosen.mode === 'real' ? { ...chosen, today: todayISO() } : refreshDemoDay(chosen)
      return { mode, state: normalize(dated), didReset: false, recoveryRaw: null, savedRaw: raw,
        applyInitialScenario: switchScenario }
    }
    const fresh = mode === 'real'
      ? buildReal()
      : buildScenario(scenarioFromUrl && isScenario(scenarioFromUrl) ? scenarioFromUrl : 'default')
    return { mode, state: normalize(fresh), didReset: false, recoveryRaw: null, savedRaw: null, applyInitialScenario: false }
  } catch {
    // Preserve even syntactically broken JSON. Recovery is explicit; never autosave demo over it.
    return { mode, state: normalize(mode === 'real' ? buildReal() : buildScenario('empty')),
      didReset: true, recoveryRaw: raw, savedRaw: raw, applyInitialScenario: false }
  }
}

function normalize(s: AppState): AppState {
  let withOverdue = markOverdue(s)
  withOverdue = { ...withOverdue, messages: retractDrafts(withOverdue) }
  withOverdue = { ...withOverdue, messages: refreshDrafts(withOverdue) }
  const add = deriveDrafts(withOverdue)
  return add.length ? { ...withOverdue, messages: [...withOverdue.messages, ...add] } : withOverdue
}

export type WriteStatus = 'acquiring' | 'writable' | 'readonly' | 'conflict' | 'error'
export interface StoreValue {
  state: AppState
  /** Synchronous durable transition. False means no state change was committed. */
  dispatch: (action: Action) => boolean
  track: (name: string, props?: Record<string, unknown>) => void
  /** workspace ที่แท็บนี้กำลังใช้ — เท่ากับ state.mode เสมอ และเป็นตัวเลือกช่องเก็บข้อมูล */
  mode: WorkspaceMode
  /**
   * รีเซ็ตเดโม — แตะได้เฉพาะช่องเดโม
   * เรียกจากโหมดใช้จริงจะคืน false เสมอ สมุดบัญชีจริงไม่มีทางถูกเขียนทับด้วยข้อมูลสมมติ
   */
  resetDemo: (scenarioId?: string) => boolean
  /** สลับกลับไปช่องเดโม — สมุดบัญชีจริงยังอยู่ในช่องของมัน กลับมาเมื่อไหร่ก็เจอเหมือนเดิม */
  backToDemo: (scenarioId?: string) => boolean
  didReset: boolean
  hydrated: boolean
  persistenceError: string | null
  recoveryRaw: string | null
  writeStatus: WriteStatus
  /**
   * นับครั้งที่สมุดบัญชีถูกยกมาทั้งก้อนแทนที่จะเดินหน้าด้วยงานของครู
   * เลขนี้เปลี่ยนเมื่อไหร่ = ความยาวรายการที่เพิ่มขึ้นไม่ใช่งานที่เพิ่งเกิด ผู้ใช้ค่านี้ต้องตั้งฐานใหม่ ไม่ใช่รายงาน
   */
  ledgerReplacements: number
  /** Rehydrate the latest durable state after a conflict/error and resume if leadership is still held. */
  retryPersistence: () => boolean
  /** Reserve the lifetime writer before the irreversible server-side account deletion starts. */
  prepareAccountDeletion: () => boolean
  /** Commit the empty local tombstone after the server confirms deletion. */
  commitAccountDeletion: () => 'cleared' | 'local-retained'
  cancelAccountDeletion: () => void
}
const Ctx = createContext<StoreValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(() => hydrate(urlParam('scenario')), [])
  const [state, setState] = useState(initial.state)
  const [mode, setMode] = useState<WorkspaceMode>(initial.mode)
  const current = useRef(state)
  // ช่องที่แท็บนี้เขียน — ref ไม่ใช่ state เพราะทุกเส้นทางเขียนต้องอ่านค่าล่าสุดทันทีแบบ synchronous
  const activeKey = useRef(slotKey(initial.mode))
  const savedRaw = useRef(initial.savedRaw)
  const initialScenarioPending = useRef(initial.applyInitialScenario)
  const blocked = useRef(initial.didReset)
  /**
   * ใครถือสิทธิ์เขียนอยู่ตอนนี้ — เก็บเป็น token ไม่ใช่ boolean
   * ตอนสลับ workspace ล็อกใบใหม่ถูกจับก่อนที่ callback ของใบเก่าจะเดินต่อจนจบ
   * ถ้าใช้ boolean ใบเก่าจะรีเซ็ตธงทิ้งทีหลัง แล้วแท็บที่ถือสิทธิ์จริงกลายเป็นอ่านอย่างเดียว
   */
  const leaseHolder = useRef<object | null>(null)
  const accountDeletionPending = useRef(false)
  const writeStatusRef = useRef<WriteStatus>('acquiring')
  const releaseLeadership = useRef<(() => void) | null>(null)
  const [didReset, setDidReset] = useState(initial.didReset)
  const [persistenceError, setPersistenceError] = useState<string | null>(initial.didReset ? 'เปิดข้อมูลเดิมไม่ได้ กรุณาเก็บสำเนาดิบแล้วกู้คืนจากไฟล์สำรอง' : null)
  const [recoveryRaw, setRecoveryRaw] = useState(initial.recoveryRaw)
  const [writeStatus, setWriteStatusState] = useState<WriteStatus>('acquiring')
  const [lockAttempt, setLockAttempt] = useState(0)
  const [ledgerReplacements, setLedgerReplacements] = useState(0)
  const setWriteStatus = useCallback((status: WriteStatus) => {
    writeStatusRef.current = status
    setWriteStatusState(status)
  }, [])
  /** เรียกทุกครั้งที่ state ถูกแทนทั้งก้อน — อ่านใหม่จากเครื่อง รับก้อนจากแท็บอื่น หรือ action ที่ยกสมุดบัญชี */
  const markLedgerReplaced = useCallback(() => { setLedgerReplacements(count => count + 1) }, [])

  const rehydrateLatest = useCallback((): boolean => {
    try {
      // หลุมฝังศพของบัญชีเป็นเรื่องของ workspace จริง แท็บที่อยู่เดโมต้องไม่เอามาเขียนทับช่องเดโม
      const deleted = activeKey.current === REAL_SLOT_KEY
        ? readDeletedMarker(localStorage.getItem(ACCOUNT_DELETED_KEY)) : null
      if (deleted) {
        const normalized = normalize(deleted)
        const serialized = JSON.stringify(normalized)
        localStorage.setItem(activeKey.current, serialized)
        savedRaw.current = serialized
        current.current = normalized
        blocked.current = false
        // อ่านใหม่จากเครื่อง ไม่ใช่ครูลงมือทำ — รายการที่โผล่มาต้องไม่ถูกนับเป็นงานที่เพิ่งเกิด
        markLedgerReplaced()
        setState(normalized)
        setDidReset(false)
        setRecoveryRaw(null)
        setPersistenceError(null)
        setWriteStatus('writable')
        return true
      }
      const raw = localStorage.getItem(activeKey.current)
      if (raw === null) {
        savedRaw.current = null
        setWriteStatus('writable')
        return true
      }
      const migrated = migrate(JSON.parse(raw))
      if (!migrated) throw new Error('invalid saved state')
      if (slotKey(migrated.mode) !== activeKey.current) throw new Error('foreign workspace in slot')
      // อ่านซ้ำหลังได้สิทธิ์เขียนก็ต้องเดินวันเหมือนตอน hydrate ไม่งั้นทับวันที่รีเฟรชไปแล้ว
      const dated = migrated.mode === 'real' ? { ...migrated, today: todayISO() } : refreshDemoDay(migrated)
      const normalized = normalize(dated)
      const canonical = JSON.stringify(normalized)
      if (canonical !== raw) localStorage.setItem(activeKey.current, canonical)
      savedRaw.current = canonical
      current.current = normalized
      blocked.current = false
      markLedgerReplaced()
      setState(normalized)
      setDidReset(false)
      setRecoveryRaw(null)
      setPersistenceError(null)
      setWriteStatus('writable')
      return true
    } catch {
      setPersistenceError('เปิดข้อมูลล่าสุดไม่ได้ ระบบหยุดเขียนเพื่อป้องกันข้อมูลเดิม กรุณากู้คืนจากไฟล์สำรอง')
      setWriteStatus('error')
      return false
    }
  }, [markLedgerReplaced, setWriteStatus])

  /**
   * ย้ายแท็บนี้ไปอีก workspace หนึ่ง — ไม่ใช่การเขียนทับข้อมูล
   *
   * ช่องปลายทางมีของอยู่แล้ว: หยิบของเดิมมาใช้ ไม่เขียนอะไรทับ (นี่คือเหตุผลที่ "กลับไปเดโม"
   * แล้วกลับมาใช้จริง เจอสมุดบัญชีเดิมครบ) · ช่องปลายทางว่างหรือเป็นการกู้คืนข้ามโหมด:
   * เก็บสำเนาของเดิมไว้ที่ parked key ก่อน แล้วค่อยเขียน seed ลงไป
   *
   * หลังจากนี้แท็บเข้าสถานะ acquiring จนกว่าจะได้ล็อกของช่องใหม่ — การเขียนระหว่างนั้นถูกปฏิเสธ
   * ไม่ใช่เขียนลงช่องที่ยังไม่มีสิทธิ์
   */
  const switchWorkspace = useCallback((target: WorkspaceMode, seed: AppState, overwrite: boolean): boolean => {
    if (accountDeletionPending.current) {
      setPersistenceError('กำลังลบบัญชี ระบบหยุดการแก้ข้อมูลชั่วคราว')
      return false
    }
    if (leaseHolder.current === null || writeStatusRef.current !== 'writable') {
      setPersistenceError('แท็บนี้เป็นโหมดอ่านอย่างเดียว กรุณาปิดแท็บที่กำลังแก้ข้อมูลหรือกดลองใหม่')
      return false
    }
    const key = slotKey(target)
    let next: AppState
    let nextRaw: string
    try {
      const existing = readSlot(target)
      if (existing && !overwrite) {
        // ของเดิมในช่องปลายทางชนะเสมอ — ไม่แตะ storage ตรงนี้ ให้ rehydrate ใต้ล็อกใหม่ทำให้เป็น canonical
        const dated = target === 'real' ? { ...existing.state, today: todayISO() } : refreshDemoDay(existing.state)
        next = normalize(dated)
        nextRaw = existing.raw
      } else {
        const previous = localStorage.getItem(key)
        if (previous !== null) localStorage.setItem(parkedKey(target), previous)
        next = normalize({ ...seed, schemaVersion: SCHEMA as 5, revision: (existing?.state.revision ?? -1) + 1 })
        nextRaw = JSON.stringify(next)
        localStorage.setItem(key, nextRaw)
      }
    } catch {
      setPersistenceError('สลับโหมดไม่สำเร็จ ข้อมูลทั้งสองชุดยังอยู่ครบ กรุณาตรวจพื้นที่ว่างแล้วลองใหม่')
      return false
    }
    writeActiveMode(target)
    KEY = key
    activeKey.current = key
    savedRaw.current = nextRaw
    current.current = next
    blocked.current = false
    // ยกสมุดบัญชีมาทั้งก้อนจากอีกช่อง — ตัวนับการใช้งานต้องตั้งฐานใหม่ ไม่ใช่รายงานว่ามีงานเกิดขึ้น
    markLedgerReplaced()
    setState(next)
    setDidReset(false)
    setRecoveryRaw(null)
    setPersistenceError(null)
    setWriteStatus('acquiring')
    setMode(target)
    return true
  }, [markLedgerReplaced, setWriteStatus])

  const dispatch = useCallback((action: Action): boolean => {
    if (accountDeletionPending.current) {
      setPersistenceError('กำลังลบบัญชี ระบบหยุดการแก้ข้อมูลชั่วคราว')
      return false
    }
    if (leaseHolder.current === null || writeStatusRef.current !== 'writable') {
      setPersistenceError(writeStatusRef.current === 'conflict'
        ? 'พบข้อมูลจากแท็บหรือโปรแกรมรุ่นอื่น กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่'
        : 'แท็บนี้เป็นโหมดอ่านอย่างเดียว กรุณาปิดแท็บที่กำลังแก้ข้อมูลหรือกดลองใหม่')
      return false
    }
    if (blocked.current && action.type !== 'restore') return false
    if (action.type === 'startReal') {
      if (current.current.mode !== 'demo') return false
      // ให้ reducer ตัดสินก่อน — กติกาเดิมยังอยู่ครบ (คิว OA ค้างอยู่ห้ามสลับ)
      const seed = reducer(current.current, action)
      if (seed === current.current) return false
      return switchWorkspace('real', seed, false)
    }
    // ไฟล์สำรองคนละโหมดกับที่ใช้อยู่ ต้องลงช่องของมันเอง ไม่ใช่ทับ workspace ที่เปิดอยู่
    if (action.type === 'restore' && isWellFormed(action.state) && action.state.mode !== current.current.mode) {
      const restored = reducer(current.current, action)
      if (restored === current.current) return false
      return switchWorkspace(action.state.mode, restored, true)
    }
    // ลบบัญชีเป็นเรื่องของ workspace จริง — ห้าม buildReal() ไปนอนอยู่ในช่องเดโม
    if (action.type === 'deleteAccountLocal' && current.current.mode !== 'real') return false
    const next = reducer(current.current, action)
    if (next === current.current) return false
    try {
      // สลับช่อง (startReal / กู้คืนข้ามโหมด) ไม่ผ่านทางนี้ — switchWorkspace เก็บสำเนาของช่องปลายทางเอง
      if (action.type === 'restore' || action.type === 'replace') {
        const previous = localStorage.getItem(activeKey.current)
        if (previous !== null) localStorage.setItem(parkedKey(current.current.mode), previous)
      }
      // localStorage is synchronous. On quota/security error keep the last committed state.
      const durableRaw = localStorage.getItem(activeKey.current)
      if (durableRaw !== savedRaw.current) {
        setPersistenceError('ข้อมูลในเครื่องเปลี่ยนจากอีกแท็บ ระบบปฏิเสธการเขียนครั้งนี้ กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่')
        setWriteStatus('conflict')
        return false
      }
      const committed = { ...next, schemaVersion: SCHEMA as 5, revision: current.current.revision + 1 }
      const serialized = JSON.stringify(committed)
      localStorage.setItem(activeKey.current, serialized)
      try { localStorage.removeItem(ACCOUNT_DELETED_KEY) } catch { /* live state is already durable */ }
      savedRaw.current = serialized
      current.current = committed
      blocked.current = false
      // กู้คืน/สลับโหมด/ลบบัญชี เปลี่ยนสมุดบัญชีทั้งก้อน — ไม่ใช่บิลหรือยอดเงินที่ครูเพิ่งทำในเครื่องนี้
      if (LEDGER_REPLACEMENT_ACTIONS.has(action.type)) markLedgerReplaced()
      setState(committed)
      setDidReset(false)
      setRecoveryRaw(null)
      setPersistenceError(null)
      return true
    } catch {
      setPersistenceError('บันทึกไม่สำเร็จ การเปลี่ยนแปลงล่าสุดยังไม่ถูกเก็บ กรุณาสำรองข้อมูล ตรวจพื้นที่ว่าง แล้วลองอีกครั้ง')
      return false
    }
  }, [markLedgerReplaced, setWriteStatus, switchWorkspace])

  const prepareAccountDeletion = useCallback((): boolean => {
    // การลบบัญชีล้างสมุดบัญชีจริง — ต้องเริ่มจากแท็บที่ถือช่องนั้นอยู่
    // ด่านนี้ต้องอยู่ "ก่อน" การลบบนเซิร์ฟเวอร์ที่ย้อนไม่ได้ ไม่ใช่ตอน commit
    // ไม่งั้นบัญชีถูกลบไปแล้วแต่ข้อมูลในเครื่องยังอยู่ ซึ่งแย่กว่าการไม่ให้เริ่ม
    if (current.current.mode !== 'real') {
      setPersistenceError('บัญชีและสมุดบัญชีจริงของคุณอยู่ในโหมดใช้จริง ตอนนี้หน้าจอกำลังอยู่ที่ข้อมูลตัวอย่าง กรุณากด "เริ่มใช้จริง" ในเมนูเพื่อกลับไปสมุดบัญชีของคุณ แล้วลบบัญชีจากตรงนั้น')
      return false
    }
    if (accountDeletionPending.current || blocked.current || leaseHolder.current === null || writeStatusRef.current !== 'writable') {
      setPersistenceError(writeStatusRef.current === 'conflict'
        ? 'พบข้อมูลจากแท็บอื่น กรุณาโหลดข้อมูลล่าสุดก่อนลบบัญชี'
        : 'ลบบัญชีจากแท็บนี้ไม่ได้ กรุณาปิดแท็บที่กำลังแก้ข้อมูลแล้วลองใหม่')
      return false
    }
    try {
      if (localStorage.getItem(activeKey.current) !== savedRaw.current) {
        setPersistenceError('ข้อมูลในเครื่องเปลี่ยนจากอีกแท็บ กรุณาโหลดข้อมูลล่าสุดก่อนลบบัญชี')
        setWriteStatus('conflict')
        return false
      }
    } catch {
      setPersistenceError('ตรวจสอบข้อมูลในเครื่องก่อนลบบัญชีไม่สำเร็จ')
      setWriteStatus('error')
      return false
    }
    accountDeletionPending.current = true
    setPersistenceError(null)
    return true
  }, [setWriteStatus])

  const cancelAccountDeletion = useCallback(() => { accountDeletionPending.current = false }, [])

  const applyAccountDeletion = useCallback((clean: AppState, durableRaw: string | null, writable: boolean) => {
    accountDeletionPending.current = false
    clearDemoLineIds()
    savedRaw.current = durableRaw
    current.current = clean
    blocked.current = !writable
    markLedgerReplaced()
    setState(clean)
    setDidReset(false)
    setRecoveryRaw(null)
  }, [markLedgerReplaced])

  const commitAccountDeletion = useCallback((): 'cleared' | 'local-retained' => {
    // ด่านซ้ำของ prepareAccountDeletion — ถึงตรงนี้ต้องเป็นโหมดจริงเสมอ กันไว้เผื่อมีทางเรียกใหม่
    if (!accountDeletionPending.current || leaseHolder.current === null || writeStatusRef.current !== 'writable'
      || current.current.mode !== 'real') {
      accountDeletionPending.current = false
      return 'local-retained'
    }
    const clean = { ...buildReal(), schemaVersion: SCHEMA as 5, revision: current.current.revision + 1 }
    const serialized = JSON.stringify(clean)
    const marker = JSON.stringify({ version: 1, state: clean } satisfies AccountDeletedMarker)
    let markerSaved = false
    let ledgerSaved = false
    try { localStorage.setItem(ACCOUNT_DELETED_KEY, marker); markerSaved = true } catch { /* reported below */ }
    try { localStorage.setItem(activeKey.current, serialized); ledgerSaved = true } catch { /* memory is still purged below */ }
    applyAccountDeletion(clean, ledgerSaved ? serialized : savedRaw.current, markerSaved && ledgerSaved)
    window.dispatchEvent(new CustomEvent(ACCOUNT_DELETED_EVENT, { detail: marker }))
    if (markerSaved && ledgerSaved) {
      setPersistenceError(null)
      return 'cleared'
    }
    setPersistenceError('บัญชีบนเซิร์ฟเวอร์ถูกลบแล้ว แต่ล้างข้อมูลที่เก็บในเบราว์เซอร์ไม่สำเร็จ')
    setWriteStatus('error')
    return 'local-retained'
  }, [applyAccountDeletion, setWriteStatus])

  const retryPersistence = useCallback((): boolean => {
    if (leaseHolder.current !== null) return rehydrateLatest()
    if (!navigator.locks?.request) return false
    setPersistenceError(null)
    setWriteStatus('acquiring')
    setLockAttempt(value => value + 1)
    return true
  }, [rehydrateLatest, setWriteStatus])

  useEffect(() => {
    let mounted = true
    const controller = new AbortController()
    const locks = navigator.locks
    if (!locks?.request) {
      setPersistenceError('เบราว์เซอร์นี้ไม่รองรับการล็อกข้อมูล จึงเปิดแบบอ่านอย่างเดียวเพื่อป้องกันข้อมูลหาย')
      setWriteStatus('readonly')
      return
    }
    setWriteStatus('acquiring')
    // ล็อกคนละดอกต่อช่อง — แท็บเดโมกับแท็บใช้จริงเป็นผู้เขียนของตัวเองได้พร้อมกัน
    const lease = {}
    void locks.request(writerLockName(mode), { mode: 'exclusive', signal: controller.signal }, async () => {
      if (!mounted) return
      leaseHolder.current = lease
      try {
        if (blocked.current) setWriteStatus('writable')
        else {
          let appliedScenario = false
          if (initialScenarioPending.current) {
            initialScenarioPending.current = false
            try {
              const raw = localStorage.getItem(activeKey.current)
              if (raw === initial.savedRaw) {
                const durable = raw === null ? null : migrate(JSON.parse(raw))
                if (durable?.mode === 'demo') {
                  const committed = { ...current.current, revision: durable.revision + 1 }
                  const serialized = JSON.stringify(committed)
                  localStorage.setItem(activeKey.current, serialized)
                  savedRaw.current = serialized
                  current.current = committed
                  setState(committed)
                  setPersistenceError(null)
                  setWriteStatus('writable')
                  appliedScenario = true
                }
              }
            } catch {
              setPersistenceError('เปลี่ยนชุดตัวอย่างไม่สำเร็จ ระบบเก็บข้อมูลเดิมไว้ กรุณาลองใหม่')
              setWriteStatus('error')
              return
            }
          }
          if (!appliedScenario && !rehydrateLatest()) return
        }
        await new Promise<void>(resolve => { releaseLeadership.current = resolve })
      } finally {
        // ปล่อยเฉพาะสิทธิ์ของรอบนี้ — รอบใหม่ที่จับไปแล้วต้องไม่ถูกรอบเก่าลบทิ้ง
        if (leaseHolder.current === lease) leaseHolder.current = null
      }
    }).catch(() => {
      if (!mounted) return
      if (leaseHolder.current === lease) leaseHolder.current = null
      setPersistenceError('ขอสิทธิ์เขียนข้อมูลไม่สำเร็จ แท็บนี้เปิดแบบอ่านอย่างเดียว')
      setWriteStatus('readonly')
    })
    return () => {
      mounted = false
      controller.abort()
      releaseLeadership.current?.()
      releaseLeadership.current = null
      if (leaseHolder.current === lease) leaseHolder.current = null
    }
  }, [initial.savedRaw, lockAttempt, mode, rehydrateLatest, setWriteStatus])

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== activeKey.current || event.newValue === savedRaw.current) return
      if (leaseHolder.current !== null) {
        setPersistenceError('ข้อมูลในเครื่องเปลี่ยนจากอีกแท็บ ระบบหยุดเขียนเพื่อป้องกันข้อมูลหาย')
        setWriteStatus('conflict')
        return
      }
      if (!event.newValue) return
      try {
        const migrated = migrate(JSON.parse(event.newValue))
        if (!migrated) throw new Error('invalid state')
        if (slotKey(migrated.mode) !== activeKey.current) throw new Error('foreign workspace in slot')
        savedRaw.current = event.newValue
        current.current = normalize(migrated)
        // ก้อนนี้มาจากแท็บอื่น แท็บนั้นนับให้แล้ว — นับซ้ำที่นี่คือรายงานงานที่ไม่มีใครทำเพิ่ม
        markLedgerReplaced()
        setState(current.current)
        setPersistenceError(null)
      } catch {
        setPersistenceError('ข้อมูลจากอีกแท็บอ่านไม่ได้ จึงเก็บหน้าจอเดิมไว้')
        setWriteStatus('error')
      }
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [markLedgerReplaced, setWriteStatus])

  useEffect(() => {
    const acceptDeletion = (markerRaw: string | null) => {
      // การลบบัญชีล้างเฉพาะ workspace จริง — แท็บที่กำลังดูเดโมต้องไม่ถูกดึงไปเป็นหลุมฝังศพ
      if (activeKey.current !== REAL_SLOT_KEY) return
      const clean = readDeletedMarker(markerRaw)
      if (!clean) return
      let durableRaw: string | null = null
      try { durableRaw = localStorage.getItem(activeKey.current) } catch { /* remain blocked below */ }
      let durableIsClean = false
      try {
        const durable = durableRaw ? migrate(JSON.parse(durableRaw)) : null
        durableIsClean = !!durable && durable.mode === 'real' && !hasAccountLedgerData(durable)
      } catch { /* remain blocked below */ }
      applyAccountDeletion(normalize(clean), durableRaw, durableIsClean)
      setPersistenceError(null)
      if (leaseHolder.current !== null) {
        setWriteStatus('readonly')
        releaseLeadership.current?.()
        releaseLeadership.current = null
      }
    }
    const storage = (event: StorageEvent) => {
      if (event.key === ACCOUNT_DELETED_KEY) acceptDeletion(event.newValue)
    }
    const local = (event: Event) => acceptDeletion((event as CustomEvent<string>).detail)
    window.addEventListener('storage', storage)
    window.addEventListener(ACCOUNT_DELETED_EVENT, local)
    return () => {
      window.removeEventListener('storage', storage)
      window.removeEventListener(ACCOUNT_DELETED_EVENT, local)
    }
  }, [applyAccountDeletion, setWriteStatus])

  useEffect(() => {
    if (!blocked.current && writeStatus === 'writable') dispatch({ type: 'track', name: 'storage_ready' })
  }, [dispatch, writeStatus])

  useEffect(() => {
    const tick = () => {
      if (current.current.mode !== 'real') return
      const now = todayISO()
      if (now !== current.current.today) dispatch({ type: 'setToday', date: now })
    }
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    return () => {
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', tick)
    }
  }, [dispatch])

  const track = useCallback((name: string, props?: Record<string, unknown>) => {
    dispatch({ type: 'track', name, props })
  }, [dispatch])
  /**
   * รีเซ็ตเดโม = เขียนทับ "ช่องเดโม" เท่านั้น
   * เรียกจากโหมดใช้จริงคืน false — สมุดบัญชีจริงไม่มีทางถูกข้อมูลสมมติทับ แม้ UI จะเผลอเรียก
   */
  const resetDemo = useCallback((scenarioId?: string) => {
    if (current.current.mode !== 'demo') return false
    return dispatch({ type: 'replace',
      state: normalize(carryLineIds(current.current, buildScenario(scenarioId ?? current.current.scenarioId))) })
  }, [dispatch])
  const backToDemo = useCallback((scenarioId?: string) => {
    if (current.current.mode !== 'real') return false
    // ไม่ต้องยก id มาที่นี่: ช่องเดโมที่มีของอยู่แล้วชนะเมล็ดนี้ (`switchWorkspace` overwrite=false)
    // แล้วเดินผ่าน refreshDemoDay ซึ่งยกให้เอง · ช่องว่างเปล่าไม่มีสมุด LINE ให้ยก และ id
    // ของสมุดจริงที่กำลังออกจากมาต้องไม่ไหลเข้าช่องเดโมเด็ดขาด
    return switchWorkspace('demo', normalize(buildScenario(scenarioId ?? 'default')), false)
  }, [switchWorkspace])
  const value = useMemo<StoreValue>(() => ({ state, dispatch, track, mode, resetDemo, backToDemo, didReset,
    hydrated: true, persistenceError, recoveryRaw, writeStatus, ledgerReplacements, retryPersistence,
    prepareAccountDeletion, commitAccountDeletion, cancelAccountDeletion }),
  [state, dispatch, track, mode, resetDemo, backToDemo, didReset, persistenceError, recoveryRaw, writeStatus, ledgerReplacements,
    retryPersistence, prepareAccountDeletion, commitAccountDeletion, cancelAccountDeletion])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore(): StoreValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStore must be used inside StoreProvider')
  return v
}

export { KEY as STORAGE_KEY, ACCOUNT_DELETED_KEY, ACCOUNT_DELETED_EVENT, SCHEMA }
export { ACTIVE_MODE_KEY, DEMO_SLOT_KEY, REAL_SLOT_KEY, parkedKey, slotKey, type WorkspaceMode }
