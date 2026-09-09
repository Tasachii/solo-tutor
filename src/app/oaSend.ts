import type { AppState, Message, OaDelivery } from '../core/types'
import type { Action } from '../core/store'
import { messageSendIssue, oaDedupeKey } from '../core/messageDelivery'
import { getSession, getSupabaseConfig } from '../integrations/supabaseRest'
import { deliverOa, deliveryTarget, findDelivery, type OutboxRow } from '../integrations/lineApi'
import { publishBlocks, secureDraft, type PublishSkip } from '../core/documentPublish'

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
  | { status: 'blocked'; reason: 'no-session' | 'wrong-account' | 'no-workspace' | 'cancelled' | 'issue' | 'not-linked' | 'storage' | 'offline' | 'network' | 'publish'; notice: string }

export const NOTICE = {
  noSession: 'กรุณาเข้าสู่ระบบที่หน้าตั้งค่า LINE OA ก่อน',
  wrongAccount: 'รายการนี้ผูกกับบัญชีเดิม กรุณาเข้าสู่ระบบด้วยบัญชีที่เริ่มส่ง',
  noWorkspace: 'กรุณาเชื่อมรายชื่อผู้ปกครองที่หน้าตั้งค่า LINE OA ก่อน',
  cancelled: 'ยกเลิกรายการ OA นี้แล้ว ใช้ปุ่มเปิด LINE เพื่อส่งเองได้',
  notLinked: 'ยังส่งผ่าน OA ให้ผู้ปกครองนี้ไม่ได้ ตรวจการเชื่อมบัญชีและรหัสผู้ปกครอง หรือใช้ปุ่มเปิด LINE',
  storage: 'บันทึกรายการส่งไม่สำเร็จ จึงยังไม่ได้ส่งผ่าน OA',
  network: 'ติดต่อระบบ OA ไม่สำเร็จ หากรายการเริ่มส่งแล้วให้กดตรวจสอบอีกครั้ง ห้ามส่งข้อความเดิมซ้ำ',
  offline: 'ติดต่อระบบ OA ไม่สำเร็จ และยังไม่มีรายการใดเริ่มส่ง เปิด LINE เพื่อส่งเองได้',
  publishFailed: 'สร้างลิงก์ที่ปิดได้ไม่สำเร็จ ยังไม่ได้ส่ง กรุณาลองอีกครั้ง',
  publishSignedOut: 'ยังไม่ได้เข้าสู่ระบบบัญชีครู จึงยังออกลิงก์ที่ปิดได้ไม่ได้ ยังไม่ได้ส่ง',
  publishStale: 'ลิงก์ในข้อความนี้ถูกปิดไปแล้ว ยังไม่ได้ส่ง กรุณาสร้างร่างจากยอดล่าสุดก่อน',
  publishStoreFailed: 'บันทึกลิงก์ใหม่ลงข้อความไม่สำเร็จ จึงยังไม่ได้ส่ง',
  sentButLocal: 'LINE รับข้อความแล้ว แต่บันทึกในเครื่องไม่สำเร็จ กดตรวจสอบอีกครั้ง ห้ามส่งซ้ำ',
  review: 'รายการนี้ต้องตรวจสอบในระบบ OA ก่อนส่งซ้ำ ติดต่อผู้ดูแลพร้อมรหัสข้อความ ',
  pending: 'ยังยืนยันผลส่งไม่ได้ กดตรวจสอบอีกครั้ง ระบบจะใช้รายการเดิมเพื่อป้องกันการส่งซ้ำ',
} as const

const publishNotice = (skipped: PublishSkip | null): string =>
  skipped === 'signed-out' ? NOTICE.publishSignedOut
    : skipped === 'stale' ? NOTICE.publishStale : NOTICE.publishFailed

/** ที่เก็บ session อ่านไม่ได้ (โหมดส่วนตัว/สิทธิ์ถูกปิด) = ถือว่ายังไม่ได้เข้าสู่ระบบ ไม่ใช่ล้มทั้งปุ่ม */
const sessionPresent = (): boolean => { try { return !!getSession() } catch { return false } }

/**
 * OA เปิดให้ใช้เมื่อไหร่ — **ไม่ขึ้นกับว่าสมุดเป็นเดโมหรือจริง** (หลักการใหม่ 9 ก.ย. ข้อ 1)
 *
 * ขึ้นกับสามอย่าง: มีโปรเจกต์ให้ติดต่อ + บัญชีครูที่ล็อกอิน + ผู้ปกครองที่จับคู่ด้วยรหัสของครูคนนั้น
 * (ข้อสามตรวจตอนส่ง ที่นี่คุมสองข้อแรก) · ข้อความจากเดโมจึงถึงได้เฉพาะเครื่องที่ครูจับคู่เอง
 *
 * ในเดโมต้องล็อกอินก่อน — ผู้เข้าชมเว็บสาธารณะที่ยังไม่ล็อกอินต้องเห็นหน้าจอเดิมทุกจุด
 * รายการที่เริ่มส่งไปแล้ว (`oaDelivery`) เป็นข้อยกเว้นเดียวที่ไม่ดูทั้ง session และโหมด:
 * การ์ดกลางทางต้องเหลือปุ่ม "ตรวจสอบผลส่ง" ไว้เสมอ ไม่งั้นครูออกจากระบบแล้วรายการค้างจะไม่มีใครตรวจ
 */
