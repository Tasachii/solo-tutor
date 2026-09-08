import type { MessageKind } from './types.ts'

/**
 * โปรโตคอลฝั่ง LINE — แปล webhook · ประกอบ request ที่จะยิง · ตัดสินว่าจะลองใหม่ไหม
 * ตรรกะล้วน ไม่เรียกเน็ตเอง เพื่อให้เทสได้โดยไม่ต้องมีบัญชี LINE และ Edge Function
 * เหลือแค่เปลือกบาง ๆ ที่ต่อสายเข้ากับฐานข้อมูลและ fetch
 *
 * อ่านคู่กับ docs/line-oa-plan.md ข้อ 5 · 6 · 8
 */

export const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push'
export const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply'
/** ข้อความ type text ของ LINE ยาวได้ 5,000 ตัวอักษร */
export const LINE_TEXT_MAX = 5000

// ── webhook ─────────────────────────────────────────

export type LineEvent =
  | { type: 'follow'; userId: string; replyToken?: string; eventId?: string }
  | { type: 'unfollow'; userId: string; eventId?: string }
  | { type: 'message'; userId: string; text: string; replyToken?: string; eventId?: string }
  | { type: 'other'; eventId?: string }

export interface Webhook { destination: string; events: LineEvent[] }

/**
 * แปลง body ของ webhook เป็นเหตุการณ์ที่เรารู้จัก
 * เหตุการณ์ชนิดอื่นแปลงเป็น 'other' ไม่ใช่โยนทิ้ง เพราะ webhook ต้องตอบ 2xx เสมอ
 * ถ้า body พังจริง ๆ คืน null ให้ผู้เรียกตอบ 200 แล้วไม่ทำอะไรต่อ
 */
export function parseWebhook(raw: string): Webhook | null {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return null
  }
  if (!body || typeof body !== 'object') return null
  const b = body as { destination?: unknown; events?: unknown }
  if (typeof b.destination !== 'string' || !b.destination.trim() || !Array.isArray(b.events)) return null
  const events = b.events.map((e): LineEvent => {
    if (!e || typeof e !== 'object') return { type: 'other' }
    const ev = e as { type?: unknown; webhookEventId?: unknown; source?: { userId?: unknown }; message?: { type?: unknown; text?: unknown }; replyToken?: unknown }
    const userId = typeof ev.source?.userId === 'string' ? ev.source.userId : ''
    const replyToken = typeof ev.replyToken === 'string' ? ev.replyToken : undefined
    const eventId = typeof ev.webhookEventId === 'string' ? ev.webhookEventId : undefined
    const eventMeta = eventId ? { eventId } : {}
    if (!userId) return { type: 'other', ...eventMeta }
    if (ev.type === 'follow') return { type: 'follow', userId, ...(replyToken ? { replyToken } : {}), ...eventMeta }
    if (ev.type === 'unfollow') return { type: 'unfollow', userId, ...eventMeta }
    if (ev.type === 'message' && ev.message?.type === 'text' && typeof ev.message.text === 'string') {
      return { type: 'message', userId, text: ev.message.text, ...(replyToken ? { replyToken } : {}), ...eventMeta }
    }
    return { type: 'other', ...eventMeta }
  })
  return { destination: b.destination, events }
}

/** คำที่ผู้ปกครองพิมพ์เพื่อขอหยุดรับข้อความ — ต้องหยุดทันทีโดยไม่ต้องรอครู (แผนข้อ 9) */
const OPT_OUT = ['ยกเลิก', 'หยุด', 'เลิกรับ', 'unsubscribe', 'stop']

export const isOptOut = (text: string): boolean => {
  const t = text.trim().toLowerCase()
  return OPT_OUT.some((w) => t === w.toLowerCase())
}

export type WebhookPlan =
  | { kind: 'register'; userId: string; reply: 'ask-code' }
  | { kind: 'unfollow'; userId: string }
  | { kind: 'opt-out'; userId: string; reply: 'opted-out' }
  | { kind: 'link'; userId: string; code: string; reply: 'linked' }
  | { kind: 'inbound'; userId: string; text: string }
  | { kind: 'ignore' }

/**
 * เหตุการณ์นี้ควรทำอะไร — ยังไม่แตะฐานข้อมูล แค่บอกว่าจะทำอะไร
 * `linked` บอกว่า userId นี้จับคู่กับลูกค้าแล้วหรือยัง เพราะข้อความ 6 หลักจากคนที่จับคู่แล้ว
 * คือข้อความธรรมดา ไม่ใช่รหัส — ไม่งั้นผู้ปกครองพิมพ์เลขบ้านมาแล้วถูกจับคู่ใหม่
 */
