# ผลแก้ไข Solo Tutor จาก QA — 6 กันยายน 2026

แก้ในโค้ดแล้ว **45 จาก 48 รายการ**; อีก **3 รายการแก้บางส่วน** และมีขอบเขตที่ยังต้องทำชัดเจนด้านล่าง ตัวเลขนี้หมายถึงรายการจาก audit เดิม ไม่ใช่การรับประกันว่าไม่มีบั๊กอื่น

คะแนนประเมินหลังแก้สำหรับแอป local-first: **8/10** (เดิม 5/10) จากความถูกต้องของข้อมูล/ยอดเงิน, การกู้คืน, เส้นทาง UI และหลักฐานทดสอบ คะแนนเป็นดุลยพินิจ QA ไม่ใช่เปอร์เซ็นต์ test ผ่าน ส่วน LINE/Supabase scaffold ประเมิน **6/10 ด้านความพร้อมเปิดใช้จริง** เพราะยังไม่มี staging E2E และยังไม่ได้ deploy

หลักฐานทดสอบล่าสุด:

- Unit: 302 tests ผ่านใน 35 files
- Browser: 144 tests ผ่าน ครบ Chromium mobile, Chromium desktop และ WebKit (iPhone viewport)
- TypeScript, whitespace/diff check และ production build ผ่าน
- PostgreSQL 16: migration จากฐานว่าง, tenant isolation, grants/FKs, atomic redeem/claim/settle และ quota/retry contracts
- Deno: 11 handler contracts ผ่าน; ใช้ test doubles และปิด runtime network; ไม่ได้ส่ง LINE จริง
- `npm audit`: 0 vulnerabilities ณ เวลาตรวจ
- Smoke document + JS/CSS assets ผ่านกับ production build ที่เปิดในเครื่อง

สามรายการที่ยังไม่ปิดทั้งหมด:

1. **SF-39:** โค้ดและ tests ของ LINE/Supabase ทำแล้ว แต่ยังต้องตั้งค่า secrets/Auth/allowed origins แล้วทดสอบ staging เชื่อม OA, webhook, cron, push/retry และเชื่อม UI กับ backend จริง
2. **SF-44:** มี typecheck, tests และ global browser error checks แล้ว แต่ยังไม่มี ESLint/coverage threshold; ไม่เพิ่ม dependency ใหม่โดยพลการ
3. **SF-47:** waitlist บันทึกในเครื่องและแจ้งตามจริงแล้ว แต่ยังไม่มี endpoint รับข้อมูลที่ทีมใช้งานจริง

ข้อจำกัดของการตรวจ:

- WebKit ทดสอบด้วย browser engine และ iPhone viewport; native iOS share sheet ใช้การตรวจสัญญาไฟล์ผ่าน mock API ยังต้องตรวจบนเครื่อง iPhone จริง
- ใบเสร็จจาก v3/v4 ที่ชื่อเคยถูกเปลี่ยนไปแล้วกู้ชื่อเดิมจากอดีตไม่ได้ จึงบันทึกค่าที่มีพร้อม `legacyBackfill`; schema 5 ที่ข้อมูลไม่ครบจะปฏิเสธการเปิด/กู้คืน
- แท็บเวอร์ชันเก่าที่ไม่รู้จัก Web Locks อาจเขียนครั้งหนึ่งได้; เวอร์ชันใหม่ตรวจพบแล้วหยุดเขียนและขอโหลดล่าสุด
- ยังไม่ได้เปลี่ยน branch-protection settings, รัน GitHub-hosted CI, deploy หรือทดสอบ LINE/ธนาคารจริง
- SQL tests ใช้ auth schema stub ใน PostgreSQL ชั่วคราว; ต้องตรวจ migration กับ schema staging จริงก่อนนำไปใช้

รายการแก้ไขครบตาม audit:

