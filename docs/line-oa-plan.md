# แผนต่อ LINE OA — Solo Tutor

> สำหรับให้ Claude Code ทำ · เขียน 6 ก.ย. 2569
> อ่านคู่กับ `docs/remodel-plan.md` (เลือก Supabase แล้ว · LINE OA อยู่หลังมีคนจ่าย) และ `docs/solo-remodel-prompt.md`
> **นี่เป็นงานวง 2 — ห้ามเริ่มก่อนผ่านเงื่อนไขในข้อ 0**

---

## 0 · เงื่อนไขก่อนเริ่ม (gate)

ห้ามเขียนโค้ดข้อไหนในไฟล์นี้จนกว่าจะครบทั้ง 4 ข้อ:

1. มีครูจ่ายเงินจริงอย่างน้อย 5 คน (ไม่ใช่ทดลองใช้ฟรี)
2. Supabase ขึ้นแล้ว ครูล็อกอินได้ ข้อมูลย้ายจาก localStorage สำเร็จ
3. มีข้อมูลว่า **การกดส่งเองเป็นปัญหาจริง** — วัดจากอย่างใดอย่างหนึ่ง: ครูบอกเองว่าเสียเวลา หรือสัดส่วนข้อความที่ร่างแล้วไม่ถูกส่งเกิน 30%
4. มีครูอย่างน้อย 2 คนบอกว่า **ยอมให้ผู้ปกครองแอดเพื่อน OA ของตัวเอง**

ถ้าข้อ 3 หรือ 4 ไม่ผ่าน — ไม่ต้องทำ OA ให้อยู่กับ share link ต่อไป และบันทึกเหตุผลไว้ใน `docs/`

---

## 1 · สถาปัตยกรรมที่เลือก และสิ่งที่ยอมแลก

### เลือก: OA ของครูแต่ละคน ไม่ใช่ OA กลางของ Solo Tutor

เหตุผลเดียวที่พอ: **หลักการข้อ 5 — ข้อความถึงลูกค้าต้องเป็นเสียงของผู้ให้บริการ ห้ามมีชื่อแบรนด์** (README ห้ามคำว่า "Solo" โดด ๆ · e2e `menu.spec.ts` บังคับว่าให้ขึ้นได้เฉพาะ "Solo Tutor" เต็ม ๆ) — OA กลางทำให้ผู้ปกครองได้ข้อความจากบัญชีบริษัทที่เขาไม่รู้จัก ผิดหลักการที่ล็อกไว้แล้ว และ Solo Tutor ต้องจ่ายค่าข้อความทุกใบเมื่อโต

ผลพลอยได้: ครูสอน 20 คน ส่งราว 80–150 ข้อความ/เดือน อยู่ใต้โควตาฟรี 300 ข้อความ/เดือนของ OA แต่ละบัญชี → **ไม่มีค่าข้อความทั้งฝั่งครูและฝั่งเรา**

### สิ่งที่ยอมแลก — เขียนไว้ให้ชัด อย่าหลอกตัวเอง

| ยอมแลก | ผลกระทบจริง | ทางบรรเทา |
|---|---|---|
| ผู้ปกครองต้องแอดเพื่อนก่อน ถึงจะส่งได้ | ผู้ปกครองบางส่วนจะไม่แอด | ต้อง fallback ไป share link เสมอ (ข้อ 10) · ห้ามบังคับ |
| บิลไปอยู่คนละห้องแชทกับที่คุยกับครูปกติ | ผู้ปกครองสับสนว่ามีสองเธรด | ตั้งชื่อ OA ให้ตรงกับที่ผู้ปกครองเรียกครู · ข้อความแรกอธิบายว่าห้องนี้ใช้ส่งบิล |
| ผู้ปกครองตอบกลับใน OA ครูต้องเปิดอีกที่ | ครูพลาดข้อความ | ดึงข้อความเข้ามาแสดงในแอพเรา (ข้อ 6.4) ไม่ให้ครูต้องเปิด LINE OA Manager |
| ครูต้องตั้ง OA เอง | หลายคนทำไม่สำเร็จ | คู่มือมีภาพ + เราตั้งให้ฟรีสำหรับ 10 คนแรก |
| เราถือ token ของครูทุกคน | ถ้าหลุด ส่งข้อความในนามครูได้ทุกคน | ข้อ 8 ทั้งข้อ |

