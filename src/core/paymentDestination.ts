export type PaymentDestinationKind = 'phone' | 'national-id'

/** PromptPay accepts a Thai mobile number or a checksum-valid Thai national ID. */
export function normalizePaymentDestination(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (!/^[\d\s-]+$/.test(trimmed)) return null
  return trimmed.replace(/[\s-]/g, '')
}

function hasValidThaiIdChecksum(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false
  const sum = value.slice(0, 12).split('').reduce((total, digit, index) =>
    total + Number(digit) * (13 - index), 0)
  return (11 - (sum % 11)) % 10 === Number(value[12])
}

export function paymentDestinationKind(value: string): PaymentDestinationKind | null {
  const normalized = normalizePaymentDestination(value)
  if (!normalized) return null
  if (/^0\d{9}$/.test(normalized)) return 'phone'
  if (hasValidThaiIdChecksum(normalized)) return 'national-id'
  return null
}

export const isPaymentDestination = (value: string): boolean => paymentDestinationKind(value) !== null

/** เบอร์พร้อมเพย์แบบอ่านง่ายในข้อความ 0812345678 → 081-234-5678 · ไม่ใช่เบอร์ (เลขบัตร) คืน null เพราะห้ามโชว์ */
export function promptPayPhoneDisplay(value: string): string | null {
  const normalized = normalizePaymentDestination(value)
  if (!normalized || paymentDestinationKind(normalized) !== 'phone') return null
  return `${normalized.slice(0, 3)}-${normalized.slice(3, 6)}-${normalized.slice(6)}`
}
