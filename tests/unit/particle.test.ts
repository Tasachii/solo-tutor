import { describe, expect, it } from 'vitest'
import { tutorTemplates } from '../../src/copy/tutor'
import { templatesFor } from '../../src/professions'
import { buildReal, buildScenario } from '../../src/core/scenarios'
import { migrate, reducer } from '../../src/core/store'
import { invoiceText, reminderText, cancelledText, receiptText } from '../../src/core/messages'
import { answer } from '../../src/core/faq'
import { particleVars } from '../../src/core/particle'
import { validateState } from '../../src/core/validation'
import type { AppState } from '../../src/core/types'

const strings = (obj: unknown): string[] =>
  typeof obj === 'string' ? [obj] : obj && typeof obj === 'object' ? Object.values(obj).flatMap(strings) : []

/** เดโมที่ปิดยอดแล้วมีบิล ใช้เป็นฐานทดสอบข้อความทุกชนิด */
const withInvoice = (particle?: AppState['provider']['particle']): { s: AppState; inv: AppState['invoices'][number] } => {
  let s = buildScenario('default')
  if (particle) s = reducer(s, { type: 'setProvider', name: 'ครูมายด์', promptpayId: '', particle })
  const inv = s.invoices.find((i) => i.status !== 'paid') ?? s.invoices[0]
  return { s, inv }
}

describe('คำลงท้าย ครับ/ค่ะ', () => {
  it('ไม่มีเทมเพลตไหนฝัง ครับ/ค่ะ ไว้ตายตัว — ทุกอาชีพ', () => {
    const all = [...strings(tutorTemplates), ...['barber', 'nail', 'fortune', 'massage'].flatMap((id) => strings(templatesFor(id)))]
    expect(all.length).toBeGreaterThan(20)
    for (const t of all) {
      expect(t, t).not.toMatch(/ครับ|ค่ะ|คะ(?![฀-๿])/)
    }
  })

  it('ค่าเริ่มต้น (ไม่ตั้งค่า) ยังพูด ครับ — ข้อมูลเก่าไม่เปลี่ยนเสียง', () => {
    expect(particleVars(undefined)).toEqual({ p: 'ครับ', pq: 'ครับ' })
    const { s, inv } = withInvoice()
    expect(invoiceText(s, inv)).toContain('ครับ')
    expect(invoiceText(s, inv)).not.toContain('ค่ะ')
  })

  it('ครูผู้หญิงเลือก ค่ะ แล้วทุกข้อความเปลี่ยนตาม คำถามเป็น คะ', () => {
    const { s, inv } = withInvoice('ค่ะ')
    const subject = s.subjects.find((x) => x.id === inv.subjectId)!
    const texts = [
      invoiceText(s, inv),
      reminderText(s, inv, 'clear'),
      reminderText(s, inv, 'final'),
      cancelledText(s, subject, s.today),
      receiptText(s, inv, 'r1', inv.total),
      answer(s, inv.clientId, 'ยอดเท่าไหร่').text,
      answer(s, inv.clientId, 'อะไรก็ไม่รู้').text,
    ]
    for (const t of texts) {
      expect(t, t).not.toContain('ครับ')
      expect(t, t).toMatch(/ค่ะ|คะ/)
    }
    expect(reminderText(s, inv, 'clear')).toContain('ได้ไหมคะ')
    expect(reminderText(s, inv, 'final')).toContain('นะคะ')
    expect(cancelledText(s, subject, s.today)).toContain('นะคะ')
  })

  it('ร่างที่รอส่งถูก render ใหม่เมื่อครูเปลี่ยนคำลงท้าย', () => {
    // ร่างเกิดตอน normalize ท้าย reducer — action เปล่าเพื่อให้มันเกิดก่อน
    let s = reducer(buildScenario('default'), { type: 'track', name: 'init' })
    const before = s.messages.filter((m) => m.status === 'draft')
    expect(before.length).toBeGreaterThan(0)
    expect(before.every((m) => m.draft.includes('ครับ'))).toBe(true)
    s = reducer(s, { type: 'setProvider', name: s.provider.name, promptpayId: s.provider.promptpayId, particle: 'ค่ะ' })
    const after = s.messages.filter((m) => m.status === 'draft')
    expect(after.length).toBe(before.length)
    expect(after.some((m) => m.draft.includes('ครับ'))).toBe(false)
    expect(after.every((m) => /ค่ะ|คะ/.test(m.draft))).toBe(true)
  })

  it('reducer ปฏิเสธคำลงท้ายที่ไม่รู้จัก และไม่ลบค่าเดิมเมื่อไม่ส่งมา', () => {
    let s = buildScenario('default')
    s = reducer(s, { type: 'setProvider', name: 'ครูมายด์', promptpayId: '', particle: 'ค่ะ' })
    const bad = reducer(s, { type: 'setProvider', name: 'ครูมายด์', promptpayId: '', particle: 'จ้ะ' as never })
    expect(bad).toBe(s)
    const kept = reducer(s, { type: 'setProvider', name: 'ครูมายด์ 2', promptpayId: '' })
    expect(kept.provider.particle).toBe('ค่ะ')
  })

  it('เริ่มใช้จริงแล้วคำลงท้ายที่เลือกติดไปด้วย', () => {
    const real = buildReal({ name: 'ครูมายด์', promptpayId: '0812345678', particle: 'ค่ะ' })
    expect(real.provider.particle).toBe('ค่ะ')
  })

  it('ไฟล์สำรองเก่าที่ไม่มี particle ยังโหลดได้ · ค่าแปลกถูกปฏิเสธ', () => {
    const s = buildScenario('default')
    const { particle: _drop, ...provider } = { ...s.provider, particle: 'ครับ' as const }
    const legacy = JSON.parse(JSON.stringify({ ...s, provider }))
    expect(migrate(legacy)).not.toBeNull()
    const weird = JSON.parse(JSON.stringify({ ...s, provider: { ...s.provider, particle: 'จ้ะ' } }))
    expect(validateState(weird).errors.some((e) => e.startsWith('provider'))).toBe(true)
    expect(migrate(weird)).toBeNull()
  })
})
