/**
 * เดินทั้งแอปแบบผู้ใช้จริงบนเครื่องมือถือจำลอง แล้วรายงานสิ่งที่ติดขัด
 *
 * ต่างจาก e2e: ชุดนี้ไม่ได้ยืนยันพฤติกรรมรายข้อ แต่ "ใช้งานจริง" ทีละหน้าจอ
 * เก็บ error ของคอนโซล, ปุ่มที่ไม่มีชื่อให้กดด้วยเสียง, ปุ่มที่กดแล้วเงียบ และภาพหน้าจอไว้ตรวจด้วยตา
 *
 * ใช้: node scripts/qa-walk.mjs [baseURL]   (ค่าเริ่มต้น http://localhost:4173/solo-tutor/)
 */
import { chromium, devices } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const base = process.argv[2] ?? 'http://localhost:4173/solo-tutor/'
const outDir = process.argv[3] ?? 'qa-walk'
const problems = []
const shots = []

const note = (where, what) => problems.push(`${where}: ${what}`)

async function shot(page, name) {
  await mkdir(outDir, { recursive: true })
  const file = `${outDir}/${name}.png`
  await page.screenshot({ path: file, fullPage: true })
  shots.push(file)
}

/** ปุ่มทุกปุ่มที่มองเห็นต้องมีชื่อที่อ่านออก ไม่งั้นคนใช้ screen reader และเราเองก็ไม่รู้ว่ามันคืออะไร */
async function auditButtons(page, where) {
  const rows = await page.$$eval('button, a[href]', (els) => els
    .filter((el) => el.offsetParent !== null)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      name: (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim(),
      disabled: el.hasAttribute('disabled'),
      w: el.getBoundingClientRect().width,
      h: el.getBoundingClientRect().height,
    })))
  for (const row of rows) {
    if (!row.name) note(where, `ปุ่มไม่มีชื่อ (${row.tag} ${Math.round(row.w)}×${Math.round(row.h)})`)
    // ต่ำกว่า 40px กดพลาดง่ายบนมือถือ
    if (row.h > 0 && row.h < 40 && row.tag === 'button') note(where, `ปุ่ม "${row.name}" สูงแค่ ${Math.round(row.h)}px`)
  }
  return rows.length
}

