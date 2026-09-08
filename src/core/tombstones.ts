import type { AppState, ClientTombstone, ISODate, Subject, SubjectTombstone } from './types'
import { diffDays } from './format'

/**
 * หลุมศพของนักเรียนที่ครูสั่ง "ลบออก"
 *
 * การลบคือการ "ไม่มี" แถวนั้นอยู่ — ซึ่งสำเนาที่เก่ากว่าย้อนกลับมาทับได้เสมอ (กู้ไฟล์สำรองก่อนลบ
 * · อีกเครื่องที่ยังมีคนนี้แล้ว push ทีหลัง · เครื่องที่ออฟไลน์ตอนลบแล้วค่อยดึงคลาวด์)
 * ผู้ปกครองที่ขอให้ลบข้อมูลออกแล้วโผล่กลับมา ไม่ใช่ความไม่สะดวก แต่คือคำสัญญาที่ผิด
 * จึงต้องเก็บ "เจตนาลบ" ไว้เป็นข้อมูลจริงในสมุดบัญชี ไม่ใช่ปล่อยให้เป็นแค่ความว่างเปล่า
 *
 * และเส้นทางที่ครูไม่มีวันเอะใจ ซึ่งเป็นเหตุผลจริง ๆ ที่ต้องมีไฟล์นี้:
 * ถ้าเครื่องที่กดลบถูกดึงข้อมูลจากคลาวด์มาทับ "ก่อน" ที่มันจะได้ push การลบนั้นไม่เหลือร่องรอยอะไรเลย
 * แม้แต่ในเครื่องที่กดลบเอง — ไม่มีอะไรให้บังคับใช้ได้อีกตลอดไป และไม่มีอะไรฟ้องว่าเคยมีการลบเกิดขึ้น
 * นักเรียนคนนั้นกลับมาอยู่ในสมุดบัญชีเงียบ ๆ เหมือนไม่เคยถูกลบ
 *
 * อยู่ใน AppState (ไม่ใช่คีย์แยกใน localStorage) เพราะสิ่งที่ต้องรอดคือไฟล์สำรองและก้อนบนคลาวด์
 * ทั้งสองอย่างคือ AppState ที่ผ่าน toBackup — หลุมศพจึงเดินทางไปทุกเครื่องเองโดยไม่ต้องมีท่อใหม่
 */
export type { ClientTombstone, SubjectTombstone }

export const TOMBSTONE_MODES = ['removed', 'archived'] as const

/** ส่วนที่ใบทุกชนิดมีเหมือนกัน */
interface TombstoneRow { id: string; at: ISODate }

/**
 * เก็บนานเท่าไหร่ — 400 วัน
 * หลุมศพต้องอยู่ทนกว่าสำเนาที่เก่าที่สุดที่ยังกลับมาได้ (ไฟล์สำรองที่ครูเก็บไว้ · เครื่องที่ไม่ได้เปิดนาน)
 * หนึ่งปีบวกอีกหนึ่งเทอมครอบคลุมทุกกรณีจริง ยาวกว่านั้นคือครูจงใจเปิดไฟล์เก่ามาก ซึ่งเป็นการตัดสินใจของครูเอง
 */
export const TOMBSTONE_TTL_DAYS = 400

/** เพดานจำนวน — กันสมุดบัญชีบวมถ้าครูลบคนเยอะข้ามปี (500 × ~50 ไบต์ ≈ 25KB) */
export const TOMBSTONE_MAX = 500

export const tombstonesOf = (state: AppState): SubjectTombstone[] => state.deletedSubjects ?? []
export const clientTombstonesOf = (state: AppState): ClientTombstone[] => state.deletedClients ?? []

/** ไม่มีหลุมศพ = ไม่มีคีย์นี้เลย ไฟล์สำรองเก่าจึงเทียบเท่ากันทุกไบต์เหมือนเดิม */
export function withTombstones(state: AppState, rows: SubjectTombstone[]): AppState {
  if (rows.length) return { ...state, deletedSubjects: rows }
  if (state.deletedSubjects === undefined) return state
  const next = { ...state }
  delete next.deletedSubjects
  return next
}

export function withClientTombstones(state: AppState, rows: ClientTombstone[]): AppState {
  if (rows.length) return { ...state, deletedClients: rows }
  if (state.deletedClients === undefined) return state
  const next = { ...state }
  delete next.deletedClients
  return next
}

const order = (a: TombstoneRow, b: TombstoneRow): number =>
  a.at === b.at ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : (a.at < b.at ? -1 : 1)

function mergeRows<T extends TombstoneRow>(
  a: readonly T[], b: readonly T[], combine: (seen: T, row: T) => T,
): T[] {
  const byId = new Map<string, T>()
  for (const row of [...a, ...b]) {
    const seen = byId.get(row.id)
    byId.set(row.id, seen ? combine(seen, row) : row)
  }
  return [...byId.values()].sort(order)
}

