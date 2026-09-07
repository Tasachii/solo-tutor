/* service worker เล็กๆ ให้ติดตั้งเป็นแอปบนโฮมสกรีนได้และเปิดได้ตอนเน็ตหลุด
   หลักการ: หน้าเว็บเอาของใหม่ก่อนเสมอ (กันเดโมค้างเวอร์ชันเก่าตอน pitch)
   ส่วนไฟล์ asset มี hash ในชื่ออยู่แล้ว จึง cache ได้ยาวอย่างปลอดภัย */

const VERSION = 'solo-tutor-v3' // บัมป์ = แอปที่ติดตั้งไว้ทิ้งแคชเก่าและโหลดโฉมใหม่

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  if (new URL(req.url).origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req)
          const cache = await caches.open(VERSION)
          cache.put('./', fresh.clone())
          return fresh
        } catch {
          const cache = await caches.open(VERSION)
          return (await cache.match('./')) || Response.error()
        }
      })(),
    )
    return
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION)
      const hit = await cache.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok) cache.put(req, res.clone())
      return res
    })(),
  )
})
