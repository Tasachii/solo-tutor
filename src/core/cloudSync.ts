import type { AppState } from './types'
import { fromBackup, toBackup, type RestoreResult } from './backup'
import { open, seal, type Sealed } from './cloudCrypto'
import { KDF_ID } from './cloudCrypto'

/**
 * ซิงก์สมุดบัญชีทั้งก้อนขึ้นคลาวด์เป็น snapshot เดียวต่อครู
 * ไม่ merge ทีละแถว — ledger ต้องเป็นก้อนเดียวที่ validate ผ่านเสมอ (เหมือนไฟล์สำรอง)
 * เครื่องไหนแก้ล่าสุดชนะ แต่ถ้าสองเครื่องแก้พร้อมกันต้องถามครู ไม่เดา
 */

export const SYNC_META_KEY = 'solo-cloud-sync'
export const PRE_PULL_BACKUP_KEY = 'solo-cloud-pre-pull-backup'

/** สิ่งที่เครื่องนี้รู้เกี่ยวกับรอบซิงก์ล่าสุด — อยู่นอก AppState เพราะเป็นเรื่องของเครื่อง ไม่ใช่ของบัญชี */
export interface SyncMeta {
  providerId: string
  /** revision บนคลาวด์ที่เครื่องนี้เห็นล่าสุด */
  cloudRevision: number
  /** ลายนิ้วมือของสมุดบัญชีเครื่องนี้ ณ ตอนซิงก์ล่าสุด (ไม่ใช่ state.revision — ดู ledgerFingerprint) */
  localFingerprint: string
  at: string
}

/**
 * "เปลี่ยน" ต้องแปลว่าสมุดบัญชีเปลี่ยน ไม่ใช่ state.revision ขยับ — track('app_open') ทุกครั้งที่เปิดแอป
 * ก็ commit revision ใหม่ ถ้าใช้ revision สองเครื่องจะชนกันทุกครั้งที่อีกเครื่องแค่เปิดดู
 * จึง hash เฉพาะตารางที่มีความหมาย ตัด events / today / revision / คิวส่ง ออก
 */
export function ledgerFingerprint(s: AppState): string {
  const pick = {
    mode: s.mode, professionId: s.professionId, provider: s.provider, style: s.style ?? null, onboarded: s.onboarded,
    clients: s.clients, subjects: s.subjects, units: s.units, completions: s.completions, invoices: s.invoices,
    payments: s.payments, receipts: s.receipts, messages: s.messages, chats: s.chats, counters: s.counters,
    lastBackupAt: s.lastBackupAt ?? null, lineWorkspaceId: s.lineWorkspaceId ?? null, lineProviderId: s.lineProviderId ?? null,
  }
  const text = JSON.stringify(pick)
  // FNV-1a 32 บิต สองรอบด้วย seed ต่างกัน — พอสำหรับ "เท่ากันไหม" ไม่ใช่ความปลอดภัย
  let a = 0x811c9dc5, b = 0x9747b28c
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x01000193) >>> 0
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}:${text.length}`
}

export interface CloudSnapshot {
  revision: number
  schema_version: number
  cipher: string
  iv: string
  updated_at: string
  device: string | null
  /** Missing only on snapshots written before the KDF column was returned to clients. */
  kdf?: string
}

export type SyncDecision = 'push' | 'pull' | 'conflict' | 'idle'

/**
 * ตัดสินว่าจะทำอะไร — ฟังก์ชันล้วน ทดสอบได้ทุกช่อง
 * - ไม่มีอะไรบนคลาวด์ → push
 * - เครื่องนี้ไม่เคยซิงก์ (หรือคนละบัญชี): เครื่องเปล่า → pull · เครื่องมีข้อมูล → conflict ให้ครูเลือก
 * - เคยซิงก์: เปลี่ยนฝั่งเดียว → ตามฝั่งนั้น · เปลี่ยนทั้งสอง → conflict · ไม่เปลี่ยน → idle
 */
export function decideSync(
  local: { fingerprint: string; hasData: boolean },
  meta: SyncMeta | null,
  cloud: { revision: number } | null,
  providerId: string,
): SyncDecision {
  if (!cloud) return 'push'
  const known = meta && meta.providerId === providerId ? meta : null
  if (!known) return local.hasData ? 'conflict' : 'pull'
  const localChanged = local.fingerprint !== known.localFingerprint
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
      || typeof m.localFingerprint !== 'string' || typeof m.at !== 'string') return null
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

/** Last local ledger before a cloud pull. It is deliberately separate from the live storage key. */
export function writePrePullBackup(state: AppState, at: string): boolean {
  try {
    localStorage.setItem(PRE_PULL_BACKUP_KEY, toBackup(state, at))
    return true
  } catch {
    return false
  }
}

/** Clear account-linked browser artifacts while preserving unrelated storage and UI preferences. */
export function clearAccountLocalArtifacts(
  persistent: Pick<Storage, 'removeItem'> = localStorage,
  temporary: Pick<Storage, 'removeItem'> = sessionStorage,
): void {
  for (const key of [PRE_PULL_BACKUP_KEY, 'solo-demo-v3-before-restore', 'solo-sheets', 'solo-usage-id']) {
    try { persistent.removeItem(key) } catch { /* best effort after confirmed server deletion */ }
  }
  try { temporary.removeItem('solo-tutor:requested-plan') } catch { /* best effort */ }
}

/** ห่อ state เป็นไฟล์สำรองแล้วเข้ารหัส — ใช้ format เดียวกับไฟล์ที่ครูดาวน์โหลด จึง validate ด้วยตัวเดียวกัน */
export async function packSnapshot(state: AppState, key: CryptoKey, at: string): Promise<Sealed> {
  return seal(key, toBackup(state, at))
}

export type UnpackResult = RestoreResult | { ok: false; reason: 'locked' | 'unsupportedKdf' }

/** ถอดแล้ว validate ทุกครั้ง — ciphertext ที่ถอดได้แต่ข้างในพัง ต้องไม่ทับข้อมูลในเครื่อง */
export async function unpackSnapshot(snapshot: Sealed & { kdf?: string }, key: CryptoKey, schema: number): Promise<UnpackResult> {
  if ('kdf' in snapshot && snapshot.kdf !== undefined && snapshot.kdf !== KDF_ID) {
    return { ok: false, reason: 'unsupportedKdf' }
  }
  const text = await open(key, snapshot)
  if (text === null) return { ok: false, reason: 'locked' }
  return fromBackup(text, schema)
}
