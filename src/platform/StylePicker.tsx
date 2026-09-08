import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../core/store'
import { professionById, fillVocab } from '../professions'
import { copy } from '../copy'
import { STYLES, scenarioForStyle } from '../core/style'
import type { WorkStyle } from '../core/types'
import { DemoBadge, PenguinMark } from '../app/components'
import { AppearanceButton, ThemeToggle } from './ThemeToggle'
import { rememberPlanIntent, validPaidPlanMonths } from './plans'

/**
 * หน้าแรกก่อนเข้าใช้ — เลือกว่าเก็บเงินแบบไหน แตะเดียวเข้าแอป
 * เดโม: สลับชุดข้อมูลให้ตรงแบบ · ใช้จริง: เปลี่ยนแค่ค่าเริ่มต้นและตัวกรอง ข้อมูลอยู่ครบ
 * คำศัพท์ (ครั้ง/คาบ/ลูกค้า) มาจากอาชีพ — หน้านี้ไม่รู้ว่าผู้ใช้เป็นครู
 */
export default function StylePicker() {
  const { state, dispatch, resetDemo, track } = useStore()
  const nav = useNavigate()
  const loc = useLocation()
  const v = professionById(state.professionId).vocab
  const real = state.mode === 'real'
  const fill = (t: string) => fillVocab(t, v)
  const paidPlan = validPaidPlanMonths(new URLSearchParams(loc.search).get('plan'))

  const pick = (style: WorkStyle) => {
    if (real) dispatch({ type: 'setStyle', style })
    else resetDemo(scenarioForStyle[style])
    rememberPlanIntent(paidPlan)
    track(`style_${style}`)
    nav(real && paidPlan ? `/app/settings/account?plan=${paidPlan}` : '/app/today')
  }

  return (
    <div className="land start">
      <header className="land__hero land__hero--sm">
        <div className="land__bar">
          <Link className="land__brand" to="/">‹ <PenguinMark size={28} />{copy.brand.name}</Link>
          <span className="land__tools">{!real && <DemoBadge />}<ThemeToggle /><AppearanceButton /></span>
        </div>
        <h1 className="land__h1">{copy.start.title}</h1>
        <p className="land__sub">{real ? copy.start.realNote : copy.start.sub}</p>
      </header>

      <div className="picks">
        {STYLES.map((st) => {
          const c = copy.start.cards[st]
          const on = state.style === st
          return (
            // ปุ่มรับได้แค่ phrasing content — ไม่มี ul/li ข้างใน ไม่งั้นชื่อปุ่มอ่านไม่ออกและ HTML ไม่ valid
            <button key={st} type="button" className={`pick${on ? ' pick--on' : ''}`} aria-pressed={on}
              aria-label={`${copy.start.pick} ${c.t}${on ? ` (${copy.start.current})` : ''}`} onClick={() => pick(st)}>
              <span className="pick__t">{c.t}{on && <i className="pick__now">{copy.start.current}</i>}</span>
              <span className="pick__s">{fill(c.s)}</span>
              <span className="pick__b">{c.b.map((b) => <span key={b}>{fill(b)}</span>)}</span>
              <span className="pick__go">{copy.start.pick} ›</span>
            </button>
          )
        })}
      </div>
      <p className="hint start__note">{copy.start.placeNote}</p>
    </div>
  )
}
