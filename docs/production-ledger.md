# Production task ledger — Solo Tutor

เริ่ม 8 ก.ย. 2569 จาก baseline `2450bf4` · อัปเดตทุกครั้งที่สถานะเปลี่ยน · ID คงที่ อ้างใน commit ได้

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
| A-01 | นำเข้าไฟล์กุญแจกู้คืนที่ถูกต้อง แต่บัญชียังไม่มี snapshot บนคลาวด์ → แจ้งว่า "ไฟล์ใช้กับบัญชีนี้ไม่ได้" | `src/app/CloudSync.tsx` importRecovery คืน false เมื่อไม่มี head · `Account.tsx` แสดง recoveryInvalid | กุญแจถูกต้องถูกจดจำและซิงก์ต่อ พร้อม unit test | พบปัญหา | |
| A-02 | เกณฑ์ "เครื่องเปล่า" ของ sync (`hasLedgerData` 3 ตาราง) ต่างจาก store (`hasAccountLedgerData` 9 ตาราง) — เครื่องที่มีแค่ผู้จ่าย/การจ่าย/ข้อความถูกดึงคลาวด์ทับเงียบ | `src/core/cloudSync.ts:85` vs `src/core/store.tsx:39` | ใช้เกณฑ์เดียว + unit test ที่ mutant ตาย | พบปัญหา | |
| A-03 | สำเนาก่อนดึงคลาวด์ (pre-pull backup) เขียนแล้วไม่มีทางกู้คืนจาก UI ทั้งที่ข้อความสัญญาไว้ | `CloudSync.tsx:170` · `copy.account.useCloudConfirm` | มีปุ่มกู้สำเนาก่อนดึงในหน้าบัญชี + เทส | พบปัญหา | |
| A-04 | "ซิงก์ตอนนี้" กดได้บนแท็บอ่านอย่างเดียวแต่เงียบ | `Account.tsx:80` · `CloudSync.tsx:182` | ปุ่มปิด/บอกเหตุผลเมื่อไม่ writable | พบปัญหา | |
| A-05 | ส่งออกกุญแจเงียบเมื่อยังไม่มีกุญแจ · เลือกไฟล์แล้วยกเลิกเงียบ | `Account.tsx:41-62` | มีข้อความบอกทุกทาง | พบปัญหา | |
| A-06 | guard race (แก้ระหว่างรอเน็ต) และ account-switch มีโค้ดแต่ไม่มีเทสตรง | `CloudSync.tsx:81-107,132,163` | unit/integration test ที่พิสูจน์ทั้งสองทาง | พบปัญหา | |
| A-07 | reset รหัสผ่านไม่ได้ทำให้เปิดข้อมูลเก่า (กุญแจมาจากรหัสผ่านโดยตรง ไม่มี data key แยก) ทางกู้เดียวคือไฟล์กุญแจ | `cloudCrypto.ts:26-33` · `cloudKey.ts:10-16` · copy บอกตรงแล้ว | ข้อจำกัดถูกอธิบายในแอปและเอกสาร · flow ลืมรหัสผ่านต้องไม่เปิดจนกว่ามี recovery path ที่ทดสอบแล้ว | ผ่าน local/mock (เอกสาร) | crypto migration เป็นงานถัดไป ไม่ทำในรอบนี้ |
| A-08 | ทดสอบข้ามสอง browser contexts บนเว็บจริง (สมัคร → push → เครื่องใหม่ pull → แก้ → กลับมา) | สคริปต์ `.omx/evidence/live/check2.mjs` (รอบ 8 ก.ย. เช้าผ่าน) | รันซ้ำบน SHA ที่ deploy รอบนี้ | ยังไม่ได้ตรวจ (รอบนี้) | user ทดสอบลบผ่าน Admin API ทุกครั้ง |
| A-09 | restore backup ลง isolated DB ตรวจ RLS/decrypt | เฉพาะใน archive `.omx/deferred-production/root/restore-rehearsal.json` | มีสคริปต์ใน active tree และผลรันบน PG17 | พบปัญหา | ดู E-04 |
| A-10 | ข้อมูลที่ลบแล้วไม่กลับมาหลัง sync/restore (student erasure tombstone) | deferred `privacy-erasure` migration 0013 | ดู B-05 | รอ B-05 | |

## B. PDPA, export, erasure, DPA

