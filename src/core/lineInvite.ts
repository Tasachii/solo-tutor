import type { Particle } from './types'
import { particleVars } from './particle'

/**
 * ข้อความเชิญผู้ปกครองให้ผูก LINE OA — ครูคัดลอกไปวางในแชทเดิมที่คุยกับผู้ปกครองอยู่แล้ว
 *
 * เจ้าของถามหลังส่งบิลจริงใบแรก (9 ก.ย.) ว่า "ต้องให้ผู้ปกครองแอด OA ด้วย จะใส่ตรงไหนของเว็บ"
 * คำตอบ: ไม่ต้องมีหน้าใหม่ — ผู้ปกครองต้องรู้สองอย่างพร้อมกันคือลิงก์แอดกับรหัส 6 หลัก
 * และช่องทางเดียวที่เขาอ่านแน่คือแชทกับครู ข้อความนี้จึงรวมทั้งสองอย่างไว้ในน้ำเสียงครู
 * ไม่มีคำว่า "ระบบ" หรือ "Solo Tutor" ในข้อความ — ผู้ปกครองคุยกับครู ไม่ได้คุยกับแอป
 */
export interface LineInviteInput {
  clientName: string
  code: string
  /** ลิงก์เพิ่มเพื่อน OA — ไม่มีเมื่อช่องยังไม่ส่ง basic_id กลับมา จะบอกให้ครูส่งลิงก์แยก */
  addFriendUrl: string | null
  particle?: Particle
}

export function lineInviteMessage({ clientName, code, addFriendUrl, particle }: LineInviteInput): string {
  const { p, pq } = particleVars(particle)
  const step1 = addFriendUrl
    ? `1) เพิ่มเพื่อน LINE ของครูที่ ${addFriendUrl}`
    : '1) เพิ่มเพื่อน LINE ของครู (เดี๋ยวครูส่งลิงก์ให้)'
  return [
    `สวัสดี${p} ${clientName} ต่อจากนี้ครูจะส่งบิลและใบเสร็จของน้องทาง LINE นะ${pq}`,
    step1,
    `2) พิมพ์รหัส ${code} ในแชทนั้น (ใช้ครั้งเดียว หมดอายุใน 24 ชั่วโมง)`,
    `เสร็จแล้วบิลจะส่งไปทางนั้นเอง ขอบคุณ${p} 🙏`,
  ].join('\n')
}

export const lineAddFriendUrl = (basicId: string | null | undefined): string | null =>
  basicId ? `https://line.me/R/ti/p/${encodeURIComponent(basicId)}` : null
