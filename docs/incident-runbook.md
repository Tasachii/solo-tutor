# Incident runbook — Solo Tutor

อัปเดต 8 กันยายน 2569 · สำหรับคนที่ต้องแก้เมื่อระบบมีปัญหา ไม่ต้องเป็นคนเขียนโค้ด

ระบบมี 3 ชั้นที่แยกกัน: **หน้าเว็บ** (GitHub Pages, static) · **หลังบ้าน** (Supabase Free สิงคโปร์: Postgres + Auth + Edge Functions 7 ตัว) · **LINE** (OA ของครูแต่ละคน ผ่าน Messaging API) ข้อมูลหลักของครูอยู่ในเบราว์เซอร์ของครูเอง หลังบ้านล่มครูยังเช็คชื่อ/ออกบิล/ส่งด้วย share-link ได้ ที่หยุดคือ login, cloud sync, LINE OA, ขอ Pro

## 0. รู้ได้ยังไงว่ามีปัญหา

| สัญญาณ | มาจาก | ความหมาย |
|---|---|---|
| GitHub Issue ป้าย `ops-alert` ชื่อ `[ops] uptime ล้ม` | `uptime.yml` ทุก 6 ชม. | หน้าเว็บไม่ตอบ 200 หรือ Edge Function ไม่ตอบตามสัญญา |
| `[ops] operations ล้ม` | `operations.yml` ทุกชั่วโมง | มี error จากเครื่องครูค้าง, คำขอ Pro ค้างเกิน 24 ชม., outbox LINE ต้องคนดู, backup เก่าเกิน 8 วัน |
| `[ops] backup ล้ม` | `backup.yml` รายสัปดาห์ | dump/เข้ารหัส/ตรวจกลับล้ม → ไม่มีสำเนาสัปดาห์นี้ |
| `[ops] quality ล้ม` | `quality-scheduled.yml` รายสัปดาห์ | dependency audit หรือ browser suite ล้ม (ไม่กระทบผู้ใช้ทันที) |
| ครูรายงานเอง | ช่องทาง `VITE_SUPPORT_CONTACT` (LINE OA Solo Tutor) | ถามให้ได้: หน้าไหน · โหมดเดโมหรือจริง · ข้อความ error · เวลา |

รายละเอียดใน run log ไม่มีชื่อเด็ก/ยอดเงิน ถ้าต้องดูข้อมูลจริงให้ใช้ Supabase Dashboard ด้วยบัญชีเจ้าของเท่านั้น

## 1. Triage ใน 10 นาที

1. เปิด https://tasachii.github.io/solo-tutor/ — โหลดได้ไหม เดโมเช็คชื่อได้ไหม (ถ้าได้ = หน้าเว็บโอเค ปัญหาอยู่หลังบ้าน)
2. Supabase Dashboard → Project → **Project Status / Edge Functions → Logs** ดู 5xx/timeout 15 นาทีล่าสุด
3. https://status.supabase.com — ถ้าผู้ให้บริการล่ม เราแก้อะไรไม่ได้ แจ้งครูว่า "ยังใช้ในเครื่องได้ ซิงก์/LINE OA จะกลับมาเอง"
4. จัดระดับ:
   - **P1** ข้อมูลครูเสียหาย/ส่งข้อความผิดคน/token หลุด → หยุด onboarding ทันที ทำข้อ 2 ก่อน
   - **P2** login/sync/LINE OA/ขอ Pro ใช้ไม่ได้ แต่แอปในเครื่องปกติ
   - **P3** งาน scheduled ล้ม ผู้ใช้ไม่กระทบ
5. จดเวลาที่เริ่ม เวลาที่รู้ และสิ่งที่ทำ ลงใน Issue เดียวกับ alert (ไม่ใส่ข้อมูลส่วนบุคคล)

## 2. Containment (P1)

