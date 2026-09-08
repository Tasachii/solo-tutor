export type SupabaseConfig = {
  url: string
  publishableKey: string
}

export type SupabaseSession = {
  user: { id: string; email?: string }
  access_token: string
  refresh_token: string
  expires_at: number
}

type StoredSession = {
  version: 1
  url: string
  session: SupabaseSession
}

type AuthResponse = {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  expires_at?: unknown
  user?: { id?: unknown; email?: unknown }
}

const SESSION_PREFIX = 'solo-tutor:supabase-session:'
const REQUEST_TIMEOUT_MS = 12_000
const REFRESH_EARLY_SECONDS = 30

let authGeneration = 0
let refreshInFlight: Promise<SupabaseSession> | null = null

const reportRequestFailure = (): void => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('solo:request-error'))
}

export class SupabaseRestError extends Error {
  readonly code: string
  readonly status?: number

  constructor(code: string, message: string, status?: number) {
    super(message)
    this.name = 'SupabaseRestError'
    this.code = code
    this.status = status
  }
}

const envValue = (name: string): string => {
  const value = (import.meta.env as Record<string, unknown>)[name]
  return typeof value === 'string' ? value.trim() : ''
}

const decodeJwtRole = (key: string): string | undefined => {
  const payload = key.split('.')[1]
  if (!payload) return undefined
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const parsed = JSON.parse(atob(padded)) as { role?: unknown }
    return typeof parsed.role === 'string' ? parsed.role : undefined
  } catch {
    return undefined
  }
}

const isPublicBrowserKey = (key: string): boolean => {
  if (!key || key.startsWith('sb_secret_') || /service[_-]?role/i.test(key)) return false
  return key.startsWith('sb_publishable_') || decodeJwtRole(key) === 'anon'
}

const normalizeProjectUrl = (raw: string): string | null => {
  try {
    const url = new URL(raw)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password) return null
    if (url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return null
    return url.origin
  } catch {
    return null
  }
}

export const getSupabaseConfig = (): SupabaseConfig | null => {
  const url = normalizeProjectUrl(envValue('VITE_SUPABASE_URL'))
  const publishableKey = envValue('VITE_SUPABASE_PUBLISHABLE_KEY') || envValue('VITE_SUPABASE_ANON_KEY')
  if (!url || !isPublicBrowserKey(publishableKey)) return null
  return { url, publishableKey }
}

const requireConfig = (): SupabaseConfig => {
  const config = getSupabaseConfig()
  if (!config) {
    throw new SupabaseRestError('not-configured', 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ Supabase')
  }
  return config
}

const storageKey = (config: SupabaseConfig): string => `${SESSION_PREFIX}${encodeURIComponent(config.url)}`

/**
 * localStorage ไม่ใช่ sessionStorage — แอปที่ติดตั้งลงจอเปิดใหม่ทุกวัน ถ้าต้องเข้าสู่ระบบทุกครั้ง
 * ครูจะเลิกใช้ซิงก์ · ledger เองก็อยู่ใน localStorage อยู่แล้ว การเก็บ refresh token ที่นี่ไม่ได้เพิ่มความเสี่ยงของเครื่อง
 */
const storage = (): Storage => {
  try {
    if (typeof localStorage === 'undefined') throw new Error('missing')
    // Access itself can throw when storage is disabled by the browser.
    void localStorage.length
    return localStorage
  } catch {
    throw new SupabaseRestError('storage-unavailable', 'เบราว์เซอร์ไม่อนุญาตให้เก็บสถานะการเข้าสู่ระบบ')
  }
}

const assertStorageWritable = (config: SupabaseConfig): Storage => {
  const target = storage()
  const probe = `${storageKey(config)}:probe`
  try {
    target.setItem(probe, '1')
    target.removeItem(probe)
    return target
  } catch {
    throw new SupabaseRestError('storage-unavailable', 'เบราว์เซอร์ไม่อนุญาตให้เก็บสถานะการเข้าสู่ระบบ')
  }
}

const isSession = (value: unknown): value is SupabaseSession => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SupabaseSession>
  return typeof candidate.access_token === 'string' && candidate.access_token.length > 0
    && typeof candidate.refresh_token === 'string' && candidate.refresh_token.length > 0
    && typeof candidate.expires_at === 'number' && Number.isFinite(candidate.expires_at)
    && !!candidate.user && typeof candidate.user.id === 'string' && candidate.user.id.length > 0
    && (candidate.user.email === undefined || typeof candidate.user.email === 'string')
}

