# Solo Tutor สู่ Production — 8 กันยายน 2569

## สถานะ (อัปเดต 8 ก.ย. ค่ำ)

**เฟส 0 เสร็จทั้งหมด · เฟส 2 เสร็จส่วนที่ไม่ต้องจ่ายเงิน · ช่องว่างที่ปิดแล้ว: 4, 5, 6, 7, 10**

| ทำแล้ว | หลักฐาน |
|---|---|
| start_url → หน้าวันนี้ · Landing ข้ามตัวเองใน standalone · SW ลงทะเบียน (เปิดออฟไลน์ได้) · theme-color ตรง Navy · meta iOS | e2e pwa.spec 4 ข้อ + unit 7 · mutant 4 ตาย |
| หน้า /privacy /terms ตามที่แอปทำจริง · ข้อความยินยอมตอนผู้ปกครองพิมพ์รหัส (ในแอปและใน reply ของ OA) · FAQ 2 ข้อแก้ให้จริง | e2e + unit |
| ปิด Confirm email ผ่าน `supabase config push` (แตะเฉพาะค่าที่ประกาศ) · ทดสอบสมัครจริงได้ token ทันที · ลบ user ทดสอบผ่าน Admin API | ยิงจริงบนโปรเจกต์ |
| ครูสมัครเองได้จากหน้าเว็บ (trigger สร้าง provider ให้) | unit 5 · mutant 3 ตาย |
| Uptime + keep-alive ทุก 6 ชม. (rpc ping แตะ Postgres จริง · preflight ทุก Edge Function · เว็บ 200) ล้ม = GitHub อีเมลเจ้าของ | รันครั้งแรกเขียว |
| Error reporting จาก ErrorBoundary → report-error (ไม่มีชื่อนักเรียน/ยอดเงิน ตรึงชุด key ด้วยเทส) | unit 4 · edge 3 · mutant 3 ตาย · ยิงจริง |
| ฟอร์มจองสิทธิ์ → Edge Function waitlist (แทน Google Form ที่ไม่เคยมี) CORS เฉพาะ origin จริง | ยิงจริง: origin แปลก 403 · ไม่ครบ 400 · แถวลงแล้วลบทิ้ง |
| ตรวจทุกปุ่มบนเว็บจริงด้วยเบราว์เซอร์สด 4 รอบ (เช็คชื่อ/ยกเลิก · เลื่อน/งด · เพิ่มวันนี้ · ปิดยอด · แนบสลิป · แชร์การ์ด · แก้/ข้าม/ส่งใน LINE · แชท chip+พิมพ์ · เมนู 10 รายการ · สำรอง/กู้คืน/นำเข้า/ส่งออก CSV · ธีม · Sheets · เริ่มใช้จริง · สมัครบัญชีครู · ใบเสร็จ · หน้าผู้ปกครอง) | console error = 0 ทุกรอบ · แถบ "อ่านอย่างเดียว" ทำงานถูกเมื่อมีอีกแท็บถือสิทธิ์เขียน |

| ตัดสินใจอยู่แพลนฟรี (8 ก.ย.) → ข้อ 2 ปิดด้วย cron ปลุก · ข้อ 3 ปิดด้วย workflow backup รายสัปดาห์เข้ารหัส เก็บ 90 วัน — **รอ 2 secrets จากเจ้าของ** (`SUPABASE_ACCESS_TOKEN`, `BACKUP_PASSPHRASE`) · ซ้อม restore ลง Postgres 16 แล้ว 14 ตาราง | dump/restore จริง |

**ยังเปิดอยู่:** 1 (ซิงก์ข้ามเครื่อง — เฟส 3) · 8 (plan/เพดาน/พัก — เฟส 4) · 9 (OA จริง — ต้องบัญชี LINE) · 11–13 · backup รอ secrets


ฉบับอ่านง่ายพร้อมสกอร์การ์ด: https://claude.ai/code/artifact/af3ea6c8-1e98-441d-b628-ac6ab2cb0e7b
ตรวจจาก main `62a0f46` · เว็บจริง · Supabase `qbuafdbmpkffzbkqoysb` (สิงคโปร์)

## คะแนน

| มุม | คะแนน | ติดอะไร |
|---|---|---|
| พร้อมขึ้นเวที | **8/10** | เดโมเดินจบ loop บนเว็บจริง QR สแกนได้จริง |
| พร้อม production วันนี้ | **6/10** | ข้อมูลอยู่เครื่องเดียว · Supabase ฟรีหลับหลัง 7 วัน · ไม่มี backup · ไม่มี PDPA |
| หลังจบเฟส 3 | **9/10** | งานผม ~5 วัน + งานเจ้าของบัญชี ~3 ชม. |

4 มุม (craft-qa): CTO 7 · Tech Lead 8 · UX 7 · QA 8

## ตอนเปิดเป็นแอป (PWA) — เหมือนเว็บทุกอย่าง และนั่นคือปัญหา

