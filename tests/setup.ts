import { afterEach, vi } from 'vitest'

/**
 * ชุดข้อมูลเดโมเดินตามนาฬิกาเครื่องแล้ว (src/mock/seed.ts)
 * เทสจึงตรึงวันไว้ที่วันที่ชุดข้อมูลถูกเขียนขึ้น ตัวเลขและวันที่ในเทสจะได้ไม่ขยับตามปฏิทินจริง
 */
export const FROZEN_TODAY = '2025-09-02'
// ต้องตรึงตั้งแต่ตอนโหลด setup — ไฟล์เทสหลายไฟล์สร้างชุดข้อมูลไว้ที่ระดับโมดูล
vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
vi.setSystemTime(new Date(`${FROZEN_TODAY}T09:00:00+07:00`))

type Waiting = { callback: (lock: object) => Promise<unknown> | unknown }
const queues = new Map<string, Waiting[]>()
const held = new Set<string>()

const runNext = (name: string) => {
  if (held.has(name)) return
  const next = queues.get(name)?.shift()
  if (!next) return
  held.add(name)
  Promise.resolve(next.callback({ name, mode: 'exclusive' })).finally(() => {
    held.delete(name)
    runNext(name)
  })
}

Object.defineProperty(navigator, 'locks', {
  configurable: true,
  value: {
    request: (name: string, _options: object, callback: Waiting['callback']) => {
      let resolveRequest!: () => void
      const done = new Promise<void>(resolve => { resolveRequest = resolve })
      const wrapped = async (lock: object) => { try { await callback(lock) } finally { resolveRequest() } }
      const queue = queues.get(name) ?? []
      queue.push({ callback: wrapped })
      queues.set(name, queue)
      runNext(name)
      return done
    },
  },
})

afterEach(() => {
  queues.clear()
  held.clear()
})
