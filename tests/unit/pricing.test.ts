import { describe, expect, it } from 'vitest'
import { planSavings } from '../../src/platform/Pricing'
import { copy } from '../../src/copy'

/** ราคาบนการ์ดต้องมาจากตัวเลขราคาเสมอ ห้ามพิมพ์ค่าเฉลี่ยไว้ในข้อความ */
describe('ส่วนลดของแพ็กระยะยาว', () => {
  it('ฟรีกับรายเดือนไม่มีค่าเฉลี่ยให้แสดง', () => {
    expect(planSavings(0)).toBeNull()
    expect(planSavings(1)).toBeNull()
  })

  it('3 เดือน เฉลี่ย 266 ประหยัด 98', () => {
    expect(planSavings(2)).toEqual({ perMonth: 266, saves: 98 })
  })

  it('12 เดือน เฉลี่ย 208 ประหยัด 1,098', () => {
    expect(planSavings(3)).toEqual({ perMonth: 208, saves: 1098 })
  })

  it('ข้อความมีที่ว่างให้เติมตัวเลข ไม่ได้พิมพ์ตัวเลขไว้เอง', () => {
    expect(copy.pricing.perMonth).toContain('{n}')
    expect(copy.pricing.saves).toContain('{n}')
    expect(copy.pricing.perMonth).not.toMatch(/\d/)
    expect(copy.pricing.saves).not.toMatch(/\d/)
  })
})

/** แผนธุรกิจ rev.2: ฟรีจำกัด 5 นักเรียน — เคยเขียนว่า "ลูกค้าไม่จำกัด" */
describe('ข้อความหน้าราคา', () => {
  it('แพลนฟรีบอกเพดาน 5 นักเรียน ไม่ใช่ไม่จำกัด', () => {
    const free = copy.pricing.plans[0]
    expect([free.desc, ...free.features].join(' ')).toContain('5 นักเรียน')
    expect([free.desc, ...free.features].join(' ')).not.toContain('ไม่จำกัด')
  })

  it('ไม่เรียกผู้เรียนว่าลูกค้าในหน้าราคา', () => {
    const all = copy.pricing.plans.flatMap((p) => [p.name, p.unit, p.desc, ...p.features]).join(' ')
    expect(all).not.toContain('ลูกค้า')
  })
})
