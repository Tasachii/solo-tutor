import type { AppState, BillingMode } from '../core/types'

export type FaqSource = 'currentInvoice' | 'nextUnit' | 'packageRemaining' | 'paymentStatus'

export interface FaqRule {
  keywords: string[]
  answerFrom: FaqSource
  /** ลำดับเช็คเมื่อข้อความ match หลายกฎ — เลขน้อยชนะ (paymentStatus=1 … currentInvoice=4) */
  priority: number
}

export interface ProfessionMessages {
  invoice: string
  invoiceFlat: string
  reminder: { soft: string; clear: string; final: string }
  /** ข้อความสั้นให้ครูคัดลอกไปวางเอง — ใช้ยอดคงเหลือและจำนวนครั้งจาก ledger */
  nudge: string
  renewal: string
  renewalExhausted: string
  receipt: string
  moved: string
  cancelled: string
  summary: string
  summaryAmount: string
  summaryPackage: string
  slipRequest: string
  faq: {
    currentInvoice: string; currentInvoiceNone: string; nextUnit: string; nextUnitNone: string
    packageRemaining: string; packageNotPackage: string; paymentPaid: string; paymentUnpaid: string; fallback: string
  }
}

export interface ProfessionTemplate {
  id: string
  name: string
  tagline: string
  icon: string
  status: 'live' | 'coming_soon'
  vocab: {
    subject: string; subjects: string; client: string; clientHonorific: string
    unit: string; units: string; completion: string; completionDone: string
    provider: string; providerSelf: string
  }
  /** โหมดคิดเงินที่ตั้งให้เป็นค่าเริ่มต้น — เก็บแค่ชนิด ไม่ใช่ข้อมูลของลูกค้าจริง */
  defaultBilling?: BillingMode['mode']
  packagePresets?: number[]
  dueDays?: number
  reminderLadder?: { minDaysOverdue: number; key: 'soft' | 'clear' | 'final' }[]
  /** เปิดให้ติ๊ก "ให้ทีมช่วยตั้งให้" ตอนลงชื่อ — อาชีพที่ยังไม่ live ไม่ต้องมี */
  conciergeAvailable?: boolean
  faq?: FaqRule[]
  messages?: ProfessionMessages
  modeLabels?: Partial<Record<BillingMode['mode'], string>>
  mockScenarios?: Record<string, () => Partial<AppState>>
}