/** เนื้อหาต้องไม่ล้นออกนอกจอแนวนอน */
async function auditOverflow(page, where) {
  const overflow = await page.evaluate(() => {
    const w = document.documentElement.clientWidth
    return [...document.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().right > w + 1 && el.offsetParent !== null)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`)
  })
  if (overflow.length) note(where, `ล้นขอบจอ: ${overflow.join(', ')}`)
}

const run = async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext({ ...devices['iPhone 13'] })
  const page = await context.newPage()
  page.on('console', (m) => { if (m.type() === 'error') note('console', m.text().slice(0, 200)) })
  page.on('pageerror', (e) => note('pageerror', String(e).slice(0, 200)))

  // 1 หน้าแรกสาธารณะ → เข้าเดโม
  await page.goto(base)
  await page.waitForSelector('.land__h1')
  await auditButtons(page, 'หน้าแรก')
  await auditOverflow(page, 'หน้าแรก')
  await shot(page, '01-landing')

  await page.goto(`${base}?scenario=default#/app/today`)
  await page.waitForSelector('.cal__grid')
  await page.waitForSelector('.skel', { state: 'detached' }).catch(() => {})

  // 2 ปฏิทิน: ย่อเหลือสัปดาห์เดียว กางเป็นเดือน เลือกวันอื่น เลื่อนเดือน
  const weekCount = await page.locator('.cal__day').count()
  if (weekCount !== 7) note('ปฏิทิน', `ย่ออยู่ควรเห็น 7 วัน แต่เห็น ${weekCount}`)
  // งานของวันนี้ต้องอยู่ในจอแรกโดยไม่ต้องเลื่อน ไม่งั้นปฏิทินแย่งที่ของสิ่งที่ครูเปิดแอปมาดู
  const firstRow = await page.locator('.urow').first().boundingBox()
  if (firstRow && firstRow.y > 844) note('วันนี้', `รายการแรกอยู่ที่ ${Math.round(firstRow.y)}px ต้องเลื่อนจอถึงจะเห็น`)
  await auditButtons(page, 'วันนี้')
  await auditOverflow(page, 'วันนี้')
  await shot(page, '02-today-calendar')

  await page.getByRole('button', { name: 'ดูทั้งเดือน' }).click()
  const dayCount = await page.locator('.cal__day').count()
  if (dayCount < 28) note('ปฏิทิน', `กางแล้วช่องวันมีแค่ ${dayCount}`)
  const marked = page.locator('.cal__day', { has: page.locator('.cal__dot') })
  if (await marked.count() === 0) note('ปฏิทิน', 'ไม่มีวันไหนแสดงจำนวนคาบเลย')
  await auditOverflow(page, 'วันนี้/กางปฏิทิน')
  await page.getByRole('button', { name: /ดูวันที่/ }).last().click()
  await shot(page, '03-today-other-day')
  if (await page.getByRole('button', { name: 'กลับมาวันนี้' }).count() === 0) {
    note('ปฏิทิน', 'เลือกวันอื่นแล้วไม่มีทางกลับมาวันนี้')
  }
  await page.getByRole('button', { name: 'กลับมาวันนี้' }).click()

  await page.getByRole('button', { name: 'เดือนถัดไป' }).click()
  await shot(page, '04-next-month')
  await page.getByRole('button', { name: 'เดือนก่อนหน้า' }).click()
  await page.getByRole('button', { name: 'ย่อปฏิทิน' }).click()
  if (await page.locator('.cal__day').count() !== 7) note('ปฏิทิน', 'กดย่อแล้วไม่กลับมาเป็นสัปดาห์เดียว')

  // 3 จองล่วงหน้าเป็นชุด
  await page.getByRole('button', { name: /^\+ (เพิ่มวันนี้|จองล่วงหน้า)$/ }).first().click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('combobox').selectOption({ index: 1 })
  await sheet.getByRole('button', { name: 'จองซ้ำทุกสัปดาห์' }).click()
  await shot(page, '05-book-series')
  const saveLabel = await sheet.locator('.sheet__foot button').first().innerText().catch(() => '')
  if (!/จอง \d+ คาบ|บันทึก/.test(saveLabel)) note('จองล่วงหน้า', `ปุ่มบันทึกอ่านว่า "${saveLabel}"`)
  await sheet.locator('.sheet__foot button').first().click()
  await page.waitForTimeout(400)
  const booked = await page.locator('.toast').innerText().catch(() => '')
  if (!/จองให้แล้ว/.test(booked)) note('จองล่วงหน้า', `ไม่เห็นข้อความยืนยัน (${booked || 'ไม่มี toast'})`)
  await shot(page, '06-after-booking')

  // 4 เช็คชื่อ แล้วดูว่าตัวนับคอร์สขยับ
  await page.goto(`${base}?scenario=default&x=1#/app/today`)
  await page.waitForSelector('.urow')
  const before = await page.locator('.urow .pk').allInnerTexts()
  const checkin = page.getByRole('button', { name: 'เช็คชื่อ' }).first()
  if (await checkin.count()) {
    await checkin.click()
    await page.waitForTimeout(400)
    const after = await page.locator('.urow .pk').allInnerTexts()
    if (JSON.stringify(before) === JSON.stringify(after)) note('เช็คชื่อ', 'ตัวเลขความคืบหน้าไม่ขยับหลังเช็คชื่อ')
    await shot(page, '07-after-checkin')
  } else note('เช็คชื่อ', 'ไม่มีปุ่มเช็คชื่อบนหน้าวันนี้')

  // 5 รายชื่อ + หน้านักเรียน
  await page.goto(`${base}#/app/subjects`)
  await page.waitForSelector('.srow')
  await auditButtons(page, 'รายชื่อ')
  await auditOverflow(page, 'รายชื่อ')
  await shot(page, '08-subjects')
  await page.locator('.srow').first().click()
  await page.waitForSelector('.h1')
  await auditButtons(page, 'หน้านักเรียน')
  await auditOverflow(page, 'หน้านักเรียน')
  await shot(page, '09-subject-detail')

  // 6 บิล
  await page.goto(`${base}#/app/billing`)
  await page.waitForSelector('.stat')
  await auditButtons(page, 'บิล')
  await auditOverflow(page, 'บิล')
  await shot(page, '10-billing')

  // 7 แอดมินทุกแท็บ
  for (const [tab, name] of [['drafts', 'รอส่ง'], ['collect', 'ค้างจ่าย'], ['homework', 'การบ้าน'], ['chat', 'แชท']]) {
    await page.goto(`${base}#/app/admin?tab=${tab}`)
    await page.waitForSelector('.chips')
    await page.waitForTimeout(250)
    const sends = await page.getByRole('button', { name: 'ส่งใน LINE' }).count()
    const cards = await page.locator('.msg').count()
    if (cards > 0 && sends > cards) note(`แอดมิน/${name}`, `ปุ่มส่งใน LINE ${sends} ปุ่ม จากการ์ด ${cards} ใบ`)
    await auditButtons(page, `แอดมิน/${name}`)
    await auditOverflow(page, `แอดมิน/${name}`)
    await shot(page, `11-admin-${tab}`)
  }

  // 8 เมนู: ค่าเริ่มต้นจำนวนครั้งต่อคอร์ส
  await page.goto(`${base}#/app/today`)
  await page.getByRole('button', { name: 'เมนู' }).click()
  await shot(page, '12-menu')
  const courseRow = page.getByRole('button', { name: /จำนวนครั้งต่อคอร์ส/ })
  if (await courseRow.count() === 0) note('เมนู', 'ไม่มีที่ตั้งค่าจำนวนครั้งต่อคอร์ส')
  else {
    await courseRow.click()
    await shot(page, '13-course-default')
    await page.getByRole('dialog').getByRole('button', { name: 'บันทึก' }).click()
    await page.waitForTimeout(300)
  }

  // 9 หน้าตั้งค่า LINE OA
  await page.goto(`${base}#/app/settings/line`)
  await page.waitForTimeout(500)
  await auditButtons(page, 'ตั้งค่า LINE OA')
  await auditOverflow(page, 'ตั้งค่า LINE OA')
  await shot(page, '14-line-settings')

  await browser.close()

  console.log(`ภาพหน้าจอ ${shots.length} รูปใน ${outDir}/`)
  if (!problems.length) console.log('ไม่พบปัญหาจากการเดินทั้งแอป')
  else {
    console.log(`พบ ${problems.length} รายการ:`)
    for (const row of [...new Set(problems)]) console.log(' - ' + row)
  }
  process.exit(0)
}

run().catch((error) => { console.error(error); process.exit(1) })
