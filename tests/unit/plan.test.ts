import { beforeEach, describe, expect, it } from 'vitest'
import { buildScenario } from '../../src/core/scenarios'
import { FREE_STUDENT_CAP, PLAN_KEY, activeStudents, daysLeft, isPro, readPlanInfo, studentCapIssue, writePlanInfo, type PlanInfo } from '../../src/core/plan'
import { PLANS } from '../../src/platform/plans'

const today = '2025-09-02'
const info = (over: Partial<PlanInfo>): PlanInfo => ({ plan: 'pro', planUntil: '2025-12-31', pausedAt: null, fetchedAt: 'x', ...over })

describe('plan', () => {
  it('Pro ใช้ได้เมื่อยังไม่หมดอายุและไม่ได้พัก — หมดอายุ/พัก/ฟรี/ไม่มีข้อมูล = ฟรี', () => {
    expect(isPro(info({}), today)).toBe(true)
    expect(isPro(info({ planUntil: today }), today)).toBe(true)
    expect(isPro(info({ planUntil: '2025-09-01' }), today)).toBe(false)
    expect(isPro(info({ pausedAt: '2025-09-01T00:00:00Z' }), today)).toBe(false)
    expect(isPro(info({ plan: 'free' }), today)).toBe(false)
    expect(isPro(null, today)).toBe(false)
  })
  it('daysLeft นับถึงวันหมดอายุ ไม่ติดลบ', () => {
    expect(daysLeft(info({ planUntil: '2025-09-12' }), today)).toBe(10)
    expect(daysLeft(info({ planUntil: '2025-08-01' }), today)).toBe(0)
    expect(daysLeft(info({ plan: 'free', planUntil: null }), today)).toBeNull()
  })
  it('เพดานฟรีบังคับเฉพาะโหมดจริง — เดโมมี 8 คนก็เพิ่มได้', () => {
    const demo = buildScenario('default')
    expect(activeStudents(demo)).toBeGreaterThan(FREE_STUDENT_CAP)
    expect(studentCapIssue(demo, null, 1)).toBeNull()
    const real = { ...demo, mode: 'real' as const }
    expect(studentCapIssue(real, null, 1)).toEqual({ have: activeStudents(real), cap: FREE_STUDENT_CAP, adding: 1 })
    expect(studentCapIssue(real, info({}), 30)).toBeNull()
    expect(studentCapIssue(real, info({ pausedAt: '2025-09-01T00:00:00Z' }), 1)).not.toBeNull()
  })
  it('เพดานคือ 5 คนที่ยังเรียนอยู่ — คนที่หยุดแล้วไม่นับ และเพิ่มหลายคนนับรวม', () => {
    const base = buildScenario('default')
    const five = base.subjects.slice(0, 5).map((s) => ({ ...s, active: true }))
    const stopped = base.subjects.slice(5).map((s) => ({ ...s, active: false }))
    const real = { ...base, mode: 'real' as const, subjects: [...five, ...stopped] }
    expect(studentCapIssue(real, null, 1)).toEqual({ have: 5, cap: 5, adding: 1 })
    const four = { ...real, subjects: [...five.slice(0, 4), ...stopped] }
    expect(studentCapIssue(four, null, 1)).toBeNull()
    expect(studentCapIssue(four, null, 2)).toEqual({ have: 4, cap: 5, adding: 2 })
  })
  it('ราคาในแอปตรงกับที่เซิร์ฟเวอร์คิด (plan_price ใน 0006_plans.sql)', () => {
    expect(PLANS.map((p) => [p.months, p.price])).toEqual([[0, 0], [1, 299], [3, 799], [12, 2490]])
  })
})

describe('plan info storage', () => {
  beforeEach(() => localStorage.removeItem(PLAN_KEY))
  it('เขียนอ่านกลับ · ค่าขยะเป็น null', () => {
    writePlanInfo(info({}))
    expect(readPlanInfo()).toEqual(info({}))
    localStorage.setItem(PLAN_KEY, '{"plan":"gold"}')
    expect(readPlanInfo()).toBeNull()
  })
})
