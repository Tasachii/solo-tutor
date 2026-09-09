import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../core/store'
import { getSupabaseConfig, invoke, rpc } from '../integrations/supabaseRest'
import { AuthForm } from './components/AuthForm'
import { useCloudSync } from './CloudSync'
import type { LineChannel } from '../integrations/lineApi'
import { ConfirmSheet } from './components'
import { copyText } from './share'
import { useLineLink } from './useLineLink'
import { lineLinkCopy } from './lineLinkCopy'

const statusText: Record<LineChannel['status'], string> = {
  active: 'เชื่อมต่อแล้ว — ตรวจ token และ Webhook URL ผ่าน', pending: 'กำลังตั้งค่า', setup_failed: 'ตั้งค่า webhook ไม่สำเร็จ', invalid: 'สิทธิ์ LINE หมดอายุ', disabled: 'ยกเลิกการเชื่อมต่อแล้ว',
}
/** ครูออกรหัสให้ผู้ปกครองคนไหน คนนั้นเป็นผู้พิมพ์รหัสเอง — ฐานการยินยอมอยู่ตรงนั้น ไม่ใช่ที่ครู */
const CONSENT = 'ส่งรหัสนี้ให้ผู้ปกครองของรายชื่อนี้โดยตรง แล้วให้พิมพ์รหัสในแชท OA — การพิมพ์รหัสถือเป็นการยินยอมให้เก็บ LINE id เพื่อรับบิล (ดูหน้านโยบายข้อมูล)'

