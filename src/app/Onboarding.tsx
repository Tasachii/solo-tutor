import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../core/store'
import { professionById, fillVocab } from '../professions'
import { copy } from '../copy'
import type { BillingMode, Particle } from '../core/types'
import { PARTICLES } from '../core/particle'
import { defaultBillingFor } from '../core/style'
import { normalizePaymentDestination, isPaymentDestination } from '../core/paymentDestination'
import { parseMoneyInput } from './SubjectSheet'
import { readPlanInfo, studentCapIssue, type CapIssue } from '../core/plan'
import { PlanSheet } from './PlanSheet'
import { readPlanIntent, validPaidPlanMonths } from '../platform/plans'
import { useCloudSync } from './CloudSync'

interface Row { name: string; clientName: string; lineId?: string; error?: string }

/** แต่ละบรรทัด: ชื่อ, ชื่อผู้จ่าย, LINE — คั่นด้วย , หรือ tab */
export function parseRoster(text: string): Row[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split(/[,\t]/).map((p) => p.trim())
    const [name, clientName, lineId] = parts
    if (!name) return { name: line, clientName: '', error: copy.onboarding.noName }
    if (!clientName) return { name, clientName: '', error: copy.onboarding.noPayerName }
    return { name, clientName, lineId: lineId || undefined }
  })
}

