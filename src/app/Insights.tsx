import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { copy } from '../copy'
import { money } from '../core/format'
import {
  CAMPAIGN_FILTERS, DEFAULT_OWNER_FILTERS, OWNER_RANGES,
  fetchOwnerAnalytics, ownerFailure,
  type MetricValue, type OwnerAnalytics, type OwnerFailure, type OwnerFilters,
} from '../core/ownerMetrics'

/**
 * P09 · หน้าเดียวที่ตอบว่า "มีคนเข้าเว็บ ลองเดโม สมัคร และจ่ายเงินกี่คน"
 *
 * หน้านี้ไม่ได้กันสิทธิ์ด้วยตัวเอง และไม่ควรกัน — ฐานข้อมูลปฏิเสธคนที่ไม่ใช่เจ้าของเสมอ
 * (public.owner_analytics ใน 0016_owner_analytics.sql) ที่นี่ทำแค่แปลคำปฏิเสธเป็นภาษาคน
 * ครูทั่วไปที่พิมพ์ที่อยู่หน้านี้เองจึงเห็นข้อความว่าเปิดไม่ได้ ไม่ใช่เห็นตัวเลขของทั้งบริษัท
 *
 * ทุกตัวเลขมีนิยามและข้อจำกัดพิมพ์ไว้ใต้ตัวเลข ไม่ใช่ท้ายหน้า เพราะคนที่หยิบตัวเลขไปพูดต่อ
 * มักเห็นแค่ตัวเลข · ค่าที่อ่านไม่ได้ขึ้นว่า "ไม่มีข้อมูล" ไม่ใช่ 0 เพื่อไม่ให้ปนกับศูนย์จริง
 */

const i = copy.insights

