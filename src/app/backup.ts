import { download } from '../core/export'
import { fromBackup, toBackup, type RestoreResult } from '../core/backup'
import type { AppState } from '../core/types'

/**
 * คืน true เฉพาะเมื่อเชื่อได้ว่าไฟล์ถึงมือผู้ใช้
 * iOS ที่ติดตั้งลง Home Screen มักดาวน์โหลดไม่ได้ — ใช้ Web Share ที่เด้งแผ่นเซฟไฟล์แทน
 * ถ้าทั้งสองทางไม่มี ต้องบอกว่าไม่สำเร็จ ไม่ใช่โกหกแล้วปิดคำเตือน
 */
export async function saveBackup(state: AppState): Promise<boolean> {
  const text = toBackup(state, new Date().toISOString())
  // ชื่อไฟล์ต้องบอกว่ามาจาก workspace ไหน — ครูต้องไม่กู้คืนไฟล์ตัวอย่างโดยนึกว่าเป็นสมุดบัญชีตัวเอง
  const name = `solo-${state.mode === 'real' ? 'backup' : 'demo-backup'}-${state.today}.json`
  try {
    const file = new File([text], name, { type: 'application/json' })
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name })
      return true
    }
  } catch (e) {
    // ผู้ใช้กดยกเลิกแผ่นแชร์ = ยังไม่ได้เซฟ
    if ((e as { name?: string }).name === 'AbortError') return false
  }
  if ('download' in document.createElement('a')) {
    download(text, name, 'application/json')
    return true
  }
  return false
}

/** เปิดตัวเลือกไฟล์แล้วอ่านกลับมา — คืน null ถ้าผู้ใช้กดยกเลิก */
export function pickBackup(schema: number): Promise<RestoreResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    let done = false
    const finish = (v: RestoreResult | null) => { if (!done) { done = true; resolve(v) } }
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) { finish(null); return }
      const reader = new FileReader()
      reader.onload = () => finish(fromBackup(String(reader.result ?? ''), schema))
      reader.onerror = () => finish({ ok: false, reason: 'unreadable' })
      reader.readAsText(file)
    }
    // ยกเลิกไม่ยิง change ในหลายเบราว์เซอร์ — พอหน้าต่างกลับมาโฟกัสแล้วไม่มีไฟล์ ถือว่ายกเลิก
    input.addEventListener('cancel', () => finish(null))
    window.addEventListener('focus', () => setTimeout(() => { if (!input.files?.length) finish(null) }, 400), { once: true })
    input.click()
  })
}
