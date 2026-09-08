# Backup, restore และการแจ้งเตือนงานหลังบ้าน

อัปเดต 8 กันยายน 2569 · ใช้ Supabase Free ต่อสำหรับ Demo/pitching งานนี้ไม่เปลี่ยนแพ็กและไม่สร้างพื้นที่เก็บที่มีค่าใช้จ่าย

## สำเนาเข้ารหัสรายสัปดาห์

`.github/workflows/backup.yml` เก็บ schema ของ `public`, ข้อมูล COPY ของ `public` + `auth`, roles และ Auth DDL เป็นไฟล์อ้างอิงเท่านั้น (ปลายทางต้องมี Auth schema ที่เข้ากันได้อยู่แล้ว ห้ามใช้ test bootstrap ที่มี `auth.users` คอลัมน์เดียว)

ไฟล์ `.tar.gz.solobak` ใช้ AES-256-GCM, PBKDF2-SHA256 600,000 รอบ, salt/nonce สุ่ม และตรวจ authentication tag ก่อนถือว่าถอดรหัสสำเร็จ (`scripts/backup-crypto.mjs`, เทส `tests/unit/backup-crypto.test.ts`) ไฟล์ปลายทางสิทธิ์ 0600 ไม่ทับไฟล์เดิม และลบ plaintext ทิ้งเมื่อ tag ไม่ผ่าน Workflow ถอดกลับแล้วเทียบต้นฉบับทุกไบต์ก่อนเก็บ artifact 90 วัน ไม่มี passphrase หรือ plaintext ใน artifact และ secret อยู่เฉพาะใน step ที่ใช้

ถอดรหัสในเครื่อง (โหลด `BACKUP_PASSPHRASE` เข้า environment จากที่เก็บลับ ห้ามใส่ใน command line หรือแชท):

```sh
BACKUP_PASSPHRASE=… node scripts/backup-crypto.mjs decrypt solo-tutor-db-YYYYMMDD-HHMM.tar.gz.solobak restored.tar.gz
tar -xzf restored.tar.gz   # ได้ dump/schema.sql dump/data.sql dump/roles.sql dump/auth-schema-reference.sql
```

สำเนาเก่า `.tar.gz.enc` (workflow ก่อน 8 ก.ย. 2569) ใช้ openssl แบบเดิม ห้ามส่งเข้าโปรแกรมรูปแบบใหม่ (โปรแกรมปฏิเสธเองพร้อมข้อความบอก):

```sh
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in OLD.tar.gz.enc -out restored.tar.gz
```

รูปแบบเก่าไม่มี authentication tag จึงต้องตรวจ archive และฐานที่กู้ก่อนใช้จริง อย่าลบสำเนาเก่าจนกว่าสำเนาใหม่จะผ่านการซ้อมกู้

## ซ้อมกู้ลงฐานแยก (ไม่แตะ production)

```sh
BACKUP_PASSPHRASE=… bash scripts/rehearse-restore.sh BACKUP.tar.gz.solobak evidence.json
bash scripts/rehearse-restore.sh DUMP_DIR evidence.json      # โฟลเดอร์ที่มี schema.sql + data.sql
```

สคริปต์สร้าง PostgreSQL 17 ใน Docker ใหม่ทุกครั้ง โหลด stub ของ Supabase auth/roles จาก `tests/sql/bootstrap_supabase.sql` ตัดเฉพาะบรรทัด extension ที่ Supabase ใส่มาเอง (pg_cron/vault/uuid-ossp/pg_stat_statements) แล้วตรวจ:

- ทุกตารางใน `public` เปิด RLS (`tablesWithoutRls` ต้อง 0)
- ciphertext ใน `ledger_snapshots` เป็น base64 ล้วน ไม่มี plaintext (`nonBase64Snapshots` ต้อง 0)
- role `anon` อ่าน `providers` ไม่ได้ (`anonDenied` ต้อง 1)
- จำนวนตาราง/นโยบาย/ฟังก์ชัน/trigger และจำนวนแถวต่อตาราง (ตัวเลขล้วน ไม่มีข้อมูลบุคคล)

