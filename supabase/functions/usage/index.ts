/**
 * รับตัวนับการใช้งาน — ผู้เยี่ยมชมใช้ UUID ของเครื่อง; bearer ที่ส่งมาต้อง verify ก่อนผูกบัญชี
 * เบราว์เซอร์ส่งได้เฉพาะชื่อใน CLIENT_EVENTS · signup_completed/email_verified เซิร์ฟเวอร์เขียนเองจากสถานะ Auth
 * event_id เป็นกุญแจกันนับซ้ำ: ยิงซ้ำด้วย id เดิมได้ 200 แต่ไม่เพิ่มแถว
 */
import { admin, enforcePublicRateLimit, jsonBody, jsonError, ok, serveErrors, withCors } from '../_shared/db.ts'

export const USAGE_VERSION = 2

const CLIENT_EVENTS = new Set([
  'landing_view', 'pricing_view',
  'demo_started', 'demo_completed',
  'signup_started', 'onboarding_completed',
  'app_open', 'students_changed', 'invoice_issued', 'payment_recorded',
])
/** ชื่อที่ client อ้างเองไม่ได้ — ส่งมาเมื่อไหร่ถือว่า payload ไม่ถูกต้อง */
const SERVER_EVENTS = ['signup_completed', 'email_verified'] as const
const ROUTES = new Set(['landing', 'pricing', 'legal', 'start', 'login', 'app', 'other'])
/**
 * J-12 · แหล่งที่มาที่เก็บได้ — ต้องตรงกับ src/core/usage.ts และ 0016_owner_analytics.sql
 * ค่าที่ไม่อยู่ในรายการกลายเป็น 'unknown' ไม่ใช่ทิ้งทั้งแถวและไม่ใช่เก็บตามที่ส่งมา
 * ถ้ารายการนี้ล้ำหน้ารายการในฐานข้อมูล การบันทึกจะล้ม — แก้ migration และ deploy ก่อนเสมอ
 */
const CAMPAIGNS = new Set(['line', 'facebook', 'qr', 'pitch', 'friend'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
/** payload ที่ตกลงไว้ยาวไม่ถึง 400 ไบต์ — เผื่อไว้พอสมควรแล้วปฏิเสธส่วนเกินก่อนอ่านจนจบ */
const MAX_BODY_BYTES = 1_024

export type UsageMode = 'demo' | 'real'
export type Audience = 'public' | 'team'

export interface UsageRow {
  event_id: string
  teacher_id: string
  session_id: string | null
  event: string
  count: number
  mode: UsageMode | null
  route: string | null
  audience: Audience
  campaign: string | null
  version: number
  at?: string
}

/** สิ่งที่ Auth ยืนยันได้จริง — ไม่ใช่สิ่งที่เบราว์เซอร์อ้าง */
export interface VerifiedAccount {
  id: string
  createdAt: string | null
  emailConfirmedAt: string | null
}

type WriteResult = { error: { code?: string; message?: string } | null }
export interface UsageDb {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>
  from(table: string): {
    upsert(
      values: Record<string, unknown>[],
      options: { onConflict: string; ignoreDuplicates: boolean },
    ): PromiseLike<WriteResult>
  }
}

type MirrorConfig = { url?: string; secret?: string }

export function validUsageSheetsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'script.google.com'
      && !url.username && !url.password && !url.search && !url.hash
      && /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)
  } catch {
    return false
  }
}

/**
 * รับเฉพาะช่องที่ตกลงไว้ อย่างอื่นทิ้ง — client ที่ส่งชื่อเด็กมาโดยพลาดต้องไม่มีทางลงตาราง
 * route รับได้เฉพาะชื่อหมวด ไม่ใช่ path จริง; เวลาที่ client อ้างถูกทิ้ง เซิร์ฟเวอร์ตั้ง at เอง
 */
