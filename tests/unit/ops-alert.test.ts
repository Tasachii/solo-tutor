import { describe, expect, it } from 'vitest'
import { COMMENT_COOLDOWN_MS, alertBody, alertTitle, decideAlert, raiseAlert } from '../../scripts/ops-alert.mjs'

/** แจ้งเตือนงาน scheduled ที่ล้ม — หนึ่ง issue ต่อ check ไม่ spam ไม่มี PII */
describe('ops alert', () => {
  const now = Date.parse('2026-09-08T10:00:00Z')
  it('ไม่มี issue เปิดอยู่ → เปิดใหม่ · มีแล้วและเงียบเกิน 6 ชม. → comment · เพิ่งอัปเดต → เงียบ', () => {
    expect(decideAlert('backup', [], now)).toEqual({ action: 'create', title: '[ops] backup ล้ม' })
    const stale = [{ number: 7, title: '[ops] backup ล้ม', updated_at: new Date(now - COMMENT_COOLDOWN_MS - 1).toISOString() }]
    expect(decideAlert('backup', stale, now)).toEqual({ action: 'comment', number: 7 })
    const fresh = [{ number: 7, title: '[ops] backup ล้ม', updated_at: new Date(now - 60_000).toISOString() }]
    expect(decideAlert('backup', fresh, now)).toEqual({ action: 'skip', number: 7 })
    // issue ของ check อื่นไม่นับ
    expect(decideAlert('uptime', fresh, now).action).toBe('create')
  })
  it('ข้อความมีแค่ชื่อ check กับลิงก์ run', () => {
    const body = alertBody('uptime', 'https://github.com/o/r/actions/runs/1')
    expect(body).toContain('uptime'); expect(body).toContain('https://github.com/o/r/actions/runs/1')
    expect(alertTitle('uptime')).toBe('[ops] uptime ล้ม')
  })
  it('run URL นอก github.com หรือ webhook ที่ไม่ใช่ https ถูกปฏิเสธก่อนยิงอะไร', async () => {
    await expect(raiseAlert({ token: 't', repo: 'o/r', check: 'x', runUrl: 'https://evil.example/run' })).rejects.toThrow(/github\.com/)
    await expect(raiseAlert({ token: 't', repo: 'o/r', check: 'x', runUrl: 'https://github.com/o/r/actions/runs/1', webhook: 'http://x' }))
      .rejects.toThrow()
  })
})