| ID | สถานะ | จุดแก้และผลลัพธ์ |
|---|---|---|
| SF-01 | แก้ในเครื่องแล้ว | Web Lock ตลอดอายุแท็บ, revision, read-only follower, รับข้อมูลล่าสุดและรับสิทธิ์เขียนต่อ — `src/core/store.tsx` |
| SF-02 | แก้ในเครื่องแล้ว | เก็บประวัติแทนลบ และปิดยอดงานค้างของรายชื่อที่หยุดแล้วได้ — `src/core/store.tsx; src/core/billing.ts` |
| SF-03 | แก้ในเครื่องแล้ว | ห้องแชทไม่พบผู้จ่ายแสดงข้อผิดพลาดและไม่บันทึกข้อมูลกำพร้า — `src/app/Admin.tsx; src/core/store.tsx` |
| SF-04 | แก้ในเครื่องแล้ว | ปรับบิลร่างตามงาน; ล็อกการแก้งานในรอบที่ส่งบิล/รับเงินแล้ว — `src/core/billing.ts; src/core/store.tsx` |
| SF-05 | แก้ในเครื่องแล้ว | เลือกเดือนย้อนหลังและปิดยอดตกค้าง; บิลที่กดรับเงินตรงเดือนที่เลือก — `src/app/Billing.tsx` |
| SF-06 | แก้ในเครื่องแล้ว | snapshot ใบเสร็จถาวร; v3/v4 backfill พร้อมป้าย; v5 เสียหายไม่ซ่อมเงียบ — `src/core/receipts.ts; src/app/Receipt.tsx` |
| SF-07 | แก้ในเครื่องแล้ว | แยกเครดิตเดิมออกจากจำนวนที่ซื้อใหม่; ต่อแพ็กด้วยจำนวน/ราคาใหม่โดยไม่เพิ่มเครดิตผิด — `src/core/ledger.ts; src/app/SubjectDetail.tsx` |
| SF-08 | แก้ในเครื่องแล้ว | ต่อแพ็กยืนยันเองไม่อ้างตรวจสลิป; ใบเสร็จตรวจสถานะครบทุกงวด — `src/core/receipts.ts; src/core/store.tsx` |
| SF-09 | แก้ในเครื่องแล้ว | แยก opening balance กับ paid purchase ชัดเจน; บิล/เงิน/ใบเสร็จบันทึกพร้อมกัน — `src/app/SubjectSheet.tsx; src/core/store.tsx` |
| SF-10 | แก้ในเครื่องแล้ว | เลื่อน/งดคาบกับข้อความแจ้งบันทึกใน transaction เดียว; onboarding ไม่แก้ state ก่อนเขียนสำเร็จ — `src/core/store.tsx; src/app/Today.tsx` |
| SF-11 | แก้ในเครื่องแล้ว | ใช้วันที่ YYYY-MM-DD และแสดงผลบันทึกล้มเหลวโดยเก็บข้อมูลที่กรอก — `src/platform/WaitlistSheet.tsx` |
| SF-12 | แก้ในเครื่องแล้ว | แก้คำโฆษณาให้ตรงความสามารถที่ใช้ได้จริงและระบุแพ็กเกจตัวอย่าง — `src/copy/index.ts; index.html` |
| SF-13 | แก้ในเครื่องแล้ว | ยอดเงินเข้า/ค้าง/ติดตามคืนตรงรอบเดือน — `src/core/selectors.ts` |
| SF-14 | แก้ในเครื่องแล้ว | หน้าบิลแสดงแพ็กได้แม้ไม่มี monthly invoice — `src/app/Billing.tsx` |
| SF-15 | แก้ในเครื่องแล้ว | เปิดใช้งานรายชื่อที่หยุดแล้วได้โดยใช้ประวัติเดิม — `src/app/SubjectDetail.tsx; src/core/store.tsx` |
| SF-16 | แก้ในเครื่องแล้ว | เลือกผู้จ่ายเดิม/เพิ่มผู้จ่ายใหม่ได้; ล็อกการย้ายผู้จ่ายเมื่อมีบิลหรือข้อความย้อนหลัง — `src/app/SubjectSheet.tsx` |
| SF-17 | แก้ในเครื่องแล้ว | ส่ง null เพื่อล้าง LINE ID จริง — `src/core/store.tsx` |
| SF-18 | แก้ในเครื่องแล้ว | ปฏิเสธข้อความว่าง; กรณีบันทึกไม่ได้ไม่ปิด editor หรือเคลียร์คำถาม — `src/app/Admin.tsx; src/core/validation.ts` |
| SF-19 | แก้ในเครื่องแล้ว | noopener คืน null ไม่ถือว่าเปิดล้มเหลว; ยังต้องให้ผู้ใช้ยืนยันส่ง — `src/app/share.ts` |
| SF-20 | แก้ในเครื่องแล้ว | รอผล clipboard และบอก failure ตามจริง — `src/app/Admin.tsx; src/app/SubjectDetail.tsx` |
| SF-21 | แก้ในเครื่องแล้ว | กู้คืนแจ้งเหตุไฟล์ผิด/เวอร์ชันผิด/บันทึกไม่ได้; เก็บไฟล์เดิม — `src/app/StorageStatus.tsx; src/core/migrations.ts` |
| SF-22 | แก้ในเครื่องแล้ว | ห้ามบันทึกนัดที่ไม่มีวัน/เวลา และบอกเหตุ save ล้มเหลว — `src/app/Today.tsx` |
| SF-23 | แก้ในเครื่องแล้ว | สถานะเลือกใช้ aria-pressed/selected และฟอร์มสัมพันธ์กับ error — `src/app/Admin.tsx; src/app/Onboarding.tsx` |
| SF-24 | แก้ในเครื่องแล้ว | เชื่อม error กับ input ด้วย aria-invalid/describedby — `src/platform/WaitlistSheet.tsx` |
| SF-25 | แก้ในเครื่องแล้ว | ปุ่มหลักใช้สี accent ที่ contrast เหมาะสมใน light theme — `src/index.css` |
| SF-26 | แก้ในเครื่องแล้ว | โหมดจริงรับคำถามจริงเพื่อร่างคำตอบ; ปุ่มจำลองเหลือเฉพาะ demo — `src/app/Admin.tsx` |
| SF-27 | แก้ในเครื่องแล้ว | รองรับ prefers-reduced-motion — `src/index.css` |
| SF-28 | แก้ในเครื่องแล้ว | ย้อนกลับแก้ข้อมูลผู้ให้บริการได้ก่อนจบ onboarding — `src/app/Onboarding.tsx` |
| SF-29 | แก้ในเครื่องแล้ว | แถวไม่ถูกต้องต้องยืนยันก่อนข้าม — `src/app/ImportSheet.tsx; src/app/Onboarding.tsx` |
| SF-30 | แก้ในเครื่องแล้ว | แยกยอดค้างกับประวัติบิลทั้งหมดที่รวมรายการชำระแล้ว — `src/app/ClientPreview.tsx` |
| SF-31 | แก้ในเครื่องแล้ว | หน้าไม่พบใบเสร็จในโหมดจริงไม่มี demo badge — `src/app/Receipt.tsx` |
| SF-32 | แก้ในเครื่องแล้ว | เดสก์ท็อปเริ่มกรอบเว็บและจำการเลือกกรอบมือถือที่ตั้งเอง — `src/core/present.ts` |
| SF-33 | แก้ในเครื่องแล้ว | เตือนนัดวันเวลาเดียวกันแต่ยังบันทึกงานกลุ่มได้; คืนโฟกัสใน WebKit — `src/app/Today.tsx` |
| SF-34 | แก้ในเครื่องแล้ว | migration ตั้งแต่ฐานว่างพร้อม providers/clients และ signup provisioning — `supabase/migrations/0001_line.sql` |
| SF-35 | แก้ในเครื่องแล้ว | RLS/column grants ให้ owner อ่าน public view ได้โดยไม่เปิด secret — `supabase/migrations/0001_line.sql` |
| SF-36 | แก้ในเครื่องแล้ว | composite tenant foreign keys ป้องกันอ้างข้อมูลข้าม provider — `supabase/migrations/0001_line.sql` |
| SF-37 | แก้ในเครื่องแล้ว | enqueue RPC จำกัด request fields; server สร้างสถานะ/attempt/retry key — `supabase/migrations/0001_line.sql` |
| SF-38 | แก้ในเครื่องแล้ว | retry code collision และ redeem แบบ atomic พร้อมทดสอบพร้อมกัน — `supabase/migrations/0001_line.sql` |
| SF-39 | บางส่วน | มี handler Auth/cron/signature และ DB integration ในเครื่อง; ยังต้องเชื่อม/ทดสอบ Supabase+LINE staging จริง — `supabase/functions; tests/edge; tests/sql` |
| SF-40 | แก้ในเครื่องแล้ว | Node 22 ที่ CI/engine สอดคล้อง; ไม่เพิ่ม npm dependency — `.nvmrc; .npmrc; package.json` |
| SF-41 | แก้ในเครื่องแล้ว | PR มี typecheck/unit/DB/Edge/E2E gate; สิทธิ์ deploy เฉพาะ main และ job ที่ต้องใช้ — `.github/workflows/deploy.yml` |
| SF-42 | แก้ในเครื่องแล้ว | เก็บ playwright-report และ test-results พร้อม trace/screenshot เมื่อพัง — `.github/workflows/deploy.yml; playwright.config.ts` |
| SF-43 | แก้ในเครื่องแล้ว | Chromium mobile/desktop และ WebKit iPhone viewport; timezone ไทย, backup import/export, multi-tab — `playwright.config.ts; tests/e2e` |
| SF-44 | บางส่วน | เพิ่ม global console/network checks และ typecheck/diff gate; ยังไม่มี ESLint rules และ coverage threshold — `tests/e2e/fixtures.ts; package.json` |
| SF-45 | แก้ในเครื่องแล้ว | ลด permissions ระดับ workflow; pages/id-token write เฉพาะ deploy job — `.github/workflows/deploy.yml` |
| SF-46 | แก้ในเครื่องแล้ว | เพิ่ม post-deploy asset smoke, scheduled dependency audit/WebKit และ Dependabot — `scripts/smoke-deployment.mjs; .github/workflows/quality-scheduled.yml` |
| SF-47 | บางส่วน | บอก local-only ตามจริง; remote success ต้องอ่านผลได้; ยังไม่มีปลายทางรับข้อมูลจริงที่ตั้งค่าไว้ — `src/platform/WaitlistSheet.tsx` |
| SF-48 | แก้ในเครื่องแล้ว | คำนวณรายได้จากราคาที่บันทึกตอนทำงานให้ตรงกับบิล แม้แก้ราคาปัจจุบัน — `src/core/selectors.ts` |

เอกสารแยกตามส่วน: [core](qa-core-fixes.md), [UI](qa-ui-fixes.md), [backend](qa-backend-fixes.md), [Supabase setup](../supabase/README.md)

หลักฐาน audit และ logs: `/Users/tasachi/Documents/solo-tutor-qa-20260906/` — `fix-final-unit.log`, `fix-final-e2e.log`, `fix-db-integration.log`, `fix-edge-integration.log`, `fix-dependency-audit.json`, `fix-smoke.log`, `remediation.json` และภาพ `fix-*.png`
