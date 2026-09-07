# หลังบ้านสำหรับ LINE OA — ยังไม่ deploy

ทุกอย่างในโฟลเดอร์นี้เขียนไว้รอ **ยังไม่ได้ใช้งานจริง** และจะยังไม่ deploy
จนกว่าจะผ่านเงื่อนไขข้อ 0 ใน [`../docs/line-oa-plan.md`](../docs/line-oa-plan.md)
(ครูจ่ายเงินจริง 5 คน · Supabase ขึ้นแล้ว · พิสูจน์ได้ว่าการกดส่งเองเป็นปัญหาจริง · ครู 2 คนยอมให้ผู้ปกครองแอด OA)

## ทำไมต้องมีหลังบ้าน

`channel access token` ของ LINE ต้องอยู่ฝั่งเซิร์ฟเวอร์เท่านั้น ถ้าอยู่ใน frontend ใครเปิดหน้าเว็บก็อ่านได้
และส่งข้อความในนามครูได้ทุกคน — แอปวันนี้เป็น static ล้วนบน GitHub Pages จึงยังทำส่วนนี้ไม่ได้

## อะไรอยู่ตรงไหน

| ไฟล์ | หน้าที่ |
|---|---|
| `migrations/0001_line.sql` | prerequisite tenant schema + LINE tables + RLS + atomic RPCs |
| `functions/line-connect` | ครูวาง secret/token → ตรวจกับ LINE → ตั้ง webhook → เก็บแบบเข้ารหัส |
| `functions/line-webhook` | รับ follow / unfollow / ข้อความ → จับคู่ผู้ปกครอง → เก็บข้อความเข้าแชท |
| `functions/line-send` | ส่งคิวใน `message_outbox` พร้อม retry · โควตา · กรอบเวลา |
| `functions/_shared/db.ts` | ต่อ Supabase + เข้ารหัส/ถอดรหัสความลับ |

**การตัดสินใจทั้งหมดไม่ได้อยู่ในไฟล์เหล่านี้** — อยู่ใน `src/core/lineProtocol.ts` และ
`src/core/lineDelivery.ts` ซึ่งเป็นตรรกะล้วนและมีเทสครอบ 30 ข้อ รันได้โดยไม่ต้องมีบัญชี LINE
ไฟล์ใน `functions/` เป็นแค่เปลือกที่ต่อสายเข้ากับฐานข้อมูลและ `fetch`

## ตอน deploy จริงต้องทำอะไร

1. ตรวจ migration กับ schema จริงใน staging ก่อน แล้วจึง `supabase link` และ `supabase db push`
2. ตั้ง secrets: `SUPABASE_SERVICE_ROLE_KEY`, `LINE_SECRET_KEY` (อย่างน้อย 32 ตัวอักษร),
   `LINE_WEBHOOK_URL` (HTTPS URL ที่ควบคุมจาก server) และ `LINE_CRON_SECRET` (แยกจาก JWT ผู้ใช้)
   รวมถึง `LINE_ALLOWED_ORIGIN` ซึ่งต้องเป็น origin ของเว็บจริงแบบเจาะจง เช่น GitHub Pages ของโปรเจกต์
3. Deploy ทีละฟังก์ชัน: `supabase functions deploy line-connect`, `supabase functions deploy line-webhook` และ `supabase functions deploy line-send`
4. ถ้า CLI ไม่ยอม bundle การ import ข้าม `supabase/functions/` (`../../../src/core/…`)
   ให้คัดลอกสองไฟล์นั้นเข้า `functions/_shared/` ตอน deploy — **อย่าแก้สำเนา** ให้แก้ที่ `src/core/`
   แล้วคัดลอกทับ ไม่งั้นตรรกะสองชุดจะเพี้ยนกันโดยไม่มีใครรู้
5. รอบนี้ส่งแบบกดเอง ยังไม่ตั้ง cron; ดูขั้นตอนผูก frontend และตรวจรับใน [`../docs/line-oa-setup.md`](../docs/line-oa-setup.md)

`auth.users` และ `auth.uid()` เป็นของ Supabase Auth migration นี้จึงไม่สร้างหรือแก้ schema `auth` เอง
ชุดทดสอบใน `tests/sql/bootstrap_supabase.sql` สร้างเพียง stub ที่เข้ากันได้ใน PostgreSQL ชั่วคราว
เพื่อทดสอบ clean migration/RLS เท่านั้น ไม่ใช่ระบบยืนยันตัวตนสำหรับ production

คำขอ `line-connect` และการส่งแบบกดเองต้องมี Supabase bearer JWT ที่ตรวจด้วย
`auth.getUser()` แล้ว provider จะมาจาก user ID ที่ตรวจแล้วเท่านั้น ค่า `providerId` ใน JSON ไม่มีสิทธิ์
เปลี่ยน tenant การส่งตามเวลาใช้ `x-cron-secret` คนละช่องทาง และไม่มีการส่งจริงในชุดทดสอบ
`config.toml` ปิด gateway JWT ของ `line-webhook` และ `line-send` เพื่อให้ LINE signature
และ cron secret เข้าถึง handler ได้ จากนั้น handler ตรวจสิทธิ์เอง `line-connect` ปิด gateway JWT
เพื่อรองรับ signing key แบบใหม่ แต่ยังตรวจ bearer token ทุกครั้งด้วย `auth.getUser()` ใน handler

## ทดสอบในเครื่อง

```sh
./scripts/test-db.sh
./scripts/test-edge.sh
npm test -- --run tests/unit/line-delivery.test.ts tests/unit/line-protocol.test.ts
```

คำสั่งแรกใช้ container `postgres:16-alpine` ชั่วคราว ตรวจ owner/other RLS, secret grants,
composite tenant FK, field ที่ server เป็นเจ้าของ, atomic outbox claim/settle, monthly quota rollover,
auto ceiling/หนึ่งข้อความต่อคนต่อวัน และ concurrent one-use redeem
แล้วลบ container ทิ้งเมื่อจบ
คำสั่งที่สองใช้ Deno container ตรวจสัญญา handler ด้วย dependency ปลอม จึงไม่เรียก Supabase หรือ LINE จริง

## ที่ยังไม่ได้ทำ

- หน้าจอ `/app/settings/line` ในแอป (ต้องมีล็อกอินก่อน)
- จับคู่ด้วยมือสำหรับผู้ปกครองที่พิมพ์รหัสไม่เป็น (แผนข้อ 5)
- นับโควตาให้ครูเห็นในแอป (แผนข้อ 7)
- ตาราง `chats` ฝั่ง Supabase — ตอนนี้แชทอยู่ใน state ของเครื่อง