export function normalizeUsage(body: Record<string, unknown>): UsageRow | null {
  const eventId = typeof body.event_id === 'string' && UUID.test(body.event_id) ? body.event_id.toLowerCase() : null
  const teacherId = typeof body.teacher_id === 'string' && UUID.test(body.teacher_id) ? body.teacher_id.toLowerCase() : null
  const sessionId = typeof body.session_id === 'string' && UUID.test(body.session_id) ? body.session_id.toLowerCase() : null
  const event = typeof body.event === 'string' && CLIENT_EVENTS.has(body.event) ? body.event : null
  const count = typeof body.count === 'number' && Number.isInteger(body.count) && body.count >= 0 && body.count <= 10000
    ? body.count : null
  const audience = body.audience === 'public' || body.audience === 'team' ? body.audience : null
  const version = body.v === USAGE_VERSION ? USAGE_VERSION : null
  if (!eventId || !teacherId || !sessionId || !event || count === null || !audience || !version) return null
  const mode = body.mode === 'demo' || body.mode === 'real' ? body.mode : null
  const route = typeof body.route === 'string' && ROUTES.has(body.route) ? body.route : null
  // ค่าที่ส่งมาแล้วไม่อยู่ในรายการไม่ถูกเก็บไว้เลย — บันทึกว่า 'unknown' แทน
  const campaign = typeof body.campaign === 'string' && body.campaign !== ''
    ? (CAMPAIGNS.has(body.campaign) ? body.campaign : 'unknown') : null
  return { event_id: eventId, teacher_id: teacherId, session_id: sessionId, event, count, mode, route, audience, campaign, version }
}

const usableTime = (value: string | null): string | null =>
  value && Number.isFinite(Date.parse(value)) ? value : null

/**
 * แถวที่มาจาก Auth ล้วน ๆ: บัญชีถูกสร้างเมื่อไหร่ และยืนยันอีเมลแล้วหรือยัง
 * event_id ผูกกับ user id ตายตัว จึงมีได้บัญชีละหนึ่งแถวตลอดกาลไม่ว่าจะยิงกี่ครั้ง
 * at ใช้เวลาที่ Auth บันทึกไว้จริง cohort จึงตรงแม้เราเพิ่งเห็นบัญชีนั้นวันนี้
 * id ขึ้นต้นด้วย srv: ซึ่งไม่ใช่รูป UUID — client จึงจองหรือชนกุญแจนี้ไม่ได้
 */
export function attestedRows(account: VerifiedAccount, source: Pick<UsageRow, 'teacher_id' | 'audience' | 'campaign'>): UsageRow[] {
  const base = {
    teacher_id: source.teacher_id, session_id: null, count: 1,
    mode: 'real' as const, route: null, audience: source.audience,
    // แหล่งที่มายกมาจากเหตุการณ์ที่ทำให้เรารู้จักบัญชีนี้ ปลายทางของ funnel จึงอยู่แกนเดียวกับต้นทาง
    campaign: source.campaign, version: USAGE_VERSION,
  }
  const rows: UsageRow[] = []
  const createdAt = usableTime(account.createdAt)
  if (createdAt) rows.push({ ...base, event_id: `srv:signup_completed:${account.id}`, event: 'signup_completed', at: createdAt })
  const confirmedAt = usableTime(account.emailConfirmedAt)
  if (confirmedAt) rows.push({ ...base, event_id: `srv:email_verified:${account.id}`, event: 'email_verified', at: confirmedAt })
  return rows
}

/** The mirror can only ever see these four fields — route, session and audience never reach it. */
export type MirrorRow = Pick<UsageRow, 'teacher_id' | 'event' | 'count' | 'mode'>

/**
 * The Apps Script receiver (docs/usage-sheets/Code.gs) allow-lists these four names and silently
 * drops anything else. Mirroring a name it will not store would look like a working copy and
 * quietly lose rows, so the mirror stays on the four names both sides already agree on.
 * Widen this set only together with the receiver.
 */
const MIRRORED_EVENTS = new Set(['app_open', 'students_changed', 'invoice_issued', 'payment_recorded'])

