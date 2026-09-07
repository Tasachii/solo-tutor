import type { ProfessionTemplate } from './types'
const fortune: ProfessionTemplate = {
  id: 'fortune', name: 'หมอดู', status: 'coming_soon', icon: '🔮',
  tagline: 'นัดดูดวง เก็บเงินรายรอบหรือเป็นแพ็ก ออกใบเสร็จ ให้หมอดูที่รับเอง',
  defaultBilling: 'per_unit',
  vocab: {
    subject: 'ผู้รับคำปรึกษา', subjects: 'ผู้รับคำปรึกษา', client: 'ผู้รับคำปรึกษา', clientHonorific: 'คุณ',
    unit: 'รอบ', units: 'รอบ', completion: 'ยืนยันรอบ', completionDone: 'ดูแล้ว',
    provider: 'หมอดู', providerSelf: 'หมอดู',
  },
}
export default fortune
