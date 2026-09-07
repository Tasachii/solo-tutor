import { expect, test, type Page } from './fixtures'
import { copy } from '../../src/copy'

/**
 * เดินเส้นทางเดโมทั้งเส้นบน build จริง
 * ทุกเทสโหลดด้วย ?scenario=default เพื่อให้ได้ข้อมูลชุดใหม่ ไม่ติดค่าจาก localStorage
 */
const open = async (page: Page, hash: string): Promise<void> => {
  await page.goto(`?scenario=default#${hash}`)
  await expect(page.locator('.skel')).toHaveCount(0)
}

test('หน้าแรกมีทางเข้าเดียว ไม่ใช่เมนูให้เลือก', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText('เดโม · ข้อมูลสมมติ').first()).toBeVisible()

  // hero มีทางเข้าเดียว (CTA ล่างเป็นอีกจุดตั้งใจ ไม่ใช่ปุ่มซ้ำใน hero เดียวกัน)
  await expect(page.locator('.land__cta a[href$="/start"]')).toHaveCount(1)
  // ทุกทางเข้าพาไปหน้าเลือกรูปแบบเดียวกัน — เป็นทางเลือกแตะเดียว ไม่ใช่ฟอร์ม
  const entries = page.locator('a[href$="/start"]')
  await expect(entries).not.toHaveCount(0)
  for (const href of await entries.evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href')))) {
    expect(href).toContain('/start')
  }

  // อาชีพที่ยังไม่เปิดบอกให้รู้ได้ แต่ต้องไม่ทำเป็นตัวเลือกให้กด
  await expect(page.locator('.soonline')).toContainText('ช่างทำเล็บ')
  await expect(page.locator('.soonline')).toContainText('หมอดู')
  await expect(page.locator('.soonline')).toContainText('หมอนวด')
  await expect(page.locator('.picker__i')).toHaveCount(0)

  // ของสำหรับนำเสนอไม่ควรอยู่หน้าที่ผู้ใช้เข้ามาใช้งาน
  await expect(page.locator('.engine')).toHaveCount(0)
})

test('หน้าราคามีปุ่มกลับหน้าแรก', async ({ page }) => {
  await page.goto('#/pricing')
  const back = page.locator('.backlink')
  await expect(back).toBeVisible()
  await back.click()
  await expect(page.locator('.land__h1')).toContainText(copy.landing.h1a) // ผูกกับ copy ไม่ใช่คำที่พิมพ์ค้าง
  await expect(page.locator('.plans')).toHaveCount(0)
})

test('เส้นทางที่ไม่มีจริงพากลับหน้าแรก ไม่ใช่จอว่าง', async ({ page }) => {
  // /pitch ถูกลบไปแล้ว — ของสำหรับนำเสนอไม่ใช่ของโปรดักต์
  await page.goto('#/pitch')
  await expect(page.locator('.land__h1')).toBeVisible()
  await expect(page.locator('.engine')).toHaveCount(0)
})

test('วันนี้มี 4 คาบ ยืนยันแล้ว 1 รอ 3', async ({ page }) => {
  await open(page, '/app/today')
  await expect(page.locator('.urow')).toHaveCount(4)
  await expect(page.locator('.urow--done')).toHaveCount(1)
  await expect(page.locator('.stat').nth(2)).toContainText('3')
})

test('เช็คชื่อคาบที่แพ็กหมดแล้ว ได้คำเตือนและร่างชวนต่อเพิ่มมาหนึ่งใบ', async ({ page }) => {
  await open(page, '/app/today')
  await expect(page.locator('.tab__badge')).toHaveText('3')

  const row = page.locator('.urow').filter({ hasText: 'น้องกัน' })
  await row.getByRole('button', { name: 'เช็คชื่อ' }).click()

  await expect(page.locator('.toast')).toContainText('หมดแล้ว')
  await expect(page.locator('.tab__badge')).toHaveText('4')
})

test('ปิดยอดเดือนนี้สร้างบิลให้ 5 คน', async ({ page }) => {
  await open(page, '/app/billing')
  const close = page.getByRole('button', { name: /ปิดยอดเดือนนี้/ })
  await expect(close).toContainText('(5)')
  await close.click()
  // เป็นการสร้างบิลจริง จึงถามยืนยันก่อนหนึ่งชั้น
  await page.locator('.sheet').getByRole('button', { name: 'ยืนยัน' }).click()
  await expect(page.getByRole('button', { name: /ปิดยอดเดือนนี้/ })).toHaveCount(0)
})

