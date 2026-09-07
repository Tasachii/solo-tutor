import type { AppState } from './types'
import { fromBackup, toBackup, type RestoreResult } from './backup'
import { open, seal, type Sealed } from './cloudCrypto'

/**
 * ซิงก์สมุดบัญชีทั้งก้อนขึ้นคลาวด์เป็น snapshot เดียวต่อครู
 * ไม่ merge ทีละแถว — ledger ต้องเป็นก้อนเดียวที่ validate ผ่านเสมอ (เหมือนไฟล์สำรอง)
 * เครื่องไหนแก้ล่าสุดชนะ แต่ถ้าสองเครื่องแก้พร้อมกันต้องถามครู ไม่เดา
 */

export const SYNC_META_KEY = 'solo-cloud-sync'

/** สิ่งที่เครื่องนี้รู้เกี่ยวกับรอบซิงก์ล่าสุด — อยู่นอก AppState เพราะเป็นเรื่องของเครื่อง ไม่ใช่ของบัญชี */
export interface SyncMeta {
  providerId: string
  /** revision บนคลาวด์ที่เครื่องนี้เห็นล่าสุด */
  cloudRevision: number
  /** state.revision ของเครื่องนี้ ณ ตอนซิงก์ล่าสุด */
  localRevision: number
  at: string
}

export interface CloudSnapshot {
  revision: number
  schema_version: number
  cipher: string
  iv: string
  updated_at: string
  device: string | null
}

export type SyncDecision = 'push' | 'pull' | 'conflict' | 'idle'

/**
 * ตัดสินว่าจะทำอะไร — ฟังก์ชันล้วน ทดสอบได้ทุกช่อง
 * - ไม่มีอะไรบนคลาวด์ → push
 * - เครื่องนี้ไม่เคยซิงก์ (หรือคนละบัญชี): เครื่องเปล่า → pull · เครื่องมีข้อมูล → conflict ให้ครูเลือก
 * - เคยซิงก์: เปลี่ยนฝั่งเดียว → ตามฝั่งนั้น · เปลี่ยนทั้งสอง → conflict · ไม่เปลี่ยน → idle
 */
export function decideSync(
  local: { revision: number; hasData: boolean },
  meta: SyncMeta | null,
  cloud: { revision: number } | null,
  providerId: string,
): SyncDecision {
  if (!cloud) return 'push'
  const known = meta && meta.providerId === providerId ? meta : null
  if (!known) return local.hasData ? 'conflict' : 'pull'
  const localChanged = local.revision !== known.localRevision
  const cloudChanged = cloud.revision !== known.cloudRevision
  if (localChanged && cloudChanged) return 'conflict'
  if (localChanged) return 'push'
  if (cloudChanged) return 'pull'
  return 'idle'
}

/** มีข้อมูลจริงที่เสียแล้วเสียดายไหม — เครื่องที่เพิ่งเริ่มใช้จริงยังไม่มีอะไร ดึงจากคลาวด์ได้เลย */
export const hasLedgerData = (s: AppState): boolean =>
  s.subjects.length > 0 || s.completions.length > 0 || s.invoices.length > 0

export const readSyncMeta = (): SyncMeta | null => {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY)
    if (!raw) return null
    const m = JSON.parse(raw) as Partial<SyncMeta>
    if (typeof m.providerId !== 'string' || typeof m.cloudRevision !== 'number'
      || typeof m.localRevision !== 'number' || typeof m.at !== 'string') return null
    return m as SyncMeta
  } catch {
    return null
  }
}
export const writeSyncMeta = (m: SyncMeta | null): void => {
  try {
    if (m) localStorage.setItem(SYNC_META_KEY, JSON.stringify(m))
    else localStorage.removeItem(SYNC_META_KEY)
  } catch { /* ไม่มีที่เก็บ = รอบหน้าถามใหม่ ปลอดภัยกว่าเดาว่าซิงก์แล้ว */ }
}

/** ห่อ state เป็นไฟล์สำรองแล้วเข้ารหัส — ใช้ format เดียวกับไฟล์ที่ครูดาวน์โหลด จึง validate ด้วยตัวเดียวกัน */
export async function packSnapshot(state: AppState, key: CryptoKey, at: string): Promise<Sealed> {
  return seal(key, toBackup(state, at))
}

export type UnpackResult = RestoreResult | { ok: false; reason: 'locked' }

/** ถอดแล้ว validate ทุกครั้ง — ciphertext ที่ถอดได้แต่ข้างในพัง ต้องไม่ทับข้อมูลในเครื่อง */
export async function unpackSnapshot(snapshot: Sealed, key: CryptoKey, schema: number): Promise<UnpackResult> {
  const text = await open(key, snapshot)
  if (text === null) return { ok: false, reason: 'locked' }
  return fromBackup(text, schema)
}
