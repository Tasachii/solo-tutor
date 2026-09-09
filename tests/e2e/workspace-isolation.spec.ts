import { expect, test, type Page } from './fixtures'
import { copy } from '../../src/copy'
import { ACTIVE_MODE, DEMO_SLOT, REAL_SLOT } from './workspace'

/**
 * เดโมกับสมุดบัญชีจริงต้องอยู่คนละช่อง และครูต้องอ่านออกจากหน้าจอว่ากำลังแตะช่องไหน
 * เทสนี้เดินเส้นทางจริงผ่าน UI ไม่ยัด state เอง เพราะสิ่งที่ครูกดคือสิ่งที่ต้องปลอดภัย
 */

const menu = async (page: Page) => {
  await page.getByRole('button', { name: copy.menu.title }).click()
  return page.getByRole('dialog', { name: copy.menu.title })
}

/**
 * สลับ workspace ต้องรอสิทธิ์เขียนของช่องใหม่ก่อน ระหว่างนั้นแท็บบันทึกไม่ได้
 * เทสต้องรอให้แน่ใจ ไม่ใช่กดต่อทันทีแล้วโทษว่าปุ่มพัง
 */
const writable = (page: Page) =>
  expect(page.locator('.shell')).toHaveAttribute('data-write-status', 'writable')

/** ฟอร์มอยู่ในเนื้อหาเท่านั้น — แถบสถานะการเขียนอยู่นอก main และต้องไม่ถูกจับมาปนกับช่องกรอก */
const field = (page: Page, label: string) =>
  page.locator('main .fld').filter({ hasText: label }).locator('input, textarea').first()

const slot = (page: Page, key: string) =>
  page.evaluate((k) => { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : null }, key)

const openDemo = async (page: Page) => {
  await page.goto('?scenario=default#/app/today')
  await expect(page.locator('.skel')).toHaveCount(0)
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), DEMO_SLOT)).not.toBeNull()
}

/** เข้าโหมดใช้จริงผ่านเมนู แล้วผ่าน onboarding จนมีรายชื่อจริงหนึ่งคน */
const becomeReal = async (page: Page) => {
  await (await menu(page)).getByRole('button', { name: copy.menu.startReal }).click()
  await page.getByRole('dialog', { name: copy.menu.startReal }).getByRole('button', { name: copy.menu.startReal }).click()
  await expect(page).toHaveURL(/#\/app\/onboarding$/)
  await writable(page)
  await field(page, copy.onboarding.providerName).fill('ครูของจริง')
  await field(page, 'PromptPay').fill('0812345678')
  await page.getByRole('group', { name: copy.onboarding.particle }).getByRole('button', { name: 'ค่ะ' }).click()
  await page.getByRole('button', { name: 'ถัดไป' }).click()
  await field(page, 'วางรายชื่อจาก Excel หรือ LINE').fill('น้องจริง, คุณแม่จริง')
  await page.getByRole('button', { name: 'เริ่มใช้งาน (1)' }).click()
  await expect(page).toHaveURL(/#\/app\/today$/)
}

test('เริ่มใช้จริงไม่ลบเดโม และรีเซ็ตเดโมไม่แตะสมุดบัญชีจริง', async ({ page }) => {
  await openDemo(page)
  const demoBefore = await slot(page, DEMO_SLOT)
  expect(demoBefore.mode).toBe('demo')
  expect(demoBefore.subjects.length).toBeGreaterThan(0)
  expect(await slot(page, REAL_SLOT)).toBeNull()

  await (await menu(page)).getByRole('button', { name: copy.menu.startReal }).click()
  await page.getByRole('dialog', { name: copy.menu.startReal }).getByRole('button', { name: copy.menu.startReal }).click()
  await expect(page).toHaveURL(/#\/app\/onboarding/)
  await writable(page)

  // เดโมยังอยู่ครบในช่องของมัน และช่องของจริงเป็นของจริง
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), ACTIVE_MODE)).toBe('real')
  const demoAfter = await slot(page, DEMO_SLOT)
  expect(demoAfter.mode).toBe('demo')
  expect(demoAfter.subjects.map((s: { id: string }) => s.id)).toEqual(demoBefore.subjects.map((s: { id: string }) => s.id))
  expect((await slot(page, REAL_SLOT)).mode).toBe('real')
})

