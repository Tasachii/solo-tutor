import { afterEach, describe, expect, it, vi } from 'vitest'
import manifestRaw from '../../public/manifest.webmanifest?raw'
import { copy } from '../../src/copy'
import { isStandalone } from '../../src/core/present'

const manifest = JSON.parse(manifestRaw) as {
  id: string; start_url: string; display: string; scope: string
  icons: { src: string; sizes: string; type: string; purpose: string }[]
}

/** แอปที่ติดตั้งแล้วต้องเปิดเข้าหน้างาน ไม่ใช่หน้าขาย */
describe('manifest', () => {
  it('start_url ชี้เข้าหน้าวันนี้', () => { expect(manifest.start_url).toContain('#/app/today') })
  it('เปิดแบบ standalone ในขอบเขตแอป', () => {
    expect(manifest.display).toBe('standalone')
    expect(manifest.scope).toBe('./')
    expect(manifest.id).toBe('./')
  })
  it('มีไอคอนติดตั้งและ maskable ครบขนาดหลัก', () => {
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: './icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }),
      expect.objectContaining({ src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }),
      expect.objectContaining({ src: './icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }),
    ]))
  })
})

describe('pitch contract', () => {
  it('มีราคา 4 แพ็กตามที่เสนอและไม่มี Concierge ในติวเตอร์', async () => {
    const { PLANS } = await import('../../src/platform/plans')
    const { default: tutor } = await import('../../src/professions/tutor')
    expect(PLANS).toEqual([{ months: 0, price: 0 }, { months: 1, price: 299 }, { months: 3, price: 799 }, { months: 12, price: 2490 }])
    expect(tutor.conciergeAvailable).toBe(false)
    expect(copy.pricing.plans[0].features).toContain('สูงสุด 5 นักเรียน')
    expect(copy.landing.h1).toBe('ระบบออกบิลและจัดการเงินให้ครูที่สอนคนเดียว')
    expect(JSON.stringify(copy.pricing.plans)).toContain('ครูตรวจสลิปแล้วบันทึกรับเงิน')
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
