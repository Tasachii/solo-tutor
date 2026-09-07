import { getSupabaseConfig } from '../integrations/supabaseRest'

/** สิ่งที่ส่งออกไปเมื่อแอปพัง — เท่านี้ ไม่มีชื่อนักเรียน ยอดเงิน หรือ state ทั้งก้อน */
export interface ErrorReport {
  message: string
  stack?: string
  route?: string
  appVersion?: string
  userAgent?: string
  mode?: 'demo' | 'real'
}

/** เวอร์ชันแอป = hash ของบันเดิลที่โหลดอยู่ ไม่ต้องมี build config เพิ่ม */
export function bundleVersion(doc: Document = document): string | undefined {
  const src = doc.querySelector('script[src*="assets/index-"]')?.getAttribute('src') ?? ''
  return src.match(/index-([A-Za-z0-9_-]+)\.js/)?.[1]
}

export function buildErrorReport(
  error: unknown,
  context: { route?: string; mode?: 'demo' | 'real'; userAgent?: string; appVersion?: string } = {},
): ErrorReport {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const stack = error instanceof Error && error.stack ? error.stack.slice(0, 4000) : undefined
  return {
    message: message.slice(0, 500), stack,
    route: context.route?.slice(0, 200), mode: context.mode,
    appVersion: context.appVersion, userAgent: context.userAgent?.slice(0, 300),
  }
}

/** ส่งแบบไม่รอผลและไม่โยน error ซ้อน — ตอนนี้แอปพังอยู่แล้ว ห้ามทำให้แย่ลง · ไม่มีโปรเจกต์ = ไม่ส่ง */
export function reportError(report: ErrorReport, send: typeof fetch = fetch): boolean {
  const config = getSupabaseConfig()
  if (!config) return false
  try {
    void send(`${config.url}/functions/v1/report-error`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report), keepalive: true, signal: AbortSignal.timeout(5000),
    }).catch(() => undefined)
    return true
  } catch {
    return false
  }
}