---

## 2 · โครงสร้างพื้นฐาน

GitHub Pages ส่งข้อความไม่ได้ (ไม่มี server และ token ห้ามอยู่ frontend) ต้องเพิ่ม:

- **Supabase Edge Functions** (Deno) 3 ตัว: `line-webhook`, `line-send`, `line-connect`
- ใช้ Supabase ที่มีอยู่แล้วจากวง 2 — ไม่ต้องเพิ่มผู้ให้บริการรายใหม่
- `pg_cron` + `pg_net` สำหรับ job ส่งตามเวลา (ข้อ 6.3)
- frontend เรียกเฉพาะ Edge Function ผ่าน Supabase client ที่แนบ JWT ของครู — **frontend ไม่เคยเห็น channel access token**

หมายเหตุค่าคงที่ของ LINE ที่ใช้ในแผนนี้ ให้ Claude Code **ยืนยันกับ docs ก่อนเขียนจริง** (docs เปลี่ยนได้): push endpoint `POST https://api.line.me/v2/bot/message/push` · header `Authorization: Bearer {channel access token}` · webhook signature อยู่ที่ header `x-line-signature` เป็น HMAC-SHA256 ของ raw body ด้วย channel secret เข้ารหัส base64 · ข้อความ type text ยาวได้ 5,000 ตัวอักษร · 1 request ส่งได้ไม่เกิน 5 message object · webhook ต้องตอบ 2xx เสมอ

---

## 3 · Data model (Supabase)

```sql
-- OA ของครูแต่ละคน
create table line_channels (
  provider_id      uuid primary key references providers(id) on delete cascade,
  bot_user_id      text unique not null,        -- ใช้ route webhook (destination)
  channel_secret   text not null,               -- เข้ารหัสก่อนเก็บ (ข้อ 8)
  access_token     text not null,               -- เข้ารหัสก่อนเก็บ
  display_name     text,
  status           text not null default 'active',  -- active | invalid | disabled
  quota_used       int  not null default 0,      -- นับเอง รีเซ็ตต้นเดือน
  quota_limit      int  not null default 300,
  last_verified_at timestamptz,
  created_at       timestamptz default now()
);

-- ผู้ปกครองที่แอดเพื่อนแล้วและจับคู่กับ client ในระบบเราได้
create table line_recipients (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references providers(id) on delete cascade,
  client_id     uuid references clients(id) on delete set null,  -- null = ยังไม่จับคู่
  line_user_id  text not null,
  display_name  text,
  linked_at     timestamptz,
  unfollowed_at timestamptz,                    -- ไม่ลบทิ้ง เก็บไว้กันส่งซ้ำ
  unique (provider_id, line_user_id)
);

-- รหัสจับคู่ 6 หลัก
create table line_link_codes (
  code        text primary key,                 -- 6 หลัก ตัวเลข
  provider_id uuid not null references providers(id) on delete cascade,
  client_id   uuid not null references clients(id) on delete cascade,
  expires_at  timestamptz not null,             -- +24 ชม.
  used_at     timestamptz
);

-- คิวส่ง — เป็น outbox ห้ามยิง LINE ตรงจาก UI
create table message_outbox (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references providers(id) on delete cascade,
  recipient_id  uuid not null references line_recipients(id) on delete cascade,
  message_id    text not null,                  -- id ของ Message ใน AppState
  body          text not null,
  dedupe_key    text not null,                  -- กันส่งซ้ำ ใช้ key เดิมจาก core/messages.ts
  status        text not null default 'queued', -- queued | sent | failed | skipped
  attempts      int  not null default 0,
  error         text,
  scheduled_at  timestamptz default now(),
  sent_at       timestamptz,
  unique (provider_id, dedupe_key)
);
```

RLS ทุกตาราง: ครูอ่าน/เขียนได้เฉพาะแถวที่ `provider_id = auth.uid()` · `line_channels.channel_secret` และ `access_token` **ห้าม select จาก client** ให้ทำ view ที่ไม่มีสองคอลัมน์นี้แล้วให้ frontend อ่าน view แทน

---

## 4 · ครูเชื่อม OA (Edge Function `line-connect`)

