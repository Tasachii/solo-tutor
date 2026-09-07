import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useStore } from '../core/store'
import { copy } from '../copy'
import { PROMPTPAY_DISPLAY } from '../platform/config'
import { balanceDue, clientById, packageStatus, paidAmount } from '../core/ledger'
import { receiptOfInvoice } from '../core/receipts'
import { money, periodOf, periodThai } from '../core/format'
import { DemoBadge, EmptyState, ProgressBar, PromptPayQR, QRPlaceholder } from './components'
import { isPaymentDestination, normalizePaymentDestination } from '../core/paymentDestination'

/** มุมมองผู้จ่าย — อ่านอย่างเดียว ตัวเลขทุกตัวมาจาก ledger ชุดเดียวกับฝั่งครู */
export default function ClientPreview() {
  const { clientId = '' } = useParams()
  const { state } = useStore()
  const client = clientById(state, clientId)
  const period = periodOf(state.today)
  const real = state.mode === 'real'
  const [invoiceView, setInvoiceView] = useState<'outstanding' | 'history'>('outstanding')

  if (!client) {
    return (
      <div className="page page--client">
        {!real && <DemoBadge />}
        <EmptyState icon="🔍" title={copy.errors.notFound}
          action={<Link className="btn btn--ghost" to="/app/today">{copy.clientView.backToApp}</Link>} />
      </div>
    )
  }

  const subjects = state.subjects.filter((s) => s.clientId === clientId)

  const history = state.invoices.filter(i => i.clientId === clientId && i.status !== 'draft')
    .sort((a, b) => Number(a.status === 'paid') - Number(b.status === 'paid') || a.period.localeCompare(b.period))
  const unpaid = history.filter(i => i.status !== 'paid')
  const effectiveInvoiceView = unpaid.length === 0 ? 'history' : invoiceView
  const billed = effectiveInvoiceView === 'history' ? history : unpaid
  const total = billed.reduce((n, i) => n + i.total, 0)
  const paid = billed.reduce((n, i) => n + paidAmount(state, i.id), 0)
  const due = billed.reduce((n, i) => n + balanceDue(state, i.id), 0)
  const allPaid = billed.length > 0 && due === 0
  const receipts = billed.map(i => receiptOfInvoice(state, i.id)).filter(r => !!r)
  // หัวใบต้องบอกเดือนของบิลที่แสดง ไม่ใช่เดือนปัจจุบัน — บิล ส.ค. ที่เปิดดูเดือน ก.ย. เคยขึ้นว่า ก.ย.
  const shownPeriods = [...new Set(billed.map((i) => i.period))].sort().map(periodThai).join(' · ')

  return (
    <div className="page page--client">
      {/* แบนเนอร์เดโมและลิงก์เข้าหลังบ้านครู ห้ามโผล่ให้ผู้ปกครองจริงเห็น */}
      {!real && (
        <div className="cbanner">
          <span>{copy.clientView.banner}</span>
          <Link className="btn btn--sm btn--ghost" to="/app/today">{copy.clientView.backToApp}</Link>
        </div>
      )}

      <h1 className="cv__h1">{copy.clientView.invoiceTitle}</h1>
      <p className="cv__who">{client.name} · {shownPeriods || periodThai(period)}</p>
      {history.length > 0 && (
        <div className="chips" role="group" aria-label="เลือกบิลที่แสดง">
          <button className={`chip${effectiveInvoiceView === 'outstanding' ? ' chip--on' : ''}`}
            aria-pressed={effectiveInvoiceView === 'outstanding'} disabled={unpaid.length === 0}
            onClick={() => setInvoiceView('outstanding')}>ยอดที่ยังต้องชำระ ({unpaid.length})</button>
          <button className={`chip${effectiveInvoiceView === 'history' ? ' chip--on' : ''}`}
            aria-pressed={effectiveInvoiceView === 'history'} onClick={() => setInvoiceView('history')}>ประวัติบิลทั้งหมด ({history.length})</button>
        </div>
      )}
      {unpaid.length === 0 && history.length > 0 && <p className="hint" role="status">ชำระครบแล้ว รายการด้านล่างเป็นประวัติบิลที่ผ่านมา</p>}

      {billed.length === 0 ? (
        <EmptyState icon="🧾" title={copy.clientView.noInvoice} desc={copy.clientView.noInvoiceHint} />
      ) : (
        <>
          <ul className="cv__lines">
            {billed.map((r) => (
              <li key={r.id}>
                <span>{subjects.find(s => s.id === r.subjectId)?.name} · {periodThai(r.period)}</span>
                <b className="num">{money(r.total)} {copy.common.baht}</b>
              </li>
            ))}
            <li className="cv__lines--sum">
              <span>{copy.receipt.total}</span>
              <b className="num">{money(total)} {copy.common.baht}</b>
            </li>
          </ul>
          <p>รับแล้ว <b className="num">{money(paid)}</b> บาท · คงเหลือ <b className="num">{money(due)}</b> บาท</p>

          {allPaid ? (
            <div className="paid-ok">
              <span className="paid-ok__txt">{copy.clientView.paid}</span>
              {receipts.map(receipt => <Link key={receipt.id} className="btn btn--sm btn--primary" to={`/receipt/${receipt.id}`}>{copy.clientView.viewReceipt} {receipt.number}</Link>)}
            </div>
          ) : (
            <div className="cv__pay">
              {/* เลขบัญชีของครูจริง — ของเดโมใช้ตัวอย่าง */}
              {real ? (isPaymentDestination(state.provider.promptpayId)
                ? <>
                    {/* ยอดใน QR มาจาก ledger — ถ้าสร้างไม่ได้ยังเหลือเลขบัญชีให้โอนเองเสมอ */}
                    <PromptPayQR destination={state.provider.promptpayId} amount={due}
                      label={copy.clientView.scanToPay} sub={copy.clientView.scanAmount.replace('{n}', money(due))} />
                    <p>โอนผ่านพร้อมเพย์</p><strong>{normalizePaymentDestination(state.provider.promptpayId)}</strong><p>ผู้รับเงิน: {state.provider.name}</p><p className="hint">ตรวจชื่อผู้รับในแอปธนาคารก่อนโอน แล้วส่งสลิปกลับในแชท</p>
                  </>
                : <p role="status">ยังไม่ได้ตั้งค่าพร้อมเพย์ กรุณาติดต่อผู้ให้บริการเพื่อขอข้อมูลชำระเงิน</p>)
                : <QRPlaceholder label={copy.clientView.qrSample} sub={PROMPTPAY_DISPLAY} />}
              <p className="hint">{real ? copy.clientView.slipHow : copy.clientView.sample}</p>
            </div>
          )}
        </>
      )}

      {subjects.map((s) => {
        const pk = packageStatus(state, s)
        if (!pk) return null
        return (
          <div key={s.id} className="card cv__pack">
            <div className="cv__packhd">
              <span>{s.name}</span>
              <b className="num">{copy.clientView.packRemain} {pk.remaining}/{pk.total}</b>
            </div>
            <ProgressBar value={pk.used} max={pk.total}
              tone={pk.state === 'exhausted' ? 'danger' : pk.state === 'low' ? 'warn' : 'ok'} />
          </div>
        )
      })}

      {!real && <p className="hint cv__fine">{copy.demoBadge}</p>}
    </div>
  )
}