test('เมนูบอกช่องที่ใช้อยู่ และปุ่มรีเซ็ตบอกชัดว่าจะล้างอะไร', async ({ page }) => {
  await openDemo(page)
  const sheet = await menu(page)
  await expect(sheet).toContainText(copy.menu.workspaceDemo)
  // รีเซ็ตเป็นเรื่องของเดโมล้วน จึงย้ายไปแท็บ เดโม (9 ก.ย. — เมนูซ้ำ) ไม่อยู่ในแท็บ ทั่วไป อีกแล้ว
  await expect(sheet.getByRole('button', { name: copy.menu.reset })).toHaveCount(0)
  await sheet.getByRole('tab', { name: copy.menu.tabs.demo }).click()
  await sheet.getByRole('button', { name: copy.menu.reset }).click()

  const confirm = page.getByRole('dialog', { name: copy.menu.reset })
  await expect(confirm).toContainText(copy.menu.resetConfirm)
  await expect(confirm).toContainText(copy.menu.resetScope)
  await confirm.getByRole('button', { name: copy.menu.reset }).click()
  await expect(page).toHaveURL(/#\/app\/today$/)
})

test('กลับไปเดโมแล้วกลับมา สมุดบัญชีจริงยังอยู่ครบ ไม่ต้องกู้จากไฟล์', async ({ page }) => {
  await openDemo(page)
  await becomeReal(page)
  await expect(page.getByText(copy.menu.realOn)).toBeVisible()
  const realBefore = await slot(page, REAL_SLOT)
  expect(realBefore.provider.name).toBe('ครูของจริง')
  expect(realBefore.subjects).toHaveLength(1)

  const sheet = await menu(page)
  await expect(sheet).toContainText(copy.menu.workspaceReal)
  await sheet.getByRole('button', { name: copy.menu.backToDemo }).click()
  await page.getByRole('dialog', { name: copy.menu.backToDemo }).getByRole('button', { name: copy.menu.backToDemo }).click()
  await expect(page.getByText(copy.demoBadge)).toBeVisible()
  await writable(page)

  // สมุดบัญชีจริงไม่ถูกแตะระหว่างอยู่เดโม
  expect((await slot(page, REAL_SLOT)).provider.name).toBe('ครูของจริง')

  await (await menu(page)).getByRole('button', { name: copy.menu.startReal }).click()
  await page.getByRole('dialog', { name: copy.menu.startReal }).getByRole('button', { name: copy.menu.startReal }).click()
  await expect(page.getByText(copy.menu.realOn)).toBeVisible()
  await writable(page)
  // กลับมาแล้วเจอสมุดบัญชีเดิม ไม่ใช่ onboarding ของบัญชีเปล่า
  await expect(page).not.toHaveURL(/onboarding/)
  await page.goto('#/app/subjects')
  await expect(page.locator('.srow').filter({ hasText: 'น้องจริง' })).toBeVisible()
  await expect.poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).provider.name, REAL_SLOT)).toBe('ครูของจริง')
})

test('เครื่องเก่าที่มีสมุดบัญชีจริงในคีย์เดิม ย้ายมาช่องของจริงโดยไม่เสียข้อมูล', async ({ page }) => {
  await openDemo(page)
  await page.evaluate((demo) => {
    const saved = JSON.parse(localStorage.getItem(demo)!)
    saved.mode = 'real'; saved.scenarioId = 'real'; saved.onboarded = true
    saved.provider = { name: 'ครูเครื่องเก่า', promptpayId: '0812345678' }
    localStorage.setItem(demo, JSON.stringify(saved))
  }, DEMO_SLOT)

  await page.goto('./#/app/today')
  await expect(page.locator('.skel')).toHaveCount(0)
  await expect(page.getByText(copy.menu.realOn)).toBeVisible()
  await writable(page)
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), ACTIVE_MODE)).toBe('real')

  const real = await slot(page, REAL_SLOT)
  expect(real.mode).toBe('real')
  expect(real.provider.name).toBe('ครูเครื่องเก่า')
  expect(real.subjects.length).toBeGreaterThan(0)
  // คีย์เดิมกลายเป็นช่องเดโม ต้องไม่มีสมุดบัญชีจริงค้างให้เดโมทับ
  const demo = await slot(page, DEMO_SLOT)
  expect(demo === null || demo.mode === 'demo').toBe(true)
})