/**
 * รวมสองรายการเข้าด้วยกัน — id ซ้ำเก็บใบเดียว
 * วันที่เอาวันแรกที่ครูกดลบ (หยุดให้บริการตั้งแต่วันนั้น) · mode เอาอันที่แรงกว่าคือ removed
 * เรียงลำดับตายตัวเสมอ ไม่งั้นสองเครื่องได้ลายนิ้วมือต่างกันทั้งที่ข้อมูลเหมือนกัน แล้วจะซิงก์วนไม่จบ
 */
export const mergeTombstones = (a: readonly SubjectTombstone[], b: readonly SubjectTombstone[]): SubjectTombstone[] =>
  mergeRows(a, b, (seen, row) => ({
    id: row.id, at: row.at < seen.at ? row.at : seen.at,
    mode: seen.mode === 'removed' || row.mode === 'removed' ? 'removed' : 'archived',
  }))

/** ผู้จ่าย: ไม่มีระดับความแรง เก็บวันแรกที่ถูกลบไว้อย่างเดียว */
export const mergeClientTombstones = (a: readonly ClientTombstone[], b: readonly ClientTombstone[]): ClientTombstone[] =>
  mergeRows(a, b, (seen, row) => ({ id: row.id, at: row.at < seen.at ? row.at : seen.at }))

/** ตัดใบที่หมดอายุและใบเก่าสุดเมื่อเกินเพดาน — ใบใหม่สำคัญกว่าเพราะสำเนาที่จะย้อนมามักใหม่กว่า */
export function pruneTombstones<T extends TombstoneRow>(rows: readonly T[], today: ISODate): T[] {
  const fresh = [...rows].filter((row) => diffDays(today, row.at) <= TOMBSTONE_TTL_DAYS).sort(order)
  return fresh.length > TOMBSTONE_MAX ? fresh.slice(fresh.length - TOMBSTONE_MAX) : fresh
}

/**
 * ปิดรายการแบบเดียวกับตอนกดลบคนที่มีประวัติการเงิน — ไม่แตะบิล ไม่แตะใบเสร็จ
 *
 * ช่องโหว่ที่รู้ตัวและยังไม่มีทางออก (บันทึกไว้ใน data inventory ด้วย):
 * นักเรียนที่มีบิลหรือใบเสร็จผูกอยู่ จะถูก "ปิดรายการ" เท่านั้น ชื่อเด็กและชื่อผู้จ่ายยังอยู่ในสมุดบัญชี
 * ทั้งในแถวนี้ ในสำเนาชื่อที่แช่แข็งไว้ในใบเสร็จ ในแชท และในร่างข้อความ — และ **ไม่มีเส้นทางใดในแอป
 * ที่ลบเฉพาะคนคนนี้ให้จบได้** ไม่ว่าจะรอครบกำหนดเก็บเอกสารแล้วก็ตาม ทางเดียวที่ลบได้จริงคือลบทั้งบัญชีครู
 * ซึ่งลบทุกคนพร้อมกัน ถ้าผู้ปกครองขอให้ลบข้อมูล ต้องบอกความจริงข้อนี้ อย่าบอกว่าลบครบแล้ว
 */
function archiveSubject(state: AppState, subject: Subject, at: ISODate): AppState {
  if (!subject.active) return state
  // นาฬิกาของอีกเครื่องอาจเดินคนละวัน — วันปิดต้องไม่ย้อนไปก่อนวันเปิดรายการ ไม่งั้น state ไม่ผ่าน validate
  const day = at < subject.createdAt ? subject.createdAt : at
  const spans = (subject.billingIntervals?.length ? subject.billingIntervals : [{ from: subject.createdAt }])
    .map((span, index, all) => index === all.length - 1 && span.to === undefined
      ? { ...span, to: day < span.from ? span.from : day }
      : span)
  return { ...state, subjects: state.subjects.map((row) => row.id === subject.id
    ? { ...row, active: false, inactiveAt: day, billingIntervals: spans }
    : row) }
}

/**
 * เอาเจตนาลบไปทาบกับสมุดบัญชีอีกก้อนหนึ่ง (ไฟล์สำรอง หรือก้อนที่ดึงมาจากคลาวด์)
 *
 * กติกาเดียวกับตอนกดลบเป๊ะ ๆ: มีบิลหรืองานที่ทำแล้ว = ปิดรายการ ไม่ใช่ลบ
 * ฟังก์ชันนี้ "ไม่มีบรรทัดไหนเลย" ที่แตะ invoices / payments / receipts — หลุมศพลบเงินของครูไม่ได้แม้จะมีบั๊ก
 */
