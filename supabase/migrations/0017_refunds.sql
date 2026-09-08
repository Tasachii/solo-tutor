-- D-08: หลักฐานการคืนเงินมีอยู่แล้วตั้งแต่ 0010 (plan_financial_evidence แถว evidence_type = 'refund')
-- แต่ตารางนั้นปิดสนิทจาก authenticated ครูจึงไม่มีทางเห็นเลย ใบเสร็จค้างยอดเต็มทั้งที่เงินคืนไปแล้ว
-- ไมเกรชันนี้เพิ่ม "ทางอ่าน" อย่างเดียว ไม่แตะโครงสร้างหลักฐาน ไม่แตะสิทธิ์แพ็ก และไม่เปิด
-- ข้อมูลปฏิบัติการ (เลขอ้างอิงธนาคาร, ชื่อผู้ตรวจ) ให้ครู ตามกติกาใน docs/payment-operations.md
--
-- การคืนเงิน "ไม่" ตัดวันของแพ็ก — 0010 และ payment-operations.md ระบุไว้ชัดว่าการเปลี่ยนสิทธิ์
-- ต้องออกแบบและอนุมัติแยกต่างหาก การผูกสิทธิ์ไว้กับแถวหลักฐานที่แก้ไม่ได้จะทำให้การลงบัญชี
-- ผิดพลาดหนึ่งครั้งตัดการเข้าถึงของครูอย่างถาวรโดยไม่มีทางย้อน ฟังก์ชันนี้จึงอ่านอย่างเดียว
create function public.list_plan_refunds()
returns table (
  refund_id uuid,
  plan_request_id uuid,
  receipt_no text,
  paid_amount integer,
  refunded_amount integer,
  refunded_total integer,
  occurred_at timestamptz
)
language sql security definer set search_path = public, pg_temp stable as $$
  -- ยอดทุกตัวมาจากหลักฐานฝั่งเซิร์ฟเวอร์: paid_amount คือยอดที่ทีมยืนยันกับรายการเดินบัญชี
  -- ไม่ใช่ plan_requests.amount และ refunded_total รวมจากแถว refund ของ payment เดียวกัน
  -- ใบเสร็จผูกกับ payment (หนึ่ง payment ต่อหนึ่งคำขอ ตาม unique index ใน 0010)
  select refund.id, request.id, request.receipt_no, payment.amount, refund.amount,
         sum(refund.amount) over (partition by payment.id)::integer,
         refund.occurred_at
    from public.plan_financial_evidence refund
    join public.plan_financial_evidence payment
      on payment.id = refund.payment_evidence_id and payment.evidence_type = 'payment'
    join public.plan_requests request on request.id = payment.plan_request_id
   where refund.evidence_type = 'refund'
     -- ไม่มี jwt = ไม่มีแถว · provider_id ว่าง (บัญชีถูกลบตาม 0009) ก็ไม่มีเจ้าของให้แสดง
     and auth.uid() is not null
     and request.provider_id = auth.uid()
   order by refund.occurred_at desc, refund.id
$$;
comment on function public.list_plan_refunds() is
  'Teacher-scoped, read-only refund evidence. Bank references and verifier labels stay operational-only.';
revoke all on function public.list_plan_refunds() from public, anon;
grant execute on function public.list_plan_refunds() to authenticated;
