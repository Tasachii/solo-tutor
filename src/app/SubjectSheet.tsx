import { useRef, useState } from 'react'
import { useStore } from '../core/store'
import { COURSE_SESSIONS_FALLBACK, packageStatus } from '../core/ledger'
import { professionById } from '../professions'
import { copy } from '../copy'
import { BottomSheet } from './components'
import type { BillingMode, Subject } from '../core/types'
import { isCourseSessions, isMoney } from '../core/validation'
import { billingChangeIssue, type BillingChangeIssue } from '../core/billing'
import { defaultBillingFor } from '../core/style'
import { fillVocab } from '../professions'
import { readPlanInfo, studentCapIssue, type CapIssue } from '../core/plan'
import { PlanSheet } from './PlanSheet'

type Mode = BillingMode['mode']

export function parseMoneyInput(value: string): number | null {
  const amount = Number(value.replace(/[,\s]/g, ''))
  return isMoney(amount) ? amount : null
}

export function buildBilling(
  mode: Mode,
  values: { rate: string; flat: string; packageTotal: string; packagePrice: string },
  current: BillingMode | undefined,
  today: string,
): BillingMode | null {
  const rate = parseMoneyInput(values.rate)
  const flat = parseMoneyInput(values.flat)
  const total = parseMoneyInput(values.packageTotal)
  const price = parseMoneyInput(values.packagePrice)
  if (mode === 'per_unit') return rate === null ? null : { mode, rate }
  if (mode === 'flat_monthly') return flat === null ? null : { mode, amount: flat }
  if (total === null || price === null) return null
  return {
    mode, total, price,
    purchasedAt: current?.mode === 'package' ? current.purchasedAt : today,
    ...(current?.mode === 'package' && current.carriedUnitIds
      ? { carriedUnitIds: [...current.carriedUnitIds] }
      : {}),
    ...(current?.mode === 'package' && current.carriedCredits !== undefined
      ? { carriedCredits: current.carriedCredits }
      : {}),
  }
}

export function billingChangeMessage(issue: BillingChangeIssue | null): string | null {
  if (issue === 'unbilled-mode-change') {
    return 'ยังเปลี่ยนวิธีคิดเงินไม่ได้ เพราะมีงานที่ทำแล้วแต่ยังไม่ออกบิล กรุณาปิดยอดเดือนที่ค้างก่อน'
  }
  if (issue === 'unbilled-flat-price-change') {
    return 'ยังเปลี่ยนยอดเหมาไม่ได้ เพราะมีงานที่ทำแล้วแต่ยังไม่ออกบิล กรุณาปิดยอดเดือนที่ค้างก่อน'
  }
  if (issue === 'package-history-mode-change') {
    return 'แพ็กนี้มีประวัติใช้งานแล้ว ให้หยุดรายการเดิมและเพิ่มรายการใหม่เพื่อเปลี่ยนวิธีคิดเงิน'
  }
  return null
}

