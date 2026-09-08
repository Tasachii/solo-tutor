import { describe, expect, it, vi } from 'vitest'
import source from '../../public/sw.js?raw'

function harness() {
  const handlers: Record<string, (event: unknown) => void> = {}
  const cached = new Map<string, Response>()
  const cachedOrigins = new Map<string, string | null>()
  const cacheKey = (key: string | Request) => typeof key === 'string' ? key : key.url
  const cache = {
    put: vi.fn(async (key: string | Request, value: Response) => {
      cached.set(cacheKey(key), value)
      cachedOrigins.set(cacheKey(key), typeof key === 'string' ? null : key.headers.get('origin'))
    }),
    match: vi.fn(async (key: string | Request, options?: CacheQueryOptions) => {
      const response = cached.get(cacheKey(key))
      if (!response || options?.ignoreVary) return response
      const variesByOrigin = (response.headers.get('vary') || '')
        .split(',').some((name) => name.trim().toLowerCase() === 'origin')
      const requestOrigin = typeof key === 'string' ? null : key.headers.get('origin')
      return variesByOrigin && requestOrigin !== cachedOrigins.get(cacheKey(key)) ? undefined : response
    }),
  }
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => [
    'other-app-v1', 'solo-tutor-v3', 'solo-tutor:/solo-tutor/:v3', 'solo-tutor:/solo-tutor/:v4',
  ]), delete: vi.fn(async (_key: string) => true) }
  const self = { registration: { scope: 'https://qa.example/solo-tutor/' },
    addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler },
    clients: { claim: vi.fn() }, skipWaiting: vi.fn() }
  const fetcher = vi.fn(async (input: string | Request) => cacheKey(input).endsWith('.js')
    ? new Response('app()', { headers: { 'content-type': 'text/javascript', vary: 'Origin' } })
    : new Response('<script src="/solo-tutor/assets/app.js"></script>', { headers: { 'content-type': 'text/html' } }))
  const built = source.replace('__SOLO_RELEASE__', 'v4').replace('/* __SOLO_ASSETS__ */ []', JSON.stringify([
    { path: './', integrity: 'sha256-shell' }, { path: 'assets/app.js', integrity: 'sha256-script' },
  ]))
  new Function('self', 'caches', 'fetch', built)(self, caches, fetcher)
  const lifecycle = async (name: string) => {
    let pending: Promise<unknown> | undefined
    handlers[name]({ waitUntil: (value: Promise<unknown>) => { pending = value } })
    await pending
  }
  const navigate = async () => {
    let result: Promise<Response> | undefined
    handlers.fetch({ request: { url: 'https://qa.example/solo-tutor/', method: 'GET', mode: 'navigate' },
      respondWith: (value: Promise<Response>) => { result = value } })
    return result!
  }
  const requestAsset = async () => {
    let result: Promise<Response> | undefined
    const request = new Request('https://qa.example/solo-tutor/assets/app.js', {
      headers: { origin: 'https://qa.example' },
    })
    handlers.fetch({ request, respondWith: (value: Promise<Response>) => { result = value } })
    return result!
  }
  return { cache, caches, cached, self, fetcher, lifecycle, navigate, requestAsset }
}

describe('service worker production safety', () => {
  it('prepares the shell and scripts before declaring the first installation ready', async () => {
    const h = harness()
    await h.lifecycle('install')
    expect([...h.cached.keys()].sort()).toEqual(['https://qa.example/solo-tutor/', 'https://qa.example/solo-tutor/assets/app.js'])
    expect(h.self.skipWaiting).not.toHaveBeenCalled()
    expect(h.fetcher).toHaveBeenCalledWith('https://qa.example/solo-tutor/assets/app.js', { cache: 'reload', integrity: 'sha256-script' })
  })
  it('preserves caches owned by other applications', async () => {
    const h = harness()
    await h.lifecycle('activate')
    expect(h.caches.delete.mock.calls.map(([key]) => key)).toEqual(['solo-tutor-v3', 'solo-tutor:/solo-tutor/:v3'])
  })
  it('does not install a broken release over the working offline app', async () => {
    const h = harness()
    h.fetcher.mockResolvedValue(new Response('unavailable', { status: 503 }))
    await expect(h.lifecycle('install')).rejects.toThrow('App asset unavailable')
    expect(h.self.skipWaiting).not.toHaveBeenCalled()
  })
  it('does not change existing cache entries if a later release asset fails', async () => {
    const h = harness()
    h.cached.set('https://qa.example/solo-tutor/', new Response('old working shell'))
    h.fetcher.mockImplementation(async input => String(input).endsWith('.js')
      ? new Response('missing', { status: 404 })
      : new Response('new shell'))
    await expect(h.lifecycle('install')).rejects.toThrow('App asset unavailable')
    expect(h.cache.put).not.toHaveBeenCalled()
    expect(await h.cached.get('https://qa.example/solo-tutor/')!.text()).toBe('old working shell')
  })
  it('keeps the offline shell when a navigation receives a server error', async () => {
    const h = harness()
    await h.lifecycle('install')
    h.fetcher.mockResolvedValue(new Response('unavailable', { status: 503 }))
    expect((await h.navigate()).status).toBe(200)
    expect(await h.cached.get('https://qa.example/solo-tutor/')!.clone().text()).toContain('assets/app.js')
  })
  it('serves a precached CORS asset when its response varies by Origin', async () => {
    const h = harness()
    await h.lifecycle('install')
    h.fetcher.mockRejectedValue(new TypeError('offline'))
    const response = await h.requestAsset()
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('app()')
    expect(h.cache.match).toHaveBeenLastCalledWith(expect.any(Request), { ignoreVary: true })
  })
})
