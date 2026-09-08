# Solo Tutor — ส่งต่องานสำหรับพิทช์

อัปเดต 8 กันยายน 2569 · ขอบเขตล่าสุด A → B → C + LINE OA วันนี้

> **เอกสารหลักสำหรับส่งต่อ:** ไฟล์ `handoff.md` ที่ root ของ repository นี้เป็นเอกสารอ้างอิงหลักสำหรับ Claude Code และผู้รับช่วงงาน production ให้เริ่มอ่านจากไฟล์นี้ก่อนเสมอ ส่วน `docs/handoff.md` เป็นเอกสารเก่าที่เจ้าของเก็บไว้และอาจมีขอบเขตล้าสมัย หากข้อมูลขัดกันให้ยึดไฟล์นี้กับโค้ด/ผลทดสอบปัจจุบัน ห้ามแก้ production ตามเอกสารเก่าโดยไม่ตรวจหลักฐานใหม่
>
> ตัวเลข **65–70%** ที่อาจใช้คุยเรื่องความพร้อม เป็นเพียงค่าประเมินความมั่นใจจากพื้นผิวโค้ดและ automated tests ที่ตรวจแล้ว ณ วันนี้ ไม่ใช่เปอร์เซ็นต์งานเสร็จ, SLA, การรับรอง PDPA หรือหลักฐานว่า production ผ่านครบทุก endpoint งานที่เหลือเป็นงาน live, กฎหมาย, บัญชีเจ้าของ และการทดสอบกับคน/อุปกรณ์จริงซึ่งมีน้ำหนักความเสี่ยงสูงกว่าจำนวนรายการ จึงอาจทำให้ค่าประเมินเปลี่ยนได้มาก

## เปิดใช้งานและไฟล์ส่งมอบ

