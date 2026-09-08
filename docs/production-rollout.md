# นำชุด production hardening ขึ้นระบบ

เอกสารนี้เป็น runbook สำหรับตรวจซ้ำ/ติดตั้งใหม่ ชุด migrations 0007–0010 และ 4 Edge Functions ถูกนำขึ้นโปรเจกต์ Solo Tutor แล้วในรอบต่อมา ดู launch-status.md สำหรับหลักฐาน ใช้ migration ตามลำดับ และรักษา backup ก่อนเปลี่ยนฐานข้อมูล

## ทดสอบในเครื่องด้วย mock

```sh
npm ci
npm run check
npm test
npm run test:db
npm run test:edge
SOLO_QA_PORT=4291 SOLO_CROSS_BROWSER=1 npm run e2e
SOLO_QA_PORT=4292 SOLO_CROSS_BROWSER=1 npm run e2e:mock
```

Docker ต้องเปิดสำหรับ PostgreSQL/Deno; Playwright ต้องติดตั้ง Chromium/WebKit (`npx playwright install chromium webkit`) ห้ามรัน build/สอง E2E jobs ที่เขียน `dist` พร้อมกันใน checkout เดียว รายงานจะอยู่ `playwright-report` และ `test-results`; เก็บสำเนาก่อนเริ่มรอบถัดไป

`e2e:mock` ใส่ Supabase URL/key ปลอม, support `.test`, ชื่อผู้ให้บริการ QA และพร้อมเพย์สมมติ เฉพาะ process ทดสอบ ทุก API ใน suite ถูก intercept ผลไม่พิสูจน์ gateway/LINE/SMTP จริง ห้ามนำ `dist` จากคำสั่งนี้ไปเผยแพร่ CI สร้าง frontend ใหม่ด้วยค่าจริงหลังสอง jobs ผ่าน

สร้างคู่มือใหม่เมื่อข้อความ Help เปลี่ยน:

```sh
node --experimental-strip-types scripts/build-guide.mjs
```

## สิ่งที่เจ้าของต้องเตรียม

| ค่า/เรื่อง | ที่ใช้ | หมายเหตุ |
|---|---|---|
| `VITE_SUPPORT_CONTACT` | build | email, HTTPS contact หรือ LINE ID จริง มีคนรับผิดชอบ |
| `VITE_PROVIDER_LEGAL_NAME` | build | ชื่อผู้ให้บริการตามจริงสำหรับแสดงข้อมูลและใบเสร็จ |
| `VITE_SOLO_PROMPTPAY` | build | บัญชีรับเงินค่าสมาชิกของ Solo Tutor แยกจากบัญชีรับค่าเรียนของครู |
| `VITE_BASE_PATH` | build | `/` สำหรับ dedicated site หรือ `/solo-tutor/` สำหรับ Pages เดิม |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | build | publishable key ไม่ใช่ service-role secret |
| `PUBLIC_RATE_LIMIT_SECRET` | Supabase Edge secret เท่านั้น | สุ่มอย่างน้อย 32 ตัวอักษร ห้าม `VITE_` หรือ commit |
| `LINE_ALLOWED_ORIGIN` | Supabase Edge | origin ของ frontend จริงตรงตัว ไม่มี path; Origin ไม่ใช่ตัวพิสูจน์ตัวตน |
| SMTP และ email confirmation | Supabase Auth | verify email/redirect/expiry/delivery จริงก่อน onboarding คนแรก; ยังไม่เปิด reset จนทดสอบกุญแจกู้คืนครบ |
| OA/channel จริง | LINE Developers | เจ้าของตั้งค่า webhook/secret/quota และทดสอบครูกดยืนยันส่ง; อย่าใช้ข้อมูลเด็กจริงในการ QA |
| นโยบาย/คืนเงิน/retention | ผู้ให้บริการ | ใช้ `legal-review-draft.md` ให้ผู้เชี่ยวชาญตรวจ |

ค่าธุรกิจไม่ครบ frontend จะซ่อนคำขอ Pro และแสดงข้อจำกัด การผ่าน validator รูปแบบไม่ได้ตรวจว่าบัญชีรับเงินจริง/ช่องทางติดต่อมีเจ้าของจริง

