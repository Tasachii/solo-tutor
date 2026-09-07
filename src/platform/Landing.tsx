import { useState } from 'react'
import { Link } from 'react-router-dom'
import { professions } from '../professions'
import { copy } from '../copy'
import { DemoBadge, Icon, Mascot, PenguinMark } from '../app/components'
import { AppearanceButton, ThemeToggle } from './ThemeToggle'
import WaitlistSheet from './WaitlistSheet'
import { dateThai, dayThai, periodThai, todayISO } from '../core/format'
import { periodBack } from '../mock/seed'

/**
 * หน้าแรกเป็นของคนที่จะใช้แอปจริง ไม่ใช่ของคนที่มาตัดสิน
 * โฉม Navy: พาดหัวไล่สี + กองการ์ดตัวอย่างหลายอาชีพ — ตัวเลขในการ์ดเป็นภาพประกอบ ไม่ใช่ข้อมูลจริง
 */
export default function Landing() {
  const [lead, setLead] = useState<string | null>(null)
  const soon = professions.filter((p) => p.status !== 'live')
  const h = copy.landing.hero
  // การ์ดตัวอย่างเดินตามปฏิทินเหมือนตัวแอป ไม่งั้นหน้าแรกจะโชว์วันของปีที่แล้ว
  const today = todayISO()
  const fill = (text: string): string => text
    .replace('{day}', dayThai(today))
    .replace('{date}', dateThai(today))
    .replace('{month}', dateThai(today).split(' ')[1])
    .replace('{lastMonth}', periodThai(periodBack(1)).split(' ')[0])

  return (
    <div className="land">
      <header className="land__hero">
        <div className="land__bar">
          <b className="land__brand"><PenguinMark size={34} />{copy.brand.name}</b>
          <span className="land__tools"><DemoBadge /><ThemeToggle /><AppearanceButton /></span>
        </div>
        <div>
          <p className="land__money"><Icon name="shield" size={16} />{copy.landing.moneyLine}</p>
          <h1 className="land__h1">{copy.landing.h1a}<br /><span className="land__grad">{copy.landing.h1b}</span></h1>
          <p className="land__sub">{copy.landing.sub}</p>
          <div className="land__cta">
            <Link className="btn btn--primary" to="/start">{copy.landing.ctaPrimary} <Icon name="arrow" size={18} /></Link>
            <Link className="btn btn--ghost" to="/pricing">{copy.landing.ctaSecondary}</Link>
          </div>
          <div className="land__proof">
            {copy.landing.proof.map((p) => <span key={p}><Icon name="check" size={16} />{p}</span>)}
          </div>
        </div>

        <div className="hero__stack" aria-hidden="true">
          <div className="hcard hcard--today">
            <div className="hcard__hd"><b>{h.todayTitle}</b><span>{fill(h.todayDate)}</span></div>
            <div className="hcard__stats">
              <div className="stat stat--brand"><span className="stat__l">วันนี้</span><b className="stat__v num">4</b></div>
              <div className="stat stat--ok"><span className="stat__l">เสร็จ</span><b className="stat__v num">1</b></div>
              <div className="stat stat--warn"><span className="stat__l">รอ</span><b className="stat__v num">3</b></div>
            </div>
            {h.rows.map((r, i) => (
              <div className="hcard__row" key={r.name}>
                <span className="hcard__time num">{r.time}</span>
                <span className="hcard__who"><b>{r.name}</b><span>{r.meta}</span></span>
                <span className={`hcard__go${i ? ' hcard__go--alt' : ''}`}>{r.act}</span>
              </div>
            ))}
          </div>
          <div className="hcard hcard--gauge">
            <svg className="gauge" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="50" fill="none" stroke="var(--line)" strokeWidth="10" />
              <circle cx="60" cy="60" r="50" fill="none" stroke="var(--brand)" strokeWidth="10" strokeLinecap="round"
                strokeDasharray="314" strokeDashoffset="63" transform="rotate(-90 60 60)" />
              <text x="60" y="58" textAnchor="middle" fill="var(--ink)" fontSize="24" fontWeight="800">8/10</text>
              <text x="60" y="76" textAnchor="middle" fill="var(--muted)" fontSize="11">{h.gaugeUsed}</text>
            </svg>
            <span className="gauge__t">{h.gaugeT}</span><span className="gauge__s">{h.gaugeS}</span>
          </div>
          <div className="hcard hcard--bill">
            <div className="hcard__hd"><span>{fill(h.billTitle)}</span><span>{h.billWho}</span></div>
            <div className="hcard__amt num">{h.billAmt} <small>{copy.common.baht}</small></div>
            <div className="hcard__pills"><span>{h.billLine}</span><span className="on-ink">{h.billOk}</span></div>
          </div>
          <div className="hcard hcard--msg">
            <div className="hcard__hd"><span className="tagk tagk--reminder">{h.msgTag}</span><span>{h.msgHint}</span></div>
            <p className="hcard__msg">{fill(h.msg)}</p>
            <div className="hcard__acts">
              <span className="btn btn--primary"><Icon name="send" size={16} />{h.msgSend}</span>
              <span className="btn btn--secondary">{h.msgEdit}</span>
            </div>
          </div>
        </div>
      </header>

      <section className="land__sec" aria-labelledby="sec-admin">
        <h2 className="land__h2" id="sec-admin">{copy.landing.adminTitle}</h2>
        <ol className="land__steps">
          {copy.landing.adminSteps.map((s, i) => (
            <li key={s.h}>
              <span className="land__num num" aria-hidden="true">{i + 1}</span>
              <div><b>{s.h}</b><span>{s.p}</span></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="land__sec land__sec--cta">
        <Mascot />
        <Link className="btn btn--primary" to="/start">{copy.landing.tryNow}</Link>
      </section>

      {/* อาชีพอื่นยังเปิดไม่ได้ จึงไม่ใช่ "ตัวเลือก" — บอกให้รู้ว่ากำลังมา ก็พอ */}
      <p className="soonline">
        <span className="soonline__l">{copy.landing.comingSoon}</span>
        {soon.map((p) => (
          <span key={p.id} className="soonline__i">
            <span aria-hidden="true">{p.icon}</span> {p.name}
          </span>
        ))}
        <button className="soonline__b" onClick={() => setLead(soon[0]?.id)}>
          {copy.landing.notifyMe}
        </button>
      </p>

      <footer className="land__foot">
        <span>{copy.brand.name} · {copy.brand.tagline}</span>
        <span>{copy.landing.footerTeam}</span>
        <Link to="/pricing">{copy.pricing.title}</Link>
      </footer>

      {lead !== null && (
        <WaitlistSheet preselect={lead || undefined} onClose={() => setLead(null)} />
      )}
    </div>
  )
}