หน้าจอใหม่ `/app/settings/line` — 4 ขั้น มีภาพประกอบทุกขั้น:

1. สร้าง LINE Official Account (ลิงก์ออกไป LINE Business) → กลับมากดถัดไป
2. เปิด Messaging API ใน LINE Developers → คัดลอก **Channel secret** และ **Channel access token (long-lived)**
3. วางสองค่านั้นในแอพ → กด "เชื่อมต่อ"
4. แอพตั้ง webhook URL ให้เอง แล้วยิงทดสอบ

`line-connect` ต้องทำตามลำดับนี้ ห้ามข้าม:
- เรียก `GET https://api.line.me/v2/bot/info` ด้วย token → ได้ `userId` (= `bot_user_id`) และชื่อ OA · ถ้า 401 ตอบกลับว่า "token ไม่ถูกต้อง" อย่าเก็บ
- เรียก `PUT https://api.line.me/v2/bot/channel/webhook/endpoint` ตั้ง webhook เป็น URL ของ `line-webhook`
- เรียก `POST https://api.line.me/v2/bot/channel/webhook/test` ยืนยันว่าเรียกถึง
- เข้ารหัส secret + token แล้ว insert `line_channels`
- แสดงผลให้ครูเห็นว่า "เชื่อมแล้ว: {ชื่อ OA}" พร้อมปุ่มยกเลิกการเชื่อม

**ครูต้องปิด auto-reply กับ greeting message ของ LINE เอง** — ใส่ไว้ในคู่มือ ไม่งั้นผู้ปกครองจะได้ข้อความอัตโนมัติของ LINE ปนกับของเรา

---

## 5 · จับคู่ผู้ปกครอง (จุดที่ยากที่สุด)

ปัญหา: LINE ให้ `userId` ของผู้ปกครองก็ต่อเมื่อเขาแอดเพื่อนแล้ว แต่ `userId` นั้นไม่ได้บอกว่าเขาเป็นผู้ปกครองของนักเรียนคนไหน

### วิธีที่ใช้ (v1) — รหัส 6 หลัก

1. ครูกด "เชิญผู้ปกครองเข้า LINE" ที่แถวนักเรียน → ระบบสร้าง `line_link_codes` อายุ 24 ชม.
2. แอพร่างข้อความให้ครูส่งทาง LINE ส่วนตัว (ทางเดิม ยังใช้ share link): ลิงก์แอดเพื่อน OA + รหัส 6 หลัก + บอกว่ารหัสใช้ครั้งเดียว
3. ผู้ปกครองแอดเพื่อน → `line-webhook` รับ event `follow` → เก็บ `line_recipients` แบบ `client_id = null` → ตอบกลับอัตโนมัติว่า "พิมพ์รหัส 6 หลักที่ครูส่งให้"
4. ผู้ปกครองพิมพ์รหัส → event `message` → หา code ที่ยังไม่หมดอายุและยังไม่ถูกใช้ → set `client_id`, `linked_at`, `used_at` → ตอบยืนยัน "เชื่อมเรียบร้อย ต่อจากนี้จะได้รับบิลของ{ชื่อนักเรียน}ทางนี้"
5. รหัสผิด/หมดอายุ → ตอบข้อความบอกให้ขอรหัสใหม่จากครู · **ห้ามบอกว่ารหัสไหนมีอยู่จริง** และจำกัดลองผิดไม่เกิน 5 ครั้ง/ชม.ต่อ userId

### สำรอง — จับคู่ด้วยมือ
หน้า `/app/settings/line` มีรายการ "คนที่แอดเข้ามาแต่ยังไม่จับคู่" แสดงชื่อโปรไฟล์ LINE + รูป ให้ครูเลือกว่าเป็นผู้ปกครองของใคร — เผื่อผู้ปกครองพิมพ์รหัสไม่เป็น ซึ่งจะเกิดขึ้นแน่

### ทีหลัง (ไม่ต้องทำรอบนี้)
LIFF + LINE Login จับคู่อัตโนมัติไม่ต้องพิมพ์รหัส — ทำเมื่อมีครูเกิน 50 คนและการจับคู่ด้วยรหัสเป็นคอขวดจริง

