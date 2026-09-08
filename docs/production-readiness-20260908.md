# Solo Tutor — ผลตรวจและรายการก่อนเก็บเงินจริง

> รายงานรอบแรก: ดู [สถานะล่าสุดและงานที่ปิดเพิ่ม](launch-status.md) สำหรับการลบบัญชี paid, payment evidence, CSP/cache และการเชื่อมฐานข้อมูลรอบต่อมา

ตรวจ 8 กันยายน 2569 จากโค้ดตั้งต้น `fe911805` และชุดแก้ใน workspace นี้ ผู้ใช้สั่งให้รักษา Demo และใช้ mock ก่อน รายงานนี้ไม่ใช่การรับรองกฎหมายหรือหลักฐานว่าได้ deploy การแก้ไป production แล้ว

## ผลตัดสิน

ใช้สาธิตและทดสอบวงจรผลิตภัณฑ์ด้วย mock ได้ การเชื่อม Supabase เพียงอย่างเดียวยังไม่ทำให้พร้อมรับเงินจริง ต้องปิดเรื่องผู้ให้บริการ/ซัพพอร์ต/นโยบายข้อมูล/SMTP และขั้นตอนรับเงินจริงก่อนเปิด paid pilot

ไม่ลบไฟล์ seed หรือข้อมูล mock ไม่ส่ง LINE จริง ไม่สมัครบัญชีจริง ไม่รับเงิน ไม่แก้ข้อมูล production และไม่ deploy ในรอบนี้ `docs/handoff.md` เป็นไฟล์เดิมของเจ้าของและไม่ถูกแก้

## เรียงตามสิ่งที่ขาดแล้วรับเงินจริงไม่ได้

| ลำดับ | เรื่อง | โค้ดและสิ่งที่แก้แล้ว | สิ่งที่ยังต้องปิดก่อนเปิดจริง |
|---|---|---|---|
| 1 | ข้อมูลครูต้องไม่หาย | login, เข้ารหัส, ย้าย local ไป cloud เดิมมีแล้ว; แก้ pull ทับข้อมูลที่เพิ่งแก้, account-switch race, conflict false success; เพิ่มไฟล์กู้คืนกุญแจ, จำนวนรายชื่อสองฝั่ง, สำรองก่อน pull | ทดสอบบัญชีจริงสองเครื่องหลัง deploy, แจก/ทดลอง recovery ให้ครูกลุ่มแรก; SMTP และ password reset ยังไม่เปิดใน UI; คนที่ไม่มีรหัสเดิม/กุญแจ/backup ยังไม่อาจกู้ ciphertext ได้ |
| 2 | PDPA และสิทธิข้อมูล | StorageStatus อยู่เฉพาะแอปครู; privacy เปิดเผย telemetry/LINE/cloud; ตัวเลือก contact จาก environment; ปุ่มลบบัญชีพร้อม password reauthentication และ server cascade; paid receipt มี guard กันลบผิด | ชื่อผู้ให้บริการและช่องทางติดต่อจริง, บทบาทตามข้อมูลแต่ละชุด, DPA, ฐานการประมวลผลเด็ก, retention และกระบวนการคำขอจากผู้ปกครองต้องตรวจโดยผู้เชี่ยวชาญ; paid-account erasure ยังต้องดำเนินการตามนโยบายเอกสารที่อนุมัติ |
| 3 | รับเงินค่าสมาชิกและเปิดสิทธิ์ได้ถูกต้อง | ปิด paid request ถ้าช่องทางรับเงิน/ผู้ให้บริการ/ซัพพอร์ตไม่ครบ; คงแพ็กที่เลือกจากหน้าราคา; ตรวจความล้มเหลวของคำขอ/ยกเลิก; กัน duplicate pending และเลขใบเสร็จชนกันแม้ยิงพร้อมกัน/เลขเกิน 9999 | ใส่ PromptPay เจ้าของจริงและซ้อมตรวจยอด–อนุมัติ–ใบเสร็จ–คืนเงิน; ไม่มี gateway/card/autodebit/reconciliation จากธนาคารในงานนี้ การอนุมัติ mock ไม่ยืนยันว่ารับเงินจริงได้ |
| 4 | ครูต้องติดต่อคนได้ | เมนู Help, support link, คู่มือ PDF ใหม่; operations check เตือนงานค้างและ client errors ผ่านสถานะ Actions | ผู้รับผิดชอบและเวลาตอบจริง, LINE OA/อีเมลของ Solo Tutor, เปิด notification และซ้อมรับ alert; OA ของครูเป็นคนละบัญชีกับช่องทางซัพพอร์ตของเรา |
| 5 | ยกเลิก/พัก/หมดอายุ/ออกจากบริการ | อธิบายว่าไม่มีตัดเงินอัตโนมัติ; ยกเลิก pending ได้; pause/resume ใช้ได้เมื่อเลยวันหมดอายุเดิม; export และ backup ยังคงมีหลังกลับฟรี | เงื่อนไขคืนเงินและข้อยกเว้นที่ตรวจแล้ว, SLA ตรวจยอด, retention หลังเลิกใช้, เอกสารภาษีที่เหมาะกับสถานะกิจการ |
| 6 | ป้องกันการใช้ทรัพยากรเกินและข้อมูลข้ามบัญชี | public ingestion บังคับ Origin, จำกัดขนาด body แบบ stream, atomic rate limit ต่อ client/global, hash IP; RLS/grants และ tests; error payload ไม่ส่งชื่อ/ข้อความ exception/URL token | deploy migration ก่อน functions, secret limiter, ตรวจ header IP ที่ edge ได้จริง; Origin ปลอมได้ ไม่ใช่ authentication และ limiter ไม่ใช่ DDoS firewall |
| 7 | Deploy/backup/การตรวจพบปัญหา | CI เพิ่ม Supabase+LINE mock ทั้ง Chromium/WebKit; offline ตั้งแต่ติดตั้งครั้งแรก; ไม่ลบ cache แอปอื่น; error/rejection/network failure monitoring; hourly operations checks | email confirmation ของ production ยังปิดตามข้อมูลตรวจครั้งนี้; backup นอก GitHub และคนถือกุญแจแยกบัญชี; HTTP security headers/domain/restore drill บนรุ่นหลัง migration |

