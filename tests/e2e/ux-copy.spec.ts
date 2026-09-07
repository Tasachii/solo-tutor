import { expect, test } from './fixtures'

/** ป้ายและหัวเรื่องที่เคยหลอกตา — ภาษาอังกฤษหลุด · เดือนผิด · ป้ายค้างไม่บอกว่ารวมเดือนก่อน */
test('history speaks Thai, the parent sees the month of the bill, and ค้าง says it accumulates', async ({ page }) => {
  await page.goto('?scenario=default#/app/subjects/s2')
  await expect(page.locator('.skel')).toHaveCount(0)
  const history = page.getByText('บิล ส.ค. 2568', { exact: false }).first()
  await expect(history).toContainText('ค้างจ่าย')
  await expect(history).not.toContainText('overdue')

  // บิลของคุณพ่อภูมิเป็นของ ส.ค. — หัวใบต้องบอก ส.ค. แม้วันนี้เป็น ก.ย.
  await page.goto('#/client/c2')
  await expect(page.locator('.cv__who')).toContainText('ส.ค. 2568')
  await expect(page.locator('.cv__who')).not.toContainText('ก.ย.')

  await page.goto('#/app/billing')
  await expect(page.getByText('ค้างสะสม')).toBeVisible()
  await expect(page.locator('details.hint--fold summary')).toContainText('ตัวเลขนี้มาจากไหน')
})

/**
 * โหมดเว็บ (ค่าเริ่มต้นบนจอ ≥1024px) เคยล้าง max-width ของหน้าที่ผู้ปกครองเปิด
 * ทำให้บรรทัดยาวเต็มจอฉาย — หน้านี้ไม่ใช่หน้าจอฉาย ต้องคงความกว้างอ่านง่ายไว้
 */
test('the parent page keeps its readable width even in web frame', async ({ page }) => {
  test.skip(page.viewportSize()!.width < 900, 'กรอบเว็บมีผลเฉพาะจอกว้าง')
  await page.addInitScript(() => localStorage.setItem('solo-frame', 'web'))
  await page.goto('#/client/c1')
  await expect(page.locator('.page--client')).toBeVisible()

  const width = await page.locator('.page--client').evaluate((el) => el.getBoundingClientRect().width)
  expect(width).toBeLessThanOrEqual(560)
  await expect(page.locator('.cv__h1')).toHaveText('ใบแจ้งค่าเรียน')
})