### unfollow
event `unfollow` → set `unfollowed_at` **ห้ามลบแถว** และห้ามส่งหาคนนั้นอีกจนกว่าจะ follow ใหม่ · แจ้งครูในแอพว่า "ผู้ปกครองของ{ชื่อ}บล็อกห้องแชทนี้แล้ว ระบบจะกลับไปใช้วิธีส่งแบบเดิม"

---

## 6 · การส่ง

### 6.1 หลักการข้อ 3 ต้องแก้ให้ชัด — อย่าละเมิดเงียบ ๆ

หลักการเดิมคือ "AI ร่าง คนกดส่ง" การส่งอัตโนมัติตามเวลาขัดกับข้อนี้ ต้องแก้เป็น:

> **AI ร่าง คนอนุมัติ** — ข้อความทุกใบต้องผ่านการอนุมัติของครู ไม่ครั้งเดียวก็เป็นกฎ · ครูเปิด "ทวงอัตโนมัติ" ได้ทีละกฎ เห็นตัวอย่างข้อความก่อนเปิด · ทุกใบที่ส่งอัตโนมัติถูกบันทึกและครูปิดได้ทุกเมื่อ · กฎที่ยังไม่ถูกเปิด = ไม่ส่ง

เขียนข้อนี้ลง README แทนข้อ 3 เดิม พร้อมวันที่และเหตุผล

### 6.2 ส่งทันที (ครูกดเอง)
- UI เดิมในหน้าแอดมินไม่เปลี่ยน ครูยังกด "ส่ง" ทีละใบหรือทั้งคิว
- ถ้าผู้ปกครองคนนั้น `linked` แล้ว → insert `message_outbox` แล้วเรียก `line-send` ทันที
- ถ้ายังไม่ linked → **เปิด LINE share link แบบเดิม** ไม่ต้องถามครู ไม่ต้องขึ้น error

### 6.3 ส่งตามเวลา (คุณค่าจริงของ OA)
- กฎที่ให้เปิดได้: เตือนก่อนครบกำหนด 1 วัน · เลยกำหนด 3 วัน · เลยกำหนด 7 วัน · สรุปสิ้นเดือน
- `pg_cron` ทุกชั่วโมง → หา invoice ที่เข้าเงื่อนไข → สร้างข้อความจาก `core/messages.ts` (ตรรกะเดิม ห้ามเขียนใหม่) → ลง outbox `scheduled_at`
- **ห้ามส่งนอกเวลา 08:00–20:00 น. ตามเวลาไทย** เลื่อนไปรอบถัดไปแทน
- ห้ามส่งหาคนเดียวกันเกิน 1 ใบ/วัน แม้เข้าหลายกฎ — เอากฎที่แรงสุดใบเดียว

### 6.4 รับข้อความจากผู้ปกครอง
- event `message` ที่ไม่ใช่รหัสจับคู่ → เก็บลงตาราง `chats` เดิม แล้วแสดงในแท็บแชทของหน้าแอดมิน
- ให้ระบบ FAQ เดิม (`core/faq.ts`) ร่างคำตอบเข้าคิวรอครูอนุมัติ **ห้ามตอบอัตโนมัติ**

### 6.5 ความทนทาน
- **idempotency:** `dedupe_key` unique ที่ระดับ DB · ใช้ key เดิมจาก `core/messages.ts` ไม่สร้างใหม่
- **retry:** 429 หรือ 5xx → หน่วง exponential 1m/5m/30m สูงสุด 3 ครั้ง แล้ว `failed` · 4xx อื่น ๆ ไม่ retry
- token ใช้ไม่ได้ (401) → set `line_channels.status='invalid'` · แจ้งครูในแอพ · ทุกอย่างกลับไป share link อัตโนมัติ
- **ห้ามยิง LINE จาก UI ตรง ๆ** ทุกเส้นทางผ่าน outbox เท่านั้น

---

## 7 · โควตาและค่าใช้จ่าย

โควตาฟรี 300 ข้อความ/เดือนเป็นของ OA แต่ละบัญชี = ของครู ไม่ใช่ของเรา ถ้าเกิน **ครูเป็นคนถูก LINE เรียกเก็บ** ซึ่งแพงกว่าค่า Solo Tutor หลายเท่า — ห้ามปล่อยให้เกิดขึ้นโดยครูไม่รู้ตัว