## สิ่งที่ควรมีภายใน 1–2 เดือน

- Onboarding และ import มีแล้ว แก้การปัดทศนิยมราคา/จำนวนแพ็กและการข้ามฟอร์มที่ไม่ถูกต้อง คู่มือ PDF 4 หน้าอยู่ที่ `public/solo-tutor-guide.pdf` และลิงก์ใน `/app/help` วิดีโอสอน 2 นาทียังไม่ได้ผลิต
- มี `revenue_monthly`, `monthly_plan_month2_renewal` และ usage ที่ผูก provider เฉพาะ bearer ผ่าน Auth แล้ว ใช้ `scripts/paid-usage.sql` ดูการเปิดใช้งานของผู้จ่ายจริง ยังไม่มี dashboard ฝ่ายธุรกิจแยกต่างหาก
- ตัวเลข cohort เป็นการต่อแพ็กเดือนที่สองตามเดือนปฏิทินที่ครบแล้ว ไม่ใช่ survival ของทุกแพ็ก ไม่เอารายปี/3เดือนมาปนเป็น churn และไม่มีข้อมูล refund ledger จึงเป็นยอดรับอนุมัติขั้นต้น ไม่ใช่รายได้สุทธิทางบัญชี
- Anonymous usage วัดอุปกรณ์ ไม่ใช่คน; logged-in usage เป็น client events จึงตกหล่นได้จาก offline/ad blocker/session หมดอายุ ไม่ใช้เป็นหลักฐานชำระเงิน
- ควรมีช่องทางติดตาม/ตอบ error, escalation และซ้อม restore เป็นกิจวัตร; Actions สีแดงไม่รับประกันว่ามีมนุษย์เห็น

## รายการบั๊กที่ปิดในชุดนี้

