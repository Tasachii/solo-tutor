import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../core/store'
import { professionById } from '../professions'
import { copy } from '../copy'
import { addDays, dateThai, dateThaiFull, dayIn, monthGrid, periodOf, periodThaiFull, shiftPeriod, weekday } from '../core/format'
import { courseProgress, isCompleted, packageStatus, subjectById, unitsOn } from '../core/ledger'
import { bookSeriesPlan, slotTaken, BOOK_SERIES_MAX_WEEKS } from '../core/booking'
import { BottomSheet, ConfirmSheet, EmptyState, Icon, Skeleton, StatCard } from './components'
import { useToast } from './components/Toast'
import type { AppState } from '../core/types'

export function overlappingUnits(state: AppState, date: string, time: string, excludeId?: string) {
  return state.units.filter((unit) => unit.id !== excludeId && !unit.cancelled && unit.scheduledAt === date && unit.time === time)
}

const fill = (text: string, vars: Record<string, string | number>): string =>
  text.replace(/\{(\w+)\}/g, (_m, key: string) => String(vars[key] ?? ''))

const cal = copy.calendar

/** ชื่อนักเรียนที่ถือคิวช่วงเวลานั้นอยู่ — บอกชื่อไปเลย ครูจะได้ตัดสินใจได้โดยไม่ต้องเปิดปฏิทินอีกจอ */
const holders = (state: AppState, date: string, time: string, exceptSubjectId?: string): string =>
  [...new Set(state.units
    .filter((unit) => !unit.cancelled && unit.scheduledAt === date && unit.time === time && unit.subjectId !== exceptSubjectId)
    .map((unit) => subjectById(state, unit.subjectId))
    .filter((subject) => subject?.active !== false)
    .map((subject) => subject?.name ?? ''))].filter(Boolean).join(' · ')

/**
 * จำนวนคาบและจำนวนที่เช็คชื่อแล้วของ "ทุกวัน" ที่มีคาบ — ใช้วาดจุดบนปฏิทิน
 * ไม่กรองตามเดือน เพราะแถบสัปดาห์คร่อมสองเดือนได้ (27 ก.ย.–3 ต.ค.) แล้ววันของอีกเดือนจะไม่มีจุด
 */
function dayCounts(state: AppState): Map<string, { n: number; done: number }> {
  const map = new Map<string, { n: number; done: number }>()
  for (const unit of state.units) {
    if (unit.cancelled) continue
    // นักเรียนที่หยุดเรียนแล้วไม่โผล่ในตารางวัน ปฏิทินจึงต้องไม่นับเขาด้วย ไม่งั้นจุดกับรายการไม่ตรงกัน
    if (subjectById(state, unit.subjectId)?.active === false) continue
    const cell = map.get(unit.scheduledAt) ?? { n: 0, done: 0 }
    cell.n += 1
    if (isCompleted(state, unit.id)) cell.done += 1
    map.set(unit.scheduledAt, cell)
  }
  return map
}