- นับทุกใบที่ส่งสำเร็จลง `quota_used` รีเซ็ตวันที่ 1 ของเดือน
- ที่ 200 ใบ: ขึ้นแถบเตือนในแอพ
- ที่ 280 ใบ: หยุดส่งอัตโนมัติ เหลือเฉพาะที่ครูกดเอง
- ที่ 300 ใบ: หยุดส่งผ่าน OA ทั้งหมด กลับไป share link พร้อมข้อความอธิบาย
- หน้าตั้งค่าแสดง "เดือนนี้ใช้ไป X / 300"
- ให้ยืนยันตัวเลข 300 กับ LINE ก่อน hardcode และเก็บไว้ใน `quota_limit` ให้แก้ได้ต่อครู

---

## 8 · ความปลอดภัย

- `channel_secret` และ `access_token` เข้ารหัสก่อนเก็บด้วยคีย์ที่อยู่ใน Supabase secrets **ห้ามอยู่ในตารางเดียวกับข้อมูล** และห้าม log ค่าเหล่านี้ไม่ว่ากรณีใด
- frontend อ่านผ่าน view ที่ไม่มีสองคอลัมน์นั้น
- `line-webhook` ต้องตรวจ `x-line-signature` ทุก request **ก่อน** parse body · ไม่ผ่าน = 401 และไม่ประมวลผลอะไรเลย
- route webhook ด้วย `destination` (bot userId) → หา provider · ถ้าหาไม่เจอ ตอบ 200 แล้วทิ้ง (ห้ามตอบ error ให้ LINE รู้ว่ามี/ไม่มีบัญชีนั้น)
- rate limit ต่อ `line_user_id` กันคนยิงรหัสมั่ว
- มีปุ่ม "ยกเลิกการเชื่อม" ที่ลบ token ออกจริงจาก DB
- เขียนขั้นตอนไว้ว่าถ้าสงสัยว่า token หลุดต้องทำอะไร ใครแจ้งครู ภายในกี่ชั่วโมง

---

## 9 · PDPA

- `line_user_id` และชื่อโปรไฟล์เป็นข้อมูลส่วนบุคคลของผู้ปกครอง — เพิ่มในนโยบายความเป็นส่วนตัวว่าเก็บอะไร ทำไม เก็บนานแค่ไหน
- ข้อความแรกที่ OA ตอบต้องบอกว่า "ห้องนี้ใช้ส่งบิลและสรุปการเรียนจาก{ชื่อครู}" และมีลิงก์นโยบาย
- ผู้ปกครองพิมพ์ "ยกเลิก" หรือ "หยุด" → set `unfollowed_at` และหยุดส่งทันที ไม่ต้องรอครู
- ลบบัญชีครู → ลบ `line_recipients` ของครูคนนั้นทั้งหมดภายใน 30 วัน
- **ห้ามเอา `line_user_id` ไปใช้ทำอย่างอื่นนอกจากส่งข้อความของครูคนนั้น** ห้ามรวมข้ามครู ห้ามทำ analytics ระดับบุคคล

---

## 10 · Fallback — ข้อที่ห้ามพลาด

ทุกจุดที่ส่งข้อความต้องเลือกอัตโนมัติ ครูไม่ต้องรู้ว่าใช้ทางไหน:

```
ผู้ปกครอง linked + OA active + ยังไม่เกินโควตา  → ส่งผ่าน OA
กรณีอื่นทั้งหมด                                  → เปิด LINE share link แบบเดิม
```

share link ต้องใช้ได้ตลอดไป **ห้ามลบโค้ดเดิมทิ้ง** ไม่ว่า OA จะทำงานดีแค่ไหน

---

## 11 · เทสต์

- ตรวจ signature: ถูก/ผิด/ไม่มี header
- `follow` ซ้ำจากคนเดิม → ไม่สร้างแถวซ้ำ
- รหัสหมดอายุ · รหัสถูกใช้แล้ว · รหัสผิด 6 ครั้งติด → ถูกบล็อก
- outbox: `dedupe_key` ซ้ำ → insert ไม่ผ่าน ส่งใบเดียว
- retry: จำลอง 429 แล้ว 200 → ส่งครั้งเดียว ไม่ซ้ำ
- token invalid → ทุกอย่าง fallback ไป share link ไม่มี error หลุดถึงครู
- โควตา 279/280/300 → พฤติกรรมตรงข้อ 7
- ห้ามส่งนอกเวลา: ตั้งเวลา 21:00 → ต้องเลื่อน ไม่ใช่ส่ง
- unfollow แล้วมีข้อความในคิว → ไม่ส่ง
- e2e: เชื่อม OA (mock LINE API) → เชิญ → จับคู่ → ส่งบิล → ผู้ปกครองตอบ → เข้าแชทในแอพ

