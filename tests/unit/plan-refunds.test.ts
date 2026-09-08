import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../src/integrations/supabaseRest', async (actual) => ({
  ...(await actual<object>()),
  rpc: mocks.rpc,
}))

import { listPlanRefunds, refundsUnsupported, summarizeRefunds, type PlanRefundRow } from '../../src/core/planRefunds'
import { SupabaseRestError } from '../../src/integrations/supabaseRest'

// ตัวเลขสมมติทั้งหมด ไม่ใช่ราคาจริงของแพ็กใด — 1200 บาทไม่มีอยู่ใน plan_price()
const REQUEST = 'request-synthetic-1'
const row = (over: Partial<PlanRefundRow>): PlanRefundRow => ({
  refund_id: 'refund-synthetic-1',
  plan_request_id: REQUEST,
  receipt_no: 'SP-SYNTHETIC-0001',
  paid_amount: 1200,
  refunded_amount: 500,
  refunded_total: 500,
  occurred_at: '2025-08-20T03:00:00Z',
  ...over,
})

beforeEach(() => { mocks.rpc.mockReset() })

describe('summarizeRefunds', () => {
  it('ไม่มีแถว = ไม่มีสรุป — ใบเสร็จที่ไม่เคยคืนเงินต้องไม่มีอะไรเพิ่ม', () => {
    expect(summarizeRefunds([]).size).toBe(0)
  })

  it('คืนบางส่วนคิดยอดสุทธิจากหลักฐาน ไม่ใช่จากยอดที่คำขอเคยขอไว้', () => {
    const summary = summarizeRefunds([row({})]).get(REQUEST)
    expect(summary).toEqual({
      paid: 1200, refunded: 500, net: 700, state: 'partial',
      entries: [{ id: 'refund-synthetic-1', amount: 500, occurredAt: '2025-08-20T03:00:00Z' }],
    })
  })

  it('คืนหลายครั้งจนครบยอดที่ชำระ = คืนเต็มจำนวน สุทธิเหลือศูนย์', () => {
    const summary = summarizeRefunds([
      row({ refund_id: 'refund-synthetic-1', refunded_amount: 500, refunded_total: 1200 }),
      row({ refund_id: 'refund-synthetic-2', refunded_amount: 700, refunded_total: 1200, occurred_at: '2025-08-21T03:00:00Z' }),
    ]).get(REQUEST)
    expect(summary?.refunded).toBe(1200)
    expect(summary?.net).toBe(0)
    expect(summary?.state).toBe('full')
    expect(summary?.entries).toHaveLength(2)
  })

  it('ยอดคืนสะสมจากเซิร์ฟเวอร์ชนะเสมอเมื่อแถวมาไม่ครบ — ห้ามแสดงคืนน้อยกว่าที่คืนจริง', () => {
    const summary = summarizeRefunds([row({ refunded_amount: 500, refunded_total: 1200 })]).get(REQUEST)
    expect(summary?.refunded).toBe(1200)
    expect(summary?.net).toBe(0)
    expect(summary?.state).toBe('full')
  })

  it('ยอดสุทธิไม่ติดลบ และแยกใบเสร็จคนละใบออกจากกัน', () => {
    const summary = summarizeRefunds([
      row({ refunded_amount: 1500, refunded_total: 1500 }),
      row({ refund_id: 'refund-synthetic-9', plan_request_id: 'request-synthetic-2', paid_amount: 900, refunded_amount: 400, refunded_total: 400 }),
    ])
    expect(summary.get(REQUEST)?.net).toBe(0)
    expect(summary.get('request-synthetic-2')).toEqual(expect.objectContaining({ paid: 900, refunded: 400, net: 500, state: 'partial' }))
  })
})

describe('listPlanRefunds', () => {
  it('อ่านผลลัพธ์ปกติได้ครบทุกช่อง', async () => {
    mocks.rpc.mockResolvedValue([row({})])
    await expect(listPlanRefunds()).resolves.toEqual([row({})])
    expect(mocks.rpc).toHaveBeenCalledWith('list_plan_refunds', {})
  })

  it('ผลลัพธ์ที่ไม่ใช่รายการ = ล้มเหลว ไม่ใช่ "ไม่มีการคืนเงิน"', async () => {
    mocks.rpc.mockResolvedValue({ refunded: 500 })
    await expect(listPlanRefunds()).rejects.toThrow()
  })

  it('มีแต่ 404 เท่านั้นที่แปลว่าฐานยังไม่มีคำสั่งคืนเงิน', () => {
    expect(refundsUnsupported(new SupabaseRestError('remote-error', 'ไม่พบคำสั่ง', 404))).toBe(true)
    expect(refundsUnsupported(new SupabaseRestError('unauthorized', 'เซสชันหมดอายุ', 401))).toBe(false)
    expect(refundsUnsupported(new SupabaseRestError('network', 'เชื่อมต่อไม่สำเร็จ'))).toBe(false)
    // แถวที่อ่านไม่ออกคือความล้มเหลว อาจมีการคืนเงินอยู่จริงแต่เรายังอ่านไม่ได้
    expect(refundsUnsupported(new Error('invalid refund row'))).toBe(false)
    expect(refundsUnsupported(null)).toBe(false)
  })

  it('แถวที่ยอดอ่านไม่ได้ทำให้ทั้งชุดล้ม แทนที่จะข้ามจนใบเสร็จกลับไปโชว์ยอดเต็ม', async () => {
    mocks.rpc.mockResolvedValue([row({}), { ...row({ refund_id: 'refund-synthetic-2' }), refunded_amount: '500' }])
    await expect(listPlanRefunds()).rejects.toThrow()
    mocks.rpc.mockResolvedValue([{ ...row({}), occurred_at: null }])
    await expect(listPlanRefunds()).rejects.toThrow()
    mocks.rpc.mockResolvedValue([{ ...row({}), paid_amount: 1200.5 }])
    await expect(listPlanRefunds()).rejects.toThrow()
  })
})
