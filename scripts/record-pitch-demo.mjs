import { chromium, expect } from '@playwright/test'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { seedOf } from '../src/core/share.ts'

const destination = resolve(process.env.SOLO_PITCH_DIR ?? '.omx/pitch-kit')
const base = process.env.SOLO_DEMO_URL ?? 'http://localhost:4297/solo-tutor/'
const fast = process.env.SOLO_DEMO_FAST === '1'
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Recording requires a local QA build')
const fixture = JSON.parse(await readFile(resolve(destination, 'solo-demo-kru-ploy-5.json'), 'utf8'))
if (fixture.app.mode !== 'demo' || fixture.app.subjects.length !== 5) throw new Error('Expected five-student Demo fixture')
if (fixture.app.provider.promptpayId !== '08x-xxx-xxxx' || fixture.app.lineWorkspaceId || fixture.app.lineProviderId
  || ['invoices','payments','receipts'].some(key => fixture.app[key].length)) throw new Error('Fixture must have no real destination, LINE identity or financial history')
let demoTime = Date.parse(`${fixture.app.today}T09:00:00+07:00`)
const invoiceId = () => `inv-s-${demoTime.toString(36)}1-${fixture.app.today.slice(0, 7)}`
while (seedOf(invoiceId()) >= 0.8) demoTime++
await mkdir(resolve(destination, 'recording'), { recursive: true })
const browser = await chromium.launch()
const results = []
try {
  for (let round = 1; round <= 3; round++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Bangkok',
      serviceWorkers: 'block', ...(round === 1 && !fast ? { recordVideo: { dir: resolve(destination, 'recording'), size: { width: 1280, height: 900 } } } : {}) })
    const externalAttempts = []
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === new URL(base).origin) return route.continue()
      externalAttempts.push(new URL(route.request().url()).hostname)
      return route.abort()
    })
    await context.addInitScript(app => {
      if (!sessionStorage.getItem('pitch-loaded')) {
        localStorage.setItem('solo-demo-v3', JSON.stringify(app)); sessionStorage.setItem('pitch-loaded', '1')
      }
      window.__pitchLineUrls = []
      window.open = url => { window.__pitchLineUrls.push(String(url)); return {} }
    }, fixture.app)
    const page = await context.newPage()
    await page.clock.setFixedTime(new Date(demoTime))
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    const started = Date.now()
    const caption = async (text, seconds = 6) => {
      await page.evaluate(text => {
        let el = document.getElementById('pitch-caption')
        if (!el) { el = document.createElement('div'); el.id = 'pitch-caption'; document.body.append(el) }
        el.textContent = text
        el.style.cssText = 'position:fixed;right:16px;top:10px;max-width:530px;padding:10px 18px;background:#152f2e;color:white;border-radius:14px;z-index:99999;font:16px Anuphan,sans-serif;pointer-events:none;box-shadow:0 3px 15px #0002'
      }, text)
      if (round === 1 && !fast) await page.waitForTimeout(seconds * 1000)
    }
    await page.goto(`${base}#/app/subjects`)
    await expect(page.locator('button.srow')).toHaveCount(5)
    await caption('ครูพลอย · นักเรียน 5 คน · ข้อมูลสมมติสำหรับสาธิต', 8)
    await page.getByRole('button', { name: '+ เพิ่ม', exact: true }).click()
    const add = page.getByRole('dialog')
    await add.getByLabel('ชื่อ', { exact: true }).fill('น้องออม (ตัวอย่าง)')
    await add.getByLabel('ชื่อผู้จ่าย', { exact: true }).fill('คุณแม่ออม (ตัวอย่าง)')
    await caption('1. เพิ่มนักเรียนและกำหนดค่าเรียนร่วมกัน', 6)
    await add.getByRole('button', { name: 'บันทึก', exact: true }).click()
    await expect(page.locator('button.srow')).toHaveCount(6)
    await page.goto(`${base}#/app/today`)
    await page.getByRole('button', { name: '+ เพิ่มวันนี้', exact: true }).click()
    const lesson = page.getByRole('dialog')
    await lesson.getByRole('combobox').selectOption({ label: 'น้องออม (ตัวอย่าง)' })
    await lesson.getByRole('button', { name: 'บันทึก', exact: true }).click()
    await page.locator('.urow').filter({ hasText: 'น้องออม (ตัวอย่าง)' }).getByRole('button', { name: 'เช็คชื่อ', exact: true }).click()
    await caption('2. บันทึกคาบที่สอนเสร็จ ระบบนับยอดให้', 10)
    await page.goto(`${base}#/app/billing`)
    await page.getByRole('button', { name: /^ปิดยอดเดือนนี้/ }).click()
    await page.getByRole('dialog', { name: 'ปิดยอดเดือนนี้' }).getByRole('button', { name: 'ยืนยัน', exact: true }).click()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('solo-demo-v3')).invoices[0].id)).toBe(invoiceId())
    await caption('3. ออกบิลจากคาบที่บันทึกจริง', 9)
    await page.goto(`${base}#/app/admin`)
    const bill = page.locator('.msg').filter({ hasText: 'น้องออม (ตัวอย่าง)' }).first()
    await expect(bill).toBeVisible()
    await caption('4. ครูอ่านข้อความก่อนกดส่งทุกครั้ง', 10)
    await bill.getByRole('button', { name: 'ส่งใน LINE', exact: true }).click()
    expect(await page.evaluate(() => window.__pitchLineUrls.some(url => url.startsWith('https://line.me/R/share?text=')))).toBe(true)
    await caption('จำลองเปิด LINE เพื่อซ้อมเท่านั้น · ไม่ส่งหาผู้ปกครองจริง', 7)
    await page.getByRole('button', { name: 'ส่งแล้ว', exact: true }).click()
    await page.goto(`${base}#/app/billing`)
    const row = page.locator('.srow').filter({ hasText: 'น้องออม (ตัวอย่าง)' })
    await row.getByRole('button', { name: 'แนบสลิป (จำลอง)', exact: true }).click()
    await page.getByRole('button', { name: 'เลือกรูปสลิป', exact: true }).click()
    await expect(page.getByRole('button', { name: 'ยืนยันรับยอด', exact: true })).toBeVisible()
    await caption('5. ครูตรวจสลิปแล้วบันทึกรับเงิน · วิดีโอนี้ใช้สลิปจำลอง', 11)
    await page.getByRole('button', { name: 'ยืนยันรับยอด', exact: true }).click()
    await row.getByRole('button', { name: 'ดูใบเสร็จ', exact: true }).click()
    await expect(page.locator('.paper')).toContainText('ครูพลอย')
    await caption('6. ใบเสร็จพร้อมส่ง · ทุกยอดในวิดีโอนี้เป็นข้อมูล Demo', 11)
    const result = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('solo-demo-v3'))
      return { invoices: state.invoices.length, payments: state.payments.length, receipts: state.receipts.length,
        amount: state.payments[0]?.amount, invoiceAmount: state.invoices[0]?.total, mode: state.mode }
    })
    expect(result).toMatchObject({ invoices: 1, payments: 1, receipts: 1, mode: 'demo' })
    expect(result.amount).toBe(result.invoiceAmount)
    await page.goto(`${base}#/app/settings/line`)
    await page.getByRole('button', { name: 'จำลองผู้ปกครองพิมพ์รหัส', exact: true }).click()
    await expect(page.getByText('เชื่อมแล้ว (จำลอง)', { exact: true })).toBeVisible()
    await caption('LINE OA: ผู้ปกครองเพิ่มเพื่อน → พิมพ์รหัส → ครูกดส่งบิลเอง', 10)
    if (round === 1 && !fast) await page.waitForTimeout(Math.max(0, 90_000 - (Date.now() - started)))
    expect(errors).toEqual([])
    expect(externalAttempts).toEqual([])
    const video = page.video()
    await context.close()
    if (video) await video.saveAs(resolve(destination, 'solo-demo-90s-source.webm'))
    results.push({ round, result: 'passed', ...result, pageErrors: errors.length, attemptedExternalRequests: externalAttempts.length,
      realMessagesSent: 0, lineShareIntercepted: true })
    console.log(`Demo round ${round}/3 passed`)
  }
  await writeFile(resolve(destination, 'demo-three-rounds.json'), JSON.stringify(results, null, 2))
} finally { await browser.close() }
