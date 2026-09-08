import { useEffect, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '../core/store'
import { copy } from '../copy'
import { dateThai, money } from '../core/format'
import { FREE_STUDENT_CAP, daysLeft, isPro } from '../core/plan'
import { listPlanRefunds, refundsUnsupported, summarizeRefunds, type ReceiptRefund } from '../core/planRefunds'
import { PLANS, readPlanIntent, rememberPlanIntent, validPaidPlanMonths } from '../platform/plans'
import { PAID_PLAN_AVAILABLE, PROVIDER_LEGAL_NAME, SOLO_PROMPTPAY, SUPPORT_CONTACT } from '../platform/config'
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
    return validPaidPlanMonths(new URLSearchParams(loc.search).get('plan')) ?? readPlanIntent() ?? 1
  })
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<PlanRequestRow | null>(null)
  const [ask, setAsk] = useState<null | 'pause' | 'cancel'>(null)
  const pending = rows.find((r) => r.status === 'pending')
  const approved = rows.filter((r) => r.status === 'approved')
  // คำขอที่ไม่ผ่านต้องเห็น ไม่ใช่หายเงียบ — ครูจะได้รู้ว่าต้องส่งใหม่หรือติดต่อทีม (D-03)
  const rejected = rows.filter((r) => r.status === 'rejected')
  const [loadFailed, setLoadFailed] = useState(false)
  // สรุปการคืนเงินต่อใบเสร็จ มาจากหลักฐานฝั่งเซิร์ฟเวอร์เท่านั้น (D-08)
  const [refunds, setRefunds] = useState<Map<string, ReceiptRefund>>(() => new Map())
  const [refundFailed, setRefundFailed] = useState(false)
  const price = PLANS.find((x) => x.months === months)?.price ?? 0

  /**
   * ประวัติกับการคืนเงินโหลดแยกกัน ล้มคนละแบบ — คืนเงินโหลดไม่ได้ไม่ได้แปลว่าประวัติล้ม
   * และถ้าคืนเงินล้ม สรุปเดิมที่เคยโหลดสำเร็จยังอยู่ ดีกว่าล้างทิ้งจนใบเสร็จกลับไปโชว์ยอดเต็ม
   *
   * ฐานที่ยังไม่มีคำสั่งคืนเงิน (404) ไม่ใช่ความล้มเหลว — หลังบ้านแบบนั้นยังคืนเงินใครไม่ได้
   * ครูที่ไม่เคยถูกคืนเงินต้องไม่โดนเตือนเพราะเรา deploy migration ช้า
   */
  const reload = async (): Promise<PlanRequestRow[] | null> => {
    const [requests, refunded] = await Promise.allSettled([listPlanRequests(), listPlanRefunds()])
    if (refunded.status === 'fulfilled') {
      setRefunds(summarizeRefunds(refunded.value))
      setRefundFailed(false)
    } else setRefundFailed(!refundsUnsupported(refunded.reason))
    if (requests.status !== 'fulfilled') {
      setLoadFailed(true)
      return null
    }
    setRows(requests.value)
    setLoadFailed(false)
    return requests.value
  }
  useEffect(() => { if (cloud.session) void reload() }, [cloud.session?.user.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!PAID_PLAN_AVAILABLE) {
      toast.push({ text: p.unavailable, tone: 'danger' })
      return
    }
    setBusy(true)
    try {
      const current = await reload()
      if (current?.some((row) => row.status === 'pending')) {
        toast.push({ text: p.alreadyPending, tone: 'warn' })
        return
      }
      const created = await requestPlan(months, note)
      if (!Array.isArray(created) || created.length !== 1 || created[0].status !== 'pending') throw new Error('invalid plan response')
      setRows((existing) => [created[0], ...existing.filter((row) => row.id !== created[0].id)])
      rememberPlanIntent(null)
      setNote('')
      toast.push({ text: p.submitted, tone: 'ok' })
    } catch {
      const current = await reload()
      const duplicate = current?.some((row) => row.status === 'pending') === true
      toast.push({ text: duplicate ? p.alreadyPending : p.requestFailed, tone: duplicate ? 'warn' : 'danger' })
    } finally { setBusy(false) }
  }
  const toggle = async (): Promise<boolean> => {
    try {
      const next = plan?.pausedAt ? await resumePlan() : await pausePlan()
      if (!next || next.plan !== 'pro') throw new Error('plan state unchanged')
      toast.push({ text: plan?.pausedAt ? p.resumed : p.paused, tone: 'ok' })
      await cloud.refreshPlan()
      return true
    } catch { toast.push({ text: copy.common.saveFailed, tone: 'danger' }); return false }
  }

  const receiptRefund = receipt ? refunds.get(receipt.id) ?? null : null
  const refundNote = (r: ReceiptRefund): string =>
    `${r.state === 'full' ? p.refund.full : p.refund.partial} · ${p.refund.summary.replace('{refunded}', money(r.refunded)).replace('{net}', money(r.net))}`

  const statusLine = !plan || plan.plan === 'free'
    ? p.free.replace('{cap}', String(FREE_STUDENT_CAP))
    : plan.pausedAt ? p.proPaused
      : pro ? `${p.pro} · ${p.proUntil.replace('{date}', dateThai(plan.planUntil!)).replace('{days}', String(daysLeft(plan, state.today)))}`
        : p.proExpired

  return <>
    <section className="card" data-testid="plan-card">
      <h2 className="h2">{p.title}</h2>
      <p role="status">{statusLine}</p>
      {loadFailed && <p className="warnbar" role="status">{p.loadFailed}</p>}
      {/* พักได้ตราบที่ยัง Pro — วันสุดท้าย (เหลือ 0 วันแต่ isPro ยังจริง) ก็พักได้ (D-04) */}
      {plan?.plan === 'pro' && (!!plan.pausedAt || pro) && <>
        <p className="hint">{p.pauseBody}</p>
        {plan.pausedAt
          ? <button className="btn btn--secondary btn--sm" onClick={() => void toggle()}>{p.resume}</button>
          : <button className="btn btn--ghost btn--sm" onClick={() => setAsk('pause')}>{p.pause}</button>}
      </>}

      {pending ? <div className="warnbar" role="status">
        {p.pending.replace('{months}', String(pending.months)).replace('{amount}', money(pending.amount))}
        <div className="btnrow"><button className="btn btn--ghost btn--sm" onClick={() => setAsk('cancel')}>{p.cancel}</button></div>
      </div> : !PAID_PLAN_AVAILABLE ? <div className="warnbar" role="status">
        <b>{p.unavailableTitle}</b><p>{p.unavailable}</p>
        {SUPPORT_CONTACT && <p>{p.contact.replace('{contact}', SUPPORT_CONTACT)}</p>}
      </div> : <form onSubmit={(event) => void submit(event)}>
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

      {(approved.length > 0 || rejected.length > 0) && <>
        <h3 className="h2" style={{ marginTop: 'var(--space-4)' }}>{p.history}</h3>
        {/* ตรวจคืนเงินไม่ได้ = ยอดในใบเสร็จยังไม่ยืนยัน ต้องบอก ไม่ใช่ปล่อยให้อ่านเป็นยอดเต็ม (D-08) */}
        {refundFailed && !loadFailed && <p className="warnbar" role="status" data-testid="plan-refund-unknown">{p.refund.loadFailed}</p>}
        <ul className="rows">
          {approved.map((r) => {
            const refund = refunds.get(r.id)
            return <li key={r.id} className="srow" {...(refund ? { 'data-testid': 'plan-refunded' } : {})}>
              <span className="srow__main"><span className="srow__name">{p.receiptItem.replace('{months}', String(r.months))} · {money(refund?.paid ?? r.amount)} {copy.common.baht}</span>
                <span className="srow__meta">{r.receipt_no} · {stamp(r.decided_at)}</span>
                {refund && <span className="srow__meta">{refundNote(refund)}</span>}</span>
              <button className="btn btn--ghost btn--sm" onClick={() => setReceipt(r)}>{p.receipt}</button>
            </li>
          })}
          {rejected.map((r) => <li key={r.id} className="srow" data-testid="plan-rejected">
            <span className="srow__main"><span className="srow__name">{p.receiptItem.replace('{months}', String(r.months))} · {money(r.amount)} {copy.common.baht}</span>
              <span className="srow__meta">{p.status.rejected} · {stamp(r.decided_at)}{SUPPORT_CONTACT ? ` · ${p.contact.replace('{contact}', SUPPORT_CONTACT)}` : ''}</span></span>
          </li>)}
        </ul>
      </>}
    </section>

    {ask === 'pause' && <ConfirmSheet title={p.pause} body={p.pauseBody} confirmLabel={p.pause} onClose={() => setAsk(null)} onConfirm={toggle} />}
    {ask === 'cancel' && <ConfirmSheet title={p.cancel} confirmLabel={p.cancel} danger onClose={() => setAsk(null)}
      onConfirm={async () => {
        try {
          if (!(await cancelPlanRequest())) throw new Error('no pending request cancelled')
          const current = await reload()
          if (current === null || current.some((row) => row.status === 'pending')) throw new Error('pending request remains')
          toast.push({ text: p.cancelled, tone: 'ok' })
          return true
        } catch {
          toast.push({ text: p.cancelFailed, tone: 'danger' })
          return false
        }
      }} />}
    {receipt && <BottomSheet title={p.receiptTitle} sub={receipt.receipt_no ?? ''} onClose={() => setReceipt(null)}>
      <dl className="paper__meta">
        <div><dt>{copy.receipt.no}</dt><dd className="num">{receipt.receipt_no}</dd></div>
        <div><dt>{copy.receipt.issuedAt}</dt><dd>{stamp(receipt.decided_at)}</dd></div>
        <div><dt>{copy.receipt.item}</dt><dd>{p.receiptItem.replace('{months}', String(receipt.months))}</dd></div>
        <div><dt>{receiptRefund ? p.refund.paid : copy.receipt.amount}</dt><dd className="num">{money(receiptRefund?.paid ?? receipt.amount)} {copy.common.baht}</dd></div>
        {/* คืนเงินแล้วห้ามให้ใบเสร็จอ่านเป็นยอดเต็ม — ยอดคืนและยอดสุทธิต้องอยู่บนใบเดียวกัน (D-08) */}
        {receiptRefund && <>
          <div><dt>{p.refund.refunded}</dt><dd className="num">-{money(receiptRefund.refunded)} {copy.common.baht}</dd></div>
          <div><dt>{p.refund.net}</dt><dd className="num">{money(receiptRefund.net)} {copy.common.baht}</dd></div>
        </>}
        <div><dt>{copy.receipt.payer}</dt><dd>{cloud.session?.user.email ?? '—'}</dd></div>
        <div><dt>{copy.receipt.payee}</dt><dd>{PROVIDER_LEGAL_NAME || copy.brand.name}</dd></div>
      </dl>
      {receiptRefund && <div data-testid="plan-receipt-refund">
        <p role="status">{refundNote(receiptRefund)}</p>
        <ul className="rows">
          {receiptRefund.entries.map((entry) => <li key={entry.id} className="srow">
            <span className="srow__main"><span className="srow__name">{p.refund.line.replace('{date}', stamp(entry.occurredAt))}</span></span>
            <span className="num">-{money(entry.amount)} {copy.common.baht}</span>
          </li>)}
        </ul>
        <p className="hint">{p.refund.keepsPlan}</p>
        <p className="hint">{p.refund.source}</p>
      </div>}
    </BottomSheet>}
  </>
}
