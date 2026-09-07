import { describe, expect, it } from 'vitest'
import { crc16, promptpayPayload, promptpayTarget } from '../../src/core/promptpay'
import { pickVersion, qrMatrix } from '../../src/core/qr'

const rows = (matrix: boolean[][]): string[] =>
  matrix.map((row) => row.map((on) => (on ? '1' : '0')).join(''))
/** FNV-1a — พอสำหรับจับว่าเมทริกซ์เปลี่ยน และไม่ต้องพึ่ง built-in ของ node (CI ไม่มี @types/node) */
function fingerprint(matrix: boolean[][]): string {
  let hash = 0x811c9dc5
  for (const char of rows(matrix).join('\n')) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

describe('CRC ของ payload', () => {
  it('ตรงกับค่าตรวจสอบมาตรฐานของ CRC-16/CCITT-FALSE', () => {
    // "123456789" → 0x29B1 เป็นค่าตรวจที่ประกาศไว้ในสเปกของอัลกอริทึมนี้
    expect(crc16('123456789').toString(16).toUpperCase()).toBe('29B1')
  })
})

describe('ปลายทางพร้อมเพย์', () => {
  it('เบอร์มือถือกลายเป็น 0066 สิบสามหลัก', () => {
    expect(promptpayTarget('081-234-5678')).toEqual({ subtag: '01', value: '0066812345678' })
  })

  it('เลขบัตรประชาชนใช้แท็ก 02 และคงสิบสามหลัก', () => {
    expect(promptpayTarget('3100600445635')).toEqual({ subtag: '02', value: '3100600445635' })
  })

  it('ปลายทางที่ใช้ไม่ได้ต้องเป็น null ไม่ใช่ QR ที่สแกนแล้วโอนผิด', () => {
    for (const bad of ['', '123', '08123456789', '1234567890123', 'abcdefghij', '0812345678x']) {
      expect(promptpayTarget(bad), bad).toBeNull()
      expect(promptpayPayload(bad, 100), bad).toBeNull()
    }
  })
})

describe('payload พร้อมเพย์', () => {
  it('ไม่ระบุยอด = QR ถาวร (แท็ก 01 เป็น 11)', () => {
    expect(promptpayPayload('0812345678'))
      .toBe('00020101021129370016A000000677010111011300668123456785802TH530376463045D82')
  })

  it('ระบุยอด = QR ครั้งเดียว (แท็ก 01 เป็น 12) และยอดมีทศนิยมสองตำแหน่งเสมอ', () => {
    expect(promptpayPayload('0812345678', 3000))
      .toBe('00020101021229370016A000000677010111011300668123456785802TH530376454073000.0063040BA3')
    expect(promptpayPayload('3100600445635', 250.5))
      .toBe('00020101021229370016A000000677010111021331006004456355802TH53037645406250.506304E4A9')
  })

  it('ยอดที่เป็นไปไม่ได้ต้องไม่ออก QR', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(promptpayPayload('0812345678', bad), String(bad)).toBeNull()
    }
  })

  it('CRC ปิดท้ายและครอบคลุมแท็ก 6304 ด้วย', () => {
    const payload = promptpayPayload('0812345678', 3000)!
    const body = payload.slice(0, -4)
    expect(body.endsWith('6304')).toBe(true)
    expect(payload.slice(-4)).toBe(crc16(body).toString(16).toUpperCase().padStart(4, '0'))
  })
})

describe('ตัวเข้ารหัส QR', () => {
  it('เลือกเวอร์ชันเล็กสุดที่พอ และปฏิเสธเมื่อยาวเกินที่รองรับ', () => {
    expect(pickVersion(14)).toBe(1)
    expect(pickVersion(15)).toBe(2)
    expect(pickVersion(84)).toBe(5)
    expect(pickVersion(85)).toBe(6)
    expect(pickVersion(213)).toBe(10)
    expect(pickVersion(214)).toBeNull()
    expect(qrMatrix('x'.repeat(214))).toBeNull()
  })

  it('ขนาดเมทริกซ์ = เวอร์ชัน × 4 + 17', () => {
    expect(qrMatrix(promptpayPayload('0812345678')!)!.length).toBe(37)
    expect(qrMatrix(promptpayPayload('0812345678', 3000)!)!.length).toBe(41)
  })

  it('มีลาย finder ครบสามมุมและแถว timing สลับขาวดำ', () => {
    const m = qrMatrix(promptpayPayload('0812345678', 3000)!)!
    const size = m.length
    for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
      expect(m[oy][ox]).toBe(true)
      expect(m[oy + 1][ox + 1]).toBe(false)
      expect(m[oy + 3][ox + 3]).toBe(true)
    }
    for (let i = 8; i < size - 8; i += 1) expect(m[6][i]).toBe(i % 2 === 0)
  })

  /**
   * ลายที่ตรึงไว้นี้ถอดรหัสกลับได้จริงด้วย decoder ภายนอก (OpenCV) ตอนเขียน
   * ถ้าค่าเปลี่ยนแปลว่าตัวเข้ารหัสเปลี่ยนพฤติกรรม ต้องเอาไปทดสอบสแกนใหม่ก่อน
   */
  it('ลายเมทริกซ์ไม่เปลี่ยนไปเงียบ ๆ', () => {
    expect(fingerprint(qrMatrix(promptpayPayload('0812345678')!)!)).toBe('1d1d5885')
    expect(fingerprint(qrMatrix(promptpayPayload('0812345678', 3000)!)!)).toBe('a512ceee')
  })
})
