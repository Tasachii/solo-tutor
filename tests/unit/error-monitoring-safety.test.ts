import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildErrorReport, installErrorMonitoring, reportRoute } from '../../src/core/errorReport'
import { sendUsage } from '../../src/core/usage'
import { signIn, signOut } from '../../src/integrations/supabaseRest'

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); vi.unstubAllEnvs() })

describe('production telemetry boundaries', () => {
  it('removes names, payment URLs, document tokens and object values from errors', () => {
    const error = new TypeError('น้องฟ้า failed: https://example.com/#/document/SECRET-TOKEN')
    error.stack = `${error.message}\n at https://example.com/assets/index-Abc.js:123:45`
    const report = buildErrorReport(error, { route: '#/document/SECRET-TOKEN?access_token=private' })
    expect(report.message).toBe('TypeError: application failure')
    expect(report.stack).toBe('assets/index-Abc.js:123:45')
    expect(report.route).toBe('#/document/:token')
    expect(JSON.stringify(report)).not.toMatch(/น้องฟ้า|SECRET|private|example\.com/)
    expect(buildErrorReport({ student: 'private' }).message).toBe('Error: application failure')
    expect(reportRoute('#/app/subjects/private-id?chat=private')).toBe('#/app/subjects/:id')
  })
  it('captures and deduplicates unhandled async and request failures; cleanup removes hooks', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://qa.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_qa')
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    const stop = installErrorMonitoring()
    try {
      const rejection = new Event('unhandledrejection')
      Object.defineProperty(rejection, 'reason', { value: new TypeError('private') })
      window.dispatchEvent(rejection)
      window.dispatchEvent(rejection)
      window.dispatchEvent(new Event('solo:request-error'))
      expect(fetcher).toHaveBeenCalledTimes(2)
      const payloads = fetcher.mock.calls.map(([, init]) => String(init?.body))
      expect(payloads.join('')).not.toContain('private')
    } finally { stop() }
    window.dispatchEvent(new Event('solo:request-error'))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('attributes real usage with a verified-session bearer, never a claimed provider in JSON', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://qa.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_qa')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: 'qa-access', refresh_token: 'qa-refresh', expires_in: 3600, user: { id: 'qa-user' },
    })))
    await signIn('teacher@example.com', 'qa-password')
    const send = vi.fn().mockResolvedValue(new Response('{}'))
    sendUsage('payment_recorded', 1, { mode: 'real', send })
    expect(send.mock.calls[0][1].headers.Authorization).toBe('Bearer qa-access')
    expect(JSON.parse(send.mock.calls[0][1].body)).not.toHaveProperty('provider_id')
    sendUsage('app_open', 1, { mode: 'demo', send })
    expect(send.mock.calls[1][1].headers).not.toHaveProperty('Authorization')
    signOut()
  })
})
