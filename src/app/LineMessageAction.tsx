import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../core/store'
import type { Message, OaDelivery } from '../core/types'
import { messageSendIssue } from '../core/messageDelivery'
import { getSession, getSupabaseConfig, rpc } from '../integrations/supabaseRest'
import { deliverOa, deliveryTarget, findDelivery, type OutboxRow } from '../integrations/lineApi'

/** No share fallback after durable OA intent: even a failed HTTP response may have delivered. */
export default function LineMessageAction({ message, disabled = false }: { message: Message; disabled?: boolean }) {
  const { state, dispatch } = useStore()
  const working = useRef(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  if (state.mode !== 'real' || (!getSupabaseConfig() && !message.oaDelivery)) return null
  const settle = (row: OutboxRow | null, providerId: string) => {
    if (row?.status === 'sent') {
      if (!dispatch({ type: 'oaSent', id: message.id, providerId })) {
        setNotice('LINE รับข้อความแล้ว แต่บันทึกในเครื่องไม่สำเร็จ กดตรวจสอบอีกครั้ง ห้ามส่งซ้ำ')
      }
    } else {
      setNotice(row?.status === 'failed' || row?.status === 'skipped' || row?.status === 'manual_review'
        ? 'รายการนี้ต้องตรวจสอบในระบบ OA ก่อนส่งซ้ำ ติดต่อผู้ดูแลพร้อมรหัสข้อความ ' + (row?.id ?? '')
        : 'ยังยืนยันผลส่งไม่ได้ กดตรวจสอบอีกครั้ง ระบบจะใช้รายการเดิมเพื่อป้องกันการส่งซ้ำ')
    }
  }
  const send = async () => {
    if (working.current) return
    working.current = true; setBusy(true); setNotice('')
    try {
      const session = getSession()
      if (!session) { setNotice('กรุณาเข้าสู่ระบบที่หน้าตั้งค่า LINE OA ก่อน'); return }
      let intent: OaDelivery | undefined = message.oaDelivery
      if (state.lineProviderId && state.lineProviderId !== session.user.id) {
        setNotice('รายการนี้ผูกกับบัญชีเดิม กรุณาเข้าสู่ระบบด้วยบัญชีที่เริ่มส่ง'); return
      }
      if (!intent) {
        if (!state.lineWorkspaceId) { setNotice('กรุณาเชื่อมรายชื่อผู้ปกครองที่หน้าตั้งค่า LINE OA ก่อน'); return }
        const dedupeKey = `${state.lineWorkspaceId}:${message.dedupeKey}`
        const previous = await findDelivery(dedupeKey)
        if (previous?.status === 'skipped' && previous.last_error === 'user-cancelled') { setNotice('ยกเลิกรายการ OA นี้แล้ว ใช้ปุ่มเปิด LINE เพื่อส่งเองได้'); return }
        if (!previous) {
          const issue = messageSendIssue(state, message)
          if (issue) { setNotice(issue); return }
        }
        const target = previous ? null : await deliveryTarget(state.lineWorkspaceId, message.clientId)
        if (!previous && (!target?.recipient_id || !target.eligible)) {
          setNotice('ยังส่งผ่าน OA ให้ผู้ปกครองนี้ไม่ได้ ตรวจการเชื่อมบัญชีและรหัสผู้ปกครอง หรือใช้ปุ่มเปิด LINE'); return
        }
        intent = { providerId: session.user.id, workspaceId: state.lineWorkspaceId,
          recipientId: previous?.recipient_id ?? target!.recipient_id!, dedupeKey,
          body: previous?.body ?? message.draft }
        // Nothing leaves this browser before the retry intent is stored successfully.
        if (!dispatch({ type: previous ? 'oaRecover' : 'oaStart', id: message.id, delivery: intent })) {
          setNotice('บันทึกรายการส่งไม่สำเร็จ จึงยังไม่ได้ส่งผ่าน OA'); return
        }
        if (previous?.status === 'sent') { settle(previous, intent.providerId); return }
      }
      const previous = await findDelivery(intent.dedupeKey)
      if (previous && ['sent', 'failed', 'skipped', 'manual_review'].includes(previous.status)) {
        settle(previous, intent.providerId); return
      }
      settle(await deliverOa(intent, message.dedupeKey, intent.body), intent.providerId)
    } catch {
      setNotice('ติดต่อระบบ OA ไม่สำเร็จ หากรายการเริ่มส่งแล้วให้กดตรวจสอบอีกครั้ง ห้ามส่งข้อความเดิมซ้ำ')
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