export default function LineSettings() {
  const { state } = useStore()
  const cloud = useCloudSync()
  // สถานะการเชื่อมของผู้จ่ายทุกคนมาจาก hook เดียวกับปุ่มเชิญบนการ์ดในแอดมิน — ทางออกรหัสมีทางเดียว
  const link = useLineLink(state.clients.map(c => c.id))
  const [secret, setSecret] = useState('')
  const [token, setToken] = useState('')
  const [disconnect, setDisconnect] = useState(false)
  // ฟอร์มสิทธิ์พับเมื่อเชื่อมแล้ว แต่หลังเพิ่งกดเชื่อมต้องยังเห็นอยู่ ครูจะได้รู้ว่าช่องถูกล้างจริง
  const [revealed, setRevealed] = useState(false)
  const config = getSupabaseConfig()
  const { session, channel, busy, notice, codes } = link
  const active = channel?.status === 'active'
  const demo = state.mode !== 'real'

  useEffect(() => {
    // เปิดหน้านี้ = ตรวจใหม่ทุกแถว ไม่ใช่ใช้ค่าที่แคชไว้ตอนอยู่หน้าแอดมิน
    // ครูมาหน้านี้เพราะอยากรู้ว่าผู้ปกครองพิมพ์รหัสหรือยัง ค่าค้างจะตอบผิด · refresh ล้างผู้จ่ายที่ลบแล้วให้ด้วย
    //
    // ที่เดียวในแอปที่ขอ `joinInFlight`: effect ของ hook เพิ่งยิงคำขอชุดเดียวกันไปเมื่อกี้
    // ยิงซ้ำทั้งชุดคือจ่ายค่าเน็ตสองเท่าเพื่อคำตอบเดิม · ปุ่มที่ครูกดเองบนหน้านี้ยังยิงใหม่เสมอ
    if (session) void link.refresh(undefined, { joinInFlight: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id])

  const connect = (e: FormEvent) => {
    e.preventDefault()
    const credentials = { channelSecret: secret, accessToken: token }
    setSecret(''); setToken(''); setRevealed(true)
    void link.run(async () => {
      const response = await invoke<{ ok: boolean; displayName?: string }>('line-connect', credentials)
      if (!response.ok) throw new Error('connect')
      await link.refresh()
      link.setNotice('เชื่อมบัญชี ' + (response.displayName ?? 'LINE OA') + ' แล้ว กรุณาเปิด Use webhook ใน LINE Developers')
    })
  }
  return <div className="pane line-settings">
    <div className="rowhead"><h1 className="h1">เชื่อม LINE OA</h1><Link to="/app/admin">กลับหน้าแอดมิน</Link></div>
    <p className="hint">ส่งข้อความจาก LINE OA ของคุณถึงผู้ปกครองที่ผูกไว้ โดยครูตรวจข้อความและกดส่งเอง</p>
    {/* กติกาเจ้าของ 9 ก.ย.: ปุ่มทุกปุ่มทำของจริง — หน้านี้ในเดโมจึงเป็นหน้าเดียวกับโหมดจริง
        ไม่ใช่คำอธิบาย · สิ่งเดียวที่ต่างคือแถบบอกว่าตัวเลขในข้อความเป็นข้อมูลตัวอย่าง */}
    {demo && <p className="warnbar" role="status">สมุดนี้เป็นข้อมูลตัวอย่าง แต่ LINE OA ส่งจริงถึงเครื่องที่คุณจับคู่ด้วยรหัสของคุณเอง</p>}
    {/* รายชื่อผู้จ่ายเป็นคนละชุดในแต่ละชุดข้อมูล (c1… / g1… / n1… ฯลฯ) การจับคู่ผูกกับรหัสผู้จ่าย
        จึงมองไม่เห็นข้ามชุด แต่ไม่หาย — สมุด LINE เดิมถูกยกมาให้ทุกครั้งที่สลับชุดหรือรีเซ็ต */}
    {demo && !!state.lineWorkspaceId && <p className="hint">การจับคู่ผูกกับรายชื่อของชุดข้อมูลนี้ — สลับไปชุดอื่นจะเห็นว่ายังไม่จับคู่ เพราะรายชื่อเป็นคนละชุด กลับมาชุดนี้แล้วการจับคู่เดิมยังอยู่</p>}
    {notice && <p className="warnbar" role="status">{notice}</p>}
    {!config ? <div className="card"><h2 className="h2">รอตั้งค่าระบบเชื่อมต่อ</h2><p>ผู้ดูแลต้องผูกโปรเจกต์สำหรับบัญชีครูก่อน จึงจะเข้าสู่ระบบและเชื่อม OA ได้</p><p className="hint">ระหว่างนี้ยังเปิด LINE เพื่อส่งข้อความเองจากหน้าแอดมินได้</p></div>
      : !session ? <AuthForm onSession={(next) => { link.reloadSession(next); cloud.refreshSession() }} /> : <>
        <div className="rowhead"><span className="dim">{session.user.email ?? 'บัญชีครู'}</span><button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => { if (!cloud.signOutDevice()) { link.setNotice('ล้างสถานะเข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสิทธิ์เก็บข้อมูลของเบราว์เซอร์'); return }; link.reloadSession(null); setSecret(''); setToken(''); setRevealed(false) }}>ออกจากระบบเครื่องนี้</button></div>
        {link.wrongAccount ? <p className="warnbar">ข้อมูลชุดนี้ผูกกับบัญชีอื่น กรุณาออกจากระบบแล้วเข้าสู่บัญชีเดิม</p> : <>
        <section className="card">
          <h2 className="h2">{channel?.display_name ?? 'บัญชี LINE OA'}</h2>
          <p role="status">{!link.channelLoaded ? 'กำลังตรวจสถานะบัญชี OA…' : channel ? statusText[channel.status] : 'ยังไม่ได้เชื่อมบัญชี'}</p>
          {/* ลำดับงานอยู่บนสุดของหน้า ครูใหม่จึงรู้ว่าต้องทำอะไรก่อน-หลัง โดยไม่ต้องเปิดคู่มือ */}
          <ol>{lineLinkCopy.steps.map(step => <li key={step}>{step}</li>)}</ol>
          {link.channelLoaded && !channel && <p className="hint">การเชื่อม OA ผูกกับบัญชีครูที่กดเชื่อม ถ้าทีมเคยเชื่อมไว้แล้วแต่ตรงนี้ยังขึ้นว่ายังไม่ได้เชื่อม แปลว่ากำลังเข้าสู่ระบบ<b>คนละบัญชี</b> — กด "ออกจากระบบเครื่องนี้" ด้านบน แล้วเข้าด้วยบัญชีที่เชื่อมไว้</p>}
          {active && <div className="hint">
            <p><b>ตรวจใน LINE Developers ต่ออีก 2 จุด:</b> เปิด Use webhook และกด Verify ให้ขึ้น Success สถานะด้านบนยืนยันเฉพาะ token, URL และการทดสอบ endpoint จึงไม่ได้ยืนยันว่า Use webhook เปิดอยู่</p>
            <p>ใน LINE OA Manager ให้ปิด Greeting message และ Auto-response เพื่อไม่ให้ข้อความระบบซ้ำกับข้อความจากครู</p>
            <p>จากนั้นให้ผู้ปกครองเพิ่มเพื่อน OA พิมพ์รหัส 6 หลัก แล้วกลับมากด “ตรวจสถานะอีกครั้ง” ก่อนลองส่ง</p>
          </div>}
          {channel && <><p>ใช้โควตาของ Solo Tutor {channel.quota_used} / {channel.quota_limit} ข้อความ · รอบ {channel.quota_month}</p><p className="hint">ไม่รวมข้อความที่ส่งจากเครื่องมืออื่น โควตาจริงตรวจได้ใน LINE OA Manager</p></>}
          {channel?.basic_id && <a className="btn btn--secondary" href={`https://line.me/R/ti/p/${encodeURIComponent(channel.basic_id)}`} target="_blank" rel="noreferrer">เปิดลิงก์เพิ่มเพื่อน OA</a>}
          <div className="btnrow"><button className="btn btn--ghost" disabled={busy} onClick={() => void link.refresh()}>ตรวจสถานะอีกครั้ง</button>
          {channel && channel.status !== 'disabled' && <button className="btn btn--ghost" disabled={busy} onClick={() => setDisconnect(true)}>ยกเลิกการเชื่อม OA</button>}</div>
        </section>
        {/* ยังไม่รู้ว่าเชื่อมอยู่ไหม = ยังไม่วางฟอร์ม — ไม่งั้นช่องวาง secret/token กระพริบขึ้นแล้วยุบ
            ครูกำลังจะวางค่าที่เพิ่งออกใหม่ในจังหวะนั้นพอดี ตำแหน่งต้องไม่ขยับใต้เมาส์ */}
        {!link.channelLoaded
          ? <section className="card"><p className="hint">กำลังตรวจสถานะบัญชี OA…</p></section>
          : active && !revealed
          ? <section className="card">
            <h2 className="h2">สิทธิ์บัญชี OA</h2>
            <p className="hint">เชื่อมไว้แล้ว ไม่ต้องกรอกอะไรอีก เปิดฟอร์มนี้เฉพาะตอนที่ออก Channel secret หรือ token ใหม่ใน LINE Developers</p>
            <button className="btn btn--ghost" onClick={() => setRevealed(true)}>{lineLinkCopy.reveal}</button>
          </section>
          : <form className="card" onSubmit={connect}>
            <h2 className="h2">{active ? 'อัปเดตสิทธิ์บัญชี OA' : 'ตั้งค่าบัญชี OA'}</h2>
            <p className="hint">คัดลอกจาก Messaging API ของ OA ที่ต้องการเชื่อม ข้อมูลสิทธิ์จะส่งไปเก็บบนเซิร์ฟเวอร์และล้างจากฟอร์มทันที</p>
            <label className="fld"><span className="fld__l">Channel secret</span><input className="inp" type="password" autoComplete="off" required value={secret} onChange={e => setSecret(e.target.value)} /></label>
            <label className="fld"><span className="fld__l">Channel access token</span><input className="inp" type="password" autoComplete="off" required value={token} onChange={e => setToken(e.target.value)} /></label>
            <button className="btn btn--primary" disabled={busy || !secret.trim() || !token.trim()}>{busy ? 'กำลังทำรายการ…' : 'เชื่อมบัญชี OA'}</button>
          </form>}
        <section className="card"><h2 className="h2">เชื่อมผู้ปกครอง</h2>
          <p className="hint">เมื่อกดเชิญ ระบบจะบันทึกชื่อผู้จ่ายไว้เพื่อจับคู่กับ OA ให้ผู้ปกครองเพิ่มเพื่อน OA แล้วพิมพ์รหัส 6 หลัก รหัสใช้ครั้งเดียวและหมดอายุใน 24 ชั่วโมง · การพิมพ์รหัสถือเป็นการยินยอมให้เก็บ LINE id เพื่อรับบิล (ดูหน้านโยบายข้อมูล)</p>
          {!state.clients.length && <p>ยังไม่มีรายชื่อให้ผูก — <Link to="/app/subjects">เพิ่มผู้เรียนและชื่อผู้ปกครองก่อน</Link> แล้วกลับมาหน้านี้</p>}
          <ul className="rows">{state.clients.map(c => {
            const linked = link.status(c.id) === 'linked'
            return <li key={c.id} className="line-parent"><b>{c.name}</b><span>{linked ? 'เชื่อมแล้ว' : 'ยังไม่เชื่อม'}</span>
              {/* ปุ่มเดียวกับที่อยู่บนการ์ดข้อความ: ออกรหัส + คัดลอกข้อความเชิญ ให้วางในแชทได้เลย
                  ยังไม่ผูก = ปุ่มเชิญปุ่มเดียว (เคยมี "สร้างรหัสเชื่อม" คู่กันทั้งที่ทำสิ่งเดียวกัน — เจ้าของ 9 ก.ย.: ปุ่มซ้ำ)
                  ผูกแล้ว = "สร้างรหัสใหม่" ไว้ย้ายไป LINE อีกเครื่อง เช่น เปลี่ยนจากแม่เป็นพ่อ */}
              {!linked && <button className="btn btn--primary btn--sm" disabled={busy || !active} onClick={() => void link.invite(c.id)}>{lineLinkCopy.invite}</button>}
              {linked && <button className="btn btn--secondary btn--sm" disabled={busy || !active} onClick={() => void link.run(async () => { await link.issue(c.id); link.setNotice(CONSENT) })}>สร้างรหัสใหม่</button>}
              {codes[c.id] && <div><p>รหัสสำหรับ {c.name}: <strong>{codes[c.id].code}</strong></p><p className="hint">หมดอายุ {new Date(codes[c.id].expires_at).toLocaleString('th-TH')}</p>
                <div className="btnrow">
                  {/* ผู้ปกครองย้าย LINE (สร้างรหัสใหม่) ก็ต้องได้ข้อความเชิญเต็มโดยไม่ต้องพิมพ์เอง — รีวิว 9 ก.ย. */}
                  <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void link.copyInvite(c.id)}>{lineLinkCopy.copyInvite}</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => void copyText(codes[c.id].code).then(ok => link.setNotice(ok ? 'คัดลอกรหัสแล้ว' : 'คัดลอกไม่สำเร็จ'))}>คัดลอกเฉพาะรหัส</button>
                </div></div>}
            </li>
          })}</ul>
        </section>
        </>}
      </>}
    {disconnect && <ConfirmSheet title="ยกเลิกการเชื่อม OA" body="ระบบจะล้างสิทธิ์ OA ที่เก็บไว้และหยุดรายการที่ยังอยู่ในคิว ข้อความที่เริ่มส่งแล้วอาจยังถึงผู้รับได้ หากต้องการเพิกถอนสิทธิ์ที่ LINE ด้วย ให้ยกเลิก token ใน LINE Developers" confirmLabel="ยกเลิกการเชื่อม OA" danger onClose={() => setDisconnect(false)} onConfirm={async () => {
      try { await rpc('disconnect_line_channel', {}); link.clearCodes(); setRevealed(false); await link.refresh(); return true }
      catch { link.setNotice('ยกเลิกไม่สำเร็จ กรุณาตรวจการเชื่อมต่อแล้วลองอีกครั้ง'); return false }
    }} />}
  </div>
}
