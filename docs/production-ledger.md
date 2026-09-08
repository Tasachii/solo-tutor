# Production task ledger — Solo Tutor

เริ่ม 8 ก.ย. 2569 จาก baseline `2450bf4` · อัปเดตล่าสุด 8 ก.ย. ค่ำ (หลัง `19f57e3` + งานแท็บค้างจ่าย/การบ้าน) · ID คงที่ อ้างใน commit ได้

สถานะที่ใช้: `ยังไม่ได้ตรวจ` · `พบปัญหา` · `กำลังแก้` · `ผ่าน local/mock` · `ผ่าน live` · `รอข้อมูลเจ้าของ` · `รอผู้เชี่ยวชาญ` · `ปิดแล้ว`
"ผ่าน local/mock" กับ "ผ่าน live" ไม่รวมกันเด็ดขาด

## Baseline รอบนี้ (`2450bf4`, 8 ก.ย. เช้า, เครื่อง Mac เดิม)

| ชุด | ผล | หลักฐาน |
|---|---|---|
| npm ci · check | ผ่าน | `.omx/evidence/baseline-*.log` (ไม่ commit) |
| unit | 473 ผ่าน | เดียวกัน |
| test:db (postgres:17-alpine) | ผ่าน | เดียวกัน |
| test:edge | 29 ผ่าน | เดียวกัน |
| e2e cross-browser | 192 ผ่าน · **2 ล้ม (WebKit)** · 40 skipped | ดู E-01 |
| e2e:mock | 42 ผ่าน | เดียวกัน |
| Supabase remote migrations | 0001–0010 ตรง local ครบ | `supabase migration list` |
| Edge Functions deployed | 7 ตัว (line-connect/webhook/send, waitlist, report-error, usage, delete-account) · **ไม่มี omise-\*** | `supabase functions list` |
| Repo variables | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPPORT_CONTACT` ตั้งแล้ว · `VITE_PROVIDER_LEGAL_NAME`, `VITE_SOLO_PROMPTPAY` **ไม่มี** → แพ็ก Pro ปิดอยู่บนเว็บจริงโดยตั้งใจ | `gh variable list` |

## A. ความปลอดภัยและการกู้ข้อมูลครู

| ID | ปัญหา | หลักฐาน / ไฟล์ | เกณฑ์ผ่าน | สถานะ | ผล/ข้อค้าง |
|---|---|---|---|---|---|
| A-01 | นำเข้าไฟล์กุญแจกู้คืนที่ถูกต้อง แต่บัญชียังไม่มี snapshot บนคลาวด์ → แจ้งว่า "ไฟล์ใช้กับบัญชีนี้ไม่ได้" | `src/app/CloudSync.tsx` importRecovery คืน false เมื่อไม่มี head · `Account.tsx` แสดง recoveryInvalid | กุญแจถูกต้องถูกจดจำและซิงก์ต่อ พร้อม unit test | ผ่าน local/mock | d792d2a: กุญแจถูกต้องถูกจดจำแม้ยังไม่มี snapshot |
| A-02 | เกณฑ์ "เครื่องเปล่า" ของ sync (`hasLedgerData` 3 ตาราง) ต่างจาก store (`hasAccountLedgerData` 9 ตาราง) — เครื่องที่มีแค่ผู้จ่าย/การจ่าย/ข้อความถูกดึงคลาวด์ทับเงียบ | `src/core/cloudSync.ts:85` vs `src/core/store.tsx:39` | ใช้เกณฑ์เดียว + unit test ที่ mutant ตาย | ผ่าน local/mock | d792d2a: เกณฑ์เดียว + รวม homework (8 ก.ย. ค่ำ) |
| A-03 | สำเนาก่อนดึงคลาวด์ (pre-pull backup) เขียนแล้วไม่มีทางกู้คืนจาก UI ทั้งที่ข้อความสัญญาไว้ | `CloudSync.tsx:170` · `copy.account.useCloudConfirm` | มีปุ่มกู้สำเนาก่อนดึงในหน้าบัญชี + เทส | ผ่าน local/mock | d792d2a: ปุ่มกู้สำเนาก่อนดึงในหน้าบัญชี |
| A-04 | "ซิงก์ตอนนี้" กดได้บนแท็บอ่านอย่างเดียวแต่เงียบ | `Account.tsx:80` · `CloudSync.tsx:182` | ปุ่มปิด/บอกเหตุผลเมื่อไม่ writable | ผ่าน local/mock | d792d2a |
| A-05 | ส่งออกกุญแจเงียบเมื่อยังไม่มีกุญแจ · เลือกไฟล์แล้วยกเลิกเงียบ | `Account.tsx:41-62` | มีข้อความบอกทุกทาง | ผ่าน local/mock | d792d2a |
| A-06 | guard race (แก้ระหว่างรอเน็ต) และ account-switch มีโค้ดแต่ไม่มีเทสตรง | `CloudSync.tsx:81-107,132,163` | unit/integration test ที่พิสูจน์ทั้งสองทาง | ผ่าน local/mock | d792d2a: เทส race/account-switch |
| A-07 | reset รหัสผ่านไม่ได้ทำให้เปิดข้อมูลเก่า (กุญแจมาจากรหัสผ่านโดยตรง ไม่มี data key แยก) ทางกู้เดียวคือไฟล์กุญแจ | `cloudCrypto.ts:26-33` · `cloudKey.ts:10-16` · copy บอกตรงแล้ว | ข้อจำกัดถูกอธิบายในแอปและเอกสาร · flow ลืมรหัสผ่านต้องไม่เปิดจนกว่ามี recovery path ที่ทดสอบแล้ว | ผ่าน local/mock (เอกสาร) | crypto migration เป็นงานถัดไป ไม่ทำในรอบนี้ |
| A-08 | ทดสอบข้ามสอง browser contexts บนเว็บจริง (สมัคร → push → เครื่องใหม่ pull → แก้ → กลับมา) | สคริปต์ `.omx/evidence/live/check2.mjs` (รอบ 8 ก.ย. เช้าผ่าน) | รันซ้ำบน SHA ที่ deploy รอบนี้ | ยังไม่ได้ตรวจ (รอบนี้) | user ทดสอบลบผ่าน Admin API ทุกครั้ง |
| A-09 | restore backup ลง isolated DB ตรวจ RLS/decrypt | เฉพาะใน archive `.omx/deferred-production/root/restore-rehearsal.json` | มีสคริปต์ใน active tree และผลรันบน PG17 | ผ่าน local/mock | `scripts/rehearse-restore.sh` รันจริงกับ dump migration 0001–0010 บน postgres:17-alpine: 19 ตาราง RLS ครบ, anon ถูกปฏิเสธ, ciphertext ตรวจรูป (8 ก.ย.) · restore จาก artifact จริงต้อง BACKUP_PASSPHRASE = รอเจ้าของ |
| A-10 | ข้อมูลที่ลบแล้วไม่กลับมาหลัง sync/restore (student erasure tombstone) | deferred `privacy-erasure` migration 0013 | ดู B-05 | รอ B-05 | |

## B. PDPA, export, erasure, DPA

| ID | ปัญหา | หลักฐาน / ไฟล์ | เกณฑ์ผ่าน | สถานะ | ผล/ข้อค้าง |
|---|---|---|---|---|---|
| B-01 | data inventory ครบ 8 ชุดข้อมูล พร้อม purpose/ผู้เข้าถึง/ที่เก็บ/encryption/retention/deletion/ข้อยกเว้น/ผู้รับผิดชอบ | `docs/legal-review-draft.md` มีตารางบางส่วน | เอกสาร `docs/data-inventory.md` ครบทุกคอลัมน์ ระบุ "รอเจ้าของ" ตรงที่ยังไม่มีข้อมูล | ผ่าน local/mock | `docs/data-inventory.md` 14 ชุดข้อมูล ครบคอลัมน์ ช่อง "รอเจ้าของ" = retention/ผู้ถือกุญแจ/บทบาท |
| B-02 | privacy/terms ตรงกับที่โค้ดทำ (usage id, third parties, local plaintext/cloud ciphertext) | `src/copy/index.ts` legal block · `Legal.tsx` | ตรวจทีละข้อเทียบโค้ด แก้ที่ไม่ตรง | ผ่าน local/mock | เทียบทีละข้อกับโค้ดแล้วตรงกัน เติม "การบ้าน" ในรายการข้อมูลในเครื่อง · ถ้อยคำสัญญา = รอผู้เชี่ยวชาญ |
| B-03 | ปุ่ม export/delete ใช้ได้จริง · deletion free/paid ถูกต้อง · cross-account ถูกปฏิเสธ | edge `account-deletion.test.ts` · sql `account_deletion.sql` · e2e `account.spec.ts` | ผ่าน local/mock แล้ว · live ยังไม่ได้ทำรอบนี้ | ผ่าน local/mock | |
| B-04 | financial evidence แยกจาก identity หลังลบบัญชี · ไม่อ้าง anonymous | 0009/0010 + `payment_evidence.sql` | ผ่านแล้ว · เอกสารต้องไม่ใช้คำ anonymous | ผ่าน local/mock | |
| B-05 | student erasure ไม่กลับมาจาก stale device/backup (tombstone) | deferred patch ใช้ migration 0013 ชนเลข | รวมเป็น migration ใหม่เลขถัดไปแบบ additive + SQL/unit tests | ยังไม่ได้ตรวจ | ขนาดใหญ่ ทำหลัง A/E |
| B-06 | ช่องทางใช้สิทธิ + ผู้ตอบ + DPA + legal entity | — | เจ้าของ/ผู้เชี่ยวชาญ | รอข้อมูลเจ้าของ · รอผู้เชี่ยวชาญ | |

## C. LINE OA และหน้าผู้ปกครอง

| ID | ปัญหา | หลักฐาน / ไฟล์ | เกณฑ์ผ่าน | สถานะ | ผล/ข้อค้าง |
|---|---|---|---|---|---|
| C-01 | oversized webhook บน live timeout 20 s (local 413 ใน 0.015 s) สาเหตุไม่รู้ | pitch kit `webhook-transport-diagnostic.json` | probe ควบคุม ≤3 ครั้ง (ไม่มีข้อมูลจริง) แยก gateway/runtime + บันทึกผล | ยังไม่ได้ตรวจ | |
| C-02 | line-webhook อ่าน body + lookup ฐานก่อนตรวจลายเซ็น ไม่มี rate limit | `line-webhook/index.ts:14-57` | จำกัดต่อ IP/ต่อ destination ก่อน lookup โดยไม่ตัด LINE จริง + edge test | กำลังแก้ | 8 ก.ย.: ไม่มี header ลายเซ็น → 401 ก่อน parse/lookup (edge test) · per-destination rate limit ก่อน lookup ยังไม่ทำ เพราะต้อง migration (endpoint enum ใน 0007) และเสี่ยงตัด LINE จริง |
| C-03 | ส่งจริงถึงโทรศัพท์ทีมครบ flow (pair → send once → outbox) | ยังไม่มี | ต้อง Console session + โทรศัพท์ทีม + rotate secret/token | รอข้อมูลเจ้าของ | |
| C-04 | หน้าผู้ปกครองสาธารณะ: ไม่โชว์ banner/ปุ่ม export ของครู · ลิงก์ไม่เปิดข้อมูลคนอื่น · invalid/expired | `src/app/ClientPreview.tsx` · `documents.ts` | e2e ครอบ invalid/expired/cross-client | ผ่าน local/mock | `tests/e2e/shared-document.spec.ts`: token เสีย/ตัด/แก้ยอด/จ่ายเกิน → หน้าเปิดไม่ได้ · เอกสารดีไม่มี UI ครูและไม่สร้าง localStorage |
| C-05 | mock flow (signature/replay/pairing/concurrent) | edge 29 + mock e2e 42 ผ่าน | ผ่าน local/mock | ผ่าน local/mock | |

## D. PromptPay / manual Pro

| ID | ปัญหา | หลักฐาน / ไฟล์ | เกณฑ์ผ่าน | สถานะ | ผล/ข้อค้าง |
|---|---|---|---|---|---|
| D-01 | ราคาสามที่ (TS / SQL / e2e mock) ไม่มีเทสล็อกให้ตรงกัน | `plans.ts` · `0006:33-36` · `account.spec.ts:115` | unit test อ่าน SQL จริงเทียบ TS | ผ่าน local/mock | `tests/unit/plan-prices.test.ts` อ่าน 0006 จริงเทียบ PLANS + copy |
| D-02 | `docs/plan-approval.md` ล้าสมัยและสั่งใช้ `approve_plan_request` เปล่าซึ่งห้ามแล้ว | `plan-approval.md:18-24,47` | เอกสารชี้ไป wrapper verified เท่านั้น | ผ่าน local/mock | `docs/plan-approval.md` เขียนใหม่: wrapper verified เท่านั้น, reject, refund, ป้าย legacy |
| D-03 | คำขอที่ถูกปฏิเสธหายเงียบ · โหลดประวัติล้มดูเหมือนไม่มี · copy `rejected/loadFailed` ไม่ถูกใช้ | `PlanCard.tsx:40-51,130` | แสดง rejected + error โหลด | ผ่าน local/mock | PlanCard แสดง rejected + ช่องทางติดต่อ และแจ้งเมื่อโหลดประวัติล้ม (unit) |
| D-04 | พักแพ็กวันสุดท้ายหายทั้งที่ยัง Pro | `PlanCard.tsx:100` vs `plan.ts:38` | เงื่อนไขตรงกัน + unit | ผ่าน local/mock | พักได้ตราบที่ `isPro` (วันสุดท้ายรวม) + unit |
| D-05 | `revenue_monthly`/`scripts/paid-usage.sql` ยังรายงานยอดจาก approved ที่ไม่มี bank evidence โดยไม่ติดป้าย | `0010:166` · `paid-usage.sql:3` | ติดป้าย unverified หรือชี้ไป view ที่ verified | ผ่าน local/mock | `scripts/paid-usage.sql` ติดป้าย basis=verified/unverified_legacy ทุก query |
| D-06 | concurrent `approve_plan_request_verified` บน request เดียวกันไม่มีเทส | `test-db.sh` | เพิ่ม race test | พบปัญหา | |
| D-07 | ลำดับตรวจยอดหลัง mutate ใน wrapper (ปลอดภัยเพราะ rollback แต่เปราะ) | `0010:72-76` | migration ใหม่ย้ายการตรวจก่อน mutate (additive: create or replace) + test | พบปัญหา | |
| D-08 | refund ไม่แสดงฝั่งครู · ใบเสร็จค้างยอดเต็ม | ไม่มี read path | อย่างน้อยแสดง "มีการคืนเงิน" ในประวัติ | ยังไม่ได้ตรวจ | ทำหลัง D-01..07 |
| D-09 | PromptPay/ชื่อผู้ให้บริการจริง · ผู้ตรวจธนาคาร · เงื่อนไขคืนเงิน/ภาษี | ตัวแปร repo ว่าง | เจ้าของตั้ง `VITE_PROVIDER_LEGAL_NAME`, `VITE_SOLO_PROMPTPAY` แล้ว rerun deploy | รอข้อมูลเจ้าของ | |
| D-10 | เพดานฟรีบังคับฝั่ง client เท่านั้น (ledger เข้ารหัส server นับไม่ได้) | `core/plan.ts` | เขียนข้อจำกัดไว้ในโค้ดและเอกสาร ไม่ลดความเป็นส่วนตัว | กำลังแก้ (เอกสาร) | |

## E. Operations, security, backup

| ID | ปัญหา | หลักฐาน / ไฟล์ | เกณฑ์ผ่าน | สถานะ | ผล/ข้อค้าง |
|---|---|---|---|---|---|
| E-01 | e2e WebKit `qa-data-regressions` "Importing a module script failed" ตอน reload 2 ครั้งใน baseline | `.omx/evidence/baseline-*.log` | แยก flake/regression ด้วยรันซ้ำ 3 รอบ แล้วแก้ที่ต้นเหตุถ้าเป็นจริง | ผ่าน local/mock | 06b4698: retry chunk ครั้งเดียว/เงียบตอน unload · cross-browser รอบ 8 ก.ย. ค่ำ ดูหัวตาราง |
| E-02 | ไม่มี alert destination ใน workflow ใดเลย | 5 workflows | ทุกงาน scheduled ที่ล้มเปิด/อัปเดต GitHub Issue อัตโนมัติ (dedupe หนึ่ง issue ต่อ check) ไม่มี PII · ทดสอบด้วย dispatch | ผ่าน local/mock | 19f57e3: `scripts/ops-alert.mjs` ทุก scheduled workflow · dispatch จริงเพื่อดู Issue = รอเจ้าของ (ต้อง push) |
| E-03 | endpoint สาธารณะ 4 ตัวสูญ CORS header เมื่อ error ถูก throw จาก body guard (ลำดับ wrapper) | `_shared/db.ts:168-170` · usage/report-error/waitlist/delete-account | สลับลำดับ + edge test ว่า 413/400 มี CORS header | ผ่าน local/mock | 19f57e3 + edge test |
| E-04 | backup: AES-CBC ไม่มี MAC · ไม่มี decrypt-verify · ไม่มี restore script ใน active · ไม่รวม auth schema/roles | `backup.yml:36-42` | รูปแบบใหม่มี auth tag (AES-GCM) + verify ใน workflow + อ่านของเก่าได้ + สคริปต์ restore ลง isolated PG17 พร้อมผล | ผ่าน local/mock | 19f57e3: SOLOBAK1 AES-GCM + decrypt-verify ใน workflow + roles/auth data + `docs/backup-restore.md` · offsite/S3 = รอปลายทางจากเจ้าของ |
| E-05 | operations.yml ต่อฐานด้วย `postgres` เต็มสิทธิ์ ใช้ secret เดียวกับ backup | `supabase/migrations/0013_operations_role.sql` · `tests/sql/operations_role.sql` · `scripts/check-operations.sql` | บทบาทที่งานตรวจใช้ต้องนับได้ครบ แต่อ่านตารางตรง ๆ และเขียนไม่ได้ | **โค้ดเสร็จ ผ่าน PG17** · เหลือเจ้าของตั้งรหัสผ่าน+secret | เลือกทางฟังก์ชัน `operations_snapshot()` แทนการ grant select เพราะ RLS จะทำให้บทบาทสิทธิ์ต่ำนับได้ 0 เสมอ และการตรวจจะเขียวตลอดโดยไม่มีความหมาย · ขั้นตอนสลับอยู่ใน `docs/incident-runbook.md` ข้อ 5.1 |
| E-06 | rate limit 500 เมื่อไม่มี IP header · fixed window burst 2× | `db.ts:108` | fail-closed เป็น 429/403 ที่สะอาด + test | ผ่าน local/mock | 19f57e3: 403 + edge test · fixed-window burst ยังเป็นข้อจำกัดที่ยอมรับ |
| E-07 | `quality-scheduled.yml` ไม่มี retention-days · PROJECT_REF ซ้ำสองไฟล์ | — | แก้ | ปิดแล้ว | 19f57e3: retention 14 วัน · PROJECT_REF ยังซ้ำสองไฟล์โดยตั้งใจ (ไม่มี shared env ใน workflow) |
| E-08 | CSP/security headers บน GitHub Pages · clickjacking | ตรวจ response จริงของ `tasachii.github.io/solo-tutor` แล้ว · `index.html` (meta CSP + `referrer: no-referrer`) · `src/main.tsx:37–42` ปฏิเสธการเรนเดอร์ในเฟรม | meta CSP ทำงานจริงและแอปไม่พัง · ฝังในเฟรมแล้วไม่แสดงข้อมูลบัญชี | **ผ่าน** | `frame-ancestors` และ `X-Frame-Options` ตั้งไม่ได้บน Pages จึงใช้การปฏิเสธเรนเดอร์ในเฟรมแทน · เพิ่ม `no-referrer` เพราะ token ของเอกสารอยู่ใน URL |
| E-09 | known-good versions + rollback runbook (frontend/Edge/DB forward-fix) | ยังไม่มี | `docs/incident-runbook.md` ทดสอบ rollback Edge Function หนึ่งครั้งแบบไม่มีผลข้างเคียง | ผ่าน local/mock | `docs/incident-runbook.md` (triage/containment/rollback สามชั้น/หลังเหตุการณ์) · ซ้อม rollback Edge จริง = รอเจ้าของ |
| E-10 | โฟลเดอร์ `supabase/functions/omise-*` ว่างค้างใน active tree | — | ลบโฟลเดอร์ว่าง (ไม่แตะ archive) | ปิดแล้ว | ไม่มีโฟลเดอร์ omise-* ใน active tree แล้ว |
| E-11 | Supabase Free quota (invocation/egress/storage) | — | วัดจาก dashboard/API แบบ read-only บันทึกไว้ | ยังไม่ได้ตรวจ | |

## F. Onboarding, support, มือถือ, pilot

| ID | ปัญหา | หลักฐาน / ไฟล์ | เกณฑ์ผ่าน | สถานะ | ผล/ข้อค้าง |
|---|---|---|---|---|---|
| F-01 | help/contact กดได้จริง | `Help.tsx` ใช้ `VITE_SUPPORT_CONTACT` (ตั้งแล้ว) | ตรวจบนเว็บจริง | ยังไม่ได้ตรวจ | |
| F-02 | มือถือจำลอง iOS/Android: keyboard, ชื่อไทยยาว, safe area, import/export, offline | cross-browser suites ผ่าน (ยกเว้น E-01) | ระบุชัดว่าเป็น emulation | ผ่าน local/mock | เครื่องจริง = รอเจ้าของ |
| F-03 | critical loop บนเว็บจริง (headless) | `.omx/evidence/live/check.mjs` | รันบน SHA ที่ deploy รอบนี้ | ยังไม่ได้ตรวจ (รอบนี้) | |
| F-04 | pilot จริง / เครื่องจริง | — | เจ้าของ | รอข้อมูลเจ้าของ | |

## พักไว้ (ไม่แตะ)

- Omise ทั้งชุด `.omx/deferred-omise/2026-09-08/` — ไม่ deploy ไม่ตั้ง secret ไม่รวม migration 0011/0014
- มัดจำ 100 บาท — ไม่มีในโค้ด ไม่สร้าง

## G. แท็บค้างจ่ายและการบ้านบนหน้าแอดมิน (เพิ่ม 8 ก.ย. ค่ำ ตามคำขอเจ้าของ)

| ID | งาน | หลักฐาน / ไฟล์ | เกณฑ์ผ่าน | สถานะ | ผล/ข้อค้าง |
|---|---|---|---|---|---|
| G-01 | แท็บ **ค้างจ่าย**: บิลค้างทุกใบ เรียงวันค้าง ขั้นแจ้งยอด ร่างรอส่ง แจ้งยอดล่าสุด สถานะเชื่อม OA ต่อผู้ปกครอง | `src/core/collections.ts` · `src/app/AdminCollect.tsx` · unit `collections.test.ts` · e2e `admin-collect-homework.spec.ts` | ตัวเลขทุกตัวจาก ledger ตรงกับ `balanceDue`/`daysOverdue`/`ladderFor` | ผ่าน local/mock | ชื่อแท็บ "ค้างจ่าย" ไม่ใช่ "ทวงเงิน" ตาม Solo-Master §3/§12 |
| G-02 | **เตือนยอดสั้น** (message kind `nudge`) วันละใบต่อบิล ถอนเองเมื่อจ่ายครบ นับเป็นข้อความการเงิน | `nudgeInvoice` ใน `store.tsx` · validation/`isFinancialMessage` | dedupe ต่อวัน · ปฏิเสธบิล draft/paid · backup กู้กลับครบ | ผ่าน local/mock | |
| G-03 | **ส่งแจ้งยอดทั้งชุดผ่าน LINE OA** ทีละใบ ข้ามคนที่ยังไม่เชื่อมพร้อมเหตุผล ใช้ `oaSend.ts` ชุดเดียวกับการ์ด | `src/app/oaSend.ts` · unit `oa-send.test.ts` · e2e mock `line-oa.spec.ts` (เทสที่ 4) | ไม่มี enqueue ซ้ำ, oaStart ก่อนออกเครือข่าย, pending/review แยกจาก sent, หยุดทั้งชุดเมื่อ session/บัญชีผิด | ผ่าน local/mock | **ส่งถึงโทรศัพท์จริง = รอเจ้าของ (C-03)** · ไม่มี cron/ส่งอัตโนมัติตามเวลา (จุดยืน "ครูกดส่ง" คงเดิม) |
| G-04 | **การบ้าน** ledger (`AppState.homework` optional) มอบหมายหลายคน/กำหนดส่ง/ได้รับแล้ว/ลบ + ข้อความ `homework` | `src/core/homework.ts` · `AdminHomework.tsx` · unit `homework-ledger.test.ts` · validation ผูกกับนักเรียน/ผู้จ่าย | ไฟล์เก่าไม่มี homework เปิดได้ · backup/cloud sync รวม homework · ลบนักเรียนล้างการบ้าน | ผ่าน local/mock | Solo-Master §5/§17 จัดเป็นฟีเจอร์นอกแกน "ออกบิลและจัดการเงิน" — เจ้าของขอเพิ่ม 8 ก.ย.; แนะนำไม่ใส่ในเรื่องเล่าหลักบนเวที |
| G-05 | **เตือนการบ้าน** (`homework_reminder`) derive เมื่อเลยกำหนด ถอนเมื่อได้รับแล้ว เตือนซ้ำด้วยมือวันละใบ template ทุกอาชีพ | `deriveDrafts`/`stillStands` ใน `messages.ts` · template `homeworkAssign`/`homeworkReminder` | ไม่มีคำต้องห้าม/ตัวแปรค้าง · จำนวนวันสะกิดตามวัน · นักเรียนหยุดเรียนไม่ถูกเตือน | ผ่าน local/mock | |
| G-06 | ชุดเดโม default มีการบ้าน 2 รายการโดยไม่เพิ่มร่าง (badge ยัง 3) | `scenarios.ts` · e2e demo-flow ผ่าน | เทสเดิมทุกตัวยังผ่าน | ผ่าน local/mock | |

## H. หน้าแรก: เดโมก่อน + เข้าสู่ระบบ/สมัคร เป็นประตูที่สอง (เพิ่ม 8 ก.ย. ค่ำ ตามคำขอเจ้าของ)

| ID | งาน | หลักฐาน / ไฟล์ | เกณฑ์ผ่าน | สถานะ | ผล/ข้อค้าง |
|---|---|---|---|---|---|
| H-01 | ลิงก์ **เข้าสู่ระบบ** บนแถบบนหน้าแรก · hero ยังมีทางเข้าเดียวคือเดโม | `Landing.tsx` · e2e `login.spec.ts` (เทส 1) + `demo-flow.spec.ts` เดิม | ไม่มีฟอร์มขวางเดโม · privacy copy "ไม่ต้องสมัคร" ไม่เปลี่ยน | ผ่าน local/mock | ตาม Solo-Master §11: signup ไม่ใช่ yes ที่นับ — ไม่เล่าเป็นผู้ใช้จริงบนเวที |
| H-02 | หน้า `/login` สมัคร/เข้าสู่ระบบ → เริ่มโหมดจริง → รอผลคลาวด์ก่อนเข้าแอป (synced→today · conflict/locked→บัญชีครู · error→ปุ่มเข้าแอป) | `platform/Login.tsx` · `AuthForm` (`initialMode`) · route ห่อ `CloudSyncProvider` | ครูเปลี่ยนเครื่องได้ข้อมูลเดิม ไม่ผ่าน onboarding และไม่ push ทับคลาวด์ · ครูใหม่ไป onboarding โดยไม่มีข้อมูลเดโมหลุด | ผ่าน local/mock | **Supabase Auth "Confirm email" ต้องปิด** ไม่งั้นสมัครแล้วไม่ได้ session (รอเจ้าของตรวจใน Dashboard) |
| H-03 | Onboarding กันกรอกทับข้อมูลที่กำลังดึงจากคลาวด์ (ปิดปุ่มระหว่าง syncing · เด้ง today เมื่อ pull เสร็จ) | `Onboarding.tsx` (`cloudPulling`) | เทส H-02 ผ่านโดยไม่เห็น onboarding | ผ่าน local/mock | |
| H-04 | ครูโหมดจริงที่ onboarded แล้วเปิด `/` → `/app/today` · `?stay=1` ดูหน้าขาย · ลิงก์กลับหน้าแรกทุกหน้าใช้ `?stay=1` | `core/entry.ts` · unit `entry.test.ts` · e2e `login.spec.ts` (เทส 2) · `pwa.spec.ts` เดิม | เดโมไม่ถูกเด้ง · standalone เหมือนเดิม | ผ่าน local/mock | |

## I. ปรับตามแผน plan_solo.md (8 ก.ย. ดึก)

| ID | งาน | หลักฐาน / ไฟล์ | เกณฑ์ผ่าน | สถานะ | ผล/ข้อค้าง |
|---|---|---|---|---|---|
| I-01 | สลับลำดับตั้งค่า LINE: บันทึก credential ในแอปก่อน แล้วค่อยกด Verify | `supabase/functions/line-webhook/index.ts:53–62` (ตรวจลายเซ็นด้วย secret ที่เก็บในฐาน) · `docs/owner-setup.md` ข้อ 2 | ลำดับในเอกสารตรงกับพฤติกรรมจริงของ webhook | แก้เอกสารแล้ว | **ยังไม่ได้ลองบน LINE Console จริง** — เจ้าของยืนยัน |
| I-02 | แก้คำกล่าวอ้างที่เกินหลักฐานในคู่มือเจ้าของ | run 34219854721 / 34224331395 · `scripts/check-backup-freshness.mjs` | ไม่มีประโยคที่อ้างเกินสิ่งที่พิสูจน์ได้ | ผ่าน (เอกสาร) | Uptime เคยผ่านแล้ว · RPO 24 ชม. ยังไม่รับประกันเพราะตัวเตือนยอม 48 ชม. |
| I-03 | ตัวนับ traction ไม่ถูกทำให้พองจาก restore/import/cloud pull | `src/App.tsx` · `src/core/store.tsx` · unit tests | restore สมุดบัญชีที่มีบิลจำนวนมากต้องไม่ยิง `invoice_issued` และการกระทำจริงถัดไปยังนับ delta ถูก | ผ่าน local | เดิมนับจากส่วนต่างความยาว array |
| I-04 | ~~ลิงก์เอกสารผู้ปกครองยังไม่ปลอดภัยพอสำหรับข้อมูลจริง~~ **ทำแล้วใน J-04** | `src/core/documents.ts:56` (base64url ไม่ใช่การเข้ารหัส) | ต้องมีการตรวจความแท้ วันหมดอายุ และการเพิกถอน | **ยังไม่ทำ (P02)** | ห้ามอ้างว่าลิงก์ปลอดภัย · สำเนาที่ผู้รับดาวน์โหลดไปแล้วเรียกคืนไม่ได้ ห้ามสัญญาว่าลบให้หมดได้ |

## J. งานจากแผน plan_solo.md (8 ก.ย. ดึก) — P01, P02, P06, P08, E-05

| ID | งาน | หลักฐาน / ไฟล์ | เกณฑ์ผ่าน | สถานะ | ผล/ข้อค้าง |
|---|---|---|---|---|---|
| J-01 (P01) | แยกที่เก็บเดโมกับสมุดจริงเป็นคนละช่อง มี write lock ของตัวเอง | `src/core/workspace.ts` · `src/core/store.tsx` · `tests/unit/workspace-slots.test.tsx` (24) · `tests/e2e/workspace-isolation.spec.ts` | รีเซ็ตเดโมไม่แตะสมุดจริง (นับแถวและ hash) · เดโม→จริง→เดโม ได้ของเดิมคืน · เครื่องเก่าย้ายข้อมูลถูกช่อง · สองแท็บคนละโหมดไม่ทับกัน | ผ่าน local | **แก้บั๊กที่มีอยู่จริงบนเว็บ**: กดกลับไปโหมดเดโมเคยเขียนทับสมุดจริงของครู |
| J-02 (P01) | ลบบัญชีถูกกันไว้ที่ขั้นก่อนแตะเซิร์ฟเวอร์ ไม่ใช่หลังลบไปแล้ว | `prepareAccountDeletion` ใน `store.tsx` | ครูในโหมดเดโมไม่มีทางลบบัญชีบนเซิร์ฟเวอร์ทิ้งแล้วค้างครึ่งทาง และมีทางออกบนหน้าจอ | ผ่าน local | เดิมตัวกันอยู่หลังลบเซิร์ฟเวอร์แล้ว |
| J-03 (P01) | สถานะสิทธิ์เขียนแสดงทุกหน้า | `AppShell.tsx` · `StorageStatus` | แท็บที่ยังไม่ได้สิทธิ์เห็นการ์ดบอกเหตุผล ไม่ใช่ปุ่มกดแล้วเงียบ | ผ่าน local | เดิมแสดงเฉพาะตอนเปิดไฟล์ข้อมูลไม่ได้ |
| J-04 (P02) | ลิงก์เอกสารผู้ปกครองเข้ารหัสฝั่งครู มีวันหมดอายุและปิดได้ | `0011_shared_documents.sql` · `src/core/documentShare.ts`, `documentPublish.ts`, `sharedDocumentApi.ts` · `SharedLinks.tsx` · `tests/sql/shared_documents.sql` + 4 ไฟล์ unit + e2e | ปลอมแปลง/เดา token/หมดอายุ/ถูกปิด/ข้ามครู ต้องเปิดไม่ได้ · กุญแจไม่ปรากฏใน URL, body หรือ header ของ request ใด | ผ่าน local/mock | เซิร์ฟเวอร์ถอดรหัสไม่ได้ · **ปิดลิงก์หยุดได้แค่การเปิดครั้งต่อไป สำเนาที่โหลดไปแล้วเรียกคืนไม่ได้ ห้ามสัญญาเป็นอื่น** |
| J-05 (P02) | ส่ง/คัดลอกทุกทางผ่านการเผยแพร่ชุดเดียวกัน และเขียนลิงก์กลับเข้าร่าง | `Admin.tsx` · `oaSend.ts` · `tests/unit/shared-document-send.test.tsx` | เผยแพร่ล้ม/ยังไม่เข้าสู่ระบบ/ลิงก์ถูกปิด = **ไม่ส่ง** พร้อมเหตุผลที่ทำต่อได้ · ข้อความที่เก็บกับเอกสารที่เผยแพร่เป็นสตริงเดียวกัน | ผ่าน local/mock | บิลหนึ่งใบได้ลิงก์เดียว ตราบที่ตัวเลขไม่เปลี่ยน |
| J-06 (P02) | บิลด์ที่ไม่มีโปรเจกต์ยังส่งลิงก์รุ่นเดิมได้ แต่ต้องประกาศ | `insecureNotice` · `tests/unit/insecure-link-notice.test.tsx` | ไม่มีการลดระดับเงียบ ๆ | ผ่าน local | มีโปรเจกต์แต่ยังไม่เข้าสู่ระบบ = หยุดส่ง ไม่ใช่ลดระดับ |
| J-07 (P08) | ชุด event ที่นับ funnel ได้จริง มี `event_id` กันซ้ำ แยกแกน demo/real และทีม | `0012_usage_events_v2.sql` · `src/core/usage.ts` · `supabase/functions/usage/` · unit + edge tests | reload ไม่เพิ่ม visitor · restore 20 บิลไม่สร้าง `invoice_issued` · หน้าเอกสารของผู้ปกครองไม่ยิงอะไรเลย | ผ่าน local | `signup_completed`/`email_verified` เขียนได้เฉพาะฝั่งเซิร์ฟเวอร์ · รายได้อ่านจากหลักฐานการเงิน ไม่ใช่ event จากเบราว์เซอร์ |
| J-08 (P06) | งานลบตามระยะเก็บ แยกสองชั้น | `0014_retention.sql` · `tests/sql/retention.sql` | ค่าเริ่มต้นนับอย่างเดียว · ไม่แตะสมุดครู บัญชีครู หลักฐานการเงิน · บิลอายุ 90 วันไม่ถูกกฎ 30 วันกวาด | ผ่าน PG17 | **ยังไม่ตั้งเวลาให้รันเอง** รอทีมยืนยันระยะเก็บและผู้เชี่ยวชาญตรวจ |
| J-09 (E-05) | บทบาทสิทธิ์ต่ำสำหรับงานตรวจระบบ | `0013_operations_role.sql` · `tests/sql/operations_role.sql` | นับได้ครบแต่ select ตารางตรง ๆ และเขียนไม่ได้ | ผ่าน PG17 | เลือกทางฟังก์ชันเพราะ grant select จะโดน RLS กรองจนนับได้ 0 และการตรวจจะเขียวตลอด |
| J-10 | ไมเกรชัน 0011–0014 **ยังไม่ apply ขึ้นฐานจริง** | — | ต้องเจ้าของสั่ง | **รอเจ้าของ** | ทดสอบครบบน PostgreSQL 17 ในเครื่องแล้ว |
| J-11 | RPC อ่านเอกสารแบบไม่ต้องเข้าสู่ระบบ ยังไม่มีตัวจำกัดอัตรา | `0015_shared_document_rate_limit.sql` · `tests/sql/shared_document_rate_limit.sql` | เปิดเอกสารได้ตามปกติ แต่ยิงเกินเพดานถูกปฏิเสธ · anon อ่านความลับสำหรับแฮชไม่ได้ | **ผ่าน PG17** | 60 ครั้ง/นาที/ผู้เรียก และ 1200 ครั้ง/นาทีรวม · แฮชหมายเลขเครือข่ายด้วยความลับในฐาน ไม่เก็บหมายเลขดิบ |
| J-12 | ที่มาของทราฟฟิกจากแคมเปญ (แผนข้อ 6.2) | — | ต้องมีรายการค่าที่อนุญาตก่อน | **ยังไม่ทำ** | แผนข้อ 6.5 ห้ามเก็บ UTM อิสระหรือ referrer เต็ม ไม่มี allowlist = คอลัมน์ที่ว่างตลอด |
| J-13 | การเผยแพร่ลิงก์ที่ล้มเหลวเคยปิดทางส่งบิลทั้งหมดบนเว็บจริง | `documentPublish.ts` (`publishBlocks`) · `tests/unit/insecure-link-notice.test.tsx` · `shared-document-send.test.tsx` | ครูโหมดจริงที่ไม่ได้สมัครบัญชี และฐานที่ยังไม่ได้ apply migration ต้องส่งบิลได้ตามปกติพร้อมคำประกาศ | **แก้แล้ว ตรวจบนเว็บจริง** | ตรวจเจอด้วยการเปิดเบราว์เซอร์กับเว็บจริง ไม่ใช่จากเทส · หยุดส่งเฉพาะ `failed`/`stale` เท่านั้น |
