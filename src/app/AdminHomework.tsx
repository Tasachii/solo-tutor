import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../core/store'
import { copy } from '../copy'
import { HOMEWORK_DEFAULT_DUE_DAYS, HOMEWORK_TEXT_MAX, homeworkRows, homeworkSummary, type HomeworkRow, type HomeworkStatus } from '../core/homework'
import { addDays, dateThai } from '../core/format'
import { EmptyState, StatCard } from './components'
import { useToast } from './components/Toast'
import { copyText } from './share'
import LineMessageAction from './LineMessageAction'
import { LineInviteAction } from './useLineLink'

const fill = (text: string, vars: Record<string, string | number>): string =>
  text.replace(/\{(\w+)\}/g, (_m, key: string) => String(vars[key] ?? ''))

const h = copy.homework
const statusTone: Record<HomeworkStatus, string> = { overdue: 'pill--danger', pending: 'pill--warn', submitted: 'pill--ok' }

/**
 * แถวการบ้านหนึ่งใบ — อยู่ระดับโมดูล ไม่ใช่ในตัวหน้า
 *
 * เดิมประกาศไว้ข้างในหน้า ทำให้ React เห็นเป็น component คนละตัวทุกครั้งที่หน้า render ใหม่
 * (แค่ toast เด้งก็ใช่) แถวทั้งแถวจึง unmount แล้ว mount ใหม่ ข้อความแจ้งผลของ LineMessageAction
 * และของปุ่มเชิญที่เพิ่งตั้งไว้จะหายทันที — กับดัก J-44 ตัวเดียวกัน
 */
function RowCard({ row, queueActive }: { row: HomeworkRow; queueActive: boolean }) {
  const { state, dispatch, track } = useStore()
  const toast = useToast()
  const nav = useNavigate()
  const draft = row.reminderDraft ?? row.assignDraft
  const pendingOa = state.messages.some(m => m.meta?.homeworkId === row.item.id && m.oaDelivery)
  return <li className="msg" data-testid="homework-row" data-status={row.status}>
    <div className="msg__hd">
      <b>{row.subjectName}</b>
      <span className="dim">{row.clientName}</span>
      <span className={`pill ${statusTone[row.status]}`}>{h.stats[row.status]}</span>
    </div>
    <p className="p msg__body">{row.item.text}</p>
    <p className="msg__meta">
      <span>{fill(h.assignedOn, { date: dateThai(row.item.assignedAt) })}</span>
      <span>{fill(h.dueOn, { date: dateThai(row.item.dueAt) })}</span>
      {row.status === 'overdue' && <span className="hint--bad">{fill(h.daysLate, { n: row.daysLate })}</span>}
      {row.item.submittedAt && <span>{fill(h.submittedOn, { date: dateThai(row.item.submittedAt) })}</span>}
      {row.assignedSentAt && <span>{fill(h.sentAssign, { date: dateThai(row.assignedSentAt) })}</span>}
      {row.lastReminderAt && <span>{fill(h.lastReminder, { date: dateThai(row.lastReminderAt) })}</span>}
    </p>
    {draft && <p className="msg__preview"><span className={`tagk tagk--${draft.kind}`}>{copy.admin.kinds[draft.kind]}</span> {draft.draft}</p>}
    <div className="btnrow">
      {row.status !== 'submitted'
        ? <button className="btn btn--primary btn--sm" onClick={() => {
          if (!dispatch({ type: 'homeworkSubmitted', id: row.item.id })) return
          track('homework_submitted', { late: row.daysLate })
          toast.push({ text: h.submittedToast, tone: 'ok' })
        }}>{h.markSubmitted}</button>
        : <button className="btn btn--ghost btn--sm" onClick={() => { if (dispatch({ type: 'homeworkReopen', id: row.item.id })) toast.push({ text: h.reopened }) }}>{h.reopen}</button>}
      {row.status === 'overdue' && !row.reminderDraft && <button className="btn btn--secondary btn--sm" onClick={() => {
        if (!dispatch({ type: 'remindHomework', id: row.item.id })) return
        track('remind_homework', { late: row.daysLate })
        toast.push({ text: h.remindDone, tone: 'ok' })
      }}>{h.remindAgain}</button>}
      {draft && <>
        <button className="btn btn--ghost btn--sm" onClick={() => { void copyText(draft.draft).then(ok => toast.push({ text: ok ? copy.toast.copied : copy.toast.copyFailed, tone: ok ? 'ok' : 'danger' })) }}>{copy.admin.copyText}</button>
        <button className="btn btn--secondary btn--sm" onClick={() => nav('/app/admin?tab=drafts')}>{copy.admin.sendLine}</button>
      </>}
      <button className="btn btn--ghost btn--sm btn--danger-text" onClick={() => {
        if (pendingOa) { toast.push({ text: h.removeBlocked, tone: 'warn' }); return }
        if (dispatch({ type: 'deleteHomework', id: row.item.id })) toast.push({ text: h.removed, tone: 'warn' })
      }}>{h.remove}</button>
    </div>
    {draft && <LineMessageAction message={draft} disabled={queueActive} />}
    {/* ต่อท้ายเสมอ ไม่ครอบและไม่ขยับ LineMessageAction (กับดัก J-44) */}
    <LineInviteAction clientId={row.item.clientId} disabled={queueActive} />
  </li>
}