- `start_url: "./"` → ติดตั้งแล้วเปิดมาเจอหน้าขายของ ไม่ใช่หน้าวันนี้
- `public/sw.js` มีครบ แต่**ไม่มีใครลงทะเบียน** (`getRegistrations()` บนเว็บจริง = 0) → ออฟไลน์ไม่ได้ · กลไก "บัมป์เวอร์ชันแล้วทิ้งแคช" ไม่เคยทำงาน
- `theme-color` ใน index.html ยังเป็น `#f7f5f1 / #14120f` (ชุดก่อน Navy) — fix-list #43
- iOS มีแค่ apple-touch-icon

## ช่องว่างสู่ production (ยืนยันจากโค้ด/การรันจริงทุกข้อ)

| # | ระดับ | เรื่อง | แก้เฟส |
|---|---|---|---|
| 1 | blocker | ข้อมูลครูอยู่ localStorage เครื่องเดียว เปลี่ยนมือถือ = หาย (มี backup ไฟล์/Sheets แต่ต้องกดเอง) | 3 |
| 2 | blocker | Supabase Free "paused after 1 week of inactivity" | 2 |
| 3 | blocker | Free ไม่มี automatic backup | 2 |
| 4 | high | ไม่มี /privacy /terms · ไม่มีข้อความยินยอมตอนผู้ปกครองผูก LINE · FAQ "ไม่เก็บสำเนา" จะเท็จเมื่อเปิด OA | 0–1 |
| 5 | high | Confirm email เปิดอยู่ + อีเมลในตัว 2 ฉบับ/ชม. (ทดสอบสมัครจริงแล้ว ไม่ได้ token) | 0 (สวิตช์) · 3 (SMTP) |
| 6 | high | PWA 3 ข้อด้านบน | 0 |
| 7 | high | ไม่มี error reporting / uptime check / analytics — `track()` เก็บใน state ไม่ส่งไปไหน | 2 |
| 8 | medium | สัญญาหน้าราคาที่โค้ดไม่รักษา: เพดาน 5 นักเรียน · plan · ฟีเจอร์พัก · รับเงิน | 4 |
| 9 | medium | LINE OA ยังไม่เคยคุยกับ LINE จริง (เทส mock 6 ตัว) | 1 |
| 10 | medium | `WAITLIST_ENDPOINT` ว่าง — จองสิทธิ์รุ่นแรกไม่ถึงใคร | 0 |
| 11 | medium | ไม่มี ESLint / coverage threshold (SF-44) | 5 |
| 12 | low | โดเมนยังเป็น github.io — เปลี่ยนหลังส่งลิงก์แล้ว = ลิงก์ตาย ต้องตัดสินใจก่อนมีผู้ใช้ | ตัดสินใจเฟส 1 |
| 13 | low | dependabot 4 ตัว (React 19 · vitest 4 · plugin-react 6) | หลังนำเสนอ |

## แผน 6 เฟส (แต่ละเฟสมี QA gate อัตโนมัติ + manual)

**เฟส 0 · ก่อนขึ้นเวที (ครึ่งวัน)** — start_url → `#/app/today` + ซ่อน Landing ใน standalone · ลงทะเบียน sw.js + เทสออฟไลน์ · theme-color ตรง Navy · แก้ FAQ 2 ข้อให้จริง · [เจ้าของ] ปิด Confirm email · ลบ user ทดสอบ `+solotutorqa` · Google Form → WAITLIST_ENDPOINT
Gate: e2e standalone เปิดหน้าวันนี้ · SW registrations ≥1 และเปิดได้ตอน offline · unit theme-color = --bg · manual: ติดตั้งบน iPhone/Android เปิดจากไอคอนเข้าหน้าวันนี้

**เฟส 1 · LINE OA ใช้จริงกับครูคนแรก (1 วัน)** — [เจ้าของ] สร้าง Messaging API channel · เชื่อมผ่านแอป · webhook Verify · ผูกผู้ปกครอง 1 คน · ส่ง 1 ฉบับ + retry + ยกเลิก · หน้า /privacy /terms + ข้อความยินยอม · ตัดสินใจโดเมน
Gate: webhook จาก LINE จริงตอบ 200 มีแถว line_recipients · ยิงลายเซ็นมั่วไป OA ที่เชื่อมแล้วต้อง 401 · manual: สแกน QR ด้วยแอปธนาคารจริง (ไม่โอน)

**เฟส 2 · ไม่ให้บริการดับ (1 วัน)** — [เจ้าของ] Pro $25/เดือน หรือ cron ปลุกทุก 3 วัน (ไม่แก้ backup) · uptime check ทุก 6 ชม. · error reporting จาก ErrorBoundary (ไม่ส่งข้อมูลนักเรียน) · backup ที่เคย restore จริง
Gate: ปิดฟังก์ชันแล้ว uptime แดงภายใน 6 ชม. · error ปลอมโผล่ใน log ภายใน 1 นาทีและไม่มีชื่อนักเรียน

**เฟส 3 · ข้อมูลไม่หายเมื่อเปลี่ยนเครื่อง (2–3 วัน)** — snapshot ต่อ provider เข้ารหัสฝั่งเครื่อง (เราอ่านไม่ได้) · revision สูงกว่าชนะ + เก็บอีกฝั่งเป็นไฟล์กู้คืน · [เจ้าของ] Resend SMTP → เปิด Confirm email กลับ + ลืมรหัสผ่าน
Gate: ciphertext ไม่มี plaintext ชื่อ/ยอด · สองเบราว์เซอร์แก้พร้อมกันไม่มีข้อมูลหาย · service_role อ่านได้แต่ ciphertext

