import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildScenario } from '../../src/core/scenarios'
import { dayIn, daysInPeriod, demoToday, periodBack, thisPeriod } from '../../src/mock/seed'
import { periodOf } from '../../src/core/format'
import { FROZEN_TODAY } from '../setup'

/** เทสอื่นตรึงวันไว้ ไฟล์นี้จงใจขยับนาฬิกาเพื่อพิสูจน์ว่าเดโมเดินตามปฏิทินจริง */
const on = (date: string) => vi.setSystemTime(new Date(`${date}T09:00:00+07:00`))
afterEach(() => on(FROZEN_TODAY))

describe('เดโมเดินตามปฏิทินจริง', () => {
  it('วันนี้ของเดโมคือวันนี้จริง ไม่ใช่วันที่ล็อกไว้ตอนเขียนชุดข้อมูล', () => {
    on('2027-03-15')
    expect(demoToday()).toBe('2027-03-15')
    expect(buildScenario('default').today).toBe('2027-03-15')
  })

  it('บิลของอดีตอยู่เดือนก่อนหน้าเสมอ ไม่ค้างอยู่ที่ ส.ค. 2568', () => {
    on('2027-03-15')
    const s = buildScenario('default')
    expect(s.invoices.length).toBeGreaterThan(0)
    for (const invoice of s.invoices) expect(invoice.period).toBe('2027-02')
    // ป้ายเดือนในคำอธิบายบิลต้องเดินตาม period เดียวกัน
    expect(s.invoices[0].lines[0].description).toContain('ก.พ. 2570')
  })

  it('คาบเรียนอยู่ในช่วงเดือนก่อนถึงสิ้นเดือนนี้', () => {
    on('2027-03-15')
    const s = buildScenario('default')
    const dates = s.units.map((u) => u.scheduledAt).sort()
    expect(dates[0] >= '2027-02-01').toBe(true)
    expect(dates[dates.length - 1] <= '2027-03-31').toBe(true)
    expect(s.units.some((u) => u.scheduledAt === '2027-03-15')).toBe(true)
  })

  it('ข้ามปีแล้วเดือนก่อนหน้าต้องเป็นปีที่แล้ว', () => {
    on('2027-01-10')
    expect(thisPeriod()).toBe('2027-01')
    expect(periodBack(1)).toBe('2026-12')
    expect(periodBack(2)).toBe('2026-11')
    for (const invoice of buildScenario('default').invoices) expect(invoice.period).toBe('2026-12')
  })

  it('วันที่ 31 ในเดือนที่มี 28 วัน ต้องยึดสิ้นเดือน ไม่หล่นไปเดือนถัดไป', () => {
    on('2027-03-05')
    expect(daysInPeriod('2027-02')).toBe(28)
    expect(dayIn('2027-02', 31)).toBe('2027-02-28')
    for (const invoice of buildScenario('default').invoices) {
      if (invoice.sentAt) expect(periodOf(invoice.sentAt) <= '2027-03').toBe(true)
    }
  })

  it('ไม่มีวันที่ปี 2025 หลงเหลือในชุดข้อมูลอีก', () => {
    on('2027-03-15')
    expect(JSON.stringify(buildScenario('default'))).not.toContain('2025-')
  })
})

/**
 * เดโมที่ค้างใน localStorage จากการเปิดครั้งก่อนเคยโชว์วันเก่าตลอดไป
 * — คนที่เปิดดูเดือนที่แล้วแล้วกลับมาอีกทีจะเห็นชุดข้อมูลของเดือนที่แล้ว
 */
describe('เดโมที่ค้างในเครื่อง', () => {
  const mount = async () => {
    const { StoreProvider, STORAGE_KEY, useStore } = await import('../../src/core/store')
    let seen: ReturnType<typeof useStore>
    const Probe = () => { seen = useStore(); return null }
    render(<StoreProvider><Probe /></StoreProvider>)
    return { state: seen!.state, STORAGE_KEY }
  }

  afterEach(() => { cleanup(); localStorage.clear() })

  it('ข้ามเดือนแล้วสร้างชุดข้อมูลใหม่ ไม่ค้างอยู่เดือนเก่า', async () => {
    on('2027-03-15')
    const stale = buildScenario('default')
    const { STORAGE_KEY } = await import('../../src/core/store')
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stale))
    cleanup()

    on('2027-04-02')
    const { state } = await mount()
    expect(state.today).toBe('2027-04-02')
    for (const invoice of state.invoices) expect(invoice.period).toBe('2027-03')
  })

  it('ยังอยู่เดือนเดิม เดินวันให้ทันแต่ไม่ล้างงานที่กดไว้', async () => {
    on('2027-03-15')
    const saved = buildScenario('default')
    const marker = { ...saved, clients: [...saved.clients, { id: 'kept', name: 'ลูกค้าที่เพิ่งเพิ่ม', lineId: '@kept' }] }
    const { STORAGE_KEY } = await import('../../src/core/store')
    localStorage.setItem(STORAGE_KEY, JSON.stringify(marker))
    cleanup()

    on('2027-03-20')
    const { state } = await mount()
    expect(state.today).toBe('2027-03-20')
    expect(state.clients.some((c) => c.id === 'kept')).toBe(true)
  })
})

/** การ์ดตัวอย่างบนหน้าแรกคือสิ่งแรกที่กรรมการเห็น ต้องไม่ค้างวันเหมือนที่เดโมเคยเป็น */
describe('การ์ดตัวอย่างบนหน้าแรก', () => {
  const renderLanding = async () => {
    const { default: Landing } = await import('../../src/platform/Landing')
    const { StoreProvider } = await import('../../src/core/store')
    render(<StoreProvider><MemoryRouter><Landing /></MemoryRouter></StoreProvider>)
    return document.body.innerText || document.body.textContent || ''
  }

  it('วันบนการ์ดเดินตามปฏิทินจริง และเดือนในบิลตรงกับเดือนนี้', async () => {
    on('2027-03-15')
    const text = await renderLanding()
    expect(text).toContain('จันทร์ 15 มี.ค.')
    expect(text).toContain('บิล มี.ค.')
    expect(text).not.toContain('2 ก.ย.')
  })

  it('ข้อความตัวอย่างอ้างเดือนก่อนหน้า ไม่ใช่เดือนที่พิมพ์ค้างไว้', async () => {
    on('2027-01-20')
    const text = await renderLanding()
    expect(text).toContain('เดือน ธ.ค.')
  })
})
