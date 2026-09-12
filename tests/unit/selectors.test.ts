import { describe, expect, it } from 'vitest'
import { buildScenario } from '../../src/core/scenarios'
import { reducer } from '../../src/core/store'
import { dashboard, invoiceToActOn } from '../../src/core/selectors'
import { complete, unitsOn } from '../../src/core/ledger'
import { closableSubjects } from '../../src/core/billing'

describe('selectors', () => {
  it('dashboard default 1300', () => {
    expect(dashboard(buildScenario('default'), '2025-09').recovered).toBe(1300)
  })
  it('after two checks 2150', () => {
    let s = buildScenario('default')
    const units = unitsOn(s, s.today)
    s = complete(s, units.find((u) => u.subjectId === 's2')!.id)
    s = complete(s, units.find((u) => u.subjectId === 's8')!.id)
    expect(dashboard(s, '2025-09').recovered).toBe(2150)
  })
  it('outstanding counts sent and overdue', () => {
    expect(dashboard(buildScenario('default'), '2025-08').outstanding).toBe(7400)
  })
})

describe('ใบที่ต้องลงมือทำ', () => {
  it('เลือกเดือนใดต้องคืนบิลของเดือนนั้น แม้เดือนอื่นจะค้างกว่า', () => {
    let s = buildScenario('default')
    // s2 มีบิล ส.ค. ที่เกินกำหนดอยู่
    const aug = s.invoices.find((i) => i.subjectId === 's2' && i.period === '2025-08')!
    expect(['sent', 'overdue']).toContain(aug.status)

    // ปิดยอดเดือน ก.ย. สร้างร่างใบใหม่
    s = { ...s, invoices: [...s.invoices, ...closableSubjects(s, '2025-09').map((c) => c.invoice)] }
    expect(s.invoices.some((i) => i.subjectId === 's2' && i.period === '2025-09')).toBe(true)

    const september = invoiceToActOn(s, 's2', '2025-09')!
    expect(september.period).toBe('2025-09')
    expect(september.id).not.toBe(aug.id)

    const withFutureOverdue = { ...s, invoices: s.invoices.map(invoice =>
      invoice.id === september.id ? { ...invoice, status: 'overdue' as const } : invoice) }
    expect(invoiceToActOn(withFutureOverdue, 's2', '2025-08')?.id).toBe(aug.id)
  })

  it('ไม่มีใบค้าง จึงเอาร่างของเดือนนี้', () => {
    let s = buildScenario('default')
    s = { ...s, invoices: [...s.invoices, ...closableSubjects(s, '2025-09').map((c) => c.invoice)] }
    // s1 ไม่มีบิลค้าง
    const shown = invoiceToActOn(s, 's1', '2025-09')!
    expect(shown.period).toBe('2025-09')
    expect(shown.status).toBe('draft')
  })
})

describe('ยอดค้างกับใบที่ต้องลงมือทำ', () => {
  it('จ่ายบางส่วนแล้ว ยอดค้างต้องเหลือเฉพาะส่วนที่ยังไม่ได้', () => {
    let s = buildScenario('default')
    const inv = s.invoices.find((i) => i.status === 'sent' || i.status === 'overdue')!
    const before = dashboard(s, '2025-08').outstanding

    s = reducer(s, { type: 'recordPayment', invoiceId: inv.id, amount: 1000, slipVerified: true })
    const after = dashboard(s, '2025-08')
    expect(after.outstanding).toBe(before - 1000)
    expect(after.received).toBe(6400) // เงินที่รับในเดือน ส.ค. เดิม ไม่รวมเงินที่รับวันนี้เดือน ก.ย.
    expect(dashboard(s, '2025-09').received).toBe(1000)
  })

  it('ใบที่จ่ายแล้วต้องไม่แย่งที่ร่างของเดือนนี้', () => {
    let s = buildScenario('default')
    const paidNow = {
      id: 'inv-paid-now', clientId: 'c1', subjectId: 's1', period: '2025-09', kind: 'monthly' as const,
      lines: [{ description: 'x', qty: 1, unitPrice: 400, amount: 400 }],
      total: 400, status: 'paid' as const, createdAt: s.today,
    }
    const draftNow = { ...paidNow, id: 'inv-draft-now', status: 'draft' as const }
    s = { ...s, invoices: [...s.invoices, paidNow, draftNow] }
    expect(invoiceToActOn(s, 's1', '2025-09')!.id).toBe('inv-draft-now')
  })
})

/**
 * เจ้าของ 13 ก.ย. 03:09: "ตัวเลขผมว่าแปลก ๆ" — ยอดควรได้ 16,600 แต่เข้าแล้ว 5,800 + ค้าง 5,800 ไม่ครบ
 * เพราะสองคนยังไม่ออกบิล หน้าจอต้องบอกส่วนที่หายไป และเดือนที่จบแล้วในข้อมูลตัวอย่างต้องปิดยอดครบทุกคน
 */
describe('ยอดควรได้ = เข้าแล้ว + ค้างสะสม + ยังไม่ออกบิล', () => {
  it('เดือนที่ผ่านมาของทุกชุดตัวอย่างไม่มีใครค้างออกบิล', () => {
    for (const id of ['default', 'per-unit', 'flat-heavy', 'monthly-heavy', 'package-heavy'] as const) {
      const d = dashboard(buildScenario(id), '2025-08')
      expect(d.unbilledCount, id).toBe(0)
      expect(d.expected, id).toBe(d.received + d.outstanding)
    }
  })
  it('เดือนปัจจุบันที่ยังไม่ปิดยอด บอกจำนวนเงินและจำนวนคนที่ยังไม่ออกบิล', () => {
    const d = dashboard(buildScenario('flat-heavy'), '2025-09')
    expect(d.unbilledCount).toBeGreaterThan(0)
    expect(d.expected).toBe(d.received + d.outstanding + d.unbilled)
  })
})
