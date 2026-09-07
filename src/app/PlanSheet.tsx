import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { copy } from '../copy'
import { money } from '../core/format'
import type { CapIssue } from '../core/plan'
import { PLANS } from '../platform/plans'
import { BottomSheet } from './components'

/**
 * ชนเพดานฟรี — บอกตรง ๆ ว่าติดอะไร มีกี่คน เพิ่มได้อีกกี่คน แล้วพาไปหน้าบัญชีเพื่อขอเปิด Pro
 * ไม่มีการจ่ายเงินในชีทนี้: Solo ไม่ถือเงิน ทีมเปิดให้หลังเห็นยอดโอน
 */
export function PlanSheet({ issue, onClose }: { issue: CapIssue; onClose: () => void }) {
  const nav = useNavigate()
  const [pick, setPick] = useState(1)
  const p = copy.plan
  const room = Math.max(0, issue.cap - issue.have)
  return (
    <BottomSheet title={p.capTitle} sub={p.capSub.replace('{have}', String(issue.have)).replace('{cap}', String(issue.cap))} onClose={onClose}
      footer={<button className="btn btn--primary btn--block" onClick={() => { onClose(); nav(`/app/settings/account?plan=${PLANS[pick].months}`) }}>{p.goUpgrade}</button>}>
      <p>{room > 0 ? p.capRoom.replace('{room}', String(room)).replace('{adding}', String(issue.adding)) : p.capFull}</p>
      <div className="seg" role="radiogroup" aria-label={p.pickPlan}>
        {PLANS.map((plan, i) => plan.months > 0 && (
          <button key={plan.months} role="radio" aria-checked={pick === i} className={`seg__b${pick === i ? ' seg__b--on' : ''}`} onClick={() => setPick(i)}>
            {copy.pricing.plans[i].name.replace('Pro ', '')} · {money(plan.price)}
          </button>
        ))}
      </div>
      <p className="hint">{p.capHint}</p>
    </BottomSheet>
  )
}
