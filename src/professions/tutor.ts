import type { ProfessionTemplate } from './types'
import { tutorTemplates } from '../copy/tutor'

const tutor: ProfessionTemplate = {
  id: 'tutor',
  name: 'ติวเตอร์',
  status: 'live',
  icon: '📚',
  tagline: 'เช็คชื่อ คิดเงิน ส่งบิล LINE ตรวจสลิป ใบเสร็จ ทวงแทน — ให้ติวเตอร์ที่สอนคนเดียว',
  vocab: {
    subject: 'นักเรียน', subjects: 'นักเรียน', client: 'ผู้ปกครอง', clientHonorific: 'คุณ',
    unit: 'คาบ', units: 'ครั้ง', completion: 'เช็คชื่อ', completionDone: 'เช็คชื่อแล้ว',
    provider: 'ครู', providerSelf: 'ครู',
  },
  defaultBilling: 'per_unit',
  packagePresets: [10, 20],
  dueDays: 3,
  reminderLadder: [
    { minDaysOverdue: 1, key: 'soft' },
    { minDaysOverdue: 4, key: 'clear' },
    { minDaysOverdue: 8, key: 'final' },
  ],
  conciergeAvailable: false,
  messages: tutorTemplates,
  modeLabels: { per_unit: 'รายครั้ง', flat_monthly: 'เหมารายเดือน', package: 'แพ็ก' },
  faq: [
    { priority: 1, keywords: ['จ่ายแล้ว', 'โอนแล้ว', 'ได้รับ', 'สลิป', 'ยังค้าง'], answerFrom: 'paymentStatus' },
    { priority: 2, keywords: ['เหลือกี่ครั้ง', 'เหลือ', 'แพ็ก', 'แพค', 'คอร์ส'], answerFrom: 'packageRemaining' },
    { priority: 3, keywords: ['เรียนไหม', 'มีเรียน', 'พรุ่งนี้', 'วันไหน', 'กี่โมง', 'ตาราง'], answerFrom: 'nextUnit' },
    { priority: 4, keywords: ['เท่าไหร่', 'เท่าไร', 'ยอด', 'ค่าเรียน', 'กี่บาท', 'ราคา'], answerFrom: 'currentInvoice' },
  ],
}
export default tutor
