import { expect, test } from './fixtures'
import { copy } from '../../src/copy'
import { promptpayPayload } from '../../src/core/promptpay'
import { qrMatrix, qrPath } from '../../src/core/qr'

const PROMPTPAY = '0812345678'

/**
 * QR ที่ผู้ปกครองเห็นต้องสแกนจ่ายได้จริง — ลายที่วาดต้องตรงกับ payload ที่คำนวณจาก
 * เลขพร้อมเพย์ของครูและยอดคงเหลือบนหน้าเดียวกัน ไม่ใช่รูปประดับที่วาดค้างไว้
 */
test('the parent page shows a scannable PromptPay QR only in real mode', async ({ page }) => {
  // เดโมต้องไม่มี QR จริง เพราะเลขพร้อมเพย์เป็นตัวอย่าง สแกนแล้วจะโอนผิดคน
  await page.goto('#/client/c2')
  await expect(page.locator('.qr__code')).toHaveCount(0)
  await expect(page.getByText(copy.clientView.qrSample)).toBeVisible()

  // เขียนสมุดบัญชีจริงทับคีย์เดิมแล้วโหลดใหม่ — เท่ากับเครื่องเก่าก่อนแยกช่อง จึงได้ทดสอบเส้นทางย้ายข้อมูลไปในตัว
  await page.evaluate((promptpayId) => {
    const key = 'solo-demo-v3'
    const state = JSON.parse(localStorage.getItem(key)!)
    state.mode = 'real'
    state.scenarioId = 'real'
    state.provider = { name: 'ครูมายด์', promptpayId, particle: 'ค่ะ' }
    localStorage.setItem(key, JSON.stringify(state))
  }, PROMPTPAY)
  await page.reload() // สลับโหมดแล้วต้องโหลดใหม่ — HashRouter ไม่ hydrate ซ้ำเอง
  await page.goto('#/client/c2')

  const qr = page.locator('.qr__code')
  await expect(qr).toHaveCount(1)
  await expect(qr).toHaveAttribute('aria-label', copy.clientView.scanToPay)

  const due = await page.getByText(/คงเหลือ/).first().innerText()
    .then((text) => Number(text.match(/คงเหลือ ([\d,]+)/)![1].replace(/,/g, '')))
  expect(due).toBeGreaterThan(0)

  const expected = qrPath(qrMatrix(promptpayPayload(PROMPTPAY, due)!)!)
  await expect(qr.locator('path')).toHaveAttribute('d', expected)
})
