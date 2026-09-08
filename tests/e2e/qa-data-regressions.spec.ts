import { expect, test, type Page } from './fixtures'
import { ACTIVE_MODE, DEMO_SLOT, REAL_SLOT } from './workspace'

async function prepareWorkspace(page: Page) {
  await page.goto('?scenario=empty#/app/onboarding')
  await expect.poll(() => page.evaluate((demo) => localStorage.getItem(demo), DEMO_SLOT)).not.toBeNull()
  const dates = await page.evaluate(([demo, real, pointer]) => {
    const state = JSON.parse(localStorage.getItem(demo)!)
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())
    const [year, month] = today.split('-').map(Number)
    const prior = `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, '0')}`
    Object.assign(state, {
      mode: 'real', scenarioId: 'real', today, onboarded: true,
      provider: { name: 'QA Provider Original', promptpayId: '0812345678', particle: 'ครับ' },
      clients: [{ id: 'qa-c', name: 'QA Payer Original' }],
      subjects: ['A', 'B'].map(name => ({ id: `qa-${name}`, clientId: 'qa-c', name: `QA ${name}`, active: true,
        createdAt: `${prior}-01`, billing: { mode: 'per_unit', rate: 900 } })),
      units: [
        ...['A', 'B'].map((name, i) => ({ id: `qa-unit-${name}`, subjectId: `qa-${name}`, scheduledAt: today, time: `${16 + i}:00`, durationMin: 60 })),
        { id: 'qa-old', subjectId: 'qa-A', scheduledAt: `${prior}-15`, time: '16:00', durationMin: 60 },
      ],
      completions: [{ unitId: 'qa-old', completedAt: `${prior}-15`, unitPrice: 400 }],
      invoices: [], payments: [], receipts: [], messages: [], chats: [], events: [],
    })
    localStorage.setItem(real, JSON.stringify(state))
    localStorage.setItem(pointer, 'real')
    return { today, prior }
  }, [DEMO_SLOT, REAL_SLOT, ACTIVE_MODE])
  // Full navigation releases the old lifetime lock and loads the test fixture.
  await page.goto('./#/app/today')
  await expect(page.locator('.urow').filter({ hasText: 'QA A' })).toBeVisible()
  return dates
}

test('two tabs preserve writes, follow updates, and transfer writer ownership on close', async ({ page, context }) => {
  await prepareWorkspace(page)
  const follower = await context.newPage()
  await follower.goto('./#/app/today')
  const a = page.locator('.urow').filter({ hasText: 'QA A' })
  const b = follower.locator('.urow').filter({ hasText: 'QA B' })
  await expect(b).toBeVisible()
  await b.getByRole('button', { name: 'เช็คชื่อ', exact: true }).click()
  expect(await follower.evaluate((real) => JSON.parse(localStorage.getItem(real)!).completions.some((c: { unitId: string }) => c.unitId === 'qa-unit-B'), REAL_SLOT)).toBe(false)
  await a.getByRole('button', { name: 'เช็คชื่อ', exact: true }).click()
  await expect(follower.locator('.urow').filter({ hasText: 'QA A' })).toHaveClass(/urow--done/)
  await page.close()
  await expect.poll(() => follower.evaluate(async () => (await navigator.locks.query()).pending?.length ?? 0)).toBe(0)
  await b.getByRole('button', { name: 'เช็คชื่อ', exact: true }).click()
  await expect(b).toHaveClass(/urow--done/)
  const stored = await follower.evaluate((real) => JSON.parse(localStorage.getItem(real)!), REAL_SLOT)
  expect(stored.completions.map((c: { unitId: string }) => c.unitId).sort()).toEqual(['qa-old', 'qa-unit-A', 'qa-unit-B'])
  await follower.reload()
  await expect(follower.locator('.urow--done')).toHaveCount(2)
  await follower.close()
})

test('past periods can be closed using the saved price after a rate change', async ({ page }) => {
  const { prior } = await prepareWorkspace(page)
  await page.goto('#/app/billing')
  await page.locator('.period-picker select').selectOption(prior)
  await page.getByRole('button', { name: /ปิดยอด.*\(1\)/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'ยืนยัน', exact: true }).click()
  await expect.poll(() => page.evaluate((real) => JSON.parse(localStorage.getItem(real)!).invoices.length, REAL_SLOT)).toBe(1)
  const invoice = await page.evaluate((real) => JSON.parse(localStorage.getItem(real)!).invoices[0], REAL_SLOT)
  expect(invoice.period).toBe(prior)
  expect(invoice.total).toBe(400)
  await page.reload()
  await page.locator('.period-picker select').selectOption(prior)
  expect(await page.evaluate((real) => JSON.parse(localStorage.getItem(real)!).invoices.length, REAL_SLOT)).toBe(1)
})

test('opening an unknown chat cannot create orphan data or break reload', async ({ page }) => {
  await prepareWorkspace(page)
  const before = await page.evaluate((real) => JSON.parse(localStorage.getItem(real)!).chats, REAL_SLOT)
  await page.goto('#/app/admin?tab=chat&chat=not-a-client')
  await expect(page.getByText('ไม่พบผู้จ่าย', { exact: false }).first()).toBeVisible()
  expect(await page.evaluate((real) => JSON.parse(localStorage.getItem(real)!).chats, REAL_SLOT)).toEqual(before)
  await page.reload()
  await expect(page.getByText('ข้อมูลเดิมต้องกู้คืน', { exact: true })).toHaveCount(0)
})

