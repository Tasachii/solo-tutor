import { expect, test } from './fixtures'
import { copy } from '../../src/copy'

/** หน้าแรก → เลือกรูปแบบ → เข้าแอปด้วยข้อมูลที่ตรงแบบ · เปลี่ยนจากเมนูได้ · โหมดจริงไม่ลบข้อมูล */
test('picking a style shapes the demo, the filters and the add-sheet default; the menu can change it', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('link', { name: 'เดโม' }).click()
  await expect(page).toHaveURL(/#\/start$/)
  await expect(page.locator('input, textarea, select')).toHaveCount(0) // ทางเลือก ไม่ใช่ฟอร์ม

  await page.getByRole('button', { name: /แพ็ก \/ คอร์ส/ }).click()
  await expect(page).toHaveURL(/#\/app\/today$/)
  await expect(page.locator('.skel')).toHaveCount(0)
  await expect(page.getByText('น้องโบว์')).toBeVisible()
  await expect(page.locator('.pk').first()).toBeVisible() // ตัวนับที่เหลือของแพ็ก

  await page.goto('#/app/subjects')
  const chips = page.locator('.chips').first()
  await expect(chips).toContainText('แพ็ก')
  await expect(chips).toContainText('รายครั้ง') // ชุดนี้มีรายครั้งอยู่ 2 คน จึงยังกรองได้
  await expect(chips).not.toContainText('เหมาเดือน')
  await page.getByRole('button', { name: '+ เพิ่ม' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('button', { name: 'แพ็ก', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(sheet.getByText('หักจากแพ็ก', { exact: false })).toBeVisible()
  await sheet.getByRole('button', { name: 'ปิด' }).click()

  // ในเดโม เมนู ทั่วไป ไม่มี "รูปแบบการเก็บเงิน" แล้ว (ซ้ำกับ สลับชุดข้อมูล ในแท็บ เดโม — เจ้าของ 9 ก.ย.)
  await page.getByRole('button', { name: 'เมนู' }).click()
  const menu = page.getByRole('dialog', { name: 'เมนู' })
  await expect(menu.getByRole('button', { name: 'รูปแบบการเก็บเงิน' })).toHaveCount(0)
  await expect(menu.getByRole('button', { name: 'เชื่อม LINE OA' })).toBeVisible()
  await page.keyboard.press('Escape')
  // เปลี่ยนเฉพาะ hash = same-document nav ชุดข้อมูลเดิมยังอยู่ จึงยังเห็น "ใช้อยู่" ที่แบบเดิม
  await page.goto(page.url().replace(/#.*$/, '#/start'))
  await expect(page).toHaveURL(/#\/start$/)
  await expect(page.getByText('ใช้อยู่')).toBeVisible()
  await page.getByRole('button', { name: /ผสม/ }).click()
  await expect(page.locator('.skel')).toHaveCount(0)
  await expect(page.getByText('น้องแพรว')).toBeVisible()
})

test('in real mode the picker changes defaults only — nothing is wiped', async ({ page }) => {
  await page.goto('?scenario=default#/app/today')
  await expect(page.locator('.skel')).toHaveCount(0)
  await page.getByRole('button', { name: 'เมนู' }).click()
  await page.getByRole('dialog', { name: 'เมนู' }).getByRole('button', { name: 'เริ่มใช้จริง' }).click()
  await page.getByRole('dialog', { name: 'เริ่มใช้จริง' }).getByRole('button', { name: 'เริ่มใช้จริง' }).click()
  await page.locator('.fld').filter({ hasText: copy.onboarding.providerName }).locator('input').fill('ครูมายด์')
  await page.getByRole('group', { name: copy.onboarding.particle }).getByRole('button', { name: 'ค่ะ' }).click()
  await page.getByRole('button', { name: 'ถัดไป' }).click()
  await page.locator('.fld').filter({ hasText: 'วางรายชื่อจาก Excel หรือ LINE' }).locator('textarea').fill('น้องปลา, คุณแม่ปลา')
  await page.getByRole('button', { name: 'เริ่มใช้งาน (1)' }).click()
  await expect(page).toHaveURL(/#\/app\/today$/)

  await page.goto('#/start')
  await expect(page.getByText('โหมดใช้จริง', { exact: false }).first()).toBeVisible()
  await page.getByRole('button', { name: /เหมารายเดือน/ }).click()
  await page.goto('#/app/subjects')
  await expect(page.getByText('น้องปลา')).toBeVisible() // ข้อมูลยังอยู่
  await page.getByRole('button', { name: '+ เพิ่ม' }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'เหมาเดือน', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('the theme toggle on the landing and start pages flips dark/light and the app remembers it', async ({ page }) => {
  await page.goto('./')
  await page.evaluate(() => localStorage.removeItem('solo-theme'))
  await page.reload()
  const root = page.locator('html')
  await expect(root).toHaveAttribute('data-theme', 'dark') // ค่าเริ่มต้นของโฉม Navy
  await page.getByRole('button', { name: 'เปลี่ยนเป็นธีมสว่าง' }).click()
  await expect(root).toHaveAttribute('data-theme', 'light')
  await page.getByRole('link', { name: 'เดโม' }).click()
  await expect(page).toHaveURL(/#\/start$/)
  await expect(root).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'เปลี่ยนเป็นธีมมืด' }).click()
  await expect(root).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: /ผสม/ }).click()
  await expect(page.locator('.skel')).toHaveCount(0)
  await expect(root).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => localStorage.getItem('solo-theme'))).toBe('dark')
})

test('an accent picked on the landing page follows the visitor into the app', async ({ page }) => {
  await page.goto('./')
  await page.evaluate(() => { localStorage.removeItem('solo-accent'); localStorage.removeItem('solo-theme') })
  await page.reload()
  await page.getByRole('button', { name: 'ปรับสีและธีม' }).click()
  const sheet = page.getByRole('dialog', { name: 'ปรับสีและธีม' })
  await sheet.getByRole('button', { name: 'ม่วง' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'plum')
  await sheet.getByRole('button', { name: 'สว่าง' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await sheet.getByRole('button', { name: 'ปิด' }).click()
  // ปุ่มสลับเร็วต้องรู้ว่าชีทเพิ่งเปลี่ยนเป็นสว่าง — กดแล้วต้องได้มืด ไม่ใช่สว่างซ้ำ
  await page.getByRole('button', { name: 'เปลี่ยนเป็นธีมมืด' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'เปลี่ยนเป็นธีมสว่าง' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('link', { name: 'เดโม' }).click()
  await page.getByRole('button', { name: /ผสม/ }).click()
  await expect(page.locator('.skel')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'plum')
  // เมนูในแอปต้องโชว์สีที่เลือกไว้ ไม่ใช่ค่าเริ่มต้น
  await page.getByRole('button', { name: 'เมนู' }).click()
  await page.getByRole('dialog', { name: 'เมนู' }).getByRole('tab', { name: 'หน้าจอ' }).click()
  await expect(page.getByRole('dialog', { name: 'เมนู' }).getByRole('button', { name: 'ม่วง' })).toHaveAttribute('aria-pressed', 'true')
})
