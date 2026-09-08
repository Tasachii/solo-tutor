import { afterEach, describe, expect, it } from 'vitest'
import { __setUnloadingForTests, loadWithRetry } from '../../src/core/lazyRoute'

const noWait = async () => {}
const flaky = (failures: number) => {
  let calls = 0
  return { calls: () => calls, load: async () => { calls += 1; if (calls <= failures) throw new TypeError('Importing a module script failed.'); return { default: 'ok' } } }
}

afterEach(() => __setUnloadingForTests(false))

describe('loadWithRetry — route chunk ที่โหลดไม่ขึ้น', () => {
  it('สะดุดครั้งเดียวแล้วสำเร็จ → ลองใหม่หนึ่งครั้งพอ', async () => {
    const mod = flaky(1)
    expect(await loadWithRetry(mod.load, noWait)).toEqual({ default: 'ok' })
    expect(mod.calls()).toBe(2)
  })
  it('พังสองครั้งติด → โยนต่อให้ ErrorBoundary ไม่วนไม่รู้จบ', async () => {
    const mod = flaky(5)
    await expect(loadWithRetry(mod.load, noWait)).rejects.toThrow(/module script/)
    expect(mod.calls()).toBe(2)
  })
  it('หน้ากำลังปิด/reload → ไม่โยน ไม่ลองใหม่ ค้างเงียบ (WebKit ยกเลิก import ตอน reload)', async () => {
    const mod = flaky(5)
    __setUnloadingForTests(true)
    const outcome = await Promise.race([
      loadWithRetry(mod.load, noWait).then(() => 'resolved', () => 'rejected'),
      new Promise<string>((r) => setTimeout(() => r('pending'), 50)),
    ])
    expect(outcome).toBe('pending')
    expect(mod.calls()).toBe(1)
  })
})
