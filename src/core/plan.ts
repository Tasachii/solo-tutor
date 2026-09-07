import type { AppState, ISODate } from './types'

/**
 * แพ็กสมาชิกของครู — เรื่องของบัญชี ไม่ใช่ของสมุดบัญชี จึงอยู่นอก AppState
 * ค่าที่เก็บในเครื่องคือสำเนาล่าสุดจากเซิร์ฟเวอร์ ไม่มีบัญชี = ฟรี · ออฟไลน์ = ใช้สำเนาเดิม
 * เพดานฟรีบังคับที่หน้าจอ (บอกครูว่าติดอะไร) ไม่ใช่ใน reducer ที่ปฏิเสธเงียบ ๆ
 */
export const FREE_STUDENT_CAP = 5
export const PLAN_KEY = 'solo-plan'

export interface PlanInfo {
  plan: 'free' | 'pro'
  planUntil: ISODate | null
  pausedAt: string | null
  fetchedAt: string
}

export const readPlanInfo = (): PlanInfo | null => {
  try {
    const raw = localStorage.getItem(PLAN_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<PlanInfo>
    if ((p.plan !== 'free' && p.plan !== 'pro') || typeof p.fetchedAt !== 'string') return null
    return { plan: p.plan, planUntil: typeof p.planUntil === 'string' ? p.planUntil : null, pausedAt: typeof p.pausedAt === 'string' ? p.pausedAt : null, fetchedAt: p.fetchedAt }
  } catch {
    return null
  }
}
export const writePlanInfo = (p: PlanInfo | null): void => {
  try {
    if (p) localStorage.setItem(PLAN_KEY, JSON.stringify(p))
    else localStorage.removeItem(PLAN_KEY)
  } catch { /* เก็บไม่ได้ = รอบหน้าถือว่าฟรี ปลอดภัยกว่าเดาว่า Pro */ }
}

/** Pro ที่ใช้ได้จริงวันนี้ — พักอยู่ถือว่าไม่ได้ใช้ (วันไม่ถูกนับ แต่ก็ไม่ได้สิทธิ์) หมดอายุแล้วก็กลับเป็นฟรี */
export const isPro = (info: PlanInfo | null, today: ISODate): boolean =>
  !!info && info.plan === 'pro' && info.pausedAt === null && info.planUntil !== null && info.planUntil >= today

export const daysLeft = (info: PlanInfo | null, today: ISODate): number | null => {
  if (!info || info.plan !== 'pro' || !info.planUntil) return null
  const ms = Date.parse(`${info.planUntil}T00:00:00+07:00`) - Date.parse(`${today}T00:00:00+07:00`)
  return Math.max(0, Math.round(ms / 86_400_000))
}

export const activeStudents = (s: AppState): number => s.subjects.filter((x) => x.active).length

export interface CapIssue { have: number; cap: number; adding: number }

/** null = เพิ่มได้ · อย่างอื่น = ติดเพดานฟรี (เฉพาะโหมดจริง เดโมไม่จำกัด) */
export function studentCapIssue(s: AppState, info: PlanInfo | null, adding: number): CapIssue | null {
  if (s.mode !== 'real' || adding <= 0) return null
  if (isPro(info, s.today)) return null
  const have = activeStudents(s)
  return have + adding > FREE_STUDENT_CAP ? { have, cap: FREE_STUDENT_CAP, adding } : null
}
