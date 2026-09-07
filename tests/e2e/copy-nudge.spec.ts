import { expect, test, type Page } from './fixtures'
import { copy } from '../../src/copy'

const open = async (page: Page, hash: string): Promise<void> => {
  await page.goto(`?scenario=default#${hash}`)
  await expect(page.locator('.skel')).toHaveCount(0)
}

test('บิลค้างมีปุ่มคัดลอกข้อความแจ้งเตือน วางได้เลย และสถานะบิลไม่เปลี่ยน', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'webkit ไม่ให้ grant clipboard permission')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await open(page, '/app/billing')
  await page.locator('.period-picker select').selectOption('2025-08')
  const row = page.locator('.srow').filter({ hasText: 'น้องภูมิ' })
  const before = await row.locator('.srow__meta').innerText()
  expect(before).toMatch(/ส่งแล้ว|ค้างจ่าย/)
  await row.getByRole('button', { name: copy.billing.copyNudge }).click()
  await expect(page.getByText(copy.toast.copied)).toBeVisible()

  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toContain('น้องภูมิ')
  expect(text).toContain('ยอดคงเหลือ 3,000 บาท')
  expect(text).toContain('เรียนไป')
  expect(text).not.toMatch(/\{|ระบบ|อัตโนมัติ/)
  // คัดลอกไม่ใช่ส่ง — สถานะยังเป็นส่งแล้ว ไม่มีร่างใหม่ในคิว
  await expect(row.locator('.srow__meta')).toHaveText(before)
})

test('บิลที่จ่ายแล้วไม่มีปุ่มคัดลอกข้อความแจ้งเตือน', async ({ page }) => {
  await open(page, '/app/billing')
  await page.locator('.period-picker select').selectOption('2025-08')
  const paid = page.locator('.srow').filter({ hasText: 'จ่ายแล้ว' }).first()
  await expect(paid).toBeVisible()
  await expect(paid.getByRole('button', { name: copy.billing.copyNudge })).toHaveCount(0)
})
