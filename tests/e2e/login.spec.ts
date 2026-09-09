import { expect, test, type Page } from './fixtures'
import { copy } from '../../src/copy'
import { deriveKey } from '../../src/core/cloudCrypto'
import { packSnapshot } from '../../src/core/cloudSync'
import type { AppState } from '../../src/core/types'
import { installCloud, providerId } from './cloudMock'
import { DEMO_SLOT, REAL_SLOT, ACTIVE_MODE } from './workspace'

/** ตัวนับการใช้งานยิงจากทุกหน้า — build ของคำสั่ง QA ชี้ไป host ที่ไม่มีจริง ต้องรับไว้ */
test.beforeEach(async ({ page }) => {
  await page.route(/https:\/\/[^/]*\.supabase\.co\/functions\/v1\/(usage|report-error)$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
})

/** ทำให้เครื่องนี้เป็นครูที่ใช้จริงและผ่าน onboarding แล้ว (ข้อมูลชุดเดโมกลายเป็นของจริง) */
const becomeRealTeacher = async (page: Page): Promise<AppState> => {
  await page.goto('?scenario=default#/app/today')
  await expect(page.locator('.skel')).toHaveCount(0)
  await expect.poll(() => page.evaluate((demo) => localStorage.getItem(demo), DEMO_SLOT)).not.toBeNull()
  return page.evaluate(([demo, real, pointer]) => {
    const saved = JSON.parse(localStorage.getItem(demo)!)
    saved.mode = 'real'; saved.scenarioId = 'real'; saved.onboarded = true
    saved.provider = { name: 'ครู QA', promptpayId: '0812345678' }
    // สมุดบัญชีจริงอยู่ช่องของมันเอง เดโมยังอยู่ในช่องเดโมเหมือนเดิม
    localStorage.setItem(real, JSON.stringify(saved))
    localStorage.setItem(pointer, 'real')
    return saved
  }, [DEMO_SLOT, REAL_SLOT, ACTIVE_MODE]) as Promise<AppState>
}

test('หน้าแรกยังมีทางเข้าเดียวคือเดโม และมีประตูที่สอง "เข้าสู่ระบบ" บนแถบบน', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('.land__cta a[href$="/start"]')).toHaveCount(1)
  const signIn = page.locator('.land__bar').getByRole('link', { name: copy.landing.signIn })
  await expect(signIn).toHaveAttribute('href', /\/login$/)
  await signIn.click()
  await expect(page).toHaveURL(/#\/login$/)
  await expect(page.getByRole('heading', { name: copy.login.title, exact: true })).toBeVisible()

  // build ปกติไม่มี Supabase = การ์ดรอตั้งค่า · build QA = ฟอร์มเข้าสู่ระบบ — ทั้งสองแบบต้องมีทางไปเดโม
  const form = page.getByRole('heading', { name: 'เข้าสู่ระบบบัญชีครู' })
  const waiting = page.getByRole('heading', { name: copy.account.notConfigured })
  await expect(form.or(waiting)).toBeVisible()
  if (await form.isVisible()) {
    await expect(page.getByText(copy.login.demoNote)).toBeVisible()
    await page.goto('#/login?mode=signup')
    await expect(page.getByRole('heading', { name: 'สมัครบัญชีครู' })).toBeVisible()
  }
  await page.getByRole('link', { name: copy.login.tryDemo }).first().click()
  await expect(page).toHaveURL(/#\/start$/)
  await expect(page.locator('input, textarea, select')).toHaveCount(0)
})

test('ครูที่ใช้จริงอยู่แล้วเปิดหน้าแรกแล้วเข้าแอปเลย ส่วน ?stay=1 ยังดูหน้าขายได้', async ({ page }) => {
  await becomeRealTeacher(page)
  await page.goto('?qa-real=1#/')
  await expect(page).toHaveURL(/#\/app\/today$/)
  await expect(page.getByText(copy.nav.today).first()).toBeVisible()

  await page.goto('?qa-real=2#/?stay=1')
  await expect(page.locator('.land__hero')).toBeVisible()
  await expect(page).not.toHaveURL(/\/app\//)
  // ลิงก์กลับหน้าแรกจากหน้าราคาก็ใช้ทางเดียวกัน ไม่เด้งกลับเข้าแอป
  await page.goto('?qa-real=3#/pricing')
  await page.locator('.backlink').click()
  await expect(page.locator('.land__hero')).toBeVisible()

  // เดโมไม่ถูกเด้ง — หน้าแรกยังเป็นของคนใหม่ (?scenario= ไม่ทับข้อมูลโหมดจริง จึงต้องเริ่มจากเครื่องว่าง)
  await page.evaluate(() => localStorage.clear())
  await page.goto('?scenario=default#/app/today')
  await expect(page.locator('.skel')).toHaveCount(0)
  await page.goto('?qa-real=4#/')
  await expect(page.locator('.land__hero')).toBeVisible()
})

test.describe('เข้าสู่ระบบจากหน้าแรกกับ Supabase จำลอง', () => {
  test.skip(process.env.SOLO_LINE_QA !== '1', 'ต้อง build ด้วย VITE_SUPABASE_URL ชี้ไปที่ mock')

  test('ครูเปลี่ยนเครื่อง: เข้าสู่ระบบจากเดโมแล้วได้ข้อมูลเดิมจากคลาวด์ ไม่ผ่าน onboarding และไม่ทับคลาวด์', async ({ page }) => {
    // ข้อมูลของครูบน "เครื่องเก่า" ถูกเข้ารหัสไว้บนคลาวด์ด้วยรหัสผ่านเดียวกัน
    const other = await becomeRealTeacher(page)
    const sealed = await packSnapshot({ ...other, provider: { ...other.provider, name: 'ครูจากอีกเครื่อง' } },
      await deriveKey('qa-password', providerId), '2025-09-01T00:00:00Z')
    const seen = await installCloud(page, { revision: 7, ...sealed })

    // เครื่องใหม่: ยังเป็นเดโม ไม่มีข้อมูลจริง — เปลี่ยน query ด้วยเพื่อบังคับโหลดเอกสารใหม่ (เปลี่ยนแค่ hash = หน้าเดิม store เดิม)
    await page.evaluate(() => localStorage.clear())
    await page.goto('?scenario=default&device=new#/login')
    await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบบัญชีครู' })).toBeVisible()
    await page.getByLabel('อีเมล').fill('teacher@example.com')
    await page.getByLabel('รหัสผ่าน').fill('qa-password')
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()

    await expect(page).toHaveURL(/#\/app\/today$/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: copy.onboarding.step1 })).toHaveCount(0)
    const saved = await page.evaluate((real) => JSON.parse(localStorage.getItem(real)!), REAL_SLOT) as AppState
    expect(saved.mode).toBe('real')
    expect(saved.provider.name).toBe('ครูจากอีกเครื่อง')
    expect(saved.subjects.length).toBe(other.subjects.length)
    // ดึงมา ไม่ได้ดันขึ้น — คลาวด์ยังเป็น revision 7
    expect(seen.saves).toHaveLength(0)
    await page.goto('#/app/settings/account')
    await expect(page.getByTestId('sync-status')).toHaveText(copy.account.status.synced, { timeout: 15_000 })
  })

  test('ครูใหม่: สมัครจากหน้าแรกแล้วเริ่มโหมดจริงและไป onboarding — ข้อมูลเดโมไม่ติดไป', async ({ page }) => {
    const seen = await installCloud(page, null)
    await page.goto('?scenario=default#/login?mode=signup')
    await expect(page.getByRole('heading', { name: 'สมัครบัญชีครู' })).toBeVisible()
    await page.getByLabel('อีเมล').fill('new-teacher@example.com')
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill('qa-password')
    await page.getByLabel('ยืนยันรหัสผ่าน').fill('qa-password')
    await page.getByRole('button', { name: 'สมัครใช้งาน' }).click()

    await expect(page).toHaveURL(/#\/app\/onboarding/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: copy.onboarding.step1 })).toBeVisible()
    const saved = await page.evaluate((real) => JSON.parse(localStorage.getItem(real)!), REAL_SLOT) as AppState
    expect(saved.mode).toBe('real')
    expect(saved.subjects).toEqual([])
    // สมุดว่างของเครื่องใหม่ถูกส่งขึ้นเป็นรอบแรก (revision 1) — ไม่มีชื่อนักเรียนสมมติหลุดไป
    await expect.poll(() => seen.saves.length, { timeout: 15_000 }).toBe(1)
    expect(atob(String(seen.saves[0].p_cipher))).not.toContain('น้องภูมิ')
  })
})