export const oaAvailable = (state: AppState, message?: Message): boolean =>
  !!message?.oaDelivery || (!!getSupabaseConfig() && (state.mode === 'real' || sessionPresent()))

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
  // ความตั้งใจส่งถูกบันทึกลง storage แล้วหรือยัง — ตัวชี้ขาดว่าเครือข่ายล้มแล้วแชร์เองต่อได้ไหม
  let durable = !!message.oaDelivery
  try {
    const session = getSession()
    if (!session) return { status: 'blocked', reason: 'no-session', notice: NOTICE.noSession }
    let intent: OaDelivery | undefined = message.oaDelivery
    if (state.lineProviderId && state.lineProviderId !== session.user.id) {
      return { status: 'blocked', reason: 'wrong-account', notice: NOTICE.wrongAccount }
    }
    if (!intent) {
      if (!state.lineWorkspaceId) return { status: 'blocked', reason: 'no-workspace', notice: NOTICE.noWorkspace }
      const dedupeKey = oaDedupeKey(state, message)
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
      // ส่งซ้ำต้องใช้ข้อความเดิมที่แช่ไว้ ไม่งั้นตัวกันส่งซ้ำจะมองว่าเป็นคนละใบ
      let body = previous?.body
      if (body === undefined) {
        const secured = await secureDraft(state, message.draft)
        if (publishBlocks(secured.skipped)) {
          // ลิงก์เดิมถูกปิดไปแล้ว — ล้างธงแก้เองให้ refreshDrafts เขียนร่างใหม่พร้อมลิงก์ใหม่
          if (secured.skipped === 'stale') dispatch({ type: 'refreshMessage', id: message.id })
          return { status: 'blocked', reason: 'publish', notice: publishNotice(secured.skipped) }
        }
        body = secured.draft
        // oaStart รับเฉพาะคิวที่ body ตรงกับร่างที่เก็บไว้ · ลิงก์ใหม่จึงต้องลงร่างก่อน ไม่ใช่แนบไปเฉย ๆ
        // และนี่คือสิ่งที่ทำให้ข้อความที่เก็บไว้ตรงกับข้อความที่ผู้ปกครองได้รับจริง
        if (body !== message.draft && !dispatch({ type: 'editMessage', id: message.id, draft: body })) {
          return { status: 'blocked', reason: 'storage', notice: NOTICE.publishStoreFailed }
        }
      }
      intent = {
        providerId: session.user.id, workspaceId: state.lineWorkspaceId,
        recipientId: previous?.recipient_id ?? target!.recipient_id!, dedupeKey,
        body,
      }
      // Nothing leaves this browser before the retry intent is stored successfully.
      if (!dispatch({ type: previous ? 'oaRecover' : 'oaStart', id: message.id, delivery: intent })) {
        return { status: 'blocked', reason: 'storage', notice: NOTICE.storage }
      }
      // จากบรรทัดนี้ไป การส่งอาจถึงผู้รับแล้วแม้คำตอบจะไม่กลับมา — ห้ามเสนอทางแชร์เองอีก
      durable = true
      if (previous?.status === 'sent') return settle(previous, intent.providerId)
    }
    const previous = await findDelivery(intent.dedupeKey)
    if (previous && TERMINAL.includes(previous.status)) return settle(previous, intent.providerId)
    return settle(await deliverOa(intent, message.dedupeKey, intent.body), intent.providerId)
  } catch {
    /**
     * แยกสองกรณีที่ผลต่างกันคนละแบบ (ก่อนหน้านี้เป็น 'network' ทั้งคู่):
     * - `durable` = มีรายการ OA ที่บันทึกไว้แล้ว การส่งอาจถึงผู้รับแล้ว → ต้องกดตรวจผล ห้ามแชร์ซ้ำ
     * - ไม่ `durable` = ยังไม่มีอะไรออกจากเครื่องเลย (เช่นเน็ตตายตั้งแต่ `findDelivery`)
     *   → เปิดแอป LINE ให้ครูส่งเองได้ตามปกติ ครูบนเวทีที่ไวไฟตายจึงยังส่งได้
     */
    return durable
      ? { status: 'blocked', reason: 'network', notice: NOTICE.network }
      : { status: 'blocked', reason: 'offline', notice: NOTICE.offline }
  }
}

/** สถานะเชื่อม OA ของผู้จ่ายแต่ละคน — ใช้บอกล่วงหน้าว่าใบไหนจะส่งผ่าน OA ได้ */
export type LinkState = 'linked' | 'not-linked' | 'unknown'

export async function linkStates(state: AppState, clientIds: string[]): Promise<Record<string, LinkState>> {
  const out: Record<string, LinkState> = {}
  // อ่าน session ผ่านตัวเดียวกับ oaAvailable — ที่เก็บที่อ่านไม่ได้ต้องได้ 'unknown' ไม่ใช่ promise ที่ล้ม
  if (!oaAvailable(state) || !state.lineWorkspaceId || !sessionPresent()) {
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
