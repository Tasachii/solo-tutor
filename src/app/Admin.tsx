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
import { getSession } from '../integrations/supabaseRest'
import { lineShareUrl } from '../core/share'
import { findDelivery } from '../integrations/lineApi'
import LineMessageAction from './LineMessageAction'
import { isPaymentDestination } from '../core/paymentDestination'
import AdminCollect from './AdminCollect'
import AdminHomework from './AdminHomework'
import { collectionRows } from '../core/collections'
import { homeworkSummary } from '../core/homework'
import { hasDocumentLink, publishBlocks, secureDraft, type PublishSkip } from '../core/documentPublish'
import { getSupabaseConfig } from '../integrations/supabaseRest'
import { DEFAULT_SHARE_DAYS } from '../core/documentShare'

type AdminTab = 'drafts' | 'chat' | 'collect' | 'homework'
const readTab = (raw: string | null): AdminTab =>
  raw === 'chat' || raw === 'collect' || raw === 'homework' ? raw : 'drafts'

/** เหตุผลที่ครูทำอะไรต่อได้ ไม่ใช่แค่บอกว่าล้มเหลว */
const publishNotice = (skipped: PublishSkip | null): string =>
  skipped === 'signed-out' ? copy.sharedLinks.publishSignedOut
    : skipped === 'stale' ? copy.sharedLinks.publishStale
      : copy.sharedLinks.publishFailed

function MessageCard({ m, awaiting, queueActive, left, linkOnly, onSend, onSent, onCancel, onSkipQueue, onCopy, onSkip, onEdit }: {
  m: Message; awaiting: boolean; left: number; queueActive: boolean; linkOnly: boolean
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
        {/* ใส่ลิงก์ที่ปิดได้ให้ ไม่ใช่ครูแก้ข้อความ — ป้าย "แก้ไขแล้ว" ตรงนี้จะทำให้ครูเข้าใจผิด */}
        {m.edited && !linkOnly && <span className="tag-neutral">{copy.admin.editedTag}</span>}
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
      {m.edited && issue && !m.oaDelivery && <button className="btn btn--secondary btn--sm" onClick={() => {
        if (dispatch({ type: 'refreshMessage', id: m.id })) setEditing(false)
      }}>ใช้ร่างยอดล่าสุดแทนข้อความที่แก้</button>}
      {m.oaDelivery ? null : awaiting ? (
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
          {/* ปุ่มเดียว "ส่งใน LINE": ผูก OA แล้วส่งผ่าน OA เอง ยังไม่ผูกเปิดแอป LINE ให้ส่งเอง · ส่งอยู่หน้าสุด แก้/ข้ามตามหลัง */}
          {editing ? (
            <button className="btn btn--secondary btn--sm" disabled={!text.trim()} onClick={() => {
              if (!text.trim()) { setEditError('ข้อความต้องไม่ว่าง'); return }
              if (onEdit(text.trim())) setEditing(false)
              else setEditError('บันทึกไม่สำเร็จ ข้อความที่แก้ยังอยู่ กรุณาลองอีกครั้ง')
            }}>{copy.common.save}</button>
          ) : (
            <>
              <LineMessageAction message={m} disabled={queueActive} onFallback={onSend} />
              <button className="btn btn--ghost btn--sm" onClick={() => { setText(m.draft); setEditing(true) }}>{copy.common.edit}</button>
            </>
          )}
          {!m.oaDelivery && <button className="btn btn--ghost btn--sm" onClick={onSkip}>{copy.common.skip}</button>}
        </div>
      )}
    </li>
  )
}

