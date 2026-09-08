import { expect, test } from './fixtures'
import { copy } from '../../src/copy'

/**
 * ครูวาง 25 ชื่อจาก LINE — มีซ้ำ มีบรรทัดว่าง มีคนที่อยู่แล้ว
 * ต้องได้คนจริงครบในรอบเดียว และเห็นก่อนกดว่าจะสร้างกี่คน ตัดอะไรออก
 */
test('เพิ่มหลายคนจากหน้ารายชื่อ: ตัดซ้ำ ข้ามคนเดิม แล้วสร้างครบในคลิกเดียว', async ({ page }) => {
  await page.goto('?scenario=default#/app/subjects')
  await expect(page.locator('.skel')).toHaveCount(0)
  await expect(page.locator('button.srow').first()).toBeVisible()
  const before = await page.locator('button.srow').count()
  const existing = await page.locator('button.srow .srow__name').first().innerText()

  await page.getByRole('button', { name: copy.subjects.addMany }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()

  const names = Array.from({ length: 25 }, (_, i) => `น้องใหม่${i + 1}, ผู้ปกครอง${i + 1}`)
  const pasted = [...names, '', 'น้องใหม่3, ผู้ปกครอง3', ' น้องใหม่7 , ผู้ปกครอง7', `${existing.replace(/ค้าง.*$/, '').trim()}, คุณแม่`].join('\n')
  await sheet.locator('textarea').fill(pasted)
  await sheet.getByRole('button', { name: copy.importer.readPaste }).click()

  // เตือนก่อนสร้าง: ซ้ำในลิสต์ 2 · มีอยู่แล้ว 1
  const warn = sheet.locator('.warnbar')
  await expect(warn).toContainText('ตัดชื่อซ้ำในลิสต์ออก 2')
  await expect(warn).toContainText('ข้าม 1 คนที่มีอยู่แล้ว')
  await expect(sheet.getByRole('button', { name: /นำเข้า \(25\)/ })).toBeVisible()

  await sheet.getByRole('button', { name: /นำเข้า \(25\)/ }).click()
  await expect(page.locator('button.srow')).toHaveCount(before + 25)
  await expect(page.getByText('น้องใหม่25')).toBeVisible()
})

test('ค่าเริ่มต้นแบบแพ็กใช้ได้ และต้องใส่จำนวนครั้งก่อน', async ({ page }) => {
  await page.goto('?scenario=default#/app/subjects')
  await expect(page.locator('.skel')).toHaveCount(0)
  await page.getByRole('button', { name: copy.subjects.addMany }).click()
  const sheet = page.getByRole('dialog')
  await sheet.locator('textarea').fill('น้องแพ็กหนึ่ง, คุณแม่หนึ่ง')
  await sheet.getByRole('button', { name: copy.importer.readPaste }).click()
  await sheet.getByRole('button', { name: 'แพ็ก' }).click()
  const pack = sheet.getByTestId('pack-total').locator('input')
  await pack.fill('0')
  await expect(sheet.getByRole('button', { name: /นำเข้า/ })).toBeDisabled()
  await pack.fill('10')
  await sheet.getByRole('button', { name: /นำเข้า \(1\)/ }).click()
  await page.getByText('น้องแพ็กหนึ่ง').click()
  await expect(page.getByText(/เหลือ 10\/10|10 ครั้ง/)).toBeVisible()
})
