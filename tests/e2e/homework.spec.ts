import { expect, test, type Page } from './fixtures'
import { copy } from '../../src/copy'
import { ACTIVE_MODE, DEMO_SLOT, REAL_SLOT } from './workspace'

/** คืนคีย์ของช่องที่โหมดนั้นใช้ — เดโมกับของจริงอยู่คนละช่อง */
const seed = async (page: Page, mode: 'demo' | 'real'): Promise<string> => {
  await page.goto('?scenario=default#/app/today')
  await expect(page.locator('.skel')).toHaveCount(0)
  await expect.poll(() => page.evaluate((demo) => localStorage.getItem(demo), DEMO_SLOT)).not.toBeNull()
  if (mode === 'real') {
    await page.evaluate(([demo, real, pointer]) => {
      const saved = JSON.parse(localStorage.getItem(demo)!)
      saved.mode = 'real'; saved.scenarioId = 'real'; saved.onboarded = true
      saved.provider = { name: 'ครู QA', promptpayId: '0812345678', particle: 'ค่ะ' }
      localStorage.setItem(real, JSON.stringify(saved))
      localStorage.setItem(pointer, 'real')
    }, [DEMO_SLOT, REAL_SLOT, ACTIVE_MODE])
  }
  await page.goto('#/app/subjects/s2')
  await page.reload()
  await expect(page.locator('.skel')).toHaveCount(0)
  return mode === 'real' ? REAL_SLOT : DEMO_SLOT
}

test('โหมดจริง: พิมพ์การบ้านแล้วคัดลอก ได้ข้อความพร้อมคำลงท้ายของครู และไม่บันทึกอะไร', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'webkit ไม่ให้ grant clipboard permission')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const slot = await seed(page, 'real')
  const before = await page.evaluate((key) => localStorage.getItem(key), slot)
  await page.getByRole('button', { name: copy.detail.homework }).click()
  await expect(page.getByRole('button', { name: copy.detail.homeworkCopy })).toBeDisabled()
  await page.getByLabel(copy.detail.homeworkField).fill('แบบฝึกหัดบทที่ 3 ข้อ 1–10')
  await page.getByRole('button', { name: copy.detail.homeworkCopy }).click()
  await expect(page.getByText(copy.toast.copied)).toBeVisible()
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toContain('แบบฝึกหัดบทที่ 3 ข้อ 1–10')
  expect(text).toContain('น้องภูมิ')
  expect(text).toContain('นะคะ')
  expect(text).not.toMatch(/\{|ระบบ|อัตโนมัติ/)
  expect(await page.evaluate((key) => localStorage.getItem(key), slot)).toBe(before)
})

test('เดโมไม่มีปุ่มการบ้าน — ไม่อยู่ในเส้นทางที่โชว์', async ({ page }) => {
  await seed(page, 'demo')
  await expect(page.getByRole('button', { name: copy.detail.clientView })).toBeVisible()
  await expect(page.getByRole('button', { name: copy.detail.homework })).toHaveCount(0)
})