export function applyTombstones(state: AppState, rows: readonly SubjectTombstone[]): AppState {
  let s = state
  for (const row of rows) {
    const subject = s.subjects.find((x) => x.id === row.id)
    if (!subject) continue
    const unitIds = new Set(s.units.filter((u) => u.subjectId === subject.id).map((u) => u.id))
    const hasLedgerHistory = s.invoices.some((invoice) => invoice.subjectId === subject.id)
      || s.completions.some((completion) => unitIds.has(completion.unitId))
    if (row.mode === 'archived' || hasLedgerHistory) { s = archiveSubject(s, subject, row.at); continue }
    // ลบทุกอย่างที่ห้อยอยู่กับคนนี้ ไม่ให้เหลือแถวกำพร้า — ตรงกับสิ่งที่เกิดขึ้นบนเครื่องที่กดลบ
    s = {
      ...s,
      subjects: s.subjects.filter((x) => x.id !== subject.id),
      units: s.units.filter((u) => u.subjectId !== subject.id),
      completions: s.completions.filter((c) => !unitIds.has(c.unitId)),
      messages: s.messages.filter((m) => m.subjectId !== subject.id),
      ...(s.homework ? { homework: s.homework.filter((h) => h.subjectId !== subject.id) } : {}),
    }
    if (!s.subjects.some((x) => x.clientId === subject.clientId)) {
      s = {
        ...s,
        clients: s.clients.filter((c) => c.id !== subject.clientId),
        chats: s.chats.filter((c) => c.clientId !== subject.clientId),
        messages: s.messages.filter((m) => m.clientId !== subject.clientId),
      }
    }
  }
  return s === state ? state : pruneSending(s)
}

/** คิวส่ง LINE ของก้อนที่รับเข้ามาอาจชี้ไปยังข้อความที่เพิ่งหายไป — ปล่อยไว้จะ validate ไม่ผ่านทั้งก้อน */
function pruneSending(state: AppState): AppState {
  if (!state.sending) return state
  const ids = new Set(state.messages.map((m) => m.id))
  if (!ids.has(state.sending.awaiting)) {
    const next = { ...state }
    delete next.sending
    return next
  }
  const queue = state.sending.queue.filter((id) => ids.has(id))
  return queue.length === state.sending.queue.length
    ? state
    : { ...state, sending: { awaiting: state.sending.awaiting, queue } }
}

/**
 * บังคับใช้ใบของผู้จ่าย — ต้องทำ "หลัง" ใบของนักเรียนเสมอ
 *
 * ผู้จ่ายที่ยังมีนักเรียนเหลืออยู่ในก้อนนี้ แปลว่าเขากลับมาเป็นลูกค้าแล้ว (อีกเครื่องเพิ่มน้องอีกคนไว้)
 * เจตนาล่าสุดชนะ จึงรื้อใบนั้นทิ้ง ไม่ใช่ลบคนที่ยังใช้งานอยู่ — และเซิร์ฟเวอร์จะไม่ได้รับคำสั่งลบเขาด้วย
 */
export function applyClientTombstones(
  state: AppState, rows: readonly ClientTombstone[],
): { state: AppState; kept: ClientTombstone[] } {
  let s = state
  const kept: ClientTombstone[] = []
  for (const row of rows) {
    if (s.subjects.some((subject) => subject.clientId === row.id)) continue
    kept.push(row)
    if (!s.clients.some((client) => client.id === row.id)) continue
    s = {
      ...s,
      clients: s.clients.filter((client) => client.id !== row.id),
      chats: s.chats.filter((chat) => chat.clientId !== row.id),
      messages: s.messages.filter((message) => message.clientId !== row.id),
    }
  }
  return { state: s === state ? state : pruneSending(s), kept }
}

/**
 * คีย์ผู้จ่ายที่ส่งไปสั่งลบบนเซิร์ฟเวอร์ได้ — ดู migration 0018
 *
 * ที่มาคือ "ใบสั่งลบ" เท่านั้น ไม่ใช่ "ไม่เจอในรายชื่อ" — เครื่องที่ถือสมุดบัญชีรุ่นเก่าซึ่งยังไม่มีผู้จ่ายคนนี้
 * ต้องไม่ลบใครทั้งสิ้น ตัวกรองสองชั้นด้านล่างเป็นเพียงกันพลาด ไม่ใช่ที่มาของสัญญาณ
 */
export const erasableClientKeys = (state: AppState): string[] =>
  clientTombstonesOf(state)
    .filter((row) => !state.clients.some((client) => client.id === row.id)
      && !state.subjects.some((subject) => subject.clientId === row.id))
    .map((row) => row.id)

/**
 * แถวนี้ยังอยู่เพราะมีเอกสารการเงินผูกไว้ ไม่ใช่เพราะครูเลือก "หยุดเรียน"
 * ครูกดลบไปแล้วแต่ระบบเก็บไว้ให้ — ถ้าไม่บอก ครูจะเข้าใจว่าลบสำเร็จ และผู้ปกครองจะเข้าใจตามครู
 */
export const keptForRecords = (state: AppState, subjectId: string): boolean =>
  state.subjects.some((subject) => subject.id === subjectId && !subject.active)
  && tombstonesOf(state).some((row) => row.id === subjectId)