ผลลัพธ์เป็น JSON บรรทัดเดียว เก็บเป็นหลักฐานได้ ไม่มีตัวเลือกคืนข้อมูลทับ production

## ก่อนกู้กลับ production

ห้ามใช้ snapshot เก่ากลับรับผู้ใช้ทันที ต้องตรวจคำขอลบบัญชี/นักเรียนที่เกิดหลังเวลาสำรอง แล้วลบ/ปกปิดข้อมูลนั้นก่อนเปิดระบบอีกครั้ง ถ้าหาบันทึกหลัง snapshot ไม่ได้ ให้หยุด cutover และให้ผู้รับผิดชอบข้อมูลตัดสินใจ ไม่มีคำสั่งใน repository นี้ที่ restore ทับ production อัตโนมัติ

การคืน Auth rows ไม่คืน SMTP, LINE secrets, JWT signing keys หรือสิทธิ์ในบริการภายนอก ต้องทดสอบ login และกุญแจกู้คืน ledger ด้วยบัญชีทดสอบหลังตั้งค่าปลายทาง

## การแจ้งเตือนเมื่องาน scheduled ล้ม

ทุก workflow ที่รันตามเวลา (`backup`, `operations`, `uptime`, `quality-scheduled`) เรียก `scripts/ops-alert.mjs <check>` เมื่อล้ม:

- เปิด GitHub Issue ป้าย `ops-alert` ชื่อ `[ops] <check> ล้ม` หนึ่ง issue ต่อหนึ่ง check (เจ้าของ repo ได้อีเมล/มือถือจาก GitHub ทันที)
- ถ้ายังล้มซ้ำ comment ต่อใน issue เดิม ไม่เปิดใหม่ และไม่ comment ถี่กว่าทุก 6 ชั่วโมง
- ข้อความมีแค่ชื่อ check กับลิงก์ run ไม่มีชื่อเด็ก ยอดเงิน หรือรายละเอียด error
- ปิด issue เมื่อแก้แล้ว
- ปลายทางเสริม: ตั้ง Secret `OPERATIONS_ALERT_WEBHOOK` (HTTPS POST `{ "text": "..." }` เช่น LINE Notify/Slack) ระบบส่งข้อความเดียวกัน ต้องยืนยันกับผู้รับจริงก่อนอ้างว่ามีคนเฝ้าระบบ

## ยังไม่มี (รอเจ้าของ)

- **สำเนานอก GitHub/Supabase** (คนละ failure domain): ต้องมี S3-compatible bucket + credential เขียนเฉพาะ prefix `solo-tutor/` (Repository Variables `BACKUP_OFFSITE_ENABLED`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION` และ Secrets `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`) สคริปต์ร่างอยู่ใน `.omx/deferred-production/root/scripts/backup-offsite.sh` (เครื่องเจ้าของ) ยังไม่รวมใน workflow จนกว่าปลายทางจะมีจริง
- **role อ่านอย่างเดียวสำหรับ operations.yml** (E-05): ตอนนี้ต่อด้วย `postgres` เต็มสิทธิ์ผ่าน secret เดียวกับ backup ต้องสร้าง login แยกและตั้ง secret `OPERATIONS_DATABASE_URL` ใหม่โดยเจ้าของ
- **ผู้ถือกุญแจ/รอบหมุน BACKUP_PASSPHRASE** และ RTO/RPO ที่ทีมตกลง

## ควรซื้อ Pro หรือไม่

สำหรับ Demo แข่งเคส **ยังไม่จำเป็น**: Free มีฐาน 500 MB และระบบมี encrypted backup + rehearsal เองแล้ว แต่ Free อาจ pause เมื่อไม่มีการใช้งานหนึ่งสัปดาห์ (uptime.yml ปลุกทุก 6 ชม.) และไม่มี automatic backup ของผู้ให้บริการ ([ราคา Supabase](https://supabase.com/pricing)) เมื่อมีครูจ่ายจริง ค่อยประเมิน Pro (daily backup 7 วัน; PITR เป็น add-on แยก — [backups](https://supabase.com/docs/guides/platform/backups)) อย่าซื้อ Pro เพื่อแทนการซ้อม restore