export default function SubjectSheet({ subject, onClose }: { subject?: Subject; onClose: () => void }) {
  const { state, dispatch } = useStore()
  const prof = professionById(state.professionId)
  const v = prof.vocab
  const client = subject ? state.clients.find((c) => c.id === subject.clientId) : undefined
  const b = subject?.billing
  const payerLocked = !!subject && (state.invoices.some(invoice => invoice.subjectId === subject.id)
    || state.messages.some(message => message.subjectId === subject.id))

  const seq = useRef(0)
  const [payerChoice, setPayerChoice] = useState(subject?.clientId ?? 'new')
  const [name, setName] = useState(subject?.name ?? '')
  const [clientName, setClientName] = useState(client?.name ?? '')
  const [lineId, setLineId] = useState(client?.lineId ?? '')
  const [mode, setMode] = useState<Mode>(b?.mode ?? defaultBillingFor(state.style))
  const [rate, setRate] = useState(String(b?.mode === 'per_unit' ? b.rate : 400))
  const [flat, setFlat] = useState(String(b?.mode === 'flat_monthly' ? b.amount : 3000))
  // แพ็กที่ลูกค้าใช้ไปแล้ว การแก้จำนวน/ราคาทำให้ยอดคงเหลือกระโดดทันที — ต้องเตือนก่อน
  const usedPack = subject && b?.mode === 'package' ? packageStatus(state, subject)?.used ?? 0 : 0
  const [pkTotal, setPkTotal] = useState(String(b?.mode === 'package' ? b.total : 10))
  const [pkPrice, setPkPrice] = useState(String(b?.mode === 'package' ? b.price : 3500))
  /** จำนวนครั้งของคอร์ส — ว่าง = ใช้ค่าเริ่มต้นของครู (ไม่ใช่แพ็ก แพ็กนับจากจำนวนครั้งที่ซื้ออยู่แล้ว) */
  const [courseSessions, setCourseSessions] = useState(subject?.courseSessions ? String(subject.courseSessions) : '')
  const [err, setErr] = useState<Record<string, string>>({})
  const [capIssue, setCapIssue] = useState<CapIssue | null>(null)
  const [packageIntent, setPackageIntent] = useState<'opening_balance' | 'paid_purchase'>('opening_balance')
  const nextBilling = buildBilling(mode, {
    rate, flat, packageTotal: pkTotal, packagePrice: pkPrice,
  }, b, state.today)
  const changeIssue = subject && nextBilling ? billingChangeIssue(state, subject, nextBilling) : null
  const changeIssueText = billingChangeMessage(changeIssue)

  const save = () => {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = copy.common.required
    if (!clientName.trim()) e.clientName = copy.common.required
    const billing = nextBilling
    if (mode === 'per_unit' && !billing) e.rate = copy.common.numberPositive
    if (mode === 'flat_monthly' && !billing) e.flat = copy.common.numberPositive
    if (mode === 'package' && !billing) e.pk = copy.common.numberPositive
    if (mode !== 'package' && courseSessions.trim() && !isCourseSessions(Number(courseSessions))) e.course = copy.common.numberPositive
    setErr(e)
    if (Object.keys(e).length || !billing || changeIssue) return
    // เพดานแพ็กฟรี — เช็คก่อน dispatch เพื่อบอกครูว่าติดอะไร ไม่ใช่ปฏิเสธเงียบ ๆ
    if (!subject) { const issue = studentCapIssue(state, readPlanInfo(), 1); if (issue) { setCapIssue(issue); return } }

    // นับต่อท้ายด้วย เพราะเพิ่มสองคนติดกันในมิลลิวินาทีเดียว id จะชนกัน
    const stamp = `${Date.now().toString(36)}${(seq.current += 1).toString(36)}`
    const id = subject?.id ?? `s-${stamp}`
    const clientId = payerChoice === 'new' ? `c-${stamp}` : payerChoice
    if (!dispatch({
      type: 'upsertSubject',
      subject: {
        id, name: name.trim(), clientId, billing,
        label: subject?.label, active: subject?.active ?? true, createdAt: subject?.createdAt ?? state.today,
        ...(mode !== 'package' && courseSessions.trim() ? { courseSessions: Number(courseSessions) } : {}),
      },
      clientName: clientName.trim(),
      lineId: lineId.trim() || null,
      ...(mode === 'package' && !subject ? { packageIntent } : {}),
    })) { setErr({ save: 'บันทึกไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ โปรดตรวจสิทธิ์เขียนของแท็บนี้แล้วลองอีกครั้ง' }); return }
    onClose()
  }

  return (
    <BottomSheet
      title={subject ? `แก้ไข ${subject.name}` : `+ ${v.subject}`}
      onClose={onClose}
      footer={<button className="btn btn--primary btn--block" disabled={!!changeIssue} onClick={save}>{copy.common.save}</button>}
    >
      {err.save && <p className="fld__err" role="alert">{err.save}</p>}
      <label className="fld">
        <span className="fld__l">{copy.subjects.fieldName}</span>
        <input className="inp" aria-label={copy.subjects.fieldName} aria-invalid={!!err.name || undefined}
          aria-describedby={err.name ? 'subject-name-error' : undefined} value={name} onChange={(e) => setName(e.target.value)} />
        {err.name && <span id="subject-name-error" className="fld__err">{err.name}</span>}
      </label>
      <label className="fld">
        <span className="fld__l">เลือกผู้จ่ายที่มีอยู่</span>
        <select className="inp" aria-label="เลือกผู้จ่ายที่มีอยู่" disabled={payerLocked}
          aria-describedby={payerLocked ? 'subject-payer-history' : undefined} value={payerChoice} onChange={(event) => {
          const id = event.target.value
          setPayerChoice(id)
          const payer = state.clients.find((candidate) => candidate.id === id)
          if (payer) { setClientName(payer.name); setLineId(payer.lineId ?? '') }
          else { setClientName(''); setLineId('') }
        }}>
          <option value="new">เพิ่มผู้จ่ายใหม่</option>
          {state.clients.map((payer) => <option key={payer.id} value={payer.id}>{payer.name}</option>)}
        </select>
        {payerLocked && <span id="subject-payer-history" className="hint">รายการนี้มีประวัติบิลแล้วหรือมีข้อความถึงผู้จ่าย หากต้องเปลี่ยนผู้จ่าย ให้หยุดรายการเดิมและเพิ่มรายการใหม่เพื่อเก็บประวัติให้ถูกต้อง</span>}
      </label>
      <label className="fld">
        <span className="fld__l">{copy.subjects.fieldClient}</span>
        <input className="inp" aria-label={copy.subjects.fieldClient} aria-invalid={!!err.clientName || undefined}
          aria-describedby={err.clientName ? 'client-name-error' : undefined} value={clientName} onChange={(e) => setClientName(e.target.value)} />
        {err.clientName && <span id="client-name-error" className="fld__err">{err.clientName}</span>}
      </label>
      <label className="fld">
        <span className="fld__l">{copy.subjects.fieldLine}</span>
        <input className="inp" aria-label={copy.subjects.fieldLine} value={lineId} onChange={(e) => setLineId(e.target.value)} />
        <span className="hint">ปล่อยว่างเพื่อล้าง LINE ID เดิม</span>
      </label>

      <div className="fld">
        <span className="fld__l">{copy.subjects.fieldMode}</span>
        <div className="chips">
          {(['per_unit', 'flat_monthly', 'package'] as Mode[]).map((m) => (
            <button key={m} className={`chip${mode === m ? ' chip--on' : ''}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {copy.waitlist.modeLabels[m]}
            </button>
          ))}
        </div>
        <span className="hint">{fillVocab(copy.waitlist.modeHow[mode], prof.vocab)}</span>
        {changeIssueText && <span className="hint hint--bad" role="alert">{changeIssueText}</span>}
      </div>

      {mode === 'per_unit' && (
        <label className="fld">
          <span className="fld__l">{copy.subjects.fieldRate}</span>
          <input className="inp" inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value)} />
          {err.rate && <span className="fld__err">{err.rate}</span>}
        </label>
      )}
      {mode === 'flat_monthly' && (
        <label className="fld">
          <span className="fld__l">{copy.subjects.fieldFlat}</span>
          <input className="inp" inputMode="numeric" value={flat} onChange={(e) => setFlat(e.target.value)} />
          {err.flat && <span className="fld__err">{err.flat}</span>}
        </label>
      )}
      {mode !== 'package' && (
        <div className="fld">
          <span className="fld__l">{copy.course.field}</span>
          <div className="chips">
            {(prof.packagePresets ?? [10, 20]).map((n) => (
              <button key={n} type="button" className={`chip${courseSessions === String(n) ? ' chip--on' : ''}`}
                aria-pressed={courseSessions === String(n)} onClick={() => setCourseSessions(String(n))}>{n}</button>
            ))}
            <button type="button" className={`chip${courseSessions === '' ? ' chip--on' : ''}`} aria-pressed={courseSessions === ''}
              onClick={() => setCourseSessions('')}>
              {copy.course.useDefault.replace('{n}', String(state.courseSessionsDefault ?? COURSE_SESSIONS_FALLBACK))}
            </button>
          </div>
          <input className="inp" inputMode="numeric" aria-label={copy.course.field} value={courseSessions}
            onChange={(e) => setCourseSessions(e.target.value.replace(/\D/g, '').slice(0, 3))} />
          {err.course && <span className="fld__err">{err.course}</span>}
        </div>
      )}
      {mode === 'package' && (
        <>
          {!subject && (
            <div className="fld" role="group" aria-label="ที่มาของสิทธิ์แพ็ก">
              <span className="fld__l">สิทธิ์แพ็กนี้มาจากไหน</span>
              <div className="chips">
                <button type="button" className={`chip${packageIntent === 'opening_balance' ? ' chip--on' : ''}`}
                  aria-pressed={packageIntent === 'opening_balance'} onClick={() => setPackageIntent('opening_balance')}>ยอดยกมา ยังไม่บันทึกรับเงิน</button>
                <button type="button" className={`chip${packageIntent === 'paid_purchase' ? ' chip--on' : ''}`}
                  aria-pressed={packageIntent === 'paid_purchase'} onClick={() => setPackageIntent('paid_purchase')}>รับเงินค่าแพ็กแล้ว</button>
              </div>
              <span className="hint">เลือกให้ตรงกับเงินจริง ระบบจะออกใบเสร็จเฉพาะรายการที่รับเงินแล้ว</span>
            </div>
          )}
          <div className="fld">
            <span className="fld__l">{copy.subjects.fieldPackTotal}</span>
            <div className="chips">
              {(prof.packagePresets ?? [10, 20]).map((n) => (
                <button key={n} className={`chip${pkTotal === String(n) ? ' chip--on' : ''}`}
                  disabled={b?.mode === 'package'} aria-pressed={pkTotal === String(n)} onClick={() => setPkTotal(String(n))}>{n}</button>
              ))}
            </div>
            <input className="inp" inputMode="numeric" disabled={b?.mode === 'package'} value={pkTotal} onChange={(e) => setPkTotal(e.target.value)} />
          </div>
          <label className="fld">
            <span className="fld__l">{copy.subjects.fieldPackPrice}</span>
            <input className="inp" inputMode="numeric" disabled={b?.mode === 'package'} value={pkPrice} onChange={(e) => setPkPrice(e.target.value)} />
            {b?.mode === 'package' && <span className="hint">จำนวนและราคานี้เป็นของแพ็กที่ซื้อแล้ว ตั้งจำนวนและราคาใหม่ได้ตอนต่อแพ็ก</span>}
            {err.pk && <span className="fld__err">{err.pk}</span>}
            {usedPack > 0 && (
              <span className="hint hint--bad">
                {copy.subjects.packEditWarn.replace('{used}', String(usedPack))}
              </span>
            )}
          </label>
        </>
      )}
      {capIssue && <PlanSheet issue={capIssue} onClose={() => setCapIssue(null)} />}
    </BottomSheet>
  )
}