## ลำดับ backend

1. สำรองฐานข้อมูลและซ้อม restore ลงฐานแยก เก็บ encrypted backup และ passphrase คนละสิทธิ์ ไม่วาง passphrase ใน log
2. ตรวจ duplicate pending ก่อน migration 0007:

   ```sql
   select provider_id, count(*) from public.plan_requests
   where status = 'pending' group by provider_id having count(*) > 1;
   ```

   หากมี ต้องตรวจรายการธุรกิจและ reconcile ตามหลักฐาน ไม่ลบแถวอัตโนมัติ migration ตั้งใจ fail ถ้ายังซ้ำ
3. Apply `0007_production_safety.sql` → `0008_account_deletion.sql` → `0009_paid_account_erasure.sql` → `0010_payment_evidence.sql` ก่อน deploy handlers รุ่นใหม่ ห้ามแก้ migration 0001–0006 ที่ขึ้นไปแล้ว
4. ตั้ง Edge secret limiter แล้ว deploy `waitlist`, `report-error`, `usage`, `delete-account` รุ่นนี้ตาม config `verify_jwt=false`; บัญชีลบ verify bearer ผ่าน `auth.getUser` และ reauthenticate password ภายใน handler เอง
5. ตรวจ request จาก browser origin จริง, ไม่มี Origin/foreign Origin ต้อง403, payload เกินต้อง413, authenticated identity ต้องไม่อ่านจาก JSON; ตรวจขีดจำกัด/429 ใน staging ไม่ยิงถม production
6. ตรวจ header IP ที่ infrastructure ส่งให้จริงและไม่รับ client spoof เป็น trusted identity; global cap ต้องยังทำงานแม้ client identity เปลี่ยน ห้ามอ้างว่า CORS หยุด curl ได้
7. migration 0009 ให้ลบ paid account ได้โดย detach approved receipt ก่อน cascade; 0010 เก็บหลักฐานตรวจโอน/คืนเงินแยกไว้ ทั้งคู่ยังต้องใช้นโยบาย retention และสิทธิ์เข้าถึงที่ตรวจแล้ว

## Frontend และ hosting

1. กำหนด domain/base/redirect และนโยบายรักษาลิงก์บิลเก่า หากย้าย domain ต้องมี redirect ระยะยาวตามที่ประกาศ ไม่ลบ host เดิมทันที
   ใช้ dedicated origin ก่อนเก็บข้อมูลครูจริง เพราะ sibling projects บน `tasachii.github.io` อ่าน localStorage ของกันและกันได้ ไม่ใช่ isolation ตาม path การย้ายต้องสำรอง/import ผ่านการยืนยันของครูและหมุน session; อย่าคัดลอก raw key/token ผ่าน query string
2. Build ด้วยค่าจริงและตรวจว่าไม่มี `line-qa.supabase.co` หรือ `ข้อมูลสมมติ` ในค่า business config ที่ส่งจริง (ข้อความ Demo ในตัวแอปต้องยังอยู่)
3. build สร้าง `_headers` สำหรับ host ที่รองรับ ส่วน CSP meta ใน GitHub Pages บังคับได้เฉพาะ directives ที่รองรับ ต้องตั้ง HTTP `Content-Security-Policy` ที่มี `frame-ancestors 'none'` บน host/proxy ที่ตั้ง header ได้ โค้ดกัน render ใน iframe เป็น defense เสริม
4. Smoke test assets, fonts, PDF, routing, mobile/WebKit, fresh install offline และ upgrade จาก SW รุ่นก่อน ตรวจไม่มี CSP violation กับ API ที่เปิดใช้งานจริง
   build สร้าง release hash และ integrity asset list ใน `sw.js` ให้อัตโนมัติจากไฟล์ทั้งหมด ห้ามคัดลอก `public/sw.js` ที่ยังเป็น template ไป deploy โดยตรง; worker ใหม่รอแท็บเก่าปิดก่อน activate
