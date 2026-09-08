import { invoke, request, rpc } from './supabaseRest'
import type { Client, OaDelivery } from '../core/types'

export interface LineChannel {
  status: 'pending' | 'active' | 'setup_failed' | 'invalid' | 'disabled'
  display_name: string | null; basic_id: string | null
  quota_used: number; quota_limit: number; quota_month: string; last_verified_at: string | null
}
export interface DeliveryTarget {
  eligible: boolean; reason: string; client_id: string; recipient_id: string | null; channel_status: string | null
  unfollowed_at: string | null; quota_used: number; quota_limit: number
}
export interface OutboxRow {
  id: string; status: 'queued' | 'processing' | 'sent' | 'failed' | 'skipped' | 'manual_review'
  recipient_id: string; body: string; message_id: string; last_error: string | null
}
export async function readChannel(): Promise<LineChannel | null> {
  const rows = await request<LineChannel[]>('/rest/v1/line_channel_public?select=*')
  return rows[0] ?? null
}
export const syncClients = (workspace: string, clients: Client[]) =>
  rpc<{ local_client_key: string; client_id: string }[]>('sync_line_workspace_clients', {
    p_workspace_key: workspace, p_clients: clients.map(c => ({ id: c.id, name: c.name })),
  })
/**
 * สั่งลบข้อมูลผู้ปกครองบนเซิร์ฟเวอร์ — ชื่อ · การผูก LINE · แชทขาเข้า · เนื้อความที่เคยส่ง
 *
 * รับได้เฉพาะคีย์ที่มาจากใบสั่งลบผู้จ่ายในสมุดบัญชี (erasableClientKeys) เท่านั้น
 * ห้ามส่งผลลัพธ์ของการ "ไม่เจอชื่อในรายชื่อ" เข้ามาที่นี่เด็ดขาด — เครื่องที่ถือสมุดบัญชีรุ่นเก่า
 * จะลบผู้ปกครองที่ยังเป็นลูกค้าอยู่ทิ้งทั้งหมด (ดู migration 0018 และ src/core/tombstones.ts)
 * ปลอดภัยเมื่อเรียกซ้ำ: คีย์ที่ลบไปแล้วหรือไม่เคยซิงก์ คืน erased=false โดยไม่แตะอะไร
 */
export const eraseClients = (workspace: string, localClientKeys: string[]) =>
  rpc<{ local_client_key: string; erased: boolean }[]>('erase_line_workspace_clients', {
    p_workspace_key: workspace, p_local_client_keys: localClientKeys,
  })
export async function deliveryTarget(workspace: string, clientId: string): Promise<DeliveryTarget | null> {
  const rows = await rpc<DeliveryTarget[]>('line_delivery_target', { p_workspace_key: workspace, p_local_client_key: clientId })
  return rows[0] ?? null
}
export async function findDelivery(dedupeKey: string): Promise<OutboxRow | null> {
  const params = new URLSearchParams({ select: 'id,status,recipient_id,body,message_id,last_error', dedupe_key: `eq.${dedupeKey}` })
  const rows = await request<OutboxRow[]>(`/rest/v1/message_outbox?${params}`)
  return rows[0] ?? null
}
/** The same durable intent always enqueues the same row and sends only that row. */
export async function deliverOa(delivery: OaDelivery, messageId: string, body: string): Promise<OutboxRow | null> {
  const outboxId = await rpc<string>('enqueue_line_message', {
    p_recipient_id: delivery.recipientId, p_message_id: messageId, p_body: body, p_dedupe_key: delivery.dedupeKey,
  })
  await invoke('line-send', { outboxId })
  return findDelivery(delivery.dedupeKey)
}
