import { attestedRows, normalizeUsage, USAGE_VERSION, type VerifiedAccount } from '../../supabase/functions/usage/index.ts'

/**
 * J-12 · ตัวรับต้องไม่เก็บค่าที่ไม่อยู่ในรายการ และต้องไม่ทิ้งทั้งแถวเพราะแหล่งที่มาแปลก
 * ลิงก์โปรโมตอยู่ในมือคนอื่น ใครก็แก้ ?c= เป็นอะไรก็ได้ก่อนส่งต่อ — ตัวรับจึงเป็นด่านสุดท้าย
 */
const equal = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

const VISITOR = '3d1f5c0a-9b2e-4c7d-8f11-6a2b3c4d5e6f'
const SESSION = '7e2a1b3c-4d5e-4f60-9a8b-1c2d3e4f5a6b'
const EVENT_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

const body = (over: Record<string, unknown> = {}) => ({
  v: USAGE_VERSION, event_id: EVENT_ID, teacher_id: VISITOR, session_id: SESSION,
  event: 'landing_view', count: 1, route: 'landing', audience: 'public', mode: null, ...over,
})

Deno.test('คำที่อยู่ในรายการถูกเก็บตามนั้น', () => {
  for (const source of ['line', 'facebook', 'qr', 'pitch', 'friend']) {
    equal(normalizeUsage(body({ campaign: source }))?.campaign, source)
  }
  equal(normalizeUsage(body())?.campaign, null)
  equal(normalizeUsage(body({ campaign: '' }))?.campaign, null)
})

Deno.test('ค่าที่ไม่อยู่ในรายการกลายเป็น unknown และค่าเดิมไม่ถูกเก็บไว้', () => {
  const leaky = 'utm_source=line&invite=0812345678&name=somchai'
  const row = normalizeUsage(body({ campaign: leaky }))
  equal(row?.campaign, 'unknown')
  equal(JSON.stringify(row).includes('0812345678'), false)
  equal(JSON.stringify(row).includes('somchai'), false)
  equal(normalizeUsage(body({ campaign: 'LINE' }))?.campaign, 'unknown')
  equal(normalizeUsage(body({ campaign: 'x'.repeat(400) }))?.campaign, 'unknown')
  // ค่าที่ไม่ใช่ข้อความไม่ทำให้ทั้งแถวหาย — แหล่งที่มาหายไปเฉย ๆ
  equal(normalizeUsage(body({ campaign: 42 }))?.campaign, null)
  equal(normalizeUsage(body({ campaign: { source: 'line' } }))?.event, 'landing_view')
})

Deno.test('แถวที่เซิร์ฟเวอร์ยืนยันเองยกแหล่งที่มาของเหตุการณ์ต้นทางมาด้วย', () => {
  const account: VerifiedAccount = {
    id: '10000000-0000-4000-8000-000000000001',
    createdAt: '2026-09-01T02:00:00.000Z',
    emailConfirmedAt: '2026-09-01T02:05:00.000Z',
  }
  const rows = attestedRows(account, { teacher_id: VISITOR, audience: 'public', campaign: 'qr' })
  equal(rows.map((row) => row.campaign), ['qr', 'qr'])
  equal(attestedRows(account, { teacher_id: VISITOR, audience: 'public', campaign: null })
    .map((row) => row.campaign), [null, null])
})
