import { normalizePaymentDestination, isPaymentDestination } from '../core/paymentDestination'

const envValue = (name: string): string => {
  const value = (import.meta.env as Record<string, unknown>)[name]
  return typeof value === 'string' ? value.trim() : ''
}

export const validSupportContact = (raw: string): string => {
  const value = raw.trim()
  if (!value || value.length > 200 || /(?:example|todo|xxx)/i.test(value)) return ''
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return value
  if (/^@[A-Za-z0-9._-]{3,33}$/.test(value)) return value
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : ''
  } catch { return '' }
}

export const validLegalName = (raw: string): string => {
  const value = raw.trim().replace(/\s+/g, ' ')
  return value.length >= 2 && value.length <= 160 && !/(?:example|todo|xxx)/i.test(value) ? value : ''
}

export const validSoloPromptPay = (raw: string): string => {
  const normalized = normalizePaymentDestination(raw)
  return normalized && isPaymentDestination(normalized) ? normalized : ''
}

// ค่าตัวอย่างสำหรับข้อมูลเดโมเท่านั้น
export const LEGACY_TOKEN_FILE = '' // ว่าง = ใช้ token ใน index.css (spec ข้อ 10)
export const PROVIDER_NAME = 'ครูพี่หยก'
export const PROMPTPAY_DISPLAY = '08x-xxx-xxxx'
/** ค่าธุรกิจจริงมาจาก environment และ fail closed เมื่อไม่ครบหรือรูปแบบไม่ถูกต้อง */
export const SUPPORT_CONTACT = validSupportContact(envValue('VITE_SUPPORT_CONTACT'))
export const PROVIDER_LEGAL_NAME = validLegalName(envValue('VITE_PROVIDER_LEGAL_NAME'))
export const SOLO_PROMPTPAY = validSoloPromptPay(envValue('VITE_SOLO_PROMPTPAY'))
export const PAID_PLAN_AVAILABLE = !!(SUPPORT_CONTACT && PROVIDER_LEGAL_NAME && SOLO_PROMPTPAY)
