import type { EventLog } from './types'

/**
 * "ลอง Demo จนครบลูป" วัดจากงานที่ผู้ใช้กดจริง ไม่ใช่ความยาวรายการ
 * กู้คืนไฟล์ ดึงคลาวด์ หรือสลับชุดตัวอย่าง ทำให้รายการยาวขึ้นโดยไม่มีใครลงมือทำ
 * สองขั้นนี้คือคุณค่าแรกของแอป: บันทึกคาบที่สอนแล้ว แล้วปิดยอดออกบิลของรอบนั้น
 * ทั้งคู่ถูก track หลัง dispatch สำเร็จเท่านั้น (Today.tsx, Billing.tsx) จึงเป็นผลของ action จริง
 */
export const DEMO_LOOP_STEPS = ['complete_unit', 'close_month'] as const
export type DemoLoopStep = (typeof DEMO_LOOP_STEPS)[number]
export type StepCounts = Record<DemoLoopStep, number>

export const emptyStepCounts = (): StepCounts => ({ complete_unit: 0, close_month: 0 })

/** นับจากบันทึกเหตุการณ์ของ store — บันทึกถูกตัดที่ 500 รายการ จึงเทียบ "เพิ่มขึ้น" ไม่ใช่ค่าสัมบูรณ์ */
export function countDemoSteps(events: readonly EventLog[]): StepCounts {
  const counts = emptyStepCounts()
  for (const entry of events) {
    if (entry.name === 'complete_unit') counts.complete_unit += 1
    else if (entry.name === 'close_month') counts.close_month += 1
  }
  return counts
}

/** ขั้นจะ "ได้มา" ก็ต่อเมื่อจำนวนเพิ่มขึ้นระหว่างสองสถานะที่ไม่ได้ยกสมุดบัญชีทั้งก้อน */
export function earnedSteps(previous: StepCounts, current: StepCounts, earned: readonly DemoLoopStep[]): DemoLoopStep[] {
  const next = new Set(earned)
  for (const step of DEMO_LOOP_STEPS) if (current[step] > previous[step]) next.add(step)
  return DEMO_LOOP_STEPS.filter((step) => next.has(step))
}

export function demoLoopComplete(earned: readonly DemoLoopStep[]): boolean {
  return DEMO_LOOP_STEPS.every((step) => earned.includes(step))
}
