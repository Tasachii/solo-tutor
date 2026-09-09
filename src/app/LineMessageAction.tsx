import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../core/store'
import { copy } from '../copy'
import type { Message } from '../core/types'
import { getSession, rpc } from '../integrations/supabaseRest'
import { oaAvailable, sendMessageViaOa } from './oaSend'

/**
 * ปุ่มส่งปุ่มเดียว "ส่งใน LINE" — ครูไม่ต้องรู้ว่าข้างในเป็นทางไหน
 * ผู้ปกครองผูก OA แล้ว → ส่งผ่าน OA อัตโนมัติ · ยังไม่ผูก → `fallback` (เปิดแอป LINE ให้ครูส่งเอง)
 * เจ้าของขอ 9 ก.ย.: เคยมีสองปุ่ม "ส่งใน LINE" กับ "ส่งด้วย LINE OA" คู่กัน ครูไม่รู้จะกดอันไหน
 *
 * No share fallback after durable OA intent: even a failed HTTP response may have delivered.
 */
/**
 * OA ไม่ใช่ทางของผู้รับคนนี้ (ยังไม่ผูก / ไม่มีบัญชี / ไม่มี workspace) → เปิดแอป LINE ให้ครูส่งเองแทน ไม่ใช่ error
 *
 * `offline` อยู่ในนี้ด้วย เพราะ `sendMessageViaOa` คืนค่านี้เฉพาะตอนเครือข่ายล้ม**ก่อน**
 * มีรายการ OA ใดถูกบันทึกลง storage — ยังไม่มีอะไรออกจากเครื่อง แชร์เองได้ตามปกติ
 * ครูบนเวทีที่ไวไฟตายจึงยังส่งได้ · `network` (ล้มหลังบันทึกแล้ว) ต้องไม่อยู่ในนี้:
 * ข้อความอาจถึงผู้ปกครองแล้วแม้คำตอบจะไม่กลับมา ทางเดียวคือกดตรวจผล
 *
 * ห้ามพึ่ง `!message.oaDelivery` เป็นด่านนี้: `message` เป็น prop ที่แช่ไว้ตอนกด
 * รายการที่ถูกบันทึกในคลิกเดียวกันจะยังอ่านได้ว่า undefined อยู่ ด่านจริงคือชื่อเหตุผลนี้
 */
const FALL_BACK_REASONS = new Set(['no-session', 'no-workspace', 'not-linked', 'wrong-account', 'offline'])

export default function LineMessageAction({ message, disabled = false, onSent, onFallback }: {
  message: Message; disabled?: boolean; onSent?: () => void; onFallback?: () => void
}) {
  const { state, dispatch } = useStore()
  const working = useRef(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  if (!oaAvailable(state, message)) {
    return onFallback
      ? <button className="btn btn--primary btn--sm" disabled={disabled} onClick={onFallback}>{copy.admin.sendLine}</button>
      : null
  }
  const send = async () => {
    if (working.current) return
    working.current = true; setBusy(true); setNotice('')
    try {
      const outcome = await sendMessageViaOa(state, dispatch, message)
      if (outcome.status === 'sent') onSent?.()
      else if (outcome.status === 'blocked' && FALL_BACK_REASONS.has(outcome.reason) && onFallback && !message.oaDelivery) onFallback()
      else setNotice(outcome.notice)
    } finally { working.current = false; setBusy(false) }
  }
  return <>
    <button className="btn btn--primary btn--sm" disabled={busy || disabled} onClick={() => void send()}>
      {busy ? 'กำลังส่ง…' : message.oaDelivery ? 'ตรวจสอบผลส่ง' : copy.admin.sendLine}
    </button>
    {message.oaDelivery && <p className="hint" role="status">ส่งผ่าน LINE OA แล้ว รอยืนยันผล — ปิดการแก้ไขไว้ชั่วคราว</p>}
    {message.oaDelivery && <button className="btn btn--ghost btn--sm" disabled={busy || disabled} onClick={() => {
      if (working.current || disabled) return
      working.current = true; setBusy(true)
      void (async () => {
        try {
          if (getSession()?.user.id !== message.oaDelivery!.providerId) throw new Error('account')
          const cancelled = await rpc<boolean>('cancel_line_message', { p_dedupe_key: message.oaDelivery!.dedupeKey })
          if (!cancelled) { setNotice('รายการนี้อาจเริ่มส่งแล้ว จึงยกเลิกไม่ได้ กรุณาตรวจสอบผลส่ง'); return }
          if (!dispatch({ type: 'oaCancelled', id: message.id, providerId: message.oaDelivery!.providerId })) throw new Error('storage')
          setNotice('ยกเลิกรายการที่ยังไม่เริ่มส่งแล้ว กดส่งใน LINE อีกครั้งได้')
        } catch { setNotice('ยังยืนยันการยกเลิกไม่ได้ กรุณาตรวจสอบผลส่งก่อน') }
        finally { working.current = false; setBusy(false) }
      })()
    }}>ยกเลิกเมื่อยืนยันว่าไม่ส่ง</button>}
    {notice && <p className="hint" role="status">{notice} <Link to="/app/settings/line">ตั้งค่า LINE OA</Link></p>}
  </>
}