test('สลิปตรงยอด ยืนยันแล้วได้ใบเสร็จ', async ({ page }) => {
  await open(page, '/app/billing')
  await page.locator('.period-picker select').selectOption('2025-08')
  await page.locator('.srow').filter({ hasText: 'น้องภูมิ' })
    .getByRole('button', { name: /แนบสลิป/ }).click()

  await page.getByRole('button', { name: 'เลือกรูปสลิป' }).click()
  const confirm = page.getByRole('button', { name: /ยืนยันรับยอด|รับยอดตามสลิป|ยืนยันเอง/ })
  await expect(confirm).toBeVisible({ timeout: 10_000 })

  // การกดซ้ำทดสอบที่ระดับ reducer แทน (tests/unit/reducer.test.ts)
  // เพราะพอกดครั้งแรกชีทก็ถูกถอดออกจาก DOM แล้ว คลิกถัดไปไม่ถึงปุ่มจริง
  await confirm.click()
  await open(page, '/app/receipts')
  await expect(page.locator('.rows > li').filter({ hasText: /SL-\d{4}-\d{4}/ })).toHaveCount(1)
})

test('ข้อความถึงผู้ปกครองใช้ลิงก์เต็ม และไม่ซ้ำคำนำหน้า', async ({ page }) => {
  await open(page, '/app/admin')
  const drafts = page.locator('.msg__body')
  await expect(drafts.first()).toBeVisible()

  for (const text of await drafts.allInnerTexts()) {
    expect(text, 'ห้ามเติมคำนำหน้าซ้ำ').not.toMatch(/คุณคุณ/)
    expect(text, 'ห้ามเหลือตัวแปรที่ยังไม่ถูกแทนค่า').not.toMatch(/\{[a-zA-Z]+\}/)
    if (text.includes('/client/')) {
      expect(text, 'ลิงก์ต้องกดได้จากแชท').toMatch(/https?:\/\/[^\s]+\/#\/client\//)
    }
  }
})

test('ผู้จ่ายกดลิงก์แล้วเจอบิลใบที่ทวง พร้อม QR', async ({ page }) => {
  await open(page, '/client/c4')
  await expect(page.locator('.cbanner')).toContainText('มุมมองผู้จ่าย')
  await expect(page.locator('.cv__lines--sum')).toContainText('2,800')
  await expect(page.locator('.cv__pay')).toBeVisible()
  await expect(page.getByText('เดโม · ข้อมูลสมมติ')).toBeVisible()
})

test('ไม่มีข้อความไหนส่งออกโดยผู้ใช้ไม่ได้กดส่ง', async ({ page }) => {
  await open(page, '/app/admin')
  const before = await page.locator('.msg').count()
  await page.reload()
  await expect(page.locator('.skel')).toHaveCount(0)
  await expect(page.locator('.msg')).toHaveCount(before)   // โหลดใหม่ไม่ทำให้ร่างหายไปเอง
})

test('เปิด LINE แล้วยังไม่นับว่าส่ง จนกว่าครูจะยืนยัน', async ({ page }) => {
  // ดัก window.open ไว้ ไม่ให้เด้งออกไปหา LINE จริงตอนเทส
  await page.addInitScript(() => {
    ;(window as unknown as { __opened: string[] }).__opened = []
    window.open = ((url: string) => {
      ;(window as unknown as { __opened: string[] }).__opened.push(url)
      return {} as Window
    }) as typeof window.open
  })
  await open(page, '/app/admin')

  const before = await page.locator('.msg').count()
  expect(before).toBeGreaterThan(0)

  await page.locator('.msg').first().getByRole('button', { name: 'ส่งใน LINE' }).click()

  // LINE ถูกเปิดพร้อมข้อความ
  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)
  expect(opened[0]).toContain('line.me/R/share?text=')

  // แต่ยังต้องไม่ถูกนับว่าส่ง — การ์ดยังอยู่ครบ และถามยืนยันค้างไว้
  await expect(page.locator('.confirm__q')).toBeVisible()
  await expect(page.locator('.msg')).toHaveCount(before)

  // บอกว่ายังไม่ได้ส่ง → ร่างต้องกลับมาเหมือนเดิม
  await page.getByRole('button', { name: 'ยังไม่ได้ส่ง' }).click()
  await expect(page.locator('.msg')).toHaveCount(before)
  await expect(page.locator('.confirm__q')).toHaveCount(0)

  // ยืนยันว่าส่งแล้ว → ร่างถึงจะหายไปหนึ่งใบ
  await page.locator('.msg').first().getByRole('button', { name: 'ส่งใน LINE' }).click()
  await page.getByRole('button', { name: 'ส่งแล้ว' }).click()
  await expect(page.locator('.msg')).toHaveCount(before - 1)
})

