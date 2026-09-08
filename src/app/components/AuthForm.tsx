import { useState, type FormEvent } from 'react'
import { signIn, signUp, SupabaseRestError, type SupabaseSession } from '../../integrations/supabaseRest'
import { rememberKeyFromPassword } from '../../core/cloudKey'

export type AuthMode = 'signin' | 'signup'

/**
 * ฟอร์มเดียวใช้ทั้งสมัครและเข้าสู่ระบบ — หน้าเชื่อม LINE หน้าบัญชีครู และหน้า /login ใช้ร่วมกัน
 * รหัสผ่านถูกใช้สองอย่างก่อนถูกล้าง: ส่งให้ Supabase และสร้างกุญแจเข้ารหัสสมุดบัญชีบนเครื่องนี้
 */
export function AuthForm({ onSession, hint, initialMode = 'signin' }: { onSession: (session: SupabaseSession) => void; hint?: string; initialMode?: AuthMode }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [mode, setMode] = useState<AuthMode>(initialMode)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setNotice('')
    void (async () => {
      try {
        const session = mode === 'signup' ? await signUp(email, password) : await signIn(email, password)
        await rememberKeyFromPassword(session.user.id, password)
        onSession(session)
      } catch (error) {
        setNotice(error instanceof SupabaseRestError
          ? error.message
          : 'ทำรายการไม่สำเร็จ กรุณาตรวจการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่')
      } finally {
        setPassword(''); setBusy(false)
      }
    })()
  }

  return <form onSubmit={submit} className="card">
    <h2 className="h2">{mode === 'signup' ? 'สมัครบัญชีครู' : 'เข้าสู่ระบบบัญชีครู'}</h2>
    {notice && <p className="warnbar" role="status">{notice}</p>}
    <p className="hint">{mode === 'signup'
      ? (hint ?? 'บัญชีนี้ใช้สำรองข้อมูลขึ้นคลาวด์และเชื่อม LINE OA ข้อมูลนักเรียนและบิลยังอยู่ในเครื่องคุณเหมือนเดิม')
      : 'ยังไม่มีบัญชี? กดสมัครใช้งานด้านล่างได้เลย'}</p>
    <label className="fld"><span className="fld__l">อีเมล</span><input className="inp" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
    <label className="fld"><span className="fld__l">รหัสผ่าน</span><input className="inp" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={6} required value={password} onChange={e => setPassword(e.target.value)} /></label>
    <button className="btn btn--primary" disabled={busy}>
      {busy ? (mode === 'signup' ? 'กำลังสมัคร…' : 'กำลังเข้าสู่ระบบ…') : (mode === 'signup' ? 'สมัครใช้งาน' : 'เข้าสู่ระบบ')}
    </button>
    <button type="button" className="btn btn--ghost btn--sm" disabled={busy}
      onClick={() => { setMode(m => (m === 'signup' ? 'signin' : 'signup')); setNotice(''); setPassword('') }}>
      {mode === 'signup' ? 'มีบัญชีอยู่แล้ว เข้าสู่ระบบ' : 'ยังไม่มีบัญชี สมัครใช้งาน'}
    </button>
  </form>
}
