import { useEffect, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '../core/store'
import { copy } from '../copy'
import { dateThai, money } from '../core/format'
import { FREE_STUDENT_CAP, daysLeft, isPro } from '../core/plan'
import { PLANS } from '../platform/plans'
import { SOLO_PROMPTPAY } from '../platform/config'
import { cancelPlanRequest, listPlanRequests, pausePlan, requestPlan, resumePlan, type PlanRequestRow } from '../integrations/planApi'
import { BottomSheet, ConfirmSheet, PromptPayQR } from './components'
import { useToast } from './components/Toast'
import { useCloudSync } from './CloudSync'

const stamp = (iso: string | null): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * การ์ดแพ็กสมาชิกในหน้าบัญชีครู — ดูแพ็ก ขอเปิด Pro พัก/ใช้ต่อ ใบเสร็จค่าสมาชิก
 * ไม่มีการตัดเงิน: ส่งคำขอ → ทีมเห็นยอดโอน → อนุมัติในฐานข้อมูล → แอปเห็นแพ็กใหม่รอบซิงก์ถัดไป
 */
export function PlanCard() {
  const { state } = useStore()
  const cloud = useCloudSync()
  const toast = useToast()
  const loc = useLocation()
  const p = copy.plan
  const plan = cloud.plan
  const pro = isPro(plan, state.today)
  const [rows, setRows] = useState<PlanRequestRow[]>([])
  const [months, setMonths] = useState(() => {
    const want = Number(new URLSearchParams(loc.search).get('plan'))
    return PLANS.some((x) => x.months === want && want > 0) ? want : 1
  })
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<PlanRequestRow | null>(null)
  const [ask, setAsk] = useState<null | 'pause' | 'cancel'>(null)
  const pending = rows.find((r) => r.status === 'pending')
  const approved = rows.filter((r) => r.status === 'approved')
  const price = PLANS.find((x) => x.months === months)?.price ?? 0

  const reload = async () => { try { setRows(await listPlanRequests()) } catch { /* แสดงเท่าที่มี ค่อยลองใหม่รอบหน้า */ } }
  useEffect(() => { if (cloud.session) void reload() }, [cloud.session?.user.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    void requestPlan(months, note).then(async () => {
      setNote(''); toast.push({ text: p.submitted, tone: 'ok' }); await reload()
    }).catch(() => toast.push({ text: p.alreadyPending, tone: 'warn' })).finally(() => setBusy(false))
  }
  const toggle = async (): Promise<boolean> => {
    try {
      const next = plan?.pausedAt ? await resumePlan() : await pausePlan()
      if (next) { toast.push({ text: plan?.pausedAt ? p.resumed : p.paused, tone: 'ok' }) }
      await cloud.refreshPlan()
      return true
    } catch { toast.push({ text: copy.common.saveFailed, tone: 'danger' }); return false }
  }

  const statusLine = !plan || plan.plan === 'free'
    ? p.free.replace('{cap}', String(FREE_STUDENT_CAP))
    : plan.pausedAt ? p.proPaused
      : pro ? `${p.pro} · ${p.proUntil.replace('{date}', dateThai(plan.planUntil!)).replace('{days}', String(daysLeft(plan, state.today)))}`
        : p.proExpired

  return <>
    <section className="card" data-testid="plan-card">
      <h2 className="h2">{p.title}</h2>
      <p role="status">{statusLine}</p>
      {plan?.plan === 'pro' && (daysLeft(plan, state.today) ?? 0) > 0 && <>
        <p className="hint">{p.pauseBody}</p>
        {plan.pausedAt
          ? <button className="btn btn--secondary btn--sm" onClick={() => void toggle()}>{p.resume}</button>
          : <button className="btn btn--ghost btn--sm" onClick={() => setAsk('pause')}>{p.pause}</button>}
      </>}

      {pending ? <div className="warnbar" role="status">
        {p.pending.replace('{months}', String(pending.months)).replace('{amount}', money(pending.amount))}
        <div className="btnrow"><button className="btn btn--ghost btn--sm" onClick={() => setAsk('cancel')}>{p.cancel}</button></div>
      </div> : <form onSubmit={submit}>
        <h3 className="h2">{p.requestTitle}</h3>
        <p className="hint">{p.requestBody}</p>
        <div className="seg" role="radiogroup" aria-label={p.pickPlan}>
          {PLANS.filter((x) => x.months > 0).map((x) => (
            <button key={x.months} type="button" role="radio" aria-checked={months === x.months} className={`seg__b${months === x.months ? ' seg__b--on' : ''}`} onClick={() => setMonths(x.months)}>
              {p.months[x.months]} · {money(x.price)}
            </button>
          ))}
        </div>
        {SOLO_PROMPTPAY
          ? <PromptPayQR destination={SOLO_PROMPTPAY} amount={price} label={p.payTo} sub={`${money(price)} ${copy.common.baht}`} />
          : null}
        <label className="fld"><span className="fld__l">{p.note}</span><input className="inp" maxLength={200} placeholder={p.noteHint} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <button className="btn btn--primary" disabled={busy}>{p.submit} · {money(price)} {copy.common.baht}</button>
      </form>}

      {approved.length > 0 && <>
        <h3 className="h2" style={{ marginTop: 'var(--space-4)' }}>{p.history}</h3>
        <ul className="rows">{approved.map((r) => <li key={r.id} className="srow">
          <span className="srow__main"><span className="srow__name">{p.receiptItem.replace('{months}', String(r.months))} · {money(r.amount)} {copy.common.baht}</span>
            <span className="srow__meta">{r.receipt_no} · {stamp(r.decided_at)}</span></span>
          <button className="btn btn--ghost btn--sm" onClick={() => setReceipt(r)}>{p.receipt}</button>
        </li>)}</ul>
      </>}
    </section>

    {ask === 'pause' && <ConfirmSheet title={p.pause} body={p.pauseBody} confirmLabel={p.pause} onClose={() => setAsk(null)} onConfirm={toggle} />}
    {ask === 'cancel' && <ConfirmSheet title={p.cancel} confirmLabel={p.cancel} danger onClose={() => setAsk(null)}
      onConfirm={async () => { try { await cancelPlanRequest(); toast.push({ text: p.cancelled, tone: 'ok' }); await reload(); return true } catch { return false } }} />}
    {receipt && <BottomSheet title={p.receiptTitle} sub={receipt.receipt_no ?? ''} onClose={() => setReceipt(null)}>
      <dl className="paper__meta">
        <div><dt>{copy.receipt.no}</dt><dd className="num">{receipt.receipt_no}</dd></div>
        <div><dt>{copy.receipt.issuedAt}</dt><dd>{stamp(receipt.decided_at)}</dd></div>
        <div><dt>{copy.receipt.item}</dt><dd>{p.receiptItem.replace('{months}', String(receipt.months))}</dd></div>
        <div><dt>{copy.receipt.amount}</dt><dd className="num">{money(receipt.amount)} {copy.common.baht}</dd></div>
        <div><dt>{copy.receipt.payer}</dt><dd>{cloud.session?.user.email ?? '—'}</dd></div>
        <div><dt>{copy.receipt.payee}</dt><dd>{copy.brand.name}</dd></div>
      </dl>
    </BottomSheet>}
  </>
}
