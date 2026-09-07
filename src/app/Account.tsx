import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../core/store'
import { copy } from '../copy'
import { getSupabaseConfig } from '../integrations/supabaseRest'
import { AuthForm } from './components/AuthForm'
import { ConfirmSheet } from './components'
import { useToast } from './components/Toast'
import { useCloudSync } from './CloudSync'
import { PlanCard } from './PlanCard'

const when = (iso: string | null): string => {
  if (!iso) return copy.account.never
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? copy.account.never : d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
}

/** หน้าบัญชีครู — เข้าสู่ระบบ ดูสถานะซิงก์ แก้กรณีสองฝั่งต่างกัน และลบข้อมูลบนคลาวด์ */
export default function Account() {
  const { state } = useStore()
  const cloud = useCloudSync()
  const toast = useToast()
  const a = copy.account
  const [ask, setAsk] = useState<null | 'pull' | 'push' | 'delete'>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const config = getSupabaseConfig()

  const unlock = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    void cloud.unlock(password).then((ok) => {
      setPassword(''); setBusy(false)
      if (ok) toast.push({ text: a.unlocked, tone: 'ok' })
    })
  }

  return <div className="pane line-settings">
    <div className="rowhead"><h1 className="h1">{a.title}</h1><Link to="/app/today">{copy.common.back}</Link></div>
    {state.mode !== 'real' ? <p>{a.demoOnly}</p>
      : !config ? <div className="card"><h2 className="h2">{a.notConfigured}</h2><p>{a.notConfiguredBody}</p></div>
      : !cloud.session ? <>
        <div className="card"><p>{a.intro}</p><p className="hint">{a.encrypted}</p></div>
        <AuthForm onSession={() => { cloud.refreshSession(); toast.push({ text: a.signedIn, tone: 'ok' }) }} hint={a.signupHint} />
      </> : <>
        <section className="card">
          <div className="rowhead"><span className="dim">{cloud.session.user.email ?? a.title}</span>
            <button className="btn btn--ghost btn--sm" onClick={() => { if (cloud.signOutDevice()) toast.push({ text: a.signedOut, tone: 'ok' }) }}>{a.signOut}</button></div>
          <p role="status" data-testid="sync-status"><b>{a.status[cloud.status]}</b></p>
          {cloud.error && <p className="warnbar">{cloud.error}</p>}
          <p className="hint">{a.lastAt}: {when(cloud.lastAt)}</p>
          <div className="btnrow">
            <button className="btn btn--secondary" disabled={cloud.status === 'syncing' || cloud.status === 'locked'} onClick={() => void cloud.syncNow()}>{a.syncNow}</button>
          </div>
        </section>

        {cloud.status === 'locked' && <form className="card" onSubmit={unlock}>
          <h2 className="h2">{a.unlockTitle}</h2>
          <p className="hint">{a.unlockHint}</p>
          <label className="fld"><span className="fld__l">รหัสผ่าน</span><input className="inp" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button className="btn btn--primary" disabled={busy || !password}>{busy ? a.unlocking : a.unlock}</button>
        </form>}

        {cloud.status === 'conflict' && <section className="card" style={{ borderColor: 'var(--warn)' }}>
          <h2 className="h2">{a.conflictTitle}</h2>
          <p>{a.conflictBody.replace('{at}', when(cloud.cloud?.updated_at ?? null)).replace('{device}', cloud.cloud?.device ?? a.unknownDevice)}</p>
          <div className="btnrow">
            <button className="btn btn--primary" onClick={() => setAsk('pull')}>{a.useCloud}</button>
            <button className="btn btn--secondary" onClick={() => setAsk('push')}>{a.useLocal}</button>
          </div>
        </section>}

        <PlanCard />

        <section className="card">
          <h2 className="h2">{a.deleteTitle}</h2>
          <p className="hint">{a.deleteBody}</p>
          <button className="btn btn--ghost btn--sm" onClick={() => setAsk('delete')}>{a.deleteTitle}</button>
        </section>
        <p className="hint">{a.encrypted}</p>
      </>}

    {ask === 'pull' && <ConfirmSheet title={a.useCloud} body={a.useCloudConfirm} confirmLabel={a.useCloud} onClose={() => setAsk(null)}
      onConfirm={async () => { const ok = await cloud.resolve('pull'); if (ok) toast.push({ text: a.pulled, tone: 'ok' }); return ok }} />}
    {ask === 'push' && <ConfirmSheet title={a.useLocal} body={a.useLocalConfirm} confirmLabel={a.useLocal} onClose={() => setAsk(null)}
      onConfirm={async () => { const ok = await cloud.resolve('push'); if (ok) toast.push({ text: a.pushed, tone: 'ok' }); return ok }} />}
    {ask === 'delete' && <ConfirmSheet title={a.deleteTitle} body={a.deleteConfirm} confirmLabel={a.deleteTitle} danger onClose={() => setAsk(null)}
      onConfirm={async () => { const ok = await cloud.deleteCloud(); if (ok) toast.push({ text: a.deleteDone, tone: 'ok' }); return ok }} />}
  </div>
}