- เว็บ: https://tasachii.github.io/solo-tutor/
- LINE OA: **Solo Tutor `@458gfbxa`** — https://line.me/R/ti/p/@458gfbxa
- feature/demo baseline ที่มี CI สำเร็จ: **`a562d0f`** — [CI / deployment ของ baseline](https://github.com/Tasachii/solo-tutor/actions/runs/34209096863) จุดนี้ไม่ใช่ final revision; SHA และ CI ของรุ่นส่งมอบสุดท้ายให้ดูจาก `git log -1` และ `release-verification.json` ในชุดสื่อหลัง push เสร็จ
- ชุดสื่อ: `~/Downloads/Solo-Pitch-Kit-20260908/`
- สำเนาชุดสื่อ: `~/Documents/Solo-Pitch-Backup-20260908/`
- `Solo-FinalPitch-v4-review.pdf`: สไลด์ 22 หน้า ไม่มีช่องวงเล็บเหลี่ยมค้าง; ตัวเลขที่ยังยืนยันไม่ได้ระบุสถานะไว้ตรง ๆ
- `Solo-Demo-90s.mp4`: วิดีโอ H.264/AAC 1280×900 ยาว 90 วินาที มีข้อความบรรยายบนภาพ ไม่มีเสียงพูด เปิดจากไฟล์ได้
- `solo-demo-kru-ploy-5.json`: ข้อมูล Demo ครูพลอย นักเรียน 5 คน ไม่มีเงินจริง/บัญชีรับเงินจริง
- `Solo-TeamChecklist-Dev-20260908.pdf`: checklist ฝั่ง Dev/Demo สำหรับทีม
- `usage-events-real.csv`: export 32 events ที่ระบุโหมดจริง มีเพียง random ID, event, count, เวลา **ไม่ใช่ 32 ครู** และไม่ใช่รายได้
- `Google-Sheets-Setup/`: Apps Script และขั้นตอนตั้งค่า
- `SHA256SUMS.txt`: ตรวจว่าไฟล์สำเนาตรงกัน

## อัปเดต 8 ก.ย. ดึก — หน้าแรก: เดโมก่อน + เข้าสู่ระบบ/สมัคร เป็นประตูที่สอง · คำว่า "ทวง" → "แจ้งยอด/เตือน" (ยังไม่ push)

commit ในเครื่อง (หลัง `8a03d5e` ที่ deploy แล้ว): `83bb3cf` หน้าแรก/เข้าสู่ระบบ · commit ถัดไป = เปลี่ยนคำ — **ยังไม่ push** รอคำสั่ง (push = deploy)

**หน้าแรกและทางเข้า** (เจ้าของถามว่าควรทำ Login เลยไหม — ตัดสินใจ "เดโมยังเป็นทางเข้าเดียวของคนใหม่ บัญชีเป็นประตูที่สอง" ไม่ทำ login-first เพราะขัด "ฟรี ไม่ต้องสมัคร" และ Solo-Master §11 บอกว่า signup ไม่ใช่ yes ที่นับ)
- แถบบนมีลิงก์ **เข้าสู่ระบบ** → `/login` (ฟอร์มเดิมของหน้าบัญชีครู สลับสมัคร/เข้าสู่ระบบ, `/login?mode=signup` เปิดโหมดสมัคร) hero ยังมีปุ่มเดียวคือ เดโม
- หลังเข้าสู่ระบบ: ยังเดโม → เริ่มโหมดจริงให้ (บอกบนหน้าก่อนกดว่าข้อมูลสมมติจะถูกล้าง) แล้ว **รอผลตรวจคลาวด์ก่อนเข้าแอป** — ครูเปลี่ยนเครื่องได้ข้อมูลเดิมโดยไม่ผ่าน onboarding และไม่ push ทับคลาวด์ · ครูใหม่ไป onboarding · สองฝั่งไม่ตรงกันไปหน้าบัญชีครู · ดึงไม่ได้มีปุ่มเข้าแอปโดยยังไม่ซิงก์ · หน้า onboarding ปิดปุ่มระหว่างคลาวด์กำลังดึงและเด้งเข้าแอปเองเมื่อข้อมูลมา
- ครูโหมดจริงที่ผ่าน onboarding แล้ว เปิด `/` → เข้า `/app/today` เลย (กฎอยู่ใน `src/core/entry.ts`) · `/?stay=1` = ขอดูหน้าขาย ลิงก์กลับหน้าแรกทุกหน้าใช้ค่านี้
- หลักฐาน: unit 521 ผ่าน · e2e mock (login + account) 30 ผ่าน · e2e build ปกติ 66 ผ่าน/20 skipped · รายละเอียดใน `docs/production-ledger.md` ส่วน H
- **รอเจ้าของ**: Supabase Dashboard → Authentication → ปิด "Confirm email" (หรือยืนยันว่าปิดอยู่) ไม่งั้นสมัครจากหน้าแรกแล้วไม่ได้ session · บนเวทีอย่าเล่าปุ่มสมัครเป็นผู้ใช้จริง (ตัวเลขจริงยังเป็นบัญชี 1 = ทีม)

**คำว่า "ทวง"** ใน UI ฝั่งครูเปลี่ยนเป็น "แจ้งยอด/เตือน" ทั้งแอปแล้ว (Solo-Master §3) — ปุ่มที่ชื่อเปลี่ยน: เตือนยอดสั้น · ส่งแจ้งยอดทั้งหมดผ่าน LINE OA · เตือนอีกครั้ง · ขั้น แจ้งยอดแบบสุภาพ/ชัดเจน/รอบสุดท้าย · ข้อความถึงผู้ปกครองไม่เปลี่ยน (สุภาพอยู่แล้ว)

## อัปเดต 8 ก.ย. ค่ำ — แท็บค้างจ่าย/การบ้านบนแอดมิน + งาน ops ที่ปิดแล้ว (push + deploy แล้ว)

commit ใหม่บน `main`: `19f57e3` (ops), `8fa2294` (feature), `93e2932` (handoff) — **push แล้ว 8 ก.ย. 19:18 น. ตามคำสั่งเจ้าของ** · CI "Verify and deploy" run `34225372808` เขียวทั้ง 4 งาน (test / integrations / build / deploy) · หน้าเว็บจริง `tasachii.github.io/solo-tutor` เสิร์ฟ build ใหม่แล้ว (ตรวจว่า chunk Admin มีแท็บ "ค้างจ่าย"/"การบ้าน")

**หน้าแอดมินมีสองแท็บใหม่** (ทำตามคำขอ "ระบบทวงเงิน + ทวงการบ้าน ส่งผ่าน LINE OA ได้จริง")

- **ค้างจ่าย** — บิลค้างทุกใบเรียงตามวันค้าง ยอดคงเหลือ ขั้นแจ้งยอด (สุภาพ/ชัดเจน/รอบสุดท้าย) ร่างที่รอส่ง แจ้งยอดล่าสุด และป้ายว่าผู้ปกครองเชื่อม OA แล้วหรือยัง · **เตือนยอดสั้น** สร้างข้อความเตือนยอดวันละใบต่อบิล · **ส่งแจ้งยอดทั้งหมดผ่าน LINE OA (n)** ส่งทีละใบตามลำดับ ข้ามคนที่ยังไม่เชื่อมพร้อมเหตุผล ครูเห็นทุกข้อความก่อนกด (ไม่มีส่งอัตโนมัติตามเวลา — จุดยืน "ครูกดส่ง" คงเดิม) · ชื่อแท็บใช้ "ค้างจ่าย" ไม่ใช่ "ทวงเงิน" ตาม Solo-Master §3/§12
- **การบ้าน** — มอบหมายให้หลายคนพร้อมกันพร้อมกำหนดส่ง ระบบร่างข้อความแจ้งผู้ปกครองต่อคน · เลยกำหนดแล้วยังไม่กด "ได้รับแล้ว" → ร่างเตือนการบ้านเกิดเอง เตือนซ้ำได้วันละใบ · ได้รับแล้ว → ร่างเตือนถอนตัวเอง · ข้อมูลอยู่ใน `AppState.homework` (array เสริม ไฟล์สำรอง/ข้อมูลเก่าเปิดได้ ซิงก์ตามสมุดบัญชี) · Solo-Master §5/§17 ระบุว่าการบ้านอยู่นอกแกน "ออกบิลและจัดการเงิน" — ทำเพราะเจ้าของขอ แนะนำไม่ใส่ในเรื่องเล่าหลักบนเวที
- ทั้งสองแท็บส่งผ่าน OA ด้วยโค้ดเดียวกับการ์ดข้อความ (`src/app/oaSend.ts`) → dedupe/quota/ผลส่งชุดเดิม · เดโม default มีการบ้านตัวอย่าง 2 รายการโดยจำนวนร่างเริ่มต้นยังเป็น 3

**ops/ledger ที่ปิดในรอบนี้**: E-02 alert เป็น GitHub Issue · E-03 CORS บน 413 · E-04 backup AES-GCM + ถอดกลับเทียบก่อนเก็บ + `docs/backup-restore.md` · E-06 rate-limit 403 · E-07/E-10 · A-09 ซ้อม restore ผ่านบน PG17 · B-01 `docs/data-inventory.md` · B-02 · C-02 บางส่วน (webhook ไม่มีลายเซ็น → 401 ก่อนแตะฐาน) · C-04 e2e หน้าเอกสารสาธารณะ · D-01..D-05 · E-09 `docs/incident-runbook.md` — รายละเอียดใน `docs/production-ledger.md` (ส่วน G = ฟีเจอร์ใหม่)

**หลักฐานรอบนี้** (เครื่อง Mac เดิม, HEAD `8fa2294`): unit **516 ผ่าน** · edge **32 ผ่าน** · SQL suite postgres:17 ผ่าน · cross-browser e2e **209 ผ่าน / 43 skipped / 0 ล้ม** (E-01 WebKit ไม่ล้มแล้ว) · LINE mock e2e **45 ผ่าน** (mobile/desktop/webkit) · typecheck + diff-check ผ่าน · สรุปผลอยู่ใน `.omx/evidence/20260908-evening.json` (ไม่ commit)

**ยังไม่ยืนยัน / ต้องเจ้าของ (เพิ่มจากรายการเดิม)**
1. ~~`git push origin main` → รอ CI เขียว~~ **ทำแล้ว** (run `34225372808` ผ่าน, หน้าเว็บจริงมีสองแท็บใหม่) — ที่เหลือคือกด **Run workflow** ของ `Uptime and keep-alive` หนึ่งครั้ง (ข้อ 3)
2. ส่งจริงถึงโทรศัพท์ทีมผ่านแท็บค้างจ่าย: ขั้นตอนเดิมข้อ 1 ด้านล่าง แล้วกด **ส่งแจ้งยอดทั้งหมดผ่าน LINE OA** กับรายชื่อทดสอบ 1 คน ตรวจว่าได้รับ 1 ข้อความและแถวขึ้น "แจ้งยอดล่าสุด"
3. E-02 ยังไม่เคย dispatch จริง — หลัง push ให้กด Run workflow ที่ `Uptime and keep-alive` หนึ่งครั้งเพื่อดูว่างานผ่าน (ถ้าล้มจะเห็น Issue `ops-alert` เปิดเอง)
4. `docs/data-inventory.md` และ `docs/incident-runbook.md` มีช่อง "รอเจ้าของ" (retention, ผู้ถือกุญแจ, ผู้รับ alert, RTO/RPO) ต้องเติมก่อนส่งผู้เชี่ยวชาญ

## งานที่ทำเสร็จแล้ว

| ข้อ | ผลลัพธ์ |
|---|---|
| A1 ราคา | ฟรีสูงสุด 5 / 299 ต่อเดือน / 799 ต่อ 3 เดือน / 2,490 ต่อปี; ปิด Concierge สำหรับติวเตอร์; พาดหัวและคำอธิบายตรวจสลิปตรงของจริง |
| A2 เพิ่มหลายคน | นำเข้า 25 ชื่อพร้อมค่าเริ่มต้นเดียว ข้ามซ้ำ/คนเดิม สร้างครบครั้งเดียว; automated browser ใช้ประมาณ 1 วินาที ไม่ใช่การวัดความเร็วการพิมพ์ของครู |
| A3 สำรอง | ดาวน์โหลด JSON ครบชุด นำกลับได้ ตรวจ schema/ความสัมพันธ์ มีสำรองก่อนทับข้อมูล |
| A4 มือถือ/PWA | manifest, stable ID, icons ปกติ/maskable/Apple และทดสอบ Chromium mobile + WebKit iPhone จำลอง; ยังไม่ใช่ผลเครื่องจริง |
| B5 events | เก็บ 4 events บน Supabase แล้ว; เพิ่ม mirror ไป Sheets เฉพาะโหมดจริง ไม่มีชื่อ/account ID/ยอดเงิน และ export CSV ได้ |
| B6 demo loop | เพิ่มนักเรียน → บันทึกคาบ → บิล → จำลองเปิด LINE → รับเงิน → ใบเสร็จ ผ่าน 3 รอบติด; ไม่มี page error/คำขอไปภายนอก |
| B7 กันพลาด | ตรวจบิลซ้ำ ยอดติดลบ/เกินยอด การลบมีประวัติ; แก้การกดรับเงินบางส่วนซ้ำเร็ว ๆ พร้อมเทส storage failure/retry |
| B8 เตือนค้าง | มีร่างและปุ่มคัดลอกข้อความเตือนอยู่แล้ว ครูตรวจแล้วกดส่งเอง |
| C9–10 เดโม/วิดีโอ | ไฟล์ครูพลอย 5 คนและวิดีโอ 90 วินาทีพร้อม |
| C11 สไลด์ | ทำ PDF ฉบับตรวจทานพร้อม QR จริง; ไม่แต่งยอดจ่าย คำรับรองผู้ใช้ หรือรูปทีม |
| C12 สำรองสื่อ | ทำสำเนาในเครื่องสองโฟลเดอร์พร้อมตรวจ hash; USB/Drive ยังต้องใช้อุปกรณ์และบัญชีทีม |
| LINE วันนี้ | เชื่อม OA ฝั่งเซิร์ฟเวอร์แล้ว, endpoint ตรวจผ่าน, หน้าจอจำลองจับคู่พร้อม; ยังไม่อ้างว่าส่งถึง LINE ของผู้รับจริงแล้ว |

## หลักฐานตรวจสอบ

- Unit **473 ผ่าน**; browser **194 ผ่าน / 40 conditional skips**; Supabase/LINE mock **42 ผ่าน**; Edge **29 ผ่าน**
- SQL contract + concurrency suite ผ่าน; TypeScript, diff check และ production dependency audit ผ่าน ไม่มีช่องโหว่จาก audit รอบนี้
- ผู้รีวิวแยกอนุมัติ payment guard และการแยก Demo/LINE/Sheets
- ฟังก์ชัน `line-webhook` และ `usage` รุ่นนี้ deploy ไป Supabase แล้ว; ไม่มี migration ใหม่ในรอบพิทช์
- OA ฝั่ง server: `active`, ตรวจ token/webhook ล่าสุด `2026-09-08T07:43:06.946Z`; ใช้ webhook URL ด้านล่าง
- shared request guard ถูก deploy ให้ consumer 6 ตัวและ harmless smoke checks ผ่านตาม `shared-guard-deploy-smoke.json` แต่ oversized LINE webhook บน live ยัง timeout แทน `413` จึงเป็น production verification gap ที่ยังเปิดอยู่ ดู `webhook-transport-diagnostic.json` ในชุดสื่อและอย่าอ้างว่า live endpoints ผ่านครบ
- ตัวเลขฐานจริง ณ เวลาตรวจ: บัญชีลงทะเบียน 1 (บัญชีทีม ไม่ใช่หลักฐานลูกค้า), หลักฐานรับเงิน 0, เงินรับสุทธิที่ยืนยัน 0 บาท, outbox ส่งสำเร็จ 0
- การจ่ายนอกระบบ/ข้อมูล local อาจยังไม่อยู่ในตัวเลขข้างต้น ต้องตรวจจากครูและธนาคารก่อนเติม traction
- หลักฐานสื่ออยู่ใน `demo-three-rounds.json`, `slides-verification.json`, `traction-evidence.json` และผลตรวจ live ในชุดสื่อ

## งานที่คุณและทีมต้องทำเอง — เรียงตามสิ่งที่ขวางการใช้งานสัปดาห์นี้

### 1. เปิดรับข้อความ LINE จริงและทดสอบกับบัญชีทีม

จำเป็นต้องใช้บัญชี LINE Developers และโทรศัพท์ของทีม ซึ่ง session นี้ไม่มีหน้า Console ที่ควบคุมได้หรือผู้รับ LINE ที่อนุญาตไว้สำหรับส่งทดสอบ

1. เข้า https://developers.line.biz/console/channel/2011503954 แล้วเปิดแท็บ **Messaging API**
2. ตรวจ **Webhook URL** เป็น `https://qbuafdbmpkffzbkqoysb.supabase.co/functions/v1/line-webhook`
3. เปิด **Use webhook** แล้วกด **Verify** ให้ได้ **Success**
4. ใน LINE OA Manager → Settings → Response settings ตรวจ Webhook; ระหว่างซ้อมปิดข้อความตอบอัตโนมัติ/ทักทายที่ซ้ำกับ webhook และเปิด Chat ถ้าทีมใช้ OA นี้ตอบซัพพอร์ต
5. Secret/token เคยปรากฏในแชท: ออกค่าใหม่ใน Basic settings / Messaging API แล้วกรอกในหน้าแอป **เมนู → เชื่อม LINE OA** ด้วยบัญชีครูเดิมในโหมดข้อมูลจริง อย่าส่งค่าใหม่ในแชทหรือเก็บลง repo
6. เพิ่มรายชื่อทดสอบของทีมที่ไม่มีข้อมูลเด็กจริง กด **สร้างรหัสเชื่อม**
7. โทรศัพท์ของทีมเพิ่มเพื่อน `@458gfbxa` แล้วพิมพ์รหัส 6 หลักนั้นในแชท
8. กลับแอป กด **ตรวจสถานะอีกครั้ง** ต้องเห็นว่าเชื่อมแล้ว
9. ออกบิลทดสอบ ตรวจข้อความ แล้วกด **ส่งด้วย LINE OA** เพียงครั้งเดียว ตรวจว่าปลายทางได้รับหนึ่งข้อความและแอปแสดงส่งสำเร็จ ถ้าไม่ทราบผลให้กดตรวจผลเดิม อย่ากดส่งช่องทางอื่นซ้ำ
10. ระบุรายการของทีมเป็นการทดสอบและไม่นับเป็น traction; ไม่ใช้ mock walkthrough แทนหลักฐานการส่ง LINE จริง

รายละเอียดและการแก้ปัญหา: [docs/line-demo-runbook.md](docs/line-demo-runbook.md)

### 2. ใส่ PromptPay ของทีมและข้อมูลผู้ให้บริการจริง

ต้องใช้หมายเลขที่ Ing ยืนยันว่าเงินเข้าบัญชีทีมจริง และชื่อผู้ให้บริการที่ทีมรับผิดชอบ ไม่สามารถใช้เลขหรือชื่อสมมติแทนได้

1. Ing ยืนยันหมายเลข PromptPay และชื่อเจ้าของบัญชี ให้คนในทีมตรวจชื่อผู้รับก่อนจ่าย
2. GitHub repo → **Settings → Secrets and variables → Actions → Variables** ตั้ง `VITE_SOLO_PROMPTPAY` และ `VITE_PROVIDER_LEGAL_NAME` เป็นข้อมูลจริง
3. ช่องทางติดต่อ `VITE_SUPPORT_CONTACT` ตั้งเป็น OA ของ Solo Tutor ไว้แล้ว จัดคนตอบให้มีจริง
4. ไป **Actions → Verify and deploy → Run workflow** เลือก `main` รอผ่านครบ เพื่อให้ค่าตั้งต้นเข้าเว็บ
5. ครูเปิด **บัญชีครู → ขอเปิด Pro**; Ing ตรวจยอดในรายการธนาคารจริง ไม่ยืนยันจากภาพสลิปอย่างเดียว
6. บันทึกหลักฐาน/เปิดสิทธิ์ตาม [docs/payment-operations.md](docs/payment-operations.md) ห้ามอนุมัติยอดสมมติหรือใช้ SQL อนุมัติรุ่นเก่าที่ไม่มี bank evidence
7. บัญชีฟรียังจำกัด 5 นักเรียน ครูที่มีมากกว่านั้นต้องได้รับสิทธิ์ตามแพ็กที่ทีมตกลงจริง

ถ้าทีมเลือกมัดจำ 100 บาท: บอกชัดว่าเป็นเงินที่จ่ายแล้วจริง กำหนดว่าจะหักค่าบริการเมื่อใดและเงื่อนไขใด เก็บแยกจากค่าสมาชิกเต็มจำนวน **อย่าลงเป็นการชำระแพ็ก 299 บาท** ระบบยังไม่ได้รับข้อกำหนดมัดจำที่ทีมยืนยัน จึงไม่เปิด flow มัดจำหรือแต่งยอดแทน

### 3. สร้าง Google Sheet และเปิด Apps Script receiver

ต้องใช้ Google ของเจ้าของ; ไม่มี Google Sheets/Drive หรือ document session ที่เชื่อมให้สร้างไฟล์แทนในรอบนี้ ตัวนับ Supabase และ CSV ใช้ได้อยู่แล้วแม้ยังไม่ทำขั้นนี้

1. สร้าง Google Sheet ใหม่ ตั้งชื่อ **Solo Tutor Usage** และเก็บเป็นไฟล์ส่วนตัว
2. เปิด **Extensions → Apps Script** วางไฟล์ [docs/usage-sheets/Code.gs](docs/usage-sheets/Code.gs)
3. รัน `setupSheetId()` หนึ่งครั้งจาก editor และอนุญาตเฉพาะ Google ของทีม เพื่อบันทึก ID ของชีตที่ผูกไว้
4. เปิดไฟล์ส่วนตัว `~/.config/solo-tutor/usage-sheets.env` บน Mac นี้ คัดลอกเฉพาะค่าหลัง `=` ไปใส่ **Project Settings → Script properties** ชื่อ `USAGE_WEBHOOK_SECRET` ค่าเดียวกันถูกตั้งบน Supabase แล้ว อย่านำไฟล์นี้ใส่โฟลเดอร์พิทช์/USB/Drive ที่แชร์
5. **Deploy → New deployment → Web app** เลือก **Execute as: Me**, **Who has access: Anyone** แล้วอนุญาตและ deploy
6. คัดลอก URL ที่ลงท้าย `/exec` ไปตั้งใน **Supabase → Edge Functions → Secrets** ชื่อ `USAGE_SHEETS_WEBHOOK_URL` ไม่ต้อง build หน้าเว็บใหม่
7. ทดสอบเปิดโหมดข้อมูลจริงแล้วทำกิจกรรมที่ตกลงไว้ ชีตควรมีคอลัมน์ `random_id,event,count,at`; Demo ต้องไม่ลงชีต อย่าใส่ชื่อเด็กเพิ่มเอง
8. หากชีตยังไม่มา ให้ใช้ CSV ที่เตรียมไว้ หรือรัน `bash scripts/export-usage-events.sh ./usage-events-real.csv` จาก repo ที่ login/link Supabase แล้ว ห้ามแปลง random ID เป็นจำนวนครูแบบแม่นยำ

รายละเอียด: [docs/usage-sheets/README.md](docs/usage-sheets/README.md)

### 4. ทดสอบมือถือเครื่องจริงก่อน Now ไปหาครู

ยังไม่มี iPhone/Android จริงที่ควบคุมได้ใน session นี้ ผล WebKit/Chromium จำลองใช้แทนหลักฐานเครื่องจริงไม่ได้

1. iPhone: เปิดเว็บใน **Safari → Share → Add to Home Screen** แล้วเปิดจาก icon ใหม่
2. Android: เปิดใน **Chrome → เมนู → Install app / Add to Home screen** แล้วเปิดจาก icon
3. ใช้ข้อมูล Demo: เพิ่มชื่อไทยยาว เปิดคีย์บอร์ดกรอกยอด กดปุ่มท้ายฟอร์ม ตรวจไม่มีข้อความล้น ปุ่มซ่อน หรือหน้าขาว
4. ดาวน์โหลด JSON และลองกู้คืนในโปรไฟล์/ข้อมูลทดสอบ สำรองข้อมูลจริงก่อนเปลี่ยนชุดข้อมูล
5. เปิดทุกหน้าที่จะเดโมสักครั้ง แล้วปิดเน็ตและเปิดใหม่ ตรวจหน้าใช้งานและ PDF ที่เก็บในเครื่อง
6. LINE จริงต้องใช้เน็ต ถ้าเน็ตเสียบนเวที เปิดวิดีโอจากไฟล์แทน อย่าให้การส่งบิลซ้ำเป็นทางแก้

### 5. เติมหลักฐานที่ต้องมาจากครูและทีม

1. **Now:** ยืนยันครูที่ใช้จริง นักเรียนที่มีจริง บิลที่ส่งจริง และคำพูดพร้อมสิทธิ์ใช้นาม/รูป
2. **Ing:** ตรวจสลิปกับธนาคาร แยกค่าสมาชิก/มัดจำ/คืนเงิน และบอกวันที่ตัดยอด
3. **Punch:** ส่งฐานนับติวเตอร์ที่ไม่ซ้ำและแหล่งอ้างอิงเพื่อคำนวณ TAM/SAM/SOM ตัวเลขตลาดโรงเรียนกวดวิชา 3.3 พันล้านไม่ใช่ TAM ของ Solo Tutor
4. **ทั้งทีม:** ส่งรูปจริงที่อนุญาตให้ใช้; slide 19 ตอนนี้ใช้อักษรย่อจากสไลด์เดิม
5. แก้ slide 12/16/17/19 ด้วยหลักฐานเหล่านี้ก่อนวันพิทช์ ไฟล์ v4 เป็นฉบับตรวจทานที่ไม่มีช่องว่างค้าง แต่ยังไม่ใช่หลักฐานว่ามีครูจ่ายแล้ว

### 6. คัดลอกลง USB และ Google Drive

สองโฟลเดอร์ที่เตรียมให้เป็นสำเนาบน Mac เครื่องเดียว **ยังไม่ใช่สำเนานอกเครื่อง** ไม่มี USB ที่ mount หรือ Google Drive ที่เชื่อมในรอบนี้

1. เสียบ USB แล้วคัดลอกทั้งโฟลเดอร์ `Solo-Pitch-Kit-20260908`
2. อัปโหลดทั้งโฟลเดอร์เข้า Google Drive ของทีม ให้สิทธิ์เฉพาะสมาชิกที่ต้องใช้
3. เปิด PDF และ MP4 จาก USB จริงหนึ่งรอบ ถอดเน็ตแล้วตรวจ MP4 เล่นครบ
4. หลังดาวน์โหลดจาก Drive ให้ตรวจ hash ด้วย `shasum -a 256 -c SHA256SUMS.txt` ภายในโฟลเดอร์
5. ก่อนขึ้นเวที 30 นาที ตรวจจอ เสียง/บทพูด เน็ต และเปิดไฟล์วิดีโอสำรองค้างไว้

## งานที่พักไว้หลังพิทช์

Omise และ production ใหม่ตามกอง D ไม่ถูกทำต่อในรุ่นนี้ งานเดิมถูกเก็บครบที่ `.omx/deferred-omise/` และ `.omx/deferred-production/` พร้อม patch/snapshot โดยไม่ apply migration ใหม่ บัญชี/cloud/error monitoring/backup ที่เผยแพร่ก่อนหน้านี้ยังอยู่ตามเดิม

ใช้ **Supabase Free ต่อ** สำหรับเดโมนี้ ไม่ได้ซื้อ Pro หรือบริการเสียเงิน ดู [ราคา Supabase](https://supabase.com/pricing) เมื่อประเมินหลังพิทช์

## คำสั่งตรวจซ้ำสำหรับคนรับช่วง

```sh
npm ci
npm run check
npm test
npm run test:db
npm run test:edge
SOLO_CROSS_BROWSER=1 npm run e2e
SOLO_CROSS_BROWSER=1 npm run e2e:mock
```

รัน browser/build ทีละชุด เพราะใช้ `dist` ร่วมกัน ไม่รันพร้อมกัน ต้องมี Docker และ Playwright browsers สำหรับชุด SQL/Edge/browser; QA ใช้ mock/ข้อมูลแยก ไม่ใช้การจ่ายเงินจริงทดสอบ

เอกสารตามงานทั้ง 12 ข้อ: [docs/pitch-week-checklist.md](docs/pitch-week-checklist.md)

---

# ส่วนส่งต่อให้ Claude Code: ปิดช่องว่างก่อน production

## วิธีอ่านสถานะและขอบเขต

ส่วนนี้เป็นแผนดำเนินงานต่อจาก baseline ที่ใช้งานอยู่ ไม่ใช่คำสั่งให้ deploy ทันที ให้จำแนกหลักฐานทุกชิ้นเป็นสามสถานะก่อนแก้โค้ด:

- **อยู่ใน active baseline:** ไฟล์ถูกติดตามใน repository ปัจจุบันและตรวจซ้ำได้จาก commit ที่ checkout อยู่ คำว่า “มีแล้ว” ด้านล่างหมายถึงมี implementation เท่านั้น เว้นแต่ระบุผล live ชัดเจน
- **deferred เฉพาะเครื่อง:** งานอยู่ใต้ `.omx/deferred-production/` หรือ `.omx/deferred-omise/` และยังไม่ได้รวมใน active baseline ห้ามอ้างว่า shipped หรือ restore ไฟล์ทับทีละชิ้น
- **ยังไม่ยืนยัน:** ต้องใช้ production environment, บัญชีเจ้าของ, โทรศัพท์จริง, เนื้อหาที่ผู้เชี่ยวชาญอนุมัติ หรือครูจริง จึงยังถือเป็น production gate แม้ automated tests ผ่าน

`.omx/deferred-*` ถูก ignore และไม่ได้อยู่ใน GitHub clone ใหม่ Claude Code ที่ทำงานบน Mac เครื่องนี้อ่านได้ แต่ agent บนเครื่องอื่นต้องขอ private archive จากเจ้าของหรือ implement ใหม่จาก active baseline ห้ามนำ archive, secret, token, runtime state หรือไฟล์กู้คืนไป commit ใน repository สาธารณะหรือใส่ pitch kit

**ขอบเขตหยุดของคำขอเอกสารรอบนี้:** อ่าน วิเคราะห์ แก้โค้ด และทดสอบ local/mock ได้ แต่ยังไม่อนุญาตให้ apply migration, rotate/set secret, deploy Edge Function, ส่ง LINE, อนุมัติ Pro, แตะเงินจริง หรือนำข้อมูลครูจริงเข้าไป เมื่อผู้ใช้อนุญาต live action ที่ระบุชัดในภายหลัง ให้ถือสิทธิ์นั้นต่อเนื่องตามขอบเขตที่อนุญาตและทำงานให้จบ โดยไม่ถามย้ำในทุกขั้นตอนปกติ

## ลำดับก่อนเก็บเงินจริง

ให้ทำตามลำดับนี้เพราะเรียงตามสิ่งที่ถ้าไม่มีแล้วเก็บเงินอย่างรับผิดชอบไม่ได้ ไม่ได้เรียงตามความยาก:

1. รักษาข้อมูลครูให้กู้คืนและแก้ conflict ได้จริง
2. ปิด PDPA, การลบข้อมูล และสัญญา DPA ด้วยเอกสารที่ผู้เชี่ยวชาญอนุมัติ
3. ยืนยัน LINE OA แบบ end-to-end กับบัญชีและโทรศัพท์จริง
4. เปิด PromptPay/manual Pro ด้วยหลักฐานธนาคารและกระบวนการคืนเงิน/ใบเสร็จ
5. ทำ monitoring, rate-limit alert, backup นอกบัญชี และซ้อม rollback
6. ทดสอบเครื่องจริงและ pilot กับครูจริงโดยไม่ใช้ข้อมูลเด็กก่อน legal gate ผ่าน

## 1) ข้อมูลครู การกู้คืน conflict และ backup

### สิ่งที่อยู่ใน active baseline

- `src/app/Account.tsx` และ `src/app/CloudSync.tsx` มี login/cloud sync, export/import recovery key, conflict summary, สำรองก่อน pull, sign-out, ลบ cloud และลบบัญชี
- `src/core/cloudSync.ts`, `src/core/cloudKey.ts`, `src/core/cloudCrypto.ts` และ `src/integrations/supabaseRest.ts` เป็นขอบเขต snapshot, fingerprint, KDF/key และ transport
- snapshot บน cloud เข้ารหัส; local ledger ยังเป็นข้อมูลอ่านได้ใน browser storage ต้องอธิบายในนโยบายตามจริง
- `tests/unit/cloud-sync.test.ts` ครอบคลุม KDF ที่ไม่รองรับและ pre-pull backup บางส่วน การมีเทสไม่แทนการซ้อมข้ามอุปกรณ์จริง
- migration `0005_ledger_sync.sql`, `0008_account_deletion.sql` และ `0009_paid_account_erasure.sql` เกี่ยวข้องกับ cloud/account lifecycle

### งาน deferred และช่องว่าง

- `.omx/deferred-production/auth-legal-20260908/` เก็บ recovery callback/email confirmation/password reset และ legal acceptance ที่เคยทำไว้ แต่ไม่ได้ shipped ให้เริ่มจาก `MANIFEST.md` และ `auth-legal-tracked.patch`; ต้อง reconcile ทั้งชุดกับ Account/routing/Supabase REST ปัจจุบัน ห้ามคัดลอกเฉพาะ component
- `.omx/deferred-production/root/` มี offsite backup, restore rehearsal, route/callback และ workflow patch ที่ยังไม่ active; `restore-rehearsal.json` เป็นหลักฐาน local ณ เวลานั้น ไม่ใช่ผล production ปัจจุบัน
- ยังต้องพิสูจน์สอง browser/สองเครื่อง, network interruption, local edit ระหว่าง pull, account switching, expired session และ wrong recovery key ว่าไม่ทับ key/ledger ที่ดี
- password reset ห้ามเปิดจน callback ผูกกับ user/session ถูกคน, recovery file ใช้ได้ และ SMTP พร้อม เพราะ ciphertext เดิมต้องไม่กลายเป็นข้อมูลที่เข้าไม่ได้

### ขั้นตอนดำเนินงาน

1. บันทึก `git rev-parse HEAD`, `git status --short` และ inventory migration/Edge Function ปัจจุบันก่อนแตะ archive
2. อ่าน active `Account.tsx`, `CloudSync.tsx`, cloud core และ unit tests เทียบกับ deferred manifest แล้วเขียนรายการ conflict รายไฟล์
3. เพิ่ม regression ก่อน merge สำหรับ stale pull, local edit ระหว่าง await, sign-out/account switch ระหว่าง request, dispatch failure, wrong recovery key และ reset session ผิด user
4. รวม recovery flow เป็นชุดเดียวโดยรักษา key เดิมเมื่อ unlock/reset ล้มเหลว และไม่เสนอการลบ cloud เป็นวิธีกู้รหัสผ่าน
5. ทดสอบ import localStorage เดิมขึ้น cloud โดยไม่ให้ครูกรอกใหม่ พร้อมสร้าง downloadable backup ก่อนการ replace/import ที่ทำลายข้อมูลเดิมหรือก่อนตัดสิน conflict ไม่ต้องสร้าง backup ใหม่ทุกครั้งที่แก้ ledger ตามปกติ
6. ซ้อม restore ในฐานแยก ตรวจจำนวน record, RLS, decrypt ด้วย key ที่ถูกต้อง, ปฏิเสธ key ผิด และยืนยันว่าไม่คืนข้อมูลที่ลบหลัง backup

### Acceptance gate

- เปลี่ยนเครื่องแล้ว login + recovery key เปิด ledger เดิมได้ โดย plaintext ไม่ปรากฏในฐานหรือ log
- edit พร้อมกันสองแท็บไม่ถูก pull เก่าทับ; UI บอกจำนวน local/cloud และให้ผู้ใช้ตัดสินใจ
- request เก่าจากบัญชี A ไม่แก้ state หลัง switch ไปบัญชี B
- ล้มเหลวทุกจุดยังมี backup ที่นำกลับได้ และการแจ้งสำเร็จสะท้อนผลจริง
- restore rehearsal ผ่านในฐานแยกก่อน production; ห้าม restore dump ทับ production โดยตรง

## 2) PDPA การลบข้อมูล และ DPA

### สิ่งที่อยู่ใน active baseline

- `docs/legal-review-draft.md` เป็นรายการข้อเท็จจริง/คำถามให้ผู้เชี่ยวชาญตรวจ และระบุชัดว่ายังไม่ใช่สัญญา
- `src/platform/Legal.tsx` และ `src/copy/index.ts` มีหน้าข้อมูลปัจจุบัน แต่ `legal.contact` ต้องมีช่องทางจริงที่มีคนรับผิดชอบก่อนเปิดรับผู้ใช้
- `supabase/functions/delete-account/index.ts`, migration `0008` และ `0009` รองรับการลบบัญชี; paid record ที่ต้องเก็บถูก detach จาก provider แต่ห้ามเรียกว่า anonymous หรืออ้างระยะเก็บที่ยังไม่ได้อนุมัติ
- `0010_payment_evidence.sql` เก็บหลักฐานอนุมัติ/คืนเงินแบบ manual จึงต้องอยู่ใน retention matrix

### งาน deferred และช่องว่าง

- `.omx/deferred-production/privacy-erasure/privacy-erasure.patch` มีแนวทางลบข้อมูลนักเรียน, tombstone/pending erasure และ LINE remote erase แต่ไม่อยู่ใน active baseline ต้องทบทวน schema/conflict/restore semantics ใหม่ก่อนรวม
- `.omx/deferred-production/auth-legal-20260908/` มี immutable reviewed-document registry, acceptance record, public viewer และ strict three-document paid gate; migration ชื่อ `0012` ใน archive เป็นเพียงชื่อเดิมและอาจชนลำดับจริง
- ยังไม่มี privacy notice, terms และ DPA ที่ผู้เชี่ยวชาญอนุมัติ รวมถึง legal entity/address, lawful basis ข้อมูลเด็ก, subprocessors/region, DSAR, retention และ incident notification process

### ขั้นตอนดำเนินงาน

1. ให้ผู้เชี่ยวชาญกฎหมายตรวจข้อเท็จจริงใน `docs/legal-review-draft.md`; เจ้าของกำหนดชื่อผู้ให้บริการ ที่อยู่ ช่องทางรับคำขอ และผู้ตอบ
2. ทำ data inventory แยก ledger เด็ก, Auth, LINE metadata, payment evidence, waitlist, usage/error/rate limit, backup และไฟล์ดาวน์โหลด พร้อม owner/purpose/access/retention/delete trigger
3. กำหนดบทบาท controller/processor รายวัตถุประสงค์และ DPA ห้ามเหมารวมว่า Solo Tutor เป็น processor เท่านั้น
4. ออกแบบ per-student erasure ให้ tombstone เดินทางข้ามเครื่องและ backup restore ไม่ชุบข้อมูลที่ลบแล้ว ทดสอบ local success/remote failure และ remote success/local failure
5. เมื่อเอกสารได้รับอนุมัติแล้วจึงสร้าง immutable version/digest/content และ acceptance gate ห้าม seed ร่างเป็นเอกสารที่ผู้ใช้ยอมรับแล้ว
6. ทดสอบลบบัญชี free/paid, cross-account denial, concurrent approval/deletion, LINE metadata, usage ที่ผูก account และรายการที่กฎหมายอนุญาตให้เก็บโดยแยกตัวตน

### Acceptance gate

- ผู้ใช้เห็นเอกสารฉบับที่อนุมัติจริงและดาวน์โหลด/อ้าง version ได้; ไม่มี checkbox ยอมรับ “draft”
- ก่อนขอ paid plan ต้องยอมรับ privacy, terms และ DPA version ที่ active ครบตามกติกาที่ผู้เชี่ยวชาญอนุมัติ
- ปุ่มลบบัญชีใช้ re-auth, ลบ Auth/provider/ledger/LINE/operational data และแสดงข้อยกเว้นการเงินตามจริง
- คำขอลบเด็กรายคนไม่กลับมาหลัง sync/restore และมี audit ที่ไม่เก็บข้อมูลเด็กเกินจำเป็น
- ช่องทางติดต่อและระยะตอบสนองใช้งานจริงก่อนครูคนแรก

## 3) LINE OA จริง

### สิ่งที่อยู่ใน active baseline

- UI: `src/app/LineSettings.tsx`; server: `supabase/functions/line-connect`, `line-send`, `line-webhook`; schema: `0001_line.sql`, `0002_line_app_bridge.sql`
- คู่มือ `docs/line-oa-setup.md` และ `docs/line-demo-runbook.md`; demo walkthrough แยกจากการส่งจริง
- automated Edge tests ผ่านในรอบล่าสุด แต่มี production verification gap: local HTTP payload 1,000,001 bytes ตอบ `413` ภายในประมาณ 0.015 วินาที และ live request เล็กแบบไม่มี events/messages ตอบ `200` ประมาณ 1.17 วินาที ขณะที่ live oversized request ยัง timeout ที่ 20 วินาที ไม่ทราบสาเหตุ gateway ที่แน่ชัด จึงห้ามระบุว่า endpoint live ผ่านครบ

### ขั้นตอนดำเนินงาน

1. ตรวจ commit/deployment id ของ Edge consumers ที่ active และจับ log โดยไม่บันทึก channel secret/access token/body ที่มีข้อมูลผู้ใช้
2. วินิจฉัย oversized timeout แยก gateway/runtime/handler ด้วย request ที่สังเคราะห์ ไม่มีข้อมูลจริง และ limit จำนวนครั้ง ห้ามแก้ production ซ้ำโดยไม่มีผลเปรียบเทียบ
3. เจ้าของ rotate LINE channel secret/token ที่เคยเปิดเผย แล้วกรอกผ่านฟอร์มเชื่อม OA ภายในแอปของบัญชีครูที่ยืนยันตัวตน ระบบเก็บ credential ต่อครูแบบเข้ารหัสในฐาน ห้ามนำ credential ต่อครูไปใส่ source, client build variable หรือเอกสาร; Supabase secret ใช้สำหรับ server master key และ secret ฝั่งระบบตาม runbook ไม่ใช่ที่เก็บ channel credential ทุกครู
4. ใน LINE Developers เปิด Use webhook และ Verify; ใช้บัญชีทีมสร้าง code, add friend, pair และตรวจสถานะในแอป
5. ออกบิลทดสอบชื่อสมมติ ส่งหนึ่งครั้ง ตรวจปลายทางหนึ่งข้อความ, delivery status, retry/idempotency และไม่ส่งซ้ำเมื่อผลลัพธ์ช้า
6. ทดสอบ unlink/delete account และข้อมูล LINE ที่เหลืออยู่ตาม retention policy

### Acceptance gate

- LINE Developers Verify สำเร็จและหนึ่งข้อความไปถึงโทรศัพท์ทีมจริงเพียงครั้งเดียว
- signature ผิด, payload เกิน limit, replay, expired pairing และ cross-account ถูกปฏิเสธตามเวลาที่กำหนดโดยไม่ timeout
- server log ไม่มี token, secret, ชื่อเด็ก หรือ message body เกินที่จำเป็น
- UI แยก Demo กับ Real ชัด; inbound chat/manual pairing fallback ที่ยังไม่มีต้องระบุเป็น backlog ไม่สวมเป็นฟีเจอร์พร้อมใช้

## 4) PromptPay และ manual Pro — Omise พักไว้

### สิ่งที่อยู่ใน active baseline

- `src/app/PlanCard.tsx`, `src/integrations/planApi.ts`, `src/platform/plans.ts`, `src/platform/config.ts`
- แพ็ก active: Free สูงสุด 5 คน, 299/เดือน, 799/3 เดือน, 2,490/ปี
- migrations `0006_plans.sql`, `0009_paid_account_erasure.sql`, `0010_payment_evidence.sql`; ขั้นตอนใน `docs/plan-approval.md` และ `docs/payment-operations.md`
- flow ปัจจุบันเป็น PromptPay/manual verification ไม่ใช่ recurring subscription และไม่ใช่ payment gateway

### ข้อห้ามและช่องว่าง

- Omise ถูกพักไว้ที่ `.omx/deferred-omise/2026-09-08/` ห้ามรวม migration, frontend, secret หรือเปิด payment โดยไม่มีคำสั่งใหม่จากผู้ใช้
- ต้องมี PromptPay/ชื่อผู้ให้บริการจริง, คนตรวจบัญชีธนาคาร, รูปแบบใบเสร็จ/ภาษี, cancellation/refund, support และ legal acceptance ที่อนุมัติ
- ห้ามใช้ภาพสลิปอย่างเดียว ห้ามนับคำขอ pending เป็นรายได้ และห้ามนับ payment fixture/demo เป็น traction

### ขั้นตอนดำเนินงาน

1. reconcile migration history ก่อนทุกอย่าง ตรวจว่า remote/local มี `0001`–`0010` อะไรจริงและ checksum/เนื้อหาตรงหรือไม่
2. รัน SQL suite ด้วย PostgreSQL 17 และทดสอบ duplicate bank reference, refund เกินยอด, concurrent refund, cross-account access, deletion ระหว่าง approval และ failure atomicity
3. เจ้าของยืนยัน PromptPay กับธนาคารและชื่อผู้รับบน QR ก่อนเผยแพร่ variable
4. ฝ่ายปฏิบัติการตรวจรายการธนาคารจริง บันทึก evidence ผ่าน wrapper ที่กำหนด และแยก paid/refund/deposit อย่างชัดเจน
5. ทำใบเสร็จ/เลขอ้างอิง, ledger reconciliation, รายงานยอดสุทธิ และ runbook แก้ยอดผิดโดยไม่แก้ SQL ตรง
6. เริ่ม pilot จำนวนน้อยและ reconcile ธนาคารกับระบบทุกวันก่อนขยาย

### Acceptance gate

- ราคา/ระยะเวลา/สิทธิ์ตรงทั้ง UI, server และ receipt; client แก้ราคาไม่ได้
- reference เดียวไม่อนุมัติซ้ำ; refund รวมไม่เกินยอดรับ; concurrent operation ให้ผลถูกเพียงรายการเดียว
- ลบบัญชี paid แล้ว operational identity ถูกลบ แต่ record การเงินที่อนุมัติให้เก็บยังคงยอดถูกและไม่เปิดให้ผู้ใช้คนอื่นอ่าน
- เงินรับสุทธิใน dashboard/รายงานตรง statement ธนาคารจากตัวอย่างจริงที่ทีมอนุญาต
- มีคนรับผิดชอบ support/refund ก่อนรับเงินจริงรายการแรก

## 5) Operations, rate-limit alerts, recovery และ rollback

### สิ่งที่อยู่ใน active baseline

- `.github/workflows/backup.yml`, `operations.yml`, `uptime.yml`, `deploy.yml`
- `0007_production_safety.sql`, `scripts/test-db.sh`, `scripts/test-edge.sh`, error/usage collectors และ rate-limit cleanup
- Supabase Free ไม่มี PITR; encrypted GitHub artifact อายุ 90 วันยังผูกกับบัญชี/ผู้ให้บริการเดียว ไม่ถือเป็น offsite recovery ที่สมบูรณ์

### งาน deferred และช่องว่าง

- `.omx/deferred-production/root/` มี workflow patches, `.omx/deferred-production/root/docs/backup-restore.md`, backup crypto/offsite scripts, notification, finance admin และ restore rehearsal; ทั้งหมดเป็น local deferred artifacts ไม่ใช่งาน active
- monitoring login/least privilege, alert destination, offsite target, key ownership/rotation, RTO/RPO และ incident roles ยังต้องกำหนดและพิสูจน์
- หลักฐานใน `/tmp` เช่น log ทดสอบอาจถูกระบบลบ ให้ย้ายเฉพาะผลที่ sanitize แล้วไป artifact ที่กำหนด ห้ามเก็บ secret หรือ production payload

### ขั้นตอนดำเนินงาน

1. inventory scheduled jobs, secrets, permissions และ failure notification; แยก deploy, backup, monitoring และ finance privileges
2. ตรวจ backup decrypt บน isolated runner/DB และบันทึก manifest/count/RLS/trigger/decrypt result ที่ไม่มีข้อมูลส่วนบุคคล
3. เพิ่ม offsite copy คนละ failure domain กับ GitHub/Supabase พร้อม retention และ key rotation ที่เจ้าของอนุมัติ
4. ตั้ง alert สำหรับ uptime, Edge 5xx/timeout, rate-limit saturation, backup age, restore failure, request Pro/refund และ LINE delivery failure โดยไม่ส่ง PII ในข้อความเตือน
5. เขียน incident runbook: triage, containment, secret rotation, function rollback ไป known-good commit, database forward-fix, evidence และ legal escalation
6. ซ้อม rollback แบบ canary; migration ฐานข้อมูลให้ forward-fix เป็นหลัก ห้ามรัน down migration หรือ restore dump ทับ production โดยอัตโนมัติ

### Acceptance gate

- งาน backup ล้มเหลว/เก่าเกินกำหนดแล้วผู้รับผิดชอบได้รับ alert จริง
- restore จาก offsite copy สำเร็จในฐานแยกและตรวจ RLS/decrypt/delete tombstone ครบตาม runbook
- rate-limit cleanup และ alert ผ่าน load ที่กำหนดโดยไม่เผา Free quota
- rollback Edge Function กลับ known-good version ได้ และ smoke tests ที่ไม่มี side effect ผ่าน
- secret แต่ละตัวมี owner, scope, rotation date และไม่ปรากฏใน git, log, chat, pitch kit หรือ downloaded browser bundle

## 6) มือถือเครื่องจริงและครูจริง

### ขั้นตอนเครื่องจริง

1. iPhone Safari: Add to Home Screen, เปิดจาก icon, safe area/rotation/Thai keyboard, offline reopen, download/import JSON และกลับจาก LINE app
2. Android Chrome: install PWA, offline/cache update, file picker/download/share, back navigation และ low-memory reload
3. ทดสอบข้อมูลชื่อไทยยาว ยอดทศนิยม/ยอดผิด การแตะซ้ำ เน็ตช้า/ตัดกลางทาง และ accessibility ด้วย font scaling/VoiceOver หรือ TalkBack ขั้นพื้นฐาน
4. เก็บรุ่นเครื่อง/OS/browser, build SHA, เวลาและผล pass/fail; screenshot ต้องไม่มีชื่อเด็ก/เบอร์/QR จริง

### ขั้นตอนครูจริง

1. เริ่ม controlled pilot 3–5 คนหรือกลุ่มแรกไม่เกิน 10 คน หลัง legal/contact/data-recovery gate ผ่าน
2. ใช้ข้อมูลสมมติใน onboarding ก่อน; ขออนุญาตแยกต่างหากก่อนนำข้อมูลเด็กจริง และอธิบาย local plaintext/cloud ciphertext/recovery file ตามจริง
3. ย้ายข้อมูล local เดิมขึ้น cloud โดยครูไม่ต้องกรอกใหม่ และทำ recovery drill อย่างน้อยหนึ่งคน
4. วัด activation: เพิ่มนักเรียน → บันทึกคาบ → ออกบิล → ส่ง → รับเงิน → ใบเสร็จ พร้อมเวลาที่ติดขัดและ support request
5. วัดครูที่กลับมาใช้เดือน 2/churn จากบัญชีที่ยืนยัน ไม่ใช้ random device ID เท่ากับจำนวนครู และไม่รวมทีม/demo
6. ก่อนขยาย ตรวจรายการข้อมูลหาย, invoice ผิด, LINE ซ้ำ, refund, response time และคำร้องข้อมูลส่วนบุคคล

### Acceptance gate

- iOS และ Android เครื่องจริงผ่าน critical loop อย่างน้อยหนึ่งรุ่นต่อระบบ โดยไม่มี data loss หรือปุ่มสำคัญใช้งานไม่ได้
- ครู pilot กู้ข้อมูลข้ามเครื่องได้และรู้ว่า recovery key ต้องเก็บที่ไหน
- ทุกข้อผิดพลาดสำคัญมี owner/response path และหยุด onboarding ได้เมื่อพบ data-loss หรือ billing mismatch
- มีหลักฐาน consent สำหรับคำพูด/รูปที่ใช้พิทช์; ไม่มีการแต่ง testimonial, ผู้จ่าย หรือยอดรายได้

## การ reconcile migration ก่อนแตะฐานที่เชื่อมอยู่

1. ทำ read-only inventory ก่อน: commit SHA, `supabase migration list --linked`, รายชื่อ function/version และ schema migration history
2. เปรียบเทียบ active `supabase/migrations/0001...0010` กับ remote ทีละไฟล์ ห้ามสรุปจากเลขล่าสุดอย่างเดียว
3. ตรวจ archive ทุกก้อนหาเลข migration/function/trigger/RPC ที่ชนกัน งาน archived `0012` ต้องเปลี่ยนเลขตามลำดับจริงหลัง merge และ review เนื้อหาใหม่
4. รวมทีละ capability พร้อม SQL regression ของตัวเอง ห้าม apply Omise archive และห้าม restore deferred patch ทั้งก้อนโดยไม่แก้ conflict
5. รัน local PostgreSQL 17 suite และทำ encrypted backup ก่อนเสนอ production change
6. ส่ง migration plan/diff/rollback-or-forward-fix ให้ผู้ใช้ตรวจ จากนั้นรอคำอนุญาต production แบบชัดเจนจึงค่อย apply
7. หลัง apply ให้ตรวจ migration history, RLS, RPC privileges, function smoke และข้อมูล canary ห้ามใช้ข้อมูลเงินจริงเป็น test fixture

## ชุดคำสั่งและเกณฑ์ตรวจ

เริ่มจาก clean checkout และรันทีละชุดเพราะ browser suites ใช้ `dist` ร่วมกัน:

```sh
git status --short
git rev-parse HEAD
npm ci
npm run check
npm test
SOLO_TEST_POSTGRES_IMAGE=postgres:17-alpine npm run test:db
npm run test:edge
SOLO_CROSS_BROWSER=1 npm run e2e
SOLO_CROSS_BROWSER=1 npm run e2e:mock
```

เกณฑ์รับงานคือ command exit 0, ไม่มี unexpected skip, ไม่มี test ใช้ production credentials/เงินจริง/ผู้รับ LINE จริง, diff ไม่มี secret/debug artifact และมี regression ที่พิสูจน์ failure path สำคัญของ capability ที่แก้ ถ้าจำนวนเทสต่างจากตัวเลขเดิม ให้รายงานผลล่าสุดตามจริง ไม่ปรับเอกสารให้ผ่านด้วยการคงตัวเลขเก่า

## ข้อมูลที่ต้องมาจากเจ้าของเท่านั้น

- legal entity, ที่อยู่, support/DSAR contact, ผู้รับผิดชอบตอบ และเอกสาร privacy/terms/DPA ที่ผู้เชี่ยวชาญอนุมัติ โดยชื่อผู้ให้บริการ/ช่องทางติดต่อที่ตั้งใจเผยแพร่ใส่ในหน้าเว็บหรือเอกสารสาธารณะได้หลังเจ้าของยืนยัน
- PromptPay, ชื่อผู้รับเงินจริง, bank transaction evidence, รูปแบบใบเสร็จ/ภาษี/refund และผู้อนุมัติ ข้อมูลผู้รับและ PromptPay ที่ตั้งใจแสดงแก่ลูกค้าใส่ใน public config ได้หลังตรวจชื่อปลายทาง; statement, หลักฐานธนาคาร และข้อมูลตรวจสอบภายในยังเป็นข้อมูลส่วนตัว
- LINE Developers access, rotated channel secret/token และโทรศัพท์บัญชีทีม
- SMTP/domain sender ถ้าจะเปิด confirmation/password recovery
- offsite backup destination, encryption key custodians, alert recipient และ RTO/RPO
- เครื่อง iPhone/Android, ครู pilot, สิทธิใช้คำพูด/รูป และสิทธิใช้ข้อมูลจริง

แยก **ข้อมูลที่ตั้งใจเผยแพร่** เช่นชื่อผู้ให้บริการ ช่องทาง support และ PromptPay สำหรับรับเงิน ออกจาก **ความลับ/หลักฐานส่วนตัว** เช่น password, access/refresh token, LINE credential, server master key, bank statement และไฟล์ recovery ข้อมูลสาธารณะเขียนใน config/หน้าเว็บได้เมื่อเจ้าของยืนยันแล้ว ส่วนความลับและหลักฐานส่วนตัวห้ามเขียนลง Markdown, source, test fixture, URL/query, browser bundle, แชท หรือ pitch kit ให้ใช้ secret manager หรือ encrypted private storage ตาม scope และเผยแพร่เฉพาะหลักฐานที่ redact แล้ว

## Prompt สำหรับ Claude Code คนถัดไป

```text
เปิด repository Solo Tutor แล้วอ่าน ./handoff.md ก่อน เอกสารนี้ authoritative;
อย่าทำตาม docs/handoff.md เมื่อขัดกัน ตรวจ git status/HEAD และ active baseline ก่อนทุกครั้ง
จำแนกสิ่งที่พบเป็น active, deferred-local, หรือ unverified ห้ามอ้าง deferred ว่า shipped
และจำไว้ว่ fresh clone ไม่มี .omx/deferred-* ให้ขอ private archive หรือ implement จาก baseline

เริ่มที่ blocker ลำดับแรกที่ยังไม่ผ่าน acceptance gate ใน 6 หมวด โดยเพิ่ม regression ก่อนแก้
รักษา Demo/mocks แยกจากข้อมูลจริง รัน check/unit/PG17 SQL/Edge/browser ทีละชุดและรายงานผลใหม่
ภายใต้คำขอเอกสารรอบนี้ ห้าม apply migration, deploy, rotate/set secret, ส่ง LINE, อนุมัติ Pro,
แตะเงินจริง หรือ resume Omise จนผู้ใช้อนุญาต live action นั้นอย่างชัดเจน เมื่ออนุญาตแล้วให้ดำเนินการ
ตามขอบเขตต่อเนื่องโดยไม่ถามซ้ำทุกขั้นตอน หากต้องแตะ migration ให้ inventory remote,
reconcile 0001-0010 และเลขใน archive ก่อน ห้าม blind push/restore

ประเด็น live ที่ต้องถือว่ายังค้าง: LINE webhook request เกินขนาดผ่าน local เป็น 413 เร็ว
แต่ production oversized request ยัง timeout 20 วินาที แม้ small empty-events ตอบ 200;
ยังไม่มีหลักฐานสาเหตุ gateway ที่แน่ชัด จึงห้ามสรุปว่า live endpoints ผ่านครบ

จบแต่ละรอบด้วย: ไฟล์ที่แก้, test evidence, สิ่งที่ active/deferred/unverified,
ความเสี่ยงคงเหลือ, owner-only input และ production action ที่ยังไม่ได้รับอนุญาต
```