/** Mirror contains no provider id, names, amounts, mode, route, or device metadata. */
export function usageMirrorPayload(row: MirrorRow, at: Date, secret: string) {
  return {
    format: 'solo-usage-1', secret,
    rows: [{ random_id: row.teacher_id, event: row.event, count: row.count, at: at.toISOString() }],
  }
}

/** Optional operational mirror. Its failure never changes the accepted Supabase event. */
export async function mirrorUsage(
  row: MirrorRow,
  at = new Date(),
  send: typeof fetch = fetch,
  config: MirrorConfig = {
    url: Deno.env.get('USAGE_SHEETS_WEBHOOK_URL')?.trim(),
    secret: Deno.env.get('USAGE_SHEETS_WEBHOOK_SECRET')?.trim(),
  },
): Promise<boolean> {
  const url = config.url?.trim() ?? ''
  const secret = config.secret?.trim() ?? ''
  if (row.mode !== 'real' || !MIRRORED_EVENTS.has(row.event) || !validUsageSheetsUrl(url) || secret.length < 24) return false
  try {
    const response = await send(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(usageMirrorPayload(row, at, secret)),
      signal: AbortSignal.timeout(4_000),
    })
    const result = await response.json().catch(() => null) as { ok?: unknown } | null
    return response.ok && result?.ok === true
  } catch {
    return false
  }
}

export type VerifyAccount = (token: string) => Promise<VerifiedAccount | null>

/** Verify the bearer with Supabase Auth and keep only the three account facts we record. */
const verifyWithAuth: VerifyAccount = async (token) => {
  const { data, error } = await admin().auth.getUser(token)
  if (error || !data.user) return null
  const user = data.user as { id: string; created_at?: string | null; email_confirmed_at?: string | null }
  return { id: user.id, createdAt: user.created_at ?? null, emailConfirmedAt: user.email_confirmed_at ?? null }
}

export interface UsageDeps {
  db: () => UsageDb
  verify: VerifyAccount
  mirror: typeof mirrorUsage
}

export const buildHandler = (deps: Partial<UsageDeps> = {}) => {
  const openDb = deps.db ?? (() => admin() as unknown as UsageDb)
  const verify = deps.verify ?? verifyWithAuth
  const mirror = deps.mirror ?? mirrorUsage
  return serveErrors(withCors(async (req) => {
    if (req.method !== 'POST') return jsonError(405, 'method-not-allowed')
    const db = openDb()
    const limited = await enforcePublicRateLimit(req, 'usage', {
      client: 120, global: 20_000, windowSeconds: 600,
    }, db)
    if (limited) return limited
    // bearer ที่ส่งมาต้อง verify ผ่านเสมอ; ไม่ส่งมาเลยคือผู้เยี่ยมชมที่ยังไม่มีบัญชี
    const header = req.headers.get('authorization')
    let account: VerifiedAccount | null = null
    if (header) {
      const token = header.match(/^Bearer\s+(.+)$/i)?.[1] ?? null
      account = token ? await verify(token) : null
      if (!account) return jsonError(401, 'unauthorized')
    }
    const row = normalizeUsage(await jsonBody(req, MAX_BODY_BYTES))
    if (!row) return jsonError(400, 'invalid-event')
    const rows = [
      { ...row, provider_id: account?.id ?? null },
      ...(account ? attestedRows(account, row).map((attested) => ({ ...attested, provider_id: account.id })) : []),
    ]
    // event_id ซ้ำ = ยิงซ้ำของเหตุการณ์เดิม ตอบสำเร็จโดยไม่เพิ่มแถว
    const { error } = await db.from('usage_events').upsert(rows, { onConflict: 'event_id', ignoreDuplicates: true })
    if (error) throw error
    await mirror(row)
    return ok()
  }, undefined, true))
}

export const handler = buildHandler()

/** ชื่อที่มีแต่เซิร์ฟเวอร์เขียนได้ — export ไว้ให้เทสตรึงว่าเบราว์เซอร์ส่งมาแล้วถูกปฏิเสธ */
export const serverOnlyEvents: readonly string[] = SERVER_EVENTS

if (import.meta.main) Deno.serve(handler)
