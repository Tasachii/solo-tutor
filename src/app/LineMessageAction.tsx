import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../core/store'
import type { Message } from '../core/types'
import { getSession, rpc } from '../integrations/supabaseRest'
import { oaAvailable, sendMessageViaOa } from './oaSend'

/** No share fallback after durable OA intent: even a failed HTTP response may have delivered. */
export default function LineMessageAction({ message, disabled = false, onSent }: { message: Message; disabled?: boolean; onSent?: () => void }) {
  const { state, dispatch } = useStore()
  const working = useRef(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  if (!oaAvailable(state, message)) return null
  const send = async () => {
    if (working.current) return
    working.current = true; setBusy(true); setNotice('')
    try {
      const outcome = await sendMessageViaOa(state, dispatch, message)
      if (outcome.status === 'sent') onSent?.()
      else setNotice(outcome.notice)
    } finally { working.current = false; setBusy(false) }
  }
  return <div className="line-delivery">
    {message.oaDelivery && <p className="hint" role="status">มีรายการส่งผ่าน OA รอตรวจสอบ ปิดการแก้ไขและแชร์ซ้ำไว้ชั่วคราว</p>}
    <button className="btn btn--secondary btn--sm" disabled={busy || disabled} onClick={() => void send()}>
      {busy ? 'กำลังตรวจสอบ LINE OA…' : message.oaDelivery ? 'ตรวจสอบผลส่ง LINE OA' : 'ส่งด้วย LINE OA'}
    </button>
    {message.oaDelivery && <button className="btn btn--ghost btn--sm" disabled={busy || disabled} onClick={() => {
      if (working.current || disabled) return
      working.current = true; setBusy(true)
      void (async () => {
        try {
          if (getSession()?.user.id !== message.oaDelivery!.providerId) throw new Error('account')
          const cancelled = await rpc<boolean>('cancel_line_message', { p_dedupe_key: message.oaDelivery!.dedupeKey })
          if (!cancelled) { setNotice('รายการนี้อาจเริ่มส่งแล้ว จึงยกเลิกไม่ได้ กรุณาตรวจสอบผลส่ง'); return }
          if (!dispatch({ type: 'oaCancelled', id: message.id, providerId: message.oaDelivery!.providerId })) throw new Error('storage')
          setNotice('ยกเลิกรายการที่ยังไม่เริ่มส่งแล้ว ใช้ปุ่มเปิด LINE เพื่อส่งเองได้')
        } catch { setNotice('ยังยืนยันการยกเลิกไม่ได้ กรุณาตรวจสอบผลส่งก่อน') }
        finally { working.current = false; setBusy(false) }
      })()
    }}>ยกเลิกเมื่อยืนยันว่าไม่ส่ง</button>}
    {notice && <p className="hint" role="status">{notice} <Link to="/app/settings/line">ตั้งค่า LINE OA</Link></p>}
  </div>
}