| ปัญหา | จุดแก้/หลักฐาน |
|---|---|
| กล่องล็อกและปุ่ม backup โผล่หน้าผู้ปกครอง/หน้าขาย | `App.tsx`, `AppShell.tsx`; regression ครอบคลุม route สาธารณะและ recovery |
| Cloud pull ทับ local edit ที่เกิดระหว่างรอ | `CloudSync.tsx`, `core/cloudSync.ts`; generation/account/revision checks, serialize/abort |
| เลือก pull แล้วแจ้งสำเร็จทั้งที่ restore ถูกปฏิเสธ | ยืนยันผล dispatch ก่อนบันทึก sync metadata และแจ้งผล |
| กุญแจผิดเขียนทับกุญแจดี / KDF ที่ไม่รองรับ | ตรวจ decrypt ก่อน persist; recovery ผูกบัญชีและตรวจ remote; ปฏิเสธ KDF ที่ไม่รองรับ |
| ขาดวิธีกู้ข้อมูลหลังรหัสเปลี่ยน | export/import recovery key; ไม่มีปุ่มลืมรหัสผ่านที่อ้างว่ากู้สมุดบัญชีได้อัตโนมัติ |
| เหมาเดือนคิดเงินก่อนเริ่มเรียน/หลังหยุด | effective dates และ regression ไม่เปลี่ยนประวัติที่ปิดแล้ว |
| เดือนเหมาไม่มีคาบไม่ปรากฏให้ปิดยอด / กลับมาเรียนแล้วคิดช่วงหยุดย้อนหลัง | เพิ่มเดือนตามช่วงสัญญา จำกัดการไล่ย้อนหลัง 120 เดือน; เก็บ service intervals, วันเริ่มเงื่อนไขเหมา และกันเปลี่ยนเงื่อนไขเมื่อมีบิลร่าง/งานเก่ายังไม่ปิด |
| ราคาและจำนวนครั้งนำเข้าเป็นทศนิยมถูกปัดเงียบ | validation ปฏิเสธค่าที่อยู่นอกสัญญาจำนวนเต็ม |
| Pending plan ซ้ำและเลขใบเสร็จชน | lock provider, partial unique index, counter แยกเดือนและขยายเลข 10000+; ทดสอบ concurrency บน PostgreSQL |
| endpoint เขียนได้โดยไร้เพดาน | migration 0007, 3 ingestion handlers + delete-account limiter, streamed payload limit |
| ขาดบัญชีลบจริง | `delete-account` verify bearer และรหัสผ่าน; migration 0008 กันลบ paid receipts; สำเร็จจึงล้าง local; ไม่ใช่การลบข้อมูลจริงระหว่าง QA |
| ไม่มี async error monitoring / รายงานอาจมีข้อมูลใน exception | global error/rejection/request event; payload allowlist, ตัดข้อความ exception และ URL id/token, dedupe |
| offline ครั้งแรกพัง / SW ลบ cache ทุกแอปใน origin | precache shell+assets+font ก่อน ready; ลบเฉพาะ namespace ของแอป; ไม่ cache 404/503 แทน shell |
| Google Fonts ส่ง IP และออฟไลน์ฟอนต์หาย | self-host Anuphan พร้อม OFL license และ precache; ไม่มี Google Fonts request ในรุ่นใหม่ |
| ขาด CSP | CSP meta ลด script/object/connect surface; ไม่ render app data เมื่อ embedded; ยังต้องมี HTTP `frame-ancestors` |
| React type ไม่ตรง runtime / `as never` config | types ปรับเป็น React18; Vite config ใช้ typed `vitest/config` |
| CI ข้ามบัญชีและ LINE | job integrations กับ `npm run e2e:mock`; block SW ใน mock suite เพื่อไม่ให้ WebKit request หลุด interception |

## ข้อกล่าวอ้างเดิมที่ต้องแก้ความเข้าใจ