const readSession = (config: SupabaseConfig): SupabaseSession | null => {
  const target = storage()
  let raw: string | null
  try {
    raw = target.getItem(storageKey(config))
  } catch {
    throw new SupabaseRestError('storage-unavailable', 'อ่านสถานะการเข้าสู่ระบบไม่ได้')
  }
  if (!raw) return null
  try {
    const saved = JSON.parse(raw) as Partial<StoredSession>
    if (saved.version !== 1 || saved.url !== config.url || !isSession(saved.session)) throw new Error('invalid')
    return saved.session
  } catch {
    try { target.removeItem(storageKey(config)) } catch { /* The safe result remains signed out. */ }
    return null
  }
}

const saveSession = (config: SupabaseConfig, session: SupabaseSession): void => {
  try {
    assertStorageWritable(config).setItem(storageKey(config), JSON.stringify({ version: 1, url: config.url, session } satisfies StoredSession))
  } catch (error) {
    if (error instanceof SupabaseRestError) throw error
    throw new SupabaseRestError('storage-unavailable', 'บันทึกสถานะการเข้าสู่ระบบไม่ได้')
  }
}

export const getSession = (): SupabaseSession | null => {
  const config = getSupabaseConfig()
  return config ? readSession(config) : null
}

const sessionFromAuth = (body: AuthResponse): SupabaseSession => {
  const expiresIn = typeof body.expires_in === 'number' && Number.isFinite(body.expires_in) ? body.expires_in : 3600
  const expiresAt = typeof body.expires_at === 'number' && Number.isFinite(body.expires_at)
    ? body.expires_at
    : Math.floor(Date.now() / 1000) + expiresIn
  const session: SupabaseSession = {
    access_token: typeof body.access_token === 'string' ? body.access_token : '',
    refresh_token: typeof body.refresh_token === 'string' ? body.refresh_token : '',
    expires_at: expiresAt,
    user: {
      id: typeof body.user?.id === 'string' ? body.user.id : '',
      ...(typeof body.user?.email === 'string' ? { email: body.user.email } : {}),
    },
  }
  if (!isSession(session)) throw new SupabaseRestError('invalid-response', 'Supabase ส่งข้อมูลการเข้าสู่ระบบไม่ครบ')
  return session
}

const fetchWithTimeout = async (url: string, init: RequestInit): Promise<Response> => {
  const controller = new AbortController()
  const externalSignal = init.signal
  const abortFromExternal = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) abortFromExternal()
  else externalSignal?.addEventListener('abort', abortFromExternal, { once: true })
  const timer = setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) {
      if (!externalSignal?.aborted) reportRequestFailure()
      throw new SupabaseRestError(externalSignal?.aborted ? 'aborted' : 'timeout', externalSignal?.aborted ? 'ยกเลิกคำขอแล้ว' : 'Supabase ใช้เวลาตอบกลับนานเกินไป')
    }
    reportRequestFailure()
    throw new SupabaseRestError('network', 'เชื่อมต่อ Supabase ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต')
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', abortFromExternal)
  }
}

const safeJson = async (response: Response): Promise<unknown> => {
  if (response.status === 204) return undefined
  try {
    return await response.json()
  } catch {
    if (response.ok) throw new SupabaseRestError('invalid-response', 'Supabase ส่งข้อมูลที่อ่านไม่ได้', response.status)
    return undefined
  }
}

