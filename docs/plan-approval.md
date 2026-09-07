# เปิด Pro ให้ครู (คู่มือทีม)

Solo ไม่ถือเงิน — ครูส่งคำขอในแอป (เมนู → บัญชีครู → ขอเปิด Pro) แล้วโอนตามที่เราแจ้ง
เราเห็นยอดในบัญชีของเราเอง จึงค่อยอนุมัติในฐานข้อมูล แอปของครูเห็นแพ็กใหม่ในรอบซิงก์ถัดไป (เปิดแอปหรือกด "ซิงก์ตอนนี้")

ทำใน Supabase Dashboard → SQL Editor (สิทธิ์ service_role อยู่แล้ว)

## 1. ดูคำขอที่รออยู่

```sql
select r.id, u.email, r.months, r.amount, r.note, r.created_at
from public.plan_requests r join auth.users u on u.id = r.provider_id
where r.status = 'pending' order by r.created_at;
```

`amount` คำนวณฝั่งเซิร์ฟเวอร์จาก `months` (1 → 299 · 3 → 799 · 12 → 2490) ครูแก้ไม่ได้

## 2. เห็นยอดโอนตรงแล้ว → อนุมัติ

```sql
select * from public.approve_plan_request('<id จากข้อ 1>');
```

คืน `plan_until` ใหม่และ `receipt_no` (รูปแบบ `SP-YYYYMM-0001`) — ถ้าครูยัง Pro อยู่ วันจะต่อท้ายจากวันหมดอายุเดิม ไม่นับใหม่จากวันนี้
ครูเห็นใบเสร็จค่าสมาชิกในหน้าบัญชี → ประวัติค่าสมาชิก

## 3. ยอดไม่ตรง / ไม่ได้โอน

```sql
select public.reject_plan_request('<id>');
```

ครูส่งคำขอใหม่ได้ (คำขอที่รออยู่ได้ทีละหนึ่ง ครูยกเลิกเองได้จากในแอป)

## ดูสถานะแพ็กของครูทุกคน

```sql
select u.email, p.plan, p.plan_until, p.paused_at
from public.providers p join auth.users u on u.id = p.id order by p.plan_until desc nulls last;
```

- `paused_at` ไม่ว่าง = ครูกดพักไว้ วันที่เหลือไม่ถูกนับ กด "ใช้ต่อ" แล้ว `plan_until` เลื่อนออกไปเท่าวันที่พัก
- วันทั้งหมดคิดเป็นวันไทย (`public.thai_today()`) ไม่ใช่ UTC

## ยังไม่ได้ตั้ง

- `SOLO_PROMPTPAY` ใน `src/platform/config.ts` ว่างอยู่ → หน้าขอเปิด Pro ยังไม่โชว์ QR ให้โอน บอกว่าทีมจะติดต่อกลับทางอีเมลที่สมัคร ใส่เลขพร้อมเพย์จริงของเราแล้ว QR จะขึ้นพร้อมยอดของแพ็กที่เลือก
- อีเมลแจ้งเตือนเมื่อมีคำขอใหม่ยังไม่มี — เช็คข้อ 1 วันละครั้ง หรือตั้ง Database Webhook ทีหลัง
