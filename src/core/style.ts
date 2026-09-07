import type { BillingMode, WorkStyle } from './types'
import type { ScenarioId } from './scenarios'

/**
 * รูปแบบการเก็บเงินที่ติวเตอร์เลือกตอนเข้าใช้ — ไม่รู้อาชีพ รู้แค่ "เก็บเงินยังไง"
 * ใช้เลือกชุดข้อมูลเดโม · ค่าเริ่มต้นตอนเพิ่มลูกค้า · ตัวกรองที่ควรโชว์
 * ไม่เคยเปลี่ยนตัวเลขใน ledger — เป็นเรื่องหน้าจอล้วน
 */
export const STYLES = ['per_unit', 'flat_monthly', 'package', 'mixed'] as const

export const isStyle = (v: unknown): v is WorkStyle => STYLES.includes(v as WorkStyle)

export const scenarioForStyle: Record<WorkStyle, ScenarioId> = {
  per_unit: 'per-unit', flat_monthly: 'flat-heavy', package: 'package-heavy', mixed: 'default',
}

export function styleOfScenario(id: ScenarioId): WorkStyle | undefined {
  if (id === 'empty') return undefined
  const hit = (Object.keys(scenarioForStyle) as WorkStyle[]).find((k) => scenarioForStyle[k] === id)
  return hit ?? 'mixed'
}

export const defaultBillingFor = (style: WorkStyle | undefined): BillingMode['mode'] =>
  !style || style === 'mixed' ? 'per_unit' : style

export const modesFor = (style: WorkStyle | undefined): BillingMode['mode'][] =>
  !style || style === 'mixed' ? ['per_unit', 'flat_monthly', 'package'] : [style]
