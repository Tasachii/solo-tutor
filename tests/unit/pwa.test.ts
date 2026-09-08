import { afterEach, describe, expect, it, vi } from 'vitest'
import manifestRaw from '../../public/manifest.webmanifest?raw'
import { copy } from '../../src/copy'
import { isStandalone } from '../../src/core/present'

const manifest = JSON.parse(manifestRaw) as { start_url: string; display: string; scope: string }

/** แอปที่ติดตั้งแล้วต้องเปิดเข้าหน้างาน ไม่ใช่หน้าขาย */
describe('manifest', () => {
  it('start_url ชี้เข้าหน้าวันนี้', () => { expect(manifest.start_url).toContain('#/app/today') })
  it('เปิดแบบ standalone ในขอบเขตแอป', () => {
    expect(manifest.display).toBe('standalone')
    expect(manifest.scope).toBe('./')
  })
})

describe('isStandalone', () => {
  afterEach(() => vi.restoreAllMocks())
  it('จริงเมื่อ display-mode: standalone ตรง', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((q) => ({ matches: q.includes('standalone') } as MediaQueryList))
    expect(isStandalone()).toBe(true)
  })
  it('เท็จในแท็บเบราว์เซอร์ธรรมดา', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(() => ({ matches: false } as MediaQueryList))
    expect(isStandalone()).toBe(false)
  })
})

/** FAQ ต้องไม่สัญญาสิ่งที่โค้ดยังไม่มี และต้องบอกความจริงเรื่องข้อมูลบนเซิร์ฟเวอร์ */
describe('FAQ ตรงกับความจริง', () => {
  const answer = (q: string): string => copy.pricing.faq.find((f) => f.q === q)!.a
  it('ไม่บอกว่ากดพักได้ ทั้งที่ยังไม่มีปุ่มพัก', () => {
    expect(answer('ปิดเทอมต้องยกเลิกไหม')).not.toMatch(/กด "พัก" ได้เลย/)
  })
  it('บอกว่าเชื่อม LINE OA แล้วมีอะไรอยู่บนเซิร์ฟเวอร์', () => {
    expect(answer('ลบข้อมูลได้ไหม')).toContain('LINE OA')
    expect(answer('ลบข้อมูลได้ไหม')).toContain('ข้อความขาเข้า')
    expect(answer('ลบข้อมูลได้ไหม')).not.toContain('แล้วส่วนนั้นถูกลบด้วย')
    expect(answer('ลบข้อมูลได้ไหม')).not.toContain('ไม่เก็บสำเนาไว้ที่ไหน')
  })
  it('ช่องติดต่อในหน้านโยบายว่างได้ แต่ห้ามเป็นค่าหลอก', () => {
    const c = copy.legal.contact
    expect(c === '' || /@|https?:\/\//.test(c)).toBe(true)
    expect(c).not.toMatch(/example|xxx|TODO/i)
  })
})
