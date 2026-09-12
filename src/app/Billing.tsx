import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../core/store'
import { professionById } from '../professions'
import { copy } from '../copy'
import { daysSinceBackup } from '../core/backup'
import { diffDays } from '../core/format'
import { dashboard, invoiceToActOn } from '../core/selectors'
import { closableSubjects, flatBillablePeriods } from '../core/billing'
import { balanceDue, packageStatus } from '../core/ledger'
import { download, monthCsv } from '../core/export'
import { receiptOfInvoice } from '../core/receipts'
import { money, periodOf, periodThaiFull } from '../core/format'
import { BottomSheet, EmptyState, Skeleton, StatCard } from './components'
import { useToast } from './components/Toast'
import SlipSheet from './SlipSheet'
import { copyText } from './share'
import { nudgeText } from '../core/messages'
import ShareCard from './components/ShareCard'
import type { Invoice } from '../core/types'
import type { AppState } from '../core/types'

export function availableBillingPeriods(state: AppState): string[] {
  const periods = new Set<string>([periodOf(state.today)])
  state.invoices.forEach((invoice) => periods.add(invoice.period))
  state.completions.forEach((completion) => {
    const unit = state.units.find((candidate) => candidate.id === completion.unitId)
    if (unit) periods.add(periodOf(unit.scheduledAt))
  })
  state.subjects.forEach(subject => flatBillablePeriods(state, subject).forEach(period => periods.add(period)))
  return [...periods].sort((a, b) => b.localeCompare(a))
}

