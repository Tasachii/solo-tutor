import { expect, test, type Page } from './fixtures'
import { copy } from '../../src/copy'

/**
 * แท็บค้างจ่ายและการบ้านบนหน้าแอดมิน (โหมดเดโม) — ตัวเลขจาก ledger, ร่างเข้าคิวเดียวกัน,
 * ทำเครื่องหมายได้รับแล้วถอนร่างทวง; ไม่มีการเปิดหน้าต่างภายนอกจนกว่าครูกดส่ง
 */
const open = async (page: Page, tab: 'collect' | 'homework'): Promise<void> => {
  await page.goto(`?scenario=default#/app/admin?tab=${tab}`)
  await expect(page.locator('.skel')).toHaveCount(0)
}

test('แท็บค้างจ่ายแสดงบิลค้างทุกใบเรียงตามวันค้าง มีร่างทวงตามบันได และทวงสั้นเข้าคิวได้', async ({ page }) => {
  await open(page, 'collect')
  const rows = page.getByTestId('collect-row')
  // ชุดเดโม: ฟิสิกส์ (ค้าง 5 วัน) · อังกฤษเหมา (ค้าง 12 วัน) · คณิต (ยังไม่ครบกำหนด)
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('ค้าง 12 วัน')
  await expect(rows.nth(0)).toContainText(copy.collect.ladder.final)
  await expect(rows.nth(1)).toContainText('ค้าง 5 วัน')
  await expect(rows.nth(1)).toContainText(copy.collect.ladder.clear)
  await expect(rows.nth(1).locator('.msg__preview')).toContainText('3,000')
  await expect(rows.nth(2)).toContainText(copy.collect.ladderNone)
  await expect(rows.nth(2)).toContainText(copy.collect.noDraft)
  // ยอดรวมค้างจาก ledger: 2,800 + 3,000 + 1,600
  await expect(page.locator('.stat').nth(1)).toContainText('7,400')
  // แท็บรอส่งมี 3 ร่างก่อนทวงสั้น
  await expect(page.locator('.tab__badge')).toHaveText('3')
  await rows.nth(2).getByRole('button', { name: copy.collect.nudge }).click()
  await expect(page.getByText(copy.collect.nudgeDone)).toBeVisible()
  await expect(page.locator('.tab__badge')).toHaveText('4')
  await expect(rows.nth(2).locator('.msg__preview')).toContainText('1,600')
  // กดซ้ำวันเดียวกัน = ไม่เพิ่ม (ปุ่มหายไปเพราะมีร่างแล้ว)
  await expect(rows.nth(2).getByRole('button', { name: copy.collect.nudge })).toHaveCount(0)
  // ร่างใหม่อยู่ในคิวรอส่งพร้อมป้ายเตือนยอด
  await page.getByRole('button', { name: /รอส่ง/ }).click()
  await expect(page.locator('.msg').filter({ hasText: copy.admin.kinds.nudge })).toHaveCount(1)
})

test('แท็บการบ้าน: มอบหมายหลายคน → ร่างเข้าคิว · ได้รับแล้ว → ร่างทวงถอน · ทวงอีกครั้งได้', async ({ page }) => {
  await open(page, 'homework')
  const rows = page.getByTestId('homework-row')
  await expect(rows).toHaveCount(2)
  await expect(page.locator('[data-status="overdue"]')).toHaveCount(1)
  await expect(page.locator('[data-status="pending"]')).toHaveCount(1)
  await expect(page.locator('[data-status="overdue"]')).toContainText('เลยมา 2 วัน')
  await expect(page.locator('.tab__badge')).toHaveText('3')

  // มอบหมายให้สองคน
  await page.getByRole('button', { name: 'น้องมิว' }).click()
  await page.getByRole('button', { name: 'น้องต้น' }).click()
  await page.getByRole('textbox', { name: copy.homework.text }).fill('ทำโจทย์หน้า 20 ข้อ 1–5')
  await page.getByRole('button', { name: copy.homework.assign }).click()
  await expect(page.getByText(copy.homework.assigned.replace('{n}', '2'))).toBeVisible()
  await expect(page.locator('.tab__badge')).toHaveText('5')
  await expect(page.locator('[data-status="pending"]')).toHaveCount(3)
  const mine = page.locator('[data-status="pending"]').filter({ hasText: 'ทำโจทย์หน้า 20' })
  await expect(mine).toHaveCount(2)
  await expect(mine.first().locator('.msg__preview')).toContainText('ทำโจทย์หน้า 20 ข้อ 1–5')

  // ทวงอีกครั้งรายการที่เลยกำหนด (ทวงครั้งก่อนส่งไปแล้ว)
  const overdue = page.locator('[data-status="overdue"]')
  await overdue.getByRole('button', { name: copy.homework.remindAgain }).click()
  await expect(page.getByText(copy.homework.remindDone)).toBeVisible()
  await expect(page.locator('.tab__badge')).toHaveText('6')
  await expect(overdue.locator('.msg__preview')).toContainText(copy.admin.kinds.homework_reminder)

  // ได้รับแล้ว → ย้ายกลุ่ม และร่างทวงถูกถอน
  await overdue.getByRole('button', { name: copy.homework.markSubmitted }).click()
  await expect(page.getByText(copy.homework.submittedToast)).toBeVisible()
  await expect(page.locator('[data-status="overdue"]')).toHaveCount(0)
  await expect(page.locator('[data-status="submitted"]')).toHaveCount(1)
  await expect(page.locator('.tab__badge')).toHaveText('5')

  // ฟอร์มว่างต้องบอกเหตุผล ไม่บันทึกเงียบ
  await page.getByRole('button', { name: copy.homework.assign }).click()
  await expect(page.locator('.fld__err')).toContainText(copy.homework.pickOne)
})

test('การบ้านอยู่ในไฟล์สำรองและกู้กลับได้ · ลิงก์จากหน้านักเรียนพาไปแท็บการบ้าน', async ({ page }) => {
  await open(page, 'homework')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('solo-demo-v3')!))
  expect(saved.homework).toHaveLength(2)
  await page.goto('#/app/subjects/s2')
  await expect(page.locator('.skel')).toHaveCount(0)
  await page.getByRole('button', { name: copy.homework.manageLink }).click()
  await expect(page).toHaveURL(/tab=homework/)
  await expect(page.getByTestId('homework-row')).toHaveCount(2)
})
