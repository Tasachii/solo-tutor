import { useState } from 'react'
import { Link } from 'react-router-dom'
import { copy } from '../copy'
import { money } from '../core/format'
import { DemoBadge, PenguinMark } from '../app/components'
import WaitlistSheet from './WaitlistSheet'
import { AppearanceButton, ThemeToggle } from './ThemeToggle'

/** ตัวเลขราคาอยู่ที่นี่ ข้อความอยู่ใน copy — ดัชนีตรงกับ copy.pricing.plans (แผนธุรกิจ rev.2) */
const PRICES: number[] = [0, 299, 799, 2490]
/** กี่เดือนต่อหนึ่งรอบบิล — ใช้หารหาค่าเฉลี่ย ไม่มีตัวเลขไหนพิมพ์ไว้ในข้อความ */
const MONTHS: number[] = [0, 1, 3, 12]
const HIGHLIGHT = 1
const MONTHLY = 1

/** ค่าเฉลี่ยต่อเดือนและส่วนต่างจากการจ่ายรายเดือน — คำนวณจาก PRICES เสมอ */
export function planSavings(i: number): { perMonth: number; saves: number } | null {
  if (MONTHS[i] <= 1) return null
  return {
    perMonth: Math.round(PRICES[i] / MONTHS[i]),
    saves: PRICES[MONTHLY] * MONTHS[i] - PRICES[i],
  }
}

export default function Pricing() {
  const [lead, setLead] = useState(false)
  const priceOf = (i: number): string => PRICES[i] === 0 ? copy.pricing.free : `${money(PRICES[i])} ${copy.common.baht}`

  return (
    <div className="land">
      <header className="land__hero land__hero--sm">
        <div className="land__bar">
          <Link className="backlink" to="/">‹ <PenguinMark size={28} />{copy.brand.name}</Link>
          <span className="land__tools"><DemoBadge /><ThemeToggle /><AppearanceButton /></span>
        </div>
        <h1 className="land__h1">{copy.pricing.title}</h1>
        <p className="land__sub">{copy.pricing.sub}</p>
      </header>

      <section className="land__sec">
        <ul className="plans plans--4">
          {copy.pricing.plans.map((p, i) => (
            <li key={p.name} className={`plan${i === HIGHLIGHT ? ' plan--hi' : ''}`}>
              <b className="plan__name">{p.name}</b>
              <div className="plan__price">
                <span className="plan__amt num">{priceOf(i)}</span>
                <span className="plan__unit">{p.unit}</span>
              </div>
              {(() => {
                const s = planSavings(i)
                return s && (
                  <p className="plan__save">
                    <span>{copy.pricing.perMonth.replace('{n}', money(s.perMonth))}</span>
                    {s.saves > 0 && <b>{copy.pricing.saves.replace('{n}', money(s.saves))}</b>}
                  </p>
                )
              })()}
              <p className="plan__desc">{p.desc}</p>
              <ul className="plan__feats">
                {p.features.map((f) => <li key={f}>{f}</li>)}
              </ul>
              {/* ทุกแพ็กเข้าไปลองได้เลย ไม่มีฟอร์มมาขวาง */}
              <Link className={`btn plan__cta ${i === HIGHLIGHT ? 'btn--primary' : 'btn--ghost'}`} to="/start">{p.cta}</Link>
            </li>
          ))}
        </ul>

        {/* บริการตั้งระบบให้ — ไม่ใช่แพลนขาย เป็นเครื่องมือเรียนรู้ onboarding กับ 10 คนแรก */}
        <div className="promo">
          <div><b className="promo__t">{copy.pricing.promo.t}</b><p className="promo__s">{copy.pricing.promo.s}</p></div>
          <button className="btn btn--secondary" onClick={() => setLead(true)}>{copy.pricing.promo.cta}</button>
        </div>

        <ul className="land__notes">
          {copy.pricing.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </section>

      <section className="land__sec" aria-labelledby="sec-faq">
        <h2 className="land__h2" id="sec-faq">{copy.pricing.faqTitle}</h2>
        <ul className="qa">
          {copy.pricing.faq.map((f) => (
            <li key={f.q}>
              <details>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            </li>
          ))}
        </ul>
      </section>

      <footer className="land__foot">
        <Link to="/">{copy.brand.name}</Link>
        <span>{copy.landing.footerTeam}</span>
        <Link to="/privacy">{copy.legal.footerPrivacy}</Link>
        <Link to="/terms">{copy.legal.footerTerms}</Link>
      </footer>

      {lead && <WaitlistSheet onClose={() => setLead(false)} />}
    </div>
  )
}