---

## 12 · ลำดับ commit

| # | commit | เนื้อหา |
|---|---|---|
| 1 | `feat(line): schema` | 4 ตาราง + RLS + view ที่ซ่อน token — **เขียนแล้ว** `supabase/migrations/0001_line.sql` (ยังไม่ deploy รอข้อ 0) · ตรรกะกลางที่ใช้ร่วมกันทั้งแอปและ Edge Function อยู่ที่ `src/core/lineDelivery.ts` มีเทส 12 ข้อ |
| 2 | `feat(line): connect` | Edge Function `line-connect` — **เขียนแล้ว** ยังไม่ deploy · หน้า `/app/settings/line` ยังไม่ทำ (รอล็อกอิน) |
| 3 | `feat(line): webhook` | `line-webhook` + signature + follow/unfollow/message — **เขียนแล้ว** ยังไม่ deploy · ตรรกะอยู่ใน `src/core/lineProtocol.ts` มีเทส |
| 4 | `feat(line): linking` | รหัส 6 หลัก **เขียนแล้ว** (ใน webhook) · จับคู่ด้วยมือยังไม่ทำ |
| 5 | `feat(line): outbox` | ตาราง outbox + `line-send` + idempotency + retry — **เขียนแล้ว** ยังไม่ deploy |
| 6 | `feat(line): manual send` | ต่อปุ่มส่งเดิมเข้า OA + fallback |
| 7 | `feat(line): scheduled` | pg_cron + กฎทวง · **กรอบเวลา 08:00–20:00 และ 1 ใบ/วัน เขียนและเทสแล้ว** ใน `lineProtocol.ts` เหลือ cron |
| 8 | `feat(line): quota` | นับ เตือน หยุด |
| 9 | `feat(line): inbox` | ดึงข้อความผู้ปกครองเข้าแท็บแชท |
| 10 | `docs` | แก้หลักการข้อ 3 ใน README + คู่มือครูพร้อมภาพ |

**ข้อจำกัดที่กำหนดลำดับ:** channel access token ต้องอยู่ฝั่งเซิร์ฟเวอร์เท่านั้น (ข้อ 8) และวันนี้แอปเป็น static ล้วนไม่มีที่วางเซิร์ฟเวอร์ — ข้อ 2 เป็นต้นไปจึงเริ่มไม่ได้จนกว่า Supabase จะขึ้น (เงื่อนไขข้อ 0.2) · ที่ทำล่วงหน้าได้คือข้อ 1 ซึ่งเป็นตรรกะล้วนและ schema เทสได้โดยไม่ต้องมีบัญชีใด

ทำข้อ 1–6 ให้จบและมีครูใช้จริง 1 คนก่อน แล้วค่อยทำ 7–9 · ข้อ 7 คือข้อเดียวที่ทำให้ OA คุ้มกับกำแพงแอดเพื่อน ถ้าไปไม่ถึงข้อ 7 แปลว่าไม่ควรทำ OA ตั้งแต่แรก

---

## 13 · เลิกเมื่อไหร่

ถ้าหลังปล่อย 1 เดือนเจอข้อใดข้อหนึ่ง ให้หยุดพัฒนา OA และกลับไป share link อย่างเดียว:

- ผู้ปกครองแอดเพื่อนสำเร็จน้อยกว่า 40% ของที่ครูเชิญ
- ครูเชื่อม OA ไม่สำเร็จเกินครึ่ง แม้มีคู่มือ
- มีเคส token หลุดหรือส่งผิดคนแม้ครั้งเดียว
- ครูบอกว่าการมีสองห้องแชททำให้ผู้ปกครองสับสนจนต้องอธิบายบ่อยกว่าเดิม

บันทึกผลไว้ใน `docs/` ไม่ว่าจะไปต่อหรือเลิก
