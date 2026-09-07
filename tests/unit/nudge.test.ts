import { describe, expect, it } from 'vitest'
import { buildScenario } from '../../src/core/scenarios'
import { nudgeText } from '../../src/core/messages'
import { reducer } from '../../src/core/store'
import { balanceDue, completionsIn } from '../../src/core/ledger'
import { money } from '../../src/core/format'
import { professions } from '../../src/professions'

/** ปุ่ม "คัดลอกข้อความแจ้งเตือน" — ตัวเลขทุกตัวต้องมาจาก ledger ไม่ใช่จาก template */
describe('nudgeText', () => {
  const base = buildScenario('default')
  const unpaid = base.invoices.find((i) => i.status !== 'paid' && i.total === 3000)!

  it('ใส่จำนวนครั้งและยอดคงเหลือจาก ledger', () => {
    const text = nudgeText(base, unpaid)
    const qty = completionsIn(base, unpaid.subjectId, unpaid.period).length
    expect(qty).toBeGreaterThan(0)
    expect(text).toContain(`เรียนไป ${qty} ครั้ง`)
    expect(text).toContain(`ยอดคงเหลือ ${money(balanceDue(base, unpaid.id))} บาท`)
    expect(text).not.toContain('{')
  })

  it('จ่ายบางส่วนแล้ว ยอดในข้อความคือส่วนที่เหลือ ไม่ใช่ยอดเต็ม', () => {
    const after = reducer(base, { type: 'recordPayment', invoiceId: unpaid.id, amount: 1000, slipVerified: true })
    const text = nudgeText(after, unpaid)
    expect(text).toContain('2,000 บาท')
    expect(text).not.toContain('3,000')
  })

  it('คำลงท้ายตามที่ครูตั้ง — ค่ะ กลายเป็น นะคะ ไม่ปนครับ', () => {
    const her = { ...base, provider: { ...base.provider, particle: 'ค่ะ' as const } }
    const text = nudgeText(her, unpaid)
    expect(text).toContain('สวัสดีค่ะ')
    expect(text).toContain('เลยนะคะ')
    expect(text).not.toContain('ครับ')
    expect(nudgeText(base, unpaid)).toContain('เลยนะครับ')
  })

  it('ไม่มีคำต้องห้ามถึงผู้ปกครอง และไม่ซ้ำคำนำหน้า', () => {
    const text = nudgeText(base, unpaid)
    expect(text).not.toMatch(/ระบบ|อัตโนมัติ|Solo/)
    expect(text).not.toContain('คุณคุณ')
  })

  it('ทุกอาชีพมี template ครบ ไม่เหลือตัวแปรค้าง', () => {
    for (const prof of professions) {
      const s = { ...base, professionId: prof.id }
      expect(nudgeText(s, unpaid)).not.toContain('{')
    }
  })
})
