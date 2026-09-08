/**
 * ลิงก์เอกสารที่ปลอดภัยสำหรับผู้ปกครอง — เข้ารหัสบนเครื่องครู เก็บแต่ ciphertext ไว้บนเซิร์ฟเวอร์
 *
 * รูปแบบลิงก์: `#/document/<token>.<key>`
 * ทุกอย่างหลัง `#` แรกคือ fragment ของ URL เบราว์เซอร์ไม่เคยส่ง fragment ไปกับคำขอ HTTP
 * กุญแจจึงไม่ปรากฏใน access log, Referer หรือ proxy ใด ๆ · เซิร์ฟเวอร์เห็นแต่ token กับ ciphertext
 *
 * ขอบเขตที่ทำได้จริง: การเพิกถอนหยุดการเปิดครั้งต่อไป ไม่ได้ลบสำเนาที่ผู้รับเปิดหรือบันทึกไปแล้ว
 */
import { open, seal, type Sealed } from './cloudCrypto'
import type { SharedDocument } from './documents'
import { isSharedDocument } from './documents'

/** 90 วัน — ยาวพอให้ผู้ปกครองที่จ่ายช้าข้ามเดือนยังเปิดบิลเดิมได้ และสั้นพอที่ลิงก์ซึ่งถูกส่งต่อจะตายเอง */
export const DEFAULT_SHARE_DAYS = 90
/** เพดานเดียวกับที่ฝั่งฐานข้อมูลบีบไว้ — ประกาศไว้ตรงนี้เพื่อให้ฝั่ง UI พูดตรงกับที่เซิร์ฟเวอร์ทำ */
export const MAX_SHARE_DAYS = 180

const TOKEN = /^[A-Za-z0-9_-]{22}$/
const URL_KEY = /^[A-Za-z0-9_-]{43}$/

const toBase64Url = (bytes: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> => {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
  const out = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

/** กุญแจใหม่ต่อเอกสารหนึ่งใบ — ไม่เกี่ยวกับรหัสผ่านครู ลิงก์ใบหนึ่งรั่วจึงไม่ลามไปใบอื่น */
export const generateDocumentKey = (): Promise<CryptoKey> =>
  crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])

export async function exportUrlKey(key: CryptoKey): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', key)))
}

export async function importUrlKey(raw: string): Promise<CryptoKey | null> {
  if (!URL_KEY.test(raw)) return null
  try {
    const bytes = fromBase64Url(raw)
    if (bytes.length !== 32) return null
    return await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  } catch {
    return null
  }
}

export const sealDocument = (key: CryptoKey, doc: SharedDocument): Promise<Sealed> =>
  seal(key, JSON.stringify(doc))

/**
 * คืน null เมื่อกุญแจผิด ciphertext ถูกแก้ หรือเนื้อในไม่ผ่านการตรวจโครงสร้าง
 * AES-GCM ตรวจความถูกต้องให้อยู่แล้ว ส่วน isSharedDocument กันเอกสารที่ยอดไม่ตรงรายการ
 */
export async function openDocument(key: CryptoKey, sealed: Sealed): Promise<SharedDocument | null> {
  const text = await open(key, sealed)
  if (text === null) return null
  try {
    const parsed: unknown = JSON.parse(text)
    return isSharedDocument(parsed) ? parsed : null
  } catch {
    return null
  }
}

export interface DocumentRoute {
  /** ลิงก์รุ่นใหม่: token อยู่บนเซิร์ฟเวอร์ กุญแจอยู่ใน fragment */
  secure: { token: string; key: string } | null
  /** ลิงก์รุ่นเดิมที่ผู้ปกครองถืออยู่แล้ว: ข้อมูลทั้งใบอยู่ใน URL */
  legacy: string | null
}

/**
 * แยกรูปแบบลิงก์สองรุ่น — ลิงก์รุ่นเดิมเป็น base64url ล้วนจึงไม่มีจุดอยู่ข้างใน ไม่กำกวมกัน
 * ลิงก์รุ่นใหม่ที่รูปแบบไม่ครบต้องล้มแบบปิด ไม่ตกไปเดาว่าเป็นลิงก์รุ่นเดิม
 */
export function parseDocumentRoute(raw: string): DocumentRoute {
  const empty: DocumentRoute = { secure: null, legacy: null }
  if (!raw) return empty
  if (raw.includes('.')) {
    const [token, key, ...rest] = raw.split('.')
    if (rest.length || !TOKEN.test(token) || !URL_KEY.test(key)) return empty
    return { secure: { token, key }, legacy: null }
  }
  return { secure: null, legacy: raw }
}

const appBase = (): string => {
  const base = import.meta.env?.BASE_URL ?? '/'
  const origin = typeof location === 'undefined' ? '' : location.origin
  return `${origin}${base}`
}

export const documentLinkFor = (token: string, urlKey: string): string =>
  `${appBase()}#/document/${token}.${urlKey}`

/** ป้ายที่ครูใช้จำว่าลิงก์ใบไหนคือใบไหน — เข้ารหัสด้วยกุญแจคลาวด์ของครูก่อนเก็บ */
export const documentLabel = (doc: SharedDocument): string =>
  `${doc.kind === 'receipt' ? 'ใบเสร็จ' : 'ใบแจ้งยอด'} · ${doc.payer} · ${doc.subject} · ${doc.period}`

export const sealLabel = (key: CryptoKey, label: string): Promise<Sealed> => seal(key, label.slice(0, 300))

export async function openLabel(key: CryptoKey, sealed: Sealed): Promise<string | null> {
  const text = await open(key, sealed)
  return text === null ? null : text.slice(0, 300)
}

export const shareExpiryFrom = (now: Date, days = DEFAULT_SHARE_DAYS): string =>
  new Date(now.getTime() + Math.min(Math.max(days, 1), MAX_SHARE_DAYS) * 86_400_000).toISOString()
