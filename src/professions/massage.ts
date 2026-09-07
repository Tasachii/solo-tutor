import type { ProfessionTemplate } from './types'
const massage: ProfessionTemplate = {
  id: 'massage', name: 'หมอนวด', status: 'coming_soon', icon: '💆',
  tagline: 'นัดลูกค้าประจำ นับครั้ง คิดเงิน ออกใบเสร็จ ให้หมอนวดที่รับงานเอง',
  defaultBilling: 'per_unit',
  vocab: {
    subject: 'ลูกค้า', subjects: 'ลูกค้า', client: 'ลูกค้า', clientHonorific: 'คุณ',
    unit: 'ครั้ง', units: 'ครั้ง', completion: 'ยืนยันครั้ง', completionDone: 'นวดแล้ว',
    provider: 'หมอนวด', providerSelf: 'หมอนวด',
  },
}
export default massage
