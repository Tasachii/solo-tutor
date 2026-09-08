import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../core/store'
import { copy } from '../copy'
import { LANDING_STAY_HREF } from '../core/entry'
import { getSupabaseConfig } from '../integrations/supabaseRest'
import { AuthForm, type AuthMode } from '../app/components/AuthForm'
import { PenguinMark } from '../app/components'
import { useCloudSync } from '../app/CloudSync'
import { AppearanceButton, ThemeToggle } from './ThemeToggle'

type Phase = 'form' | 'entering' | 'stuck'

/**
 * ประตูที่สองของหน้าแรก — ครูที่มีบัญชีหรือพร้อมใช้จริง เดโมยังไม่ต้องสมัครเหมือนเดิม
 * หลังได้ session: ยังเดโมอยู่ → เริ่มโหมดจริง แล้ว "รอ" ผลตัดสินของ cloud sync ก่อนพาเข้าแอป
 * ไม่งั้นครูที่เปลี่ยนเครื่องจะเจอ onboarding ทั้งที่ข้อมูลเดิมกำลังถูกดึงมา และกรอกทับของจริง
 */
export default function Login() {
  const { state, dispatch, track, persistenceError, writeStatus } = useStore()
  const cloud = useCloudSync()
  const nav = useNavigate()
  const loc = useLocation()
  const c = copy.login
  const config = getSupabaseConfig()
  const initialMode: AuthMode = new URLSearchParams(loc.search).get('mode') === 'signup' ? 'signup' : 'signin'
  const [phase, setPhase] = useState<Phase>('form')
  const [notice, setNotice] = useState('')

  const enter = () => {
    if (state.mode !== 'real') {
      if (!dispatch({ type: 'startReal' })) { setNotice(c.storageFailed); return }
      track('start_real')
    }
    cloud.refreshSession()
    setPhase('entering')
  }

  useEffect(() => {
    if (phase !== 'entering') return
    if (cloud.status === 'synced') { nav('/app/today', { replace: true }); return }
    // สองฝั่งไม่ตรงกัน หรือเครื่องนี้ยังไม่มีกุญแจ — จอเลือก/ปลดล็อกอยู่ที่หน้าบัญชีครูอยู่แล้ว
    if (cloud.status === 'conflict' || cloud.status === 'locked') { nav('/app/settings/account', { replace: true }); return }
    if (cloud.status === 'error' || cloud.status === 'offline') { setPhase('stuck'); return }
    // กันค้าง: ถ้าสถานะไม่ขยับในเวลาพอสมควร ให้ครูเลือกเข้าแอปเองได้
    const timer = window.setTimeout(() => setPhase('stuck'), 12_000)
    return () => window.clearTimeout(timer)
  }, [phase, cloud.status, nav])

  return (
    <div className="land login">
      <header className="land__bar">
        <Link className="land__brand" to={LANDING_STAY_HREF}>‹ <PenguinMark size={28} />{copy.brand.name}</Link>
        <span className="land__tools"><ThemeToggle /><AppearanceButton /></span>
      </header>
      <main className="pane login__pane">
        <h1 className="h1">{c.title}</h1>
        {!config ? (
          <div className="card">
            <h2 className="h2">{copy.account.notConfigured}</h2>
            <p>{copy.account.notConfiguredBody}</p>
            <Link className="btn btn--primary" to="/start">{c.tryDemo}</Link>
          </div>
        ) : phase === 'form' ? (
          <>
            <p>{c.intro}</p>
            {state.mode !== 'real' && <p className="hint">{c.demoNote}</p>}
            {(notice || persistenceError) && <p className="warnbar" role="status" data-testid="login-notice" data-write-status={writeStatus}>{persistenceError ?? notice}</p>}
            {cloud.session ? (
              <section className="card" data-testid="login-already">
                <h2 className="h2">{c.alreadyTitle}</h2>
                <p>{c.alreadyBody.replace('{email}', cloud.session.user.email ?? '')}</p>
                <button className="btn btn--primary" onClick={enter}>{c.enter}</button>
              </section>
            ) : (
              // key ทำให้ ?mode= ในลิงก์มีผลแม้เปลี่ยนแค่ hash (หน้าเดิมยังไม่ถูก mount ใหม่)
              <AuthForm key={initialMode} initialMode={initialMode} onSession={enter} hint={copy.account.signupHint} />
            )}
            <p className="hint"><Link to="/start">{c.tryDemo}</Link></p>
            <p className="hint">{copy.account.encrypted}</p>
          </>
        ) : (
          <section className="card" role="status" aria-live="polite" data-testid="login-entering" data-phase={phase}>
            <h2 className="h2">{phase === 'stuck' ? c.syncFailed : c.checking}</h2>
            {phase === 'entering' && <p className="hint">{c.checkingHint}</p>}
            {phase === 'stuck' && (
              <>
                {cloud.error && <p className="warnbar">{cloud.error}</p>}
                <button className="btn btn--primary" onClick={() => nav('/app/today', { replace: true })}>{c.enterAnyway}</button>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
