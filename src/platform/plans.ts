/** ราคาแพ็ก — ดัชนีตรงกับ copy.pricing.plans · ฝั่งเซิร์ฟเวอร์มีสำเนาใน plan_price() (0006_plans.sql) ต้องตรงกัน */
export const PLANS: { months: number; price: number }[] = [
  { months: 0, price: 0 },
  { months: 1, price: 299 },
  { months: 3, price: 799 },
  { months: 12, price: 2490 },
]
export const PRICES: number[] = PLANS.map((p) => p.price)
export const MONTHS: number[] = PLANS.map((p) => p.months)

const PLAN_INTENT_KEY = 'solo-tutor:requested-plan'
export const validPaidPlanMonths = (value: unknown): number | null => {
  const months = typeof value === 'number' ? value : Number(value)
  return PLANS.some((plan) => plan.months === months && months > 0) ? months : null
}
export const rememberPlanIntent = (months: number | null): void => {
  try {
    if (months) sessionStorage.setItem(PLAN_INTENT_KEY, String(months))
    else sessionStorage.removeItem(PLAN_INTENT_KEY)
  } catch { /* URL ยังเป็น fallback เมื่อ storage ใช้ไม่ได้ */ }
}
export const readPlanIntent = (): number | null => {
  try { return validPaidPlanMonths(sessionStorage.getItem(PLAN_INTENT_KEY)) } catch { return null }
}