1. `frame-ancestors` **ใช้ใน CSP meta ไม่ได้** ต้อง response header จริง ([W3C CSP](https://www.w3.org/TR/CSP/latest/#frame-ancestors)) ชุดนี้จึงไม่ใส่ meta directive ที่ไม่มีผล การไม่ render เมื่อถูก frame เป็นชั้นเสริม ไม่เทียบเท่า header
2. ไม่ได้จำเป็นต้องจดบริษัทก่อนใช้ gateway ทุกเจ้า Omise มีขั้นตอนสมัครแบบบุคคลธรรมดาตามเงื่อนไขของเขา ([Omise live account](https://docs.omise.co/th/how-do-i-enable-live-account/thailand)); ทะเบียนพาณิชย์และนิติบุคคลเป็นคนละเรื่อง ต้องตรวจกรณีกิจการจริง
3. ราคา 299/เดือนไม่ได้บังคับว่าต้อง autodebit เสมอ แพ็กล่วงหน้าโอนมือใช้เป็นรูปแบบธุรกิจได้ถ้าบอกชัดและให้บริการได้ครบ งานนี้รักษารูปแบบนั้น; recurring เป็นโครงการถัดไปหลังเลือก gateway ([Omise recurring](https://docs.omise.co/th/how-to-do-recurring-payments/thailand))
4. Publishable/anon key ใน client ไม่ใช่ secret leak โดยตัวมันเอง ต้องอาศัย RLS/grants; ห้าม service role/secret key ฝั่ง client ([Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys))
5. ข้อมูลเด็กไม่ได้หมายความว่าทุกกรณีต้องใช้ consent เป็นฐานเดียว ต้องให้ผู้เชี่ยวชาญพิจารณาข้อเท็จจริง บทบาทและฐานตาม PDPA โดยเฉพาะมาตรา 6, 20, 23, 33, 37 และ 40 ([พระราชบัญญัติ](https://ratchakitcha.soc.go.th/documents/17082307.pdf))
6. เกณฑ์ VAT 1.8 ล้านบาท/ปีมีบริบทประเภทธุรกิจและข้อยกเว้น ต้องตรวจภาษีจริง ไม่ใช้ข้อความในแอปแทนคำวินิจฉัย ([กรมสรรพากร](https://www.rd.go.th/7061.html))

## ข้อจำกัดที่ยังไม่ปิดด้วยโค้ดรอบนี้

- ไม่มี live gateway, การคืนเงินอัตโนมัติ, webhook การชำระเงิน, chargeback/reconciliation, ใบกำกับภาษีเต็มรูปแบบ
- DPA/retention/การลบบัญชีที่มีหลักฐานการเงินยังต้องอนุมัตินโยบายก่อน; มีร่างรายการให้ตรวจใน `legal-review-draft.md` ไม่เผยแพร่เป็นสัญญาสำเร็จรูป
- การลบนักเรียนที่มีประวัติ invoice/completion เป็นการหยุดเรียนและเก็บประวัติ ไม่ใช่ลบข้อมูลส่วนบุคคลทั้งหมด; ประวัติส่ง OA ขวางการลบด้วย ต้องกำหนดกระบวนการลบเฉพาะรายและ retention ก่อนรับคำขอสิทธิจริง
- Supabase email confirmation ยังต้อง SMTP จริงและการตั้งค่าของเจ้าของ ไม่มีการเปิดปิด production ให้ในงานนี้
- GitHub Pages ยังไม่มี HTTP CSP `frame-ancestors`; โดเมน/hosting ต้องตัดสินใจก่อนส่งลิงก์ถาวรและย้ายต้องรักษาลิงก์เก่า
- **ต้องแยก origin สำหรับข้อมูลจริง**: `tasachii.github.io/solo-tutor/` ใช้ origin เดียวกับโปรเจกต์ Pages อื่นของเจ้าของ JavaScript จาก sibling path จึงอ่าน localStorage (ledger/token/key) ได้ เปลี่ยนชื่อ key หรือ scope ของ SW ไม่ได้แยกสิทธิ์ ควรย้ายไป dedicated domain/origin และวางแผนย้ายข้อมูล/หมุน session อย่างถูกต้องก่อนรับข้อมูลเด็ก ([MDN localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage))
- Backup รายสัปดาห์เก็บ artifact 90 วันยังพึ่งบัญชี GitHub เดียว ไม่ใช่ PITR หรือ offsite independent backup; free keepalive ไม่เท่ากับแผนกู้ภัย
- เพดานนักเรียนฝั่ง client ยังแก้ข้ามได้ด้วย localStorage เพราะ ciphertext ไม่มีจำนวนที่ server เชื่อถือได้ ต้องยอมรับ trade-off หรือเปลี่ยนสัญญาข้อมูล/สิทธิ์ที่ server บังคับได้
- JavaScript bundle หลักยังใหญ่และยังไม่มี route lazy loading; ไม่แลกความถูกต้องของ offline กับการ split ที่ไม่ precache routes
- CSP `connect-src` ยังอนุญาต `https://*.supabase.co`; ขอบเขตแคบกว่านี้ทำได้ด้วยการใส่ origin ของ project ตอน build เป็นงาน hardening ต่อ ไม่อ้างว่า CSP ป้องกันการส่งข้อมูลไปทุก project ภายนอกได้แล้ว
- SW ใช้ cache version `v4` คงที่ ต้องเพิ่ม version เมื่อปล่อยการเปลี่ยน SW/asset ที่ URL ไม่เปลี่ยน หรือพัฒนาการ stage cache ต่อ release เพื่อไม่ให้ future partial install แตะ cache ที่ active อยู่
- ไม่มี ESLint ติดตั้งในรอบนี้ ไม่เรียก typecheck ว่า lint; คำสั่ง check ทำ TypeScript และ whitespace validation
- การทดสอบนี้ไม่ใช่ penetration test, load test ระดับ production หรือ accessibility audit ด้วย assistive technology จริงทุกชนิด
- LINE mock ตรวจ protocol ได้ แต่ยังต้องทดสอบ channel/account เจ้าของจริง, quota และ delivery feedback; ผลอ่านสลิปจำลองคงอยู่เฉพาะ Demo

## ตรวจซ้ำและ rollout

ดู `production-rollout.md` สำหรับลำดับ migration/secret/functions/frontend และคำสั่งทดสอบ ผลรอบสุดท้ายบันทึกใน `qa-verification-20260908.md` หลักฐาน mock แยกจาก read-only production probe เสมอ
