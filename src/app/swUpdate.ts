/**
 * บอกครูเมื่อมีเวอร์ชันใหม่รอให้โหลด
 *
 * sw.js ตั้งใจ "รอ" จนกว่าทุกแท็บของแอปจะปิด ถึงจะสลับไปเวอร์ชันใหม่ (กันแท็บเก่าโหลดชิ้นส่วนใหม่ปนกัน)
 * ผลข้างเคียงที่เจ้าของเจอ 9 ก.ย.: แท็บที่เปิดค้างเป็นวันไม่มีทางได้อัปเดต และ reload ก็ไม่ช่วย
 * ครูที่ปักหมุดแอปไว้จะติดอยู่กับ build เก่าตลอด ทั้งที่แก้บั๊กไปแล้ว
 *
 * ทางแก้ที่ยังรักษาความปลอดภัยเดิม: ไม่ข้ามการรอเอง แต่ให้ครูเป็นคนกด —
 * เมื่อเวอร์ชันใหม่ติดตั้งเสร็จและรออยู่ → ขึ้น toast "โหลดใหม่" → ครูกด → สั่ง worker ข้ามการรอ
 * → ทุกแท็บที่ถูกควบคุมอยู่โหลดตัวเองใหม่พร้อมกัน จึงไม่มีแท็บไหนค้างบน shell เก่ากับ worker ใหม่
 * แอปเป็น local-first การโหลดใหม่ไม่ทำข้อมูลหาย
 */
export interface UpdateHandle { apply: () => void }

type Listener = (handle: UpdateHandle) => void
let pending: UpdateHandle | null = null
const listeners = new Set<Listener>()

/** หน้าจอสมัครรับ — ถ้ามีเวอร์ชันรออยู่แล้วตอนสมัคร ได้รับทันที (worker อาจติดตั้งเสร็จก่อน React จะ mount) */
export function subscribeUpdateReady(listener: Listener): () => void {
  listeners.add(listener)
  if (pending) listener(pending)
  return () => { listeners.delete(listener) }
}

/** สำหรับเทส — ล้างสถานะระหว่างเคส */
export function resetUpdateState(): void { pending = null; listeners.clear() }

export function watchServiceWorkerUpdates(
  registration: ServiceWorkerRegistration,
  deps: { container?: ServiceWorkerContainer; reload?: () => void } = {},
): void {
  const container = deps.container ?? navigator.serviceWorker
  const reload = deps.reload ?? (() => window.location.reload())
  // แท็บที่ยังไม่มี controller คือการติดตั้งครั้งแรก — ไม่มี "เวอร์ชันใหม่" ให้ประกาศ และห้ามโหลดซ้ำเอง
  const hadController = !!container.controller
  let asked = false

  const announce = (worker: ServiceWorker) => {
    const handle: UpdateHandle = {
      apply: () => { asked = true; worker.postMessage({ type: 'SKIP_WAITING' }) },
    }
    pending = handle
    for (const listener of listeners) listener(handle)
  }

  if (registration.waiting && hadController) announce(registration.waiting)
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing
    if (!worker) return
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && container.controller) announce(worker)
    })
  })
  // worker ใหม่เข้าควบคุมแล้ว — ทุกแท็บที่เคยถูกควบคุมต้องโหลดใหม่พร้อมกัน ไม่ใช่เฉพาะแท็บที่กด
  container.addEventListener('controllerchange', () => {
    if (asked || hadController) reload()
  })
}
