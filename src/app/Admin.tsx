import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useStore } from '../core/store'
import { copy } from '../copy'
import { clientById } from '../core/ledger'
import { sortDrafts, mkMessage } from '../core/messages'
import { answer } from '../core/faq'
import { periodOf } from '../core/format'
import { EmptyState, Skeleton, StatCard } from './components'
import { useToast } from './components/Toast'
import { copyText, openLine } from './share'
import type { Message } from '../core/types'
import { messageSendIssue } from '../core/messageDelivery'
import { isPaymentDestination } from '../core/paymentDestination'

function MessageCard({ m, awaiting, left, onSend, onSent, onCancel, onSkipQueue, onCopy, onSkip, onEdit }: {
  m: Message; awaiting: boolean; left: number
  onSend: () => void; onSent: () => void; onCancel: () => void; onSkipQueue: () => void; onCopy: () => void
  onSkip: () => void; onEdit: (t: string) => boolean
}) {
  const { state, dispatch } = useStore()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(m.draft)
  const [editError, setEditError] = useState('')
  const client = clientById(state, m.clientId)
  const issue = messageSendIssue(state, m)

  return (
    <li className="msg">
      <div className="msg__hd">
        <span className={`tagk tagk--${m.kind}`}>{copy.admin.kinds[m.kind]}</span>
        <span className="dim">{client?.name}</span>
        {m.edited && <span className="tag-neutral">{copy.admin.editedTag}</span>}
      </div>
      {editing ? (
        <>
          <label className="fld">
            <span className="fld__l">แก้ข้อความถึง {client?.name ?? 'ผู้จ่าย'}</span>
            <textarea className="inp inp--area" value={text} rows={5} aria-invalid={!!editError || undefined}
              aria-describedby={editError ? `message-${m.id}-error` : undefined}
              onChange={(e) => { setText(e.target.value); setEditError(e.target.value.trim() ? '' : 'ข้อความต้องไม่ว่าง') }} />
          </label>
          {editError && <p id={`message-${m.id}-error`} className="fld__err" role="alert">{editError}</p>}
        </>
      ) : (
        <p className="p msg__body">{m.draft}</p>
      )}
      {issue && <p className="hint" role="status">{issue}</p>}
      {m.edited && issue && <button className="btn btn--secondary btn--sm" onClick={() => {
        if (dispatch({ type: 'refreshMessage', id: m.id })) setEditing(false)
      }}>ใช้ร่างยอดล่าสุดแทนข้อความที่แก้</button>}
      {awaiting ? (
        // เปิด LINE ไปแล้ว — ยังไม่นับว่าส่งจนกว่าครูจะยืนยัน
        // การ์ดถามค้างไว้ ไม่ใช้ toast เพราะครูสลับไป LINE แล้ว toast หายไปก่อนกลับมา
        <div className="confirm">
          <span className="confirm__q">
            {copy.admin.sentAsk}
            {left > 0 && <i className="confirm__left">{copy.admin.queueLeft} {left}</i>}
          </span>
          <div className="btnrow">
            <button className="btn btn--primary btn--sm" onClick={onSent}>{copy.admin.sentYes}</button>
            <button className="btn btn--ghost btn--sm" onClick={onCopy}>{copy.admin.copyText}</button>
            <button className="btn btn--ghost btn--sm" onClick={onSkipQueue}>{copy.admin.notYet}</button>
            {left > 0 && <button className="btn btn--ghost btn--sm" onClick={onCancel}>{copy.admin.stopQueue}</button>}
          </div>
        </div>
      ) : (
        <div className="btnrow">
          {editing ? (
            <button className="btn btn--secondary btn--sm" disabled={!text.trim()} onClick={() => {
              if (!text.trim()) { setEditError('ข้อความต้องไม่ว่าง'); return }
              if (onEdit(text.trim())) setEditing(false)
              else setEditError('บันทึกไม่สำเร็จ ข้อความที่แก้ยังอยู่ กรุณาลองอีกครั้ง')
            }}>{copy.common.save}</button>
          ) : (
            <button className="btn btn--ghost btn--sm" onClick={() => { setText(m.draft); setEditing(true) }}>{copy.common.edit}</button>
          )}
          <button className="btn btn--primary btn--sm" onClick={onSend}>{copy.admin.sendLine}</button>
          <button className="btn btn--ghost btn--sm" onClick={onSkip}>{copy.common.skip}</button>
        </div>
      )}
    </li>
  )
}