function Metric({ label, value, definition, tone }: {
  label: string; value: MetricValue; definition: string; tone?: 'brand' | 'ok' | 'warn'
}) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ''}`}>
      <span className="stat__l">{label}</span>
      <b className="stat__v num">{value === null ? i.noValue : money(value)}</b>
      <span className="hint">{definition}</span>
    </div>
  )
}

const sourceLabel = (source: string): string =>
  (i.sources as Record<string, string | undefined>)[source] ?? source

const failureText = (failure: OwnerFailure): string =>
  failure === 'denied' ? i.denied
    : failure === 'signed-out' ? i.signedOut
      : failure === 'not-configured' ? i.notConfigured : i.failed

export default function Insights() {
  const [filters, setFilters] = useState<OwnerFilters>(DEFAULT_OWNER_FILTERS)
  const [data, setData] = useState<OwnerAnalytics | null>(null)
  const [failure, setFailure] = useState<OwnerFailure | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setLoading(true)
    fetchOwnerAnalytics(filters)
      .then((next) => { if (live) { setData(next); setFailure(null) } })
      // ตัวเลขชุดเก่าค้างอยู่บนจอพร้อมตัวกรองใหม่ = โกหกผู้อ่าน จึงล้างทิ้งเมื่ออ่านไม่สำเร็จ
      .catch((error: unknown) => { if (live) { setData(null); setFailure(ownerFailure(error)) } })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [filters, attempt])

  const set = <K extends keyof OwnerFilters>(key: K, value: OwnerFilters[K]): void =>
    setFilters((current) => ({ ...current, [key]: value }))

  return (
    <div className="pane">
      <div className="rowhead">
        <h1 className="h1">{i.title}</h1>
        <Link to="/">{copy.common.back}</Link>
      </div>
      <p>{i.sub}</p>

      <section className="card">
        <label className="fld">
          <span className="fld__l">{i.filters.range}</span>
          <select value={filters.days} onChange={(e) => set('days', Number(e.target.value))}>
            {OWNER_RANGES.map((days) => (
              <option key={days} value={days}>{i.filters.rangeDays.replace('{n}', String(days))}</option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span className="fld__l">{i.filters.audience}</span>
          <select value={filters.audience}
            onChange={(e) => set('audience', e.target.value as OwnerFilters['audience'])}>
            <option value="public">{i.filters.audiences.public}</option>
            <option value="team">{i.filters.audiences.team}</option>
            <option value="all">{i.filters.audiences.all}</option>
          </select>
        </label>
        <label className="fld">
          <span className="fld__l">{i.filters.mode}</span>
          <select value={filters.mode} onChange={(e) => set('mode', e.target.value as OwnerFilters['mode'])}>
            <option value="all">{i.filters.modes.all}</option>
            <option value="demo">{i.filters.modes.demo}</option>
            <option value="real">{i.filters.modes.real}</option>
          </select>
        </label>
        <label className="fld">
          <span className="fld__l">{i.filters.campaign}</span>
          <select value={filters.campaign} onChange={(e) => set('campaign', e.target.value)}>
            {CAMPAIGN_FILTERS.map((source) => (
              <option key={source} value={source}>{i.sources[source]}</option>
            ))}
          </select>
        </label>
      </section>

      {loading && <p role="status" aria-live="polite" aria-busy="true">{i.loading}</p>}

      {failure && !loading && (
        <section className="card">
          <p className="warnbar" role="status">{failureText(failure)}</p>
          <button className="btn btn--secondary" onClick={() => setAttempt((n) => n + 1)}>{i.retry}</button>
        </section>
      )}

      {data && !failure && (
        <>
          <p className="hint">
            {i.coverage}: {data.from ?? i.noValue} – {data.to ?? i.noValue}
            {' · '}{i.updatedAt}: {data.generatedAt ?? i.noValue}
          </p>

          <section className="card">
            <h2 className="h2">{i.traffic.title}</h2>
            <div className="stats">
              <Metric label={i.traffic.visitors.l} value={data.traffic.visitors} definition={i.traffic.visitors.d} tone="brand" />
              <Metric label={i.traffic.sessions.l} value={data.traffic.sessions} definition={i.traffic.sessions.d} />
              <Metric label={i.traffic.landing.l} value={data.traffic.landingViews} definition={i.traffic.landing.d} />
              <Metric label={i.traffic.pricing.l} value={data.traffic.pricingViews} definition={i.traffic.pricing.d} />
            </div>
            <p className="hint">{i.traffic.modeNote}</p>
            <p className="hint">{i.retentionNote}</p>
          </section>

          <section className="card">
            <h2 className="h2">{i.demo.title}</h2>
            <div className="stats">
              <Metric label={i.demo.started.l} value={data.demo.started} definition={i.demo.started.d} />
              <Metric label={i.demo.completed.l} value={data.demo.completed} definition={i.demo.completed.d} tone="ok" />
            </div>
          </section>

          <section className="card">
            <h2 className="h2">{i.accounts.title}</h2>
            <div className="stats">
              <Metric label={i.accounts.started.l} value={data.accounts.signupStarted} definition={i.accounts.started.d} />
              <Metric label={i.accounts.completed.l} value={data.accounts.signupCompleted} definition={i.accounts.completed.d} />
              <Metric label={i.accounts.verified.l} value={data.accounts.emailVerified} definition={i.accounts.verified.d} />
              <Metric label={i.accounts.onboarded.l} value={data.accounts.onboardingCompleted} definition={i.accounts.onboarded.d} />
            </div>
          </section>

          <section className="card">
            <h2 className="h2">{i.teachers.title}</h2>
            <div className="stats">
              <Metric label={i.teachers.opened.l} value={data.teachers.openedApp} definition={i.teachers.opened.d} />
              <Metric label={i.teachers.activated.l} value={data.teachers.activated} definition={i.teachers.activated.d} tone="ok" />
              <Metric label={i.teachers.returning.l} value={data.teachers.returning} definition={i.teachers.returning.d} />
            </div>
            <p className="hint">{i.teachers.note}</p>
          </section>

          <section className="card">
            <h2 className="h2">{i.money.title}</h2>
            <div className="stats">
              <Metric label={i.money.pending.l} value={data.money.pendingRequests} definition={i.money.pending.d} tone="warn" />
              <Metric label={i.money.requested.l} value={data.money.proRequested} definition={i.money.requested.d} />
              <Metric label={i.money.customers.l} value={data.money.payingCustomers} definition={i.money.customers.d} tone="ok" />
              <Metric label={i.money.payments.l} value={data.money.verifiedPayments} definition={i.money.payments.d} />
              <Metric label={i.money.gross.l} value={data.money.grossBaht} definition={i.money.gross.d} />
              <Metric label={i.money.refund.l} value={data.money.refundBaht} definition={i.money.refund.d} />
              <Metric label={i.money.net.l} value={data.money.netBaht} definition={i.money.net.d} tone="brand" />
            </div>
            <p className="hint">{i.money.note}</p>
          </section>

          <section className="card">
            <h2 className="h2">{i.sourcesTable.title}</h2>
            {data.campaigns.length === 0 ? <p>{i.sourcesTable.empty}</p> : (
              <div className="tblwrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{i.sourcesTable.source}</th><th>{i.sourcesTable.visitors}</th>
                      <th>{i.sourcesTable.sessions}</th><th>{i.sourcesTable.pageviews}</th>
                      <th>{i.sourcesTable.signups}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.campaigns.map((row) => (
                      <tr key={row.source}>
                        <td>{sourceLabel(row.source)}</td>
                        <td className="num">{row.visitors === null ? i.noValue : money(row.visitors)}</td>
                        <td className="num">{row.sessions === null ? i.noValue : money(row.sessions)}</td>
                        <td className="num">{row.pageviews === null ? i.noValue : money(row.pageviews)}</td>
                        <td className="num">{row.signupStarted === null ? i.noValue : money(row.signupStarted)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="hint">{i.sourcesTable.note}</p>
          </section>

          <section className="card">
            <h2 className="h2">{i.renewal.title}</h2>
            {data.renewal.length === 0 ? <p>{i.renewal.empty}</p> : (
              <div className="tblwrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{i.renewal.cohort}</th><th>{i.renewal.payers}</th>
                      <th>{i.renewal.renewed}</th><th>{i.renewal.percent}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.renewal.map((row) => (
                      <tr key={row.cohortMonth}>
                        <td>{row.cohortMonth}</td>
                        <td className="num">{row.firstMonthPayers === null ? i.noValue : money(row.firstMonthPayers)}</td>
                        <td className="num">{row.renewedMonth2 === null ? i.noValue : money(row.renewedMonth2)}</td>
                        <td className="num">{row.percent === null ? i.noValue : `${row.percent}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="hint">{i.renewal.note}</p>
          </section>
        </>
      )}
    </div>
  )
}
