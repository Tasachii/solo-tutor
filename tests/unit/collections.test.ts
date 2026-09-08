import { describe, expect, it } from 'vitest'
import { buildScenario } from '../../src/core/scenarios'
import { reducer } from '../../src/core/store'
import { collectionRows, collectionSummary, nudgeKey } from '../../src/core/collections'
import { balanceDue } from '../../src/core/ledger'
import { validateState } from '../../src/core/validation'
import { fromBackup, toBackup } from '../../src/core/backup'
import { professions } from '../../src/professions'

/** แท็บทวงเงิน — ทุกตัวเลขมาจาก ledger เรียงตามความเร่งด่วน และทวงสั้นเข้าคิวได้วันละใบ */
const base = () => reducer(buildScenario('default'), { type: 'track', name: 'init' })

describe('collectionRows', () => {
  it('รวมเฉพาะบิลรายเดือนที่ส่งแล้ว/ค้าง เรียงวันค้างมากสุดก่อน และมีร่างทวงตามบันไดจับคู่ให้', () => {
    const s = base()
    const rows = collectionRows(s)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(['sent', 'overdue']).toContain(row.invoice.status)
      expect(row.invoice.kind).toBe('monthly')
      expect(row.balance).toBe(balanceDue(s, row.invoice.id))
    }
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].daysOverdue).toBeGreaterThanOrEqual(rows[i].daysOverdue)
    const overdue = rows.filter(r => r.daysOverdue > 0)
    expect(overdue.length).toBeGreaterThan(0)
    // บิลที่เลยกำหนดต้องมีขั้นทวงและร่างทวง (derive จาก ledger) ตรงกับ invoice เดียวกัน
    for (const row of overdue) {
      expect(row.ladder).not.toBeNull()
      expect(row.draft?.kind).toBe('reminder')
      expect(row.draft?.meta?.invoiceId).toBe(row.invoice.id)
    }
    const summary = collectionSummary(rows)
    expect(summary.count).toBe(rows.length)
    expect(summary.outstanding).toBe(rows.reduce((n, r) => n + r.balance, 0))
    expect(summary.withDraft).toBe(rows.filter(r => r.draft).length)
  })

  it('บิลที่จ่ายครบหายจากรายการ และประวัติทวงล่าสุดอ่านจากข้อความที่ส่งแล้ว', () => {
    let s = base()
    const row = collectionRows(s).find(r => r.draft)!
    expect(row.lastReminder).toBeUndefined()
    s = reducer(s, { type: 'sendMessage', id: row.draft!.id })
    const after = collectionRows(s).find(r => r.invoice.id === row.invoice.id)!
    expect(after.lastReminder?.at).toBe(s.today)
    expect(after.remindersSent).toBe(1)
    s = reducer(s, { type: 'recordPayment', invoiceId: row.invoice.id, amount: balanceDue(s, row.invoice.id), slipVerified: true })
    expect(collectionRows(s).some(r => r.invoice.id === row.invoice.id)).toBe(false)
  })
})

describe('nudgeInvoice', () => {
  it('สร้างข้อความเตือนยอดวันละใบต่อบิล ตัวเลขจาก ledger และถอนเองเมื่อจ่ายครบ', () => {
    let s = base()
    const row = collectionRows(s)[0]
    s = reducer(s, { type: 'nudgeInvoice', invoiceId: row.invoice.id })
    const nudge = s.messages.find(m => m.kind === 'nudge' && m.meta?.invoiceId === row.invoice.id)!
    expect(nudge.status).toBe('draft')
    expect(nudge.dedupeKey).toBe(nudgeKey(row.invoice.id, s.today))
    expect(nudge.draft).toContain(String(row.balance).replace(/\B(?=(\d{3})+(?!\d))/g, ','))
    expect(nudge.draft).not.toMatch(/ระบบ|อัตโนมัติ|Solo|\{/)
    // กดซ้ำวันเดียวกัน = ไม่เพิ่ม
    expect(reducer(s, { type: 'nudgeInvoice', invoiceId: row.invoice.id })).toBe(s)
    // บิลที่ยังเป็นร่างหรือจ่ายแล้ว ทวงไม่ได้
    const draftInvoice = s.invoices.find(i => i.status === 'paid')
    if (draftInvoice) expect(reducer(s, { type: 'nudgeInvoice', invoiceId: draftInvoice.id })).toBe(s)
    expect(validateState(s).ok).toBe(true)
    // จ่ายครบ → ร่างเตือนยอดถอนตัวเอง
    s = reducer(s, { type: 'recordPayment', invoiceId: row.invoice.id, amount: balanceDue(s, row.invoice.id), slipVerified: true })
    expect(s.messages.some(m => m.id === nudge.id)).toBe(false)
  })

  it('ข้อความเตือนยอดเป็นข้อความการเงิน: ปลายทางรับเงินไม่ครบส่งไม่ได้ และ backup กู้กลับได้ครบ', () => {
    let s = base()
    s = reducer(s, { type: 'nudgeInvoice', invoiceId: collectionRows(s)[0].invoice.id })
    const nudge = s.messages.find(m => m.kind === 'nudge')!
    const real = { ...s, mode: 'real' as const, provider: { name: 'ครู', promptpayId: '' } }
    expect(reducer(real, { type: 'sendMessage', id: nudge.id })).toBe(real)
    const restored = fromBackup(toBackup(s, '2026-09-08T00:00:00Z'), 5)
    expect(restored.ok).toBe(true)
    if (restored.ok) expect(restored.state.messages.some(m => m.kind === 'nudge')).toBe(true)
  })

  it('ทุกอาชีพร่างข้อความเตือนยอดได้โดยไม่มีตัวแปรค้าง', () => {
    for (const prof of professions) {
      const s = reducer({ ...buildScenario('default'), professionId: prof.id }, { type: 'track', name: 'x' })
      const inv = collectionRows(s)[0].invoice
      const next = reducer(s, { type: 'nudgeInvoice', invoiceId: inv.id })
      expect(next.messages.find(m => m.kind === 'nudge')!.draft).not.toContain('{')
    }
  })
})
