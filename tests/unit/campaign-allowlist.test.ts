import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { CAMPAIGNS, adoptCampaign, currentCampaign, resetUsageKeys, usagePayload } from '../../src/core/usage'

/**
 * J-12 · แหล่งที่มามีรายการเดียวกันสามที่: เบราว์เซอร์ ตัวรับ และ constraint ในฐานข้อมูล
 * ถ้าสามที่ไม่ตรงกัน อาการจะเงียบมาก — ตัวรับส่งคำที่ฐานไม่รับ แถวหายทั้งแถวโดยไม่มีใครเห็น
 * เทสนี้อ่านไฟล์จริงทั้งสาม เพิ่มค่าใหม่ที่เดียวแล้วลืมอีกสองที่จะฟ้องทันที
 */
const quoted = (block: string): string[] => [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])

afterEach(() => { localStorage.clear(); resetUsageKeys() })

describe('รายการแหล่งที่มาตรงกันทั้งสามที่', () => {
  it('constraint ใน 0016_owner_analytics.sql = รายการของเบราว์เซอร์ + unknown', () => {
    const sql = readFileSync('supabase/migrations/0016_owner_analytics.sql', 'utf8')
    const match = sql.match(/campaign is null or campaign in \(([^)]+)\)/)
    expect(match, 'ไม่พบ check constraint ของ campaign').not.toBeNull()
    expect(quoted(match![1])).toEqual([...CAMPAIGNS, 'unknown'])
  })

  it('ตัวรับใน supabase/functions/usage ใช้รายการเดียวกับเบราว์เซอร์', () => {
    const edge = readFileSync('supabase/functions/usage/index.ts', 'utf8')
    const match = edge.match(/const CAMPAIGNS = new Set\(\[([^\]]+)\]\)/)
    expect(match, 'ไม่พบรายการแหล่งที่มาในตัวรับ').not.toBeNull()
    expect(quoted(match![1])).toEqual([...CAMPAIGNS])
  })
})

describe('อ่าน ?c= แล้วเก็บเฉพาะคำในรายการ', () => {
  it('คำในรายการถูกจำไว้ และติดไปกับ payload ทุกเหตุการณ์', () => {
    adoptCampaign('?c=line')
    expect(currentCampaign()).toBe('line')
    expect(usagePayload('landing_view', 1, { route: 'landing' })?.campaign).toBe('line')
  })

  it('ค่าที่ไม่อยู่ในรายการกลายเป็น unknown และค่าเดิมไม่ถูกเก็บไว้ที่ไหนเลย', () => {
    adoptCampaign('?c=' + encodeURIComponent('utm_source=fb&name=สมชาย'))
    expect(currentCampaign()).toBe('unknown')
    const stored = Object.keys(localStorage).map((key) => String(localStorage.getItem(key))).join('|')
    expect(stored).not.toContain('utm_source')
    expect(stored).not.toContain('สมชาย')
  })

  it('ครั้งแรกชนะ — ลิงก์ที่กดทีหลังไม่เขียนทับคำตอบว่ารู้จักเราจากที่ไหน', () => {
    adoptCampaign('?c=qr')
    adoptCampaign('?c=facebook')
    expect(currentCampaign()).toBe('qr')
  })

  it('ไม่มี ?c= = ไม่มีแหล่งที่มา ไม่ใช่เดาว่ามาจากไหน', () => {
    adoptCampaign('?qa=0')
    expect(currentCampaign()).toBeNull()
    expect(usagePayload('landing_view', 1, { route: 'landing' })?.campaign).toBeNull()
  })
})
