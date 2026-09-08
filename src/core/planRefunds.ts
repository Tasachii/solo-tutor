/**
 * การคืนเงินค่าสมาชิกที่ครูมองเห็นได้ (D-08)
 *
 * ยอดทุกตัวมาจาก `list_plan_refunds()` ซึ่งอ่านจากหลักฐานการโอนฝั่งเซิร์ฟเวอร์
 * เบราว์เซอร์ไม่เคยเป็นคนกำหนดว่าคืนไปเท่าไร ทำได้แค่จัดกลุ่มตัวเลขที่เซิร์ฟเวอร์ส่งมา
 *
 * เลขอ้างอิงธนาคารและชื่อผู้ตรวจเป็นข้อมูลปฏิบัติการ ฟังก์ชันฝั่งเซิร์ฟเวอร์จึงไม่ส่งมา
 * และที่นี่ก็ไม่มีที่ให้เก็บ
 */
import { rpc, SupabaseRestError } from '../integrations/supabaseRest'

export interface PlanRefundRow {
  refund_id: string
  plan_request_id: string
  receipt_no: string | null
  /** ยอดที่ทีมยืนยันกับรายการเดินบัญชี ไม่ใช่ยอดที่คำขอเคยขอไว้ */
  paid_amount: number
  refunded_amount: number
  /** ยอดคืนสะสมของ payment ใบเดียวกัน คำนวณฝั่งเซิร์ฟเวอร์ */
  refunded_total: number
  occurred_at: string
}

export interface RefundEntry { id: string; amount: number; occurredAt: string }
export type RefundState = 'partial' | 'full'
export interface ReceiptRefund {
  paid: number
  refunded: number
  net: number
  state: RefundState
  entries: RefundEntry[]
}

const isBaht = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

const toRow = (value: unknown): PlanRefundRow | null => {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const refundId = text(row.refund_id)
  const requestId = text(row.plan_request_id)
  const occurredAt = text(row.occurred_at)
  if (!refundId || !requestId || !occurredAt) return null
  if (!isBaht(row.paid_amount) || !isBaht(row.refunded_amount) || !isBaht(row.refunded_total)) return null
  return {
    refund_id: refundId,
    plan_request_id: requestId,
    receipt_no: text(row.receipt_no),
    paid_amount: row.paid_amount,
    refunded_amount: row.refunded_amount,
    refunded_total: row.refunded_total,
    occurred_at: occurredAt,
  }
}

/**
 * แถวเดียวที่อ่านไม่ออก = ทั้งชุดเชื่อไม่ได้ จึงโยนออกไปให้หน้าจอบอกครูว่าตรวจไม่สำเร็จ
 * ถ้าเงียบ ๆ ข้ามแถวไป ใบเสร็จจะกลับไปแสดงยอดเต็มทั้งที่เงินคืนไปแล้ว ซึ่งคือบั๊กเดิม
 */
export const listPlanRefunds = async (): Promise<PlanRefundRow[]> => {
  const rows = await rpc<unknown>('list_plan_refunds', {})
  if (!Array.isArray(rows)) throw new Error('invalid refund response')
  return rows.map((row) => {
    const parsed = toRow(row)
    if (!parsed) throw new Error('invalid refund row')
    return parsed
  })
}

/**
 * ฐานยังไม่มีคำสั่งนี้ (ยังไม่ได้ apply migration) ตอบ 404 — หลังบ้านแบบนั้นยังไม่มีการคืนเงิน
 * ให้มีได้เลย จึงไม่ใช่ความผิดปกติของใบเสร็จใบไหน ต่างจากคำขอที่ล้มหรือแถวที่อ่านไม่ออก
 * ซึ่งแปลว่าอาจมีการคืนเงินอยู่แต่เรายังไม่เห็น ตรงกับที่ documentPublish.ts แยกไว้
 */
export const refundsUnsupported = (error: unknown): boolean =>
  error instanceof SupabaseRestError && error.status === 404

/**
 * รวมแถวคืนเงินเป็นสรุปต่อหนึ่งใบเสร็จ (คำขอหนึ่งใบมี payment ได้ใบเดียวตาม 0010)
 * ยอดคืนใช้ค่าที่มากที่สุดระหว่างผลรวมของแถวกับยอดสะสมจากเซิร์ฟเวอร์ — ถ้าข้อมูลมาไม่ครบ
 * ต้องแสดงคืนเงินมากเกินไว้ก่อน ไม่ใช่แสดงน้อยกว่าที่คืนจริง
 */
export function summarizeRefunds(rows: PlanRefundRow[]): Map<string, ReceiptRefund> {
  const byRequest = new Map<string, ReceiptRefund>()
  for (const row of rows) {
    const current = byRequest.get(row.plan_request_id)
    const entries = [...(current?.entries ?? []), { id: row.refund_id, amount: row.refunded_amount, occurredAt: row.occurred_at }]
    const listed = entries.reduce((total, entry) => total + entry.amount, 0)
    const paid = Math.max(current?.paid ?? 0, row.paid_amount)
    const refunded = Math.max(current?.refunded ?? 0, listed, row.refunded_total)
    byRequest.set(row.plan_request_id, {
      paid,
      refunded,
      net: Math.max(0, paid - refunded),
      state: refunded >= paid ? 'full' : 'partial',
      entries,
    })
  }
  return byRequest
}
