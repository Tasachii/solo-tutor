import { chromium, devices } from '@playwright/test'
import { homedir } from 'node:os'
import { join } from 'node:path'
const SITE = 'https://tasachii.github.io/solo-tutor/'
const OUT = join(homedir(), 'Downloads', 'solo-flow-20260909')
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'th-TH', timezoneId: 'Asia/Bangkok' })
const page = await ctx.newPage()
const log = (m) => console.log(m)
let n = 0
const shot = async (name) => { n++; const f = `${String(n).padStart(2,'0')}-${name}.png`; await page.screenshot({ path: join(OUT, f) }); log(`  📷 ${f}  url=${page.url().replace(SITE,'')}`) }
const settle = async (ms=700) => { await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(ms) }
const text = async () => (await page.locator('body').innerText()).replace(/\s+/g,' ')

try {
  log('STEP 1 หน้า LINE ในโหมดเดโม')
  await page.goto(SITE + '?scenario=default#/app/settings/line', { waitUntil: 'domcontentloaded' }); await settle()
  await shot('line-demo')
  log('   เห็นบทสาธิต: ' + (await text()).includes('ตัวอย่างการเชื่อม LINE OA'))
  log('   มีเลข 6 หลักโชว์: ' + /\b\d{6}\b/.test(await text()))

  log('STEP 2 เมนู → เริ่มใช้จริง')
  await page.locator('.shell__menu').click(); await settle(400)
  await shot('menu')
  await page.getByRole('button', { name: 'เริ่มใช้จริง' }).first().click(); await settle(400)
  await shot('confirm-start-real')
  const confirmBtns = page.getByRole('button', { name: 'เริ่มใช้จริง' })
  await confirmBtns.last().click(); await settle()
  await shot('after-start-real')
  log('   ไปที่: ' + page.url().replace(SITE,''))

  log('STEP 3 onboarding ขั้น 1')
  const inputs = page.locator('input.inp')
  log('   จำนวนช่องกรอก: ' + await inputs.count())
  const labels = await page.locator('.fld__l').allInnerTexts()
  log('   ป้ายช่อง: ' + labels.join(' | '))
  // กรอกชื่อครู + พร้อมเพย์
  for (let i = 0; i < await inputs.count(); i++) {
    const lbl = labels[i] || ''
    if (/ชื่อ/.test(lbl)) await inputs.nth(i).fill('ครูทดสอบ')
    else if (/พร้อมเพย์|PromptPay/i.test(lbl)) await inputs.nth(i).fill('0812345678')
  }
  await shot('onboarding-1-filled')
  await page.getByRole('button', { name: /ถัดไป|ต่อไป|ไปต่อ/ }).first().click().catch(async () => { log('   ⚠ ไม่เจอปุ่มถัดไป — ปุ่มที่มี: ' + (await page.getByRole('button').allInnerTexts()).join(' | ')) })
  await settle()
  await shot('onboarding-2')
  log('   ขั้น 2 ปุ่มที่มี: ' + (await page.getByRole('button').allInnerTexts()).join(' | '))

  log('STEP 4 พยายามจบ onboarding โดยยังไม่มีนักเรียน')
  const finish = page.getByRole('button', { name: /เริ่มใช้งาน|เสร็จ|บันทึก/ }).first()
  log('   ปุ่มจบ: ' + (await finish.count() ? await finish.innerText() + ' disabled=' + await finish.isDisabled() : 'ไม่มี'))
  const skip = page.getByRole('button', { name: /ข้าม/ }).first()
  if (await skip.count()) { log('   มีปุ่มข้าม → กด'); await skip.click(); await settle(); await shot('after-skip') }

  log('STEP 5 ไปหน้า LINE ในโหมดจริง (ยังไม่ล็อกอิน)')
  await page.goto(SITE + '#/app/settings/line', { waitUntil: 'domcontentloaded' }); await settle()
  await shot('line-real-signed-out')
  const t5 = await text()
  log('   ขึ้นฟอร์มล็อกอิน: ' + (await page.locator('input[type="email"], input[type="password"]').count() > 0))
  log('   ยังเห็นบทสาธิตอยู่ไหม (ต้องไม่): ' + t5.includes('ตัวอย่างการเชื่อม LINE OA'))
  log('   ถูกเด้งไป onboarding ไหม: ' + page.url().includes('onboarding'))

  log('STEP 6 เมนูในโหมดจริงมีทางไป LINE ไหม')
  await page.locator('.shell__menu').click(); await settle(400)
  await shot('menu-real')
  log('   เมนู: ' + (await page.getByRole('button').allInnerTexts()).filter(Boolean).join(' | '))
} catch (e) { log('💥 ' + String(e).slice(0, 300)); await shot('error') }
await browser.close()
log('ภาพที่ ' + OUT)
