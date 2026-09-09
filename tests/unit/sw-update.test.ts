import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetUpdateState, subscribeUpdateReady, watchServiceWorkerUpdates } from '../../src/app/swUpdate'

/**
 * sw.js รอจนปิดทุกแท็บถึงจะอัปเดต — เจ้าของเจอว่าแท็บที่เปิดค้างไม่มีวันได้เวอร์ชันใหม่ และ reload ไม่ช่วย
 * ตัวเฝ้าฝั่งหน้าเว็บต้อง: ประกาศเมื่อมีเวอร์ชันใหม่ "รอ" อยู่จริง · ไม่ประกาศตอนติดตั้งครั้งแรก ·
 * กดแล้วสั่ง worker ข้ามการรอ · worker ใหม่เข้าควบคุมแล้วทุกแท็บที่เคยถูกควบคุมโหลดใหม่
 */
class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installing'
  postMessage = vi.fn()
  install() { this.state = 'installed'; this.dispatchEvent(new Event('statechange')) }
}
class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null
  waiting: FakeWorker | null = null
  update() { const w = new FakeWorker(); this.installing = w; this.dispatchEvent(new Event('updatefound')); return w }
}
class FakeContainer extends EventTarget {
  controller: object | null = null
  takeover() { this.dispatchEvent(new Event('controllerchange')) }
}
const setup = (controlled: boolean) => {
  const registration = new FakeRegistration()
  const container = new FakeContainer()
  if (controlled) container.controller = {}
  const reload = vi.fn()
  const ready = vi.fn()
  subscribeUpdateReady(ready)
  watchServiceWorkerUpdates(registration as unknown as ServiceWorkerRegistration, { container: container as unknown as ServiceWorkerContainer, reload })
  return { registration, container, reload, ready }
}

beforeEach(resetUpdateState)

describe('มีเวอร์ชันใหม่รอโหลด', () => {
  it('เวอร์ชันใหม่ติดตั้งเสร็จในแท็บที่ถูกควบคุมอยู่ → ประกาศ · กดแล้วสั่งข้ามการรอ · เข้าควบคุมแล้วโหลดใหม่', () => {
    const { registration, container, reload, ready } = setup(true)
    const worker = registration.update()
    expect(ready).not.toHaveBeenCalled() // ยังติดตั้งไม่เสร็จ
    worker.install()
    expect(ready).toHaveBeenCalledTimes(1)
    ready.mock.calls[0][0].apply()
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(reload).not.toHaveBeenCalled() // ยังไม่เข้าควบคุม
    container.takeover()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('ติดตั้งครั้งแรก (ยังไม่มี controller) ไม่ใช่ "เวอร์ชันใหม่" — ไม่ประกาศ และไม่โหลดซ้ำเอง', () => {
    const { registration, container, reload, ready } = setup(false)
    registration.update().install()
    expect(ready).not.toHaveBeenCalled()
    container.takeover()
    expect(reload).not.toHaveBeenCalled()
  })

  it('เวอร์ชันใหม่รออยู่แล้วตอนเปิดแอป → ประกาศทันที', () => {
    const registration = new FakeRegistration(); registration.waiting = new FakeWorker()
    const container = new FakeContainer(); container.controller = {}
    const ready = vi.fn(); subscribeUpdateReady(ready)
    watchServiceWorkerUpdates(registration as unknown as ServiceWorkerRegistration, { container: container as unknown as ServiceWorkerContainer, reload: vi.fn() })
    expect(ready).toHaveBeenCalledTimes(1)
  })

  it('หน้าจอที่สมัครรับหลังจากประกาศไปแล้ว ยังได้รับ (worker เสร็จก่อน React จะ mount)', () => {
    const { registration } = setup(true)
    registration.update().install()
    const late = vi.fn(); subscribeUpdateReady(late)
    expect(late).toHaveBeenCalledTimes(1)
  })

  it('อีกแท็บที่ไม่ได้กด แต่ถูกควบคุมอยู่ ก็โหลดใหม่เมื่อ worker ใหม่เข้าควบคุม — ไม่ค้างบน shell เก่า', () => {
    const { container, reload } = setup(true)
    container.takeover()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
