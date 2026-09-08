import { Link } from 'react-router-dom'
import { copy } from '../copy'
import { DemoBadge, PenguinMark } from '../app/components'
import { AppearanceButton, ThemeToggle } from './ThemeToggle'
import { PROVIDER_LEGAL_NAME, SUPPORT_CONTACT } from './config'

/** นโยบายข้อมูลและข้อกำหนด — เขียนตามที่แอปทำจริง ไม่ใช่แบบฟอร์มกฎหมายลอกมา */
export default function Legal({ kind }: { kind: 'privacy' | 'terms' }) {
  const l = copy.legal
  const sections = kind === 'privacy' ? l.privacy : l.terms
  return (
    <div className="land">
      <header className="land__hero land__hero--sm">
        <div className="land__bar">
          <Link className="backlink" to="/">‹ <PenguinMark size={28} />{copy.brand.name}</Link>
          <span className="land__tools"><DemoBadge /><ThemeToggle /><AppearanceButton /></span>
        </div>
        <h1 className="land__h1">{kind === 'privacy' ? l.privacyTitle : l.termsTitle}</h1>
        <p className="land__sub">{l.updated}</p>
      </header>
      <section className="land__sec legal">
        {sections.map((s) => (
          <article key={s.h} className="legal__sec">
            <h2 className="land__h2">{s.h}</h2>
            <p>{s.p}</p>
          </article>
        ))}
        {PROVIDER_LEGAL_NAME && <p className="hint">{l.ownerLabel}: {PROVIDER_LEGAL_NAME}</p>}
        {SUPPORT_CONTACT
          ? <p className="hint">{l.contactLabel}: <a href={SUPPORT_CONTACT.startsWith('https://') ? SUPPORT_CONTACT
            : SUPPORT_CONTACT.startsWith('@') ? `https://line.me/R/ti/p/${encodeURIComponent(SUPPORT_CONTACT)}` : `mailto:${SUPPORT_CONTACT}`}
            target="_blank" rel="noreferrer">{SUPPORT_CONTACT}</a></p>
          : <p className="warnbar" role="alert">{l.contactMissing}</p>}
        <p className="hint">{l.reviewPending}</p>
        <p className="legal__x">
          <Link to={kind === 'privacy' ? '/terms' : '/privacy'}>{kind === 'privacy' ? l.termsTitle : l.privacyTitle}</Link>
          {' · '}<Link to="/pricing">{copy.pricing.title}</Link>
        </p>
      </section>
      <footer className="land__foot">
        <Link to="/">{copy.brand.name}</Link>
        <span>{copy.landing.footerTeam}</span>
      </footer>
    </div>
  )
}
