-- แก้บั๊กที่เจอบนฐานจริงทันทีหลัง apply 0011–0018
--
-- อาการ: `read_shared_document` ตอบ `function digest(text, unknown) does not exist`
-- ผู้ปกครองจึงเปิดลิงก์บิลไม่ได้เลย
--
-- สาเหตุ: บนโปรเจกต์ Supabase ส่วนขยาย pgcrypto ถูกติดตั้งไว้ในสคีมา `extensions`
-- ไม่ใช่ `public` แบบที่คอนเทนเนอร์ postgres เปล่า ๆ ในเครื่องทำ ฟังก์ชันของเราตั้ง
-- `set search_path = public, pg_temp` ไว้เพื่อความปลอดภัย (กันคนแทรกสคีมาบังของจริง)
-- ผลคือมองไม่เห็น `digest` และ `gen_random_bytes` ซึ่งอยู่ใน `extensions`
-- `create extension if not exists pgcrypto` ใน 0015 ไม่ช่วย เพราะส่วนขยายมีอยู่แล้ว แค่คนละสคีมา
--
-- **`issue_line_link_code` ก็โดนด้วย** — ฟังก์ชันออกรหัส 6 หลักสำหรับผูก LINE OA เรียก
-- `gen_random_bytes(4)` ใต้ search_path เดียวกันมาตั้งแต่ 0001 ครูจึงกดออกรหัสไม่ได้เลยบนฐานจริง
-- ไม่มีใครเห็นเพราะยังไม่เคยมีใครผูก OA สำเร็จสักครั้ง
--
-- วิธีแก้: เติม `extensions` เข้า search_path ของสองฟังก์ชันนี้ ไม่แตะตัวอื่น
-- ยังไม่เปิดกว้างเป็น search_path ว่าง ๆ และไม่ย้ายส่วนขยาย เพราะการย้ายกระทบทั้งโปรเจกต์
-- สคีมาที่ไม่มีอยู่จริงใน search_path ถูกข้ามเงียบ ๆ คำสั่งนี้จึงปลอดภัยกับคอนเทนเนอร์ทดสอบด้วย

alter function public.public_client_hash()
  set search_path = public, extensions, pg_temp;

alter function public.issue_line_link_code(uuid, timestamptz)
  set search_path = public, extensions, pg_temp;