const responseError = (status: number, auth = false, body?: unknown): SupabaseRestError => {
  const remoteCode = body && typeof body === 'object' && 'error' in body
    && (body as { error?: unknown }).error === 'retention-required' ? 'retention-required' : null
  if (remoteCode) return new SupabaseRestError(remoteCode, 'รายการนี้ต้องดำเนินการตามระยะเวลาเก็บข้อมูลทางกฎหมาย', status)
  if (status === 401 || status === 403) {
    return new SupabaseRestError(auth ? 'invalid-credentials' : 'unauthorized', auth ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', status)
  }
  if (status === 429) return new SupabaseRestError('rate-limited', 'ส่งคำขอถี่เกินไป กรุณารอสักครู่', status)
  return new SupabaseRestError('remote-error', `Supabase ทำรายการไม่สำเร็จ (HTTP ${status})`, status)
}

const authRequest = async (config: SupabaseConfig, grant: 'password' | 'refresh_token', body: Record<string, string>): Promise<SupabaseSession> => {
  const response = await fetchWithTimeout(`${config.url}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { apikey: config.publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await safeJson(response)
  if (response.status >= 500) reportRequestFailure()
  if (!response.ok) throw responseError(response.status, grant === 'password')
  return sessionFromAuth((data ?? {}) as AuthResponse)
}

export const signIn = async (email: string, password: string): Promise<SupabaseSession> => {
  const config = requireConfig()
  const target = assertStorageWritable(config)
  const generation = ++authGeneration
  try { target.removeItem(storageKey(config)) } catch { throw new SupabaseRestError('storage-unavailable', 'ล้างสถานะการเข้าสู่ระบบเดิมไม่ได้') }
  const session = await authRequest(config, 'password', { email: email.trim(), password })
  if (generation !== authGeneration) throw new SupabaseRestError('auth-cancelled', 'ยกเลิกการเข้าสู่ระบบแล้ว')
  saveSession(config, session)
  return session
}

/**
 * สมัครใช้งานเอง — trigger ฝั่งฐานข้อมูลสร้างแถว providers ให้อัตโนมัติ
 * คืน session ทันทีเฉพาะตอนปิด "Confirm email" ไว้ ถ้าเปิดไว้ Supabase จะไม่ส่ง token กลับมา
 * กรณีนั้นต้องบอกครูตรง ๆ ว่าให้ไปยืนยันในอีเมล ไม่ใช่ปล่อยให้จอค้างเงียบ ๆ
 */
export const signUp = async (email: string, password: string): Promise<SupabaseSession> => {
  const config = requireConfig()
  const target = assertStorageWritable(config)
  const generation = ++authGeneration
  try { target.removeItem(storageKey(config)) } catch { throw new SupabaseRestError('storage-unavailable', 'ล้างสถานะการเข้าสู่ระบบเดิมไม่ได้') }

  const response = await fetchWithTimeout(`${config.url}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: config.publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }),
  })
  const data = await safeJson(response)
  if (response.status >= 500) reportRequestFailure()
  if (!response.ok) {
    const body = (data ?? {}) as { error_code?: string; msg?: string; message?: string }
    const code = body.error_code ?? ''
    if (response.status === 422 || code === 'user_already_exists' || code === 'email_exists') {
      throw new SupabaseRestError('email-taken', 'อีเมลนี้สมัครไว้แล้ว ลองเข้าสู่ระบบแทน', response.status)
    }
    if (code === 'weak_password') {
      throw new SupabaseRestError('weak-password', 'รหัสผ่านสั้นเกินไป ใช้อย่างน้อย 6 ตัว', response.status)
    }
    throw responseError(response.status)
  }

  // ตรวจจากตัว body ก่อน — sessionFromAuth จะโยน error ทั่วไปทับ ทำให้ไม่รู้ว่าติดที่ยืนยันอีเมล
  const body = (data ?? {}) as AuthResponse
  if (!body.access_token) {
    throw new SupabaseRestError('confirm-required', 'สมัครแล้ว กรุณากดยืนยันในอีเมลก่อนเข้าสู่ระบบ', response.status)
  }
  const session = sessionFromAuth(body)
  if (generation !== authGeneration) throw new SupabaseRestError('auth-cancelled', 'ยกเลิกการสมัครแล้ว')
  saveSession(config, session)
  return session
}

