// เปลือกบาง ๆ รอบ Supabase — ฟังก์ชันทุกตัวเรียกผ่านที่นี่ จะได้ mock ได้ตอนเทส
// ตรรกะการตัดสินใจทั้งหมดอยู่ใน src/core/lineProtocol.ts และ src/core/lineDelivery.ts
// ใช้ npm: ของ Deno เอง ไม่ผ่าน esm.sh — เคยพัง CI เพราะ CDN นั้นจ่ายไฟล์ย่อยไม่ครบ
// (Supabase Edge Runtime รองรับ npm specifier อยู่แล้ว)
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const requireEnv = (name: string): string => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing required server configuration: ${name}`)
  return value
}

export const admin = (): SupabaseClient =>
  createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

/** Verify the bearer token with Supabase Auth. Never trust providerId from JSON. */
export async function requireUserId(req: Request): Promise<string> {
  const match = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)
  if (!match) throw new Response('unauthorized', { status: 401 })
  const { data, error } = await admin().auth.getUser(match[1])
  if (error || !data.user) throw new Response('unauthorized', { status: 401 })
  return data.user.id
}

const equal = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return difference === 0
}

export const isCronRequest = (req: Request): boolean => {
  const configured = requireEnv('LINE_CRON_SECRET')
  const supplied = req.headers.get('x-cron-secret') ?? ''
  return !!supplied && equal(configured, supplied)
}

/**
 * ความลับของ channel เก็บแบบเข้ารหัสด้วยคีย์ใน Supabase secrets
 * ห้าม log ค่าที่ถอดแล้วไม่ว่ากรณีใด (แผนข้อ 8)
 */
const keyOf = async (): Promise<CryptoKey> => {
  const secret = requireEnv('LINE_SECRET_KEY')
  if (secret.length < 32) throw new Error('LINE_SECRET_KEY must contain at least 32 characters')
  const raw = new TextEncoder().encode(secret)
  const hash = await crypto.subtle.digest('SHA-256', raw)
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function seal(plain: string): Promise<string> {
  if (!plain) throw new Error('Cannot encrypt an empty secret')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyOf(), new TextEncoder().encode(plain))
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(buf)))}`
}

export async function open(sealed: string): Promise<string> {
  const [ivB64, dataB64] = sealed.split('.')
  if (!ivB64 || !dataB64) throw new Error('Invalid encrypted secret')
  const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
  const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(ivB64) }, await keyOf(), bytes(dataB64))
  return new TextDecoder().decode(buf)
}

export const ok = (body: unknown = { ok: true }): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

export const jsonError = (status: number, error: string): Response =>
  new Response(JSON.stringify({ ok: false, error }), {
    status, headers: { 'Content-Type': 'application/json' },
  })

const corsHeaders = (origin: string): Record<string, string> => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
})

/** Browser endpoints accept exactly the configured GitHub Pages origin. */
export const withCors = (
  handler: (req: Request) => Promise<Response>,
  allowedOrigin: () => string = () => requireEnv('LINE_ALLOWED_ORIGIN'),
) => async (req: Request): Promise<Response> => {
  let allowed: string
  try {
    allowed = new URL(allowedOrigin()).origin
  } catch {
    return jsonError(500, 'server-configuration')
  }
  const origin = req.headers.get('origin')
  if (origin && origin !== allowed) return jsonError(403, 'origin-not-allowed')
  if (req.method === 'OPTIONS') {
    if (!origin) return jsonError(400, 'missing-origin')
    return new Response(null, { status: 204, headers: corsHeaders(allowed) })
  }
  const response = await handler(req)
  if (origin === allowed) {
    for (const [name, value] of Object.entries(corsHeaders(allowed))) response.headers.set(name, value)
  }
  return response
}

export async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await req.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value as Record<string, unknown>
  } catch {
    throw new Response(JSON.stringify({ ok: false, error: 'invalid-json' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }
}

export const serveErrors = (handler: (req: Request) => Promise<Response>) => async (req: Request): Promise<Response> => {
  try {
    return await handler(req)
  } catch (error) {
    if (error instanceof Response) return error
    // Do not leak configuration, database, token, or crypto details to callers.
    console.error('LINE function failed', error instanceof Error ? error.name : 'unknown')
    return jsonError(500, 'server-configuration')
  }
}
