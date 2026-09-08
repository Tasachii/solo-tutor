import { Link } from 'react-router-dom'
import { copy } from '../copy'
import { SUPPORT_CONTACT } from '../platform/config'

const supportHref = (): string => {
  if (!SUPPORT_CONTACT) return ''
  if (SUPPORT_CONTACT.startsWith('https://')) return SUPPORT_CONTACT
  if (SUPPORT_CONTACT.startsWith('@')) return `https://line.me/R/ti/p/${encodeURIComponent(SUPPORT_CONTACT)}`
  return `mailto:${SUPPORT_CONTACT}`
}

export default function Help() {
  const h = copy.help
  const href = supportHref()
  const guideHref = `${import.meta.env.BASE_URL}solo-tutor-guide.pdf`
  return <div className="pane">
    <div className="rowhead"><h1 className="h1">{h.title}</h1><Link to="/app/today">{copy.common.back}</Link></div>
    <p>{h.intro}</p>
    <p><a className="btn btn--ghost btn--sm" href={guideHref} download>{h.downloadGuide}</a></p>
    {h.sections.map((section) => <section className="card" key={section.title}>
      <h2 className="h2">{section.title}</h2>
      <ol>{section.steps.map((step) => <li key={step}>{step}</li>)}</ol>
    </section>)}
    <section className="card">
      <h2 className="h2">{h.supportTitle}</h2>
      {href
        ? <a className="btn btn--secondary" href={href} target={href.startsWith('https://') ? '_blank' : undefined} rel="noreferrer">{h.supportCta}</a>
        : <p className="warnbar" role="status">{h.supportMissing}</p>}
    </section>
    <p className="hint"><Link to="/privacy">{copy.legal.footerPrivacy}</Link>{' · '}<Link to="/terms">{copy.legal.footerTerms}</Link></p>
  </div>
}
