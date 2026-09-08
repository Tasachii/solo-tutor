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
  // Exception text and URL hashes can contain names, receipts or recovery tokens.
  // Keep only the error category and built asset locations, never arbitrary input.
  const names = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'SupabaseRestError'])
  const name = error instanceof Error && names.has(error.name) ? error.name : 'Error'
  const reactCode = error instanceof Error ? error.message.match(/^Minified React error #(\d+)/)?.[1] : undefined
  const message = reactCode ? `React error #${reactCode}` : `${name}: application failure`
  const frames = error instanceof Error && error.stack
    ? [...error.stack.matchAll(/(?:assets\/)([A-Za-z0-9_.-]+\.js):([0-9]+):([0-9]+)/g)]
      .map((match) => `assets/${match[1]}:${match[2]}:${match[3]}`) : []
  const stack = frames.length ? frames.join('\n').slice(0, 4000) : undefined
  return {
    message, stack,
    route: context.route ? reportRoute(context.route) : undefined, mode: context.mode,
    appVersion: context.appVersion, userAgent: context.userAgent?.slice(0, 300),
  }
}

export function reportRoute(route: string): string {
  const path = route.split('?')[0]
  if (/^#\/document\//.test(path)) return '#/document/:token'
  if (/^#\/(client|receipt)\//.test(path)) return `#/${path.split('/')[1]}/:id`
  if (/^#\/app\/subjects\//.test(path)) return '#/app/subjects/:id'
  return /^#\/(?:|pricing|privacy|terms|start|app\/(?:today|subjects|billing|admin|receipts|onboarding|help|settings\/(?:account|line)))$/.test(path)
    ? path : '#/unknown'
}

/** Capture asynchronous failures without suppressing normal browser diagnostics. */
export function installErrorMonitoring(target: Window = window): () => void {
  const recent = new Map<string, number>()
  const capture = (error: unknown) => {
    const report = buildErrorReport(error, {
      route: target.location.hash, appVersion: bundleVersion(target.document), userAgent: target.navigator.userAgent,
    })
    const key = JSON.stringify(report)
    const now = Date.now()
    for (const [seen, at] of recent) if (now - at >= 60_000) recent.delete(seen)
    if (recent.has(key) || recent.size >= 10) return
    recent.set(key, now)
    reportError(report)
  }
  const onError = (event: ErrorEvent) => capture(event.error)
  const onRejection = (event: PromiseRejectionEvent) => capture(event.reason)
  const onRequest = () => capture(new Error('request failed'))
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  target.addEventListener('solo:request-error', onRequest)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
    target.removeEventListener('solo:request-error', onRequest)
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
