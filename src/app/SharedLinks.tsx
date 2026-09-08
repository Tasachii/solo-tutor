import { useCallback, useEffect, useState } from 'react'
import { copy } from '../copy'
import { getSession, getSupabaseConfig } from '../integrations/supabaseRest'
import { listSharedDocuments, revokeSharedDocument, type SharedDocumentRow } from '../core/sharedDocumentApi'
import { DEFAULT_SHARE_DAYS, openLabel } from '../core/documentShare'
import { forgetLink, rememberedLink } from '../core/documentPublish'
import { loadKey } from '../core/cloudKey'
import { copyText } from './share'
import { useToast } from './components/Toast'

const dayText = (iso: string): string => {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '—'
    : at.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' })
}

interface Shown extends SharedDocumentRow { name: string | null }

type Phase = 'loading' | 'ready' | 'failed' | 'signed-out' | 'unavailable'

/**
 * รายการลิงก์เอกสารที่ครูแชร์ไว้ พร้อมปุ่มปิดทีละใบ
 *
 * อยู่ในหน้าบัญชีเพราะที่นั่นคือที่ที่ครูจัดการ "อะไรออกจากเครื่องนี้ไปแล้วบ้าง" อยู่ก่อนแล้ว
 * (คลาวด์ กุญแจกู้คืน การลบข้อมูล) การเพิกถอนลิงก์เป็นเรื่องเดียวกัน ไม่ใช่หน้าจอใหม่ของตัวเอง
 *
 * ป้ายชื่อของแต่ละใบถูกเข้ารหัสด้วยกุญแจคลาวด์ของครู เซิร์ฟเวอร์จึงยังอ่านไม่ออก
 * เครื่องที่ไม่มีกุญแจจะเห็นแค่ชนิดเอกสารกับวันที่ แต่ยังกดปิดลิงก์ได้ตามปกติ
 */
export default function SharedLinks() {
  const toast = useToast()
  const c = copy.sharedLinks
  const [phase, setPhase] = useState<Phase>('loading')
  const [rows, setRows] = useState<Shown[]>([])
  const [asking, setAsking] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!getSupabaseConfig()) { setPhase('unavailable'); return undefined }
    let session
    try { session = getSession() } catch { session = null }
    if (!session) { setPhase('signed-out'); return undefined }
    const providerId = session.user.id
    const abort = new AbortController()
    let live = true
    setPhase('loading')
    void (async () => {
      try {
        const found = await listSharedDocuments(abort.signal)
        const key = await loadKey(providerId)
        const named: Shown[] = []
        for (const row of found) {
          const name = key && row.label && row.label_iv
            ? await openLabel(key, { cipher: row.label, iv: row.label_iv })
            : null
          named.push({ ...row, name })
        }
        if (!live) return
        setRows(named)
        setPhase('ready')
      } catch {
        if (live) setPhase('failed')
      }
    })()
    return () => { live = false; abort.abort() }
  }, [attempt])

  const reload = useCallback(() => setAttempt(n => n + 1), [])

  const revoke = async (token: string) => {
    setBusy(token)
    try {
      const changed = await revokeSharedDocument(token)
      setRows(list => list.map(row => (row.token === token
        ? { ...row, revoked_at: row.revoked_at ?? new Date().toISOString() } : row)))
      let providerId = ''
      try { providerId = getSession()?.user.id ?? '' } catch { providerId = '' }
      if (providerId) forgetLink(providerId, token)
      toast.push({ text: changed ? c.revokeDone : c.revokeFailed, tone: changed ? 'ok' : 'warn' })
    } catch {
      toast.push({ text: c.revokeFailed, tone: 'danger' })
    } finally {
      setBusy(null)
      setAsking(null)
    }
  }

  const share = async (token: string) => {
    let providerId = ''
    try { providerId = getSession()?.user.id ?? '' } catch { providerId = '' }
    const link = providerId ? rememberedLink(providerId, token) : null
    if (!link) { toast.push({ text: c.noKeyHere, tone: 'warn' }); return }
    const ok = await copyText(link)
    toast.push({ text: ok ? c.copied : copy.toast.copyFailed, tone: ok ? 'ok' : 'danger' })
  }

  return <section className="card">
    <h2 className="h2">{c.title}</h2>
    <p className="hint">{c.intro}</p>
    <p className="hint">{c.expiryNote.replace('{days}', String(DEFAULT_SHARE_DAYS))}</p>
    {/* ข้อความนี้ต้องอยู่ตรงนี้เสมอ ไม่ใช่แค่ในกล่องยืนยัน — ครูต้องรู้ขอบเขตก่อนตัดสินใจ ไม่ใช่ตอนกดแล้ว */}
    <p className="hint">{c.honesty}</p>

    {phase === 'unavailable' && <p className="hint">{c.unavailable}</p>}
    {phase === 'signed-out' && <p className="hint">{c.signedOut}</p>}
    {phase === 'loading' && <p role="status" aria-live="polite">{c.loading}</p>}
    {phase === 'failed' && <>
      <p className="fld__err" role="alert">{c.failed}</p>
      <button className="btn btn--secondary btn--sm" onClick={reload}>{c.reload}</button>
    </>}

    {phase === 'ready' && (rows.length === 0
      ? <p className="hint">{c.empty}</p>
      : <ul className="rows">
        {rows.map(row => {
          const revoked = !!row.revoked_at
          const expired = Date.parse(row.expires_at) <= Date.now()
          return <li key={row.token} className="msg">
            <div className="msg__hd">
              <span className="tagk">{c.kinds[row.kind]}</span>
              {revoked && <span className="tag-neutral">{c.revokedTag}</span>}
              {!revoked && expired && <span className="tag-neutral">{c.expired}</span>}
            </div>
            <p className="p">{row.name ?? c.kinds[row.kind]}</p>
            <p className="hint">
              {c.sharedOn} {dayText(row.created_at)} · {c.expiresOn} {dayText(row.expires_at)}
            </p>
            {asking === row.token ? (
              <div className="confirm">
                <span className="confirm__q">{c.revokeConfirm}</span>
                <div className="btnrow">
                  <button className="btn btn--primary btn--sm" disabled={busy === row.token}
                    onClick={() => { void revoke(row.token) }}>{copy.common.confirm}</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setAsking(null)}>{copy.common.cancel}</button>
                </div>
              </div>
            ) : (
              <div className="btnrow">
                {!revoked && !expired && <button className="btn btn--ghost btn--sm"
                  onClick={() => { void share(row.token) }}>{c.copyLink}</button>}
                {!revoked && <button className="btn btn--secondary btn--sm"
                  onClick={() => setAsking(row.token)}>{c.revoke}</button>}
              </div>
            )}
          </li>
        })}
      </ul>)}
  </section>
}