| กรณี | ทำทันที |
|---|---|
| สงสัย LINE channel secret/token หลุด | LINE Developers → channel → **Issue** token ใหม่ (ค่าเดิมหมดอายุ) → ครูเจ้าของ OA กรอกใหม่ในแอป (เมนู → เชื่อม LINE OA) · ถ้าแยกไม่ได้ว่าของใคร: ในแอปกด **ยกเลิกการเชื่อม OA** (ล้าง credential ในฐานและหยุดคิว) |
| สงสัย `LINE_SECRET_KEY` (กุญแจเข้ารหัส credential ในฐาน) หลุด | ตั้งค่าใหม่ใน Supabase → Edge Functions → Secrets แล้วให้ทุกครูเชื่อม OA ใหม่ (ค่าเดิมถอดไม่ได้อีก — นี่คือพฤติกรรมที่ต้องการ) · ดู `docs/line-oa-setup.md` |
| สงสัย `SUPABASE_DB_PASSWORD` / `BACKUP_PASSPHRASE` หลุด | Supabase → Settings → Database → reset password → อัปเดต GitHub Secret ชื่อเดียวกัน · passphrase ใหม่ = สำเนาเก่าต้องเก็บ passphrase เก่าไว้ต่างหากจึงจะเปิดได้ |
| service_role key หลุด | Supabase → Settings → API → rotate · Edge Functions ใช้ค่าที่ runtime จัดให้ ไม่ต้อง deploy ใหม่ · ตรวจว่าไม่มีที่ไหน hardcode |
| ส่งข้อความผิดคน | หยุดคิว: SQL `update public.message_outbox set status='manual_review', error='incident' where status='queued';` (service_role) · เก็บ `id`/เวลา/ผู้รับ ไม่เก็บเนื้อหา · แจ้งครูเจ้าของ OA ให้ติดต่อผู้ปกครอง |
| ข้อมูลครูหาย/เพี้ยน | อย่าแตะฐาน — ครูมีสำเนาในเครื่อง (`solo-demo-v3`, `-before-restore`) และไฟล์ JSON · cloud snapshot กู้ด้วยรหัสผ่าน/กุญแจของครูเท่านั้น เราถอดไม่ได้ |

## 3. Rollback

### หน้าเว็บ (GitHub Pages)
```sh
git log --oneline -10                       # หา commit ที่รู้ว่าดี (known-good)
git revert <bad-commit>                     # ห้าม force-push main
git push origin main                        # Verify and deploy รันเทสทั้งชุดแล้ว deploy ให้เอง (~10 นาที)
```
ระหว่างรอ ครูที่เปิดแอปค้างอยู่ยังใช้ build เดิมได้ (service worker) หน้าใหม่จะเข้ามาเมื่อ reload

### Edge Function
```sh
supabase functions list --project-ref qbuafdbmpkffzbkqoysb                 # ดู version ที่ active
git checkout <known-good-sha> -- supabase/functions/<name>                  # หรือ git worktree ที่ commit นั้น
supabase functions deploy <name> --project-ref qbuafdbmpkffzbkqoysb         # ต้อง login/link ด้วยบัญชีเจ้าของ
git checkout main -- supabase/functions/<name>                              # คืน working tree
```
smoke ที่ไม่มีผลข้างเคียงหลัง deploy: `OPTIONS` ทุกฟังก์ชันด้วย `Origin: https://tasachii.github.io` ต้องได้ 204; `POST` `line-webhook` ไม่มี signature ต้องได้ 401 ภายใน 2 วินาที (ดู `uptime.yml` และ `scripts/smoke-deployment.mjs`)

### ฐานข้อมูล
**forward-fix เท่านั้น** — เขียน migration ใหม่ (0011+) ที่แก้ให้ถูก ห้ามรัน down migration และห้าม restore dump ทับ production · ทดสอบใน `SOLO_TEST_POSTGRES_IMAGE=postgres:17-alpine npm run test:db` ก่อนทุกครั้ง · ถ้าต้อง restore จริง ดู `docs/backup-restore.md` ("ก่อนกู้กลับ production")

## 4. หลังเหตุการณ์

- ปิด Issue พร้อมสรุป 5 บรรทัด: เกิดอะไร · รู้ตอนไหน · แก้ยังไง · ครูกระทบกี่คน (นับจากบัญชี ไม่ใช่ device id) · กันซ้ำยังไง
- ถ้ากระทบข้อมูลส่วนบุคคล (ชื่อเด็ก, LINE id, อีเมลครู) → แจ้งผู้รับผิดชอบด้านกฎหมายของทีมภายใน 24 ชม. ระยะแจ้ง สคส. ตาม PDPA ต้องให้ผู้เชี่ยวชาญยืนยัน (`docs/legal-review-draft.md`)
- secret ที่หมุนแล้วให้จดวันที่และผู้ถือใน `docs/data-inventory.md`

## 5. ยังไม่มี (ต้องเจ้าของ)

- ผู้รับ alert นอก GitHub (LINE/Slack) — ตั้ง Secret `OPERATIONS_ALERT_WEBHOOK`
- role อ่านอย่างเดียวสำหรับ operations (E-05) และ offsite backup (E-04) — ดู `docs/backup-restore.md`
- ซ้อม rollback Edge Function จริงหนึ่งครั้ง (ต้อง login Supabase CLI ด้วยบัญชีเจ้าของ) — บันทึกเวลาที่ใช้ลงในเอกสารนี้
- RTO/RPO ที่ทีมตกลง: ปัจจุบัน backup รายสัปดาห์ = อาจเสียข้อมูลฝั่งเซิร์ฟเวอร์ได้ถึง 7 วัน (ข้อมูลหลักของครูอยู่ในเครื่องครู จึงไม่หายตาม)
