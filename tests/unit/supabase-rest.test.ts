import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SupabaseRestError,
  getSession,
  getSupabaseConfig,
  invoke,
  request,
  rpc,
  signIn,
  signOut,
  signUp,
} from '../../src/integrations/supabaseRest'

const projectUrl = 'https://project-ref.supabase.co'
const publicKey = 'sb_publishable_browser_test'

const configure = () => {
  vi.stubEnv('VITE_SUPABASE_URL', projectUrl)
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', publicKey)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
}

const authBody = (over: Record<string, unknown> = {}) => ({
  access_token: 'access-one',
  refresh_token: 'refresh-one',
  expires_in: 3600,
  user: { id: 'user-1', email: 'teacher@example.com' },
  ...over,
})

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  signOut()
  vi.unstubAllEnvs()
})

describe('Supabase browser configuration', () => {
  it('accepts the fixed HTTPS project URL and public browser key', () => {
    configure()
    expect(getSupabaseConfig()).toEqual({ url: projectUrl, publishableKey: publicKey })
  })

  it('rejects secret/service-role keys and unsafe project URLs', () => {
    configure()
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_secret_never_in_browser')
    expect(getSupabaseConfig()).toBeNull()

    const payload = btoa(JSON.stringify({ role: 'service_role' })).replace(/=/g, '')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', `header.${payload}.signature`)
    expect(getSupabaseConfig()).toBeNull()

    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'looks-like-a-line-access-token')
    expect(getSupabaseConfig()).toBeNull()

    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', publicKey)
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project-ref.supabase.co@evil.test')
    expect(getSupabaseConfig()).toBeNull()
    vi.stubEnv('VITE_SUPABASE_URL', 'http://project-ref.supabase.co')
    expect(getSupabaseConfig()).toBeNull()
  })
})

