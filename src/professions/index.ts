import type { ProfessionTemplate } from './types'
import tutor from './tutor'
import nail from './nail'
import barber from './barber'
import fortune from './fortune'
import massage from './massage'
import type { BillingMode } from '../core/types'
import type { ProfessionMessages } from './types'

/** อาชีพใหม่ = เพิ่มไฟล์เดียวแล้วใส่ใน list นี้ */
export const professions: ProfessionTemplate[] = [tutor, nail, barber, fortune, massage]

export function professionById(id: string): ProfessionTemplate {
  return professions.find((p) => p.id === id) ?? professions[0]
}

const genericTemplates = (profession: ProfessionTemplate): ProfessionMessages => {
  const v = profession.vocab
  return {
    invoice: `เรียน{clientHonorific}{clientName} 🙏 ขอแจ้งค่าบริการ{subjectName} เดือน {periodThai} รวม {qty} ${v.units} เป็นเงิน {total} บาท{p}\nดูรายละเอียดและช่องทางชำระได้ที่ {invoiceUrl} เมื่อโอนแล้วรบกวนส่งสลิปในแชทนี้ได้เลย{p} ขอบคุณ{p}`,
    invoiceFlat: `เรียน{clientHonorific}{clientName} 🙏 ขอแจ้งค่าบริการ{subjectName} เดือน {periodThai} {total} บาท{p} ({qty} ${v.units})\nดูรายละเอียดและช่องทางชำระได้ที่ {invoiceUrl} เมื่อโอนแล้วรบกวนส่งสลิปในแชทนี้ได้เลย{p} ขอบคุณ{p}`,
    reminder: {
      soft: 'เรียน{clientHonorific}{clientName} ขออนุญาตเรียนแจ้งยอดค่าบริการ{subjectName} เดือน {periodThai} {total} บาท ที่ยังไม่ได้รับยอด{p} หากโอนแล้วรบกวนส่งสลิปให้ด้วยนะ{pq} รายละเอียดที่ {invoiceUrl} ขอบคุณ{p} 🙏',
      clear: 'เรียน{clientHonorific}{clientName} ขออนุญาตติดตามยอดค่าบริการ{subjectName} เดือน {periodThai} {total} บาท ซึ่งเลยกำหนดมา {daysOverdue} วัน{p} หากสะดวก รบกวนชำระภายในวันนี้หรือพรุ่งนี้ได้ไหม{pq} รายละเอียดที่ {invoiceUrl} ขอบคุณ{p} 🙏',
      final: 'เรียน{clientHonorific}{clientName} ขออนุญาตเรียนแจ้งเรื่องยอดค่าบริการ{subjectName} เดือน {periodThai} {total} บาท อีกครั้ง{p} หากมีเรื่องการชำระที่อยากปรึกษา ทักมาคุยได้เลยนะ{pq} ยินดีเสมอ{p} รายละเอียดที่ {invoiceUrl} 🙏',
    },
    nudge: `สวัสดี{p} {clientHonorific}{clientName} เดือน {periodThai} {subjectName}ทำไป {qty} ${v.units} ยอดคงเหลือ {total} บาท{p} สแกนโอนได้ตามสะดวกเลยนะ{pq} ขอบคุณ{p}`,
    homework: 'สวัสดี{p} {clientHonorific}{clientName} วัน{dayThai}ที่ {dateThai} ของ{subjectName} มีสิ่งที่ฝากไว้{p}: {text} ขอบคุณ{p} 🙏',
    renewal: `เรียน{clientHonorific}{clientName} แพ็ก {packageTotal} ${v.units}ของ{subjectName} เหลือ {remaining} ${v.units}{p} ต่อแพ็กใหม่ {packageTotal} ${v.units} {packagePrice} บาท ดูรายละเอียดที่ {invoiceUrl}`,
    renewalExhausted: `เรียน{clientHonorific}{clientName} แพ็ก {packageTotal} ${v.units}ของ{subjectName} ครบแล้ว{p} รอบล่าสุดเป็นครั้งที่ {overBy} นอกแพ็ก ต่อแพ็กใหม่ {packageTotal} ${v.units} {packagePrice} บาท ดูรายละเอียดที่ {invoiceUrl}`,
    receipt: 'ได้รับยอด {total} บาทของ{subjectName} เดือน {periodThai} แล้ว{p} ขอบคุณ{p} 🙏 ใบเสร็จ: {receiptUrl}',
    moved: `เรียน{clientHonorific}{clientName} ขอเลื่อน${v.unit}ของ{subjectName}จากวัน{fromDayThai}ที่ {fromDateThai} ไปเป็นวัน{dayThai}ที่ {dateThai} เวลา {time} {p} ขออภัยในความไม่สะดวก{p} 🙏`,
    cancelled: `เรียน{clientHonorific}{clientName} ขอแจ้งงด${v.unit}ของ{subjectName}วัน{dayThai}ที่ {dateThai} {p} จะแจ้งนัดใหม่อีกครั้ง{p} 🙏`,
    summary: `เรียน{clientHonorific}{clientName} สรุป{subjectName} เดือน {periodThai} {p} ทำไปแล้ว {qty} ${v.units} {amountLine}`,
    summaryAmount: 'ยอดตอนนี้ {total} บาท',
    summaryPackage: `เหลืออีก {remaining} จาก {packageTotal} ${v.units}`,
    slipRequest: 'เรียน{clientHonorific}{clientName} ขอบคุณสำหรับสลิป{p} ยอดที่ได้รับ {slipAmount} บาท ส่วนยอดค่าบริการเดือนนี้ {total} บาท รบกวนช่วยตรวจสอบหรือส่งสลิปอีกครั้งได้ไหม{pq} ขอบคุณ{p} 🙏',
    faq: {
      currentInvoice: `เดือน {periodThai} {subjectName}มี {qty} ${v.units} รวม {total} บาท{p} ดูรายละเอียดชำระเงินที่ {invoiceUrl}`,
      currentInvoiceNone: `{subjectName}เดือนนี้ยังไม่ปิดยอด{p} ตอนนี้ทำไป {completedSoFar} ${v.units} ประมาณ {estimate} บาท จะแจ้งยอดเมื่อสรุปรอบ{p}`,
      nextUnit: `{subjectName}มี${v.unit}ครั้งถัดไปวัน{dayThai}ที่ {dateThai} เวลา {time} {p}`,
      nextUnitNone: `ตอนนี้ยังไม่มี${v.unit}ถัดไปในตาราง{p} จะแจ้งเมื่อเพิ่มนัด{p}`,
      packageRemaining: `แพ็ก {packageTotal} ${v.units}ของ{subjectName} ใช้ไป {used} เหลือ {remaining} ${v.units}{p}`,
      packageNotPackage: '{subjectName}เป็นแบบ{modeThai}{p} ไม่ได้ใช้แพ็ก',
      paymentPaid: 'ได้รับยอด {total} บาทแล้ว{p} ใบเสร็จ {receiptUrl}',
      paymentUnpaid: 'ยังมียอดคงเหลือ {total} บาท{p} ดูรายละเอียดชำระเงินที่ {invoiceUrl} แล้วส่งสลิปกลับในแชท{p}',
      fallback: `ขอบคุณที่สอบถาม{p} เดี๋ยว${v.providerSelf}ตอบเองนะ{pq}`,
    },
  }
}

export const templatesFor = (professionId: string): ProfessionMessages => {
  const profession = professionById(professionId)
  return profession.messages ?? genericTemplates(profession)
}

export const modeLabelFor = (professionId: string, mode: BillingMode['mode']): string => {
  const profession = professionById(professionId)
  return profession.modeLabels?.[mode]
    ?? (mode === 'per_unit' ? `ราย${profession.vocab.unit}` : mode === 'flat_monthly' ? 'เหมารายเดือน' : 'แพ็ก')
}

/** แทน {unit} {units} {completion} {client} {subject} … ด้วยคำของอาชีพ */
export const fillVocab = (text: string, vocab: ProfessionTemplate['vocab']): string =>
  text.replace(/\{(\w+)\}/g, (_m, k: string) => (vocab as Record<string, string>)[k] ?? `{${k}}`)