| ID | ปัญหา | หลักฐาน / ไฟล์ | เกณฑ์ผ่าน | สถานะ | ผล/ข้อค้าง |
|---|---|---|---|---|---|
| B-01 | data inventory ครบ 8 ชุดข้อมูล พร้อม purpose/ผู้เข้าถึง/ที่เก็บ/encryption/retention/deletion/ข้อยกเว้น/ผู้รับผิดชอบ | `docs/legal-review-draft.md` มีตารางบางส่วน | เอกสาร `docs/data-inventory.md` ครบทุกคอลัมน์ ระบุ "รอเจ้าของ" ตรงที่ยังไม่มีข้อมูล | กำลังแก้ | |
| B-02 | privacy/terms ตรงกับที่โค้ดทำ (usage id, third parties, local plaintext/cloud ciphertext) | `src/copy/index.ts` legal block · `Legal.tsx` | ตรวจทีละข้อเทียบโค้ด แก้ที่ไม่ตรง | ยังไม่ได้ตรวจ | ถ้อยคำสัญญา = รอผู้เชี่ยวชาญ |
| B-03 | ปุ่ม export/delete ใช้ได้จริง · deletion free/paid ถูกต้อง · cross-account ถูกปฏิเสธ | edge `account-deletion.test.ts` · sql `account_deletion.sql` · e2e `account.spec.ts` | ผ่าน local/mock แล้ว · live ยังไม่ได้ทำรอบนี้ | ผ่าน local/mock | |
| B-04 | financial evidence แยกจาก identity หลังลบบัญชี · ไม่อ้าง anonymous | 0009/0010 + `payment_evidence.sql` | ผ่านแล้ว · เอกสารต้องไม่ใช้คำ anonymous | ผ่าน local/mock | |
| B-05 | student erasure ไม่กลับมาจาก stale device/backup (tombstone) | deferred patch ใช้ migration 0013 ชนเลข | รวมเป็น migration ใหม่เลขถัดไปแบบ additive + SQL/unit tests | ยังไม่ได้ตรวจ | ขนาดใหญ่ ทำหลัง A/E |
| B-06 | ช่องทางใช้สิทธิ + ผู้ตอบ + DPA + legal entity | — | เจ้าของ/ผู้เชี่ยวชาญ | รอข้อมูลเจ้าของ · รอผู้เชี่ยวชาญ | |

## C. LINE OA และหน้าผู้ปกครอง

| ID | ปัญหา | หลักฐาน / ไฟล์ | เกณฑ์ผ่าน | สถานะ | ผล/ข้อค้าง |
|---|---|---|---|---|---|
| C-01 | oversized webhook บน live timeout 20 s (local 413 ใน 0.015 s) สาเหตุไม่รู้ | pitch kit `webhook-transport-diagnostic.json` | probe ควบคุม ≤3 ครั้ง (ไม่มีข้อมูลจริง) แยก gateway/runtime + บันทึกผล | ยังไม่ได้ตรวจ | |
| C-02 | line-webhook อ่าน body + lookup ฐานก่อนตรวจลายเซ็น ไม่มี rate limit | `line-webhook/index.ts:14-57` | จำกัดต่อ IP/ต่อ destination ก่อน lookup โดยไม่ตัด LINE จริง + edge test | พบปัญหา | |
| C-03 | ส่งจริงถึงโทรศัพท์ทีมครบ flow (pair → send once → outbox) | ยังไม่มี | ต้อง Console session + โทรศัพท์ทีม + rotate secret/token | รอข้อมูลเจ้าของ | |
| C-04 | หน้าผู้ปกครองสาธารณะ: ไม่โชว์ banner/ปุ่ม export ของครู · ลิงก์ไม่เปิดข้อมูลคนอื่น · invalid/expired | `src/app/ClientPreview.tsx` · `documents.ts` | e2e ครอบ invalid/expired/cross-client | ยังไม่ได้ตรวจ | |
| C-05 | mock flow (signature/replay/pairing/concurrent) | edge 29 + mock e2e 42 ผ่าน | ผ่าน local/mock | ผ่าน local/mock | |

## D. PromptPay / manual Pro

