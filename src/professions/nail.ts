import type { ProfessionTemplate } from './types'
const nail: ProfessionTemplate = {
  id: 'nail', name: 'ช่างทำเล็บ', status: 'coming_soon', icon: '💅',
  tagline: 'นัด เตือน ตัดคอร์ส ทวง ใบเสร็จ ให้ร้านเล็บที่ทำคนเดียว',
  defaultBilling: 'package',
  vocab: {
    subject: 'ลูกค้า', subjects: 'ลูกค้า', client: 'ลูกค้า', clientHonorific: 'คุณ',
    unit: 'คิว', units: 'ครั้ง', completion: 'ยืนยันคิว', completionDone: 'ทำแล้ว',
    provider: 'ช่าง', providerSelf: 'ช่าง',
  },
}
export default nail
