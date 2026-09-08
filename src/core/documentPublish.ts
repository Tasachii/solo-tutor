/**
 * เปลี่ยนลิงก์เอกสารในข้อความให้เป็นลิงก์ที่หมดอายุและเพิกถอนได้ ก่อนข้อความออกจากเครื่องครู
 *
 * ทำไมต้องมาอยู่ตรงนี้ ไม่ใช่ตอนร่าง: การเผยแพร่ต้องรอเซิร์ฟเวอร์ออก token แต่ร่างถูกสร้าง
 * แบบ synchronous ใน reducer จึงรอไม่ได้ · จุดที่ถูกต้องคือวินาทีที่ครูกดส่งหรือกดคัดลอก
 *
 * ผลลัพธ์ต้องถูกบันทึกกลับลงร่างเสมอ ไม่ใช่แค่ส่งออกไปเฉย ๆ เพราะ oaStart ใน store
 * ปฏิเสธคิว OA ที่ body ไม่ตรงกับร่างที่เก็บไว้ · และข้อความที่เก็บไว้ต้องตรงกับที่ผู้ปกครองได้รับ
 *
 * ล้มเมื่อไรก็ตาม ข้อความเดิมจะถูกส่งคืนโดยไม่ถูกแก้ และผู้เรียกต้องไม่ส่งต่อ
 */
import type { AppState } from './types'
import { readDocument, type SharedDocument } from './documents'
import {
  documentLabel, documentLinkFor, exportUrlKey, generateDocumentKey, sealDocument, sealLabel, shareExpiryFrom,
} from './documentShare'
import { publishSharedDocument, sharedDocumentLiveness } from './sharedDocumentApi'
import { getSession, getSupabaseConfig, SupabaseRestError } from '../integrations/supabaseRest'
import { loadKey } from './cloudKey'

/** จับได้ทั้งลิงก์รุ่นเดิม (base64url ล้วน) และรุ่นใหม่ (token.key) แต่ไม่กินเครื่องหมายท้ายประโยค */
const DOCUMENT_LINK = /#\/document\/([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?)/g

const STORE_PREFIX = 'solo-tutor:shared-links:'
const MAX_REMEMBERED = 300

export interface SharedLink { token: string; key: string; expiresAt: string }
type LinkCache = Record<string, SharedLink>

const cacheKey = (providerId: string): string => `${STORE_PREFIX}${providerId}`

const readCache = (providerId: string): LinkCache => {
  try {
    const raw = localStorage.getItem(cacheKey(providerId))
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed as LinkCache : {}
  } catch {
    return {}
  }
}

const writeCache = (providerId: string, cache: LinkCache): void => {
  try {
    const live = Object.entries(cache)
      .filter(([, link]) => Date.parse(link.expiresAt) > Date.now())
      .slice(-MAX_REMEMBERED)
    localStorage.setItem(cacheKey(providerId), JSON.stringify(Object.fromEntries(live)))
  } catch {
    /* เครื่องที่เขียนไม่ได้แค่ทำให้รอบหน้าออกลิงก์ใหม่ ไม่ทำให้ส่งไม่ได้ */
  }
}

/**
 * ลายนิ้วมือของ "ใบนี้ที่ตัวเลขชุดนี้" — ตั้งใจไม่รวม asOf
 *
 * asOf คือวันที่เครื่อง ถ้ารวมเข้าไป การส่งใบเดิมที่ยอดไม่เปลี่ยนในวันถัดมาจะได้ลิงก์ใหม่ทุกวัน
 * แล้วครูจะมีลิงก์เป็นสิบใบของบิลใบเดียวให้ไล่ปิดทีละใบ · เผยแพร่ใหม่ต่อเมื่อตัวเลขเปลี่ยนจริง
 */
const financialShape = (doc: SharedDocument): string => JSON.stringify([
  doc.v, doc.kind, doc.provider, doc.destination, doc.payer, doc.subject, doc.period,
  doc.lines.map(line => [line.description, line.qty, line.unitPrice, line.amount]),
  doc.total, doc.paid, doc.dueAt ?? null, doc.number ?? null,
])

