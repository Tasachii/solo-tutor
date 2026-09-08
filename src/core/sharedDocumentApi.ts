/**
 * คุยกับตาราง shared_documents — ครูเขียนในฐานะบัญชีที่เข้าสู่ระบบ ผู้ปกครองอ่านแบบไม่มีบัญชี
 *
 * สิ่งที่ออกจากเครื่องครูมีแค่ ciphertext, iv, ชนิดเอกสาร และวันหมดอายุ
 * กุญแจอยู่หลัง # ของลิงก์เท่านั้น จึงไม่เคยอยู่ในคำขอใดของไฟล์นี้
 */
import { getSupabaseConfig, request, rpc } from '../integrations/supabaseRest'

const READ_TIMEOUT_MS = 12_000

export interface SharedDocumentRow {
  token: string
  kind: 'invoice' | 'receipt'
  label: string | null
  label_iv: string | null
  created_at: string
  expires_at: string
  revoked_at: string | null
}

export interface PublishInput {
  kind: 'invoice' | 'receipt'
  cipher: string
  iv: string
  expiresAt: string
  label?: { cipher: string; iv: string }
}

export interface PublishedDocument { token: string; expiresAt: string }

export async function publishSharedDocument(input: PublishInput): Promise<PublishedDocument> {
  const rows = await rpc<{ token?: unknown; expires_at?: unknown }[]>('publish_shared_document', {
    p_kind: input.kind,
    p_cipher: input.cipher,
    p_iv: input.iv,
    p_expires_at: input.expiresAt,
    p_label: input.label?.cipher ?? null,
    p_label_iv: input.label?.iv ?? null,
  })
  const row = Array.isArray(rows) ? rows[0] : undefined
  if (!row || typeof row.token !== 'string' || typeof row.expires_at !== 'string') {
    throw new Error('publish_shared_document: bad response')
  }
  return { token: row.token, expiresAt: row.expires_at }
}

const isRow = (value: unknown): value is SharedDocumentRow => {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<SharedDocumentRow>
  return typeof row.token === 'string' && (row.kind === 'invoice' || row.kind === 'receipt')
    && typeof row.created_at === 'string' && typeof row.expires_at === 'string'
    && (row.label === null || typeof row.label === 'string')
    && (row.label_iv === null || typeof row.label_iv === 'string')
    && (row.revoked_at === null || typeof row.revoked_at === 'string')
}

/** RLS คัดให้เหลือเฉพาะของครูคนนี้ จึงไม่ต้องส่ง provider_id และเดา id ของครูคนอื่นไม่ได้ */
export async function listSharedDocuments(signal?: AbortSignal): Promise<SharedDocumentRow[]> {
  const rows = await request<unknown[]>(
    '/rest/v1/shared_documents?select=token,kind,label,label_iv,created_at,expires_at,revoked_at'
    + '&order=created_at.desc&limit=200',
    { signal },
  )
  return Array.isArray(rows) ? rows.filter(isRow) : []
}

export type LinkLiveness = 'live' | 'dead' | 'unknown'

/**
 * ลิงก์ใบนี้ยังเปิดได้อยู่ไหม ถามในฐานะครูเจ้าของ — ใช้ก่อนส่งซ้ำ
 * ครูอาจกดปิดจากอีกเครื่อง เพดานวันหมดอายุที่จำไว้ในเครื่องนี้จึงไม่พอ
 * 'unknown' คือถามไม่สำเร็จ ผู้เรียกต้องถือว่าล้ม ไม่ใช่ถือว่ายังใช้ได้
 */
export async function sharedDocumentLiveness(token: string, signal?: AbortSignal): Promise<LinkLiveness> {
  try {
    const rows = await request<unknown[]>(
      `/rest/v1/shared_documents?token=eq.${encodeURIComponent(token)}&select=token,expires_at,revoked_at&limit=1`,
      { signal },
    )
    const row = Array.isArray(rows) ? rows[0] : undefined
    if (!row || typeof row !== 'object') return 'dead'
    const found = row as { expires_at?: unknown; revoked_at?: unknown }
    if (found.revoked_at) return 'dead'
    if (typeof found.expires_at !== 'string' || Date.parse(found.expires_at) <= Date.now()) return 'dead'
    return 'live'
  } catch {
    return 'unknown'
  }
}

/** คืน false เมื่อไม่มีอะไรเปลี่ยน — ใบนั้นถูกเพิกถอนไปแล้ว หรือไม่ใช่ของครูคนนี้ */
export const revokeSharedDocument = (token: string, signal?: AbortSignal): Promise<boolean> =>
  rpc<boolean>('revoke_shared_document', { p_token: token }, signal)

export interface SealedDocumentRow { kind: 'invoice' | 'receipt'; cipher: string; iv: string; expiresAt: string }
export type ResolveResult =
  | { status: 'ok'; row: SealedDocumentRow }
  /** ไม่มี ถูกเพิกถอน หรือหมดอายุ — แยกไม่ได้โดยตั้งใจ ไม่บอกคนนอกว่า token ไหนเคยมีอยู่ */
  | { status: 'gone' }
  | { status: 'unavailable' }
  | { status: 'offline' }

/**
 * อ่านด้วยกุญแจสาธารณะของโปรเจกต์ ไม่มี Authorization — ผู้ปกครองไม่มีบัญชีและไม่ต้องมี
 * ฐานข้อมูลเป็นผู้ตัดสินว่ายังจ่ายให้ได้ไหม ฝั่งนี้ไม่มีทางข้ามเงื่อนไขหมดอายุหรือเพิกถอน
 */
export async function resolveSharedDocument(token: string, signal?: AbortSignal): Promise<ResolveResult> {
  const config = getSupabaseConfig()
  if (!config) return { status: 'unavailable' }
  let response: Response
  try {
    response = await fetch(`${config.url}/rest/v1/rpc/read_shared_document`, {
      method: 'POST',
      headers: { apikey: config.publishableKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ p_token: token }),
      signal: signal ?? AbortSignal.timeout(READ_TIMEOUT_MS),
    })
  } catch {
    return { status: 'offline' }
  }
  if (response.status === 404 || response.status === 400) return { status: 'gone' }
  if (!response.ok) return { status: 'offline' }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { status: 'offline' }
  }
  const row = Array.isArray(body) ? body[0] : undefined
  if (!row || typeof row !== 'object') return { status: 'gone' }
  const candidate = row as { kind?: unknown; cipher?: unknown; iv?: unknown; expires_at?: unknown }
  if ((candidate.kind !== 'invoice' && candidate.kind !== 'receipt')
    || typeof candidate.cipher !== 'string' || typeof candidate.iv !== 'string'
    || typeof candidate.expires_at !== 'string') return { status: 'gone' }
  return {
    status: 'ok',
    row: { kind: candidate.kind, cipher: candidate.cipher, iv: candidate.iv, expiresAt: candidate.expires_at },
  }
}
