import { describe, expect, it } from 'vitest'
import { LANDING_STAY_HREF, shouldEnterApp, wantsToStay } from '../../src/core/entry'

const base = { standalone: false, mode: 'demo' as const, onboarded: false, hasSubjects: false, search: '' }

describe('shouldEnterApp — หน้าแรกเป็นของคนใหม่ ครูที่ใช้จริงแล้วเข้าแอปเลย', () => {
  it('เดโมเห็นหน้าแรกเสมอ แม้มีข้อมูลสมมติ', () => {
    expect(shouldEnterApp(base)).toBe(false)
    expect(shouldEnterApp({ ...base, onboarded: true, hasSubjects: true })).toBe(false)
  })

  it('แอปที่ติดตั้งแล้วเปิดที่หน้าวันนี้ ไม่ว่าโหมดไหน', () => {
    expect(shouldEnterApp({ ...base, standalone: true })).toBe(true)
    expect(shouldEnterApp({ ...base, standalone: true, mode: 'real' })).toBe(true)
  })

  it('โหมดจริงที่ผ่าน onboarding หรือมีนักเรียนแล้ว → เข้าแอป', () => {
    expect(shouldEnterApp({ ...base, mode: 'real', onboarded: true })).toBe(true)
    expect(shouldEnterApp({ ...base, mode: 'real', hasSubjects: true })).toBe(true)
  })

  it('โหมดจริงที่เพิ่งเริ่มแล้วถอยออกมา ยังเห็นหน้าแรก (ไม่ดันเข้า onboarding ซ้ำ)', () => {
    expect(shouldEnterApp({ ...base, mode: 'real' })).toBe(false)
  })

  it('?stay=1 คือทางกลับมาดูหน้าขาย และลิงก์กลับหน้าแรกใช้ค่านี้', () => {
    expect(shouldEnterApp({ ...base, mode: 'real', onboarded: true, search: '?stay=1' })).toBe(false)
    expect(shouldEnterApp({ ...base, mode: 'real', onboarded: true, search: '?stay=0' })).toBe(true)
    expect(wantsToStay(LANDING_STAY_HREF.slice(1))).toBe(true)
    expect(wantsToStay('')).toBe(false)
  })
})
