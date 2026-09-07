import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, useRef, type ReactNode,
} from 'react'
import type { AppState, Message, Subject, Particle, WorkStyle } from './types'
import { isParticle } from './particle'
import { isStyle } from './style'
import { buildReal, buildScenario, isScenario } from './scenarios'
import { appendEvent } from './events'
import { periodOf, todayISO } from './format'
import { isWellFormed } from './backup'
import { urlParam } from './urlParams'
import { billingChangeIssue, buildPackageInvoice, closableSubjects, isFinalizedPeriod, markOverdue, mutationTouchesFinalizedPeriod, reconcileDraftInvoices } from './billing'
import { deriveDrafts, refreshDrafts, retractDrafts, applySend, cancelledText, mkMessage, movedText } from './messages'
import { balanceDue, complete as ledgerComplete, packageStatus, renewPackage, snapshotLegacyPrices, uncomplete } from './ledger'
import { issueReceipt } from './receipts'
import { isBillingMode, isISODate, isMoney, isNonNegativeMoney, isTime } from './validation'
import { messageSendIssue } from './messageDelivery'
import { migrateCanonical } from './migrations'

const KEY = 'solo-demo-v3'
const SCHEMA = 5

export type Action =
  | { type: 'complete'; unitId: string }
  | { type: 'uncomplete'; unitId: string }
  | { type: 'closeMonth'; period: string }
  | { type: 'sendMessage'; id: string }
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
  | { type: 'replace'; state: AppState }
  | { type: 'track'; name: string; props?: Record<string, unknown> }

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