export default function Onboarding() {
  const { state, dispatch, resetDemo, track } = useStore()
  const cloud = useCloudSync()
  const prof = professionById(state.professionId)
  const v = prof.vocab
  const nav = useNavigate()
  const loc = useLocation()
  // ครูที่เข้าสู่ระบบบนเครื่องใหม่: ระหว่างคลาวด์กำลังดึงข้อมูล ห้ามให้กรอกทับ และเมื่อดึงเสร็จแล้วมีข้อมูล → เข้าแอปเลย
  const pulling = cloud.status === 'syncing'
  const wasPulling = useRef(false)
  useEffect(() => {
    if (pulling) { wasPulling.current = true; return }
    if (wasPulling.current && cloud.status === 'synced' && state.onboarded && state.subjects.length > 0) {
      nav('/app/today', { replace: true })
    }
    if (cloud.status !== 'syncing') wasPulling.current = false
  }, [pulling, cloud.status, state.onboarded, state.subjects.length, nav])
  const [step, setStep] = useState(1)
  const [name, setName] = useState(state.provider.name)
  const [pp, setPp] = useState(state.provider.promptpayId)
  const [particle, setParticle] = useState<Particle | undefined>(state.provider.particle)
  const [text, setText] = useState('')
  const [capIssue, setCapIssue] = useState<CapIssue | null>(null)
  const [mode, setMode] = useState<BillingMode['mode']>(state.style ? defaultBillingFor(state.style) : prof.defaultBilling ?? 'per_unit')
  // ราคาเริ่มต้นที่แก้ได้ก่อนกดเริ่ม — เดิมล็อกไว้ ครูที่คิดคนละราคาต้องไปแก้ทีละคน
  const [rate, setRate] = useState('400')
  const [flat, setFlat] = useState('3000')
  const [packTotal, setPackTotal] = useState('10')
  const [packPrice, setPackPrice] = useState('3500')
  const [promptpayError, setPromptpayError] = useState(false)
  const [confirmBadRows, setConfirmBadRows] = useState(false)
  const [packageIntent, setPackageIntent] = useState<'opening_balance' | 'paid_purchase'>('opening_balance')
  const normalizedPromptpay = normalizePaymentDestination(pp)
  const promptpayOk = pp.trim() === '' || isPaymentDestination(pp)
  const priceOk = mode === 'per_unit' ? parseMoneyInput(rate) !== null
    : mode === 'flat_monthly' ? parseMoneyInput(flat) !== null
      : parseMoneyInput(packTotal) !== null && parseMoneyInput(packPrice) !== null
  const requestedPlan = validPaidPlanMonths(new URLSearchParams(loc.search).get('plan')) ?? readPlanIntent()
  const afterOnboarding = requestedPlan
    ? `/app/settings/account?plan=${requestedPlan}`
    : '/app/today'

  const rows = useMemo(() => parseRoster(text), [text])
  const good = rows.filter((r) => !r.error)
  const badCount = rows.length - good.length

  const finish = () => {
    if (!priceOk || !promptpayOk) return
    const billing: BillingMode =
      mode === 'per_unit' ? { mode: 'per_unit', rate: parseMoneyInput(rate)! }
        : mode === 'flat_monthly' ? { mode: 'flat_monthly', amount: parseMoneyInput(flat)! }
          : { mode: 'package', total: parseMoneyInput(packTotal)!, price: parseMoneyInput(packPrice)!, purchasedAt: state.today }
    if (badCount > 0 && !confirmBadRows) { setConfirmBadRows(true); return }
    const issue = studentCapIssue(state, readPlanInfo(), good.length)
    if (issue) { setCapIssue(issue); return }
    if (!dispatch({
      type: 'finishOnboarding',
      provider: { name: name.trim() || state.provider.name, promptpayId: normalizedPromptpay ?? '', particle },
      rows: good.map(({ name: n, clientName, lineId }) => ({ name: n, clientName, lineId })),
      billing,
      ...(mode === 'package' ? { packageIntent } : {}),
    })) return
    track('onboarding_finish', { count: good.length })
    nav(afterOnboarding)
  }

  return (
    <div className="pane">
      <h1 className="h1">{step === 1 ? copy.onboarding.step1 : step === 2 ? copy.onboarding.step2 : copy.onboarding.step3}</h1>

      {step === 1 && (
        <>
          <label className="fld">
            <span className="fld__l">{copy.onboarding.providerName}</span>
            <input className="inp" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <span className="hint">{copy.onboarding.nameHint}</span>
          </label>
          <div className="fld" role="group" aria-label={copy.onboarding.particle}>
            <span className="fld__l">{copy.onboarding.particle}</span>
            <div className="chips">
              {PARTICLES.map((pt) => (
                <button key={pt} type="button" className={`chip${particle === pt ? ' chip--on' : ''}`} aria-pressed={particle === pt}
                  onClick={() => setParticle(pt)}>{pt}</button>
              ))}
            </div>
            <span className="hint">{copy.onboarding.particleHint.replace('{p}', particle ?? '…')}</span>
          </div>
          <label className="fld">
            <span className="fld__l">{copy.onboarding.promptpay}</span>
            <input className="inp" inputMode="numeric" value={pp} aria-invalid={promptpayError || undefined}
              aria-describedby={promptpayError ? 'promptpay-error' : 'promptpay-hint'}
              onChange={(e) => { setPp(e.target.value); setPromptpayError(false) }} />
            {promptpayError
              ? <span id="promptpay-error" className="fld__err">ใส่เบอร์มือถือไทย 10 หลัก หรือเลขบัตรประชาชน 13 หลักที่ถูกต้อง</span>
              : <span id="promptpay-hint" className="hint">{copy.onboarding.promptpayHint}</span>}
          </label>
          {pulling && <p className="hint" role="status" data-testid="onboarding-pulling">{copy.onboarding.cloudPulling}</p>}
          <button className="btn btn--primary btn--block" disabled={!name.trim() || !particle || pulling} onClick={() => {
            if (!promptpayOk) { setPromptpayError(true); return }
            setStep(2)
          }}>{copy.onboarding.next}</button>
        </>
      )}

      {step === 2 && (
        <>
          <label className="fld">
            <span className="fld__l">{copy.onboarding.pasteLabel}</span>
            <textarea className="inp inp--area" rows={7} value={text} placeholder={copy.onboarding.pasteHint}
              onChange={(e) => { setText(e.target.value); setConfirmBadRows(false) }} />
            <span className="hint">{copy.onboarding.pasteHint}</span>
          </label>

          {rows.length > 0 && (
            <>
              <h2 className="h2">{copy.onboarding.preview}</h2>
              <table className="tbl">
                <thead><tr><th>{v.subject}</th><th>{v.client}</th><th>LINE</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={r.error ? 'tr--bad' : ''}>
                      <td>{r.name}</td>
                      <td>{r.clientName || <span className="err">{copy.onboarding.parseError}: {r.error}</span>}</td>
                      <td className="dim">{r.lineId ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="fld">
            <span className="fld__l">{copy.onboarding.defaultMode}</span>
            <div className="chips">
              {(['per_unit', 'flat_monthly', 'package'] as BillingMode['mode'][]).map((m) => (
                <button key={m} className={`chip${mode === m ? ' chip--on' : ''}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
                  {copy.waitlist.modeLabels[m]}
                </button>
              ))}
            </div>
            <span className="hint">{fillVocab(copy.waitlist.modeHow[mode], prof.vocab)}</span>
          </div>

          {mode === 'per_unit' && (
            <label className="fld">
              <span className="fld__l">{copy.subjects.fieldRate}</span>
              <input className="inp" inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value)} />
            </label>
          )}
          {mode === 'flat_monthly' && (
            <label className="fld">
              <span className="fld__l">{copy.subjects.fieldFlat}</span>
              <input className="inp" inputMode="numeric" value={flat} onChange={(e) => setFlat(e.target.value)} />
            </label>
          )}
          {mode === 'package' && (
            <>
              <div className="fld" role="group" aria-label="ที่มาของสิทธิ์แพ็ก">
                <span className="fld__l">สิทธิ์แพ็กนี้มาจากไหน</span>
                <div className="chips">
                  <button type="button" className={`chip${packageIntent === 'opening_balance' ? ' chip--on' : ''}`}
                    aria-pressed={packageIntent === 'opening_balance'} onClick={() => setPackageIntent('opening_balance')}>ยอดยกมา ยังไม่บันทึกรับเงิน</button>
                  <button type="button" className={`chip${packageIntent === 'paid_purchase' ? ' chip--on' : ''}`}
                    aria-pressed={packageIntent === 'paid_purchase'} onClick={() => setPackageIntent('paid_purchase')}>รับเงินแล้ว ออกใบเสร็จ</button>
                </div>
              </div>
              <div className="fld2">
                <label className="fld">
                  <span className="fld__l">{copy.subjects.fieldPackTotal}</span>
                  <input className="inp" inputMode="numeric" value={packTotal} onChange={(e) => setPackTotal(e.target.value)} />
                </label>
                <label className="fld">
                  <span className="fld__l">{copy.subjects.fieldPackPrice}</span>
                  <input className="inp" inputMode="numeric" value={packPrice} onChange={(e) => setPackPrice(e.target.value)} />
                </label>
              </div>
            </>
          )}
          <span className="hint">{copy.subjects.priceHint}</span>

          {!priceOk && <span className="hint hint--bad" role="alert">{copy.common.numberPositive}</span>}
          {badCount > 0 && <p className="warnbar" role="alert">มี {badCount} แถวข้อมูลไม่ครบ ระบบจะไม่นำเข้าแถวเหล่านี้ กดอีกครั้งเพื่อยืนยัน</p>}
          <button className="btn btn--primary btn--block" disabled={good.length === 0 || !priceOk || !promptpayOk || pulling} onClick={finish}>
            {confirmBadRows && badCount > 0 ? `ยืนยันข้าม ${badCount} แถว` : copy.onboarding.finish} ({good.length})
          </button>
          {/* ครูที่ไม่มีลิสต์อยู่ในมือ ต้องออกไปเพิ่มทีละคนได้ ไม่ใช่ถูกขังหรือถูกพากลับเดโม */}
          <button className="linkbtn" onClick={() => {
            if (!promptpayOk) { setStep(1); setPromptpayError(true); return }
            if (!priceOk) return
            if (!dispatch({
              type: 'finishOnboarding',
              provider: { name: name.trim() || state.provider.name, promptpayId: normalizedPromptpay ?? '', particle },
              rows: [],
              billing: mode === 'per_unit' ? { mode: 'per_unit', rate: parseMoneyInput(rate)! }
                : mode === 'flat_monthly' ? { mode: 'flat_monthly', amount: parseMoneyInput(flat)! }
                  : { mode: 'package', total: parseMoneyInput(packTotal)!, price: parseMoneyInput(packPrice)!, purchasedAt: state.today },
              ...(mode === 'package' ? { packageIntent } : {}),
            })) return
            track('onboarding_skip'); nav(afterOnboarding === '/app/today' ? '/app/subjects' : afterOnboarding)
          }}>{copy.onboarding.skip}</button>
          <button className="linkbtn" onClick={() => setStep(1)}>{copy.common.back}แก้ข้อมูลผู้ให้บริการ</button>
          {state.mode !== 'real' && (
            <button className="linkbtn" onClick={() => { resetDemo('default'); nav('/app/today') }}>
              {copy.onboarding.useSample}
            </button>
          )}
        </>
      )}
      {capIssue && <PlanSheet issue={capIssue} onClose={() => setCapIssue(null)} />}
    </div>
  )
}
