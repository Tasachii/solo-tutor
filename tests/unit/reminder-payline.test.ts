import { describe, expect, it } from 'vitest'
import { buildScenario } from '../../src/core/scenarios'
import { reminderText } from '../../src/core/messages'
import { periodBack } from '../../src/mock/seed'
import type { AppState } from '../../src/core/types'

/**
 * ข้อความเตือนค้างจ่าย (soft/clear/final) — เจ้าของขอ 9 ก.ย. หลังเห็นการ์ดในแอดมิน:
 * "รายละเอียดที่ https://…/#/client/g2 เอาออก ใส่พร้อมเพย์ที่ต้องจ่ายแทน"
 * กติกาเดียวกับบิล: เบอร์โชว์ได้ เลขบัตรห้ามโชว์ — แต่ข้อความต้องมีทางจ่ายเสมอ
 */
const real = (promptpayId: string): AppState => ({ ...buildScenario('default'), mode: 'real', provider: { name: 'ครูเต้', promptpayId, particle: 'ครับ' } })
const overdue = (s: AppState) => s.invoices.find((i) => i.subjectId === 's1' && i.period === periodBack(1))!
const KEYS = ['soft', 'clear', 'final'] as const

describe('ข้อความเตือนค้างจ่าย', () => {
  it('ครูผูกพร้อมเพย์ด้วยเบอร์ → ลงท้ายด้วยบรรทัดพร้อมเพย์ ไม่มี "รายละเอียดที่" และไม่มีลิงก์', () => {
    const s = real('0812345678')
    for (const key of KEYS) {
      const text = reminderText(s, overdue(s), key)
      expect(text).toContain('\nโอนได้ที่พร้อมเพย์ 081-234-5678 (ครูเต้)')
      expect(text.endsWith('(ครูเต้)')).toBe(true)
      expect(text).not.toContain('รายละเอียดที่')
      expect(text).not.toMatch(/https?:\/\//)
      expect(text).not.toContain('{payOrLink}')
    }
  })

  it('ครูผูกด้วยเลขบัตรประชาชน → ไม่มีเลขบัตร แต่ยังมีลิงก์ QR ให้จ่ายได้', () => {
    const id = '1234567890121'
    const s = real(id)
    for (const key of KEYS) {
      const text = reminderText(s, overdue(s), key)
      expect(text).not.toContain(id)
      expect(text).not.toContain('โอนได้ที่พร้อมเพย์')
      expect(text).toMatch(/\nสแกน QR โอนได้ที่ \S+$/)
    }
  })

  it('เลขบัตร + ไม่มีเอกสารของบิล → ไม่ต่อประโยค "สแกน QR โอนได้ที่" หน้าข้อความ fallback', () => {
    const s = real('1234567890121')
    const inv = overdue(s)
    // ตัดบิลออกจาก ledger ให้ invoiceDocument หาไม่เจอ — invoiceUrlOf จะคืนประโยคติดต่อครูแทนลิงก์
    const without = { ...s, invoices: s.invoices.filter((i) => i.id !== inv.id) }
    const text = reminderText(without, inv, 'soft')
    expect(text).not.toContain('สแกน QR โอนได้ที่')
    expect(text).toMatch(/\nติดต่อผู้ให้บริการในแชทนี้/)
  })

  it('โหมดเดโม → พิมพ์เลขตัวอย่างตามที่ตั้งไว้ เพื่อให้เห็นรูปแบบข้อความครบ', () => {
    const s = buildScenario('default')
    const text = reminderText(s, overdue(s), 'final')
    expect(text).toContain('โอนได้ที่พร้อมเพย์')
    expect(text).not.toContain('รายละเอียดที่')
  })
})