describe('Supabase password session', () => {
  it('signs in through Auth REST and persists only a project-bound session', async () => {
    configure()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(authBody()))

    const session = await signIn(' teacher@example.com ', 'password-value')

    expect(session.user).toEqual({ id: 'user-1', email: 'teacher@example.com' })
    expect(getSession()).toEqual(session)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${projectUrl}/auth/v1/token?grant_type=password`)
    expect(new Headers(init?.headers).get('apikey')).toBe(publicKey)
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'teacher@example.com', password: 'password-value' })
    expect(Object.values(localStorage).join('')).not.toContain('password-value')
  })

  it('serializes replacement-token refresh across concurrent expired requests', async () => {
    configure()
    let refreshCalls = 0
    const seenAuthorization: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('grant_type=password')) {
        return jsonResponse(authBody({ expires_at: Math.floor(Date.now() / 1000) - 1 }))
      }
      if (url.includes('grant_type=refresh_token')) {
        refreshCalls += 1
        await Promise.resolve()
        return jsonResponse(authBody({ access_token: 'access-two', refresh_token: 'refresh-two' }))
      }
      seenAuthorization.push(new Headers(init?.headers).get('Authorization') ?? '')
      return jsonResponse({ ok: true })
    })

    await signIn('teacher@example.com', 'password')
    await Promise.all([
      request('/rest/v1/clients?select=id'),
      request('/rest/v1/line_channels_public?select=status'),
    ])

    expect(refreshCalls).toBe(1)
    expect(seenAuthorization).toEqual(['Bearer access-two', 'Bearer access-two'])
    expect(getSession()?.refresh_token).toBe('refresh-two')
  })

  it('sign out prevents in-flight sign-in and refresh from restoring a session', async () => {
    configure()
    let releaseSignIn!: (response: Response) => void
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { releaseSignIn = resolve }))
    const pendingSignIn = signIn('teacher@example.com', 'password')
    await vi.waitFor(() => expect(releaseSignIn).toBeTypeOf('function'))
    signOut()
    releaseSignIn(jsonResponse(authBody()))
    await expect(pendingSignIn).rejects.toMatchObject({ code: 'auth-cancelled' })
    expect(getSession()).toBeNull()

    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(authBody({
      expires_at: Math.floor(Date.now() / 1000) - 1,
    })))
    await signIn('teacher@example.com', 'password')
    let releaseRefresh!: (response: Response) => void
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { releaseRefresh = resolve }))
    const pendingRequest = request('/rest/v1/clients')
    await vi.waitFor(() => expect(releaseRefresh).toBeTypeOf('function'))
    signOut()
    releaseRefresh(jsonResponse(authBody({ access_token: 'late', refresh_token: 'late-refresh' })))
    await expect(pendingRequest).rejects.toMatchObject({ code: 'auth-cancelled' })
    expect(getSession()).toBeNull()
  })

  it('an old account request cannot settle after another account signs in', async () => {
    configure()
    let authCount = 0
    let releaseRequest!: (response: Response) => void
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (String(input).includes('grant_type=password')) {
        authCount += 1
        return Promise.resolve(jsonResponse(authBody({ user: { id: `user-${authCount}`, email: `t${authCount}@example.com` } })))
      }
      return new Promise(resolve => { releaseRequest = resolve })
    })
    await signIn('t1@example.com', 'password')
    const stale = request('/rest/v1/clients')
    await vi.waitFor(() => expect(releaseRequest).toBeTypeOf('function'))
    await signIn('t2@example.com', 'password')
    releaseRequest(jsonResponse([{ id: 'old-account-row' }]))
    await expect(stale).rejects.toMatchObject({ code: 'auth-cancelled' })
    expect(getSession()?.user.id).toBe('user-2')
  })

  it('fails closed on storage errors before sending credentials or authenticated requests', async () => {
    configure()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked') })
    await expect(signIn('teacher@example.com', 'password')).rejects.toMatchObject({ code: 'storage-unavailable' })
    expect(fetchMock).not.toHaveBeenCalled()

    vi.restoreAllMocks()
    const authenticatedFetch = vi.spyOn(globalThis, 'fetch')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked') })
    await expect(request('/rest/v1/clients')).rejects.toMatchObject({ code: 'storage-unavailable' })
    expect(authenticatedFetch).not.toHaveBeenCalled()
  })
})

describe('authenticated REST helpers', () => {
  it('adds the API key and user JWT for RPC and Edge Function calls', async () => {
    configure()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(authBody()))
    await signIn('teacher@example.com', 'password')
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true }))

    await rpc('issue_line_link_code', { client_id: 'client-1' })
    await invoke('line-connect', { channelSecret: 'not-stored-by-transport', accessToken: 'not-stored-by-transport' })

    for (const [url, init] of fetchMock.mock.calls.slice(1)) {
      expect(String(url)).toMatch(new RegExp(`^${projectUrl.replace('.', '\\.')}/(?:rest|functions)/v1/`))
      const headers = new Headers(init?.headers)
      expect(headers.get('apikey')).toBe(publicKey)
      expect(headers.get('Authorization')).toBe('Bearer access-one')
    }
    expect(Object.values(localStorage).join('')).not.toContain('not-stored-by-transport')
  })

  it('rejects external paths and never exposes a remote response body in errors', async () => {
    configure()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(authBody()))
    await signIn('teacher@example.com', 'password')

    await expect(request('https://attacker.test/collect')).rejects.toMatchObject({ code: 'invalid-path' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'raw-secret-from-server' }, 500))
    const error = await request('/rest/v1/clients').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SupabaseRestError)
    expect(String((error as Error).message)).not.toContain('raw-secret-from-server')
  })

  it('exposes only the allowlisted retention code from account deletion failures', async () => {
    configure()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(authBody()))
    await signIn('teacher@example.com', 'password')
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'retention-required', private: 'must-not-leak' }, 409))
    const error = await invoke('delete-account', { password: 'password' }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'retention-required', status: 409 })
    expect(String((error as Error).message)).not.toContain('must-not-leak')
  })

  it('emits a content-free operational signal for handled server failures', async () => {
    configure()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(authBody()))
    await signIn('teacher@example.com', 'password')
    const seen = vi.fn()
    window.addEventListener('solo:request-error', seen, { once: true })
    fetchMock.mockResolvedValueOnce(jsonResponse({ private: 'not-forwarded' }, 503))
    await expect(request('/rest/v1/clients')).rejects.toMatchObject({ status: 503 })
    expect(seen).toHaveBeenCalledOnce()
    expect(seen.mock.calls[0][0]).toBeInstanceOf(Event)
  })
})

/**
 * ครูสมัครเองได้ — trigger ฝั่งฐานข้อมูลสร้างแถว providers ให้ต่อ
 * กับดักที่ต้องกัน: ถ้าวันหลังมีคนเปิด "Confirm email" ใน Supabase
 * endpoint นี้จะตอบ 200 แต่ไม่มี token กลับมา ห้ามนับว่าสมัครสำเร็จเงียบ ๆ
 */
describe('ครูสมัครบัญชีเอง', () => {
  it('สมัครสำเร็จได้ session และยิงไป /auth/v1/signup', async () => {
    configure()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(authBody()))
    const session = await signUp(' teacher@example.com ', 'hunter2secret')
    expect(session.access_token).toBe('access-one')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`${projectUrl}/auth/v1/signup`)
    // อีเมลต้องถูกตัดช่องว่างก่อนส่ง ไม่งั้นสมัครแล้วล็อกอินไม่เข้า
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      email: 'teacher@example.com', password: 'hunter2secret',
    })
    expect(getSession()?.user.email).toBe('teacher@example.com')
  })

  it('เปิดยืนยันอีเมลไว้ = ยังไม่ถือว่าเข้าสู่ระบบ ต้องฟ้องให้ไปกดในเมล', async () => {
    configure()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      user: { id: 'user-2', email: 'teacher@example.com' }, access_token: '', refresh_token: '',
    }))
    await expect(signUp('teacher@example.com', 'hunter2secret')).rejects.toMatchObject({ code: 'confirm-required' })
    expect(getSession()).toBeNull()
  })

  // Supabase Auth ตอบรหัสผ่านผิดด้วย 400 — เจ้าของเคยเห็น "ทำรายการไม่สำเร็จ (HTTP 400)" ตอนลืมรหัส แล้วไม่รู้ว่าผิดตรงไหน
  it('รหัสผ่านผิด (400 invalid_grant) บอกตรง ๆ ว่าอีเมลหรือรหัสผ่านไม่ถูกต้อง', async () => {
    configure()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400))
    await expect(signIn('teacher@example.com', 'wrong')).rejects.toMatchObject({ code: 'invalid-credentials', message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' })
    expect(getSession()).toBeNull()
  })

  it('อีเมลยังไม่ยืนยัน (400 email_not_confirmed) บอกให้ไปกดลิงก์ในอีเมล ไม่ใช่บอกว่ารหัสผิด', async () => {
    configure()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error_code: 'email_not_confirmed', msg: 'Email not confirmed' }, 400))
    await expect(signIn('teacher@example.com', 'right')).rejects.toMatchObject({ code: 'confirm-required' })
  })

  it('อีเมลซ้ำบอกให้ไปเข้าสู่ระบบแทน', async () => {
    configure()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error_code: 'user_already_exists' }, 422))
    await expect(signUp('teacher@example.com', 'hunter2secret')).rejects.toMatchObject({ code: 'email-taken' })
  })

  it('รหัสผ่านสั้นเกินไปบอกตรง ๆ', async () => {
    configure()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error_code: 'weak_password' }, 400))
    await expect(signUp('teacher@example.com', '123')).rejects.toMatchObject({ code: 'weak-password' })
  })

  it('ยังไม่ได้ตั้งค่าโปรเจกต์ = สมัครไม่ได้ ไม่ยิงออกไปมั่ว', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    await expect(signUp('teacher@example.com', 'hunter2secret')).rejects.toBeInstanceOf(SupabaseRestError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
