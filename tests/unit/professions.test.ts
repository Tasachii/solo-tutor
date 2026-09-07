import { describe, expect, it } from 'vitest'
import { modeLabelFor, professions, templatesFor } from '../../src/professions'

describe('profession-owned copy contract', () => {
  it('ทุก profession มีข้อความใช้ได้จาก template ของตัวเองหรือ generic fallback', () => {
    for (const profession of professions) {
      expect(templatesFor(profession.id).invoice).toContain('{invoiceUrl}')
      expect(modeLabelFor(profession.id, profession.defaultBilling ?? 'per_unit')).toBeTruthy()
    }
  })

  it('generic service professions do not inherit tutor-specific words', () => {
    for (const professionId of ['barber', 'nail', 'fortune', 'massage']) {
      const copy = JSON.stringify(templatesFor(professionId))
      expect(copy).not.toContain('ค่าเรียน')
      expect(copy).not.toContain('คาบ')
      expect(copy).not.toContain('ครู')
    }
  })
})
