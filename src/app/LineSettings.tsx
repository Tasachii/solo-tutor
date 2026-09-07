import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../core/store'
import { getSession, getSupabaseConfig, invoke, rpc, signIn, signOut } from '../integrations/supabaseRest'
import { deliveryTarget, readChannel, syncClients, type LineChannel } from '../integrations/lineApi'
import { ConfirmSheet } from './components'
import { copyText } from './share'

const statusText: Record<LineChannel['status'], string> = {
  active: 'เชื่อมต่อแล้ว', pending: 'กำลังตั้งค่า', setup_failed: 'ตั้งค่า webhook ไม่สำเร็จ', invalid: 'สิทธิ์ LINE หมดอายุ', disabled: 'ยกเลิกการเชื่อมต่อแล้ว',
}
const readSessionSafely = () => { try { return getSession() } catch { return null } }

export default function LineSettings() {
  const { state, dispatch } = useStore()
  const [session, setSession] = useState(readSessionSafely)
  const [channel, setChannel] = useState<LineChannel | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [secret, setSecret] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [disconnect, setDisconnect] = useState(false)
  const [codes, setCodes] = useState<Record<string, { code: string; expires_at: string }>>({})
  const [linked, setLinked] = useState<Record<string, boolean>>({})
  const config = getSupabaseConfig()
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setNotice('')
    try { await work() } catch { setNotice('ทำรายการไม่สำเร็จ กรุณาตรวจการเชื่อมต่อและเข้าสู่ระบบอีกครั้งหากหมดอายุ') }
    finally { setBusy(false); setSession(readSessionSafely()) }
  }
  const refresh = async () => {
    setChannel(await readChannel())
    if (state.lineWorkspaceId) {
      const rows = await Promise.all(state.clients.map(async c => {
        const target = await deliveryTarget(state.lineWorkspaceId!, c.id)
        return [c.id, !!target?.recipient_id && !target.unfollowed_at] as const
      }))
      setLinked(Object.fromEntries(rows))
    }
  }
  useEffect(() => {
    if (session && state.mode === 'real') void run(refresh)
    // Refresh on opening this screen/account changes; user can refresh after parent adds OA.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id])
  const login = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => { try { setSession(await signIn(email, password)) } finally { setPassword('') } })
  }
  const connect = (e: FormEvent) => {
    e.preventDefault()
    const credentials = { channelSecret: secret, accessToken: token }
    setSecret(''); setToken('')
    void run(async () => {
      const response = await invoke<{ ok: boolean; displayName?: string }>('line-connect', credentials)
      if (!response.ok) throw new Error('connect')
      await refresh()
      setNotice('เชื่อมบัญชี ' + (response.displayName ?? 'LINE OA') + ' แล้ว กรุณาเปิด Use webhook ใน LINE Developers')
    })
  }
  const issueCode = (clientId: string) => void run(async () => {
    let workspace = state.lineWorkspaceId
    if (!workspace) {
      workspace = crypto.randomUUID()
      if (!dispatch({ type: 'lineWorkspace', id: workspace, providerId: session!.user.id })) throw new Error('storage')
    }
    if (state.lineProviderId && state.lineProviderId !== session!.user.id) throw new Error('wrong-account')
    const mapping = await syncClients(workspace, state.clients)
    const client = mapping.find(c => c.local_client_key === clientId)
    if (!client) throw new Error('client')
    const rows = await rpc<{ code: string; expires_at: string }[]>('issue_line_link_code', { p_client_id: client.client_id })
    if (!rows[0]) throw new Error('code')
    setCodes(prev => ({ ...prev, [clientId]: rows[0] }))
    setNotice('ส่งรหัสนี้ให้ผู้ปกครองของรายชื่อนี้โดยตรง แล้วให้พิมพ์รหัสในแชท OA')
  })
  return <div className="pane line-settings">
    <div className="rowhead"><h1 className="h1">เชื่อม LINE OA</h1><Link to="/app/admin">กลับหน้าแอดมิน</Link></div>
    <p className="hint">ส่งข้อความจากบัญชีร้านถึงผู้ปกครองที่ผูกไว้ โดยครูตรวจข้อความและกดส่งเอง</p>
    {notice && <p className="warnbar" role="status">{notice}</p>}
    {state.mode !== 'real' ? <p>ใช้การเชื่อม LINE OA ในโหมดข้อมูลจริง เปิดเมนูแล้วเลือกเริ่มใช้จริงก่อน</p>
      : !config ? <div className="card"><h2 className="h2">รอตั้งค่าระบบเชื่อมต่อ</h2><p>ผู้ดูแลต้องผูกโปรเจกต์สำหรับบัญชีครูก่อน จึงจะเข้าสู่ระบบและเชื่อม OA ได้</p><p className="hint">ระหว่างนี้ยังเปิด LINE เพื่อส่งข้อความเองจากหน้าแอดมินได้</p></div>
      : !session ? <form onSubmit={login} className="card">
        <h2 className="h2">เข้าสู่ระบบบัญชีครู</h2><p className="hint">ใช้บัญชีที่ผู้ดูแลสร้างให้สำหรับ Solo Tutor</p>
        <label className="fld"><span className="fld__l">อีเมล</span><input className="inp" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label className="fld"><span className="fld__l">รหัสผ่าน</span><input className="inp" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
        <button className="btn btn--primary" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
      </form> : <>
        <div className="rowhead"><span className="dim">{session.user.email ?? 'บัญชีครู'}</span><button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => { try { signOut() } catch { setNotice('ล้างสถานะเข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสิทธิ์เก็บข้อมูลของเบราว์เซอร์'); return }; setSession(null); setChannel(null); setCodes({}); setLinked({}); setSecret(''); setToken('') }}>ออกจากระบบเครื่องนี้</button></div>
        {state.lineProviderId && state.lineProviderId !== session.user.id ? <p className="warnbar">ข้อมูลชุดนี้ผูกกับบัญชีอื่น กรุณาออกจากระบบแล้วเข้าสู่บัญชีเดิม</p> : <>
        <section className="card">
          <h2 className="h2">{channel?.display_name ?? 'บัญชี LINE OA'}</h2>
          <p role="status">{channel ? statusText[channel.status] : 'ยังไม่ได้เชื่อมบัญชี'}</p>
          {channel && <><p>ใช้โควตาของ Solo Tutor {channel.quota_used} / {channel.quota_limit} ข้อความ · รอบ {channel.quota_month}</p><p className="hint">ไม่รวมข้อความที่ส่งจากเครื่องมืออื่น โควตาจริงตรวจได้ใน LINE OA Manager</p></>}
          {channel?.basic_id && <a className="btn btn--secondary" href={`https://line.me/R/ti/p/${encodeURIComponent(channel.basic_id)}`} target="_blank" rel="noreferrer">เปิดลิงก์เพิ่มเพื่อน OA</a>}
          <div className="btnrow"><button className="btn btn--ghost" disabled={busy} onClick={() => void run(refresh)}>ตรวจสถานะอีกครั้ง</button>
          {channel && channel.status !== 'disabled' && <button className="btn btn--ghost" disabled={busy} onClick={() => setDisconnect(true)}>ยกเลิกการเชื่อม OA</button>}</div>
        </section>
        <form className="card" onSubmit={connect}>
          <h2 className="h2">{channel?.status === 'active' ? 'อัปเดตสิทธิ์บัญชี OA' : 'ตั้งค่าบัญชี OA'}</h2>
          <p className="hint">คัดลอกจาก Messaging API ของ OA ที่ต้องการเชื่อม ข้อมูลสิทธิ์จะส่งไปเก็บบนเซิร์ฟเวอร์และล้างจากฟอร์มทันที</p>
          <label className="fld"><span className="fld__l">Channel secret</span><input className="inp" type="password" autoComplete="off" required value={secret} onChange={e => setSecret(e.target.value)} /></label>
          <label className="fld"><span className="fld__l">Channel access token</span><input className="inp" type="password" autoComplete="off" required value={token} onChange={e => setToken(e.target.value)} /></label>
          <button className="btn btn--primary" disabled={busy || !secret.trim() || !token.trim()}>{busy ? 'กำลังทำรายการ…' : 'เชื่อมบัญชี OA'}</button>
        </form>
        <section className="card"><h2 className="h2">เชื่อมผู้ปกครอง</h2>
          <p className="hint">เมื่อกดสร้างรหัส ระบบจะบันทึกชื่อผู้จ่ายไว้เพื่อจับคู่กับ OA ให้ผู้ปกครองเพิ่มเพื่อน OA แล้วพิมพ์รหัส 6 หลัก รหัสใช้ครั้งเดียวและหมดอายุใน 24 ชั่วโมง</p>
          {!state.clients.length && <p>เพิ่มผู้เรียนและชื่อผู้ปกครองก่อน</p>}
          <ul className="rows">{state.clients.map(c => <li key={c.id} className="line-parent"><b>{c.name}</b><span>{linked[c.id] ? 'เชื่อมแล้ว' : 'ยังไม่เชื่อม'}</span>
            <button className="btn btn--secondary btn--sm" disabled={busy || channel?.status !== 'active'} onClick={() => issueCode(c.id)}>{codes[c.id] ? 'สร้างรหัสใหม่' : 'สร้างรหัสเชื่อม'}</button>
            {codes[c.id] && <div><p>รหัสสำหรับ {c.name}: <strong>{codes[c.id].code}</strong></p><p className="hint">หมดอายุ {new Date(codes[c.id].expires_at).toLocaleString('th-TH')}</p><button className="btn btn--ghost btn--sm" onClick={() => void copyText(codes[c.id].code).then(ok => setNotice(ok ? 'คัดลอกรหัสแล้ว' : 'คัดลอกไม่สำเร็จ'))}>คัดลอกรหัส</button></div>}
          </li>)}</ul>
        </section>
        </>}
      </>}
    {disconnect && <ConfirmSheet title="ยกเลิกการเชื่อม OA" body="ระบบจะล้างสิทธิ์ OA ที่เก็บไว้และหยุดรายการที่ยังอยู่ในคิว ข้อความที่เริ่มส่งแล้วอาจยังถึงผู้รับได้ หากต้องการเพิกถอนสิทธิ์ที่ LINE ด้วย ให้ยกเลิก token ใน LINE Developers" confirmLabel="ยกเลิกการเชื่อม OA" danger onClose={() => setDisconnect(false)} onConfirm={async () => {
      try { await rpc('disconnect_line_channel', {}); setCodes({}); await refresh(); return true }
      catch { setNotice('ยกเลิกไม่สำเร็จ กรุณาตรวจการเชื่อมต่อแล้วลองอีกครั้ง'); return false }
    }} />}
  </div>
}
