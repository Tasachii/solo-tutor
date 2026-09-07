/** รับรายชื่อจองสิทธิ์รุ่นแรกจากหน้าเว็บ — แทน Google Form ที่ไม่เคยถูกตั้งค่า */
import { admin, jsonBody, jsonError, ok, serveErrors, withCors } from '../_shared/db.ts'

const SIZES = new Set(['<10', '10–30', '31–50', '50+'])
const MODES = new Set(['per_unit', 'flat_monthly', 'package'])

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max ? trimmed : null
}

/** ตรวจรูปร่างและตัดสิ่งที่ไม่รู้จักทิ้ง — client ที่ส่งค่าเพี้ยนไม่ควรทำให้แถวเสีย */
export function normalizeWaitlist(body: Record<string, unknown>): Record<string, unknown> | null {
  const name = text(body.name, 120)
  const contact = text(body.contact, 200)
  const professionId = text(body.professionId, 40)
  if (!name || !contact || !professionId) return null
  const size = text(body.size, 20)
  const modes = Array.isArray(body.modes) ? body.modes.filter((m): m is string => typeof m === 'string' && MODES.has(m)) : []
  return {
    profession_id: professionId, name, contact,
    size: size && SIZES.has(size) ? size : null,
    modes, concierge: typeof body.concierge === 'boolean' ? body.concierge : null,
  }
}

export const handler = serveErrors(withCors(async (req) => {
  if (req.method !== 'POST') return jsonError(405, 'method-not-allowed')
  const row = normalizeWaitlist(await jsonBody(req))
  if (!row) return jsonError(400, 'invalid-entry')
  const { error } = await admin().from('waitlist').insert(row)
  if (error) throw error
  return ok()
}))

if (import.meta.main) Deno.serve(handler)
