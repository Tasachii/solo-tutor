import { expect, test, type Page } from './fixtures'
import { ACTIVE_MODE, DEMO_SLOT, REAL_SLOT } from './workspace'

async function realInvoice(page: Page, destination = '0812345678') {
  await page.goto('?scenario=empty#/app/onboarding')
  await expect(page.locator('.shell')).toBeVisible()
  await page.evaluate(({ promptpayId, demo, real, pointer }) => {
    const s = JSON.parse(localStorage.getItem(demo)!)
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())
    const sent = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
    const due = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10)
    Object.assign(s, { mode: 'real', onboarded: true, today, provider: { name: 'ผู้ให้บริการทดสอบ', promptpayId },
      clients: [{ id: 'qa-client', name: 'ผู้จ่ายทดสอบ' }],
      subjects: [{ id: 'qa-subject', clientId: 'qa-client', name: 'ผู้เรียนทดสอบ', active: true, createdAt: today, billing: { mode: 'per_unit', rate: 3000 } }],
      invoices: [{ id: 'qa-invoice', clientId: 'qa-client', subjectId: 'qa-subject', kind: 'monthly', period: today.slice(0, 7), createdAt: sent,
        sentAt: sent, dueAt: due, status: 'sent', total: 3000, lines: [{ description: 'ค่าบริการทดสอบ', qty: 1, unitPrice: 3000, amount: 3000 }] }],
    })
    // สมุดบัญชีจริงลงช่องของมันเอง ช่องเดโมยังเป็นของเดโม
    localStorage.setItem(real, JSON.stringify(s))
    localStorage.setItem(pointer, 'real')
  }, { promptpayId: destination, demo: DEMO_SLOT, real: REAL_SLOT, pointer: ACTIVE_MODE })
  await page.goto('#/app/billing')
  await page.reload()
  await expect(page.locator('.srow').filter({ hasText: 'ผู้เรียนทดสอบ' })).toBeVisible()
}
const openPayment = (page: Page) => page.locator('.srow').filter({ hasText: 'ผู้เรียนทดสอบ' }).getByRole('button', { name: 'รับยอดจากสลิป' }).click()

test('installments agree across balances, reminder, client, receipt and fresh recipient context', async ({ page, browser }) => {
  await realInvoice(page)
  await openPayment(page)
  await page.getByRole('button', { name: 'ยอดไม่ตรง ใส่ยอดเอง' }).click()
  await page.locator('.sheet input').fill('1000')
  await page.getByRole('button', { name: 'ยืนยันรับยอด' }).click()
  await expect(page.locator('.srow').filter({ hasText: 'ผู้เรียนทดสอบ' })).toContainText('คงเหลือ 2,000')
  await page.goto('#/app/admin')
  await expect(page.locator('.msg__body').first()).toContainText('2,000')
  const invoiceUrl = (await page.locator('.msg__body').first().textContent())!.match(/https?:\/\/\S+\/document\/[\w-]+/)![0]
  const recipient = await browser.newContext()
  const fresh = await recipient.newPage()
  await fresh.goto(invoiceUrl)
  await expect(fresh.getByText('คงเหลือ', { exact: false }).first()).toContainText('2,000')
  expect(await fresh.evaluate(([demo, real]) => [localStorage.getItem(demo), localStorage.getItem(real)], [DEMO_SLOT, REAL_SLOT])).toEqual([null, null])
  await page.goto('#/client/qa-client')
  await expect(page.locator('.page--client')).toContainText('คงเหลือ 2,000')
  await expect(page.locator('.qr__box')).toHaveCount(0)
  await page.goto('#/app/billing')
  await openPayment(page)
  await expect(page.locator('.sheet__s')).toContainText('2,000')
  await page.getByRole('button', { name: 'ยอดตรง รับเงินแล้ว' }).click()
  await page.locator('.srow').getByRole('button', { name: 'ดูใบเสร็จ' }).click()
  await expect(page.locator('tfoot')).toContainText('3,000')
  await page.goto('#/app/admin')
  const receiptUrl = (await page.locator('.msg__body').first().textContent())!.match(/https?:\/\/\S+\/document\/[\w-]+/)![0]
  await fresh.goto(receiptUrl)
  await expect(fresh.getByRole('heading', { name: 'ใบเสร็จรับเงิน' })).toBeVisible()
  await expect(fresh.locator('tfoot')).toContainText('3,000')
  await expect(fresh.getByText('คงเหลือ', { exact: false }).first()).toContainText('0 บาท')
  expect(await fresh.evaluate(([demo, real]) => [localStorage.getItem(demo), localStorage.getItem(real)], [DEMO_SLOT, REAL_SLOT])).toEqual([null, null])
  await recipient.close()
})

