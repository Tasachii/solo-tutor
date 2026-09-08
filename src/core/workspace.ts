import type { AppState } from './types'
import { migrateCanonical } from './migrations'

/**
 * เดโมกับสมุดบัญชีจริงต้องอยู่คนละช่อง
 *
 * เดิมมีช่องเดียว (`solo-demo-v3`) เก็บ workspace ที่กำลังใช้อยู่ ใครเข้าโหมดไหนก็ทับกัน:
 * "เริ่มใช้จริง" ลบเดโมทิ้ง และ "กลับไปโหมดเดโม" เขียนทับสมุดบัญชีจริงของครู
 * ตอนนี้แต่ละโหมดมีช่องของตัวเอง มี pointer บอกว่าแท็บใหม่ควรเปิดโหมดไหน
 * และมี lock คนละดอก สองแท็บคนละโหมดจึงเขียนพร้อมกันได้โดยไม่ชนกัน
 *
 * เดโมยังใช้คีย์เดิม — เครื่องที่มีแต่เดโม (คนส่วนใหญ่) จึงไม่ต้องย้ายอะไรเลย
 * มีแต่เครื่องที่อยู่โหมดจริงเท่านั้นที่ต้องย้ายข้อมูลออกไปช่องของตัวเอง
 */
export type WorkspaceMode = 'demo' | 'real'

/** ก่อนแยกช่อง คีย์นี้เก็บ workspace ที่ active อยู่ ไม่ว่าโหมดไหน — ตอนนี้เป็นช่องเดโมล้วน */
export const DEMO_SLOT_KEY = 'solo-demo-v3'
export const REAL_SLOT_KEY = 'solo-real-v3'
/** สำเนาที่ย้ายไม่สำเร็จ ต้องไม่ถูกทับ เก็บไว้ให้กู้ด้วยมือ */
export const LEGACY_RESCUE_KEY = `${REAL_SLOT_KEY}-legacy`
export const ACTIVE_MODE_KEY = 'solo-tutor:workspace'

export const WORKSPACE_MODES: readonly WorkspaceMode[] = ['demo', 'real']

export const slotKey = (mode: WorkspaceMode): string => (mode === 'real' ? REAL_SLOT_KEY : DEMO_SLOT_KEY)
/** สำเนาก่อนเขียนทับของช่องนั้น ๆ — ช่องละใบ ไม่ปนกันข้ามโหมด */
export const parkedKey = (mode: WorkspaceMode): string => `${slotKey(mode)}-before-restore`
/** ล็อกคนละดอกต่อช่อง — แท็บเดโมกับแท็บใช้จริงเป็นผู้เขียนพร้อมกันได้ */
export const writerLockName = (mode: WorkspaceMode): string => `${slotKey(mode)}:writer`

export const isWorkspaceMode = (v: unknown): v is WorkspaceMode => v === 'demo' || v === 'real'

const read = (key: string): string | null => {
  try { return localStorage.getItem(key) } catch { return null }
}
const parse = (raw: string | null): AppState | null => {
  if (raw === null) return null
  try { return migrateCanonical(JSON.parse(raw)) } catch { return null }
}

export function readActiveMode(): WorkspaceMode | null {
  const raw = read(ACTIVE_MODE_KEY)
  return isWorkspaceMode(raw) ? raw : null
}

export function writeActiveMode(mode: WorkspaceMode): boolean {
  try { localStorage.setItem(ACTIVE_MODE_KEY, mode); return true } catch { return false }
}

/** ช่องนั้นมี workspace ของโหมดนั้นจริงไหม — ของโหมดอื่นที่หลงมาไม่นับ */
export function readSlot(mode: WorkspaceMode): { raw: string; state: AppState } | null {
  const raw = read(slotKey(mode))
  const state = parse(raw)
  return raw !== null && state && state.mode === mode ? { raw, state } : null
}

/**
 * สมุดบัญชีจริงที่นอนอยู่ในช่องเดโม ต้องถูกย้ายออกก่อนที่เดโมรอบหน้าจะเขียนทับ
 *
 * เกิดได้สองแบบ: เครื่องก่อนแยกช่องที่ค้างอยู่โหมดจริง หรือการย้ายรอบก่อนที่ทำไม่จบ
 * ลำดับสำคัญ — คัดลอกก่อน · ตรวจว่าลงจริง · แล้วค่อยลบของเดิม
 * ทางที่ล้มเหลวทุกทางจบที่ "ข้อมูลยังอยู่ที่ใดที่หนึ่ง" ไม่ใช่ "หายไปแล้ว"
 * และตราบใดที่ยังย้ายไม่สำเร็จ เครื่องนี้ยังถือว่าอยู่โหมดจริง เดโมจึงไม่มีสิทธิ์เขียนทับ
 */
function rescueRealLedgerFromDemoSlot(): boolean {
  const raw = read(DEMO_SLOT_KEY)
  // เลี่ยง parse ทั้งก้อนในเส้นทางปกติ — เดโมล้วนไม่มีคำนี้ ถ้าเจอค่อยตรวจของจริง
  if (raw === null || !raw.includes('"mode":"real"')) return false
  const saved = parse(raw)
  if (!saved || saved.mode !== 'real') return false

  const target = read(REAL_SLOT_KEY) === null ? REAL_SLOT_KEY : LEGACY_RESCUE_KEY
  try { localStorage.setItem(target, raw) } catch { return true }
  if (read(target) !== raw) return true
  try { localStorage.removeItem(DEMO_SLOT_KEY) } catch { /* ช่องเดโมกันของโหมดอื่นอยู่แล้ว */ }
  writeActiveMode('real')
  return true
}

/**
 * เครื่องนี้ควรเปิด workspace ไหน — และย้ายข้อมูลของเครื่องที่ยังใช้คีย์เดียวมาช่องที่ถูก
 * pointer เป็นแค่ "แท็บใหม่ควรเปิดโหมดไหน" ไม่ใช่กรรมสิทธิ์ของข้อมูล
 */
export function resolveActiveMode(): WorkspaceMode {
  if (rescueRealLedgerFromDemoSlot()) return 'real'
  const pinned = readActiveMode()
  if (pinned) return pinned
  const mode: WorkspaceMode = readSlot('real') ? 'real' : 'demo'
  writeActiveMode(mode)
  return mode
}