test('เลื่อนคาบแล้วยอดบิลไม่ขยับ และมีร่างแจ้งผู้ปกครองรออยู่', async ({ page }) => {
  await open(page, '/app/billing')
  const money = async () => (await page.locator('.stat').first().innerText()).replace(/\D/g, '')
  const expectedBefore = await money()
  const draftsBefore = Number(await page.locator('.tab__badge').innerText())

  await open(page, '/app/today')
  const row = page.locator('.urow').filter({ hasText: 'น้องเนย' })
  await row.getByRole('button', { name: 'เลื่อน น้องเนย' }).click()

  const sheet = page.locator('.sheet')
  await expect(sheet).toBeVisible()
  await sheet.locator('input[type="date"]').fill('2025-09-20')
  await sheet.locator('input[type="time"]').fill('19:30')
  await sheet.getByRole('button', { name: /^เลื่อน$/ }).click()

  // คาบหายจากวันนี้
  await expect(page.locator('.urow').filter({ hasText: 'น้องเนย' })).toHaveCount(0)
  // มีร่างแจ้งเพิ่มมาหนึ่งใบ
  await expect(page.locator('.tab__badge')).toHaveText(String(draftsBefore + 1))

  // เงินต้องไม่ขยับ
  await open(page, '/app/billing')
  expect(await money()).toBe(expectedBefore)
})

test('สำรองข้อมูลแล้วได้ไฟล์ที่กู้คืนได้', async ({ page }) => {
  // Exercise the download fallback; native share sheets are checked through their file contract separately.
  await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false }))
  await open(page, '/app/today')
  await page.locator('.shell__menu').click()
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.sheet .row').filter({ hasText: 'สำรองข้อมูล' }).click(),
  ])
  expect(dl.suggestedFilename()).toMatch(/^solo-backup-\d{4}-\d{2}-\d{2}\.json$/)

  const stream = await dl.createReadStream()
  const text = await new Promise<string>((resolve) => {
    let out = ''
    stream.on('data', (c) => { out += c })
    stream.on('end', () => resolve(out))
  })
  const file = JSON.parse(text)
  expect(file.format).toBe('solo-backup-1')
  expect(file.app.subjects.length).toBeGreaterThan(0)
  expect(file.app.schemaVersion).toBe(5)
})

test('ส่งสรุปให้ผู้ปกครองเปิด LINE พร้อมจำนวนครั้งจริง', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __opened: string[] }).__opened = []
    window.open = ((url: string) => {
      ;(window as unknown as { __opened: string[] }).__opened.push(url)
      return {} as Window
    }) as typeof window.open
  })
  await open(page, '/app/subjects')
  await page.locator('.srow').filter({ hasText: 'น้องเนย' }).click()
  await page.getByRole('button', { name: 'ส่งสรุปให้ผู้ปกครอง' }).click()

  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)
  const text = decodeURIComponent(opened[0].split('text=')[1])
  expect(text).toContain('น้องเนย')
  expect(text).toMatch(/เหลืออีก 2 จาก 10/)
  expect(text).not.toMatch(/\{[a-zA-Z]+\}/)
})

