import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../core/store'
import { professionById } from '../professions'
import { copy } from '../copy'
import { homeworkText, summaryText } from '../core/messages'
import { copyText, openLine } from './share'
import { clientById, completionsIn, isCompleted, packageStatus, subjectById } from '../core/ledger'
import { invoiceFor } from '../core/billing'
import { currentEstimate } from '../core/messages'
import { dateThai, money, periodOf, periodThai } from '../core/format'
import { modeThai } from '../copy/tutor'
import { BottomSheet, EmptyState, ProgressBar, BackLink } from './components'
import { useToast } from './components/Toast'
import SubjectSheet, { parseMoneyInput } from './SubjectSheet'
import type { AppState } from '../core/types'

export const mustArchiveSubject = (state: AppState, subjectId: string): boolean =>
  state.mode === 'real' && (
    state.invoices.some((invoice) => invoice.subjectId === subjectId)
    || state.units.some((unit) => unit.subjectId === subjectId)
  )
export const canRenewSubject = (subject: AppState['subjects'][number]): boolean =>
  subject.active && subject.billing.mode === 'package'

export default function SubjectDetail() {
  const { id = '' } = useParams()
  const { state, dispatch, track } = useStore()
  const prof = professionById(state.professionId)
  const v = prof.vocab
  const nav = useNavigate()
  const toast = useToast()
  const [homework, setHomework] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [buying, setBuying] = useState(false)
  const [purchaseTotal, setPurchaseTotal] = useState('')
  const [purchasePrice, setPurchasePrice] = useState('')
  const [purchaseError, setPurchaseError] = useState('')
  const [stopping, setStopping] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [limit, setLimit] = useState(20)

  const s = subjectById(state, id)
  if (!s) return <div className="pane"><EmptyState icon="🔍" title="ไม่พบรายการนี้" action={<button className="btn btn--primary" onClick={() => nav('/app/subjects')}>{copy.common.back}</button>} /></div>

  const period = periodOf(state.today)
  const client = clientById(state, s.clientId)
  const pk = packageStatus(state, s)
  const qty = completionsIn(state, s.id, period).length
  const inv = invoiceFor(state, s.id, period)
  const mustArchive = mustArchiveSubject(state, s.id)

  const timeline = [
    ...state.units.filter((u) => u.subjectId === s.id && isCompleted(state, u.id))
      .map((u) => ({ at: u.scheduledAt, text: `${v.completionDone} ${u.time}` })),
    ...state.invoices.filter((i) => i.subjectId === s.id)
      .map((i) => ({ at: i.sentAt ?? i.createdAt, text: `บิล ${periodThai(i.period)} ${money(i.total)} · ${copy.billing.status[i.status]}` })),
    ...state.messages.filter((m) => m.subjectId === s.id && m.status === 'sent')
      .map((m) => ({ at: m.sentAt ?? m.createdAt, text: `ส่งข้อความ ${copy.admin.kinds[m.kind]}` })),
  ].sort((a, b) => b.at.localeCompare(a.at))

  return (
    <div className="pane">
      <BackLink to="/app/subjects" label={v.subjects} />
      <div className="rowhead">
        <h1 className="h1">{s.name}</h1>
        <button className="btn btn--ghost btn--sm" onClick={() => setEditing(true)}>{copy.detail.edit}</button>
      </div>
      <p className="dim">{client?.name} · {modeThai(s.billing.mode)}</p>

      <section className="card">
        <h2 className="h2">{copy.detail.thisMonth}</h2>
        <div className="kv"><span>{v.units}</span><b className="num">{qty}</b></div>
        <div className="kv">
          <span>{copy.detail.estimate}</span>
          <b className="num">{pk ? copy.detail.fromPackage : money(inv?.total ?? currentEstimate(state, s, period))}</b>
        </div>
      </section>

      {pk && (
        <section className="card">
          <h2 className="h2">{copy.subjects.filters.package}</h2>
          <ProgressBar value={pk.used} max={pk.total} label={`${copy.detail.usedOfTotal} ${pk.used}/${pk.total}`}
            tone={pk.state === 'ok' ? 'ok' : pk.state === 'low' ? 'warn' : 'danger'} />
          <div className="kv"><span>{copy.detail.usedOfTotal}</span><b className="num">{pk.used}/{pk.total}</b></div>
          <div className="kv"><span>{copy.clientView.packRemain}</span><b className="num">{pk.remaining}{pk.overBy ? ` (เกิน ${pk.overBy})` : ''}</b></div>
          {pk.carriedCredits > 0 && <div className="kv"><span>สิทธิ์ยกมาจากแพ็กเดิม</span><b className="num">{pk.carriedCredits} ครั้ง</b></div>}
          <div className="kv"><span>ซื้อแพ็กรอบนี้</span><b className="num">{pk.purchasedUnits} ครั้ง · {money(pk.price)} {copy.common.baht}</b></div>
          <div className="kv"><span>{copy.detail.boughtAt}</span><b>{dateThai(pk.purchasedAt)}</b></div>
          {canRenewSubject(s) && (
            <button className="btn btn--secondary btn--block" onClick={() => {
              setPurchaseTotal(String(pk.purchasedUnits)); setPurchasePrice(String(pk.price))
              setPurchaseError(''); setBuying(true)
            }}>{copy.detail.buyPackage}</button>
          )}
        </section>
      )}

      <div className="btnrow">
        <button className="btn btn--primary btn--sm" onClick={async () => {
          // ตอบ "ลูกเรียนไปกี่ครั้งแล้ว" กลางเดือนได้ทันที ไม่ต้องรอสิ้นเดือน
          const text = summaryText(state, s, period)
          if (!openLine(text)) {
            const copied = await copyText(text)
            toast.push({ text: copied ? copy.toast.copied : 'เปิด LINE และคัดลอกข้อความไม่สำเร็จ กรุณาลองอีกครั้ง', tone: copied ? 'ok' : 'danger' })
          }
          track('send_summary')
        }}>{copy.detail.sendSummary}</button>
        <button className="btn btn--secondary btn--sm" onClick={() => nav(`/client/${s.clientId}`)}>{copy.detail.clientView}</button>
        {state.mode === 'real' && <button className="btn btn--secondary btn--sm" onClick={() => setHomework('')}>{copy.detail.homework}</button>}
        <button className="btn btn--ghost btn--sm" onClick={() => nav('/app/admin?tab=homework')}>{copy.homework.manageLink}</button>
        <button className="btn btn--secondary btn--sm" onClick={() => nav(`/app/admin?tab=chat&chat=${s.clientId}`)}>{copy.detail.openChat}</button>
        {s.active && <button className="btn btn--ghost btn--sm" onClick={() => setStopping(true)}>{copy.subjects.stop}</button>}
        {!s.active && <button className="btn btn--primary btn--sm" onClick={() => {
          if (!dispatch({ type: 'reactivateSubject', subjectId: s.id })) return
          toast.push({ text: 'กลับมาใช้งานรายการนี้แล้ว', tone: 'ok' })
        }}>กลับมาใช้งาน</button>}
      </div>

      {/* แยกปุ่มลบออกมาท้ายหน้า — เดิมอยู่ติด "หยุดเรียน" และเงียบกว่าปุ่มข้าง ๆ จึงกดพลาดง่าย */}
      <div className="danger-zone">
        <button className="btn btn--ghost btn--sm btn--danger-text"
          onClick={() => mustArchive ? setStopping(true) : setRemoving(true)}>
          {mustArchive ? copy.subjects.stop : copy.subjects.remove}
        </button>
        <span className="hint">{mustArchive
          ? `มีประวัติการเงิน จึงเก็บบิลและใบเสร็จไว้ครบและย้ายไปกลุ่ม "${copy.subjects.inactiveGroup}"`
          : copy.subjects.removeHint}</span>
      </div>

      <section className="card">
        <h2 className="h2">{copy.detail.history}</h2>
        <ul className="tl">
          {timeline.slice(0, limit).map((t, i) => (
            <li key={i}><span className="tl__at num">{dateThai(t.at)}</span><span>{t.text}</span></li>
          ))}
        </ul>
        {timeline.length > limit && <button className="linkbtn" onClick={() => setLimit((l) => l + 20)}>{copy.common.more}</button>}
        {timeline.length === 0 && <p className="dim">{copy.detail.noHistory}</p>}
      </section>

      {editing && <SubjectSheet subject={s} onClose={() => setEditing(false)} />}

      {buying && pk && canRenewSubject(s) && (
        <BottomSheet title={copy.detail.buyConfirm} sub={`สิทธิ์เดิมที่ยกมา ${pk.remaining} ครั้ง`} onClose={() => setBuying(false)}
          footer={
            <button className="btn btn--primary btn--block" onClick={() => {
              const total = parseMoneyInput(purchaseTotal)
              const price = parseMoneyInput(purchasePrice)
              if (total === null || price === null) { setPurchaseError('ใส่จำนวนครั้งและราคาที่เป็นจำนวนเต็มมากกว่า 0'); return }
              if (!dispatch({ type: 'renewPackage', subjectId: s.id, total, price, slipVerified: false })) {
                setPurchaseError('บันทึกไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ โปรดตรวจสิทธิ์เขียนของแท็บนี้แล้วลองอีกครั้ง'); return
              }
              track('renew_package', { subjectId: s.id })
              setBuying(false); toast.push({ text: copy.toast.receiptIssued, tone: 'ok' })
            }}>{copy.common.confirm}</button>
          }>
          <label className="fld"><span className="fld__l">จำนวนครั้งที่ซื้อใหม่</span>
            <input className="inp" inputMode="numeric" value={purchaseTotal} onChange={event => setPurchaseTotal(event.target.value)} /></label>
          <label className="fld"><span className="fld__l">ราคาแพ็กใหม่ (บาท)</span>
            <input className="inp" inputMode="numeric" value={purchasePrice} onChange={event => setPurchasePrice(event.target.value)} /></label>
          {purchaseError && <p className="fld__err" role="alert">{purchaseError}</p>}
          <p className="p">บันทึกว่าได้รับเงินค่าแพ็กใหม่ด้วยการยืนยันด้วยตนเอง ระบบจะเก็บสิทธิ์เดิมที่เหลือ ออกใบเสร็จ และร่างข้อความแจ้ง{client?.name}ให้</p>
        </BottomSheet>
      )}

      {removing && (
        <BottomSheet title={copy.subjects.removeTitle} onClose={() => setRemoving(false)}
          footer={
            <div className="btnrow">
              <button className="btn btn--ghost" onClick={() => setRemoving(false)}>{copy.common.cancel}</button>
              <button className="btn btn--danger" onClick={() => {
                if (!dispatch({ type: 'deleteSubject', subjectId: s.id })) return
                track('delete_subject')
                setRemoving(false); nav('/app/subjects')
                toast.push({ text: copy.subjects.removed, tone: 'warn' })
              }}>{copy.subjects.remove}</button>
            </div>
          }>
          <p className="p">{copy.subjects.removeWarn}</p>
          <p className="hint">{copy.subjects.removeHint}</p>
        </BottomSheet>
      )}

      {stopping && (
        <BottomSheet title={copy.subjects.stopConfirm} onClose={() => setStopping(false)}
          footer={
            <button className="btn btn--danger btn--block" onClick={() => {
              if (!dispatch({ type: 'deactivateSubject', subjectId: s.id })) return
              setStopping(false); nav('/app/subjects')
            }}>{copy.subjects.stop}</button>
          }>
          <p className="p">จะย้ายไปกลุ่ม "{copy.subjects.inactiveGroup}" ประวัติยังอยู่ครบ</p>
        </BottomSheet>
      )}
      {homework !== null && (
        <BottomSheet title={copy.detail.homework} sub={s.name} onClose={() => setHomework(null)}
          footer={<button className="btn btn--primary btn--block" disabled={!homework.trim()} onClick={async () => {
            const ok = await copyText(homeworkText(state, s, homework))
            toast.push({ text: ok ? copy.toast.copied : copy.toast.copyFailed, tone: ok ? 'ok' : 'danger' })
            if (ok) setHomework(null)
          }}>{copy.detail.homeworkCopy}</button>}>
          <p className="hint">{copy.detail.homeworkHint}</p>
          <label className="fld"><span className="fld__l">{copy.detail.homeworkField}</span>
            <textarea className="inp" rows={4} value={homework} onChange={(e) => setHomework(e.target.value)} /></label>
        </BottomSheet>
      )}
    </div>
  )
}
