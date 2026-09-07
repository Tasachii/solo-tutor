import { describe, expect, it } from 'vitest'
import { deriveKey, exportKey, importKey, open, seal } from '../../src/core/cloudCrypto'

/** กุญแจมาจากรหัสผ่าน+user id — เซิร์ฟเวอร์ไม่มีทั้งสอง จึงอ่านไม่ได้ · รหัสผิดต้องได้ null ไม่ใช่ขยะ */
describe('cloudCrypto', () => {
  const uid = '11111111-1111-4111-8111-111111111111'

  it('รหัสผ่านเดิม+บัญชีเดิม ได้กุญแจเดิม ถอดข้ามเครื่องได้', async () => {
    const a = await deriveKey('secret-1234', uid)
    const b = await deriveKey('secret-1234', uid)
    const sealed = await seal(a, 'น้องภูมิ 3,000 บาท')
    expect(await open(b, sealed)).toBe('น้องภูมิ 3,000 บาท')
    expect(sealed.cipher).not.toContain('ภูมิ')
  })

  it('รหัสผิด บัญชีผิด หรือข้อมูลถูกแก้ → null', async () => {
    const key = await deriveKey('secret-1234', uid)
    const sealed = await seal(key, 'x')
    expect(await open(await deriveKey('secret-1235', uid), sealed)).toBeNull()
    expect(await open(await deriveKey('secret-1234', 'other-user'), sealed)).toBeNull()
    const tampered = { ...sealed, cipher: sealed.cipher.slice(0, -4) + (sealed.cipher.endsWith('AAAA') ? 'BBBB' : 'AAAA') }
    expect(await open(key, tampered)).toBeNull()
  })

  it('iv ไม่ซ้ำ — ข้อความเดิมสองครั้งได้ ciphertext ต่างกัน', async () => {
    const key = await deriveKey('secret-1234', uid)
    const one = await seal(key, 'same'); const two = await seal(key, 'same')
    expect(one.iv).not.toBe(two.iv)
    expect(one.cipher).not.toBe(two.cipher)
  })

  it('export/import กุญแจไปเก็บในเครื่องแล้วยังถอดได้', async () => {
    const key = await deriveKey('secret-1234', uid)
    const sealed = await seal(key, 'kept')
    const back = await importKey(await exportKey(key))
    expect(await open(back, sealed)).toBe('kept')
  })
})