export default function Billing() {
  const { state, dispatch, track, hydrated, persistenceError } = useStore()
  const prof = professionById(state.professionId)
  const v = prof.vocab
  const nav = useNavigate()
  const toast = useToast()
  const periods = useMemo(() => availableBillingPeriods(state), [state])
  const [period, setPeriod] = useState(() => periodOf(state.today))
  const [confirmClose, setConfirmClose] = useState(false)
  const [slipFor, setSlipFor] = useState<Invoice | null>(null)
  const [share, setShare] = useState(false)

  const dash = useMemo(() => dashboard(state, period), [state, period])
  const closable = useMemo(() => closableSubjects(state, period), [state, period])

  const closableIds = new Set(closable.map(({ subject }) => subject.id))
  const monthly = state.subjects.filter((s) => s.billing.mode !== 'package' && (
    s.active || closableIds.has(s.id) || state.invoices.some(i => i.subjectId === s.id && i.status !== 'paid')
  ))
  const packs = state.subjects
    .filter((s) => s.active)
    .map((s) => ({ s, pk: packageStatus(state, s) }))
    .filter((x) => x.pk && x.pk.state !== 'ok')

  if (!hydrated) return <div className="pane"><Skeleton rows={5} /></div>

  const nothingToDo = state.invoices.length === 0
    && !periods.some((candidate) => closableSubjects(state, candidate).length > 0)
    && packs.length === 0
  if (nothingToDo) {
    return (
      <div className="pane">
        <EmptyState icon="🧾" title={copy.billing.emptyTitle} desc={`${v.completion}ก่อนได้ที่แท็บ${copy.nav.today}`} />
      </div>
    )
  }

  const sinceBackup = daysSinceBackup(state, state.today, diffDays)
  const noBackup = state.mode === 'real' && sinceBackup > 7

  return (
    <div className="pane">
      {noBackup && (
        <p className="warnbar">
          {Number.isFinite(sinceBackup)
            ? copy.billing.backupWarn.replace('{days}', String(sinceBackup))
            : copy.billing.backupNever}
        </p>
      )}
      <label className="fld period-picker">
        <span className="fld__l">รอบบิลที่ต้องการดู</span>
        <select className="inp" value={period} onChange={(event) => setPeriod(event.target.value)}>
          {periods.map((value) => <option key={value} value={value}>{periodThaiFull(value)}</option>)}
        </select>
      </label>
      <section className="card card--brand">
        <h2 className="h2">{periodThaiFull(period)}</h2>
        <div className="stats">
          <StatCard label={copy.billing.dash.expected} value={money(dash.expected)} tone="brand" />
          <StatCard label={copy.billing.dash.received} value={money(dash.received)} tone="ok" />
          <StatCard label={copy.billing.dash.outstanding} value={money(dash.outstanding)} tone="danger" />
        </div>
        <div className="kv">
          <span>{copy.billing.dash.recovered}</span>
          <b className="num">{money(dash.recovered)} {copy.common.baht}</b>
        </div>
        {/* อธิบายว่าตัวเลขนี้มาจากไหน — ราคาขายไม่ควรอยู่ในเครื่องมือของผู้ใช้ */}
        {dash.recovered > 0
          ? <details className="hint hint--fold"><summary>{copy.billing.recoveredWhy}</summary>{copy.billing.recoveredHow}</details>
          : null}
        {/* การ์ดแชร์มีค่าเมื่อมีตัวเลขให้อวด — เดือนที่ยังเป็น 0 การ์ดจะเขียนว่า "ช่วยไว้ 0 บาท"
            ซึ่งพูดแทนครูในทางที่ไม่จริงและไม่มีใครอยากแชร์ (เจ้าของ 12 ก.ย.: "ไม่แน่ใจว่ามีมันดีไหม") */}
        {dash.recovered > 0 && (
          <button className="btn btn--secondary btn--block" onClick={() => setShare(true)}>{copy.billing.share}</button>
        )}
      </section>

      {closable.length > 0 && (
        <button className="btn btn--primary btn--block" onClick={() => setConfirmClose(true)}>
          {copy.billing.closeMonth} ({closable.length})
        </button>
      )}

      <h2 className="h2" style={{ marginTop: 'var(--space-4)' }}>{copy.billing.groupMonthly}</h2>
      <ul className="rows">
        {monthly.map((s) => {
          const inv = invoiceToActOn(state, s.id, period)
          const rc = inv ? receiptOfInvoice(state, inv.id) : undefined
          return (
            <li className="srow" key={s.id}>
              <span className="srow__main">
                <span className="srow__name">{s.name}</span>
                <span className="srow__meta">{inv ? `${money(inv.total)} · ${copy.billing.status[inv.status]}${inv.status !== 'paid' ? ` · คงเหลือ ${money(balanceDue(state, inv.id))}` : ''}` : copy.billing.noInvoices}</span>
              </span>
              {inv?.status === 'draft' && <button className="btn btn--secondary btn--sm" onClick={() => nav('/app/admin?tab=drafts')}>{copy.billing.viewMessage}</button>}
              {(inv?.status === 'sent' || inv?.status === 'overdue') && <span className="srow__acts">
                <button className="btn btn--primary btn--sm" onClick={() => setSlipFor(inv)}>{state.mode === 'real' ? copy.billing.attachSlipReal : copy.billing.attachSlip}</button>
                <button className="btn btn--ghost btn--sm" onClick={() => {
                  // คัดลอกอย่างเดียว — ไม่แตะสถานะบิลและไม่เข้าคิวส่ง ครูวางในแชทเองตามสะดวก
                  void copyText(nudgeText(state, inv)).then((ok) => {
                    if (ok) track('copy_nudge', { period })
                    toast.push({ text: ok ? copy.toast.copied : copy.toast.copyFailed, tone: ok ? 'ok' : 'danger' })
                  })
                }}>{copy.billing.copyNudge}</button>
              </span>}
              {inv?.status === 'paid' && rc && <button className="btn btn--ghost btn--sm" onClick={() => nav(`/receipt/${rc.id}`)}>{copy.billing.viewReceipt}</button>}
            </li>
          )
        })}
      </ul>

      {packs.length > 0 && (
        <>
          <h2 className="h2" style={{ marginTop: 'var(--space-4)' }}>{copy.billing.groupPackage}</h2>
          <ul className="rows">
            {packs.map(({ s, pk }) => (
              <li className="srow" key={s.id}>
                <span className="srow__main">
                  <span className="srow__name">{s.name}</span>
                  <span className="srow__meta">{pk!.overBy ? `เกิน ${pk!.overBy}` : `เหลือ ${pk!.remaining}/${pk!.total}`}</span>
                </span>
                <button className="btn btn--secondary btn--sm" onClick={() => nav('/app/admin?tab=drafts')}>{copy.billing.viewMessage}</button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="btnrow">
        <button className="btn btn--secondary btn--sm" onClick={() => nav('/app/receipts')}>{copy.billing.allReceipts}</button>
        <button className="btn btn--secondary btn--sm" onClick={() => {
          // ไฟล์เดียว — มือถือบล็อกดาวน์โหลดตัวที่สองที่ยิงตามมา แต่ toast บอกว่าสำเร็จ
          download(monthCsv(state, period), `solo-${period}.csv`, 'text/csv;charset=utf-8')
          track('export_csv', { period }); toast.push({ text: copy.toast.exported, tone: 'ok' })
        }}>{copy.billing.exportCsv}</button>
      </div>

      {confirmClose && (
        <BottomSheet title={copy.billing.closeMonth} sub={`${copy.billing.closeConfirm} ${closable.length}`} onClose={() => setConfirmClose(false)}
          footer={
            <button className="btn btn--primary btn--block" onClick={() => {
              if (!dispatch({ type: 'closeMonth', period })) {
                toast.push({ text: persistenceError ?? 'ปิดยอดรอบนี้ไม่ได้ โปรดตรวจสถานะบิลหรือโหลดข้อมูลล่าสุด', tone: 'danger' })
                return
              }
              track('close_month', { period, count: closable.length })
              setConfirmClose(false)
              toast.push({ text: `${copy.toast.invoicesCreated} ${closable.length}`, tone: 'ok', action: { label: copy.toast.goSend, run: () => nav('/app/admin?tab=drafts') } })
            }}>{copy.common.confirm}</button>
          }>
          <ul className="rows">
            {closable.map(({ subject, invoice }) => (
              <li className="kv" key={subject.id}><span>{subject.name}</span><b className="num">{money(invoice.total)}</b></li>
            ))}
          </ul>
        </BottomSheet>
      )}

      {slipFor && <SlipSheet invoice={slipFor} onClose={() => setSlipFor(null)} />}
      {share && <ShareCard period={period} recovered={dash.recovered} onClose={() => setShare(false)} />}
    </div>
  )
}
