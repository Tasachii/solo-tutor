import { expect, test } from './fixtures'

/** เมนู 3 หมวด: ใช้คีย์บอร์ดล้วนได้ · 4 ธีม · ป้ายเต็มจอตามสถานะ */
test('the menu works from the keyboard: arrows move focus and switch tabs', async ({ page }) => {
  await page.goto('?scenario=default#/app/today')
  await expect(page.locator('.skel')).toHaveCount(0)
  await page.getByRole('button', { name: 'เมนู' }).click()
  const menu = page.getByRole('dialog', { name: 'เมนู' })
  await expect(menu).toBeVisible()

  // ลง 2 ครั้ง — โฟกัสต้องอยู่บนปุ่มในเมนู และไม่ใช่ปุ่มเดิม
  await page.keyboard.press('ArrowDown')
  const first = await page.evaluate(() => document.activeElement?.textContent?.trim())
  await page.keyboard.press('ArrowDown')
  const second = await page.evaluate(() => document.activeElement?.textContent?.trim())
  expect(first).not.toBe(second)
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true)

  // ไปที่แท็บแล้วกดขวา = สลับหมวด
  await menu.getByRole('tab', { name: 'ทั่วไป' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(menu.getByRole('tab', { name: 'หน้าจอ' })).toHaveAttribute('aria-selected', 'true')
  await expect(menu.getByRole('button', { name: 'เต็มจอ' })).toBeVisible()

  // ขึ้นจากตัวแรกวนไปตัวสุดท้าย — ไม่หลุดออกจากชีท
  await page.keyboard.press('ArrowUp')
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true)
})

test('four real themes plus system, each stamps its own data-theme', async ({ page }) => {
  await page.goto('?scenario=default#/app/today')
  await expect(page.locator('.skel')).toHaveCount(0)
  await page.getByRole('button', { name: 'เมนู' }).click()
  const menu = page.getByRole('dialog', { name: 'เมนู' })
  await menu.getByRole('tab', { name: 'หน้าจอ' }).click()
  for (const [label, attr] of [['สว่าง', 'light'], ['ดำสนิท', 'black'], ['ครีมอุ่น', 'warm'], ['มืด', 'dark']] as const) {
    await menu.getByRole('button', { name: label, exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', attr)
  }
  // ดำสนิทต้องเป็นตระกูลมืดจริง (พื้นดำ) ครีมอุ่นสว่างจริง
  await menu.getByRole('button', { name: 'ดำสนิท', exact: true }).click()
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(0, 0, 0)')
  await menu.getByRole('button', { name: 'ครีมอุ่น', exact: true }).click()
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('color-scheme').trim())).toBe('light')
  await menu.getByRole('button', { name: 'ตามเครื่อง', exact: true }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./)
})

test('no page calls the product plain "Solo" any more', async ({ page }) => {
  for (const hash of ['#/', '#/pricing', '#/start', '?scenario=default#/app/billing']) {
    await page.goto(hash.startsWith('?') ? hash : `?scenario=default${hash}`)
    const text = await page.locator('body').innerText()
    // อนุญาตเฉพาะ "Solo Tutor" — คำว่า Solo โดดๆ ต้องไม่มี
    expect(text.replace(/Solo Tutor/g, ''), hash).not.toMatch(/\bSolo\b/)
  }
})

test('every sub-page has a way back to where it came from', async ({ page }) => {
  await page.goto('?scenario=default#/app/subjects')
  await expect(page.locator('.skel')).toHaveCount(0)
  await page.locator('.srow').first().click()
  await expect(page).toHaveURL(/#\/app\/subjects\/s\d+$/)
  await page.getByRole('link', { name: 'กลับไปนักเรียน' }).click()
  await expect(page).toHaveURL(/#\/app\/subjects$/)

  await page.goto('#/app/billing')
  await page.getByRole('button', { name: 'ใบเสร็จทั้งหมด' }).click()
  await expect(page).toHaveURL(/#\/app\/receipts$/)
  await page.getByRole('link', { name: 'กลับไปบิล' }).click()
  await expect(page).toHaveURL(/#\/app\/billing$/)

  // ใบเสร็จมีปุ่มกลับอยู่แล้ว · หน้าเลือกรูปแบบ/ราคา กลับหน้าแรกได้จากชื่อแบรนด์
  // ลิงก์กลับพา ?stay=1 ไปด้วย เพื่อไม่ให้ครูโหมดจริงถูกเด้งเข้าแอปแทนที่จะได้ดูหน้าขาย
  await page.goto('#/pricing')
  await page.getByRole('link', { name: /Solo Tutor/ }).first().click()
  await expect(page).toHaveURL(/#\/(\?stay=1)?$/)
  await expect(page.locator('.land__hero')).toBeVisible()
})

test('a tutor can paste an existing client list from a spreadsheet and it lands in the app', async ({ page }) => {
  await page.goto('?scenario=empty#/app/today')
  await expect(page.locator('.skel')).toHaveCount(0)
  await page.getByRole('button', { name: 'เมนู' }).click()
  await page.getByRole('dialog', { name: 'เมนู' }).getByRole('button', { name: 'นำเข้ารายชื่อ' }).click()
  const sheet = page.getByRole('dialog', { name: 'นำเข้ารายชื่อ' })
  await expect(sheet).toBeVisible()

  // สิ่งที่ได้จากการคัดลอกช่วงใน Google Sheets คือข้อความคั่นด้วย tab
  await sheet.locator('textarea').fill('ชื่อลูกค้า\tผู้จ่าย\tราคา\nน้องปลา\tคุณแม่ปลา\t400\nน้องต้น\tคุณพ่อต้น\t550')
  await sheet.getByRole('button', { name: 'อ่านข้อมูลที่วาง' }).click()

  // หัวตารางถูกจับได้เอง และแถวหัวไม่ถูกนับเป็นลูกค้า
  await expect(sheet.getByText('น้องปลา')).toBeVisible()
  await expect(sheet.getByRole('button', { name: /นำเข้า \(2\)/ })).toBeEnabled()
  await sheet.getByRole('button', { name: /นำเข้า \(2\)/ }).click()

  await expect(page).toHaveURL(/#\/app\/subjects$/)
  await expect(page.getByText('น้องปลา')).toBeVisible()
  await expect(page.getByText('น้องต้น')).toBeVisible()
  // ราคาในไฟล์ต้องตามเข้ามารายคน ไม่ใช่ใช้ค่าเริ่มต้นทุกคน
  await expect(page.locator('.srow').filter({ hasText: 'น้องต้น' })).toContainText('550')
})