| ID | ปัญหา | หลักฐาน / ไฟล์ | เกณฑ์ผ่าน | สถานะ | ผล/ข้อค้าง |
|---|---|---|---|---|---|
| D-01 | ราคาสามที่ (TS / SQL / e2e mock) ไม่มีเทสล็อกให้ตรงกัน | `plans.ts` · `0006:33-36` · `account.spec.ts:115` | unit test อ่าน SQL จริงเทียบ TS | พบปัญหา | |
| D-02 | `docs/plan-approval.md` ล้าสมัยและสั่งใช้ `approve_plan_request` เปล่าซึ่งห้ามแล้ว | `plan-approval.md:18-24,47` | เอกสารชี้ไป wrapper verified เท่านั้น | พบปัญหา | |
| D-03 | คำขอที่ถูกปฏิเสธหายเงียบ · โหลดประวัติล้มดูเหมือนไม่มี · copy `rejected/loadFailed` ไม่ถูกใช้ | `PlanCard.tsx:40-51,130` | แสดง rejected + error โหลด | พบปัญหา | |
| D-04 | พักแพ็กวันสุดท้ายหายทั้งที่ยัง Pro | `PlanCard.tsx:100` vs `plan.ts:38` | เงื่อนไขตรงกัน + unit | พบปัญหา | |
| D-05 | `revenue_monthly`/`scripts/paid-usage.sql` ยังรายงานยอดจาก approved ที่ไม่มี bank evidence โดยไม่ติดป้าย | `0010:166` · `paid-usage.sql:3` | ติดป้าย unverified หรือชี้ไป view ที่ verified | พบปัญหา | |
| D-06 | concurrent `approve_plan_request_verified` บน request เดียวกันไม่มีเทส | `test-db.sh` | เพิ่ม race test | พบปัญหา | |
| D-07 | ลำดับตรวจยอดหลัง mutate ใน wrapper (ปลอดภัยเพราะ rollback แต่เปราะ) | `0010:72-76` | migration ใหม่ย้ายการตรวจก่อน mutate (additive: create or replace) + test | พบปัญหา | |
| D-08 | refund ไม่แสดงฝั่งครู · ใบเสร็จค้างยอดเต็ม | ไม่มี read path | อย่างน้อยแสดง "มีการคืนเงิน" ในประวัติ | ยังไม่ได้ตรวจ | ทำหลัง D-01..07 |
| D-09 | PromptPay/ชื่อผู้ให้บริการจริง · ผู้ตรวจธนาคาร · เงื่อนไขคืนเงิน/ภาษี | ตัวแปร repo ว่าง | เจ้าของตั้ง `VITE_PROVIDER_LEGAL_NAME`, `VITE_SOLO_PROMPTPAY` แล้ว rerun deploy | รอข้อมูลเจ้าของ | |
| D-10 | เพดานฟรีบังคับฝั่ง client เท่านั้น (ledger เข้ารหัส server นับไม่ได้) | `core/plan.ts` | เขียนข้อจำกัดไว้ในโค้ดและเอกสาร ไม่ลดความเป็นส่วนตัว | กำลังแก้ (เอกสาร) | |

## E. Operations, security, backup

| ID | ปัญหา | หลักฐาน / ไฟล์ | เกณฑ์ผ่าน | สถานะ | ผล/ข้อค้าง |
|---|---|---|---|---|---|
| E-01 | e2e WebKit `qa-data-regressions` "Importing a module script failed" ตอน reload 2 ครั้งใน baseline | `.omx/evidence/baseline-*.log` | แยก flake/regression ด้วยรันซ้ำ 3 รอบ แล้วแก้ที่ต้นเหตุถ้าเป็นจริง | กำลังแก้ | |
| E-02 | ไม่มี alert destination ใน workflow ใดเลย | 5 workflows | ทุกงาน scheduled ที่ล้มเปิด/อัปเดต GitHub Issue อัตโนมัติ (dedupe หนึ่ง issue ต่อ check) ไม่มี PII · ทดสอบด้วย dispatch | พบปัญหา | ปลายทางอื่น (LINE/อีเมล) = รอเจ้าของ |
| E-03 | endpoint สาธารณะ 4 ตัวสูญ CORS header เมื่อ error ถูก throw จาก body guard (ลำดับ wrapper) | `_shared/db.ts:168-170` · usage/report-error/waitlist/delete-account | สลับลำดับ + edge test ว่า 413/400 มี CORS header | พบปัญหา | |
| E-04 | backup: AES-CBC ไม่มี MAC · ไม่มี decrypt-verify · ไม่มี restore script ใน active · ไม่รวม auth schema/roles | `backup.yml:36-42` | รูปแบบใหม่มี auth tag (AES-GCM) + verify ใน workflow + อ่านของเก่าได้ + สคริปต์ restore ลง isolated PG17 พร้อมผล | พบปัญหา | offsite = รอปลายทางจากเจ้าของ |
| E-05 | operations.yml ต่อฐานด้วย `postgres` เต็มสิทธิ์ ใช้ secret เดียวกับ backup | `operations.yml:43` | role อ่านอย่างเดียว | รอข้อมูลเจ้าของ (ต้องตั้ง secret ใหม่) | เตรียม migration role + คำสั่งให้ |
| E-06 | rate limit 500 เมื่อไม่มี IP header · fixed window burst 2× | `db.ts:108` | fail-closed เป็น 429/403 ที่สะอาด + test | พบปัญหา | |
| E-07 | `quality-scheduled.yml` ไม่มี retention-days · PROJECT_REF ซ้ำสองไฟล์ | — | แก้ | พบปัญหา | เล็ก |
| E-08 | CSP/security headers บน GitHub Pages (ตั้ง header ไม่ได้ ใช้ meta CSP ได้บางส่วน) · clickjacking | ยังไม่ได้ตรวจ response จริง | ตรวจจริง + meta CSP ที่ไม่พังแอป | ยังไม่ได้ตรวจ | |
| E-09 | known-good versions + rollback runbook (frontend/Edge/DB forward-fix) | ยังไม่มี | `docs/incident-runbook.md` ทดสอบ rollback Edge Function หนึ่งครั้งแบบไม่มีผลข้างเคียง | ยังไม่ได้ตรวจ | |
| E-10 | โฟลเดอร์ `supabase/functions/omise-*` ว่างค้างใน active tree | — | ลบโฟลเดอร์ว่าง (ไม่แตะ archive) | พบปัญหา | |
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
