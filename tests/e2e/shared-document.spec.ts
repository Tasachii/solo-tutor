import { expect, test } from './fixtures'
import { DEMO_SLOT, REAL_SLOT } from './workspace'

/**
 * หน้าเอกสารสาธารณะ (#/document/<token>) ที่ผู้ปกครองเปิดจากลิงก์ — C-04
 * token เสีย/ถูกแก้ต้องได้หน้าบอกว่าเปิดไม่ได้ ไม่ใช่จอขาว · เอกสารดีต้องไม่โหลดหรือสร้าง workspace ของครู
 * และไม่มี UI ของครู (แท็บ/เมนู/ปุ่มสำรอง) ให้คนที่ถือลิงก์กด
 */
const encode = (doc: unknown): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(doc))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return Buffer.from(bin, 'binary').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const invoice = {
  v: 1, kind: 'invoice', asOf: '2025-09-02', provider: 'ครูทดสอบ', destination: '0812345678',
  payer: 'คุณแม่ทดสอบ', subject: 'น้องทดสอบ', period: '2025-08',
  lines: [{ description: 'คณิต ส.ค. — 2 × 400', qty: 2, unitPrice: 400, amount: 800 }],
  total: 800, paid: 300, dueAt: '2025-09-05',
}

test('เอกสารที่ถูกต้องเปิดได้โดยไม่มี UI ครูและไม่แตะข้อมูลในเครื่อง', async ({ page }) => {
  await page.goto(`#/document/${encode(invoice)}`)
  await expect(page.getByRole('heading', { name: 'ใบแจ้งยอด' })).toBeVisible()
  await expect(page.locator('.paper')).toContainText('คุณแม่ทดสอบ')
  await expect(page.locator('.paper')).toContainText('คงเหลือ')
  await expect(page.locator('.paper')).toContainText('500')
  await expect(page.locator('.tabbar')).toHaveCount(0)
  await expect(page.locator('.shell__menu')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /สำรองข้อมูล|ส่งใน LINE|ดาวน์โหลด CSV/ })).toHaveCount(0)
  // ผู้รับเปิดลิงก์แล้วต้องไม่มี workspace ของครูเกิดขึ้นในเครื่องผู้รับ
  // หน้าเอกสารของผู้ปกครองไม่แตะ workspace ใดเลย ทั้งช่องเดโมและช่องของจริง
  expect(await page.evaluate(([demo, real]) => [localStorage.getItem(demo), localStorage.getItem(real)],
    [DEMO_SLOT, REAL_SLOT])).toEqual([null, null])
})

test('token เสีย ถูกตัด หรือถูกแก้ยอด → หน้าบอกว่าเปิดไม่ได้ ไม่ใช่จอขาวหรือยอดผิด', async ({ page }) => {
  for (const token of [
    'not-a-token',
    encode(invoice).slice(0, 40),
    encode({ ...invoice, total: 1800 }),                 // ยอดรวมไม่ตรงรายการ
    encode({ ...invoice, paid: 900 }),                   // จ่ายเกินยอด
    encode({ ...invoice, kind: 'receipt', paid: 800 }),  // ใบเสร็จต้องมีเลขที่
    encode({ ...invoice, destination: 'x'.repeat(40) }),
  ]) {
    await page.goto(`#/document/${token}`)
    await expect(page.getByRole('heading', { name: 'เปิดเอกสารไม่ได้' })).toBeVisible()
    await expect(page.locator('.paper')).toHaveCount(0)
  }
})

/**
 * ลิงก์รุ่นใหม่ `#/document/<token>.<key>` — กุญแจอยู่หลัง # จึงไม่มีทางเดินทางไปเซิร์ฟเวอร์
 * บิลด์นี้ไม่ได้ตั้งค่าโปรเจกต์ จึงต้องบอกผู้รับตรง ๆ ว่าเปิดจากที่นี่ไม่ได้ ไม่ใช่จอขาวหรือ error
 */
const TOKEN = 'T'.repeat(22)
const KEY = 'k'.repeat(43)

test('ลิงก์ปลอดภัยบนบิลด์ที่ไม่มีโปรเจกต์ บอกให้ขอลิงก์ใหม่ และไม่ส่งกุญแจออกจากเครื่อง', async ({ page }) => {
  const sent: string[] = []
  page.on('request', request => sent.push(`${request.url()} ${request.postData() ?? ''}`))
  await page.goto(`#/document/${TOKEN}.${KEY}`)
  await expect(page.getByRole('heading', { name: 'เปิดเอกสารไม่ได้' })).toBeVisible()
  await expect(page.locator('.paper')).toHaveCount(0)
  // ทั้ง token และกุญแจต้องไม่ปรากฏในคำขอใดที่ออกจากหน้านี้
  expect(sent.filter(line => line.includes(KEY) || line.includes(TOKEN))).toEqual([])
})

test('ลิงก์ปลอดภัยที่รูปแบบไม่ครบล้มแบบปิด ไม่ตกไปอ่านเป็นลิงก์รุ่นเดิม', async ({ page }) => {
  for (const token of [`${TOKEN}.`, `.${KEY}`, `${TOKEN}.${'k'.repeat(10)}`, `${TOKEN}.${KEY}.extra`]) {
    await page.goto(`#/document/${token}`)
    await expect(page.getByRole('heading', { name: 'เปิดเอกสารไม่ได้' })).toBeVisible()
    await expect(page.locator('.paper')).toHaveCount(0)
  }
})

test('ลิงก์รุ่นเดิมยังเปิดได้ และบอกว่าผู้ส่งกำหนดวันหมดอายุหรือปิดลิงก์นี้ไม่ได้', async ({ page }) => {
  await page.goto(`#/document/${encode(invoice)}`)
  await expect(page.getByRole('heading', { name: 'ใบแจ้งยอด' })).toBeVisible()
  await expect(page.getByText('ลิงก์รุ่นเดิม', { exact: false })).toBeVisible()
  await expect(page.getByText('กำหนดวันหมดอายุหรือปิดการเข้าถึงลิงก์นี้ไม่ได้', { exact: false })).toBeVisible()
})