test('quota failure cannot acknowledge or commit a payment', async ({ page }) => {
  await realInvoice(page)
  await openPayment(page)
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError') } })
  await page.getByRole('button', { name: 'ยอดตรง รับเงินแล้ว' }).click()
  await expect(page.getByRole('alert')).toContainText('บันทึกไม่สำเร็จ')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('.toast')).toHaveCount(0)
  expect(await page.evaluate((real) => JSON.parse(localStorage.getItem(real)!).payments, REAL_SLOT)).toHaveLength(0)
})

test('corrupt storage is preserved and requires recovery', async ({ page }) => {
  await page.addInitScript((demo) => localStorage.setItem(demo, '{broken'), DEMO_SLOT)
  await page.goto('#/app/today')
  await expect(page.getByRole('heading', { name: 'ข้อมูลเดิมต้องกู้คืน' })).toBeVisible()
  await expect(page.locator('.shell')).toHaveCount(0)
  expect(await page.evaluate((demo) => localStorage.getItem(demo), DEMO_SLOT)).toBe('{broken')
})

test('missing payment destination prevents sending and keeps queue empty', async ({ page }) => {
  await realInvoice(page, '')
  await page.goto('#/app/admin')
  await page.getByRole('button', { name: 'ส่งใน LINE', exact: true }).first().click()
  await expect(page.locator('.toast')).toContainText('พร้อมเพย์ที่ถูกต้อง')
  expect(await page.evaluate((real) => JSON.parse(localStorage.getItem(real)!).sending, REAL_SLOT)).toBeUndefined()
})

test('issued receipt keeps the original payee after profile changes and reload', async ({ page }) => {
  await realInvoice(page)
  await openPayment(page)
  await page.getByRole('button', { name: 'ยอดตรง รับเงินแล้ว' }).click()
  const receipt = await page.evaluate((real) => JSON.parse(localStorage.getItem(real)!).receipts[0], REAL_SLOT)
  expect(receipt.snapshot.provider).toBe('ผู้ให้บริการทดสอบ')
  await page.getByRole('button', { name: 'เมนู' }).click()
  await page.getByRole('dialog', { name: 'เมนู' }).getByRole('button', { name: 'ชื่อและบัญชีรับเงิน' }).click()
  const profile = page.getByRole('dialog', { name: 'ชื่อและบัญชีรับเงิน' })
  await profile.locator('input').first().fill('ผู้รับเงินชื่อใหม่')
  await profile.locator('input').nth(1).fill('0899999999')
  await profile.getByRole('button', { name: 'บันทึก', exact: true }).click()
  await page.goto(`#/receipt/${receipt.id}`)
  await expect(page.locator('.paper__meta')).toContainText('ผู้ให้บริการทดสอบ')
  await expect(page.locator('.paper__meta')).toContainText('0812345678')
  await expect(page.locator('.paper')).not.toContainText('ผู้รับเงินชื่อใหม่')
  await page.reload()
  await expect(page.locator('.paper__meta')).toContainText('ผู้ให้บริการทดสอบ')
  expect(await page.evaluate((real) => JSON.parse(localStorage.getItem(real)!).receipts[0].snapshot, REAL_SLOT)).toEqual(receipt.snapshot)
})
