/* Generated release metadata covers every route chunk and local static asset. */
const APP = new URL(self.registration.scope)
const PREFIX = `solo-tutor:${APP.pathname}:`
const VERSION = `${PREFIX}__SOLO_RELEASE__`
const ASSETS = /* __SOLO_ASSETS__ */ []
const LEGACY = new Set(['solo-tutor-v1', 'solo-tutor-v2', 'solo-tutor-v3'])

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    if (!ASSETS.length) throw new Error('Release manifest unavailable')
    // Validate the whole release before writing anything. Integrity catches a
    // mixed deployment where an unhashed font/shell belongs to another build.
    const responses = await Promise.all(ASSETS.map(async (asset) => {
      const url = new URL(asset.path, APP)
      if (url.origin !== APP.origin || !url.pathname.startsWith(APP.pathname)) throw new Error('Invalid release asset')
      const response = await fetch(url.href, { cache: 'reload', integrity: asset.integrity })
      if (!response.ok || (asset.path !== './' && (response.headers.get('content-type') || '').includes('text/html'))) {
        throw new Error('App asset unavailable')
      }
      return { url: url.href, response }
    }))
    const cache = await caches.open(VERSION)
    await Promise.all(responses.map(({ url, response }) => cache.put(url, response)))
    // Keep the default waiting lifecycle: old tabs may still import old lazy
    // chunks. Activate this release only after the old worker loses its clients.
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key !== VERSION && (key.startsWith(PREFIX) || LEGACY.has(key)))
      .map((key) => caches.delete(key)))
    // Do not claim already-open uncontrolled tabs with a potentially older shell.
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== APP.origin || !url.pathname.startsWith(APP.pathname)) return
  event.respondWith((async () => {
    const cache = await caches.open(VERSION)
    // A controlled tab always receives this worker's matching shell, even while
    // a newer release is waiting. This keeps HTML and lazy chunks consistent.
    if (req.mode === 'navigate' && (url.pathname === APP.pathname || url.pathname === `${APP.pathname}index.html`)) {
      return (await cache.match(APP.href)) || fetch(req)
    }
    // Same-origin static assets may carry Vary: Origin; worker precache requests
    // and browser module/font requests use different Origin headers.
    const hit = await cache.match(req, { ignoreVary: true })
    if (hit) return hit
    return fetch(req)
  })())
})
