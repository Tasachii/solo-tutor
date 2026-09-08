/**
 * ตรวจแอปบนขนาดหน้าจอมือถือ กับ **เว็บที่ deploy จริง** ไม่ใช่ build ในเครื่อง
 * และเก็บภาพหน้าจอ 6 หน้าไว้ใช้ทำเอกสาร (Assignment 03)
 *
 * ไม่ได้อยู่ในชุด CI โดยตั้งใจ เพราะยิงอินเทอร์เน็ตออกไปหาเว็บจริง
 *   node scripts/mobile-check.mjs
 *
 * **แทนการทดสอบบนเครื่องจริงไม่ได้** สิ่งที่เครื่องมือนี้ตรวจไม่ได้เลย:
 * ปุ่มโดนคีย์บอร์ดจริงบัง, ท่าทาง Add to Home Screen บน iOS, ฟอนต์ไทยบนเครื่องจริง,
 * ความเร็วเน็ตมือถือ และการหมุนจอ — สี่ข้อนี้ต้องมีคนถือเครื่องจริง
 */
import { chromium, devices } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SITE = 'https://tasachii.github.io/solo-tutor/'
const OUT = join(homedir(), 'Downloads', 'solo-screens-20260909')
mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, note = '') => { results.push({ name, ok, note }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ' — ' + note : ''}`) }

const browser = await chromium.launch()
const context = await browser.newContext({ ...devices['iPhone 13'], locale: 'th-TH', timezoneId: 'Asia/Bangkok' })
const page = await context.newPage()
const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(500) }
const shot = async (file) => { await page.screenshot({ path: join(OUT, file), fullPage: false }); console.log('  ภาพ:', file) }

// ไม่มีแถบเลื่อนแนวนอน = เนื้อหาไม่ล้นจอมือถือ
const noSideScroll = async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

// 1 หน้าแรก
await page.goto(SITE, { waitUntil: 'domcontentloaded' }); await settle()
await shot('1-หน้าแรก.png')
check('หน้าแรกไม่ล้นจอแนวนอน', await noSideScroll())

// PWA — Add to Home Screen ต้องมี manifest ที่ใช้ได้จริง
const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href')
let manifest = null
if (manifestHref) {
  const url = new URL(manifestHref, page.url()).href
  manifest = await page.evaluate(async (u) => { try { const r = await fetch(u); return r.ok ? await r.json() : null } catch { return null } }, url)
}
check('มี manifest สำหรับ Add to Home Screen', !!manifest, manifest ? `name="${manifest.name || manifest.short_name}" display=${manifest.display} icons=${(manifest.icons || []).length}` : 'ไม่พบ')
check('manifest เปิดแบบเต็มจอ (standalone)', !!manifest && ['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display), manifest?.display || '')
check('manifest มีไอคอนอย่างน้อย 1 ขนาด', !!manifest && (manifest.icons || []).length > 0)
const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker?.getRegistration(); return !!r })
check('มี service worker (ใช้ออฟไลน์ได้)', sw)

// 2 หน้าเลือกวิธีเก็บเงิน = ประตูเข้าเดโม
await page.goto(SITE + '#/start', { waitUntil: 'domcontentloaded' }); await settle()
await shot('2-เลือกวิธีเก็บเงิน.png')

// เข้าเดโม
await page.goto(SITE + '?scenario=default#/app/today', { waitUntil: 'domcontentloaded' }); await settle()
await page.waitForSelector('.urow', { timeout: 15000 })

// 3 วันนี้
await shot('3-วันนี้-เช็คชื่อ.png')
const rows = await page.locator('.urow').count()
check('หน้าวันนี้มีคาบให้เช็คชื่อ', rows > 0, `${rows} คาบ`)
check('หน้าวันนี้ไม่ล้นจอแนวนอน', await noSideScroll())

// เดโมลูป: เช็คชื่อหนึ่งคาบ
const before = await page.locator('.urow--done').count()
// ปุ่มเช็คชื่อคือ .btn--tap — ปุ่มแรกใน .urow คือ "เลื่อน" ซึ่งเปิดชีทเลื่อนคาบ ไม่ใช่การเช็คชื่อ
await page.locator('.urow:not(.urow--done) .btn--tap').first().click()
await page.waitForTimeout(1000)
const after = await page.locator('.urow--done').count()
check('เช็คชื่อแล้วสถานะเปลี่ยนจริง', after > before, `${before} → ${after}`)

// 4 นักเรียน
await page.goto(SITE + '#/app/subjects', { waitUntil: 'domcontentloaded' }); await settle()
await shot('4-นักเรียน.png')
check('หน้านักเรียนไม่ล้นจอแนวนอน', await noSideScroll())

// 5 แอดมิน — ร่างข้อความ
await page.goto(SITE + '#/app/admin', { waitUntil: 'domcontentloaded' }); await settle()
await page.waitForSelector('.msg', { timeout: 15000 }).catch(() => {})
await shot('5-ร่างข้อความรอส่ง.png')
const msgs = await page.locator('.msg').count()
check('มีร่างข้อความรอครูตรวจ', msgs > 0, `${msgs} ใบ`)
check('หน้าแอดมินไม่ล้นจอแนวนอน', await noSideScroll())

// 6 หน้าที่ผู้ปกครองเห็น
await page.goto(SITE + '#/app/billing', { waitUntil: 'domcontentloaded' }); await settle()
await shot('6-คิดเงิน-ออกบิล.png')
check('หน้าคิดเงินไม่ล้นจอแนวนอน', await noSideScroll())

// ชื่อไทยยาว — ใส่ในช่องค้นหา/ชื่อ แล้วดูว่ายังไม่ล้น
await page.goto(SITE + '#/app/subjects', { waitUntil: 'domcontentloaded' }); await settle()
const longName = 'เด็กหญิงกัญญาภัทรวรรณ ศรีสุวรรณวงศ์ไพบูลย์กิจ'
const input = page.locator('input[type="search"], input.inp').first()
if (await input.count()) {
  await input.fill(longName); await page.waitForTimeout(500)
  check('ชื่อไทยยาวไม่ทำให้จอล้นแนวนอน', await noSideScroll(), `${longName.length} ตัวอักษร`)
  await shot('7-ชื่อไทยยาว.png')
} else {
  check('ชื่อไทยยาวไม่ทำให้จอล้นแนวนอน', false, 'ไม่พบช่องกรอกบนหน้านี้')
}

// สำรอง JSON — ปุ่มดาวน์โหลดต้องให้ไฟล์ที่อ่านกลับได้จริง
await page.goto(SITE + '?scenario=default#/app/today', { waitUntil: 'domcontentloaded' }); await settle()
let backupOk = false, backupNote = ''
try {
  // ปุ่มสำรองอยู่ในเมนู ⋯ ไม่ใช่หน้า /settings
  await page.locator('.shell__menu').click()
  await page.waitForTimeout(600)
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 12000 }),
    page.getByRole('button', { name: 'สำรองข้อมูล', exact: true }).first().click(),
  ])
  const path = await download.path()
  const text = await (await import('node:fs/promises')).readFile(path, 'utf8')
  const parsed = JSON.parse(text)
  backupOk = !!parsed && typeof parsed === 'object'
  backupNote = `${download.suggestedFilename()} · ${text.length} ไบต์`
} catch (error) { backupNote = String(error).slice(0, 90) }
check('สำรองข้อมูลเป็นไฟล์ JSON ที่อ่านกลับได้', backupOk, backupNote)

// ปิดเน็ตแล้วยังเปิดได้
await page.goto(SITE + '?scenario=default#/app/today', { waitUntil: 'domcontentloaded' }); await settle()
await context.setOffline(true)
let offlineOk = false, offlineNote = ''
try {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 })
  await page.waitForTimeout(1500)
  offlineOk = await page.locator('.urow, .stat, .appshell, main').first().isVisible()
  offlineNote = offlineOk ? 'โหลดหน้าเดิมได้จากแคช' : 'หน้าไม่ขึ้นเนื้อหา'
  if (offlineOk) await shot('8-ปิดเน็ตยังเปิดได้.png')
} catch (error) { offlineNote = String(error).slice(0, 90) }
check('ปิดเน็ตแล้วยังเปิดแอปได้', offlineOk, offlineNote)
await context.setOffline(false)

await browser.close()
const pass = results.filter((r) => r.ok).length
console.log(`\nสรุป: ผ่าน ${pass}/${results.length}`)
console.log(`ภาพหน้าจออยู่ที่ ${OUT}`)
