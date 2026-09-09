import { periodBack } from '../../src/mock/seed'
import { describe, expect, it } from 'vitest'
import { buildScenario } from '../../src/core/scenarios'
import { billingChangeIssue, buildInvoice, closablePeriods, daysOverdue, flatBillablePeriods, ladderFor } from '../../src/core/billing'
import { subjectById } from '../../src/core/ledger'
import { complete } from '../../src/core/ledger'
import { reducer } from '../../src/core/store'
import type { AppState, Subject } from '../../src/core/types'

const s = buildScenario('default')
const P = '2025-08'

describe('billing', () => {
  it('per_unit qty x rate', () => {
    const inv = buildInvoice(subjectById(s, 's2')!, P, s)!
    expect(inv.total).toBe(3000)
    expect(inv.lines[0].qty).toBe(6)
  })
  it('flat ignores qty', () => {
    const inv = buildInvoice(subjectById(s, 's4')!, P, s)!
    expect(inv.total).toBe(3200)
  })
  it('package returns null monthly', () => {
    expect(buildInvoice(subjectById(s, 's6')!, P, s)).toBeNull()
  })
  it('overdue after dueDays', () => {
    const inv = s.invoices.find((i) => i.subjectId === 's2' && i.period === periodBack(1))!
    expect(inv.status).toBe('overdue')
    expect(daysOverdue(s, inv)).toBe(5)
  })
  it('ladder picks highest', () => {
    expect(ladderFor(s, s.invoices.find((i) => i.subjectId === 's2' && i.period === periodBack(1))!)).toBe('clear')
    expect(ladderFor(s, s.invoices.find((i) => i.subjectId === 's5' && i.period === periodBack(1))!)).toBe('final')
  })
})

describe('price snapshots', () => {
  it('เปลี่ยนราคากลางเดือนแล้วคาบเดิมยังใช้ราคาเดิม', () => {
    let s = buildScenario('empty')
    const subject = { id: 's', name: 'งาน', clientId: 'c', active: true, createdAt: s.today,
      billing: { mode: 'per_unit' as const, rate: 400 } }
    s = { ...s, clients: [{ id: 'c', name: 'ลูกค้า' }], subjects: [subject], units: [
      { id: 'u1', subjectId: 's', scheduledAt: s.today, time: '09:00', durationMin: 60 },
      { id: 'u2', subjectId: 's', scheduledAt: s.today, time: '10:00', durationMin: 60 },
    ] }
    s = complete(s, 'u1')
    s = reducer(s, { type: 'upsertSubject', subject: { ...subject, billing: { mode: 'per_unit', rate: 500 } }, clientName: 'ลูกค้า' })
    s = complete(s, 'u2')
    const inv = buildInvoice(subjectById(s, 's')!, s.today.slice(0, 7), s)!
    expect(inv.lines.map((line) => [line.qty, line.unitPrice, line.amount])).toEqual([[1, 400, 400], [1, 500, 500]])
    expect(inv.total).toBe(900)
  })
  it('บล็อกการสลับวิธีคิดเงินเมื่อมีงานที่ยังไม่ออกบิล', () => {
    const before = buildScenario('default')
    const subject = subjectById(before, 's1')!
    expect(billingChangeIssue(before, subject, { mode: 'flat_monthly', amount: 3200 }))
      .toBe('unbilled-mode-change')
    const after = reducer(before, {
      type: 'upsertSubject', subject: { ...subject, billing: { mode: 'flat_monthly', amount: 3200 } }, clientName: 'คุณแม่แพรว',
    })
    expect(subjectById(after, 's1')!.billing).toEqual(subject.billing)
  })

  it('บล็อกการแก้ยอดเหมาเมื่อมีงานหรือบิลร่างค้าง และยอมเมื่อบิลถูกส่งแล้ว', () => {
    let before = buildScenario('default')
    const unit = before.units.find((row) => row.subjectId === 's4' && row.scheduledAt.startsWith('2025-09'))!
    before = complete(before, unit.id)
    const subject = subjectById(before, 's4')!
    expect(billingChangeIssue(before, subject, { mode: 'flat_monthly', amount: 3500 }))
      .toBe('unbilled-flat-price-change')
    before = reducer(before, { type: 'closeMonth', period: '2025-09' })
    expect(billingChangeIssue(before, subjectById(before, 's4')!, { mode: 'flat_monthly', amount: 3500 }))
      .toBe('unbilled-flat-price-change')
    before = { ...before, invoices: before.invoices.map(invoice => invoice.subjectId === 's4' && invoice.period === '2025-09'
      ? { ...invoice, status: 'sent' as const, sentAt: before.today }
      : invoice) }
    expect(billingChangeIssue(before, subjectById(before, 's4')!, { mode: 'flat_monthly', amount: 3500 })).toBeNull()
  })
  it('แพ็กที่เริ่มใช้แล้วต้องสร้างรายการใหม่เมื่อเปลี่ยนวิธีคิดเงิน', () => {
    const state = buildScenario('default')
    const subject = subjectById(state, 's6')!
    expect(billingChangeIssue(state, subject, { mode: 'per_unit', rate: 400 }))
      .toBe('package-history-mode-change')
  })
  it('ข้อมูลเก่าที่ไม่มี snapshot ถูกตรึงด้วยราคาเดิมก่อนแก้เรต', () => {
    const before = buildScenario('default')
    const subject = subjectById(before, 's1')!
    expect(before.completions.some((completion) => completion.unitPrice === undefined)).toBe(true)
    const after = reducer(before, {
      type: 'upsertSubject', subject: { ...subject, billing: { mode: 'per_unit', rate: 500 } }, clientName: 'คุณแม่แพรว',
    })
    expect(buildInvoice(subjectById(after, 's1')!, '2025-08', after)!.total).toBe(3200)
  })
})