export default function Admin() {
  const { state, dispatch, track, hydrated } = useStore()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const tab = readTab(params.get('tab'))
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

  // เดโมไม่เกี่ยว เพราะเดโมไม่ได้ส่งถึงใครจริง · แยกสองกรณีที่ผลต่างกันคนละแบบ
  // ไม่มีโปรเจกต์ = ส่งได้แต่ลิงก์ปิดไม่ได้ · มีโปรเจกต์แต่ยังไม่เข้าสู่ระบบ = การส่งจะถูกหยุดไว้
  const configured = !!getSupabaseConfig()
  const signedIn = (() => { try { return !!getSession() } catch { return false } })()
  const inlineLinksOnly = state.mode === 'real' && !configured
  const needsSignIn = state.mode === 'real' && configured && !signedIn
  // รู้ได้ก็ต่อเมื่อเคยลองแล้ว — ประกาศทันทีที่รู้ ไม่รอให้ครูกดซ้ำจนงง
  const [backendMissing, setBackendMissing] = useState(false)
  // ร่างที่เราเป็นคนใส่ลิงก์ให้ ไม่ใช่ร่างที่ครูแก้เอง
  const [linkEdited, setLinkEdited] = useState<string[]>([])

  /**
   * เผยแพร่ลิงก์ที่ปิดได้ แล้วบันทึกกลับลงร่างก่อนส่ง
   * คืน null = ห้ามส่ง (แจ้งเหตุผลแล้ว) · คืนข้อความ = ข้อความที่จะออกไปจริง และตรงกับร่างที่เก็บไว้
   */
  const publishFor = async (m: Message, popup: Window | null): Promise<string | null> => {
    const secured = await secureDraft(state, m.draft)
    if (secured.skipped === 'unsupported') setBackendMissing(true)
    if (publishBlocks(secured.skipped)) {
      popup?.close()
      // ลิงก์เดิมถูกปิดไปแล้ว: ล้างธงแก้เอง แล้ว refreshDrafts จะเขียนร่างใหม่พร้อมลิงก์ใหม่ในรอบเดียวกัน
      // ครูจึงกดส่งซ้ำได้เลย ไม่ต้องไปหาปุ่มที่ยังไม่ขึ้นให้กด
      if (secured.skipped === 'stale') dispatch({ type: 'refreshMessage', id: m.id })
      toast.push({ text: publishNotice(secured.skipped), tone: 'warn' })
      return null
    }
    if (secured.draft !== m.draft) {
      const teacherEdited = !!m.edited
      if (!commit({ type: 'editMessage', id: m.id, draft: secured.draft })) {
        popup?.close()
        toast.push({ text: copy.sharedLinks.publishStoreFailed, tone: 'warn' })
        return null
      }
      if (!teacherEdited) setLinkEdited(prev => prev.includes(m.id) ? prev : [...prev, m.id])
    }
    return secured.draft
  }

  /** คัดลอกก็คือการส่งออกจากเครื่องเหมือนกัน ต้องผ่านการเผยแพร่ลิงก์ชุดเดียวกัน */
  const copySecured = async (m: Message) => {
    const outgoing = await publishFor(m, null)
    if (outgoing === null) return
    const ok = await copyText(outgoing)
    toast.push({ text: ok ? copy.toast.copied : copy.toast.copyFailed, tone: ok ? 'ok' : 'danger' })
  }

  const openFor = async (m: Message, rest: string[] = queue) => {
    if (m.oaDelivery) { toast.push({ text: 'กรุณาตรวจสอบผลส่ง LINE OA ก่อน ห้ามแชร์ซ้ำ', tone: 'warn' }); return }
    const issue = messageSendIssue(state, m)
    if (issue) { toast.push({ text: issue, tone: 'warn' }); return }
    let popup: Window | null = null
    // จะต้องรอเครือข่ายก่อนเปิด LINE ไหม — ถ้าใช่ ต้องจองหน้าต่างตั้งแต่ยังอยู่ในคลิกเดิม
    const willAwait = state.mode === 'real' && hasDocumentLink(m.draft)
    if (state.lineWorkspaceId) {
      let signedIn = false
      try { signedIn = getSession()?.user.id === state.lineProviderId } catch { /* refuse without verified local session */ }
      if (!signedIn) {
        toast.push({ text: 'เข้าสู่บัญชี LINE OA เดิมเพื่อตรวจว่าเคยส่งรายการนี้แล้วหรือยัง', tone: 'warn' }); return
      }
      // Reserve a window in the original click, before network awaits lose user activation on Safari.
      popup = window.open('about:blank', '_blank')
      if (!popup) { toast.push({ text: 'กรุณาอนุญาตการเปิดหน้าต่าง LINE แล้วกดอีกครั้ง', tone: 'warn' }); return }
      popup.opener = null
      try {
        const prior = await findDelivery(`${state.lineWorkspaceId}:${m.dedupeKey}`)
        if (prior && !(prior.status === 'skipped' && prior.last_error === 'user-cancelled')) {
          popup.close()
          toast.push({ text: 'มีรายการนี้ใน LINE OA แล้ว กดตรวจสอบผ่านปุ่มส่งด้วย LINE OA เพื่อป้องกันการส่งซ้ำ', tone: 'warn' }); return
        }
      } catch { popup.close(); toast.push({ text: 'ตรวจผลส่ง LINE OA ไม่สำเร็จ กรุณาลองใหม่ก่อนแชร์ซ้ำ', tone: 'warn' }); return }
    } else if (willAwait) {
      // Reserve a window in the original click, before network awaits lose user activation on Safari.
      popup = window.open('about:blank', '_blank')
      if (popup) popup.opener = null
    }
    // เผยแพร่ลิงก์ที่ปิดได้ก่อนข้อความออกจากเบราว์เซอร์ — ลิงก์ที่ส่งไปแล้วตามกลับมาเปลี่ยนไม่ได้
    const outgoing = await publishFor(m, popup)
    if (outgoing === null) return
    // Commit the queue while the tab is still active, before LINE can suspend it.
    if (!dispatch({ type: 'sendingStart', awaiting: m.id, queue: rest })) { popup?.close(); return }
    if (popup) popup.location.replace(lineShareUrl(outgoing))
    else if (!openLine(outgoing)) {
      // popup โดนบล็อก (มักบนเดสก์ท็อป) — คัดลอกให้แทน ครูวางเองได้
      const copied = await copyText(outgoing)
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

  const overdueCount = collectionRows(state).filter(r => r.daysOverdue > 0).length
  const homeworkOverdue = homeworkSummary(state).overdue
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
      {state.mode === 'real' && <p><Link to="/app/settings/line">ตั้งค่า LINE OA และเชื่อมผู้ปกครอง</Link></p>}
      {state.mode === 'real' && <p className="hint">ลิงก์เอกสารเป็นสำเนาตามวันที่ ผู้ที่ได้รับลิงก์อ่านข้อมูลได้ กรุณาตรวจผู้รับก่อนส่ง</p>}
      {state.mode === 'real' && !isPaymentDestination(state.provider.promptpayId) && <p className="warnbar">ยังไม่ได้ตั้งค่าพร้อมเพย์ที่ถูกต้อง <Link to="/app/onboarding">ตั้งค่าข้อมูลรับเงิน</Link></p>}
      <div className="chips">
        <button className={`chip${tab === 'drafts' ? ' chip--on' : ''}`} aria-pressed={tab === 'drafts'} onClick={() => setParams({ tab: 'drafts' })}>
          {copy.admin.tabDrafts} {drafts.length ? <span className="chip__n">{drafts.length}</span> : null}
        </button>
        <button className={`chip${tab === 'collect' ? ' chip--on' : ''}`} aria-pressed={tab === 'collect'} onClick={() => setParams({ tab: 'collect' })}>
          {copy.admin.tabCollect} {overdueCount ? <span className="chip__n">{overdueCount}</span> : null}
        </button>
        <button className={`chip${tab === 'homework' ? ' chip--on' : ''}`} aria-pressed={tab === 'homework'} onClick={() => setParams({ tab: 'homework' })}>
          {copy.admin.tabHomework} {homeworkOverdue ? <span className="chip__n">{homeworkOverdue}</span> : null}
        </button>
        <button className={`chip${tab === 'chat' ? ' chip--on' : ''}`} aria-pressed={tab === 'chat'} onClick={() => setParams({ tab: 'chat' })}>
          {copy.admin.tabChat}
        </button>
      </div>

      {tab === 'collect' && <AdminCollect />}
      {tab === 'homework' && <AdminHomework />}

      {tab === 'drafts' && (
        <>
          <div className="stats">
            <StatCard label={copy.admin.draftedStat} value={`${monthCount}`} tone="brand" />
            <StatCard label={copy.admin.tabDrafts} value={`${drafts.length}`} tone={drafts.length ? 'warn' : undefined} />
          </div>

          {/* บิลด์ที่ไม่มีโปรเจกต์ยังส่งได้ แต่ต้องบอกก่อนส่งว่าลิงก์นั้นปิดไม่ได้ ไม่ใช่ปล่อยผ่านเงียบ ๆ */}
          {inlineLinksOnly && <p className="warnbar" role="status" data-testid="insecure-link-notice">{copy.sharedLinks.insecureNotice}</p>}
          {/* ฐานหลังบ้านยังไม่ได้อัปเดต — ครูกดซ้ำก็ไม่ผ่าน จึงต้องบอกว่าเป็นเรื่องของผู้ดูแล ไม่ใช่ความผิดครู */}
          {backendMissing && <p className="warnbar" role="status" data-testid="unsupported-link-notice">{copy.sharedLinks.unsupportedNotice}</p>}
          {needsSignIn && <p className="warnbar" role="status" data-testid="signed-out-link-notice">
            {copy.sharedLinks.signedOutNotice.replace('{days}', String(DEFAULT_SHARE_DAYS))}
          </p>}

          {drafts.length === 0 ? (
            <EmptyState icon="✓" title={copy.admin.emptyDrafts} />
          ) : (
            <>
              {/* ส่งทีละคนเป็นคิว — LINE เปิดได้ทีละแชท จะกดรวดเดียวแล้วนับว่าส่งหมดไม่ได้ */}
              <button className="btn btn--primary btn--block" disabled={awaiting !== null || drafts.some(m => !!m.oaDelivery)} onClick={() => {
                const [first, ...rest] = drafts
                if (!first) return
                void openFor(first, rest.map((m) => m.id))
              }}>{copy.admin.sendAll} ({drafts.length})</button>
              <ul className="msgs">
                {drafts.map((m) => (
                  <MessageCard key={m.id} m={m}
                    linkOnly={linkEdited.includes(m.id)}
                    awaiting={awaiting === m.id}
                    queueActive={!!awaiting}
                    left={queue.filter((id) => byId(id)?.status === 'draft').length}
                    onSkipQueue={skipInQueue}
                    onSend={() => { void openFor(m) }}
                    onSent={confirmSent}
                    onCancel={cancelSend}
                    onCopy={() => { void copySecured(m) }}
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
              {m.oaDelivery ? null : awaiting === m.id ? (
                <div className="confirm">
                  <span className="confirm__q">{copy.admin.sentAsk}</span>
                  <div className="btnrow">
                    <button className="btn btn--primary btn--sm" onClick={confirmSent}>{copy.admin.sentYes}</button>
                    <button className="btn btn--ghost btn--sm" onClick={cancelSend}>{copy.admin.notYet}</button>
                  </div>
                </div>
              ) : (
                <div className="btnrow">
                  <LineMessageAction message={m} disabled={!!awaiting} onFallback={() => { void openFor(m) }} />
                  <button className="btn btn--ghost btn--sm" onClick={() => commit({ type: 'skipMessage', id: m.id })}>{copy.common.close}</button>
                </div>
              )}
              {m.oaDelivery && <div className="btnrow"><LineMessageAction message={m} disabled={!!awaiting} /></div>}
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
