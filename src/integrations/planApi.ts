import { request, rpc } from './supabaseRest'
import type { PlanInfo } from '../core/plan'

type PlanRow = { plan?: unknown; plan_until?: unknown; paused_at?: unknown }
const toInfo = (row: PlanRow | undefined, at: string): PlanInfo | null => {
  if (!row || (row.plan !== 'free' && row.plan !== 'pro')) return null
  return {
    plan: row.plan, planUntil: typeof row.plan_until === 'string' ? row.plan_until : null,
    pausedAt: typeof row.paused_at === 'string' ? row.paused_at : null, fetchedAt: at,
  }
}

export async function readPlan(): Promise<PlanInfo | null> {
  const rows = await request<PlanRow[]>('/rest/v1/providers?select=plan,plan_until,paused_at&limit=1')
  return toInfo(Array.isArray(rows) ? rows[0] : undefined, new Date().toISOString())
}

export interface PlanRequestRow {
  id: string; months: number; amount: number; note: string | null
  status: 'pending' | 'approved' | 'rejected'; created_at: string; decided_at: string | null; receipt_no: string | null
}

export const listPlanRequests = (): Promise<PlanRequestRow[]> =>
  request<PlanRequestRow[]>('/rest/v1/plan_requests?select=id,months,amount,note,status,created_at,decided_at,receipt_no&order=created_at.desc&limit=20')

/** ยอดเงินคำนวณฝั่งเซิร์ฟเวอร์จากจำนวนเดือน — client ส่งแค่เดือนกับโน้ต */
export const requestPlan = (months: number, note: string): Promise<PlanRequestRow[]> =>
  rpc<PlanRequestRow[]>('request_plan', { p_months: months, p_note: note.slice(0, 200) })
export const cancelPlanRequest = (): Promise<boolean> => rpc<boolean>('cancel_plan_request', {})

export const pausePlan = async (): Promise<PlanInfo | null> =>
  toInfo((await rpc<PlanRow[]>('pause_plan', {}))[0], new Date().toISOString())
export const resumePlan = async (): Promise<PlanInfo | null> =>
  toInfo((await rpc<PlanRow[]>('resume_plan', {}))[0], new Date().toISOString())
