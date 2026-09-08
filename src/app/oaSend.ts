import type { AppState, Message, OaDelivery } from '../core/types'
import type { Action } from '../core/store'
import { messageSendIssue } from '../core/messageDelivery'
import { getSession, getSupabaseConfig } from '../integrations/supabaseRest'
import { deliverOa, deliveryTarget, findDelivery, type OutboxRow } from '../integrations/lineApi'

/**
 * ส่งข้อความหนึ่งใบผ่าน LINE OA — ใช้ร่วมกันระหว่างปุ่มบนการ์ดข้อความและการส่งเป็นชุดจากแท็บค้างจ่าย/การบ้าน
 *
 * กติกาที่ห้ามหลุด (เหมือน LineMessageAction เดิมทุกข้อ):
 * - ไม่มีอะไรออกจากเครื่องก่อน "ความตั้งใจส่ง" (oaDelivery) ถูกบันทึกลง storage สำเร็จ
 * - dedupe ต่อ workspace: รายการเดิมที่เคยเข้าคิวแล้วจะถูกตรวจผล ไม่ enqueue ซ้ำ
 * - ผลที่ยืนยันไม่ได้ = pending ต้องกดตรวจสอบ ห้ามแชร์ซ้ำ; failed/skipped/manual_review = ต้องให้คนดู
 * - ตัวเลขที่เปลี่ยนหลังร่าง (financial revision) ปิดการส่งจนกว่าจะร่างใหม่
 */
export type OaSendOutcome =
  | { status: 'sent' }
  | { status: 'pending'; notice: string }
  | { status: 'review'; notice: string; outboxId?: string }
  | { status: 'blocked'; reason: 'no-session' | 'wrong-account' | 'no-workspace' | 'cancelled' | 'issue' | 'not-linked' | 'storage' | 'network'; notice: string }

export const NOTICE = {
  noSession: 'กรุณาเข้าสู่ระบบที่หน้าตั้งค่า LINE OA ก่อน',
  wrongAccount: 'รายการนี้ผูกกับบัญชีเดิม กรุณาเข้าสู่ระบบด้วยบัญชีที่เริ่มส่ง',
  noWorkspace: 'กรุณาเชื่อมรายชื่อผู้ปกครองที่หน้าตั้งค่า LINE OA ก่อน',
  cancelled: 'ยกเลิกรายการ OA นี้แล้ว ใช้ปุ่มเปิด LINE เพื่อส่งเองได้',
  notLinked: 'ยังส่งผ่าน OA ให้ผู้ปกครองนี้ไม่ได้ ตรวจการเชื่อมบัญชีและรหัสผู้ปกครอง หรือใช้ปุ่มเปิด LINE',
  storage: 'บันทึกรายการส่งไม่สำเร็จ จึงยังไม่ได้ส่งผ่าน OA',
  network: 'ติดต่อระบบ OA ไม่สำเร็จ หากรายการเริ่มส่งแล้วให้กดตรวจสอบอีกครั้ง ห้ามส่งข้อความเดิมซ้ำ',
  sentButLocal: 'LINE รับข้อความแล้ว แต่บันทึกในเครื่องไม่สำเร็จ กดตรวจสอบอีกครั้ง ห้ามส่งซ้ำ',
  review: 'รายการนี้ต้องตรวจสอบในระบบ OA ก่อนส่งซ้ำ ติดต่อผู้ดูแลพร้อมรหัสข้อความ ',
  pending: 'ยังยืนยันผลส่งไม่ได้ กดตรวจสอบอีกครั้ง ระบบจะใช้รายการเดิมเพื่อป้องกันการส่งซ้ำ',
} as const

/** ปุ่ม OA มีความหมายเฉพาะโหมดจริงที่ผูกโปรเจกต์แล้ว (หรือมีรายการค้างตรวจอยู่) */
export const oaAvailable = (state: AppState, message?: Message): boolean =>
  state.mode === 'real' && (!!getSupabaseConfig() || !!message?.oaDelivery)

