import { useEffect, useState } from 'react'
import { useStore } from '../core/store'
import { copy } from '../copy'
import { money } from '../core/format'
import { BottomSheet, Skeleton } from './components'
import { useToast } from './components/Toast'
import { mkMessage, slipRequestText } from '../core/messages'
import type { Invoice } from '../core/types'
import { seedOf } from '../core/share'
import { balanceDue } from '../core/ledger'
import { isMoney } from '../core/validation'

type Phase = 'idle' | 'checking' | 'match' | 'mismatch' | 'unreadable'

/** ผลการอ่านสลิป: 80% ตรง / 15% ยอดไม่ตรง / 5% อ่านไม่ออก */
export function rollSlip(total: number, rnd = Math.random()): { phase: Phase; slipAmount?: number } {
  if (rnd < 0.8) return { phase: 'match' }
  if (rnd < 0.95) return { phase: 'mismatch', slipAmount: rnd < 0.875 ? total - 200 : total + 500 }
  return { phase: 'unreadable' }
}

export default function SlipSheet(
  { invoice, onClose, onPaid }: { invoice: Invoice; onClose: () => void; onPaid?: () => void },
) {
  const { state, dispatch, track, persistenceError } = useStore()
  const toast = useToast()
  const [phase, setPhase] = useState<Phase>('idle')
  const [slipAmount, setSlipAmount] = useState<number | undefined>(undefined)
  // ใส่ยอดเองในโหมดจริง — เดิมใช้ window.prompt ซึ่ง iOS ที่ติดตั้งลงจอมักไม่เด้ง
  // และพิมพ์ 1,200 มีลูกน้ำก็กลายเป็น NaN แล้วเงียบไปเฉย ๆ
  const [manual, setManual] = useState(false)
  const [manualText, setManualText] = useState('')
  const manualValue = Number(manualText.replace(/[,\s]/g, ''))
  const due = balanceDue(state, invoice.id)
  const manualOk = isMoney(manualValue) && manualValue <= due

  const real = state.mode === 'real'

  useEffect(() => {
    if (phase !== 'checking' || real) return
    const t = window.setTimeout(() => {
      // ผลผูกกับเลขที่ใบแจ้ง ไม่ใช่ Math.random — เดโมเดิมสุ่มใหม่ทุกครั้ง
      // ตอนโชว์กรรมการอาจขึ้น "ยอดไม่ตรง" โดยไม่ตั้งใจ และเทสก็แกว่งตาม
      const res = rollSlip(due, seedOf(invoice.id))
      setPhase(res.phase); setSlipAmount(res.slipAmount)
      track('slip_verify', { result: res.phase })
    }, 1500)
    return () => window.clearTimeout(t)
  }, [phase, invoice.id, due, track, real])

  const pay = (amount: number, verified: boolean) => {
    if (!isMoney(amount) || amount > due) return
    if (!dispatch({ type: 'recordPayment', invoiceId: invoice.id, amount, slipVerified: verified, slipAmount })) return
    toast.push({ text: amount === due ? copy.toast.receiptIssued : copy.toast.saved, tone: 'ok' })
    onPaid?.(); onClose()
  }

  const askAgain = () => {
    if (slipAmount === undefined) return
    const msg = mkMessage(state, 'faq_reply', invoice.clientId, invoice.subjectId,
      slipRequestText(state, invoice, slipAmount), `slip:${invoice.id}:${slipAmount}`)
    if (!dispatch({ type: 'addMessage', message: msg })) return
    toast.push({ text: copy.admin.draftedTag, tone: 'warn' })
    onClose()
  }

  return (
    <BottomSheet title={real ? copy.billing.attachSlipReal : copy.billing.attachSlip} sub={`${money(due)} ${copy.common.baht}`} onClose={onClose}
      footer={
        real
          // โหมดจริง: ไม่มีการอ่านสลิปอัตโนมัติ ครูเทียบยอดเองแล้วกดยืนยัน
          // การสุ่มผลบนสลิปจริงคือหายนะ — บอกว่ายอดไม่ตรงทั้งที่ตรง
          ? (manual
              ? <div className="btnrow">
                  <button className="btn btn--primary" disabled={!manualOk} onClick={() => pay(manualValue, false)}>
                    {copy.billing.slipConfirm}
                  </button>
                  <button className="btn btn--ghost" onClick={() => setManual(false)}>{copy.common.cancel}</button>
                </div>
              : <div className="btnrow">
                  <button className="btn btn--primary" onClick={() => pay(due, false)}>{copy.billing.slipRealOk}</button>
                  <button className="btn btn--secondary" onClick={() => { setManual(true); setManualText(String(due)) }}>
                    {copy.billing.slipRealOther}
                  </button>
                </div>)
        : phase === 'idle'
          ? <button className="btn btn--primary btn--block" onClick={() => setPhase('checking')}>{copy.billing.slipPick}</button>
          : phase === 'match'
            ? <button className="btn btn--primary btn--block" onClick={() => pay(due, true)}>{copy.billing.slipConfirm}</button>
            : phase === 'mismatch'
              ? <div className="btnrow">
                  {/* สลิปเกินยอด: รับเท่ายอดบิล จดยอดในสลิปไว้ในประวัติ — เดิมปุ่มถูกปิดเฉย ๆ ครูค้างอยู่หน้านี้ */}
                  <button className="btn btn--primary" disabled={!isMoney(slipAmount)}
                    onClick={() => pay(Math.min(slipAmount!, due), true)}>{copy.billing.slipAcceptAs}</button>
                  <button className="btn btn--secondary" onClick={askAgain}>{copy.billing.slipAskAgain}</button>
                </div>
              : phase === 'unreadable'
                ? <div className="btnrow">
                    <button className="btn btn--secondary" onClick={() => setPhase('checking')}>{copy.billing.slipRetry}</button>
                    <button className="btn btn--primary" onClick={() => pay(due, false)}>{copy.billing.slipManual}</button>
                  </div>
                : null
      }>
      {persistenceError && <p className="warnbar" role="alert">{persistenceError}</p>}
      {phase === 'checking' && <><p className="p">{copy.billing.slipChecking}</p><Skeleton rows={2} /></>}
      {phase === 'match' && <p className="p">{copy.billing.slipMatch} · {money(due)} {copy.common.baht}</p>}
      {phase === 'mismatch' && (
        <>
          <p className="p">{copy.billing.slipMismatch}</p>
          <div className="kv"><span>{copy.billing.slipAmount}</span><b className="num">{money(slipAmount ?? 0)}</b></div>
          <div className="kv"><span>{copy.billing.invoiceAmount}</span><b className="num">{money(due)}</b></div>
          {isMoney(slipAmount) && slipAmount > due && <p className="hint">{copy.billing.slipOver.replace('{diff}', money(slipAmount - due))}</p>}
        </>
      )}
      {phase === 'unreadable' && <p className="p">{copy.billing.slipUnreadable}</p>}
      {real && manual && (
        <label className="fld">
          <span className="fld__l">{copy.billing.slipAmount}</span>
          <input className="inp" inputMode="numeric" autoFocus value={manualText}
            onChange={(e) => setManualText(e.target.value)} />
          {!manualOk && manualText !== '' && <span className="hint hint--bad">
            {manualValue > due ? `ยอดต้องไม่เกิน ${money(due)} ${copy.common.baht}` : copy.common.numberPositive}
          </span>}
        </label>
      )}
      {real
        ? !manual && <p className="p dim">{copy.billing.slipReal}</p>
        : phase === 'idle' && <p className="p dim">{copy.billing.slipSim}</p>}
    </BottomSheet>
  )
}
