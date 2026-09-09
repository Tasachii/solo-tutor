// ข้อความถึงลูกค้าทุกประโยค — เสียงของครู ไม่มีคำว่า "ระบบ/อัตโนมัติ/Solo" (หลักการข้อ 8)
export const tutorTemplates = {
  /* {payLine} = "\nโอนได้ที่พร้อมเพย์ …" หรือช่องว่างเมื่อไม่มีเบอร์ให้โชว์ · {qtyNote} = " (เรียนครบ N ครั้ง)" หรือช่องว่างเมื่อยังไม่มีคาบ */
  invoice:
    'เรียน{clientHonorific}{clientName} 🙏 ขอแจ้งค่าเรียน{subjectName} เดือน {periodThai} รวม {qty} ครั้ง เป็นเงิน {total} บาท{p}{payLine}\nสแกน QR หรือดูรายละเอียดได้ที่ {invoiceUrl}\nเมื่อโอนแล้วรบกวนส่งสลิปในแชทนี้ได้เลย{p} ขอบคุณ{p}',
  invoiceFlat:
    'เรียน{clientHonorific}{clientName} 🙏 ขอแจ้งค่าเรียน{subjectName} เดือน {periodThai} {total} บาท{p}{qtyNote}{payLine}\nสแกน QR หรือดูรายละเอียดได้ที่ {invoiceUrl}\nเมื่อโอนแล้วรบกวนส่งสลิปในแชทนี้ได้เลย{p} ขอบคุณ{p}',
  reminder: {
    soft: 'เรียน{clientHonorific}{clientName} ขออนุญาตเรียนแจ้งค่าเรียน{subjectName} เดือน {periodThai} {total} บาท ที่ยังไม่ได้รับยอด{p} หากโอนแล้วรบกวนส่งสลิปให้ด้วยนะ{pq} รายละเอียดที่ {invoiceUrl} ขอบคุณ{p} 🙏',
    clear: 'เรียน{clientHonorific}{clientName} ขออนุญาตติดตามค่าเรียน{subjectName} เดือน {periodThai} {total} บาท ซึ่งเลยกำหนดมา {daysOverdue} วัน{p} หากสะดวก รบกวนชำระภายในวันนี้หรือพรุ่งนี้ได้ไหม{pq} รายละเอียดที่ {invoiceUrl} ขอบคุณ{p} 🙏',
    final: 'เรียน{clientHonorific}{clientName} ขออนุญาตเรียนแจ้งเรื่องค่าเรียน{subjectName} เดือน {periodThai} {total} บาท อีกครั้ง{p} หากมีเรื่องการชำระที่อยากปรึกษา ทักครูมาคุยได้เลยนะ{pq} ยินดีเสมอ{p} รายละเอียดที่ {invoiceUrl} 🙏',
  },
  nudge:
    'สวัสดี{p} {clientHonorific}{clientName} เดือน {periodThai} {subjectName}เรียนไป {qty} ครั้ง ยอดคงเหลือ {total} บาท{p} สแกนโอนได้ตามสะดวกเลยนะ{pq} ขอบคุณ{p}',
  homework:
    'สวัสดี{p} {clientHonorific}{clientName} การบ้านของ{subjectName} วัน{dayThai}ที่ {dateThai}{p}: {text} รบกวนช่วยดูให้ด้วยนะ{pq} ขอบคุณ{p} 🙏',
  homeworkAssign:
    'สวัสดี{p} {clientHonorific}{clientName} การบ้านของ{subjectName} วัน{dayThai}ที่ {dateThai}{p}: {text} ส่งภายในวัน{dueDayThai}ที่ {dueDateThai}นะ{pq} รบกวนช่วยดูให้ด้วยนะ{pq} ขอบคุณ{p} 🙏',
  homeworkReminder:
    'สวัสดี{p} {clientHonorific}{clientName} ขออนุญาตติดตามการบ้านของ{subjectName} ที่มอบหมายเมื่อวัน{dayThai}ที่ {dateThai} ({text}) ครบกำหนดส่งวัน{dueDayThai}ที่ {dueDateThai} ตอนนี้เลยมา {daysLate} วันแล้ว{p} รบกวนช่วยเตือนน้องส่งให้ด้วยนะ{pq} ขอบคุณ{p} 🙏',
  renewal:
    'เรียน{clientHonorific}{clientName} ขอเรียนแจ้งว่าแพ็ก {packageTotal} ครั้งของ{subjectName} เหลืออีก {remaining} ครั้ง{p} หากสนใจต่อแพ็กใหม่ {packageTotal} ครั้ง {packagePrice} บาท ดูรายละเอียดได้ที่ {invoiceUrl} {p} 🙏',
  renewalExhausted:
    'เรียน{clientHonorific}{clientName} ขอเรียนแจ้งว่าแพ็ก {packageTotal} ครั้งของ{subjectName} ใช้ครบแล้ว{p} วันนี้เป็นครั้งที่ {overBy} นอกแพ็ก หากสนใจต่อแพ็กใหม่ {packageTotal} ครั้ง {packagePrice} บาท ดูรายละเอียดได้ที่ {invoiceUrl} {p} 🙏',
  receipt:
    'ได้รับยอด {total} บาท ค่าเรียน{subjectName} เดือน {periodThai} เรียบร้อยแล้ว{p} ขอบคุณมาก{p} 🙏 ใบเสร็จ: {receiptUrl}',
  moved:
    'เรียน{clientHonorific}{clientName} ขอเลื่อนคาบ{subjectName}จากวัน{fromDayThai}ที่ {fromDateThai} ไปเป็นวัน{dayThai}ที่ {dateThai} เวลา {time} {p} ขออภัยในความไม่สะดวก{p} 🙏',
  cancelled:
    'เรียน{clientHonorific}{clientName} ขอแจ้งงดคาบ{subjectName}วัน{dayThai}ที่ {dateThai} {p} เดี๋ยวครูนัดชดเชยแล้วแจ้งอีกทีนะ{pq} 🙏',
  summary:
    'เรียน{clientHonorific}{clientName} สรุป{subjectName} เดือน {periodThai} {p} เรียนไปแล้ว {qty} ครั้ง {amountLine}',
  summaryAmount: 'ยอดตอนนี้ {total} บาท',
  summaryPackage: 'เหลืออีก {remaining} จาก {packageTotal} ครั้ง',
  slipRequest:
    'เรียน{clientHonorific}{clientName} ขอบคุณสำหรับสลิป{p} ยอดที่ได้รับ {slipAmount} บาท ส่วนค่าเรียนเดือนนี้ {total} บาท รบกวนช่วยตรวจสอบหรือส่งสลิปอีกครั้งได้ไหม{pq} ขอบคุณ{p} 🙏',
  faq: {
    currentInvoice: 'เดือน {periodThai} {subjectName}เรียน {qty} ครั้ง รวม {total} บาท{p} ดูรายละเอียดชำระเงินที่ {invoiceUrl}',
    currentInvoiceNone: '{subjectName}เดือนนี้ยังไม่ปิดยอด{p} ตอนนี้เรียนไป {completedSoFar} ครั้ง ประมาณ {estimate} บาท จะส่งใบแจ้งสิ้นเดือนนะ{pq}',
    nextUnit: '{subjectName}มีเรียนครั้งถัดไปวัน{dayThai}ที่ {dateThai} เวลา {time} {p}',
    nextUnitNone: 'ตอนนี้ยังไม่มีคาบถัดไปในตาราง{p} เดี๋ยวครูนัดเพิ่มแล้วแจ้งนะ{pq}',
    packageRemaining: 'แพ็ก {packageTotal} ครั้งของ{subjectName} ใช้ไป {used} เหลือ {remaining} ครั้ง{p}',
    packageNotPackage: '{subjectName}เป็นแบบ{modeThai}{p} ไม่ได้ใช้แพ็ก',
    paymentPaid: 'ได้รับยอด {total} บาทแล้ว{p} ใบเสร็จ {receiptUrl}',
    paymentUnpaid: 'ยังมียอดคงเหลือ {total} บาท{p} ดูรายละเอียดชำระเงินที่ {invoiceUrl} แล้วส่งสลิปกลับในแชท{p}',
    fallback: 'ขอบคุณที่สอบถาม{p} เดี๋ยวครูตอบเองนะ{pq}',
  },
} as const

export const modeThai = (mode: 'per_unit' | 'flat_monthly' | 'package'): string =>
  mode === 'per_unit' ? 'รายครั้ง' : mode === 'flat_monthly' ? 'เหมารายเดือน' : 'แพ็ก'
