# Solo Tutor — หลักฐาน QA วันที่ 8 กันยายน 2569

> รายงานรอบแรก: ดู [สถานะล่าสุดและงานที่ปิดเพิ่ม](launch-status.md) สำหรับการลบบัญชี paid, payment evidence, CSP/cache และการเชื่อมฐานข้อมูลรอบต่อมา

**ผลสำหรับ Demo/mock: ผ่านการทดสอบและการรีวิวอิสระในขอบเขตด้านล่าง** ข้อมูลสาธิตยังอยู่ ส่วนการเปิดรับเงินจริงยังมี blocker ตาม [รายการเรียงลำดับรายได้](production-readiness-20260908.md) ไม่ได้ deploy การแก้หรือเปลี่ยนแพ็ก Supabase ในงานนี้

ตรวจจาก baseline `fe911805ffe454f745a2241b08810881b9893733` และการแก้ใน working tree บน macOS, Node 23.10.0 ทดสอบกับ production build ในเครื่อง ไม่ใช่เฉพาะ dev server

## ผลทดสอบสุดท้าย

| การตรวจ | ผล | หลักฐาน |
|---|---|---|
| Unit/regression | 58 files, 454 tests ผ่าน | [unit.log](qa-evidence/2026-09-08/unit.log) |
| TypeScript + whitespace diff | ผ่าน | [check.log](qa-evidence/2026-09-08/check.log) |
| Browser: Chromium mobile/desktop และ WebKit | 194 ผ่าน, 37 skip ตามเงื่อนไข | [browser.log](qa-evidence/2026-09-08/browser.log) |
| Supabase/LINE/Pro mock: ทั้งสาม browser configurations | 39 ผ่าน | [mock.log](qa-evidence/2026-09-08/mock.log) |
| Edge: authentication, CORS, limit, deletion, LINE | 26 ผ่าน | [edge.log](qa-evidence/2026-09-08/edge.log) |
| PostgreSQL 16: migrations, grants/RLS, concurrency และ deletion guard | ผ่าน | [database.log](qa-evidence/2026-09-08/database.log) |
| Dependency audit | ไม่พบ vulnerability ตามฐานข้อมูล npm ขณะตรวจ | [audit.log](qa-evidence/2026-09-08/audit.log) |
| Build สุดท้ายหลังจบ mock | ผ่าน; ตรวจว่าไม่มีค่า service configuration ของ QA ค้างใน `dist` | [build.log](qa-evidence/2026-09-08/build.log) |

จำนวน browser เป็น test executions รวมหลาย configuration ไม่ใช่จำนวน user stories ที่ไม่ซ้ำกัน และผล audit ไม่ใช่หลักประกันว่าไม่มีช่องโหว่ทั้งหมด

Build ยังเตือน bundle หลัก 572.31 kB ก่อน gzip (160.56 kB หลัง gzip) ไม่ใช่ build failure; บันทึก route splitting เป็นงานปรับประสิทธิภาพต่อ

37 skips มีเหตุผลอยู่ใน test: เส้น Supabase/LINE ข้ามเมื่อไม่ได้ตั้งค่า mock (รันแยกครบด้านบน), WebKit ไม่รองรับ clipboard permission ที่ fixture ใช้, SW ตรวจเฉพาะ Chromium และกรอบเว็บกว้างข้ามใน viewport มือถือ ไม่ได้อ้างว่าทุกกรณีของทุก browser ถูกตรวจแล้ว

รอบ baseline มี unit 411 tests; ชุดสุดท้ายเพิ่มการป้องกัน regression ของบัญชี/กุญแจ/การเงิน/ข้อมูลนำเข้า/บริการออฟไลน์ ก่อนแก้เคยมี E2E ล้มจาก build สองชุดเขียน `dist` พร้อมกัน จึงแยกพอร์ตและรัน build เป็นลำดับ ผลในตารางคือรอบที่แยกแล้ว

## วงจรที่ตรวจ

