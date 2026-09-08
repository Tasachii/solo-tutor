import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

/**
 * โหลด route chunk แบบทนทาน — "Importing a module script failed" เกิดได้สองทาง:
 * 1) เน็ตสะดุดชั่วคราว → ลองใหม่หนึ่งครั้งพอ (SW แคชครบแล้วก็แทบไม่เกิด)
 * 2) หน้ากำลังปิด/reload ขณะ chunk ยังโหลดอยู่ (WebKit ยกเลิก import ทั้งหมด) → ไม่ใช่ความผิดพลาด
 *    ให้ค้างใน Suspense เงียบ ๆ แทนที่จะโยนไปหน้าพัง
 */
let unloading = false
const markUnloading = () => { unloading = true }
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', markUnloading)
  window.addEventListener('beforeunload', markUnloading)
}

/** เฉพาะเทส: จำลองว่าหน้ากำลังปิด */
export const __setUnloadingForTests = (value: boolean): void => { unloading = value }

const never = new Promise<never>(() => { /* หน้ากำลังปิด ไม่ต้อง resolve */ })

export async function loadWithRetry<T>(importer: () => Promise<T>, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  try {
    return await importer()
  } catch (error) {
    if (unloading) return never
    await wait(400)
    if (unloading) return never
    try {
      return await importer()
    } catch (second) {
      if (unloading) return never
      throw second ?? error
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const lazyRoute = <T extends ComponentType<any>>(importer: () => Promise<{ default: T }>): LazyExoticComponent<T> =>
  lazy(() => loadWithRetry(importer))