export const signOut = (): void => {
  const config = getSupabaseConfig()
  authGeneration += 1
  refreshInFlight = null
  if (!config) return
  try {
    storage().removeItem(storageKey(config))
  } catch {
    throw new SupabaseRestError('storage-unavailable', 'ล้างสถานะการเข้าสู่ระบบไม่ได้')
  }
}

const refreshSession = (config: SupabaseConfig, current: SupabaseSession): Promise<SupabaseSession> => {
  if (refreshInFlight) return refreshInFlight
  const generation = authGeneration
  const pending = (async () => {
    const next = await authRequest(config, 'refresh_token', { refresh_token: current.refresh_token })
    if (generation !== authGeneration) throw new SupabaseRestError('auth-cancelled', 'เซสชันนี้ถูกออกจากระบบแล้ว')
    saveSession(config, next)
    return next
  })()
  let guarded!: Promise<SupabaseSession>
  guarded = pending.finally(() => {
    if (refreshInFlight === guarded) refreshInFlight = null
  })
  refreshInFlight = guarded
  return guarded
}

const freshSession = async (config: SupabaseConfig, force = false): Promise<SupabaseSession> => {
  assertStorageWritable(config)
  const current = readSession(config)
  if (!current) throw new SupabaseRestError('auth-required', 'กรุณาเข้าสู่ระบบก่อน')
  if (!force && current.expires_at > Math.floor(Date.now() / 1000) + REFRESH_EARLY_SECONDS) return current
  return refreshSession(config, current)
}

const endpoint = (config: SupabaseConfig, path: string): string => {
  if (!path.startsWith('/') || path.startsWith('//')) throw new SupabaseRestError('invalid-path', 'ปลายทาง Supabase ไม่ถูกต้อง')
  const url = new URL(path, config.url)
  if (url.origin !== config.url) throw new SupabaseRestError('invalid-path', 'ปลายทาง Supabase ไม่ถูกต้อง')
  return url.toString()
}

const authenticatedFetch = async <T>(config: SupabaseConfig, path: string, options: RequestInit, allowRetry: boolean): Promise<T> => {
  const generation = authGeneration
  const session = await freshSession(config)
  if (generation !== authGeneration) throw new SupabaseRestError('auth-cancelled', 'เซสชันนี้ถูกเปลี่ยนแล้ว')
  const headers = new Headers(options.headers)
  headers.set('apikey', config.publishableKey)
  headers.set('Authorization', `Bearer ${session.access_token}`)
  if (options.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetchWithTimeout(endpoint(config, path), { ...options, headers })
  if (generation !== authGeneration) throw new SupabaseRestError('auth-cancelled', 'เซสชันนี้ถูกเปลี่ยนแล้ว')
  if (response.status === 401 && allowRetry) {
    await freshSession(config, true)
    return authenticatedFetch<T>(config, path, options, false)
  }
  const data = await safeJson(response)
  if (response.status >= 500) reportRequestFailure()
  if (!response.ok) throw responseError(response.status, false, data)
  return data as T
}

export const request = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const config = requireConfig()
  return authenticatedFetch<T>(config, path, options, true)
}

export const rpc = <T>(name: string, body: unknown, signal?: AbortSignal): Promise<T> => {
  if (!name || /[^a-zA-Z0-9_]/.test(name)) return Promise.reject(new SupabaseRestError('invalid-path', 'ชื่อคำสั่ง Supabase ไม่ถูกต้อง'))
  return request<T>(`/rest/v1/rpc/${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(body), signal })
}

export const invoke = <T>(name: string, body: unknown, signal?: AbortSignal): Promise<T> => {
  if (!name || /[^a-zA-Z0-9_-]/.test(name)) return Promise.reject(new SupabaseRestError('invalid-path', 'ชื่อฟังก์ชัน Supabase ไม่ถูกต้อง'))
  return request<T>(`/functions/v1/${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(body), signal })
}