const TERMINAL: OutboxRow['status'][] = ['sent', 'failed', 'skipped', 'manual_review']

export async function sendMessageViaOa(
  state: AppState,
  dispatch: (action: Action) => boolean,
  message: Message,
): Promise<OaSendOutcome> {
  const settle = (row: OutboxRow | null, providerId: string): OaSendOutcome => {
    if (row?.status === 'sent') {
      return dispatch({ type: 'oaSent', id: message.id, providerId })
        ? { status: 'sent' }
        : { status: 'pending', notice: NOTICE.sentButLocal }
    }
    if (row?.status === 'failed' || row?.status === 'skipped' || row?.status === 'manual_review') {
      return { status: 'review', notice: NOTICE.review + (row.id ?? ''), outboxId: row.id }
    }
    return { status: 'pending', notice: NOTICE.pending }
  }
  try {
    const session = getSession()
    if (!session) return { status: 'blocked', reason: 'no-session', notice: NOTICE.noSession }
    let intent: OaDelivery | undefined = message.oaDelivery
    if (state.lineProviderId && state.lineProviderId !== session.user.id) {
      return { status: 'blocked', reason: 'wrong-account', notice: NOTICE.wrongAccount }
    }
    if (!intent) {
      if (!state.lineWorkspaceId) return { status: 'blocked', reason: 'no-workspace', notice: NOTICE.noWorkspace }
      const dedupeKey = `${state.lineWorkspaceId}:${message.dedupeKey}`
      const previous = await findDelivery(dedupeKey)
      if (previous?.status === 'skipped' && previous.last_error === 'user-cancelled') {
        return { status: 'blocked', reason: 'cancelled', notice: NOTICE.cancelled }
      }
      if (!previous) {
        const issue = messageSendIssue(state, message)
        if (issue) return { status: 'blocked', reason: 'issue', notice: issue }
      }
      const target = previous ? null : await deliveryTarget(state.lineWorkspaceId, message.clientId)
      if (!previous && (!target?.recipient_id || !target.eligible)) {
        return { status: 'blocked', reason: 'not-linked', notice: NOTICE.notLinked }
      }
      intent = {
        providerId: session.user.id, workspaceId: state.lineWorkspaceId,
        recipientId: previous?.recipient_id ?? target!.recipient_id!, dedupeKey,
        body: previous?.body ?? message.draft,
      }
      // Nothing leaves this browser before the retry intent is stored successfully.
      if (!dispatch({ type: previous ? 'oaRecover' : 'oaStart', id: message.id, delivery: intent })) {
        return { status: 'blocked', reason: 'storage', notice: NOTICE.storage }
      }
      if (previous?.status === 'sent') return settle(previous, intent.providerId)
    }
    const previous = await findDelivery(intent.dedupeKey)
    if (previous && TERMINAL.includes(previous.status)) return settle(previous, intent.providerId)
    return settle(await deliverOa(intent, message.dedupeKey, intent.body), intent.providerId)
  } catch {
    return { status: 'blocked', reason: 'network', notice: NOTICE.network }
  }
}

/** สถานะเชื่อม OA ของผู้จ่ายแต่ละคน — ใช้บอกล่วงหน้าว่าใบไหนจะส่งผ่าน OA ได้ */
export type LinkState = 'linked' | 'not-linked' | 'unknown'

export async function linkStates(state: AppState, clientIds: string[]): Promise<Record<string, LinkState>> {
  const out: Record<string, LinkState> = {}
  if (!oaAvailable(state) || !state.lineWorkspaceId || !getSession()) {
    for (const id of clientIds) out[id] = 'unknown'
    return out
  }
  for (const id of [...new Set(clientIds)]) {
    try {
      const target = await deliveryTarget(state.lineWorkspaceId, id)
      out[id] = target?.eligible ? 'linked' : 'not-linked'
    } catch { out[id] = 'unknown' }
  }
  return out
}
