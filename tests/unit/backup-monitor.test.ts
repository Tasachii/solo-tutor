import { expect, it } from 'vitest'
// @ts-expect-error Node operations script deliberately has no generated declaration file.
import { backupIsFresh } from '../../scripts/check-backup-freshness.mjs'

it('backup freshness requires recent completed success and rejects malformed/future times', () => {
  const now = Date.parse('2026-09-08T00:00:00Z')
  // backup รันรายวัน — สดคือภายใน 2 วัน (RPO 24 ชม. + เผื่อพลาดหนึ่งรอบ)
  const run = { status: 'completed', conclusion: 'success', created_at: '2026-09-07T00:00:00Z' }
  expect(backupIsFresh([run], now)).toBe(true)
  expect(backupIsFresh([{ ...run, created_at: '2026-09-05T00:00:00Z' }], now)).toBe(false)
  expect(backupIsFresh([{ ...run, created_at: '2026-08-01T00:00:00Z' }], now)).toBe(false)
  expect(backupIsFresh([{ ...run, conclusion: 'failure' }], now)).toBe(false)
  expect(backupIsFresh([{ ...run, created_at: '2026-09-09T00:00:00Z' }], now)).toBe(false)
  expect(backupIsFresh([{ ...run, created_at: 'invalid' }], now)).toBe(false)
  expect(backupIsFresh([], now)).toBe(false)
})
