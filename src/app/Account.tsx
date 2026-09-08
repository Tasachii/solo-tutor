import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../core/store'
import { copy } from '../copy'
import { getSupabaseConfig } from '../integrations/supabaseRest'
import { AuthForm } from './components/AuthForm'
import { BottomSheet, ConfirmSheet } from './components'
import { useToast } from './components/Toast'
import { useCloudSync } from './CloudSync'
import { PlanCard } from './PlanCard'
import SharedLinks from './SharedLinks'

const when = (iso: string | null): string => {
  if (!iso) return copy.account.never
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? copy.account.never : d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
}

/** หน้าบัญชีครู — เข้าสู่ระบบ ดูสถานะซิงก์ แก้กรณีสองฝั่งต่างกัน และลบข้อมูลบนคลาวด์ */
export default function Account() {
  const { state, writeStatus, dispatch, track } = useStore()
  const cloud = useCloudSync()
  const toast = useToast()
  const a = copy.account
  const [ask, setAsk] = useState<null | 'pull' | 'push' | 'delete' | 'account' | 'prepull'>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const config = getSupabaseConfig()

  const unlock = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    void cloud.unlock(password).then((ok) => {
      setPassword(''); setBusy(false)
      if (ok) toast.push({ text: a.unlocked, tone: 'ok' })
    })
  }

  const downloadRecovery = async () => {
    setRecoveryBusy(true)
    const recovery = await cloud.exportRecovery()
    setRecoveryBusy(false)
    if (!recovery) { toast.push({ text: a.recoveryUnavailable, tone: 'warn' }); return }
    const href = URL.createObjectURL(new Blob([recovery], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `solo-tutor-recovery-${cloud.session?.user.id.slice(0, 8) ?? 'key'}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(href), 0)
    toast.push({ text: a.recoveryExported, tone: 'ok' })
  }

  const loadRecovery = async (file: File | undefined) => {
    if (!file || file.size > 32_000) { if (file) toast.push({ text: a.recoveryInvalid, tone: 'warn' }); return }
    setRecoveryBusy(true)
    let ok = false
    try { ok = await cloud.importRecovery(await file.text()) } finally { setRecoveryBusy(false) }
    toast.push({ text: ok ? a.recoveryReady : a.recoveryInvalid, tone: ok ? 'ok' : 'warn' })
  }

  return <div className="pane line-settings">
    <div className="rowhead"><h1 className="h1">{a.title}</h1><Link to="/app/today">{copy.common.back}</Link></div>
    {state.mode !== 'real' ? (
      // ครูที่มาลบบัญชีหรือดูคลาวด์เจอหน้านี้ทั้งหน้า — บอกทางออกแล้วพาไปเลย ดีกว่าให้ไปหาเมนูเอง
      <>
        <p data-testid="account-needs-real">{a.demoOnly}</p>
        <button className="btn btn--secondary btn--sm" data-testid="account-switch-real"
          onClick={() => { if (dispatch({ type: 'startReal' })) track('start_real') }}>{a.deleteSwitchToReal}</button>
      </>
    )
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
            <button className="btn btn--secondary" disabled={cloud.status === 'syncing' || cloud.status === 'locked' || writeStatus !== 'writable'} onClick={() => void cloud.syncNow()}>{a.syncNow}</button>
          </div>
          {writeStatus !== 'writable' && <p className="hint" role="status">{a.readonlyTab}</p>}
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
          {cloud.conflictCounts && <p className="hint">เครื่องนี้ {cloud.conflictCounts.localSubjects} คน · คลาวด์ {cloud.conflictCounts.cloudSubjects} คน</p>}
          <div className="btnrow">
            <button className="btn btn--primary" onClick={() => setAsk('pull')}>{a.useCloud}</button>
            <button className="btn btn--secondary" onClick={() => setAsk('push')}>{a.useLocal}</button>
          </div>
        </section>}

        {cloud.prePullBackupAt && <section className="card" data-testid="prepull-card">
          <h2 className="h2">{a.prePullTitle}</h2>
          <p className="hint">{a.prePullBody.replace('{at}', when(cloud.prePullBackupAt))}</p>
          <button className="btn btn--secondary btn--sm" disabled={writeStatus !== 'writable'} onClick={() => setAsk('prepull')}>{a.prePullRestore}</button>
        </section>}

        <PlanCard />

        {cloud.status !== 'locked' && <section className="card">
          <h2 className="h2">{a.recoveryTitle}</h2>
          <p className="hint">{a.recoveryHint}</p>
          <button className="btn btn--secondary" disabled={recoveryBusy} onClick={() => void downloadRecovery()}>{a.recoveryExport}</button>
        </section>}

        <section className="card">
          <h2 className="h2">{a.recoveryImport}</h2>
          <p className="hint">{a.recoveryImportHint}</p>
          <input type="file" accept="application/json,.json" disabled={recoveryBusy}
            aria-label={a.recoveryImport} onChange={(event) => { void loadRecovery(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
        </section>

        <SharedLinks />

        <section className="card">
          <h2 className="h2">{a.deleteTitle}</h2>
          <p className="hint">{a.deleteBody}</p>
          <button className="btn btn--ghost btn--sm" onClick={() => setAsk('delete')}>{a.deleteTitle}</button>
        </section>
        <section className="card" style={{ borderColor: 'var(--danger)' }}>
          <h2 className="h2">{a.deleteAccountTitle}</h2>
          <p className="hint">{a.deleteAccountBody}</p>
          <button className="btn btn--ghost btn--sm" disabled={writeStatus !== 'writable'} onClick={() => setAsk('account')}>{a.deleteAccountTitle}</button>
        </section>
        <p className="hint">{a.encrypted}</p>
      </>}

    {ask === 'pull' && <ConfirmSheet title={a.useCloud} body={a.useCloudConfirm} confirmLabel={a.useCloud} onClose={() => setAsk(null)}
      onConfirm={async () => { const ok = await cloud.resolve('pull'); if (ok) toast.push({ text: a.pulled, tone: 'ok' }); return ok }} />}
    {ask === 'push' && <ConfirmSheet title={a.useLocal} body={a.useLocalConfirm} confirmLabel={a.useLocal} onClose={() => setAsk(null)}
      onConfirm={async () => { const ok = await cloud.resolve('push'); if (ok) toast.push({ text: a.pushed, tone: 'ok' }); return ok }} />}
    {ask === 'prepull' && <ConfirmSheet title={a.prePullTitle} body={a.prePullConfirm} confirmLabel={a.prePullRestore} onClose={() => setAsk(null)}
      onConfirm={async () => { const ok = await cloud.restorePrePullBackup(); toast.push({ text: ok ? a.prePullRestored : a.prePullFailed, tone: ok ? 'ok' : 'danger' }); return ok }} />}
    {ask === 'delete' && <ConfirmSheet title={a.deleteTitle} body={a.deleteConfirm} confirmLabel={a.deleteTitle} danger onClose={() => setAsk(null)}
      onConfirm={async () => { const ok = await cloud.deleteCloud(); if (ok) toast.push({ text: a.deleteDone, tone: 'ok' }); return ok }} />}
    {ask === 'account' && <BottomSheet title={a.deleteAccountTitle} sub={a.deleteAccountBody}
      onClose={() => { if (!busy) { setAsk(null); setDeletePassword(''); setDeleteConfirm('') } }}
      footer={<button className="btn btn--primary btn--block" disabled={busy || !deletePassword || deleteConfirm !== 'ลบบัญชี'} onClick={() => {
        setBusy(true)
        void cloud.deleteAccount(deletePassword).then((result) => {
          setBusy(false)
          if (result === 'deleted') {
            setAsk(null); setDeletePassword(''); setDeleteConfirm('')
            toast.push({ text: a.deleteAccountDone, tone: 'ok' })
          } else if (result === 'deleted-local-retained') {
            setAsk(null); setDeletePassword(''); setDeleteConfirm('')
            toast.push({ text: a.deleteAccountLocalRetained, tone: 'warn' })
          } else if (result === 'retention-required') toast.push({ text: a.retentionRequired, tone: 'warn' })
          else toast.push({ text: a.deleteAccountFailed, tone: 'danger' })
        })
      }}>{busy ? copy.common.loading : a.deleteAccountConfirm}</button>}>
      <label className="fld"><span className="fld__l">{a.deleteAccountPassword}</span>
        <input className="inp" type="password" autoComplete="current-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} /></label>
      <label className="fld"><span className="fld__l">{a.deleteAccountType}</span>
        <input className="inp" value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} /></label>
    </BottomSheet>}
  </div>
}
