import { readFile, mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { copy } from '../src/copy/index.ts'

// Run with node --experimental-strip-types scripts/build-guide.mjs.
// Text comes from the shipped Help screen; no stale external guide or network.
const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])
const font = await readFile(new URL('../public/fonts/Anuphan.ttf', import.meta.url))
const sections = copy.help.sections.map((section) => `<section><h2>${escape(section.title)}</h2><ol>${section.steps.map((step) => `<li>${escape(step)}</li>`).join('')}</ol></section>`).join('')
const html = `<!doctype html><html lang="th"><meta charset="utf-8"><title>Solo Tutor — คู่มือใช้งาน</title>
<style>@font-face{font-family:Anuphan;src:url(data:font/ttf;base64,${font.toString('base64')}) format('truetype');font-weight:100 700}*{box-sizing:border-box}body{font-family:Anuphan,sans-serif;color:#172a29;font-size:12pt;line-height:1.7}h1{font-size:28pt;line-height:1.3}h2{font-size:17pt;color:#185e4d;margin-bottom:8pt}p{margin:10pt 0}section{break-inside:avoid;margin:18pt 0;padding:14pt 18pt;background:#f3f7f5;border-radius:10pt}li{margin:7pt 0}ol{padding-left:22pt}.date{font-size:10pt;color:#526461}</style>
<h1>Solo Tutor<br>คู่มือใช้งาน</h1><p class="date">ฉบับ 8 กันยายน 2569 · ใช้กับรุ่นที่มีเมนูช่วยเหลือ</p>
<p>${escape(copy.help.intro)}</p><p>เริ่มทดลองได้ด้วยโหมดเดโม ข้อมูลและผลตรวจสลิปในเดโมเป็นข้อมูลสมมติ ส่วนโหมดใช้งานจริงให้ครูตรวจยอดและยืนยันรับเงินเอง</p>
${sections}
<section><h2>ไฟล์กู้คืนกุญแจและข้อมูลต่างเครื่อง</h2><ol><li>หลังเข้าสู่ระบบและซิงก์สำเร็จ ให้ดาวน์โหลดไฟล์กู้คืนกุญแจจากหน้าบัญชีครู เก็บในที่ปลอดภัยแยกจากไฟล์สำรองสมุดบัญชี ผู้ที่ได้ไฟล์นี้อาจถอดรหัสสำเนาคลาวด์ของคุณได้</li><li>เมื่อคลาวด์ล็อก ให้ใช้รหัสผ่านเดิมหรือไฟล์กู้คืนกุญแจของบัญชีนั้น แอปจะตรวจว่าถอดข้อมูลได้ก่อนรับกุญแจ ห้ามลบคลาวด์เพื่อแก้ปัญหารหัสผ่านโดยยังไม่มีไฟล์สำรอง</li><li>หากเครื่องกับคลาวด์มีข้อมูลต่างกัน ให้ตรวจจำนวนรายชื่อและวันที่ก่อนเลือก ระบบจะเก็บสำรองข้อมูลเครื่องก่อนดึงคลาวด์ ขณะออฟไลน์งานจะรอซิงก์เมื่อออนไลน์</li><li>ไฟล์กู้คืนกุญแจไม่ใช่ไฟล์สำรองรายชื่อ และไม่ใช่รหัสผ่านสำหรับเข้าสู่บัญชี ควรเก็บทั้งสองไฟล์</li></ol></section>
<section><h2>ก่อนลบข้อมูลหรือบัญชี</h2><p>ดาวน์โหลดไฟล์สำรองและใบเสร็จก่อนเสมอ อ่านขอบเขตในหน้าต่างยืนยัน การลบคลาวด์กับการลบบัญชีเป็นคนละคำสั่ง บัญชีที่มีประวัติชำระ Pro ต้องติดต่อทีมเพื่อจัดการเอกสารที่ต้องเก็บตามนโยบาย หลังลบแล้วข้อมูลในไฟล์ที่คุณเคยดาวน์โหลดยังคงอยู่กับคุณ</p></section>
<section><h2>ติดต่อทีม</h2><p>เปิดเมนู → ช่วยเหลือ แล้วใช้ช่องทางซัพพอร์ตที่ประกาศในแอป หากยังขึ้นว่ายังไม่ได้ตั้งค่า ให้ใช้เดโมก่อน ระบบยังไม่พร้อมรับผู้ใช้จริงหรือเก็บค่าบริการ</p></section></html>`
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.setContent(html)
  await page.evaluate(() => document.fonts.ready)
  await mkdir(new URL('../public/', import.meta.url), { recursive: true })
  await page.pdf({ path: new URL('../public/solo-tutor-guide.pdf', import.meta.url).pathname,
    format: 'A4', printBackground: true, margin: { top: '18mm', bottom: '18mm', left: '18mm', right: '18mm' },
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-size:9px;text-align:center;width:100%;color:#536">Solo Tutor · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  })
  await page.screenshot({ path: '/tmp/solo-tutor-guide-preview.png', fullPage: true })
  console.log('Created public/solo-tutor-guide.pdf from current Help copy and embedded local Anuphan font.')
} finally { await browser.close() }
