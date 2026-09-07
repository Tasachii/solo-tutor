import { describe, expect, it } from 'vitest'
import { buildScenario } from '../../src/core/scenarios'
import { homeworkText } from '../../src/core/messages'
import { professions } from '../../src/professions'

/** ข้อความการบ้าน — เนื้อหาครูพิมพ์สด ห่อด้วยคำทักทาย/ลงท้าย ไม่บันทึกอะไรใน ledger */
describe('homeworkText', () => {
  const base = buildScenario('default')
  const subject = base.subjects.find((s) => s.id === 's2')!

  it('ใส่เนื้อหาที่พิมพ์ ชื่อนักเรียน วันที่วันนี้ และคำลงท้ายของครู', () => {
    const text = homeworkText(base, subject, '  แบบฝึกหัดบทที่ 3 ข้อ 1–10  ')
    expect(text).toContain('แบบฝึกหัดบทที่ 3 ข้อ 1–10')
    expect(text).not.toContain('  แบบฝึกหัด')
    expect(text).toContain(subject.name)
    expect(text).toContain('ครับ')
    expect(text).not.toContain('{')
    expect(text).not.toMatch(/ระบบ|อัตโนมัติ|Solo|คุณคุณ/)
    const her = homeworkText({ ...base, provider: { ...base.provider, particle: 'ค่ะ' } }, subject, 'x')
    expect(her).toContain('นะคะ')
    expect(her).not.toContain('ครับ')
  })
  it('ไม่แตะ state — ledger เท่าเดิมทุกตาราง', () => {
    const before = JSON.stringify(base)
    homeworkText(base, subject, 'อ่านหน้า 12')
    expect(JSON.stringify(base)).toBe(before)
  })
  it('ทุกอาชีพมี template', () => {
    for (const prof of professions) expect(homeworkText({ ...base, professionId: prof.id }, subject, 'งาน')).toContain('งาน')
  })
})
