/** รับตัวนับการใช้งาน — anonymous ใช้ UUID เครื่อง; bearer ที่ส่งมาต้อง verify ก่อนผูกบัญชี */
import { admin, enforcePublicRateLimit, jsonBody, jsonError, ok, optionalUserId, serveErrors, withCors } from '../_shared/db.ts'

const EVENTS = new Set(['app_open', 'students_changed', 'invoice_issued', 'payment_recorded'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** รับเฉพาะ 4 ช่องที่ตกลงไว้ อย่างอื่นทิ้ง — client ที่ส่งชื่อเด็กมาโดยพลาดต้องไม่มีทางลงตาราง */
export function normalizeUsage(body: Record<string, unknown>): Record<string, unknown> | null {
  const teacherId = typeof body.teacher_id === 'string' && UUID.test(body.teacher_id) ? body.teacher_id.toLowerCase() : null
  const event = typeof body.event === 'string' && EVENTS.has(body.event) ? body.event : null
  const count = typeof body.count === 'number' && Number.isInteger(body.count) && body.count >= 0 && body.count <= 10000 ? body.count : null
  if (!teacherId || !event || count === null) return null
  const mode = body.mode === 'demo' || body.mode === 'real' ? body.mode : null
  return { teacher_id: teacherId, event, count, mode }
}

export const handler = serveErrors(withCors(async (req) => {
  if (req.method !== 'POST') return jsonError(405, 'method-not-allowed')
  const db = admin()
  const limited = await enforcePublicRateLimit(req, 'usage', {
    client: 60, global: 5_000, windowSeconds: 600,
  }, db)
  if (limited) return limited
  const providerId = await optionalUserId(req)
  const row = normalizeUsage(await jsonBody(req, 2_048))
  if (!row) return jsonError(400, 'invalid-event')
  const { error } = await db.from('usage_events').insert({ ...row, provider_id: providerId })
  if (error) throw error
  return ok()
}, undefined, true))

if (import.meta.main) Deno.serve(handler)
