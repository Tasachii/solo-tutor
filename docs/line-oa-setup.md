# เชื่อม LINE OA กับ Solo Tutor

สถานะตรวจ 2026-09-08: OA **Solo Tutor (`@458gfbxa`)** มีแถว `line_channels` บน Supabase จริง สถานะฝั่งเซิร์ฟเวอร์เป็น `active` และการเชื่อมก่อนหน้านี้ตรวจ token, ตั้ง Webhook URL และทดสอบ endpoint ผ่านแล้ว credential ถูกเก็บแบบเข้ารหัสบนเซิร์ฟเวอร์และไม่มีค่า secret/token อยู่ใน repository

สถานะ `active` ไม่ได้ยืนยันสวิตช์ **Use webhook** ใน LINE Developers เจ้าของยังต้องเปิดสวิตช์และกด Verify ตามขั้นตอนด้านล่าง รอบนี้ยังไม่ได้จับคู่ LINE ของผู้ปกครองจริงและยังไม่ได้ส่งข้อความจริง

ตรวจระบบรอบนี้: LINE unit tests 60 ผ่าน; Edge tests 29 ผ่าน; live endpoint ตอบตามสัญญา (`line-connect`, `line-send`, `line-webhook`) โดยไม่ได้ส่งข้อความหรือสร้าง webhook event จริง หลักฐานเดิม: [LINE readiness probes](qa-evidence/2026-09-08/followup/line-readiness.json)

## ขั้นตอนที่เหลือสำหรับเจ้าของ OA