test('a version 4 backup restores through the file picker and upgrades to version 5', async ({ page }) => {
  await prepareWorkspace(page)
  const backup = await page.evaluate((real) => {
    const app = JSON.parse(localStorage.getItem(real)!)
    app.schemaVersion = 4
    delete app.revision
    app.provider.name = 'Restored From Version Four'
    return JSON.stringify({ format: 'solo-backup-1', exportedAt: new Date().toISOString(), app })
  }, REAL_SLOT)
  await page.getByRole('button', { name: 'เมนู' }).click()
  const picker = page.waitForEvent('filechooser')
  await page.getByRole('dialog', { name: 'เมนู' }).getByRole('button', { name: 'กู้คืนจากไฟล์', exact: true }).click()
  await (await picker).setFiles({ name: 'solo-v4.json', mimeType: 'application/json', buffer: Buffer.from(backup) })
  await page.getByRole('dialog', { name: 'กู้คืนจากไฟล์', exact: true }).getByRole('button', { name: 'กู้คืนจากไฟล์', exact: true }).click()
  await expect(page.locator('.greet')).toContainText('Restored From Version Four')
  await page.reload()
  const app = await page.evaluate((real) => JSON.parse(localStorage.getItem(real)!), REAL_SLOT)
  expect(app.schemaVersion).toBe(5)
  expect(app.subjects).toHaveLength(2)
  expect(app.completions[0].unitPrice).toBe(400)
  await expect(page.getByText('ข้อมูลเดิมต้องกู้คืน', { exact: true })).toHaveCount(0)
})

test('a new package price and quantity preserve only the actual old credits', async ({ page }) => {
  await page.goto('?scenario=package-heavy#/app/subjects/p1')
  await expect(page.getByRole('heading', { name: 'น้องอิง', exact: true })).toBeVisible()
  const remainingRow = page.locator('.kv').filter({ hasText: 'เหลือ' }).first()
  const oldRemaining = Number(await remainingRow.locator('b').textContent())
  expect(Number.isFinite(oldRemaining)).toBe(true)
  await page.getByRole('button', { name: /ซื้อแพ็ก|ต่อแพ็ก/ }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('จำนวนครั้งที่ซื้อใหม่').fill('20')
  await sheet.getByLabel('ราคาแพ็กใหม่ (บาท)').fill('6000')
  await sheet.getByRole('button', { name: 'ยืนยัน', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  const state = await page.evaluate((demo) => JSON.parse(localStorage.getItem(demo)!), DEMO_SLOT)
  const billing = state.subjects.find((subject: { id: string }) => subject.id === 'p1').billing
  expect(billing.total).toBe(20)
  expect(billing.carriedCredits).toBe(oldRemaining)
  const invoice = state.invoices.find((row: { subjectId: string; kind: string }) => row.subjectId === 'p1' && row.kind === 'package')
  expect(invoice.total).toBe(6000)
  expect(invoice.lines[0].qty).toBe(20)
  expect(state.payments.find((payment: { invoiceId: string }) => payment.invoiceId === invoice.id).slipVerified).toBe(false)
  // Remove the explicit demo-reset request before checking ordinary durable reload.
  await page.evaluate(() => history.replaceState(null, '', location.pathname + location.hash))
  await page.reload()
  await expect(remainingRow.locator('b')).toHaveText(String(oldRemaining + 20))
})

test('backup passes a valid restorable file to the native share API', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => {
      const file = data.files![0]
      sessionStorage.setItem('qa-shared-file', JSON.stringify({ name: file.name, text: await file.text() }))
    } })
  })
  await prepareWorkspace(page)
  await page.getByRole('button', { name: 'เมนู' }).click()
  await page.getByRole('dialog', { name: 'เมนู' }).getByRole('button', { name: 'สำรองข้อมูล', exact: true }).click()
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('qa-shared-file'))).not.toBeNull()
  const shared = await page.evaluate(() => JSON.parse(sessionStorage.getItem('qa-shared-file')!))
  const backup = JSON.parse(shared.text)
  expect(shared.name).toMatch(/^solo-backup-.*\.json$/)
  expect(backup.format).toBe('solo-backup-1')
  expect(backup.app.schemaVersion).toBe(5)
  expect(backup.app.subjects).toHaveLength(2)
})

test('an explicit demo scenario change survives acquiring the writer lock', async ({ page }) => {
  await page.goto('?scenario=default#/app/today')
  await expect(page.locator('.urow').first()).toBeVisible()
  await page.goto('?scenario=package-heavy#/app/subjects/p1')
  await expect(page.getByRole('heading', { name: 'น้องอิง', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate((demo) => JSON.parse(localStorage.getItem(demo)!).scenarioId, DEMO_SLOT)).toBe('package-heavy')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'น้องอิง', exact: true })).toBeVisible()
})