test('ทุกทางเข้าพาไปใช้งานได้เลย ไม่มีฟอร์มมาขวาง', async ({ page }) => {
  // หน้าแรก
  await page.goto('./')
  for (const label of ['เดโม', 'ทดลองใช้']) {
    const link = page.locator('.land').getByRole('link', { name: label }).first()
    await expect(link).toHaveAttribute('href', /\/start$/)
  }
  // การ์ดตัวอย่างบน hero ต้องเป็นเคสติวเตอร์ล้วน — เลิกปนอาชีพที่ยังไม่เปิด
  for (const word of ['ต่อเล็บเจล', 'ทำความสะอาด', 'คุณมิ้นท์']) {
    await expect(page.locator('.land__hero')).not.toContainText(word)
  }
  await expect(page.locator('.land__hero')).toContainText('ค่าเรียนน้องภูมิ')

  // หน้าราคา — 4 แพลน (Free · Pro รายเดือน · 3 เดือน · 12 เดือน) ทุกแพลนเป็นลิงก์เข้าหน้าเลือกรูปแบบ ไม่ใช่ปุ่มเปิดฟอร์ม
  await page.goto('#/pricing')
  const ctas = page.locator('.plan__cta')
  await expect(ctas).toHaveCount(4)
  for (let i = 0; i < 4; i++) await expect(ctas.nth(i)).toHaveAttribute('href', /\/start$/)
  await expect(page.getByText('Concierge')).toHaveCount(0)
  await expect(page.getByText('เปิดรับรุ่นแรก 10 คน — เราตั้งระบบให้ฟรี', { exact: true })).toBeVisible()
  await expect(page.getByText('ช่วงรุ่นแรกยังไม่เปิดชำระเงินในแอป — ทีมเปิดใช้งานให้ทีละคน')).toBeVisible()
  await expect(page.locator('.plan__amt').nth(3)).toHaveText(/2,490/)
  // ฟรีจำกัด 5 นักเรียน (แผนธุรกิจ rev.2) — เคยเขียนว่าไม่จำกัด
  await expect(page.locator('.plan').first()).toContainText('สูงสุด 5 นักเรียน')
  await expect(page.locator('.plan').first()).not.toContainText('ไม่จำกัด')
  // ค่าเฉลี่ยต่อเดือนคำนวณจากราคาจริง ไม่ได้พิมพ์ไว้
  await expect(page.locator('.plan').nth(2).locator('.plan__save')).toContainText('เฉลี่ย 266/เดือน')
  await expect(page.locator('.plan').nth(3).locator('.plan__save')).toContainText('เฉลี่ย 208/เดือน')
  await expect(page.locator('.plan').nth(3).locator('.plan__save b')).toHaveText('ประหยัด 1,098')
  // กดแล้วเลือกแบบหนึ่งแตะเดียว ถึงหน้าใช้งานโดยไม่ต้องกรอกอะไร
  await ctas.nth(1).click()
  await expect(page.locator('input, textarea, select')).toHaveCount(0)
  await page.getByRole('button', { name: /ผสม/ }).click()
  await expect(page.locator('.skel')).toHaveCount(0)
  await expect(page.locator('.urow').first()).toBeVisible()
  await expect(page.locator('.sheet')).toHaveCount(0)
})

test('ไม่มี dialog ของเบราว์เซอร์เหลืออยู่ — งดคาบใช้ชีทที่แปลได้', async ({ page }) => {
  // ถ้ามี window.confirm/prompt โผล่ Playwright จะ dismiss ให้อัตโนมัติ
  // เราจับไว้เพื่อพิสูจน์ว่าไม่มีอันไหนถูกเรียกเลย
  const native: string[] = []
  page.on('dialog', async (d) => { native.push(d.type()); await d.dismiss() })

  await open(page, '/app/today')
  const row = page.locator('.urow').filter({ hasText: 'น้องเนย' })
  await row.getByRole('button', { name: 'เลื่อน น้องเนย' }).click()
  await page.locator('.sheet').getByRole('button', { name: 'งดคาบนี้' }).click()

  // ชีทยืนยันของเราเอง ไม่ใช่ dialog ของระบบ
  const confirmSheet = page.getByRole('dialog', { name: 'งดคาบนี้และแจ้งผู้ปกครอง?' })
  await expect(confirmSheet).toBeVisible()
  await confirmSheet.getByRole('button', { name: 'งดคาบนี้' }).click()

  // คาบหายจากรายการหลัก แต่ยังกู้คืนได้
  await expect(page.locator('.urow--off')).toHaveCount(1)
  await page.locator('.urow--off').getByRole('button', { name: 'เอากลับมา' }).click()
  await expect(page.locator('.urow--off')).toHaveCount(0)
  await expect(page.locator('.urow').filter({ hasText: 'น้องเนย' })).toHaveCount(1)

  expect(native, 'ห้ามมี dialog ของเบราว์เซอร์').toEqual([])
})
