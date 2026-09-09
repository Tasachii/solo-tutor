import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../core/store'
import { copy } from '../copy'
import { collectionRows, collectionSummary, type CollectionRow } from '../core/collections'
import { dateThai, money, periodThai } from '../core/format'
import { EmptyState, StatCard } from './components'
import { useToast } from './components/Toast'
import { copyText } from './share'
import LineMessageAction from './LineMessageAction'
import { LineInviteAction } from './useLineLink'
import { linkStates, oaAvailable, sendMessageViaOa, type LinkState } from './oaSend'
import { getSession } from '../integrations/supabaseRest'

const fill = (text: string, vars: Record<string, string | number>): string =>
  text.replace(/\{(\w+)\}/g, (_m, key: string) => String(vars[key] ?? ''))

type BulkResult = { sent: number; skipped: { name: string; reason: string }[] }

/**
 * แท็บค้างจ่าย — บิลค้างทุกใบในหน้าเดียว ครูเห็นข้อความก่อนกด แล้วส่งผ่าน LINE OA ทีละใบหรือทั้งชุด
 * การส่งด้วย share-link (เปิด LINE แล้วยืนยันเอง) ยังอยู่ที่แท็บรอส่งตามเดิม
 */
export default function AdminCollect() {
  const { state, dispatch, track } = useStore()
  const toast = useToast()
  const nav = useNavigate()
  const c = copy.collect
  const rows = useMemo(() => collectionRows(state), [state])
  const summary = collectionSummary(rows)
  const oa = oaAvailable(state)
  const [links, setLinks] = useState<Record<string, LinkState>>({})
  const [checking, setChecking] = useState(false)
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null)
  const [result, setResult] = useState<BulkResult | null>(null)
  const stop = useRef(false)
  const running = useRef(false)
  const workspace = state.lineWorkspaceId

  const checkLinks = async () => {
    if (!oa || !workspace || !getSession()) return
    setChecking(true)
    try { setLinks(await linkStates(state, rows.map(r => r.invoice.clientId))) } finally { setChecking(false) }
  }
  // ตรวจสถานะเชื่อม OA เมื่อเปิดแท็บหรือรายชื่อเปลี่ยน — ผลใช้บอกล่วงหน้าเท่านั้น การส่งจริงตรวจซ้ำอีกชั้น
  useEffect(() => { void checkLinks() }, [workspace, rows.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const sendable = rows.filter(r => r.draft && !r.draft.oaDelivery && links[r.invoice.clientId] !== 'not-linked')
  const queueActive = !!state.sending

  const sendAll = async () => {
    if (running.current || queueActive) return
    if (!getSession()) { toast.push({ text: c.needSession, tone: 'warn' }); return }
    running.current = true; stop.current = false
    const targets = rows.filter(r => r.draft && !r.draft.oaDelivery)
    const out: BulkResult = { sent: 0, skipped: [] }
    setResult(null)
    try {
      for (let i = 0; i < targets.length; i++) {
        if (stop.current) break
        const row = targets[i]
        setProgress({ i: i + 1, n: targets.length })
        if (links[row.invoice.clientId] === 'not-linked') { out.skipped.push({ name: row.clientName, reason: c.skipReason['not-linked'] }); continue }
        const outcome = await sendMessageViaOa(state, dispatch, row.draft!)
        if (outcome.status === 'sent') { out.sent += 1; track('oa_bulk_sent', { kind: row.draft!.kind }); continue }
        const reason = outcome.status === 'blocked' && outcome.reason === 'not-linked' ? c.skipReason['not-linked']
          : outcome.status === 'blocked' && outcome.reason === 'issue' ? c.skipReason.issue
            : outcome.status === 'pending' ? c.skipReason.pending : c.skipReason.failed
        out.skipped.push({ name: row.clientName, reason })
        // no-session / wrong-account / no-workspace / offline หยุดทั้งชุด — ส่งต่อไปก็ผลเดิม
        // `offline` = เครือข่ายล้มก่อนมีรายการใดถูกบันทึก ใบถัดไปก็ล้มเหมือนกัน ไม่ต้องไล่ทำเครื่องหมายล้มทีละใบ
        if (outcome.status === 'blocked' && ['no-session', 'wrong-account', 'no-workspace', 'offline'].includes(outcome.reason)) { toast.push({ text: outcome.notice, tone: 'warn' }); break }
      }
    } finally {
      running.current = false; setProgress(null); setResult(out)
      toast.push({ text: fill(c.bulkResult, { sent: out.sent, skipped: out.skipped.length }), tone: out.sent ? 'ok' : 'warn' })
    }
  }

  const nudge = (row: CollectionRow) => {
    if (!dispatch({ type: 'nudgeInvoice', invoiceId: row.invoice.id })) { toast.push({ text: c.nudgeExists, tone: 'warn' }); return }
    track('nudge_invoice', { days: row.daysOverdue })
    toast.push({ text: c.nudgeDone, tone: 'ok' })
  }

  const dueLine = (row: CollectionRow): string =>
    row.daysOverdue > 0 ? fill(c.daysOverdue, { n: row.daysOverdue })
      : row.dueAt ? (row.dueAt === state.today ? c.dueToday : fill(c.dueOn, { date: dateThai(row.dueAt) })) : c.noDue

  return <section aria-label={c.title}>
    <div className="stats">
      <StatCard label={c.stats.count} value={`${summary.count}`} tone={summary.count ? 'warn' : undefined} />
      <StatCard label={c.stats.outstanding} value={money(summary.outstanding)} tone="danger" />
      <StatCard label={c.stats.overSeven} value={`${summary.overSeven}`} tone={summary.overSeven ? 'danger' : undefined} />
    </div>
    {state.mode !== 'real' && <p className="hint">{c.demoNote}</p>}
    {oa && !workspace && <p className="hint"><Link to="/app/settings/line">ตั้งค่า LINE OA และเชื่อมผู้ปกครอง</Link></p>}
    {rows.length === 0 ? <EmptyState icon="✓" title={c.empty} /> : <>
      {oa && workspace && <div className="btnrow">
        <button className="btn btn--primary" disabled={!!progress || queueActive || sendable.length === 0} onClick={() => void sendAll()}>
          {progress ? fill(c.bulkRunning, progress) : `${c.sendAllOa} (${sendable.length})`}
        </button>
        {progress && <button className="btn btn--ghost" onClick={() => { stop.current = true }}>{copy.common.cancel}</button>}
        <button className="btn btn--ghost btn--sm" disabled={checking || !!progress} onClick={() => void checkLinks()}>{c.oaCheck}</button>
      </div>}
      {oa && workspace && <p className="hint">{c.sendAllOaHint}</p>}
      {result && <div className="bulk" role="status">
        {fill(c.bulkResult, { sent: result.sent, skipped: result.skipped.length })}
        {result.skipped.length > 0 && <ul>{result.skipped.map((s, i) => <li key={i}>{s.name} — {s.reason}</li>)}</ul>}
      </div>}
      <ul className="msgs">
        {rows.map(row => {
          const link = links[row.invoice.clientId]
          return <li className="msg" key={row.invoice.id} data-testid="collect-row">
            <div className="msg__hd">
              <b>{row.subjectName}</b>
              <span className="dim">{row.clientName}</span>
              {row.ladder
                ? <span className={`tagk tagk--reminder`}>{c.ladder[row.ladder]}</span>
                : <span className="tag-neutral">{c.ladderNone}</span>}
            </div>
            <p className="msg__meta">
              <span>{periodThai(row.invoice.period)}</span>
              <b className="num">{money(row.balance)} {copy.common.baht}</b>
              <span className={row.daysOverdue > 7 ? 'hint--bad' : undefined}>{dueLine(row)}</span>
              <span>{row.lastReminder ? fill(c.lastReminder, { date: dateThai(row.lastReminder.at) }) : c.neverReminded}{row.remindersSent > 1 ? ` · ${fill(c.remindersSent, { n: row.remindersSent })}` : ''}</span>
              {oa && workspace && <span className={`pill${link === 'linked' ? ' pill--ok' : link === 'not-linked' ? ' pill--warn' : ''}`}>
                {link === 'linked' ? c.oaLinked : link === 'not-linked' ? c.oaNotLinked : c.oaUnknown}
              </span>}
            </p>
            {row.draft
              ? <>
                <p className="msg__preview"><span className={`tagk tagk--${row.draft.kind}`}>{copy.admin.kinds[row.draft.kind]}</span> {row.draft.draft}</p>
                <div className="btnrow">
                  <button className="btn btn--ghost btn--sm" onClick={() => { void copyText(row.draft!.draft).then(ok => toast.push({ text: ok ? copy.toast.copied : copy.toast.copyFailed, tone: ok ? 'ok' : 'danger' })) }}>{copy.admin.copyText}</button>
                  <button className="btn btn--secondary btn--sm" onClick={() => nav('/app/admin?tab=drafts')}>{copy.admin.sendLine}</button>
                </div>
                <LineMessageAction message={row.draft} disabled={!!progress || queueActive} />
              </>
              : <div className="btnrow">
                <span className="dim">{c.noDraft}</span>
                <button className="btn btn--secondary btn--sm" onClick={() => nudge(row)}>{c.nudge}</button>
              </div>}
            {/* ต่อท้ายแถวเสมอ ไม่ครอบและไม่ขยับ LineMessageAction (กับดัก J-44) */}
            <LineInviteAction clientId={row.invoice.clientId} disabled={!!progress || queueActive} />
          </li>
        })}
      </ul>
    </>}
  </section>
}
