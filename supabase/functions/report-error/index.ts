/** รับ error ที่ ErrorBoundary จับได้บนเครื่องผู้ใช้ — ไม่งั้นแอปพังที่ครูแล้วเราไม่มีทางรู้ */
import { admin, jsonBody, jsonError, ok, serveErrors, withCors } from '../_shared/db.ts'

const clip = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null

/** เก็บแค่สิ่งที่ช่วยแก้บั๊ก — ไม่มีชื่อนักเรียน ยอดเงิน หรือ state ทั้งก้อน */
export function normalizeReport(body: Record<string, unknown>): Record<string, unknown> | null {
  const message = clip(body.message, 500)
  if (!message) return null
  const mode = body.mode === 'demo' || body.mode === 'real' ? body.mode : null
  return {
    message, stack: clip(body.stack, 4000), route: clip(body.route, 200),
    app_version: clip(body.appVersion, 64), user_agent: clip(body.userAgent, 300), mode,
  }
}

export const handler = serveErrors(withCors(async (req) => {
  if (req.method !== 'POST') return jsonError(405, 'method-not-allowed')
  const row = normalizeReport(await jsonBody(req))
  if (!row) return jsonError(400, 'invalid-report')
  const { error } = await admin().from('client_errors').insert(row)
  if (error) throw error
  return ok()
}))

if (import.meta.main) Deno.serve(handler)
