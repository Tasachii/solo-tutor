import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../core/store'
import { professionById } from '../professions'
import { copy } from '../copy'
import { clientById, courseProgress, packageStatus } from '../core/ledger'
import { overdueDaysBySubject } from '../core/selectors'
import { currentEstimate } from '../core/messages'
import { money, periodOf } from '../core/format'
import { modeThai } from '../copy/tutor'
import { Chip, EmptyState, ProgressBar, Skeleton } from './components'
import SubjectSheet from './SubjectSheet'
import { ImportSheet } from './ImportSheet'
import { modesFor } from '../core/style'
import { keptForRecords } from '../core/tombstones'
import type { BillingMode } from '../core/types'

const fill = (text: string, vars: Record<string, string | number>): string =>
  text.replace(/\{(\w+)\}/g, (_m, key: string) => String(vars[key] ?? ''))

type Filter = 'all' | 'per_unit' | 'flat_monthly' | 'package' | 'lowpack' | 'overdue'

export default function Subjects() {
  const { state, hydrated } = useStore()
  const prof = professionById(state.professionId)
  const v = prof.vocab
  const nav = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [addingMany, setAddingMany] = useState(false)
  const period = periodOf(state.today)

  const active = state.subjects.filter((s) => s.active)
  const inactive = state.subjects.filter((s) => !s.active)

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: active.length, per_unit: 0, flat_monthly: 0, package: 0, lowpack: 0, overdue: 0 }
    for (const s of active) {
      c[s.billing.mode] += 1
      const pk = packageStatus(state, s)
      if (pk && pk.state !== 'ok') c.lowpack += 1
      if (overdueDaysBySubject(state, s.id) > 0) c.overdue += 1
    }
    return c
  }, [state, active])

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    return active.filter((s) => {
      const pk = packageStatus(state, s)
      if (filter === 'lowpack' && !(pk && pk.state !== 'ok')) return false
      if (filter === 'overdue' && overdueDaysBySubject(state, s.id) === 0) return false
      if (['per_unit', 'flat_monthly', 'package'].includes(filter) && s.billing.mode !== filter) return false
      if (!n) return true
      const c = clientById(state, s.clientId)
      return `${s.name} ${c?.name ?? ''}`.toLowerCase().includes(n)
    })
  }, [state, active, filter, q])

  if (!hydrated) return <div className="pane"><Skeleton rows={5} /></div>

  if (state.subjects.length === 0) {
    return (
      <div className="pane">
        <EmptyState icon="👋" title={`${copy.subjects.emptyTitle}`}
          action={
            <div className="btnrow">
              <button className="btn btn--primary" onClick={() => setAdding(true)}>{copy.subjects.addOneByOne}</button>
              <button className="btn btn--secondary" onClick={() => setAddingMany(true)}>{copy.subjects.addMany}</button>
            </div>
          } />
        {adding && <SubjectSheet onClose={() => setAdding(false)} />}
        {addingMany && <ImportSheet onClose={() => setAddingMany(false)} />}
      </div>
    )
  }

  // ตัวกรองวิธีเก็บเงินโชว์เฉพาะแบบที่มีอยู่จริง (แบบหลักที่เลือก + แบบที่ลูกค้าบางคนใช้อยู่)
  const modes = new Set<BillingMode['mode']>([...modesFor(state.style), ...active.map((s) => s.billing.mode)])
  const ALL_FILTERS: { id: Filter; label: string }[] = [
    { id: 'all', label: copy.subjects.filters.all },
    { id: 'per_unit', label: copy.subjects.filters.per_unit },
    { id: 'flat_monthly', label: copy.subjects.filters.flat_monthly },
    { id: 'package', label: copy.subjects.filters.package },
    { id: 'lowpack', label: copy.subjects.filters.lowpack },
    { id: 'overdue', label: copy.subjects.filters.overdue },
  ]
  const FILTERS = ALL_FILTERS.filter((f) => f.id === 'all' || f.id === 'overdue'
    || (f.id === 'lowpack' ? modes.has('package') : modes.has(f.id)))

  return (
    <div className="pane">
      <div className="rowhead">
        <h1 className="h1">{v.subjects} {active.length}</h1>
        <span className="btnrow btnrow--tight">
          <button className="btn btn--secondary btn--sm" onClick={() => setAddingMany(true)}>{copy.subjects.addMany}</button>
          <button className="btn btn--primary btn--sm" onClick={() => setAdding(true)}>+ {copy.subjects.add}</button>
        </span>
      </div>

      <div className="chips">
        {FILTERS.map((f) => (
          <Chip key={f.id} label={f.label} count={counts[f.id]} on={filter === f.id} onClick={() => setFilter(f.id)} />
        ))}
      </div>
      <input className="inp inp--search" type="search" value={q} placeholder={copy.subjects.search}
        aria-label={copy.subjects.search} onChange={(e) => setQ(e.target.value)} />

      <ul className="rows">
        {shown.map((s) => {
          const pk = packageStatus(state, s)
          const course = courseProgress(state, s)
          const od = overdueDaysBySubject(state, s.id)
          const c = clientById(state, s.clientId)
          const tone = pk ? (pk.state === 'ok' ? 'ok' : pk.state === 'low' ? 'warn' : 'danger') : 'ok'
          return (
            <li key={s.id}>
              <button className="srow" onClick={() => nav(`/app/subjects/${s.id}`)}>
                <span className="srow__main">
                  <span className="srow__name">{s.name}
                    {od > 0 && <i className="badge badge--danger">ค้าง {od} วัน</i>}
                    {/* ครบคอร์สแล้วต้องเห็นตั้งแต่รายชื่อ ครูจะได้รู้ว่าต้องคุยเรื่องต่อคอร์สกับใคร */}
                    {course?.state === 'done' && <i className="badge badge--warn">{copy.course.doneTag}</i>}</span>
                  <span className="srow__meta">
                    {c?.name} · {modeThai(s.billing.mode)}
                    {s.billing.mode === 'per_unit' && ` ${money(s.billing.rate)}`}
                    {s.billing.mode === 'flat_monthly' && ` ${money(s.billing.amount)}`}
                    {pk && ` ${pk.used}/${pk.total}`}
                    {course && ` · ${fill(copy.course.short, { done: course.done, total: course.total })}`}
                  </span>
                  {pk && <ProgressBar value={pk.used} max={pk.total} tone={tone} />}
                  {course && <ProgressBar value={course.done} max={course.total}
                    tone={course.state === 'ok' ? 'ok' : 'warn'} />}
                </span>
                {/* เดิมเป็นตัวเลขเปล่า ๆ ที่หมายถึงคนละอย่างในแต่ละแถว */}
                <span className="srow__side">
                  <b className="num">{pk ? money(pk.price) : money(currentEstimate(state, s, period))}</b>
                  <i className="srow__unit">
                    {pk ? copy.subjects.unitPack
                      : s.billing.mode === 'per_unit' ? copy.subjects.unitPer
                        : s.billing.mode === 'flat_monthly' ? copy.subjects.unitMonth
                          : copy.subjects.unitEst}
                  </i>
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {shown.length === 0 && <p className="dim center">{copy.subjects.noneInFilter}</p>}

      {inactive.length > 0 && (
        <details className="fold">
          <summary>{copy.subjects.inactiveGroup} ({inactive.length})</summary>
          <ul className="rows">
            {inactive.map((s) => (
              <li key={s.id}><button className="srow" onClick={() => nav(`/app/subjects/${s.id}`)}>
                <span className="srow__main">
                  <span className="srow__name dim">{s.name}</span>
                  {/* กดลบไปแล้วแต่แถวยังอยู่ — ต้องบอกว่าทำไม ไม่ใช่ปล่อยให้ดูเหมือนคนที่แค่หยุดเรียน */}
                  {keptForRecords(state, s.id) && <span className="srow__meta">{copy.subjects.keptForRecords}</span>}
                </span>
              </button></li>
            ))}
          </ul>
        </details>
      )}

      {adding && <SubjectSheet onClose={() => setAdding(false)} />}
      {addingMany && <ImportSheet onClose={() => setAddingMany(false)} />}
    </div>
  )
}
