import { useState } from 'react'
import { useStore } from '../core/store'
import { professionById } from '../professions'
import { copy } from '../copy'
import { COURSE_SESSIONS_FALLBACK } from '../core/ledger'
import { isCourseSessions } from '../core/validation'
import { BottomSheet } from './components'
import { useToast } from './components/Toast'

/**
 * ค่าเริ่มต้น "คอร์สหนึ่งกี่ครั้ง" ของครูคนนี้
 *
 * ครูแต่ละคนขายคอร์สไม่เท่ากัน (10 ครั้งบ้าง 20 ครั้งบ้าง) ค่านี้จึงต้องตั้งได้เอง
 * ไม่ใช่ฝังไว้ในโค้ด · นักเรียนที่ตั้งจำนวนของตัวเองไว้แล้วไม่ถูกค่านี้ทับ
 */
export function CourseDefaultSheet({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore()
  const prof = professionById(state.professionId)
  const toast = useToast()
  const [value, setValue] = useState(String(state.courseSessionsDefault ?? COURSE_SESSIONS_FALLBACK))
  const [error, setError] = useState('')

  const save = () => {
    const sessions = Number(value)
    if (!isCourseSessions(sessions)) { setError(copy.common.numberPositive); return }
    if (!dispatch({ type: 'setCourseDefault', sessions })) { setError(copy.common.saveFailed); return }
    toast.push({ text: copy.course.defaultSaved, tone: 'ok' })
    onClose()
  }

  return (
    <BottomSheet title={copy.course.defaultTitle} onClose={onClose}
      footer={<button className="btn btn--primary btn--block" onClick={save}>{copy.common.save}</button>}>
      <div className="fld">
        <span className="fld__l">{copy.course.field}</span>
        <div className="chips">
          {(prof.packagePresets ?? [10, 20]).map((n) => (
            <button key={n} type="button" className={`chip${value === String(n) ? ' chip--on' : ''}`}
              aria-pressed={value === String(n)} onClick={() => { setValue(String(n)); setError('') }}>{n}</button>
          ))}
        </div>
        <input className="inp" inputMode="numeric" aria-label={copy.course.field} value={value}
          onChange={(e) => { setValue(e.target.value.replace(/\D/g, '').slice(0, 3)); setError('') }} />
        {error && <p className="fld__err" role="alert">{error}</p>}
      </div>
    </BottomSheet>
  )
}
