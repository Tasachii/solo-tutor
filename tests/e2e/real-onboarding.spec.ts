import { expect, test, type Page } from './fixtures'
import { copy } from '../../src/copy'

/**
 * เส้นทางของครูตัวจริง (ผู้หญิง): เริ่มใช้จริง → กรอกชื่อ เลือก ค่ะ → รายชื่อ → เช็คชื่อ → ปิดยอด
 * ทุกร่างต้องพูด ค่ะ/คะ — และแก้ทีหลังจากเมนูได้โดยไม่ต้องล้างข้อมูล
 */
async function startReal(page: Page) {
  await page.goto('?scenario=default#/app/today')
  await expect(page.locator('.skel')).toHaveCount(0)
  await page.getByRole('button', { name: 'เมนู' }).click()
  await page.getByRole('dialog', { name: 'เมนู' }).getByRole('button', { name: 'เริ่มใช้จริง' }).click()
  await page.getByRole('dialog', { name: 'เริ่มใช้จริง' }).getByRole('button', { name: 'เริ่มใช้จริง' }).click()
  await expect(page).toHaveURL(/#\/app\/onboarding$/)
}

const field = (page: Page, label: string) => page.locator('.fld').filter({ hasText: label }).locator('input, textarea').first()
const particleGroup = (scope: Page | ReturnType<Page['getByRole']>) => scope.getByRole('group', { name: copy.onboarding.particle })

test('a female tutor never has to say ครับ — and can flip it later from the menu', async ({ page }) => {
  await startReal(page)

  await field(page, copy.onboarding.providerName).fill('ครูมายด์')
  await field(page, 'PromptPay').fill('0812345678')
  // ยังไม่เลือกคำลงท้าย = ห้ามไปต่อ — ค่าเริ่มต้นผิดเพศคือบั๊กที่กันไว้
  await expect(page.getByRole('button', { name: 'ถัดไป' })).toBeDisabled()
  await particleGroup(page).getByRole('button', { name: 'ค่ะ' }).click()
  await expect(page.getByText('ตัวอย่าง: ขอบคุณค่ะ')).toBeVisible()
  await page.getByRole('button', { name: 'ถัดไป' }).click()

  await field(page, 'วางรายชื่อจาก Excel หรือ LINE').fill('น้องปลา, คุณแม่ปลา')
  await page.getByRole('button', { name: 'เริ่มใช้งาน (1)' }).click()
  await expect(page).toHaveURL(/#\/app\/today$/)

  await page.getByRole('button', { name: '+ เพิ่มวันนี้' }).click()
  const add = page.getByRole('dialog', { name: '+ เพิ่มวันนี้' })
  await add.getByRole('combobox').selectOption({ label: 'น้องปลา' })
  await add.getByRole('button', { name: 'บันทึก' }).click()
  await page.getByRole('button', { name: 'เช็คชื่อ' }).click()

  await page.goto('#/app/billing')
  await page.getByRole('button', { name: 'ปิดยอดเดือนนี้ (1)' }).click()
  await page.getByRole('dialog', { name: 'ปิดยอดเดือนนี้' }).getByRole('button', { name: 'ยืนยัน' }).click()

  await page.goto('#/app/admin')
  const draft = page.locator('.msg__body').first()
  await expect(draft).toContainText('ค่ะ')
  await expect(draft).not.toContainText('ครับ')

  // แก้ทีหลัง: เมนู → ชื่อและบัญชีรับเงิน
  await page.getByRole('button', { name: 'เมนู' }).click()
  await page.getByRole('dialog', { name: 'เมนู' }).getByRole('button', { name: 'ชื่อและบัญชีรับเงิน' }).click()
  const profile = page.getByRole('dialog', { name: 'ชื่อและบัญชีรับเงิน' })
  await expect(profile.locator('input').first()).toHaveValue('ครูมายด์')
  await expect(profile.locator('input').nth(1)).toHaveValue('0812345678')
  await particleGroup(profile).getByRole('button', { name: 'ครับ' }).click()
  await profile.locator('input').nth(1).fill('081')
  await profile.getByRole('button', { name: 'บันทึก' }).click()
  await expect(profile.getByText('ใส่เบอร์มือถือไทย 10 หลัก', { exact: false })).toBeVisible()
  await profile.locator('input').nth(1).fill('0899999999')
  await profile.getByRole('button', { name: 'บันทึก' }).click()
  await expect(profile).toHaveCount(0)

  // ร่างที่รอส่งเปลี่ยนเสียงตาม และเลขบัญชีใหม่อยู่ในเอกสารที่ลิงก์
  await expect(draft).toContainText('ครับ')
  await expect(draft).not.toContainText('ค่ะ')
  const url = (await draft.textContent())!.match(/https?:\/\/\S+\/document\/[\w-]+/)![0]
  await page.goto(url)
  await expect(page.getByText('0899999999', { exact: false }).or(page.getByText('089-999-9999', { exact: false })).first()).toBeVisible()
})
