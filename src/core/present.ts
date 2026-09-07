export type Frame = 'phone' | 'web'

const KEY = 'solo-frame'

/** phone = กรอบมือถือกลางจอ (เหมือนถือเครื่องอยู่) · web = เต็มความกว้าง */
export function readFrame(): Frame {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'web' || saved === 'phone') return saved
    return window.matchMedia?.('(min-width: 1024px)').matches ? 'web' : 'phone'
  } catch {
    return 'phone'
  }
}

export function applyFrame(f: Frame): void {
  const root = document.documentElement
  if (f === 'phone') root.removeAttribute('data-frame')
  else root.setAttribute('data-frame', f)
  try {
    localStorage.setItem(KEY, f)
  } catch {
    /* โหมดส่วนตัวเขียนไม่ได้ */
  }
}

export const isFullscreen = (): boolean => !!document.fullscreenElement

/** เปิดจากไอคอนบนโฮมสกรีน (PWA ที่ติดตั้งแล้ว) — ไม่ใช่แท็บเบราว์เซอร์ */
export const isStandalone = (): boolean => {
  try {
    return window.matchMedia?.('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}

export async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch {
    /* บางเบราว์เซอร์ไม่อนุญาต — ไม่ใช่เรื่องคอขาดบาดตาย */
  }
}