export default function Today() {
  const { state, dispatch, track, hydrated, persistenceError } = useStore()
  const prof = professionById(state.professionId)
  const v = prof.vocab
  const toast = useToast()
  const nav = useNavigate()

  /**
   * วันที่ครูกำลังดู — เริ่มที่วันนี้เสมอ
   * ปฏิทินเป็นตัวหลักของหน้านี้ (เจ้าของ 12 ก.ย.) แต่ "เปิดแอปมาแล้วเห็นงานวันนี้" ต้องไม่หาย
   * วันเปลี่ยน (ข้ามเที่ยงคืน หรือเดโมเลื่อนวัน) ให้ดึงกลับมาที่วันนี้ ไม่ค้างอยู่วันเก่าที่ครูเผลอเลือกไว้
   */
  const [selected, setSelected] = useState(state.today)
  useEffect(() => { setSelected(state.today) }, [state.today])

  const [adding, setAdding] = useState(false)
  const [newUnit, setNewUnit] = useState({ subjectId: '', date: state.today, time: '17:00', label: '' })
  /** จองซ้ำทุกสัปดาห์ — ตารางเรียนจริงเป็นรายสัปดาห์ ครูจึงไม่ต้องกดเพิ่มทีละคาบ 8 รอบ */
  const [repeat, setRepeat] = useState(false)
  const [days, setDays] = useState<number[]>([])
  const [weeks, setWeeks] = useState('8')
  /** ยอมให้คิวชนกัน = สอนเป็นกลุ่ม — ต้องเป็นการกดของครู ไม่ใช่ค่าเริ่มต้นที่ปล่อยให้จองทับกันเอง */
  const [group, setGroup] = useState(false)
  const [addError, setAddError] = useState('')

  const period = periodOf(selected)
  const isToday = selected === state.today
  const future = selected > state.today

  const units = useMemo(() => unitsOn(state, selected), [state, selected])
  const cancelled = useMemo(
    () => state.units.filter((u) => u.scheduledAt === selected && u.cancelled), [state, selected])
  const counts = useMemo(() => dayCounts(state), [state])
  /** ทั้งเดือนย่อไว้ก่อน — เปิดแอปมาต้องเห็นงานวันนี้ ไม่ใช่ตารางเดือนเต็มจอ (เจ้าของ 12 ก.ย.: "มันรกไป") */
  const [expanded, setExpanded] = useState(false)
  const cells = useMemo(() => expanded
    ? monthGrid(period)
    : Array.from({ length: 7 }, (_, i) => addDays(selected, i - weekday(selected))), [expanded, period, selected])
  const month = useMemo(() => [...counts.entries()].filter(([date]) => periodOf(date) === period), [counts, period])
  const monthTotal = useMemo(() => month.reduce((sum, [, cell]) => sum + cell.n, 0), [month])
  const monthDone = useMemo(() => month.reduce((sum, [, cell]) => sum + cell.done, 0), [month])

  // คาบที่กำลังเลื่อน
  const [moving, setMoving] = useState<string | null>(null)
  const movingUnit = state.units.find((u) => u.id === moving)
  const [mDate, setMDate] = useState('')
  const [mTime, setMTime] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [moveGroup, setMoveGroup] = useState(false)

  const done = units.filter((u) => isCompleted(state, u.id)).length

  const nextDay = useMemo(() => {
    const upcoming = state.units.filter((u) => u.scheduledAt > selected && !u.cancelled)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    return upcoming[0]?.scheduledAt
  }, [state, selected])

  if (!hydrated) return <div className="pane"><Skeleton rows={4} /></div>

  const openMove = (unitId: string, time: string) => {
    setMoving(unitId); setMDate(addDays(selected, 1)); setMTime(time); setMoveGroup(false)
  }
  /** เลื่อนไปทับคิวของคนอื่นไม่ได้ นอกจากครูจะบอกว่าสอนกลุ่ม — ปฏิทินต้องเชื่อถือได้ว่าหนึ่งช่องคือหนึ่งคิว */
  const moveClash = !!movingUnit && !!mDate && !!mTime && slotTaken(state, mDate, mTime, movingUnit.subjectId)

  /** เปิดชีทเพิ่มคาบให้วันที่กำลังดูอยู่ — เลือกวันบนปฏิทินแล้วกดเพิ่ม ต้องได้วันนั้น ไม่ใช่วันนี้ */
  const openAdd = () => {
    setNewUnit({ subjectId: '', date: selected, time: '17:00', label: '' })
    setRepeat(false); setDays([weekday(selected)]); setWeeks('8'); setGroup(false); setAddError('')
    setAdding(true)
  }

  /** เดือนก่อน/ถัดไป — ถ้าเดือนนั้นคือเดือนของวันนี้ ให้กลับมาที่วันนี้ ไม่ใช่วันที่ 1 ที่ไม่มีความหมาย */
  const goMonth = (step: number) => {
    const next = shiftPeriod(period, step)
    setSelected(next === periodOf(state.today) ? state.today : dayIn(next, Number(selected.slice(8, 10))))
  }
  /** ปุ่มลูกศรเลื่อนเท่าที่ตาเห็น — ย่ออยู่เลื่อนทีละสัปดาห์ กางอยู่เลื่อนทีละเดือน */
  const goStep = (step: number) => { if (expanded) goMonth(step); else setSelected(addDays(selected, step * 7)) }

  const onComplete = (unitId: string, subjectId: string) => {
    if (!dispatch({ type: 'complete', unitId })) {
      toast.push({ text: persistenceError ?? 'แก้คาบนี้ไม่ได้ เพราะรอบบิลถูกปิดแล้วหรือข้อมูลยังไม่พร้อม', tone: 'danger' })
      return
    }
    track('complete_unit', { subjectId })
    const subject = subjectById(state, subjectId)
    if (!subject) return
    // คำนวณสถานะแพ็กหลังบวกครั้งนี้แล้ว เพื่อบอกผลทันทีไม่ต้องรอสิ้นเดือน
    const after = { ...state, completions: [...state.completions, { unitId, completedAt: state.today }] }
    const pk = packageStatus(after, subject)
    const undo = { label: copy.common.undo, run: () => { onUncomplete(unitId) } }

    if (!pk) {
      // คอร์สที่นับเป็นครั้ง — บอกความคืบหน้าทันทีที่เช็คชื่อ ("สอนไปแล้ว 1/10") ไม่ต้องเปิดหน้าลูกไปดู
      const course = courseProgress(after, subject)
      toast.push({
        text: course ? `${copy.toast.completed} · ${subject.name} ${fill(copy.course.progress, { done: course.done, total: course.total })}` : copy.toast.completed,
        tone: 'ok', action: undo,
      })
      return
    }
    if (pk.overBy >= 1) {
      toast.push({
        text: `${copy.toast.packExhausted} (${subject.name})`, tone: 'danger',
        action: { label: copy.toast.packExhaustedCta, run: () => nav('/app/admin?tab=drafts') },
      })
    } else if (pk.remaining >= 1 && pk.remaining <= 2) {
      toast.push({ text: `${copy.toast.packLow} (${subject.name} ${pk.remaining}/${pk.total})`, tone: 'warn', action: undo })
    } else {
      toast.push({ text: copy.toast.completed, tone: 'ok', action: undo })
    }
  }

  const onUncomplete = (unitId: string) => {
    if (dispatch({ type: 'uncomplete', unitId })) return true
    toast.push({ text: persistenceError ?? 'แก้การยืนยันคาบไม่ได้ เพราะรอบบิลถูกปิดแล้วหรือข้อมูลยังไม่พร้อม', tone: 'danger' })
    return false
  }

  /** คาบที่จะถูกเพิ่มจริงถ้ากดตอนนี้ — ตัวเลขบนปุ่มกับผลลัพธ์ต้องมาจากฟังก์ชันเดียวกัน */
  const series = repeat && newUnit.subjectId
    ? bookSeriesPlan(state, {
      subjectId: newUnit.subjectId, time: newUnit.time, weekdays: days,
      from: newUnit.date, weeks: Number(weeks) || 0, allowClash: group,
    })
    : null
  /** คิวนี้เป็นของนักเรียนคนอื่นอยู่แล้วหรือยัง — ล็อกไว้จนกว่าครูจะยืนยันว่าสอนกลุ่ม */
  const clash = !repeat && !group && !!newUnit.subjectId && !!newUnit.date && !!newUnit.time
    && slotTaken(state, newUnit.date, newUnit.time, newUnit.subjectId)

  const saveUnit = () => {
    if (repeat) {
      if (days.length === 0) { setAddError(cal.bookPickDay); return }
      if (!series?.dates.length) { setAddError(cal.bookNothing); return }
      if (!dispatch({ type: 'bookSeries', subjectId: newUnit.subjectId, time: newUnit.time,
        weekdays: days, from: newUnit.date, weeks: Number(weeks), label: newUnit.label || undefined, allowClash: group })) {
        setAddError(persistenceError ?? cal.bookFailed); return
      }
      track('book_series', { units: series.dates.length, weeks: Number(weeks) })
      setAdding(false); toast.push({ text: fill(cal.bookDone, { n: series.dates.length }), tone: 'ok' })
      return
    }
    if (clash) { setAddError(cal.slotTaken); return }
    if (!dispatch({ type: 'addUnit', subjectId: newUnit.subjectId, date: newUnit.date, time: newUnit.time, label: newUnit.label || undefined })) {
      setAddError(persistenceError ?? copy.common.saveFailed); return
    }
    setAdding(false); toast.push({ text: copy.toast.saved, tone: 'ok' })
    // เพิ่มคาบวันอื่นแล้วต้องพาไปดูวันนั้น ไม่ใช่ปล่อยให้ครูงงว่าคาบที่เพิ่งเพิ่มหายไปไหน
    setSelected(newUnit.date)
  }

  return (
    <div className="pane">
      {state.provider.name && <p className="greet">{copy.today.greet} {state.provider.name}</p>}

      {/* ปฏิทินอยู่บนสุดของหน้าแรก — ครูวางแผนล่วงหน้าได้ว่าใครเรียนวันไหน ไม่ใช่เห็นแค่วันนี้วันเดียว
          ปกติย่อเหลือสัปดาห์เดียว กดปุ่มปฏิทินกางเป็นทั้งเดือน กดอีกทีย่อกลับ — ไม่ต้องเปลี่ยนหน้า ไม่ต้องกดย้อนกลับ */}
      <section className="cal" aria-label={cal.title}>
        <div className="cal__hd">
          <button className="btn btn--ghost btn--sm cal__nav" aria-label={expanded ? cal.prev : cal.prevWeek} onClick={() => goStep(-1)}>‹</button>
          <b className="cal__title">{periodThaiFull(period)}</b>
          <button className="btn btn--ghost btn--sm cal__nav" aria-label={expanded ? cal.next : cal.nextWeek} onClick={() => goStep(1)}>›</button>
          <button className={`btn btn--ghost btn--sm cal__toggle${expanded ? ' cal__toggle--on' : ''}`}
            aria-expanded={expanded} aria-label={expanded ? cal.collapse : cal.expand}
            onClick={() => setExpanded((open) => !open)}><Icon name="cal" size={18} /></button>
        </div>
        <div className="cal__wk" aria-hidden="true">
          {cal.weekdays.map((d, i) => <span key={i}>{d}</span>)}
        </div>
        <div className="cal__grid">
          {cells.map((date, i) => {
            if (!date) return <span className="cal__pad" key={`pad-${i}`} aria-hidden="true" />
            const cell = counts.get(date)
            const full = !!cell && cell.done === cell.n
            return (
              <button key={date} type="button"
                className={`cal__day${date === selected ? ' cal__day--on' : ''}${date === state.today ? ' cal__day--today' : ''}`}
                aria-pressed={date === selected}
                aria-label={`${fill(cal.selectDay, { date: dateThai(date) })}${cell ? ` · ${fill(cal.dayUnits, { n: cell.n })}` : ''}`}
                onClick={() => setSelected(date)}>
                <span className="cal__n num">{Number(date.slice(8))}</span>
                {cell && <i className={`cal__dot${full ? ' cal__dot--ok' : ''}`}>{cell.n}</i>}
              </button>
            )
          })}
        </div>
        {/* สรุปทั้งเดือนมีความหมายก็ต่อเมื่อเห็นทั้งเดือน — ย่ออยู่แล้วบอกเลขเดือนคือทำให้แถบสัปดาห์ชวนอ่านผิด */}
        {expanded && <p className="cal__sum dim">
          {fill(cal.monthUnits, { n: monthTotal })} · {fill(cal.monthDone, { n: monthDone })}
        </p>}
      </section>

      <div className="rowhead">
        <h1 className="h1 h1--tight">{dateThaiFull(selected)}</h1>
        {!isToday && <button className="btn btn--ghost btn--sm" onClick={() => setSelected(state.today)}>{cal.backToToday}</button>}
      </div>

      <div className="stats">
        <StatCard label={isToday ? copy.today.statUnits : dateThai(selected)} value={`${units.length} ${v.units}`} tone="brand" />
        <StatCard label={copy.today.statDone} value={String(done)} tone="ok" />
        <StatCard label={copy.today.statLeft} value={String(units.length - done)} tone={units.length - done ? 'warn' : undefined} />
      </div>

      {/* วันข้างหน้าเช็คชื่อไม่ได้ — งานที่ยังไม่เกิดจะถูกนับเป็นเงินไม่ได้ บอกเหตุผลไว้ตรงนี้ ไม่ใช่ซ่อนปุ่มเงียบ ๆ */}
      {future && units.length > 0 && <p className="hint" role="status">{cal.futureNote}</p>}

      {units.length === 0 ? (
        <EmptyState
          icon="☕" art title={isToday ? copy.today.emptyTitle : future ? cal.emptyFuture : cal.emptyDay}
          desc={nextDay ? `${copy.today.emptyNext}: ${dateThai(nextDay)}` : undefined}
          action={<button className="btn btn--secondary" onClick={openAdd}>+ {isToday ? copy.today.addUnit : cal.book}</button>}
        />
      ) : (
        <ul className="rows">
          {units.map((u) => {
            const s = subjectById(state, u.subjectId)
            if (!s) return null
            const pk = packageStatus(state, s)
            const course = courseProgress(state, s)
            const isDone = isCompleted(state, u.id)
            return (
              <li className={`urow${isDone ? ' urow--done' : ''}`} key={u.id}>
                <span className="urow__time num">{u.time}</span>
                <span className="urow__main">
                  <span className="urow__name">{s.name}</span>
                  <span className="urow__meta">
                    {u.label ?? s.label}
                    {pk && <i className={`pk pk--${pk.state}`}>{pk.overBy ? `เกิน ${pk.overBy}` : `เหลือ ${pk.remaining}/${pk.total}`}</i>}
                    {/* "สอนไปแล้ว 3/10" ของคอร์สที่ไม่ได้ขายเป็นแพ็ก — ขยับทันทีที่เช็คชื่อ
                        ครบคอร์สใช้สีเหลืองไม่ใช่แดง เพราะมันคือ "ถึงเวลาตัดสินใจต่อคอร์ส" ไม่ใช่ความผิดพลาด */}
                    {course && <i className={`pk pk--${course.state === 'ok' ? 'ok' : 'low'}`}>
                      {fill(course.state === 'done' ? copy.course.shortDone : copy.course.short, { done: course.done, total: course.total })}
                    </i>}
                  </span>
                </span>
                {isDone ? (
                  <button className="btn btn--ghost btn--sm" onClick={() => onUncomplete(u.id)}>
                    {copy.today.fixLabel}
                  </button>
                ) : (
                  <>
                    <button className="btn btn--ghost btn--sm urow__move" aria-label={`${copy.today.move} ${s.name}`}
                      onClick={(event) => { event.currentTarget.focus(); openMove(u.id, u.time) }}>{copy.today.move}</button>
                    {!future && (
                      <button className="btn btn--primary btn--tap" onClick={() => onComplete(u.id, u.subjectId)}>
                        {v.completion}
                      </button>
                    )}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {movingUnit && (
        <BottomSheet title={copy.today.moveTitle}
          sub={subjectById(state, movingUnit.subjectId)?.name}
          onClose={() => setMoving(null)}
          footer={
            <div className="btnrow">
              <button className="btn btn--primary" disabled={!mDate || !mTime || mDate < state.today || (moveClash && !moveGroup)} onClick={() => {
                if (!dispatch({ type: 'rescheduleUnit', unitId: movingUnit.id, date: mDate, time: mTime })) {
                  toast.push({ text: persistenceError ?? 'เลื่อนคาบไม่ได้ โปรดโหลดข้อมูลล่าสุดแล้วลองอีกครั้ง', tone: 'danger' })
                  return
                }
                track('unit_rescheduled')
                setMoving(null); toast.push({ text: copy.today.moveDone, tone: 'ok' })
              }}>{copy.today.move}</button>
              <button className="btn btn--danger" onClick={() => setConfirmCancel(true)}>{copy.today.cancelUnit}</button>
            </div>
          }>
          <label className="fld">
            <span className="fld__l">{copy.today.moveDate}</span>
            {/* Android ล้างช่องวันที่ได้ ถ้าปล่อยผ่าน scheduledAt จะเป็น '' แล้วคาบหายถาวร */}
            <input className="inp" type="date" min={state.today} value={mDate}
              onChange={(e) => setMDate(e.target.value)} />
          </label>
          <label className="fld">
            <span className="fld__l">{copy.today.moveTime}</span>
            <input className="inp" type="time" value={mTime} onChange={(e) => setMTime(e.target.value)} />
          </label>
          {moveClash && (
            <div className="fld">
              <p className="hint hint--warn" role="status">{fill(cal.slotTaken, { name: holders(state, mDate, mTime, movingUnit.subjectId) })}</p>
              <div className="chips">
                <button type="button" className={`chip${moveGroup ? ' chip--on' : ''}`} aria-pressed={moveGroup}
                  onClick={() => setMoveGroup((on) => !on)}>{cal.group}</button>
              </div>
            </div>
          )}
        </BottomSheet>
      )}

      {cancelled.length > 0 && (
        <ul className="rows rows--muted">
          {cancelled.map((u) => {
            const s = subjectById(state, u.subjectId)
            if (!s) return null
            return (
              <li className="urow urow--off" key={u.id}>
                <span className="urow__time num">{u.time}</span>
                <span className="urow__main">
                  <span className="urow__name">{s.name}</span>
                  <span className="urow__meta">{copy.today.cancelledTag}</span>
                </span>
                <button className="btn btn--secondary btn--sm" onClick={() => {
                  if (!dispatch({ type: 'restoreUnit', unitId: u.id })) {
                    toast.push({ text: persistenceError ?? 'คืนคาบไม่ได้ เพราะรอบบิลถูกปิดแล้วหรือข้อมูลยังไม่พร้อม', tone: 'danger' })
                    return
                  }
                  track('unit_restored')
                  toast.push({ text: copy.today.restoreDone, tone: 'ok' })
                }}>{copy.today.restoreUnit}</button>
              </li>
            )
          })}
        </ul>
      )}

      {confirmCancel && movingUnit && (
        <ConfirmSheet
          title={copy.today.cancelConfirm}
          hint={copy.today.cancelHint}
          confirmLabel={copy.today.cancelUnit} danger
          onClose={() => setConfirmCancel(false)}
          onConfirm={() => {
            if (!dispatch({ type: 'cancelUnit', unitId: movingUnit.id })) {
              toast.push({ text: persistenceError ?? 'งดคาบไม่ได้ โปรดโหลดข้อมูลล่าสุดแล้วลองอีกครั้ง', tone: 'danger' })
              return false
            }
            track('unit_cancelled')
            setMoving(null); toast.push({ text: copy.today.cancelDone, tone: 'warn' })
            return true
          }} />
      )}

      {units.length > 0 && (
        <button className="linkbtn" onClick={openAdd}>+ {isToday ? copy.today.addUnit : cal.book}</button>
      )}

      {adding && (
        <BottomSheet
          title={`+ ${isToday ? copy.today.addUnit : cal.book}`} onClose={() => setAdding(false)}
          footer={
            <button className="btn btn--primary btn--block"
              disabled={!newUnit.subjectId || !newUnit.date || !newUnit.time || (repeat ? !series?.dates.length : clash)}
              onClick={saveUnit}>
              {repeat && series?.dates.length ? fill(cal.bookSave, { n: series.dates.length }) : copy.common.save}
            </button>
          }
        >
          <label className="fld">
            <span className="fld__l">{v.subject}</span>
            <select className="inp" value={newUnit.subjectId} onChange={(e) => setNewUnit({ ...newUnit, subjectId: e.target.value })}>
              <option value="">—</option>
              {state.subjects.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="fld">
            <span className="fld__l">วันที่</span>
            <input className="inp" type="date" value={newUnit.date}
              onChange={(e) => { setNewUnit({ ...newUnit, date: e.target.value }); if (e.target.value) setDays([weekday(e.target.value)]) }} />
          </label>
          <label className="fld">
            <span className="fld__l">{copy.today.fieldTime}</span>
            <input className="inp" type="time" value={newUnit.time} onChange={(e) => setNewUnit({ ...newUnit, time: e.target.value })} />
          </label>
          {/* จองซ้ำมี preview "ข้ามที่ชนคิว n วัน" ของตัวเองแล้ว แถบคาบเดี่ยวซ้อนอีกชั้นทำให้อ่านเป็นสองเรื่อง */}
          {!repeat && newUnit.subjectId && slotTaken(state, newUnit.date, newUnit.time, newUnit.subjectId) && (
            <div className="fld">
              <p className="hint hint--warn" role="status">{fill(cal.slotTaken, { name: holders(state, newUnit.date, newUnit.time, newUnit.subjectId) })}</p>
              <div className="chips">
                <button type="button" className={`chip${group ? ' chip--on' : ''}`} aria-pressed={group}
                  onClick={() => { setGroup((on) => !on); setAddError('') }}>{cal.group}</button>
              </div>
            </div>
          )}
          <label className="fld">
            <span className="fld__l">{copy.today.fieldItem}</span>
            <input className="inp" value={newUnit.label} onChange={(e) => setNewUnit({ ...newUnit, label: e.target.value })} />
          </label>

          {/* จองล่วงหน้าเป็นชุด — ตารางเรียนจริงซ้ำทุกสัปดาห์ ครูจึงวางทั้งเทอมได้ในครั้งเดียว */}
          <div className="fld">
            <span className="fld__l">{cal.bookMode}</span>
            <div className="chips">
              <button type="button" className={`chip${repeat ? '' : ' chip--on'}`} aria-pressed={!repeat}
                onClick={() => { setRepeat(false); setAddError('') }}>{cal.bookOnce}</button>
              <button type="button" className={`chip${repeat ? ' chip--on' : ''}`} aria-pressed={repeat}
                onClick={() => { setRepeat(true); setAddError('') }}>{cal.bookRepeat}</button>
            </div>
          </div>
          {repeat && (
            <>
              <div className="fld">
                <span className="fld__l">{cal.bookDays}</span>
                <div className="chips">
                  {cal.weekdays.map((label, day) => (
                    <button key={day} type="button" className={`chip${days.includes(day) ? ' chip--on' : ''}`} aria-pressed={days.includes(day)}
                      onClick={() => setDays((current) => current.includes(day) ? current.filter((x) => x !== day) : [...current, day])}>{label}</button>
                  ))}
                </div>
              </div>
              <label className="fld">
                <span className="fld__l">{cal.bookWeeks}</span>
                <input className="inp" inputMode="numeric" value={weeks}
                  onChange={(e) => setWeeks(e.target.value.replace(/\D/g, '').slice(0, 2))} />
              </label>
              <p className="hint" role="status">
                {series?.dates.length
                  ? `${fill(cal.bookPreview, { n: series.dates.length, date: dateThai(series.dates[series.dates.length - 1]) })}${series.clashes.length ? ` · ${fill(cal.bookClash, { n: series.clashes.length })}` : ''}`
                  : days.length === 0 ? cal.bookPickDay
                    : !Number(weeks) ? cal.bookWeeksMin
                      : Number(weeks) > BOOK_SERIES_MAX_WEEKS ? fill(cal.bookWeeksMax, { n: BOOK_SERIES_MAX_WEEKS })
                      : series?.clashes.length ? fill(cal.bookClash, { n: series.clashes.length })
                        : cal.bookNothing}
              </p>
            </>
          )}
          {addError && <p className="fld__err" role="alert">{addError}</p>}
        </BottomSheet>
      )}
    </div>
  )
}