/** ทุก action วิ่งผ่านที่นี่ แล้ว normalize (markOverdue + deriveDrafts) ตอนท้ายเสมอ */
export function reducer(state: AppState, action: Action): AppState {
  if ((action.type === 'complete' || action.type === 'uncomplete' || action.type === 'cancelUnit'
    || action.type === 'restoreUnit') && mutationTouchesFinalizedPeriod(state, action.unitId)) return state
  if (action.type === 'rescheduleUnit' && mutationTouchesFinalizedPeriod(state, action.unitId, action.date)) return state
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
    case 'sendMessage': {
      const msg = s.messages.find((m) => m.id === action.id)
      if (!msg) break
      if (messageSendIssue(s, msg)) return state
      s = applySend(s, msg)
      s = { ...s, messages: s.messages.map((m) => (m.id === action.id ? { ...m, status: 'sent', sentAt: s.today } : m)) }
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
      if (!exists && action.subject.billing.mode === 'package' && action.packageIntent === undefined) return state
      if (current && current.clientId !== action.subject.clientId
        && (s.invoices.some(invoice => invoice.subjectId === current.id)
          || s.messages.some(message => message.subjectId === current.id))) return state
      if (current?.active && current.billing.mode === 'package' && action.subject.billing.mode === 'package'
        && (current.billing.total !== action.subject.billing.total || current.billing.price !== action.subject.billing.price)) return state
      if (current && billingChangeIssue(s, current, action.subject.billing)) return state
      if (current) s = snapshotLegacyPrices(s, current.id)
      const billing = current?.billing.mode === 'package' && action.subject.billing.mode === 'package'
        ? {
            ...action.subject.billing,
            purchasedAt: current.billing.purchasedAt,
            ...(current.billing.carriedCredits !== undefined ? { carriedCredits: current.billing.carriedCredits } : {}),
            ...(current.billing.carriedUnitIds ? { carriedUnitIds: current.billing.carriedUnitIds } : {}),
          }
        : action.subject.billing
      const subject = { ...action.subject, billing }
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
      s = { ...s, subjects: s.subjects.map((x) => (x.id === action.subjectId ? { ...x, active: false } : x)) }
      break
    case 'reactivateSubject':
      if (!s.subjects.some(x => x.id === action.subjectId)) return state
      s = { ...s, subjects: s.subjects.map(x => x.id === action.subjectId ? { ...x, active: true } : x) }
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
        subjects.push({ id: nid(`s${i}`), name: r.name, clientId: cid, billing: r.billing ?? action.billing, active: true, createdAt: s.today })
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
        const subject: Subject = { id: nid(`s${index}`), name: row.name, clientId,
          billing: { ...action.billing }, active: true, createdAt: s.today }
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
      const unitIds = new Set(s.units.filter((u) => u.subjectId === sub.id).map((u) => u.id))
      if (s.invoices.some((invoice) => invoice.subjectId === sub.id)
        || s.completions.some(completion => unitIds.has(completion.unitId))) {
        s = { ...s, subjects: s.subjects.map((subject) => subject.id === sub.id ? { ...subject, active: false } : subject) }
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
      }
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
    case 'restore':
      if (!isWellFormed(action.state)) return state
      // ไฟล์เก็บวันที่สำรองไว้ ถ้าเอามาทั้งก้อน 'วันนี้' จะแช่แข็งอยู่วันนั้น
      // เช็คชื่อทุกคาบหลังจากนี้จะลงวันผิดโดยไม่มีอะไรฟ้อง
      s = action.state.mode === 'real' ? { ...action.state, today: todayISO() } : action.state
      break
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
    case 'setStyle':
      // เปลี่ยนแค่หน้าจอและค่าเริ่มต้น — ข้อมูลลูกค้าและบิลอยู่ครบ
      if (!isStyle(action.style)) return state
      s = { ...s, style: action.style }
      break
    case 'clearMessages':
      // เก็บ skipped/sent ไว้ ไม่งั้น dedupe หาย ร่างที่ผู้ใช้ข้ามจะกลับมา
      // และ 'Solo ช่วยไว้' ที่นับจากข้อความทวงที่ส่งแล้วจะกลายเป็นศูนย์
      s = { ...s, messages: s.messages.filter((m) => m.status !== 'draft') }
      break
    case 'replace':
      s = action.state
      break
    case 'track':
      s = { ...s, events: appendEvent(s.events, action.name, action.props) }
      break
  }

  s = reconcileDraftInvoices(s)
  s = markOverdue(s)
  // ถอนก่อน แล้วค่อยสะกิดตัวเลข — ไม่งั้นจะไป render ร่างที่กำลังจะถูกถอนอยู่ดี
  s = { ...s, messages: retractDrafts(s) }
  s = { ...s, messages: refreshDrafts(s) }
  const add = deriveDrafts(s)
  if (add.length) s = { ...s, messages: [...s.messages, ...add] }
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
function refreshDemoDay(saved: AppState): AppState {
  const now = todayISO()
  if (saved.today === now) return saved
  if (periodOf(saved.today) !== periodOf(now)) return buildScenario(saved.scenarioId)
  return { ...saved, today: now }
}

function hydrate(scenarioFromUrl: string | null): { state: AppState; didReset: boolean; recoveryRaw: string | null; savedRaw: string | null; applyInitialScenario: boolean } {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
    if (raw) {
      const saved = migrate(JSON.parse(raw))
      if (!saved) throw new Error('invalid saved state')
      // A demo query parameter must never overwrite an existing real workspace.
      const chosen = saved.mode === 'demo' && scenarioFromUrl && isScenario(scenarioFromUrl)
        ? buildScenario(scenarioFromUrl) : saved
      const dated = chosen.mode === 'real' ? { ...chosen, today: todayISO() } : refreshDemoDay(chosen)
      return { state: normalize(dated), didReset: false, recoveryRaw: null, savedRaw: raw,
        applyInitialScenario: saved.mode === 'demo' && !!scenarioFromUrl && isScenario(scenarioFromUrl) }
    }
    return { state: normalize(buildScenario(scenarioFromUrl && isScenario(scenarioFromUrl) ? scenarioFromUrl : 'default')), didReset: false, recoveryRaw: null, savedRaw: null, applyInitialScenario: false }
  } catch {
    // Preserve even syntactically broken JSON. Recovery is explicit; never autosave demo over it.
    return { state: normalize(buildScenario('empty')), didReset: true, recoveryRaw: raw, savedRaw: raw, applyInitialScenario: false }
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
  resetDemo: (scenarioId?: string) => boolean
  didReset: boolean
  hydrated: boolean
  persistenceError: string | null
  recoveryRaw: string | null
  writeStatus: WriteStatus
  /** Rehydrate the latest durable state after a conflict/error and resume if leadership is still held. */
  retryPersistence: () => boolean
}
const Ctx = createContext<StoreValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(() => hydrate(urlParam('scenario')), [])
  const [state, setState] = useState(initial.state)
  const current = useRef(state)
  const savedRaw = useRef(initial.savedRaw)
  const initialScenarioPending = useRef(initial.applyInitialScenario)
  const blocked = useRef(initial.didReset)
  const leader = useRef(false)
  const writeStatusRef = useRef<WriteStatus>('acquiring')
  const releaseLeadership = useRef<(() => void) | null>(null)
  const [didReset, setDidReset] = useState(initial.didReset)
  const [persistenceError, setPersistenceError] = useState<string | null>(initial.didReset ? 'เปิดข้อมูลเดิมไม่ได้ กรุณาเก็บสำเนาดิบแล้วกู้คืนจากไฟล์สำรอง' : null)
  const [recoveryRaw, setRecoveryRaw] = useState(initial.recoveryRaw)
  const [writeStatus, setWriteStatusState] = useState<WriteStatus>('acquiring')
  const [lockAttempt, setLockAttempt] = useState(0)
  const setWriteStatus = useCallback((status: WriteStatus) => {
    writeStatusRef.current = status
    setWriteStatusState(status)
  }, [])

  const rehydrateLatest = useCallback((): boolean => {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw === null) {
        savedRaw.current = null
        setWriteStatus('writable')
        return true
      }
      const migrated = migrate(JSON.parse(raw))
      if (!migrated) throw new Error('invalid saved state')
      // อ่านซ้ำหลังได้สิทธิ์เขียนก็ต้องเดินวันเหมือนตอน hydrate ไม่งั้นทับวันที่รีเฟรชไปแล้ว
      const dated = migrated.mode === 'real' ? { ...migrated, today: todayISO() } : refreshDemoDay(migrated)
      const normalized = normalize(dated)
      const canonical = JSON.stringify(normalized)
      if (canonical !== raw) localStorage.setItem(KEY, canonical)
      savedRaw.current = canonical
      current.current = normalized
      blocked.current = false
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
  }, [setWriteStatus])

  const dispatch = useCallback((action: Action): boolean => {
    if (!leader.current || writeStatusRef.current !== 'writable') {
      setPersistenceError(writeStatusRef.current === 'conflict'
        ? 'พบข้อมูลจากแท็บหรือโปรแกรมรุ่นอื่น กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่'
        : 'แท็บนี้เป็นโหมดอ่านอย่างเดียว กรุณาปิดแท็บที่กำลังแก้ข้อมูลหรือกดลองใหม่')
      return false
    }
    if (blocked.current && action.type !== 'restore') return false
    const next = reducer(current.current, action)
    if (next === current.current) return false
    try {
      if (action.type === 'restore' || action.type === 'replace' || action.type === 'startReal') {
        const previous = localStorage.getItem(KEY)
        if (previous !== null) localStorage.setItem(`${KEY}-before-restore`, previous)
      }
      // localStorage is synchronous. On quota/security error keep the last committed state.
      const durableRaw = localStorage.getItem(KEY)
      if (durableRaw !== savedRaw.current) {
        setPersistenceError('ข้อมูลในเครื่องเปลี่ยนจากอีกแท็บ ระบบปฏิเสธการเขียนครั้งนี้ กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่')
        setWriteStatus('conflict')
        return false
      }
      const committed = { ...next, schemaVersion: SCHEMA as 5, revision: current.current.revision + 1 }
      const serialized = JSON.stringify(committed)
      localStorage.setItem(KEY, serialized)
      savedRaw.current = serialized
      current.current = committed
      blocked.current = false
      setState(committed)
      setDidReset(false)
      setRecoveryRaw(null)
      setPersistenceError(null)
      return true
    } catch {
      setPersistenceError('บันทึกไม่สำเร็จ การเปลี่ยนแปลงล่าสุดยังไม่ถูกเก็บ กรุณาสำรองข้อมูล ตรวจพื้นที่ว่าง แล้วลองอีกครั้ง')
      return false
    }
  }, [setWriteStatus])

  const retryPersistence = useCallback((): boolean => {
    if (leader.current) return rehydrateLatest()
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
    void locks.request(`${KEY}:writer`, { mode: 'exclusive', signal: controller.signal }, async () => {
      if (!mounted) return
      leader.current = true
      try {
        if (blocked.current) setWriteStatus('writable')
        else {
          let appliedScenario = false
          if (initialScenarioPending.current) {
            initialScenarioPending.current = false
            try {
              const raw = localStorage.getItem(KEY)
              if (raw === initial.savedRaw) {
                const durable = raw === null ? null : migrate(JSON.parse(raw))
                if (durable?.mode === 'demo') {
                  const committed = { ...current.current, revision: durable.revision + 1 }
                  const serialized = JSON.stringify(committed)
                  localStorage.setItem(KEY, serialized)
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
        leader.current = false
      }
    }).catch(() => {
      if (!mounted) return
      leader.current = false
      setPersistenceError('ขอสิทธิ์เขียนข้อมูลไม่สำเร็จ แท็บนี้เปิดแบบอ่านอย่างเดียว')
      setWriteStatus('readonly')
    })
    return () => {
      mounted = false
      controller.abort()
      releaseLeadership.current?.()
      releaseLeadership.current = null
      leader.current = false
    }
  }, [initial.savedRaw, lockAttempt, rehydrateLatest, setWriteStatus])

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== KEY || event.newValue === savedRaw.current) return
      if (leader.current) {
        setPersistenceError('ข้อมูลในเครื่องเปลี่ยนจากอีกแท็บ ระบบหยุดเขียนเพื่อป้องกันข้อมูลหาย')
        setWriteStatus('conflict')
        return
      }
      if (!event.newValue) return
      try {
        const migrated = migrate(JSON.parse(event.newValue))
        if (!migrated) throw new Error('invalid state')
        savedRaw.current = event.newValue
        current.current = normalize(migrated)
        setState(current.current)
        setPersistenceError(null)
      } catch {
        setPersistenceError('ข้อมูลจากอีกแท็บอ่านไม่ได้ จึงเก็บหน้าจอเดิมไว้')
        setWriteStatus('error')
      }
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [setWriteStatus])

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
  const resetDemo = useCallback((scenarioId?: string) =>
    dispatch({ type: 'replace', state: normalize(buildScenario(scenarioId ?? current.current.scenarioId)) }), [dispatch])
  const value = useMemo<StoreValue>(() => ({ state, dispatch, track, resetDemo, didReset,
    hydrated: true, persistenceError, recoveryRaw, writeStatus, retryPersistence }),
  [state, dispatch, track, resetDemo, didReset, persistenceError, recoveryRaw, writeStatus, retryPersistence])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore(): StoreValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStore must be used inside StoreProvider')
  return v
}

export { KEY as STORAGE_KEY, SCHEMA }
