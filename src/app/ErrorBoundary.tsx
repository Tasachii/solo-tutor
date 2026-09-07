import { Component, type ErrorInfo, type ReactNode } from 'react'
import { copy } from '../copy'
import { STORAGE_KEY } from '../core/store'
import { download } from '../core/export'
import { buildErrorReport, bundleVersion, reportError } from '../core/errorReport'

interface State { failed: boolean }

/**
 * ข้อมูลเดโมมาจาก localStorage ซึ่งอาจค้างจากเวอร์ชันเก่าและอ้างถึงแถวที่ไม่มีแล้ว
 * ถ้าปล่อยพัง หน้าจะขาวทั้งจอ — ให้เห็นทางออกและกดโหลดชุดใหม่ได้ดีกว่า
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(err: Error, info: ErrorInfo): void {
    console.error('[solo] render failed', err, info.componentStack)
    // แจ้งหลังบ้านว่าพังที่ไหน — ไม่งั้นครูเจอจอนี้แล้วเราไม่มีทางรู้
    reportError(buildErrorReport(err, {
      route: location.hash, mode: this.isReal() ? 'real' : 'demo',
      userAgent: navigator.userAgent, appVersion: bundleVersion(),
    }))
  }

  /** อ่าน state ดิบจาก storage — ตอนพัง React tree ใช้ไม่ได้ ต้องไปเอาเอง */
  private raw(): string | null {
    try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
  }
  private isReal(): boolean {
    try { return JSON.parse(this.raw() ?? '{}').mode === 'real' } catch { return false }
  }
  private backup = (): void => {
    const raw = this.raw()
    if (raw) download(JSON.stringify({ format: 'solo-backup-1', exportedAt: new Date().toISOString(), app: JSON.parse(raw) }, null, 2),
      `solo-backup-crash.json`, 'application/json')
  }
  private reload = (): void => { location.reload() }

  private reset = (): void => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* โหมดส่วนตัวลบไม่ได้ — reload ก็ยังพอช่วย */
    }
    location.hash = '#/'
    location.reload()
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    const real = this.isReal()
    return (
      <div className="page crash">
        <h1 className="crash__t">{copy.errors.crashTitle}</h1>
        <p className="crash__p">{real ? copy.errors.crashReal : copy.errors.crashDemo}</p>
        <div className="btnrow">
          {real && <button className="btn btn--primary" onClick={this.backup}>{copy.errors.backupFirst}</button>}
          <button className={`btn ${real ? 'btn--secondary' : 'btn--primary'}`} onClick={this.reload}>{copy.errors.reloadOnly}</button>
          <button className="btn btn--ghost btn--danger-text" onClick={this.reset}>{copy.errors.wipe}</button>
        </div>
      </div>
    )
  }
}
