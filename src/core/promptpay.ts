import { normalizePaymentDestination, paymentDestinationKind } from './paymentDestination'

/**
 * PromptPay payload ตามสเปก EMVCo merchant-presented mode
 * ลำดับแท็กและวิธีคิด CRC อ้างอิงสเปกและ implementation ที่ธนาคารไทยใช้กันจริง
 * (ประเทศ 58 มาก่อนสกุลเงิน 53 — สลับแล้วแอปธนาคารบางตัวอ่านไม่ออก)
 */
const AID_PROMPTPAY = 'A000000677010111'
const SUBTAG_PHONE = '01'
const SUBTAG_NATIONAL_ID = '02'

/** id + ความยาว 2 หลัก + ค่า */
const field = (id: string, value: string): string =>
  `${id}${String(value.length).padStart(2, '0')}${value}`

/** เบอร์มือถือกลายเป็น 0066xxxxxxxxx 13 หลัก · เลขบัตรใช้ 13 หลักตามเดิม */
export function promptpayTarget(destination: string): { subtag: string; value: string } | null {
  const kind = paymentDestinationKind(destination)
  if (!kind) return null
  const digits = normalizePaymentDestination(destination)
  if (!digits) return null
  if (kind === 'national-id') return { subtag: SUBTAG_NATIONAL_ID, value: digits }
  return { subtag: SUBTAG_PHONE, value: `0000000000000${digits.replace(/^0/, '66')}`.slice(-13) }
}

/** CRC-16/CCITT-FALSE — poly 0x1021, ตั้งต้น 0xFFFF, ไม่กลับบิต ไม่ XOR ตอนจบ */
export function crc16(input: string): number {
  let crc = 0xffff
  for (const character of input) {
    crc ^= character.charCodeAt(0) << 8
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc
}

/**
 * คืน payload ที่สแกนจ่ายได้จริง หรือ null เมื่อปลายทางใช้ไม่ได้
 * ยอดเงินต้องมาจาก ledger เสมอ ที่นี่แค่จัดรูปแบบ ไม่คำนวณอะไรเพิ่ม
 */
export function promptpayPayload(destination: string, amount?: number): string | null {
  const target = promptpayTarget(destination)
  if (!target) return null
  const chargeable = typeof amount === 'number' && Number.isFinite(amount) && amount > 0
  if (typeof amount === 'number' && !chargeable) return null

  const merchant = field('00', AID_PROMPTPAY) + field(target.subtag, target.value)
  const body =
    field('00', '01') +
    field('01', chargeable ? '12' : '11') +
    field('29', merchant) +
    field('58', 'TH') +
    field('53', '764') +
    (chargeable ? field('54', amount.toFixed(2)) : '')

  const withCrcTag = `${body}6304`
  return withCrcTag + crc16(withCrcTag).toString(16).toUpperCase().padStart(4, '0')
}