- หน้าขาย → เลือกรูปแบบ/แพ็ก → Demo → ยืนยันเริ่มใช้จริง → onboarding → นำเข้ารายชื่อ โดยไม่ล้าง Demo โดยอัตโนมัติ
- ครูเช็คชื่อ/แก้รายชื่อ → คำนวณรายครั้ง/แพ็ก/เหมาเดือน → เดือนค้างและเดือนที่ไม่มีคาบ → ส่งร่างข้อความ → หน้าผู้ปกครอง → รับยอดจำลอง/ใบเสร็จ → ประวัติและ export
- เปลี่ยนเงื่อนไขคิดเงินเมื่อมีงานหรือบิลร่างค้าง, หยุด/กลับมาเรียน, ไม่คิดเหมาย้อนก่อนเริ่มสัญญาหรือช่วงหยุด
- บัญชีและ sync: local-to-cloud, conflict, แก้ข้อมูลระหว่างรอ, สลับบัญชี, wrong key, recovery-file roundtrip และตรวจ decrypt ก่อนแจ้ง synced
- ลบบัญชีฟรี: ยืนยันรหัสผ่าน, แท็บที่ไม่ได้สิทธิ์เขียนลบไม่ได้, ส่งสัญญาณล้างข้อมูลหลายแท็บ และไม่คืนข้อมูลเก่าหลังปิดแท็บหลัก; บัญชีมี approved payment ต้องถูกปฏิเสธโดยข้อมูลยังอยู่
- วงจร Pro แบบชำระล่วงหน้า: เลือกแพ็ก, ส่งคำขอ, pending/ยกเลิก/ข้อผิดพลาด, อนุมัติจำลอง, สิทธิ์/หมดอายุ/พัก/กลับมาใช้ และเลขใบเสร็จพร้อมกัน
- LINE: ตั้งค่าและตรวจ protocol ด้วย mock, ผูกผู้ปกครอง/ข้อความ/สถานะตามชุดทดสอบ ไม่ส่งหา LINE จริง
- Error/rejection/network failure, payload ไม่ส่งข้อมูลส่วนตัวจากข้อความ exception, rate limit ทั้ง global/client, oversized streamed request และ bearer ที่ไม่ถูกต้อง
- Offline ตั้งแต่ติดตั้งครั้งแรก, ฟอนต์ไทยในเครื่อง, cache ของแอปอื่นยังอยู่, iframe ไม่ render ข้อมูลบัญชี และ CSP บล็อก inline script ที่ไม่ได้อนุญาต

Regression fixtures `src/mock/seed.ts` และ `src/core/scenarios.ts` ไม่มี diff จากงานนี้ คู่มือ PDF ใหม่ 4 หน้าอยู่ใน [ไฟล์คู่มือ](../public/solo-tutor-guide.pdf) พร้อมลิงก์ใน Help; ตรวจการสร้างและภาพหน้าแรกแล้ว ไม่ได้ผลิตวิดีโอสอนหรือวิดีโอ pitch

## ประเมิน 4 มุม

คะแนนเป็นดุลยพินิจจากหลักฐานและข้อจำกัด คะแนนย่อย 0–2 รวมเต็ม 10 ไม่ใช่เปอร์เซ็นต์ coverage และคะแนน Demo ไม่ใช่การอนุญาตเปิดรับเงินจริง

| มุมมอง | เช็ค 1 | เช็ค 2 | เช็ค 3 | เช็ค 4 | เช็ค 5 | รวม |
|---|---|---|---|---|---|---|
| CTO | คุณค่าของ Demo 2 | คุมต้นทุน 2 | ความเสี่ยงข้อมูล 1 | ปฏิบัติการจริง 1 | กฎหมาย/การเงินพร้อมจริง 0 | **6/10** |
| Tech lead | ความถูกต้องธุรกรรม 2 | ขอบเขตบัญชี 2 | regression/CI 2 | การดูแลและเครื่องมือตรวจโค้ด 1 | hosting/security hardening 1 | **8/10** |
| UX/UI | เส้นเริ่มใช้งาน 2 | ครู–ผู้ปกครอง 2 | ข้อความ/Help 2 | responsive/accessibility 1 | ทางออกเมื่อ cloud/key มีปัญหา 1 | **8/10** |
| QA | smoke/core flow 2 | edge cases ข้อมูล 2 | error/recovery 2 | browser coverage 1 | integration/operations จริง 1 | **8/10** |

