import { deriveKey, exportKey, importKey } from './cloudCrypto'

/**
 * กุญแจเข้ารหัสอยู่ในเครื่องเดียวกับ ledger ที่ยังไม่เข้ารหัส — ไม่ได้ลดความปลอดภัยของเครื่องลง
 * แต่ทำให้เซิร์ฟเวอร์ไม่มีทางอ่านข้อมูล · แยกตาม user id เพราะเครื่องเดียวอาจสลับบัญชี
 */
const PREFIX = 'solo-tutor:cloud-key:'

export async function rememberKeyFromPassword(userId: string, password: string): Promise<CryptoKey> {
  const key = await deriveKey(password, userId)
  try { localStorage.setItem(`${PREFIX}${userId}`, await exportKey(key)) } catch { /* ใช้ได้ในรอบนี้ รอบหน้าขอรหัสใหม่ */ }
  return key
}

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
