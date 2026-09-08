# Solo Tutor — สถานะล่าสุดสำหรับ paid pilot และ pitching

ปรับจากโจทย์ Demo มาเป็นการหาลูกค้าจ่ายเงินจริง โดยใช้ Supabase Free และรักษา Demo/mock แยกไว้ เอกสารนี้อัปเดตรายการต่อจากรายงาน QA รอบแรก; ไม่ใช้จำนวนเทสหรือยอดสมมติเป็นหลักฐานรายได้

## ผลตรวจและการนำขึ้นระบบรอบต่อมา

- Supabase โปรเจกต์ `qbuafdbmpkffzbkqoysb`: migrations **0001–0010 ตรงกันทั้ง local/remote**; deploy `waitlist`, `report-error`, `usage`, `delete-account` และตั้ง server-only limiter secret แล้ว ไม่มีการเปลี่ยนแพ็กเสียเงิน
- สำรองก่อน migration ผ่าน [GitHub Actions run 34193112398](https://github.com/Tasachii/solo-tutor/actions/runs/34193112398) สำเร็จ และเก็บ encrypted schema/data ของ public+auth ในเครื่องแยกจาก GitHub พร้อมตรวจ decrypt roundtrip สำเร็จ รอบนี้ไม่อ้างว่าได้ restore snapshot นี้ลง Supabase ใหม่ครบทุกบริการ
- ตรวจหลัง deploy: providers 1, ledgers 0, plan_requests 0, financial_evidence 0; RLS เปิดทุก public table, anon/ครูอ่านตารางหลักฐานหรืออนุมัติเงินไม่ได้ **ยังไม่มีรายได้จริงในฐานข้อมูลนี้ ณ เวลาตรวจ**
- Public Edge probes 13 รายการผ่าน: missing/foreign Origin ถูกปฏิเสธ, preflight ผ่าน, payload เสียถูกปฏิเสธ และลบบัญชีโดยไม่มี bearer ไม่ได้ ใช้เฉพาะ payload เสีย; มีเพียง counter ทางเทคนิค ไม่สร้างข้อมูลครู/การเงิน
- Unit **459 ผ่าน**, browser **194 ผ่าน / 40 skips ตามเงื่อนไข**, Supabase/LINE mock **42 ผ่าน**, Edge **26 ผ่าน**, SQL contracts + concurrency ผ่าน PostgreSQL **17**
- ทดสอบ isolation เพิ่ม **19 ผ่าน / 26 skips** ยืนยันว่าคำสั่ง QA ไม่ดึงค่าฐานจริงจาก `.env.local`; build และ TypeScript ผ่าน ไม่มี service-role key ในไฟล์ตั้งค่าหน้าเว็บ
- เว็บแยกโหลด route: initial JS ประมาณ **433 kB / gzip 127 kB** จากเดิม 572/161; root build สำหรับ dedicated host ทดสอบเปิดครั้งแรก offline, Help ที่ไม่เคยเปิด และกดดาวน์โหลด PDF จริงผ่าน
- ตั้ง Supabase Cron `solo-public-rate-limit-cleanup` ให้ทำงานรายชั่วโมงแล้ว; ตรวจพบ job active ถูกต้อง และ [Operations run 34195607931](https://github.com/Tasachii/solo-tutor/actions/runs/34195607931) ตรวจฐานข้อมูล/อายุ backup ผ่าน
- ย้ายภาพหลักฐาน LINE จาก path เฉพาะเครื่องไปเป็น Playwright attachment และบังคับ mock endpoint แม้เรียก Playwright ตรงด้วย `SOLO_LINE_QA=1`; targeted Chromium mobile/desktop/WebKit ผ่านทั้ง 3
- CI พบ Node type declarations ที่เครื่องพัฒนามีจาก parent directory แต่ clean runner ไม่มี; เพิ่ม `@types/node` เฉพาะ devDependency และตรวจ npm ci/typecheck/build ในโฟลเดอร์สะอาดผ่าน โดยเก็บโค้ด build เป็น TypeScript ให้ตรวจได้ครบ
- ผู้รีวิวอิสระอนุมัติการลบบัญชี paid และ financial evidence หลังแก้เวลาเกิดธุรกรรม/คืนเงินพร้อมกัน; รายการที่ยังต้องใช้ข้อมูลหรือบัญชีเจ้าของอยู่ด้านล่าง

หลักฐานรอบนี้อยู่ใน [qa-evidence/2026-09-08/followup](qa-evidence/2026-09-08/followup/) รวม log และ HTTP probe results ส่วนการเผยแพร่เว็บผ่าน [workflow deploy](https://github.com/Tasachii/solo-tutor/actions/workflows/deploy.yml); ใช้สถานะ Actions ของรุ่นล่าสุดเป็นหลักฐาน ไม่เอาผล local มาแทนผล deploy

## สิ่งที่ปิดเพิ่มจากรายงานรอบแรก

- บัญชีเคยชำระเงินลบ Auth/สมุดบัญชี/LINE/ข้อมูลใช้งานที่ผูกบัญชีได้ โดยเก็บหลักฐานการเงินแยกจาก provider และลบ note ไม่ลบใบเสร็จทิ้งพร้อมบัญชี
- ล็อก approval และ deletion ในลำดับเดียวกัน พร้อมทดสอบสอง transaction แข่งกันทั้งสองลำดับ
- เพิ่มการอนุมัติด้วยหลักฐานรับเงินจริงและการบันทึกคืนเงินจริง เลขอ้างอิงธนาคารซ้ำไม่ได้ ยอดรับต้องตรงคำขอ ยอดคืนรวมไม่เกินเงินรับ
- รายงาน pitch แยก verified / legacy-unverified, gross / refund / net และยอดลูกค้าที่บัญชียังเชื่อมอยู่ ไม่ใช้ usage หรือ mock receipt สร้างรายได้
- CSP จำกัดตรง origin ของ Supabase ที่ตั้งค่า และ build สร้าง `_headers` ที่มี `frame-ancestors 'none'` สำหรับ host ที่รองรับ
- แยกโหลดหน้าจอพร้อม loading ภาษาไทย; offline precache ครบทุก chunk/ฟอนต์/คู่มือด้วย integrity hash และ cache ตามเนื้อหาทั้ง release ไม่ต้องเพิ่มเลข version เอง
- Worker รุ่นใหม่รอแท็บรุ่นเก่าปิดก่อนเปลี่ยนรุ่น เพื่อไม่ให้การเปิดหน้าที่ยังไม่เคยโหลดพังระหว่างอัปเดต; เปิดรอบใหม่หลังปิดทุกแท็บจึงใช้รุ่นใหม่
- ตั้ง `VITE_BASE_PATH=/` ได้สำหรับ host เฉพาะของแอป ค่าเดิม `/solo-tutor/` ยังรองรับลิงก์ Pages เดิม

## สิ่งที่เจ้าของต้องจัดการเพื่อเริ่มรับเงินจริง

เรียงตามสิ่งที่ยังขวาง paid pilot ไม่เรียงตามความยาก:

1. **ตัวตนและบัญชีรับเงินของผู้ให้บริการ:** ชื่อจริงที่ใช้ให้บริการ, PromptPay ของ Solo Tutor และช่องทางซัพพอร์ตที่มีคนตอบ ข้อมูลเหล่านี้ใช้ค่า mock แทนตอนรับเงินจริงไม่ได้
2. **ข้อมูลเด็กและข้อตกลงบริการ:** ให้ผู้เชี่ยวชาญตรวจ privacy/DPA/retention/คืนเงิน และกำหนดกระบวนการคำขอของผู้ปกครอง การหยุดเรียนนักเรียนที่มีประวัติในแอปยังไม่เท่ากับลบข้อมูลเฉพาะรายทั้งหมด ส่วนลบบัญชีทั้งหมดรองรับแล้ว สำเนาที่ครูดาวน์โหลดหรืออยู่บนเครื่องออฟไลน์อื่นดึงกลับมาลบไม่ได้
3. **Origin แยกและ SMTP จริง:** เลือก host/domain ของแอปเอง ตั้ง Auth redirects และ SMTP/email confirmation ให้ใช้งานจริงได้ กำหนดแผนย้ายข้อมูลและรักษาลิงก์เก่าก่อนเปลี่ยน origin; `_headers` ไม่ทำงานบน GitHub Pages
4. **ตรวจธนาคารและดูแลลูกค้า:** คนตรวจยอด/อนุมัติ/รับเรื่องคืนเงินและซัพพอร์ตตามเวลาที่ประกาศ ใช้ [ขั้นตอนรับเงิน](payment-operations.md) ห้ามนับ pending หรือโอนจำลองเป็นรายได้
5. **ถือกุญแจและซ้อมปฏิบัติการ:** เก็บกุญแจ backup นอกบัญชีที่เก็บไฟล์, เปิดรับ Actions notifications และซ้อม incident/restore; โปรเจกต์ Free ยังต้องดูแล inactivity และ quota

งานที่ต้องใช้บัญชีเจ้าของ เช่น สมัคร merchant/KYC, อนุมัติข้อกำหนดทางกฎหมาย, จัดซื้อ domain หรือเลือกแพ็กเสียเงิน ไม่ได้ดำเนินการแทน การอัป Supabase Pro ไม่ใช่สิ่งที่ต้องทำตอนนี้

## Payment gateway

**เริ่ม PromptPay รับโอนตรงก่อน** เหมาะกับลูกค้ากลุ่มแรกที่ทีมตรวจยอดเองไหว ถ้าต้องยืนยันรายการอัตโนมัติ ให้ประเมิน **Omise** ก่อนสำหรับลูกค้าครูไทย; Stripe เป็นตัวเลือกเมื่อทีมต้องการเครื่องมือ Billing/ตลาดต่างประเทศ ดู [ค่าธรรมเนียมและเหตุผล](payment-for-pitching.md)

ไม่มีการตัดเงินอัตโนมัติหรือรับเงินจริงจากผู้ใช้ระหว่าง QA ตัวเลข verified จะเกิดเมื่อมีลูกค้าจ่ายและผู้รับผิดชอบตรวจ statement แล้วบันทึกหลักฐานจริงเท่านั้น

## เอกสารประกอบ

- [QA รอบแรกและข้อจำกัดการตรวจ](qa-verification-20260908.md)
- [แผนขึ้นระบบและคำสั่งตรวจซ้ำ](production-rollout.md)
- [ร่างข้อมูลให้ผู้เชี่ยวชาญกฎหมายตรวจ](legal-review-draft.md)
- [คู่มือในแอป](../public/solo-tutor-guide.pdf)