ให้ Demo/mock โดยรวม **8/10** ส่วนความพร้อมรับเงินจริงยังติดเกณฑ์ผ่าน แม้คะแนนด้านโค้ดดีขึ้น ไม่เฉลี่ยคะแนนเพื่อกลบ blocker

## การรีวิวแยกจากผู้เขียน

ผู้รีวิวอิสระสแกน 88 ไฟล์ที่แก้/เพิ่ม และอ่านเชิงลึกส่วน cloud, deletion, billing, Edge, SQL concurrency, CSP และ service worker หลังแก้ finding แล้วให้ **APPROVE สำหรับ local/mock** และ **REQUEST CHANGES/BLOCKED สำหรับ paid production** ไม่พบ CRITICAL/HIGH defect ค้างในขอบเขต local implementation ที่รีวิว

ผู้รีวิวรัน focused tests 50/50 ผ่าน รวม TypeScript และ `git diff --check`; ไม่รัน build ร่วมกับผู้เขียนเพื่อหลีกเลี่ยงการเขียน `dist` แข่งกัน ผลนี้ไม่ใช่การรับรองว่าทั้งระบบปลอดบั๊ก

Blocker เปิดจริงที่ผู้รีวิวยืนยัน:

1. บัญชีเคยชำระเงินยังลบทั้งหมดไม่ได้ ต้องแยกข้อมูลการเงินที่จำเป็นต้องเก็บออกจากข้อมูลปฏิบัติการและกำหนด retention ที่ตรวจแล้ว ก่อนเปิด paid accounts
2. ต้องใช้ origin แยกก่อนมีข้อมูลเด็กจริง เพราะโปรเจกต์ที่อยู่ใต้ `tasachii.github.io` เดียวกันอ่าน localStorage ข้าม path ได้
3. ต้องมีข้อมูลผู้ให้บริการ/ติดต่อ/รับเงินจริง, SMTP confirmation, นโยบายที่ตรวจแล้วและคนซัพพอร์ตจริง

งาน hardening ต่อ: CSP ระบุ Supabase project ให้ตรงตัว, cache แยกต่อ release แทนการพึ่งเพิ่ม version ด้วยมือ และตรวจ trust ของ IP header/การป้องกัน invocation abuse ที่ infrastructure ไม่ใช่เพียงใน function ดูรายละเอียดทั้งหมดใน [production readiness](production-readiness-20260908.md)

## ขอบเขตที่ยังไม่พิสูจน์

- รอบนี้แก้และทดสอบในเครื่องเท่านั้น ผล read-only ของระบบจริงเป็นหลักฐาน baseline ไม่ได้พิสูจน์ว่า migrations 0007–0008 หรือ functions รุ่นใหม่ขึ้นแล้ว
- Live baseline: Supabase healthy, PostgreSQL 17, migrations 0001–0006, Auth email auto-confirm เปิดอยู่; contract tests รอบนี้ใช้ PostgreSQL 16 จึงต้องซ้อม migration บน staging เวอร์ชันจริงก่อน rollout
- Browser baseline สำรวจ 15 routes × 4 configurations รวม 60 captures โดยไม่พบ overflow/page errors ตาม probe; ไม่เอาภาพ baseline มาแทนผล UI ทุกหน้าของรุ่นแก้
- ยังไม่ทดสอบรับเงินจริง, gateway, SMTP delivery, LINE channel จริง, สิทธิ์ผู้ดูแลเงินจริง, incident response โดยมนุษย์ หรือ paid-account erasure ตามนโยบายจริง
- ไม่ใช่ production load test, penetration test, full accessibility audit หรือการตรวจสัญญาทางกฎหมาย ไม่มี ESLint ใน repo จึงไม่รายงานว่า lint ผ่าน
- รายงาน HTML เต็มเก็บชั่วคราวที่ `/tmp/solo-tutor-qa-final-reports/`; log หลักใน `qa-evidence/2026-09-08/` เก็บไว้กับเอกสารเพื่อให้ตรวจย้อนหลังได้

คำสั่งตรวจซ้ำ/ขั้นตอนปล่อยรุ่น: [runbook](production-rollout.md) · การเลือกแพ็กสำหรับวันแข่ง: [Supabase Free เทียบ Pro](supabase-for-demo.md)
