import { copy } from '../../src/copy'
import { expect, test, type Page } from './fixtures'

const runtimeErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  runtimeErrors.set(page, errors)
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
})

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page) ?? [], 'interaction must not produce runtime errors').toEqual([])
})

async function open(page: Page, path: string) {
  await page.goto(`?scenario=default#${path}`)
  await expect(page.locator('.skel')).toHaveCount(0)
}

test('primary navigation and list rows stay inside the app', async ({ page }) => {
  const popups: string[] = []
  page.on('popup', (popup) => popups.push(popup.url()))
  await open(page, '/app/today')

  for (const [label, path] of [
    ['นักเรียน', '/app/subjects'],
    ['บิล', '/app/billing'],
    ['แอดมิน', '/app/admin'],
    ['วันนี้', '/app/today'],
  ] as const) {
    await page.getByRole('link', { name: new RegExp(label) }).click()
    await expect(page).toHaveURL(new RegExp(`#${path.replaceAll('/', '\\/')}`))
  }

  await page.getByRole('link', { name: /นักเรียน/ }).click()
  await page.locator('.srow').filter({ hasText: 'น้องแพรว' }).click()
  await expect(page).toHaveURL(/#\/app\/subjects\/s1$/)
  await page.getByRole('button', { name: copy.detail.clientView }).click()
  await expect(page).toHaveURL(/#\/client\/c1$/)
  expect(popups).toEqual([])
})

test('clicking controls inside a sheet never dismisses it or changes route', async ({ page }) => {
  await open(page, '/app/today')
  const initialUrl = page.url()
  await page.getByRole('button', { name: 'เมนู' }).click()
  const menu = page.getByRole('dialog', { name: 'เมนู' })
  await expect(menu).toBeVisible()
  await menu.getByRole('tab', { name: 'หน้าจอ' }).click() // ชิปหน้าจอย้ายไปหมวดของมัน

  for (const label of ['เว็บ', 'ส้มอิฐ', 'ใหญ่', 'มืด']) {
    await menu.getByRole('button', { name: label, exact: true }).click()
    await expect(menu).toBeVisible()
    expect(page.url()).toBe(initialUrl)
  }

  await menu.locator('.sheet__body').click({ position: { x: 12, y: 12 } })
  await expect(menu).toBeVisible()
  await page.locator('.veil').click({ position: { x: 10, y: 10 } })
  await expect(menu).toHaveCount(0)
})

test('switching between demo and real mode uses one confirmation layer', async ({ page }) => {
  await open(page, '/app/today')
  await page.getByRole('button', { name: 'เมนู' }).click()
  const menu = page.getByRole('dialog', { name: 'เมนู' })
  await menu.getByRole('tab', { name: 'หน้าจอ' }).click()
  await expect(menu.getByRole('button', { name: 'เต็มจอ' })).toHaveClass(/row/)
  await menu.getByRole('tab', { name: 'ทั่วไป' }).click()
  await menu.getByRole('button', { name: 'เริ่มใช้จริง' }).click()

  await expect(page.locator('.sheet')).toHaveCount(1)
  const startReal = page.getByRole('dialog', { name: 'เริ่มใช้จริง' })
  await expect(startReal).toBeVisible()
  await startReal.getByRole('button', { name: 'เริ่มใช้จริง' }).click()
  await expect(page).toHaveURL(/#\/app\/onboarding$/)

  await page.getByRole('button', { name: 'เมนู' }).click()
  const realMenu = page.getByRole('dialog', { name: 'เมนู' })
  await expect(realMenu.getByRole('tab', { name: 'เดโม' })).toHaveCount(0) // โหมดจริงไม่มีหมวดเดโม
  await realMenu.getByRole('tab', { name: 'หน้าจอ' }).click()
  await expect(realMenu.getByRole('button', { name: 'เต็มจอ' })).toHaveClass(/row/)
  await realMenu.getByRole('tab', { name: 'ทั่วไป' }).click()
  await realMenu.getByRole('button', { name: 'กลับไปโหมดเดโม' }).click()
  await expect(page.locator('.sheet')).toHaveCount(1)
  await expect(page.getByRole('dialog', { name: 'กลับไปโหมดเดโม' })).toBeVisible()
})

test('nested cancellation confirmation closes one layer at a time', async ({ page }) => {
  await open(page, '/app/today')
  const row = page.locator('.urow').filter({ hasText: 'น้องเนย' })
  const move = row.getByRole('button', { name: 'เลื่อน น้องเนย' })
  await move.click()
  await expect(page.getByRole('dialog', { name: 'เลื่อนหรืองดคาบ' })).toBeVisible()
  await page.getByRole('button', { name: 'งดคาบนี้' }).click()
  await expect(page.locator('.sheet')).toHaveCount(2)

  await page.keyboard.press('Escape')
  await expect(page.locator('.sheet')).toHaveCount(1)
  await expect(page.getByRole('dialog', { name: 'เลื่อนหรืองดคาบ' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(move).toBeFocused()
  await expect(row).toBeVisible()
})

test('editing a subject and changing billing controls does not jump away or close', async ({ page }) => {
  await open(page, '/app/subjects/s1')
  const initialUrl = page.url()
  await page.getByRole('button', { name: 'แก้ไข' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  const name = dialog.getByRole('textbox', { name: 'ชื่อ', exact: true })
  await name.fill('น้องแพรว ทดสอบ')
  await dialog.getByRole('button', { name: 'รายครั้ง' }).click()
  await expect(dialog).toBeVisible()
  await expect(name).toHaveValue('น้องแพรว ทดสอบ')
  expect(page.url()).toBe(initialUrl)

  await dialog.getByRole('button', { name: 'ปิด' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'น้องแพรว' })).toBeVisible()
})

test('only an explicit LINE action opens an external window', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __opened: string[] }).__opened = []
    window.open = ((url: string) => {
      ;(window as unknown as { __opened: string[] }).__opened.push(url)
      return {} as Window
    }) as typeof window.open
  })
  await open(page, '/app/admin')

  await page.getByRole('button', { name: /รอส่ง/ }).click()
  await page.getByRole('button', { name: 'แชท' }).click()
  expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual([])

  await page.getByRole('button', { name: /รอส่ง/ }).click()
  await page.locator('.msg').first().getByRole('button', { name: 'ส่งใน LINE' }).click()
  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)
  expect(opened).toHaveLength(1)
  expect(opened[0]).toMatch(/^https:\/\/line\.me\/R\/share\?text=/)
  await expect(page.locator('.confirm__q')).toBeVisible()
})