describe('flat monthly effective period', () => {
  const flat: Subject = { id: 'flat', name: 'เหมา', clientId: 'c', active: true, createdAt: '2025-09-15',
    billing: { mode: 'flat_monthly' as const, amount: 3000 } }
  const state = { ...buildScenario('empty'), clients: [{ id: 'c', name: 'ผู้จ่าย' }], subjects: [flat] }

  it('ไม่สร้างบิลก่อนเริ่มสัญญาและไม่สร้างเดือนหลังหยุด', () => {
    expect(buildInvoice(flat, '2025-08', state)).toBeNull()
    expect(buildInvoice(flat, '2025-09', state)?.total).toBe(3000)
    const inactive = { ...flat, active: false, inactiveAt: '2025-10-02' }
    const stopped = { ...state, today: '2025-11-01', subjects: [inactive] }
    expect(buildInvoice(inactive, '2025-10', stopped)?.total).toBe(3000)
    expect(buildInvoice(inactive, '2025-11', stopped)).toBeNull()
    expect(closablePeriods(stopped)).toEqual(['2025-09', '2025-10'])
  })

  it('ข้อมูลเก่าที่หยุดแล้วแต่ไม่มีวันหยุดจะไม่เดายอดเหมาเดือนว่างย้อนหลัง', () => {
    const legacy = { ...flat, active: false }
    expect(buildInvoice(legacy, '2025-10', { ...state, subjects: [legacy] })).toBeNull()
  })

  it('reducer บันทึกวันหยุดและล้างเมื่อกลับมาเรียน', () => {
    const stopped = reducer(state, { type: 'deactivateSubject', subjectId: flat.id })
    expect(stopped.subjects[0].inactiveAt).toBe(state.today)
    const active = reducer(stopped, { type: 'reactivateSubject', subjectId: flat.id })
    expect(active.subjects[0]).toMatchObject({ active: true })
    expect(active.subjects[0].inactiveAt).toBeUndefined()
  })

  it('เปิดเดือนเหมาเก่าที่ไม่มีคาบให้ปิดยอด แต่ไม่เปิดก่อนสมัครหรือเดือนอนาคต', () => {
    const july = { ...flat, createdAt: '2025-07-15' }
    const september = { ...state, today: '2025-09-01', subjects: [july] }
    expect(flatBillablePeriods(september, july)).toEqual(['2025-07', '2025-08', '2025-09'])
    expect(closablePeriods(september)).toEqual(['2025-07', '2025-08', '2025-09'])
    expect(buildInvoice(july, '2025-06', september)).toBeNull()
    expect(buildInvoice(july, '2025-08', september)?.total).toBe(3000)
    expect(buildInvoice(july, '2025-10', september)).toBeNull()
  })

  it('จำช่วงหยุดเรียนหลังกลับมา และไม่คิดยอดเหมาเดือนที่หยุดทั้งเดือน', () => {
    let lifecycle: AppState = { ...state, today: '2025-10-01', subjects: [{ ...flat, createdAt: '2025-09-15' }] }
    lifecycle = reducer(lifecycle, { type: 'deactivateSubject', subjectId: flat.id })
    lifecycle = reducer({ ...lifecycle, today: '2025-12-01' }, { type: 'reactivateSubject', subjectId: flat.id })
    const resumed = lifecycle.subjects[0]
    expect(resumed.billingIntervals).toEqual([
      { from: '2025-09-15', to: '2025-10-01' },
      { from: '2025-12-01' },
    ])
    expect(buildInvoice(resumed, '2025-10', lifecycle)?.total).toBe(3000)
    expect(buildInvoice(resumed, '2025-11', lifecycle)).toBeNull()
    expect(buildInvoice(resumed, '2025-12', lifecycle)?.total).toBe(3000)
  })

  it('กันแก้ราคาเหมาย้อนหลังจนกว่าจะออกบิลทุกเดือนที่สัญญามีผล', () => {
    let unbilled: AppState = { ...state, today: '2025-09-01', subjects: [{ ...flat, createdAt: '2025-08-01' }] }
    expect(billingChangeIssue(unbilled, unbilled.subjects[0], { mode: 'flat_monthly', amount: 3500 }))
      .toBe('unbilled-flat-price-change')
    unbilled = reducer(unbilled, { type: 'closeMonth', period: '2025-08' })
    expect(billingChangeIssue(unbilled, unbilled.subjects[0], { mode: 'flat_monthly', amount: 3500 }))
      .toBe('unbilled-flat-price-change')
    unbilled = reducer(unbilled, { type: 'closeMonth', period: '2025-09' })
    unbilled = { ...unbilled, invoices: unbilled.invoices.map(invoice => ({ ...invoice, status: 'sent' as const })) }
    expect(billingChangeIssue(unbilled, unbilled.subjects[0], { mode: 'flat_monthly', amount: 3500 })).toBeNull()
  })

  it('เริ่มคิดเหมาตั้งแต่วันที่เปลี่ยนวิธี ไม่เรียกเก็บย้อนหลังช่วงที่เป็นรายครั้ง', () => {
    const perUnit: Subject = { ...flat, createdAt: '2025-09-01', billing: { mode: 'per_unit', rate: 500 },
      billingIntervals: [{ from: '2025-09-01', to: '2025-10-01' }, { from: '2025-11-01' }] }
    const december: AppState = { ...state, today: '2025-12-01', subjects: [perUnit] }
    const changed = reducer(december, { type: 'upsertSubject', subject: { ...perUnit, billing: { mode: 'flat_monthly', amount: 3000 } }, clientName: 'ผู้จ่าย' })
    const monthly = changed.subjects[0]
    expect(monthly.billing).toMatchObject({ mode: 'flat_monthly', effectiveFrom: '2025-12-01' })
    expect(flatBillablePeriods(changed, monthly)).toEqual(['2025-12'])
    expect(buildInvoice(monthly, '2025-11', changed)).toBeNull()
    expect(buildInvoice(monthly, '2025-12', changed)?.total).toBe(3000)
  })

  it('บิลร่างล็อกวิธีคิดเงินทั้งสองทิศ และ completion เก่าไม่ข้าม effectiveFrom', () => {
    const perUnit: Subject = { ...flat, createdAt: '2025-09-01', billing: { mode: 'per_unit', rate: 500 } }
    let withWork: AppState = { ...state, today: '2025-09-30', subjects: [perUnit], units: [
      { id: 'u-old', subjectId: perUnit.id, scheduledAt: '2025-09-10', time: '10:00', durationMin: 60 },
    ], completions: [{ unitId: 'u-old', completedAt: '2025-09-10', unitPrice: 500 }] }
    withWork = reducer(withWork, { type: 'closeMonth', period: '2025-09' })
    expect(billingChangeIssue(withWork, perUnit, { mode: 'flat_monthly', amount: 3000 })).toBe('unbilled-mode-change')
    const flatDraft = { ...withWork, subjects: [{ ...perUnit, billing: { mode: 'flat_monthly' as const, amount: 3000, effectiveFrom: '2025-09-01' } }] }
    expect(billingChangeIssue(flatDraft, flatDraft.subjects[0], { mode: 'per_unit', rate: 500 })).toBe('unbilled-mode-change')
    expect(billingChangeIssue(flatDraft, flatDraft.subjects[0], { mode: 'flat_monthly', amount: 3000 })).toBeNull()
    const renamed = reducer(flatDraft, { type: 'upsertSubject', subject: { ...flatDraft.subjects[0], name: 'ชื่อใหม่', billing: { mode: 'flat_monthly', amount: 3000 } }, clientName: 'ผู้จ่าย' })
    expect(renamed.subjects[0]).toMatchObject({ name: 'ชื่อใหม่', billing: { effectiveFrom: '2025-09-01' } })

    const finalized: AppState = { ...withWork, today: '2025-12-01', invoices: withWork.invoices.map(invoice => ({ ...invoice, status: 'sent' as const })) }
    const changed = reducer(finalized, { type: 'upsertSubject', subject: { ...perUnit, billing: { mode: 'flat_monthly', amount: 3000 } }, clientName: 'ผู้จ่าย' })
    expect(buildInvoice(changed.subjects[0], '2025-09', changed)).toBeNull()
    expect(buildInvoice(changed.subjects[0], '2025-12', changed)?.total).toBe(3000)
  })

})

it('paid package entitlement survives mode changes before its first completion', () => {
  let state = buildScenario('default')
  const subject = subjectById(state, 's6')!
  const unitIds = new Set(state.units.filter(u => u.subjectId === subject.id).map(u => u.id))
  state = { ...state, completions: state.completions.filter(c => !unitIds.has(c.unitId)) }
  state = reducer(state, { type: 'renewPackage', subjectId: subject.id })
  expect(state.invoices.some(i => i.subjectId === subject.id && i.kind === 'package')).toBe(true)
  expect(billingChangeIssue(state, subject, { mode: 'per_unit', rate: 400 })).toBe('package-history-mode-change')
})
