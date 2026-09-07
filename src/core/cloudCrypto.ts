/**
 * เข้ารหัสสมุดบัญชีก่อนขึ้นคลาวด์ — กุญแจมาจากรหัสผ่านครูบนเครื่องครู
 * เซิร์ฟเวอร์เห็นแต่ ciphertext จึงอ่านชื่อนักเรียนหรือยอดเงินไม่ได้ และเราก็กู้ให้ไม่ได้ถ้าครูลืมรหัส
 * ใช้ WebCrypto ล้วน ไม่มีไลบรารี · PBKDF2-SHA256 → AES-GCM-256
 */
export const KDF_ID = 'pbkdf2-sha256-310000'
const ITERATIONS = 310_000

const enc = new TextEncoder()
const dec = new TextDecoder()

const toB64 = (bytes: ArrayBuffer | Uint8Array): string => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < view.length; i += 0x8000) s += String.fromCharCode(...view.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

/** salt = user id ของ Supabase — ไม่ซ้ำกันต่อครู และมีอยู่แล้วทั้งสองฝั่ง ไม่ต้องเก็บเพิ่ม */
export async function deriveKey(password: string, salt: string): Promise<CryptoKey> {
  if (!password || !salt) throw new Error('deriveKey: missing input')
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`solo-tutor:${salt}`), iterations: ITERATIONS },
    base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
  )
}

export const exportKey = async (key: CryptoKey): Promise<string> => toB64(await crypto.subtle.exportKey('raw', key))
export const importKey = (raw: string): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', fromB64(raw), { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])

export interface Sealed { iv: string; cipher: string }

export async function seal(key: CryptoKey, text: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text))
  return { iv: toB64(iv), cipher: toB64(cipher) }
}

/** คืน null เมื่อกุญแจผิดหรือข้อมูลถูกแก้ — AES-GCM ตรวจความถูกต้องให้ ไม่ต้อง MAC แยก */
export async function open(key: CryptoKey, sealed: Sealed): Promise<string | null> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) }, key, fromB64(sealed.cipher))
    return dec.decode(plain)
  } catch {
    return null
  }
}
