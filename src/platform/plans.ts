/** ราคาแพ็ก — ดัชนีตรงกับ copy.pricing.plans · ฝั่งเซิร์ฟเวอร์มีสำเนาใน plan_price() (0006_plans.sql) ต้องตรงกัน */
export const PLANS: { months: number; price: number }[] = [
  { months: 0, price: 0 },
  { months: 1, price: 299 },
  { months: 3, price: 799 },
  { months: 12, price: 2490 },
]
export const PRICES: number[] = PLANS.map((p) => p.price)
export const MONTHS: number[] = PLANS.map((p) => p.months)