5. ทดสอบ account login/sync/logout/recovery ข้ามสอง browser profiles ด้วยข้อมูลสมมติ และเริ่มรับเงินจริงหลัง checklist เจ้าของครบ

## Operations และ backup

- ติดตั้งงาน housekeeping บน Supabase ด้วย `scripts/install-rate-cleanup.sql` เพื่อให้ rate buckets หมดอายุทุกชั่วโมงแม้ GitHub Actions หยุดทำงาน งานนี้เรียกเฉพาะ cleanup ของ counter เกิน2ชั่วโมง ไม่ลบข้อมูลครู/การเงิน ตรวจ `cron.job` และประวัติ `cron.job_run_details` ตาม [Supabase Cron](https://supabase.com/docs/guides/cron/quickstart)
- งาน operations ใน GitHub ยังคงจำเป็นต่อการเห็น error/งานค้างและ backup freshness; server cron ไม่ใช่ตัวแทนการส่งแจ้งเตือนให้มนุษย์


- `.github/workflows/operations.yml` ล้างเฉพาะ rate buckets เก่ากว่า2ชั่วโมง แล้วอ่านยอด error/งานค้างผ่าน SQL read-only; ขั้นสุดท้ายตรวจ backup success ไม่เกิน 8 วันด้วย `if: always()` แม้ขั้นก่อนล้ม หากผิด threshold workflow ล้ม ใช้ notification ของ Actions ตามการตั้งค่าผู้ดูแล
- เลือก Watch/Actions notification และทดสอบ failure ใน staging ให้ผู้รับผิดชอบเห็นจริง Scheduled Actions อาจล่าช้าและ public repository ที่ไม่มี activity อาจถูกหยุด schedule จึงไม่ใช่ pager ที่รับประกัน SLA
- ปัจจุบันใช้ DB password เดียวกับ backup เพราะมีอยู่แล้ว ควรเปลี่ยน monitoring เป็น role อ่านอย่างเดียวและให้ maintenance role เรียกเฉพาะ cleanup RPC เมื่อเตรียม credential แยกได้ ห้ามใส่ password ใน args ที่ log ออก
- `scripts/paid-usage.sql` เป็นข้อมูลปฏิบัติการเดิม; ใช้ `scripts/pitch-metrics.sql` สำหรับยอดมีหลักฐานตรวจธนาคารเท่านั้น ไม่เปิด view ให้ authenticated/anon
- Backup workflow รายสัปดาห์และ artifact90วันยังเป็น single-account dependency ต้องเพิ่มพื้นที่เก็บอิสระและสิทธิ์เข้าถึงกุญแจนอก GitHub; ไม่มี PITR ในชุดนี้
- Restore: restore schema/data ลงฐานแยกก่อน, ตรวจ migrations/RLS/row counts, ทดสอบ decrypt ด้วยบัญชีสมมติและไฟล์กู้คืน, ตรวจ suppression/คำขอลบที่เกิดหลัง backup, ค่อยวางแผนสลับระบบ ไม่ restore ทับ production เพียงเพราะ dump command สำเร็จ
- เก็บ audit ผู้อนุมัติยอด/เวลาตรวจ/เหตุผลคืนเงินตามนโยบายจริงที่เลือก ระบบ SQL อนุมัติมือยังต้องคนตรวจรายการเข้า ไม่ใช้ mock receipt ยืนยันยอดธนาคาร

## หยุด rollout เมื่อ

- migration fail, duplicate pending ยังไม่ reconcile, secret ขาด หรือ test หลักไม่ผ่าน
- ไม่มีช่องทางติดต่อ/ผู้รับผิดชอบ/นโยบายที่ตรวจแล้ว หรือ SMTP ยังใช้กับผู้ใช้จริงไม่ได้
- restore/decrypt/recovery ไม่ผ่าน, บัญชี A อ่าน/เขียนทับ B ได้ หรือ browser ที่เสีย lock ยังยืนยันการเงินได้
- ตรวจยอดรับจริงไม่ตรงกับใบเสร็จ/สิทธิ์, ไม่ทราบวิธียกเลิกและคืนเงิน, หรือกำลังจะเผยแพร่ build ที่ตั้งค่า QA
