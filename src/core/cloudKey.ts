import { deriveKey, exportKey, importKey } from './cloudCrypto'

/**
 * กุญแจเข้ารหัสอยู่ในเครื่องเดียวกับ ledger ที่ยังไม่เข้ารหัส — ไม่ได้ลดความปลอดภัยของเครื่องลง
 * แต่ทำให้เซิร์ฟเวอร์ไม่มีทางอ่านข้อมูล · แยกตาม user id เพราะเครื่องเดียวอาจสลับบัญชี
 */
const PREFIX = 'solo-tutor:cloud-key:'
const RECOVERY_FORMAT = 'solo-tutor-recovery-1'

export async function rememberKeyFromPassword(userId: string, password: string): Promise<CryptoKey> {
  const existing = await loadKey(userId)
  if (existing) return existing
  const key = await deriveKey(password, userId)
  await rememberKey(userId, key)
  return key
}

/** Persist only a key that has already been verified against this account's snapshot. */
export async function rememberKey(userId: string, key: CryptoKey): Promise<void> {
  try { localStorage.setItem(`${PREFIX}${userId}`, await exportKey(key)) } catch { /* ใช้ได้ในรอบนี้ รอบหน้าขอรหัสใหม่ */ }
}

export const keyFromPassword = (userId: string, password: string): Promise<CryptoKey> => deriveKey(password, userId)

export async function loadKey(userId: string): Promise<CryptoKey | null> {
  try {
    const raw = localStorage.getItem(`${PREFIX}${userId}`)
    return raw ? await importKey(raw) : null
  } catch {
    return null
  }
}

export function forgetKeys(): void {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k))
  } catch { /* ไม่มีที่เก็บก็ไม่มีอะไรให้ลืม */ }
}

export function forgetKey(userId: string): void {
  try { localStorage.removeItem(`${PREFIX}${userId}`) } catch { /* ไม่มีที่เก็บก็ไม่มีอะไรให้ลืม */ }
}

export async function exportRecoveryKey(userId: string, key: CryptoKey): Promise<string> {
  return JSON.stringify({ format: RECOVERY_FORMAT, userId, key: await exportKey(key) })
}

export async function importRecoveryKey(userId: string, text: string): Promise<CryptoKey | null> {
  try {
    const parsed = JSON.parse(text) as { format?: unknown; userId?: unknown; key?: unknown }
    if (parsed.format !== RECOVERY_FORMAT || parsed.userId !== userId || typeof parsed.key !== 'string') return null
    return await importKey(parsed.key)
  } catch {
    return null
  }
}
