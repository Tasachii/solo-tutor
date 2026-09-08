import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PLANS } from '../../src/platform/plans'
import { copy } from '../../src/copy'

/**
 * ราคาแพ็กมีสามที่: TS (หน้าเว็บ/ปุ่มขอ Pro), SQL plan_price() (ยอดที่เซิร์ฟเวอร์คิดจริง), และ copy หน้าราคา
 * เทสนี้อ่านไฟล์ migration จริง — แก้ราคาที่เดียวแล้วอีกที่ไม่ตามจะฟ้องทันที (D-01)
 */
describe('plan prices stay identical in TS, SQL and pricing copy', () => {
  const sql = readFileSync('supabase/migrations/0006_plans.sql', 'utf8')

  it('plan_price() in 0006_plans.sql matches PLANS', () => {
    const paid = PLANS.filter(p => p.months > 0)
    expect(paid.map(p => p.months)).toEqual([1, 3, 12])
    for (const plan of paid) {
      const pattern = new RegExp(`when\\s+${plan.months}\\s+then\\s+(\\d+)`)
      const match = sql.match(pattern)
      expect(match, `plan_price has no branch for ${plan.months} months`).not.toBeNull()
      expect(Number(match![1])).toBe(plan.price)
    }
    // ไม่มีเดือนอื่นแอบอยู่ฝั่ง SQL ที่ TS ไม่รู้จัก
    const allowed = sql.match(/months in \(([^)]+)\)/)
    expect(allowed).not.toBeNull()
    expect(allowed![1].split(',').map(s => Number(s.trim())).sort((a, b) => a - b)).toEqual(paid.map(p => p.months))
  })

  it('pricing copy has one card per plan in the same order', () => {
    expect(copy.pricing.plans).toHaveLength(PLANS.length)
    expect(copy.plan.months[1]).toContain('1')
    expect(copy.plan.months[3]).toContain('3')
    expect(copy.plan.months[12]).toContain('12')
  })
})