/**
 * แท็บการบ้าน — มอบหมายให้หลายคนพร้อมกัน ติดตามว่าใครส่งแล้ว และเตือนเมื่อเลยกำหนด
 * ข้อความทุกใบร่างให้แล้วเข้าคิวเดียวกับข้อความอื่น ครูตรวจแล้วกดส่ง (share-link หรือ LINE OA)
 */
export default function AdminHomework() {
  const { state, dispatch, track } = useStore()
  const toast = useToast()
  const nav = useNavigate()
  const active = state.subjects.filter(s => s.active)
  const [picked, setPicked] = useState<string[]>([])
  const [text, setText] = useState('')
  const [dueAt, setDueAt] = useState(() => addDays(state.today, HOMEWORK_DEFAULT_DUE_DAYS))
  const [error, setError] = useState('')
  const rows = useMemo(() => homeworkRows(state), [state])
  const summary = homeworkSummary(state)
  const queueActive = !!state.sending

  const assign = () => {
    if (picked.length === 0) { setError(h.pickOne); return }
    if (!text.trim()) { setError(h.textRequired); return }
    if (dueAt < state.today) { setError(h.dueInvalid); return }
    if (!dispatch({ type: 'addHomework', subjectIds: picked, text, dueAt })) { setError(copy.common.saveFailed); return }
    track('assign_homework', { count: picked.length })
    setError(''); setText(''); setPicked([])
    toast.push({ text: fill(h.assigned, { n: picked.length }), tone: 'ok', action: { label: copy.toast.goSend, run: () => nav('/app/admin?tab=drafts') } })
  }

  const groups: HomeworkStatus[] = ['overdue', 'pending', 'submitted']

  return <section aria-label={h.title}>
    <div className="stats">
      <StatCard label={h.stats.overdue} value={`${summary.overdue}`} tone={summary.overdue ? 'danger' : undefined} />
      <StatCard label={h.stats.pending} value={`${summary.pending}`} tone="brand" />
      <StatCard label={h.stats.submitted} value={`${summary.submitted}`} tone="ok" />
    </div>
    {state.mode !== 'real' && <p className="hint">{h.demoNote}</p>}
    <section className="card hwform" aria-label={h.assignTitle}>
      <h2 className="h2">{h.assignTitle}</h2>
      <div className="fld">
        <div className="fld__l">{h.students} · {picked.length}/{active.length}</div>
        <div className="chips">
          {active.map(s => <button key={s.id} type="button" className={`chip${picked.includes(s.id) ? ' chip--on' : ''}`} aria-pressed={picked.includes(s.id)}
            onClick={() => setPicked(p => p.includes(s.id) ? p.filter(x => x !== s.id) : [...p, s.id])}>{s.name}</button>)}
        </div>
        <div className="btnrow btnrow--tight">
          <button type="button" className="linkbtn" style={{ margin: 0 }} onClick={() => setPicked(active.map(s => s.id))}>{h.selectAll}</button>
          <button type="button" className="linkbtn" style={{ margin: 0 }} onClick={() => setPicked([])}>{h.clearAll}</button>
        </div>
      </div>
      <label className="fld"><span className="fld__l">{h.text}</span>
        <textarea className="inp inp--area" rows={3} maxLength={HOMEWORK_TEXT_MAX} value={text} onChange={e => setText(e.target.value)} /></label>
      <p className="hint">{h.textHint}</p>
      <label className="fld"><span className="fld__l">{h.due}</span>
        <input className="inp" type="date" min={state.today} value={dueAt} onChange={e => setDueAt(e.target.value)} /></label>
      {error && <p className="fld__err" role="alert">{error}</p>}
      <button className="btn btn--primary btn--block" onClick={assign}>{h.assign}</button>
    </section>
    {rows.length === 0 ? <EmptyState icon="📝" title={h.empty} /> : groups.map(group => {
      const mine = rows.filter(r => r.status === group)
      if (!mine.length) return null
      return <div key={group}>
        <h2 className="h2" style={{ marginTop: 'var(--space-4)' }}>{h.groups[group]} ({mine.length})</h2>
        <ul className="msgs">{mine.map(row => <RowCard key={row.item.id} row={row} queueActive={queueActive} />)}</ul>
      </div>
    })}
  </section>
}