export default function Admin() {
  const { state, dispatch, track, hydrated } = useStore()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'chat' ? 'chat' : 'drafts'
  const chatWith = params.get('chat') ?? ''
  const [input, setInput] = useState('')
  const [actionError, setActionError] = useState('')
  const commit = (action: Parameters<typeof dispatch>[0]): boolean => {
    const saved = dispatch(action)
    setActionError(saved ? '' : 'บันทึกไม่สำเร็จ ข้อมูลยังไม่ถูกแก้ไข โปรดตรวจสิทธิ์เขียนของแท็บนี้แล้วลองอีกครั้ง')
    return saved
  }

  const drafts = useMemo(() => state.messages.filter((m) => m.status === 'draft').sort(sortDrafts), [state.messages])
  const period = periodOf(state.today)
  const monthCount = state.messages.filter(
    (m) => (m.status === 'sent' || m.status === 'draft') && periodOf(m.createdAt) === period).length

  // คิวอยู่ใน state ไม่ใช่ในคอมโพเนนต์ — สลับไป LINE แล้วกลับมาต้องยังรู้ว่าค้างที่ใคร
  const awaiting = state.sending?.awaiting ?? null
  const queue = state.sending?.queue ?? []

  const byId = (id: string): Message | undefined => state.messages.find((x) => x.id === id)
  /** เอาเฉพาะที่ยังเป็นร่างอยู่ — ระหว่างคิวครูอาจกดข้ามบางใบไปแล้ว */
  const nextDraft = (ids: string[]): Message | undefined =>
    ids.map(byId).find((m): m is Message => m?.status === 'draft')

  const openFor = async (m: Message, rest: string[] = queue) => {
    const issue = messageSendIssue(state, m)
    if (issue) { toast.push({ text: issue, tone: 'warn' }); return }
    // Commit the queue while the tab is still active, before LINE can suspend it.
    if (!dispatch({ type: 'sendingStart', awaiting: m.id, queue: rest })) return
    if (!openLine(m.draft)) {
      // popup โดนบล็อก (มักบนเดสก์ท็อป) — คัดลอกให้แทน ครูวางเองได้
      const copied = await copyText(m.draft)
      toast.push({
        text: copied ? 'เปิด LINE ไม่สำเร็จ แต่คัดลอกข้อความไว้แล้ว' : 'เปิด LINE และคัดลอกข้อความไม่สำเร็จ กรุณาลองอีกครั้ง',
        tone: copied ? 'warn' : 'danger',
      })
    }
    track('open_line', { kind: m.kind })
  }

  const confirmSent = () => {
    const m = awaiting ? byId(awaiting) : undefined
    if (m) {
      if (!dispatch({ type: 'sendMessage', id: m.id })) return
      track('send_message', { kind: m.kind })
      toast.push({ text: copy.toast.messageSent, tone: 'ok' })
    }
    const nextMsg = nextDraft(queue)
    if (nextMsg) {
      const rest = queue.slice(queue.indexOf(nextMsg.id) + 1)
      void openFor(nextMsg, rest)
    } else {
      dispatch({ type: 'sendingStop' })
    }
  }

  /** ยังไม่ได้ส่งใบนี้ — ไปใบถัดไปในคิว ไม่ใช่ทิ้งทั้งคิวเงียบ ๆ */
  const skipInQueue = () => {
    const nextMsg = nextDraft(queue)
    if (nextMsg) void openFor(nextMsg, queue.slice(queue.indexOf(nextMsg.id) + 1))
    else dispatch({ type: 'sendingStop' })
  }
  const cancelSend = () => dispatch({ type: 'sendingStop' })

  if (!hydrated) return <div className="pane"><Skeleton rows={4} /></div>

  const clientsList = state.clients.filter((c) => state.subjects.some((s) => s.clientId === c.id))
  const room = state.chats.filter((c) => c.clientId === chatWith)
  const client = clientById(state, chatWith)

  const draftAnswer = (text: string) => {
    if (!text.trim() || !chatWith || !clientById(state, chatWith)) return
    if (state.mode === 'demo' && !commit({ type: 'chat', clientId: chatWith, from: 'client', text: text.trim() })) return
    const a = answer(state, chatWith, text)
    track('chat_sim', { answerFrom: a.source ?? 'fallback' })
    const key = `faq:${chatWith}:${Date.now()}`
    if (!commit({ type: 'addMessage', message: mkMessage(state, 'faq_reply', chatWith, undefined, a.text, key, { answerFrom: a.source, question: text }) })) return
    setInput('')
  }

  return (
    <div className="pane">
      {actionError && <p className="fld__err" role="alert">{actionError}</p>}
      {state.mode === 'real' && <p className="hint">ลิงก์เอกสารเป็นสำเนาตามวันที่ ผู้ที่ได้รับลิงก์อ่านข้อมูลได้ กรุณาตรวจผู้รับก่อนส่ง</p>}
      {state.mode === 'real' && !isPaymentDestination(state.provider.promptpayId) && <p className="warnbar">ยังไม่ได้ตั้งค่าพร้อมเพย์ที่ถูกต้อง <Link to="/app/onboarding">ตั้งค่าข้อมูลรับเงิน</Link></p>}
      <div className="chips">
        <button className={`chip${tab === 'drafts' ? ' chip--on' : ''}`} aria-pressed={tab === 'drafts'} onClick={() => setParams({ tab: 'drafts' })}>
          {copy.admin.tabDrafts} {drafts.length ? <span className="chip__n">{drafts.length}</span> : null}
        </button>
        <button className={`chip${tab === 'chat' ? ' chip--on' : ''}`} aria-pressed={tab === 'chat'} onClick={() => setParams({ tab: 'chat' })}>
          {copy.admin.tabChat}
        </button>
      </div>

      {tab === 'drafts' && (
        <>
          <div className="stats">
            <StatCard label={copy.admin.draftedStat} value={`${monthCount}`} tone="brand" />
            <StatCard label={copy.admin.tabDrafts} value={`${drafts.length}`} tone={drafts.length ? 'warn' : undefined} />
          </div>

          {drafts.length === 0 ? (
            <EmptyState icon="✓" title={copy.admin.emptyDrafts} />
          ) : (
            <>
              {/* ส่งทีละคนเป็นคิว — LINE เปิดได้ทีละแชท จะกดรวดเดียวแล้วนับว่าส่งหมดไม่ได้ */}
              <button className="btn btn--primary btn--block" disabled={awaiting !== null} onClick={() => {
                const [first, ...rest] = drafts
                if (!first) return
                void openFor(first, rest.map((m) => m.id))
              }}>{copy.admin.sendAll} ({drafts.length})</button>
              <ul className="msgs">
                {drafts.map((m) => (
                  <MessageCard key={m.id} m={m}
                    awaiting={awaiting === m.id}
                    left={queue.filter((id) => byId(id)?.status === 'draft').length}
                    onSkipQueue={skipInQueue}
                    onSend={() => { void openFor(m) }}
                    onSent={confirmSent}
                    onCancel={cancelSend}
                    onCopy={() => { void copyText(m.draft).then((ok) => toast.push({ text: ok ? copy.toast.copied : 'คัดลอกไม่สำเร็จ กรุณาเลือกข้อความแล้วคัดลอกเอง', tone: ok ? 'ok' : 'danger' })) }}
                    onSkip={() => { if (!commit({ type: 'skipMessage', id: m.id })) return; track('skip_message', { kind: m.kind }); toast.push({ text: copy.toast.messageSkipped }) }}
                    onEdit={(t) => { if (!commit({ type: 'editMessage', id: m.id, draft: t })) return false; track('edit_message', { kind: m.kind }); return true }} />
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {tab === 'chat' && !chatWith && (
        <ul className="rows">
          {clientsList.map((c) => {
            const last = [...state.chats].reverse().find((x) => x.clientId === c.id)
            const n = drafts.filter((m) => m.clientId === c.id).length
            return (
              <li key={c.id}>
                <button className="srow" onClick={() => setParams({ tab: 'chat', chat: c.id })}>
                  <span className="srow__main">
                    <span className="srow__name">{c.name}{n ? <i className="badge badge--danger">{n}</i> : null}</span>
                    <span className="srow__meta">{last?.text.slice(0, 40) ?? '—'}</span>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {tab === 'chat' && chatWith && (
        !client ? (
          <EmptyState icon="🔍" title="ไม่พบผู้จ่ายในห้องแชทนี้"
            desc="ลิงก์อาจเก่าหรือพิมพ์รหัสไม่ถูกต้อง ข้อมูลในระบบยังไม่ได้ถูกแก้ไข"
            action={<button className="btn btn--primary" onClick={() => setParams({ tab: 'chat' })}>กลับไปรายชื่อผู้จ่าย</button>} />
        ) : (
        <>
          <div className="rowhead">
            <h1 className="h1">{client?.name}</h1>
            <button className="btn btn--ghost btn--sm" onClick={() => setParams({ tab: 'chat' })}>{copy.common.back}</button>
          </div>

          {room.length === 0 ? <p className="dim">{copy.admin.emptyRoom}</p> : (
            <ul className="bubbles">
              {room.map((t) => (
                <li key={t.id} className={`bub bub--${t.from}`}>
                  {t.viaAdmin && <span className="bub__ai" aria-hidden="true">✨</span>}
                  {t.text}
                </li>
              ))}
            </ul>
          )}

          {drafts.filter((m) => m.clientId === chatWith && m.kind === 'faq_reply').map((m) => (
            <div className="draftcard" key={m.id}>
              <span className="dim">{copy.admin.draftedTag} · {m.meta?.answerFrom ? `${copy.admin.answeredFrom}: ${String(m.meta.answerFrom)}` : copy.admin.answerManual}</span>
              <p className="p">{m.draft}</p>
              {awaiting === m.id ? (
                <div className="confirm">
                  <span className="confirm__q">{copy.admin.sentAsk}</span>
                  <div className="btnrow">
                    <button className="btn btn--primary btn--sm" onClick={confirmSent}>{copy.admin.sentYes}</button>
                    <button className="btn btn--ghost btn--sm" onClick={cancelSend}>{copy.admin.notYet}</button>
                  </div>
                </div>
              ) : (
                <div className="btnrow">
                  <button className="btn btn--primary btn--sm" onClick={() => { void openFor(m) }}>{copy.admin.sendLine}</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => commit({ type: 'skipMessage', id: m.id })}>{copy.common.close}</button>
                </div>
              )}
            </div>
          ))}

          <div className="simbar">
            <span className="dim">{state.mode === 'real' ? `พิมพ์คำถามจริงที่ ${client.name} ส่งมา เพื่อร่างคำตอบ` : `${copy.admin.simTitle}${client.name}`}</span>
            {state.mode === 'demo' && <div className="chips">
              {copy.admin.sims.map((sm) => (
                <button key={sm.chip} className="chip" onClick={() => draftAnswer(sm.text)}>{sm.chip}</button>
              ))}
            </div>}
            <div className="btnrow">
              <input className="inp" value={input} onChange={(e) => setInput(e.target.value)}
                placeholder={state.mode === 'real' ? copy.admin.realAsk : `${copy.admin.sendAs}${client.name}`}
                aria-label={state.mode === 'real' ? copy.admin.realAskLabel : copy.admin.simTitle} />
              <button className="btn btn--secondary btn--sm" disabled={!input.trim()} onClick={() => draftAnswer(input)}>ร่างคำตอบ</button>
            </div>
          </div>
        </>
        )
      )}
    </div>
  )
}