export function planWebhookEvent(event: LineEvent, linked: boolean): WebhookPlan {
  if (event.type === 'follow') return { kind: 'register', userId: event.userId, reply: 'ask-code' }
  if (event.type === 'unfollow') return { kind: 'unfollow', userId: event.userId }
  if (event.type !== 'message') return { kind: 'ignore' }
  if (!event.text.trim()) return { kind: 'ignore' }
  if (isOptOut(event.text)) return { kind: 'opt-out', userId: event.userId, reply: 'opted-out' }
  const digits = event.text.replace(/\D/g, '')
  if (!linked && digits.length === 6) return { kind: 'link', userId: event.userId, code: digits, reply: 'linked' }
  return { kind: 'inbound', userId: event.userId, text: event.text }
}

// ── ยิงข้อความ ──────────────────────────────────────

export interface LineRequest { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function pushRequest(accessToken: string, to: string, text: string, retryKey: string): LineRequest {
  if (!UUID.test(retryKey)) throw new Error('LINE retry key must be a UUID')
  return {
    url: LINE_PUSH_URL,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Line-Retry-Key': retryKey,
      },
      body: JSON.stringify({ to, messages: [{ type: 'text', text: text.slice(0, LINE_TEXT_MAX) }] }),
    },
  }
}

export function replyRequest(accessToken: string, replyToken: string, text: string): LineRequest {
  return {
    url: LINE_REPLY_URL,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text: text.slice(0, LINE_TEXT_MAX) }] }),
    },
  }
}

export type PushOutcome = 'sent' | 'retry' | 'invalid-token' | 'blocked' | 'failed'

/**
 * ผลจาก LINE แปลว่าอะไร
 * 401/403 = token ใช้ไม่ได้ ต้องปิด OA แล้วกลับไป share link ทั้งหมด (แผนข้อ 6.5)
 * 429/5xx = ลองใหม่ได้ · 4xx อื่นคือคำขอผิด ลองใหม่ไปก็เท่าเดิม
 */
export function classifyPush(status: number, body = ''): PushOutcome {
  // LINE returns 409 when this persisted retry key was already accepted.
  if (status === 409) return 'sent'
  if (status >= 200 && status < 300) return 'sent'
  if (status === 401 || status === 403) return 'invalid-token'
  if (status === 429 || status >= 500) return 'retry'
  if (status === 400 && /blocked|not.*friend/i.test(body)) return 'blocked'
  return 'failed'
}

export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000]

/** ลองใหม่ได้กี่ครั้งและเว้นนานเท่าไหร่ — ครบแล้วคืน null แปลว่าเลิกลอง */
export function retryDelayMs(attempt: number): number | null {
  return attempt >= 1 && attempt <= RETRY_DELAYS_MS.length ? RETRY_DELAYS_MS[attempt - 1] : null
}

// ── เวลาที่ส่งได้ ───────────────────────────────────

export const SEND_FROM_HOUR = 8
export const SEND_UNTIL_HOUR = 20

const bangkokHour = (at: Date): number =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false }).format(at))

/** ห้ามส่งนอก 08:00–20:00 ตามเวลาไทย — ผู้ปกครองไม่ควรได้บิลตอนตีสอง */
export const withinSendWindow = (at: Date): boolean => {
  const h = bangkokHour(at)
  return h >= SEND_FROM_HOUR && h < SEND_UNTIL_HOUR
}

/** รอบถัดไปที่ส่งได้ — เลื่อนไป 08:00 ของวันเดียวกันหรือวันรุ่งขึ้น ไม่ใช่ทิ้งข้อความ */
export function nextSendWindow(at: Date): Date {
  const next = new Date(at)
  for (let i = 0; i < 48; i++) {
    if (withinSendWindow(next)) return next
    next.setUTCHours(next.getUTCHours() + 1, 0, 0, 0)
  }
  return next
}

// ── หนึ่งใบต่อคนต่อวัน ──────────────────────────────

/** ยิ่งเลขน้อยยิ่งด่วน — ข้อความทวงสำคัญกว่าชวนต่อแพ็ก */
const KIND_RANK: Record<string, number> = {
  reminder: 0, nudge: 0, invoice: 1, renewal_exhausted: 2, renewal: 3, receipt: 4,
  homework_reminder: 5, summary: 6, homework: 7,
}

export interface Candidate { recipientId: string; kind: MessageKind; dedupeKey: string }

/**
 * เข้าหลายกฎพร้อมกันให้ส่งใบเดียว — คนที่ค้างจ่ายไม่ควรได้สามข้อความในเช้าเดียว
 * เลือกใบที่ด่วนที่สุดของผู้รับแต่ละคน ที่เหลือรอวันถัดไป
 */
export function pickOnePerRecipient(candidates: Candidate[]): Candidate[] {
  const best = new Map<string, Candidate>()
  for (const c of candidates) {
    const current = best.get(c.recipientId)
    const rank = (x: Candidate): number => KIND_RANK[x.kind] ?? 9
    if (!current || rank(c) < rank(current)) best.set(c.recipientId, c)
  }
  return [...best.values()]
}
