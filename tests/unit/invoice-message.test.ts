import { describe, expect, it } from 'vitest'
import { buildScenario } from '../../src/core/scenarios'
import { invoiceText } from '../../src/core/messages'
import { promptPayPhoneDisplay } from '../../src/core/paymentDestination'
import { periodBack } from '../../src/mock/seed'
import type { AppState } from '../../src/core/types'

/**
 * ข้อความบิลหลังส่งจริงใบแรก (9 ก.ย.): ผู้ปกครองโอนจากเลขในแชท จึงต้องมีเลขพร้อมเพย์ในข้อความ
 * แต่เลขบัตรประชาชนห้ามหลุดไปทุกข้อความ และเหมาเดือนที่ยังไม่มีคาบต้องไม่ขึ้น "(เรียนครบ 0 ครั้ง)"
 */
const real = (promptpayId: string): AppState => ({ ...buildScenario('default'), mode: 'real', provider: { name: 'ครูเต้', promptpayId, particle: 'ครับ' } })
const flatInvoice = (s: AppState) => s.invoices.find((i) => i.subjectId === 's4' && i.period === periodBack(1))! // น้องต้น เหมาเดือน
const unitInvoice = (s: AppState) => s.invoices.find((i) => i.subjectId === 's1' && i.period === periodBack(1))! // น้องแพรว รายครั้ง

describe('ข้อความบิล', () => {
  it('ครูผูกพร้อมเพย์ด้วยเบอร์ → มีบรรทัดโอนพร้อมเบอร์แบบอ่านง่ายและชื่อครู และยังมีลิงก์สำหรับ QR', () => {
    const s = real('0812345678')
    const text = invoiceText(s, unitInvoice(s))
    expect(text).toContain('โอนได้ที่พร้อมเพย์ 081-234-5678 (ครูเต้)')
    expect(text).toMatch(/สแกน QR หรือดูรายละเอียดได้ที่ \S+/) // ลิงก์ยังอยู่เป็นบรรทัดของตัวเอง
    expect(text).not.toContain('{payLine}')
  })

  it('ครูผูกด้วยเลขบัตรประชาชน → ห้ามมีเลขบัตรในข้อความ และไม่มีบรรทัดโอน ให้สแกน QR ที่ลิงก์แทน', () => {
    const id = '1234567890121' // checksum ถูกต้อง
    const s = real(id)
    const text = invoiceText(s, unitInvoice(s))
    expect(text).not.toContain(id)
    expect(text).not.toContain('โอนได้ที่พร้อมเพย์')
    expect(text).toContain('สแกน QR')
    expect(text).not.toMatch(/\{\w+\}/)
  })

  it('เหมาเดือนที่ยังไม่มีคาบ → ไม่มี "(เรียนครบ 0 ครั้ง)" · มีคาบแล้ว → บอกจำนวน', () => {
    const s = real('0812345678')
    const inv = flatInvoice(s)
    // การเช็คชื่อผูกกับ unit ไม่ใช่ subject — ตัดเฉพาะคาบของน้องต้นออก
    const s4Units = new Set(s.units.filter((u) => u.subjectId === 's4').map((u) => u.id))
    const none = { ...s, completions: s.completions.filter((c) => !s4Units.has(c.unitId)) }
    expect(invoiceText(none, inv)).not.toContain('เรียนครบ')
    expect(invoiceText(none, inv)).not.toContain('0 ครั้ง')
    const withSessions = invoiceText(s, inv)
    expect(withSessions).toMatch(/\(เรียนครบ \d+ ครั้ง\)/)
  })

  it('โหมดเดโมพิมพ์เลขตัวอย่างที่ตั้งไว้ เพื่อให้เห็นรูปแบบข้อความครบ', () => {
    const s = buildScenario('default')
    expect(s.mode).toBe('demo')
    expect(invoiceText(s, unitInvoice(s))).toContain('โอนได้ที่พร้อมเพย์ ')
  })

  it('ตัวจัดรูปแบบเบอร์: 10 หลักได้ขีด · เลขบัตร/ว่าง/ขยะ ได้ null', () => {
    expect(promptPayPhoneDisplay('0812345678')).toBe('081-234-5678')
    expect(promptPayPhoneDisplay('081-234-5678')).toBe('081-234-5678')
    expect(promptPayPhoneDisplay('1234567890121')).toBeNull()
    expect(promptPayPhoneDisplay('')).toBeNull()
    expect(promptPayPhoneDisplay('abc')).toBeNull()
  })
})