**เฟส 4 · โมเดลธุรกิจใช้จริง (2 วัน)** — plan บน provider · เพดาน 5 นักเรียนจริง · ฟีเจอร์พัก ≤3 เดือน/ปี · รับเงินรอบแรกแบบโอนพร้อมเพย์ + เจ้าของกดยืนยัน · ใบเสร็จค่าสมาชิก
Gate: คนที่ 6 บน free ถูกปฏิเสธ ข้อมูลเดิมอยู่ read-only · พักแล้ววันหมดอายุเลื่อนเท่าวันพัก

**เฟส 5 · ขยาย** — โดเมนจริง + redirect · ESLint/coverage · dependabot · QA เครื่องจริง iPhone/Android/iPad/จอฉาย · analytics แบบตัวนับ · ยื่น LINE Module Channel เมื่อจดบริษัท

## สิ่งที่ต้องเป็นเจ้าของบัญชีกด (ห้ามส่ง secret มาในแชท)

A. ปิด Confirm email — Auth → Sign In / Providers → Email → Confirm email OFF → Save
B. ลบ user ทดสอบ `kazutokung59+solotutorqa@gmail.com` — Auth → Users
C. Pro $25/เดือน — Org → Billing (คิดระดับ org ครอบ Open-Gambit ด้วย ย้าย project ก่อนถ้าไม่ต้องการ)
D. LINE Messaging API — OA Manager → Settings → Messaging API → Enable → Developers Console: Channel secret (Basic settings) + access token (Issue) → วางในแอป → Verify webhook → Use webhook ON → ปิด Auto-reply/Greeting ของ LINE
E. Google Form 6 ช่อง (อาชีพ · ชื่อ · ติดต่อ · จำนวนนักเรียน · วิธีเก็บเงิน · ตั้งระบบให้) → ส่ง URL viewform มา
F. Resend — สมัคร → Domains (DNS DKIM/SPF) → API key → Supabase Project Settings → Auth → SMTP: smtp.resend.com:465 user `resend`
G. โดเมน — ซื้อ → ส่งชื่อมา → ผมตั้ง CNAME → GitHub Pages custom domain + HTTPS + redirect ลิงก์เก่า
H. GitHub integration (ทางเลือก) — Project Settings → Integrations → GitHub → repo `Tasachii/solo-tutor` · แพลนฟรีไม่มี preview branch

## Manual test เต็ม loop

ก. เข้าครั้งแรก: หน้าแรก 5 วิ · ทดลองใช้ → รายครั้ง → วันนี้ · เริ่มใช้จริง (บังคับเลือกคำลงท้าย) · วางรายชื่อ 3 คน · ติดตั้งแล้วเปิดจากไอคอน
ข. วันปกติ: เพิ่มวันนี้ → เช็คชื่อ → ยอดประมาณการ · เลื่อน/งด · ปิดเปิดแอปครบ · สองแท็บ = แท็บสอง read-only
ค. สิ้นเดือน: ปิดยอด → บิลครบ · ร่างสุภาพ ค่ะ ตลอด ไม่มี "ระบบ/อัตโนมัติ" · ส่งใน LINE · ลิงก์บิล → QR สแกน (ไม่โอน) · สลิปตรง/ไม่ตรง · เดือนถัดไปค้างสะสม + โทนทวงเปลี่ยน
ง. เงิน: จ่ายบางส่วน · เกินแพ็ก · เปลี่ยนราคากลางเดือน · backup → ล้าง → restore เลขรันเดิม
จ. LINE OA: สมัคร → เชื่อม → รหัสผูก → ส่งจริง → ส่งซ้ำถูกบล็อก → ตัด wifi → reconcile ไม่ซ้ำ → บัญชีอื่นบนเครื่องเดียวกันขึ้นเตือน
ฉ. ทุกเครื่องทุกธีม: 4 ธีม × 3 หน้า · 320px ไม่ล้น · 1920 หน้าผู้ปกครองไม่ยืดเต็มจอ · QR ดำบนขาวในธีมมืด

## แก้คำที่เคยพูดผิด

- "แคช SW บัมป์เป็น v3 แอปที่ติดตั้งไว้จะทิ้งของเก่าเอง" — ไม่จริง เพราะ sw.js ไม่เคยถูกลงทะเบียน ผลกระทบตอนนี้เป็นศูนย์ แก้เฟส 0
- FAQ "เราไม่เก็บสำเนาไว้ที่ไหน" — จริงวันนี้ จะเท็จวันที่ครูคนแรกเชื่อม OA ต้องแก้ก่อนวันนั้น

คู่มือผู้ใช้ (PDF 20 หน้า มี screenshot) สร้างด้วย Playwright จากเวอร์ชันจริง — ขอไฟล์หรือสคริปต์สร้างซ้ำได้จาก session นี้
