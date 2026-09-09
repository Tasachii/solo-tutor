import { describe, expect, it } from 'vitest'
import { buildScenario } from '../../src/core/scenarios'
import { answer, matchSource } from '../../src/core/faq'
import { balanceDue } from '../../src/core/ledger'
import { money } from '../../src/core/format'
import { reducer } from '../../src/core/store'

const s = buildScenario('default')

describe('faq', () => {
  it('priority paymentStatus over currentInvoice', () => {
    expect(matchSource('tutor', 'จ่ายแล้วนะคะ ยอดเท่าไหร่')).toBe('paymentStatus')
  })
  it('no invoice gives estimate', () => {
    const a = answer(s, 'c1', 'เดือนนี้ค่าเรียนเท่าไหร่คะ')
    expect(a.source).toBe('currentInvoice')
    expect(a.text).toMatch(/ยังไม่ปิดยอด/)
  })
  it('not package gives modeThai', () => {
    const a = answer(s, 'c1', 'เหลือกี่ครั้งคะ')
    expect(a.text).toMatch(/รายครั้ง/)
  })
  it('fallback on unknown', () => {
    const a = answer(s, 'c1', 'สวัสดีค่ะ')
    expect(a.source).toBeNull()
    expect(a.text).toMatch(/ครูตอบเอง/)
  })
  it('multi-subject client answers both', () => {
    const a = answer(s, 'c4', 'เดือนนี้ค่าเรียนเท่าไหร่คะ')
    expect(a.text.split('\n').length).toBeGreaterThanOrEqual(2)
    expect(a.text).toMatch(/น้องต้น/)
    expect(a.text).toMatch(/น้องฟ้า/)
  })
  it('package remaining answers with count', () => {
    const a = answer(s, 'c6', 'เหลือกี่ครั้งคะ')
    expect(a.text).toMatch(/เหลือ 2/)
  })
  it('next unit skips cancelled and inactive subjects', () => {
    const live = { id: 'next-live', subjectId: 's1', scheduledAt: '2025-09-04', time: '10:00', durationMin: 60 }
    const cancelled = { ...live, id: 'next-cancelled', scheduledAt: '2025-09-03', cancelled: true }
    const state = { ...s, units: [
      ...s.units.map((u) => u.subjectId === 's1' && u.scheduledAt > s.today ? { ...u, cancelled: true } : u),
      cancelled, live,
    ] }
    expect(answer(state, 'c1', 'เรียนวันไหน').text).toMatch(/4/)
    const inactive = { ...state, subjects: state.subjects.map((x) => x.id === 's1' ? { ...x, active: false } : x) }
    expect(answer(inactive, 'c1', 'เรียนวันไหน').source).toBeNull()
  })
  /**
   * เดโมกับโหมดจริงตอบคำถาม "ค้างเท่าไหร่" เหมือนกันตั้งแต่ 9 ก.ย. — ตัวเดโมออกลิงก์เอกสารจริงแล้ว
   * เดิม `faq.ts` ล็อก `mode === 'real'` ไว้ ผู้ปกครองในเดโมจึงได้ย่อหน้าเดียวจากยอดรวม
   * ทั้งที่ค้างสองใบ แล้วโอนยอดรวมมาใบเดียวโดยไม่รู้ว่าเป็นของเดือนไหน
   */
  it('เดโม: ค้างสองใบ ตอบสองย่อหน้า แต่ละใบมียอดและลิงก์เอกสารของตัวเอง', () => {
    const base = buildScenario('default')
    expect(base.mode).toBe('demo')
    const first = base.invoices.find((i) => i.status === 'sent' || i.status === 'overdue')!
    // ใบที่สองของผู้จ่ายคนเดียวกัน คนละเดือน คนละยอด — บรรทัดต้องรวมได้เท่ากับ total
    // ไม่งั้น `isSharedDocument` ปฏิเสธ แล้ว `invoiceUrlOf` คืนข้อความแทนลิงก์
    const second = {
      ...first, id: `${first.id}-prev`, period: '2025-06',
      lines: [{ description: 'ค่าเรียน มิ.ย. 2568', qty: 1, unitPrice: 1234, amount: 1234 }],
      total: 1234, status: 'sent' as const,
    }
    const state = { ...base, invoices: [...base.invoices, second] }

    const result = answer(state, first.clientId, 'ยังค้างเท่าไหร่คะ')

    const parts = result.text.split('\n\n')
    expect(parts.length).toBe(2)
    expect(result.text).toContain('1,234')
    expect(result.text).toContain(money(balanceDue(state, first.id)))
    // ลิงก์ต่อใบ ไม่ใช่ลิงก์รวมของผู้จ่าย และต้องเป็นลิงก์ที่เปิดจากเครื่องผู้ปกครองได้
    for (const part of parts) expect(part).toContain('#/document/')
    expect(new Set(parts.map((part) => part.match(/#\/document\/[\w-]+/)![0])).size).toBe(2)
    expect(result.text).not.toContain('#/client/')
  })

  it('เดโมที่ไม่มีใบค้างเลย ยังตอบยอดรวมบรรทัดเดียวเหมือนเดิม', () => {
    const base = buildScenario('default')
    const client = base.invoices.find((i) => i.status === 'sent' || i.status === 'overdue')!.clientId
    // ใบของผู้จ่ายคนนี้เป็นร่างทั้งหมด = ไม่มีอะไรค้าง (และไม่มีใบที่จ่ายครบให้ตอบใบเสร็จ)
    const state = { ...base, invoices: base.invoices.map((i) =>
      i.clientId === client ? { ...i, status: 'draft' as const } : i) }

    const result = answer(state, client, 'ยังค้างเท่าไหร่คะ')

    expect(result.source).toBe('paymentStatus')
    expect(result.text.split('\n\n').length).toBe(1)
    expect(result.text).toContain(money(0))
  })

  it('payment status reports cumulative amount and final receipt after installments', () => {
    let state = buildScenario('default')
    const invoice = state.invoices.find((row) => row.clientId === 'c2' && row.total === 3000 && row.status !== 'paid')!
    state = reducer(state, { type: 'recordPayment', invoiceId: invoice.id, amount: 1000, slipVerified: true })
    state = reducer(state, { type: 'recordPayment', invoiceId: invoice.id, amount: 2000, slipVerified: true })
    const result = answer(state, 'c2', 'จ่ายแล้วนะคะ')
    expect(result.text).toContain('3,000')
    // เดโมออกลิงก์เอกสารเหมือนโหมดจริงตั้งแต่ 9 ก.ย. — `#/receipt/<id>` อ่านจาก localStorage
    // ของเครื่องที่เปิด จึงเปิดจากมือถือผู้ปกครองไม่ได้ ลิงก์ที่ส่งออกต้องพาข้อมูลไปในตัวเอง
    expect(result.text).toContain('#/document/')
    expect(result.text).not.toContain('#/receipt/')
  })
})