async function documentFingerprint(doc: SharedDocument): Promise<string> {
  const bytes = new TextEncoder().encode(financialShape(doc))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * `null` และ `no-link` เท่านั้นที่ปลอดภัยจะส่งโดยไม่ต้องเตือนอะไร
 * `not-configured` และ `demo` ส่งได้แต่ต้องบอกว่าลิงก์นี้กำหนดวันหมดอายุหรือปิดไม่ได้
 * `signed-out`, `failed`, `stale` ต้องหยุด ห้ามส่งลิงก์ที่ครูเข้าใจว่าปิดได้แต่จริง ๆ ปิดไม่ได้
 */
/** `unsupported` = ฐานหลังบ้านยังไม่ได้ migrate ให้มีตารางลิงก์ — เครื่องครูใหม่กว่าฐานได้เสมอตอน deploy */
export type PublishSkip = 'no-link' | 'demo' | 'not-configured' | 'signed-out' | 'unsupported' | 'stale' | 'failed' | 'stale'

export interface SecureDraftResult {
  draft: string
  links: SharedLink[]
  /** null = ลิงก์เอกสารทุกอันในข้อความนี้เผยแพร่แล้ว ยังไม่หมดอายุ และยังไม่ถูกเพิกถอน */
  skipped: PublishSkip | null
}

/**
 * หยุดส่งเฉพาะเมื่อครูมีสิทธิ์ออกลิงก์ที่ปิดได้อยู่แล้ว แต่รอบนี้ทำไม่สำเร็จ
 *
 * `demo`, `not-configured`, `signed-out` และ `unsupported` ไม่อยู่ในนี้ เพราะทั้งสี่แบบ
 * ออกลิงก์ที่ปิดได้ไม่ได้ตั้งแต่ต้น การหยุดส่งจึงไม่ได้ปกป้องอะไร มีแต่ทำให้ครูส่งบิลไม่ได้เลย
 * โดยเฉพาะครูที่ใช้จริงแบบไม่สมัครบัญชี ซึ่งเป็นเส้นทางที่แอปรองรับมาตลอด
 * หน้าจอต้องประกาศข้อจำกัดไว้ก่อนกดส่ง — ไม่ใช่เงียบแล้วลดระดับให้ และไม่ใช่ปิดทางส่ง
 */
export const publishBlocks = (skipped: PublishSkip | null): boolean =>
  skipped === 'failed' || skipped === 'stale'

const tokensIn = (draft: string): { legacy: string[]; secure: string[] } => {
  const legacy = new Set<string>()
  const secure = new Set<string>()
  for (const match of draft.matchAll(DOCUMENT_LINK)) {
    if (match[1].includes('.')) secure.add(match[1].split('.')[0])
    else legacy.add(match[1])
  }
  return { legacy: [...legacy], secure: [...secure] }
}

/** ผู้เรียกใช้ตัดสินใจล่วงหน้าว่าจะต้องรอเครือข่ายไหม เช่นจองหน้าต่างก่อน await */
export const hasDocumentLink = (draft: string): boolean => {
  const { legacy, secure } = tokensIn(draft)
  return legacy.length > 0 || secure.length > 0
}

/**
 * แทนลิงก์เอกสารทุกอันในข้อความด้วยลิงก์ที่เพิกถอนได้
 *
 * เอกสารมาจากตัวลิงก์เอง ไม่ใช่จาก meta ของข้อความ — ร่างที่ครูแก้เอง คำตอบ FAQ และใบเสร็จ
 * จึงได้ลิงก์ใหม่เหมือนกันหมด และไม่มีทางเผยแพร่เอกสารที่ไม่ได้อยู่ในข้อความอยู่แล้ว
 */
export async function secureDraft(state: AppState, draft: string): Promise<SecureDraftResult> {
  const { legacy, secure } = tokensIn(draft)
  if (!legacy.length && !secure.length) return { draft, links: [], skipped: 'no-link' }
  if (state.mode !== 'real') return { draft, links: [], skipped: 'demo' }
  // บิลด์ที่ไม่มีโปรเจกต์ยังส่งลิงก์รุ่นเดิมได้ตามเดิม แต่หน้าจอต้องบอกว่าลิงก์นั้นปิดไม่ได้
  if (!getSupabaseConfig()) return { draft, links: [], skipped: 'not-configured' }

  try {
    const session = getSession()
    if (!session) return { draft, links: [], skipped: 'signed-out' }
    const providerId = session.user.id

    // ลิงก์ที่เผยแพร่ไปแล้วในร่างนี้อาจถูกครูปิดไปจากอีกเครื่อง — ส่งซ้ำต้องไม่ส่งลิงก์ที่ตายแล้ว
    for (const token of secure) {
      const liveness = await sharedDocumentLiveness(token)
      if (liveness === 'dead') return { draft, links: [], skipped: 'stale' }
      if (liveness === 'unknown') return { draft, links: [], skipped: 'failed' }
    }
    if (!legacy.length) return { draft, links: [], skipped: null }

    const cache = readCache(providerId)
    const cloudKey = await loadKey(providerId)
    const links: SharedLink[] = []
    let text = draft

    for (const token of legacy) {
      const doc = readDocument(token)
      if (!doc) return { draft, links: [], skipped: 'failed' }
      const fingerprint = await documentFingerprint(doc)
      // ใช้ซ้ำเฉพาะใบที่ยังมีชีวิต — เพดานเวลาในเครื่องอย่างเดียวไม่รู้ว่าครูปิดไปจากอีกเครื่องแล้ว
      let link: SharedLink | undefined = cache[fingerprint]
      if (link && (Date.parse(link.expiresAt) <= Date.now() || await sharedDocumentLiveness(link.token) !== 'live')) {
        delete cache[fingerprint]
        link = undefined
      }
      if (!link) {
        const key = await generateDocumentKey()
        const sealed = await sealDocument(key, doc)
        const label = cloudKey ? await sealLabel(cloudKey, documentLabel(doc)) : undefined
        const published = await publishSharedDocument({
          kind: doc.kind, cipher: sealed.cipher, iv: sealed.iv,
          expiresAt: shareExpiryFrom(new Date()),
          ...(label ? { label: { cipher: label.cipher, iv: label.iv } } : {}),
        })
        link = { token: published.token, key: await exportUrlKey(key), expiresAt: published.expiresAt }
        cache[fingerprint] = link
      }
      links.push(link)
      text = text.split(`#/document/${token}`).join(`#/document/${link.token}.${link.key}`)
    }

    writeCache(providerId, cache)
    return { draft: text, links, skipped: null }
  } catch (error) {
    // ฐานยังไม่มีคำสั่งนี้ (ยังไม่ได้ apply migration) — ออกลิงก์ที่ปิดได้ไม่ได้ทั้งระบบ
    // ต่างจาก "ล้มเหลว" ตรงที่ลองใหม่กี่ครั้งก็ไม่ผ่าน การหยุดส่งจึงแปลว่าครูส่งบิลไม่ได้เลย
    if (error instanceof SupabaseRestError && error.status === 404) {
      return { draft, links: [], skipped: 'unsupported' }
    }
    // เครือข่ายล่ม เซสชันหมดอายุ หรือฐานปฏิเสธ — คืนข้อความเดิมทั้งดุ้น ไม่ส่งข้อความที่ลิงก์พัง
    return { draft, links: [], skipped: 'failed' }
  }
}

/** ลิงก์ที่เครื่องนี้เคยออกให้ — ใช้เปิดดูหรือคัดลอกซ้ำจากรายการที่ครูแชร์ไว้ */
export function rememberedLink(providerId: string, token: string): string | null {
  const link = Object.values(readCache(providerId)).find(entry => entry.token === token)
  return link ? documentLinkFor(link.token, link.key) : null
}

export function forgetLink(providerId: string, token: string): void {
  const cache = readCache(providerId)
  for (const [fingerprint, link] of Object.entries(cache)) {
    if (link.token === token) delete cache[fingerprint]
  }
  writeCache(providerId, cache)
}
