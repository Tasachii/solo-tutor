import { describe, expect, it } from 'vitest'
import { lineAddFriendUrl, lineInviteMessage } from '../../src/core/lineInvite'

/** ผู้ปกครองต้องได้ทั้งลิงก์แอดและรหัสในข้อความเดียว ในน้ำเสียงครู ไม่ใช่น้ำเสียงระบบ */
describe('ข้อความเชิญผู้ปกครองผูก LINE OA', () => {
  it('มีชื่อผู้ปกครอง ลิงก์แอด รหัส และคำลงท้ายของครู', () => {
    const text = lineInviteMessage({ clientName: 'คุณแม่แพรว', code: '123456', addFriendUrl: 'https://line.me/R/ti/p/%40458gfbxa', particle: 'ค่ะ' })
    expect(text).toContain('คุณแม่แพรว')
    expect(text).toContain('https://line.me/R/ti/p/%40458gfbxa')
    expect(text).toContain('พิมพ์รหัส 123456')
    expect(text).toContain('สวัสดีค่ะ')
    expect(text).toContain('นะคะ') // {pq} ของครูผู้หญิง
    expect(text).not.toMatch(/ระบบ|Solo Tutor|อัตโนมัติ/) // ผู้ปกครองคุยกับครู ไม่ได้คุยกับแอป
  })

  it('ครูผู้ชายได้ ครับ ทั้งสองที่ และค่าเริ่มต้นเมื่อยังไม่เลือกคือ ครับ', () => {
    expect(lineInviteMessage({ clientName: 'คุณพ่อภูมิ', code: '000000', addFriendUrl: 'https://line.me/x', particle: 'ครับ' })).toMatch(/สวัสดีครับ[\s\S]*นะครับ/)
    expect(lineInviteMessage({ clientName: 'คุณพ่อภูมิ', code: '000000', addFriendUrl: 'https://line.me/x' })).toContain('สวัสดีครับ')
  })

  it('ไม่มีลิงก์แอด (ช่องยังไม่ส่ง basic_id) → บอกว่าครูจะส่งลิงก์ให้ ไม่ปล่อยช่องว่าง', () => {
    const text = lineInviteMessage({ clientName: 'คุณแม่มิว', code: '654321', addFriendUrl: null })
    expect(text).toContain('เดี๋ยวครูส่งลิงก์ให้')
    expect(text).not.toContain('null')
    expect(text).not.toContain('undefined')
  })

  it('ลิงก์แอดเพื่อนสร้างจาก basic_id และ encode @ ให้ · ไม่มี basic_id = null', () => {
    expect(lineAddFriendUrl('@458gfbxa')).toBe('https://line.me/R/ti/p/%40458gfbxa')
    expect(lineAddFriendUrl(null)).toBeNull()
    expect(lineAddFriendUrl(undefined)).toBeNull()
  })
})
