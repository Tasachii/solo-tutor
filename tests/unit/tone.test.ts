import { describe, expect, it } from 'vitest'
import { copy } from '../../src/copy'
import { professions } from '../../src/professions'

/**
 * คำพูดที่ส่งถึงผู้ปกครอง — จุดยืนของสินค้าคือ "แจ้งยอด" ไม่ใช่ "ทวง"
 *
 * ครูที่สอนคนเดียวกลัวเสียความสัมพันธ์กับผู้ปกครองมากกว่ากลัวไม่ได้เงิน คำว่า "ทวง"
 * ทำให้เครื่องมือกลายเป็นเครื่องทวงหนี้ ทั้งที่งานจริงคือช่วยแจ้งว่ายอดเท่าไหร่และค้างมากี่วัน
 * เทสนี้กันคำนั้นหลุดกลับเข้าไปในข้อความที่ผู้ใช้เห็น ไม่ได้ห้ามในคอมเมนต์หรือชื่อตัวแปร
 */
const HARSH = 'ทวง'

/** ข้อกำหนดการใช้งานพูดถึง "ทวงหนี้ในลักษณะข่มขู่" โดยตั้งใจ — เป็นคำตามกฎหมายที่เราห้ามผู้ใช้ทำ */
const ALLOWED = [
  'ห้ามใช้ส่งข้อความรบกวน หลอกลวง หรือทวงหนี้ในลักษณะข่มขู่ ห้ามผูก LINE ของบุคคลที่ไม่ได้ยินยอม เราอาจยกเลิกการเชื่อม OA ที่ถูกร้องเรียน',
]

/** ทุก string ในโครงสร้าง พร้อมเส้นทางที่หาเจอได้ว่าอยู่ตรงไหน */
function strings(value: unknown, path: string): { path: string; text: string }[] {
  if (typeof value === 'string') return [{ path, text: value }]
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => strings(v, `${path}.${k}`))
  }
  return []
}

describe('น้ำเสียงของข้อความที่ผู้ใช้เห็น', () => {
  it('ไม่มีคำว่า "ทวง" ใน copy และในเทมเพลตอาชีพ นอกจากข้อกำหนดที่อ้างคำตามกฎหมาย', () => {
    const all = [...strings(copy, 'copy'), ...strings(professions, 'professions')]
    expect(all.length).toBeGreaterThan(200)
    const offenders = all.filter((s) => s.text.includes(HARSH) && !ALLOWED.includes(s.text))
    expect(offenders.map((s) => `${s.path}: ${s.text}`)).toEqual([])
  })

  it('ข้อความเตือนสามระดับยังพูดว่าแจ้งยอด/ติดตามยอด ไม่ใช่คำสั่งให้จ่าย', () => {
    for (const profession of professions) {
      const ladder = profession.messages?.reminder
      if (!ladder) continue
      for (const [step, text] of Object.entries(ladder)) {
        expect(text, `${profession.id}.${step}`).not.toContain(HARSH)
        expect(text, `${profession.id}.${step}`).toMatch(/ขออนุญาต|รบกวน/)
      }
    }
  })
})
