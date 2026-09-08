import { chromium } from '@playwright/test'
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { qrMatrix, qrPath } from '../src/core/qr.ts'

// Keep the original deck untouched. Render replacement pages, then merge with Poppler.
const input = process.env.SOLO_PITCH_SOURCE
if (!input) throw new Error('Set SOLO_PITCH_SOURCE to the original FinalPitch PDF')
const destination = resolve(process.env.SOLO_PITCH_DIR ?? '.omx/pitch-kit')
await mkdir(resolve('.omx'), { recursive: true })
const work = await mkdtemp(resolve('.omx/pitch-pages-'))
await mkdir(destination, { recursive: true })
const pageCount = file => {
  const result = spawnSync('pdfinfo', [file], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error('Cannot read source PDF metadata')
  return Number(result.stdout.match(/^Pages:\s+(\d+)$/m)?.[1])
}
if (pageCount(resolve(input)) !== 22) throw new Error('Expected the reviewed 22-page FinalPitch source')
const evidencePath = process.env.SOLO_TRACTION_EVIDENCE
if (!evidencePath) throw new Error('Set SOLO_TRACTION_EVIDENCE to the reviewed read-only aggregate JSON')
const traction = JSON.parse(await readFile(evidencePath, 'utf8'))
if (!Number.isFinite(Date.parse(traction.captured_at)) || typeof traction.source !== 'string') throw new Error('Invalid traction provenance')
for (const key of ['verified_payments','verified_net_baht','line_messages_accepted']) {
  if (!Number.isSafeInteger(traction.counts?.[key]) || traction.counts[key] < 0) throw new Error(`Invalid traction count: ${key}`)
}
const paidCount = traction.counts.verified_payments
const net = traction.counts.verified_net_baht.toLocaleString('en-US')
const lineCount = traction.counts.line_messages_accepted
const capturedDate = new Date(traction.captured_at).toLocaleDateString('th-TH', {timeZone:'Asia/Bangkok',year:'numeric',month:'long',day:'numeric'})
const font = (await readFile(new URL('../public/fonts/Anuphan.ttf', import.meta.url))).toString('base64')
const source = 'https://media.settrade.com/settrade/Documents/2025/Feb/20250227-K-Research-School-update.pdf'
const oa = 'https://line.me/R/ti/p/@458gfbxa'
const matrix = qrMatrix(oa)
if (!matrix) throw new Error('QR generation failed')
const qr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 ${matrix.length + 8} ${matrix.length + 8}" shape-rendering="crispEdges" style="background:white;border-radius:12px;padding:15px;width:230px;height:230px"><path d="${qrPath(matrix)}" fill="#111"/></svg>`
await writeFile(join(destination, 'solo-line-oa-qr.svg'), qr)
const card = (n, title, detail = '') => `<div class="card"><strong>${n}</strong><h3>${title}</h3><p>${detail}</p></div>`
const pages = new Map([
  [1, ['Solo Tutor', 'ระบบออกบิลและจัดการเงิน<br>ให้ครูที่สอนคนเดียว', '<p class="lead">บันทึกคาบ → ออกบิล → ครูตรวจแล้วกดส่ง LINE<br>ครูตรวจสลิปแล้วบันทึกรับเงิน</p>', 'Team10_Startup_Sleepless · KU Startup 101 · 13 กันยายน 2569']],
  [9, ['ทำงานอย่างไร', 'ครูควบคุมการส่งและการรับเงินทุกครั้ง', `<div class="grid five">${card('1','บันทึกคาบ','เช็คชื่อหลังสอนเสร็จ')}${card('2','ออกบิล','คำนวณตามราคาและคาบ')}${card('3','ส่ง LINE','ครูตรวจข้อความแล้วกดส่ง')}${card('4','ตรวจยอด','ครูเทียบสลิปและรายการเงินเข้า')}${card('5','ใบเสร็จ','เกิดหลังครูบันทึกรับเงิน')}</div>`, 'LINE OA ต้องเพิ่มเพื่อนและจับคู่ก่อน · การตอบรับจาก LINE ไม่ได้ยืนยันว่าผู้ปกครองอ่านแล้ว']],
  [10, ['Demo', '90 วินาที · ครูพลอย นักเรียน 5 คน', '<p class="lead">เพิ่มนักเรียน → บันทึกคาบ → ออกบิล<br>จำลองส่ง LINE → บันทึกรับเงิน → ใบเสร็จ</p><div class="callout">ข้อมูลสมมติสำหรับสาธิต<br>เตรียมวิดีโอในเครื่องไว้ใช้เมื่ออินเทอร์เน็ตขัดข้อง</div>', 'ไม่ได้ใช้ข้อมูลหรือบัญชีครูจริง และไม่ส่งข้อความหาผู้ปกครองระหว่างบันทึกวิดีโอ']],
  [12, ['ขนาดตลาด', 'แยกตลาดอ้างอิงออกจากกลุ่มที่เราเข้าถึง', `<div class="grid three">${card('3.3 พันล้าน','ตลาดโรงเรียนกวดวิชาไทย','ประมาณการปี 2568 จาก KResearch<br>เป็นบริบท ไม่ใช่ TAM ของ Solo Tutor')}${card('27 / 50','กลุ่มเป้าหมายในแบบสอบถาม','54% มีนักเรียนตั้งแต่ 11 คน<br>ยังไม่ใช่ตัวแทนติวเตอร์ทั้งประเทศ')}${card('67,230','บาทต่อปี · กรณีสมมติ','27 คน × แพ็กปี 2,490 บาท<br>สมมติทุกคนซื้อ ไม่ใช่ยอดขายจริง')}</div><p>เป้าทดลองสัปดาห์นี้: ครู 3 คน · ต้องวัด conversion จากการติดต่อและจ่ายจริงก่อนประมาณ SOM</p>`, `<a href="${source}">KResearch, 27 ก.พ. 2568 หน้า 4</a> · แบบสอบถาม 50 คนจากสไลด์ทีมเดิม · ยังไม่มีฐานนับ TAM/SAM ระดับประเทศที่ตรวจซ้ำได้`]],
  [16, ['หลักฐาน ณ 8 กันยายน 2569', 'แยกความสนใจออกจากการจ่ายเงินจริง', `<div class="grid four">${card('0','รายการรับเงินที่ยืนยันในระบบ','ไม่รวม Demo และคำขอ Pro')}${card('0 บาท','เงินรับสุทธิที่ยืนยันในระบบ','หลังหักคืน · ไม่ใช่กำไร')}${card('0','ข้อความที่ LINE OA รับแล้ว','ตาม outbox ของระบบ ณ เวลาตรวจ')}${card('3 คน','เป้าครูทดลองสัปดาห์นี้','เป็นเป้าหมาย ยังไม่ใช่ผู้ใช้ที่ยืนยันแล้ว')}</div><blockquote>“ถ้าเราส่งทวงเงินเอง กลัวผู้ปกครองไม่พอใจ”<small>อุ๋มอิ๋ม · สัมภาษณ์เดิมของทีม ไม่ใช่คำรับรองจากผู้ใช้แอป</small></blockquote>`, 'ที่มา: อ่าน aggregate จาก Supabase 8 ก.ย. 2569 · รายชื่อในเครื่องและยอดรับนอกระบบต้องให้ Now/Ing ตรวจหลักฐานเพิ่มก่อนอัปเดตวันพิทช์']],
  [17, ['หลัง feedback', 'สิ่งที่แก้แล้ว และสิ่งที่ต้องพิสูจน์กับครู', `<table><tr><th>คำถามเดิม</th><th>สิ่งที่ทำ / หลักฐานปัจจุบัน</th></tr><tr><td>โฟกัสและมีคนจ่ายหรือยัง</td><td>โฟกัส Solo Tutor · ระบบยังยืนยันเงินรับ 0 รายการ</td></tr><tr><td>มีครูใช้จริงกี่คน</td><td>ตั้งเป้า Now พาเข้าใช้ 3 คน · ไม่นับบัญชีทีมเป็นลูกค้า</td></tr><tr><td>ออกบิลเป็น pain หลัก</td><td>แกนเดโม: บันทึกคาบ → บิล → LINE → รับเงิน</td></tr><tr><td>TAM / SAM / SOM</td><td>แสดงฐาน 50 คนและสมมติฐานแยกกัน · ยังไม่เคลมตลาดทั้งประเทศ</td></tr><tr><td>ยอมจ่ายจริงไหม</td><td>ใช้ PromptPay ของทีม ตรวจยอดธนาคาร พร้อมหลักฐานก่อนอ้างยอด</td></tr></table>`, 'ยังไม่อ้างจำนวนผู้วางมัดจำหรือผลแบบสอบถามรอบ 2 ที่ไม่มีหลักฐานส่งมา']],
  [18, ['หลังพิทช์', 'ขยายจากหลักฐานการใช้และจ่ายจริง', `<div class="grid three">${card('เดือน 1','ครูจ่ายจริง 10 คนแรก','ปรับจากบั๊กหน้างาน · ยืนยันข้อมูลธุรกิจและ PDPA · SMTP และ recovery · ประเมิน gateway เมื่อจำเป็น')}${card('เดือน 2','แก้ปัญหาที่ครูขอบ่อย','ดูต้นทุนซัพพอร์ตและงานตรวจยอด · เลือกฟีเจอร์จากการใช้จริง')}${card('เดือน 3','วัดการอยู่ต่อ','month-2 retention · CAC · ต้นทุนต่อครู<br>ยังไม่ขยายอาชีพก่อนพิสูจน์กลุ่มแรก')}</div>`, 'สัปดาห์นี้: PromptPay ของทีม + LINE OA + Supabase Free · พัก Omise และงาน production ใหม่ตามลำดับความสำคัญ']],
  [19, ['ทีม', 'ห้าคน แบ่งหน้าที่ให้ถึงครูจริง', `<div class="grid five">${card('M','Mudmee','Head of Pitching<br>บทพูดและการซ้อม')}${card('N','Now','Customer<br>พาครูเข้าระบบและเก็บ feedback')}${card('T','Tae','Dev<br>เว็บและเดโมบนเวที')}${card('I','Ing','Finance & Business<br>บัญชีรับเงินและตรวจหลักฐาน')}${card('P','Punch','Research & Stat<br>ตลาดและแหล่งตัวเลข')}</div>`, 'Team10_Startup_Sleepless · ใช้อักษรย่อของสมาชิกจากสไลด์เดิม; ยังไม่ได้รับไฟล์รูปทีมที่อนุญาตให้ใช้']],
  [20, ['กลับไปที่ครูพลอย', 'เวลาที่ควรได้คืน<br>คือเวลาของครู', `<div class="closing"><div><p class="lead">ถ้ารู้จักติวเตอร์ที่มีนักเรียน 11 คนขึ้นไป<br>แนะนำให้เรารู้จัก 1 คน</p><p>ทีมจะนัดตั้งค่าและดูครูทำยอดด้วยตัวเอง</p><a href="${oa}">เพิ่มเพื่อน Solo Tutor · @458gfbxa</a><p>หรือทดลอง: tasachii.github.io/solo-tutor/</p></div>${qr}</div>`, 'QR เปิดบัญชี LINE OA ของ Solo Tutor · ไม่มี QR รับเงินสมมติ']],
  [21, ['สไลด์สำรอง · Unfair advantage', 'มีหลักฐานอะไร และยังขาดอะไร', `<table><tr><th>ด้าน</th><th>สถานะที่อ้างได้</th></tr><tr><td>ข้อมูลที่ทีมเก็บเอง</td><td>แบบสอบถาม 50 คน + สัมภาษณ์ 8 คน ตามเอกสารทีม</td></tr><tr><td>ลูกค้าที่จ่ายจริง</td><td>ระบบยังยืนยันเงินรับ 0 รายการ · ต้องตรวจจากธนาคาร</td></tr><tr><td>ชุมชน</td><td>มี LINE OA Solo Tutor · ยังไม่อ้างขนาดชุมชน</td></tr><tr><td>ต้นทุนการย้าย / network effects</td><td>เป็นสมมติฐานที่จะทดสอบ ยังไม่เรียกว่า moat ที่พิสูจน์แล้ว</td></tr></table>`, 'ความเร็วในการแก้บั๊กช่วยรักษาครูกลุ่มแรก แต่จำนวนฟีเจอร์ไม่ใช่หลักฐาน willingness to pay']],
  [22, ['สไลด์สำรอง · แหล่งข้อมูล', 'แยกผลสำรวจ ระบบจริง และสมมติฐาน', `<table><tr><th>ตัวเลข</th><th>แหล่งและขอบเขต</th></tr><tr><td>50 คน / สัมภาษณ์ 8 คน / 27 คน</td><td>เอกสาร FinalPitch-v3 ของทีม · ต้องเก็บข้อมูลต้นทางรองรับ</td></tr><tr><td>3.3 พันล้านบาท / โต 9.2%</td><td><a href="${source}">KResearch, Industry Analysis No.20, 27 ก.พ. 2568 หน้า 4</a></td></tr><tr><td>0 เงินรับ / 0 ข้อความ LINE</td><td>aggregate จาก Supabase ณ 8 ก.ย. 2569 · ไม่รวมกิจกรรมนอกระบบ</td></tr><tr><td>67,230 บาท / ครู 3 คน</td><td>แบบจำลอง 27 × 2,490 และเป้าทดลอง · ไม่ใช่รายได้หรือ SOM ที่เกิดแล้ว</td></tr><tr><td>299 / 799 / 2,490 บาท</td><td>ราคาปัจจุบันในแอป · ฟรีสูงสุด 5 นักเรียน</td></tr></table>`, 'ตัวเลขในวิดีโอเป็น Demo ทั้งหมด · อัปเดตตัวเลข traction อีกครั้งหลัง Now/Ing ตรวจหลักฐานจริง']],
])
const css = `@font-face{font-family:Anuphan;src:url(data:font/ttf;base64,${font})}*{box-sizing:border-box}html,body{margin:0}body{font-family:Anuphan,sans-serif;background:#24203d;color:#fff}section{width:1280px;height:720px;padding:34px 70px 60px;position:relative;page-break-after:always}a{color:#ffb32b}header{font-size:22px;font-weight:600;margin-bottom:24px}header span{color:#ffb32b}.kicker{color:#ffb32b;font-size:17px;margin:0 0 12px}h1{font-size:37px;line-height:1.3;margin:0 0 28px;font-weight:600}.lead{font-size:29px;line-height:1.6}p{font-size:19px;line-height:1.55}.grid{display:grid;gap:18px;margin:25px 0}.three{grid-template-columns:repeat(3,1fr)}.four{grid-template-columns:repeat(4,1fr)}.five{grid-template-columns:repeat(5,1fr)}.card{background:#322b51;border-radius:18px;padding:22px 20px;min-height:235px}.card strong{display:block;font-size:38px;color:#ffb32b}.card h3{font-size:22px;margin:12px 0}.card p{font-size:17px;color:#c2bdd5}.five .card{padding:20px 16px}.five .card h3{font-size:19px}.five .card strong{font-size:36px}footer{position:absolute;bottom:25px;left:70px;right:70px;display:flex;gap:15px;justify-content:space-between;font-size:12px;color:#b2acc5}footer div{max-width:1060px}blockquote{margin:24px 0;font-size:24px;color:#fff}blockquote small{display:block;font-size:15px;color:#c2bdd5;margin-top:9px}table{border-collapse:collapse;width:100%;font-size:19px}td,th{text-align:left;padding:17px 20px;border-bottom:1px solid #49415f}th{color:#ffb32b}td:first-child{width:33%}.callout{padding:20px 25px;background:#322b51;border-left:5px solid #ffb32b;font-size:23px}.closing{display:flex;align-items:center;justify-content:space-between;gap:40px}.closing .lead{font-size:25px}`
// Replace only the known static draft assertions with the reviewed snapshot values.
const renderEvidence = text => text.replaceAll('8 กันยายน 2569', capturedDate)
  .replaceAll('0 รายการ', `${paidCount} รายการ`).replaceAll('0 เงินรับ / 0 ข้อความ LINE', `${paidCount} เงินรับ / ${lineCount} ข้อความ LINE`)
  .replace('<strong>0</strong><h3>รายการรับเงิน', `<strong>${paidCount}</strong><h3>รายการรับเงิน`)
  .replace('<strong>0 บาท</strong><h3>เงินรับ', `<strong>${net} บาท</strong><h3>เงินรับ`)
  .replace('<strong>0</strong><h3>ข้อความที่ LINE', `<strong>${lineCount}</strong><h3>ข้อความที่ LINE`)
const content = (number, [kicker, title, body, footer]) => renderEvidence(`<section><header>Solo<span>●</span></header><p class="kicker">${kicker}</p><h1>${title}</h1>${body}<footer><div>${footer}</div><span>${number}</span></footer></section>`)
const browser = await chromium.launch()
const evidence = []
try {
  for (const [number, slide] of pages) {
    const html = `<!doctype html><html lang="th"><meta charset="utf-8"><style>${css}</style>${content(number,slide)}</html>`
    await writeFile(join(work, `updated-${number}.html`), html)
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    await page.setContent(html); await page.evaluate(() => document.fonts.ready)
    const overflow = await page.evaluate(() => {
      const footer = document.querySelector('footer').getBoundingClientRect()
      return [...document.querySelectorAll('section > :not(footer)')].some(el => el.getBoundingClientRect().bottom > footer.top - 5)
        || document.documentElement.scrollWidth > 1280 || document.documentElement.scrollHeight > 720
    })
    if (overflow) throw new Error(`Slide ${number} overflows`)
    await page.pdf({ path: join(work, `updated-${number}.pdf`), width: '1280px', height: '720px', printBackground: true })
    await page.screenshot({ path: join(work, `updated-${number}.png`) })
    evidence.push({ page: number, overflow: false })
    await page.close()
  }
} finally { await browser.close() }
const split = spawnSync('pdfseparate', [resolve(input), join(work, 'original-%d.pdf')], { encoding: 'utf8' })
if (split.status !== 0) throw new Error(split.stderr)
const originals = Array.from({ length: 22 }, (_, i) => join(work, `${pages.has(i+1) ? 'updated' : 'original'}-${i+1}.pdf`))
const output = join(destination, 'Solo-FinalPitch-v4-review.pdf')
const merge = spawnSync('pdfunite', [...originals, output], { encoding: 'utf8' })
if (merge.status !== 0) throw new Error(merge.stderr)
if (pageCount(output) !== 22) throw new Error('Merged PDF page count differs')
const text = spawnSync('pdftotext', [output, '-'], { encoding: 'utf8' })
if (text.status !== 0 || text.stdout.includes('[')) throw new Error('Remaining placeholder bracket or unreadable PDF')
await writeFile(join(destination, 'slides-verification.json'), JSON.stringify({ source: resolve(input), pages: 22,
  placeholders: 0, editedPages: evidence, realTeamPhotosProvided: false,
  traction: { captured_at: traction.captured_at, source: 'Reviewed Supabase read-only aggregate; excludes offline and unrecorded transactions',
    counts: { verified_payments: paidCount, verified_net_baht: traction.counts.verified_net_baht, line_messages_accepted: lineCount } },
  workDirectory:work }, null, 2))
console.log('Created 22-page review PDF. No bracket placeholders; unknown evidence is explicitly identified, never fabricated.')