1. เปิด [LINE Developers Console ของ channel Solo Tutor](https://developers.line.biz/console/channel/2011503954) แล้วเลือกแท็บ **Messaging API**
2. เลื่อนลงหัวข้อ **Webhook settings** ตรวจว่า Webhook URL เป็น URL ด้านล่างทุกตัวอักษร หากไม่ตรงให้วาง URL แล้วกด **Update**
3. กด **Verify** ที่ Webhook URL ต้องเห็นผล **Success** หากไม่สำเร็จ อย่าเริ่มจับคู่ผู้ปกครอง ให้ตรวจ URL แล้วลองอีกครั้ง
4. เปิดสวิตช์ **Use webhook** ให้แสดง Enabled/On สวิตช์นี้แยกจากผล Verify และแยกจากสถานะ `active` ใน Solo Tutor
5. เปิด [LINE OA Manager ของ `@458gfbxa`](https://manager.line.biz/account/@458gfbxa/) ไปที่ **Settings → Response settings** เปิด Webhook และปิด Greeting message/Auto-response ระหว่างทดสอบ เพื่อไม่ให้ผู้ปกครองได้รับข้อความซ้ำ
6. กลับ [หน้าตั้งค่า LINE OA ใน Solo Tutor](https://tasachii.github.io/solo-tutor/#/app/settings/line) ในโหมดข้อมูลจริงและบัญชีครูเดิม กด **ตรวจสถานะอีกครั้ง** ชื่อที่แสดงต้องเป็น Solo Tutor ไม่ต้องกรอก token ซ้ำหากสถานะยัง active

Webhook ของโปรเจกต์นี้:

```text
https://qbuafdbmpkffzbkqoysb.supabase.co/functions/v1/line-webhook
```

URL เดียวรองรับหลาย OA โดยเลือก secret จาก `destination` ใน body และตรวจ signature ก่อนประมวลผล ไม่ต้องใส่ channel ID ใน query string

หลังเชื่อมสำเร็จจึงทดสอบจับคู่กับ LINE ของทีมที่ได้รับอนุญาตก่อน การกดส่งบิลจริงยังเป็นการกดเองจากหน้าแอดมิน ดูลำดับเดโมที่ [LINE demo runbook](line-demo-runbook.md)

## เตรียมระบบ

1. เลือก Supabase project สำหรับ Solo Tutor และรัน migrations ใน `supabase/migrations/` ตามลำดับ ใช้ Supabase CLI ที่ติดตั้งไว้ (`supabase link --project-ref <project-ref>` แล้ว `supabase db push`) หรือ SQL Editor รันแต่ละไฟล์ตามลำดับ อย่าใช้ test bootstrap กับฐาน production
2. ใช้บัญชีครูที่สมัครผ่านแอป บัญชีนี้เป็นเจ้าของ OA หนึ่งบัญชี; การตั้ง SMTP/email confirmation จริงยังเป็นงานก่อนเปิดรับครูจริง ดู `launch-status.md`
3. ตั้งค่าฝั่งเว็บตาม `.env.example`: `VITE_SUPABASE_URL` และ `VITE_SUPABASE_PUBLISHABLE_KEY` ใช้ publishable key เท่านั้น หรือ legacy anon key ที่มี role anon ห้ามใช้ service role/secret key
4. GitHub Pages อ่านค่าข้างต้นจาก Repository Variables (`Settings > Secrets and variables > Actions > Variables`) ใน build job แล้วต้อง build ใหม่ ค่า public สองค่านี้ไม่ใช่ LINE token
5. ตั้ง Edge Function secrets ผ่าน Supabase Dashboard: `LINE_SECRET_KEY` เป็นค่าสุ่มอย่างน้อย 32 ตัวอักษรสำหรับเข้ารหัส credential, `LINE_WEBHOOK_URL=https://<project-ref>.supabase.co/functions/v1/line-webhook`, `LINE_ALLOWED_ORIGIN=https://tasachii.github.io`, `LINE_CRON_SECRET` เป็นค่าสุ่มคนละตัวกับ key เข้ารหัส ส่วน `SUPABASE_SERVICE_ROLE_KEY` ใช้ค่าที่ runtime จัดให้ ไม่ใส่ในหน้าเว็บ
6. Deploy Edge Functions `line-connect`, `line-webhook`, `line-send` ด้วย config ที่อยู่ใน `supabase/config.toml` รักษาการตรวจ JWT/signature ใน handler ไม่ตั้ง cron ในรอบนี้ การส่งจากเว็บต้องกดเอง

## เชื่อมบัญชีและผู้ปกครอง

1. เปิด LINE Official Account Manager ของบัญชีที่ต้องการ แล้วเปิดใช้งาน Messaging API
2. ใน Solo Tutor โหมดข้อมูลจริง เปิดเมนู **เชื่อม LINE OA** หรือหน้าแอดมิน > **ตั้งค่า LINE OA และเชื่อมผู้ปกครอง**
3. เข้าสู่ระบบด้วยบัญชีครู แล้วกรอก Channel secret และ Channel access token จาก LINE Developers เฉพาะในฟอร์มนี้ ค่าเหล่านี้ส่งตรงไป Edge Function และไม่ถูกบันทึกลง browser storage
4. ตรวจชื่อ OA ที่แอปอ่านกลับจาก LINE ตั้งค่า webhook และเปิด **Use webhook** ใน LINE Developers หากเปิดข้อความทักทาย/ตอบอัตโนมัติไว้ ให้ตรวจไม่ให้ซ้ำกับการตอบของ webhook
5. สร้างรหัสให้ผู้ปกครองแต่ละคน ก่อนออกรหัสระบบจะซิงก์รหัส local และชื่อผู้จ่ายทุกรายในสมุดข้อมูลปัจจุบันไปยัง LINE workspace บน Supabase แล้วออกรหัสใช้ครั้งเดียวสำหรับผู้จ่ายที่เลือก การซิงก์รายชื่อนี้ไม่ส่งรายละเอียดสมุดรายรับ บิล หรือยอดชำระไปยังตาราง LINE ให้ผู้ปกครองเพิ่มเพื่อน OA แล้วพิมพ์รหัส 6 หลักในแชท รหัสใช้ครั้งเดียว/หมดอายุภายใน 24 ชั่วโมง อย่าเผยแพร่รหัสในกลุ่ม
6. กด **ตรวจสถานะอีกครั้ง** ให้เห็นว่าเชื่อมแล้ว ก่อนกด **ส่งด้วย LINE OA** ในหน้าแอดมิน

## ผลส่งและการกู้คืน

- แอปเก็บตัวตนสมุดข้อมูลและรายการส่งก่อนเรียก API ใช้ dedupe ตามสมุดข้อมูลและชนิดรายการ และ LINE retry key เดิม การกดส่งหนึ่งครั้งส่งเฉพาะข้อความนั้น
- นับว่าส่งแล้วเมื่ออ่าน outbox กลับเป็น `sent` เท่านั้น ซึ่งหมายถึง LINE รับคำขอแล้ว ไม่ได้ยืนยันว่าผู้ปกครองอ่าน
- หากเครือข่ายขาด รายการค้างจะอยู่หลัง reload ให้กด **ตรวจสอบผลส่ง LINE OA** ห้ามแชร์เองซ้ำระหว่างยังไม่ทราบผล
- **ยกเลิกเมื่อยืนยันว่าไม่ส่ง** สำเร็จได้เฉพาะเมื่อเซิร์ฟเวอร์ยืนยันว่ารายการยังไม่เคยเริ่มส่ง หรือถูกปฏิเสธแน่นอนตั้งแต่คำขอแรกโดยไม่มีความคลุมเครือ จากนั้นเปิด LINE เพื่อส่งเองได้ รายการที่อาจเริ่มส่งแล้วต้องให้ผู้ดูแลตรวจ outbox/ผล LINE ก่อน
- สมุดข้อมูลที่เชื่อม OA แล้วต้องใช้บัญชีเดิมเพื่อตรวจประวัติก่อนแชร์เอง การกู้ backup ที่มี workspace identity เดิมใช้ semantic dedupe เดิมเพื่อลดการส่งซ้ำ อย่าส่งด้วยสำเนา backup ก่อนเปิดใช้ OA ซึ่งยังไม่มี identity นี้
- ระหว่างมีรายการ OA ค้าง ระบบป้องกันการแก้ข้อความ/ทิ้งข้อมูลค้าง และการแก้ยอดที่ทำให้ข้อความการเงินเปลี่ยน หากจำเป็นต้องแก้ยอดให้ยกเลิกรายการที่ยังไม่ส่งหรือตรวจผลให้จบก่อน
- ออกจากระบบเครื่องนี้ล้าง session ในแท็บ ไม่ยกเลิก OA ฝั่งเซิร์ฟเวอร์ ปุ่ม **ยกเลิกการเชื่อม OA** ล้าง credential ฝั่งแอปและหยุดคิวที่ยังไม่ส่ง ส่วนคำขอที่เริ่มไปแล้วอาจยังถึง LINE ต้อง revoke token ที่ LINE Developers หากต้องการเพิกถอนสิทธิ์ฝั่ง LINE
- ตัวนับในแอปเป็นโควตาของ Solo Tutor ไม่รวมข้อความจาก OA Manager หรือระบบอื่น ให้ตรวจยอดจริงใน OA Manager

## ตรวจรับก่อนเปิดจริง

ชุดทดสอบ local/mock ไม่มีการส่งถึงผู้ปกครองจริง:

```sh
npm run check
npm test
npm run test:db
npm run test:edge
VITE_SUPABASE_URL=https://line-qa.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_qa SOLO_LINE_QA=1 SOLO_QA_PORT=4207 npm run e2e -- line-oa --project=desktop
```

หลัง deploy ให้ตรวจด้วยบัญชี LINE ทดสอบที่เจ้าของอนุญาต: ชื่อ bot ตรงบัญชี, webhook Verify และ follow ผ่าน, รหัสหมดอายุ/ใช้ซ้ำถูกปฏิเสธ, ผู้ปกครองผูกถูกคน, ส่งหนึ่งข้อความผ่านและไม่มีซ้ำเมื่อ retry, ผู้ใช้ต่างบัญชีอ่านข้อมูลกันไม่ได้, ยกเลิก OA แล้วส่งไม่ได้ เก็บผลตรวจโดยไม่บันทึก secret/token ลง log หรือ screenshot

ยังไม่รวมในรอบการเชื่อมนี้: นำแชท OA มาแสดงในแอป, ส่งตามเวลา/cron และการจับคู่ผู้ปกครองด้วยมือ

## สิ่งที่เจ้าของต้องกดให้เสร็จก่อนสาธิต LINE จริง

- [ ] LINE Developers → channel Solo Tutor → Messaging API → Webhook URL ตรงกับ URL ในเอกสารนี้
- [ ] กด **Verify** แล้วผลเป็น **Success**
- [ ] เปิด **Use webhook** เป็น Enabled/On
- [ ] LINE OA Manager `@458gfbxa` → Settings → Response settings → เปิด Webhook
- [ ] ปิด Greeting message และ Auto-response ระหว่างการทดสอบ
- [ ] ใช้เฉพาะบัญชี LINE ของทีมที่อนุญาตเพิ่มเพื่อนและพิมพ์รหัสทดลอง
- [ ] ก่อนเชิญผู้ปกครองจริง ให้ออก Channel secret/token ใหม่และเชื่อมแอปใหม่ เพราะค่าเดิมเคยปรากฏนอกฟอร์มลับระหว่างการตั้งค่า

อ้างอิง: [LINE Messaging API](https://developers.line.biz/en/docs/messaging-api/getting-started/), [Webhook signature](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/), [Retry key](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/), [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys), [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)
