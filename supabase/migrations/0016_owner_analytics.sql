-- P09 · แดชบอร์ดของเจ้าของ และ J-12 · แหล่งที่มาของผู้เยี่ยมชม
--
-- คำถามที่ทีมต้องตอบได้โดยไม่ต้องให้ใครนั่งรัน SQL: มีคนเข้าเว็บกี่คน ลอง Demo กี่คน สมัครกี่คน
-- และมีลูกค้าที่จ่ายเงินจริงกี่ราย · ไฟล์นี้ให้ "ทางเดียว" ที่อ่านตัวเลขพวกนี้ได้จากเบราว์เซอร์
--
-- หลักที่ยึดสามข้อ
-- 1) สิทธิ์อยู่ฝั่งเซิร์ฟเวอร์ · ครูทั่วไปเรียกฟังก์ชันนี้แล้วต้องถูกปฏิเสธที่ฐานข้อมูล
--    การซ่อนเมนูในเบราว์เซอร์ไม่ใช่การจำกัดสิทธิ์ และห้ามนับเป็นด่านเดียว
-- 2) ยอดเงินมาจากหลักฐานการเงินฝั่งเซิร์ฟเวอร์เท่านั้น (plan_financial_evidence)
--    ไม่มีทางที่ event จากเบราว์เซอร์จะขยับ gross/refund/net ได้แม้แต่บาทเดียว
-- 3) ช่วงที่ไม่มีข้อมูลคืน 0 ทุกช่อง ไม่ใช่ค่าประมาณ และไม่ใช่ช่องที่หายไปเฉย ๆ
--    ผู้อ่านจึงแยกออกว่า "ไม่มีใครเข้า" กับ "เรายังไม่ได้เก็บ" ต่างกัน

-- ─────────────────────────────────────────────────────────────────────────────
-- J-12 · แหล่งที่มา — เก็บเฉพาะค่าที่อยู่ในรายการ ไม่เก็บ referrer เต็มและไม่เก็บ UTM อิสระ
--
-- แผนข้อ 6.5 ห้ามเก็บ URL ผู้อ้างอิงทั้งเส้นและ UTM แบบพิมพ์อะไรก็ได้ เพราะทั้งสองอย่างพา PII
-- เข้ามาได้ (ชื่อในลิงก์กลุ่ม รหัสเชิญ ข้อความค้นหา) รายการนี้จึงเป็น "คำที่ทีมตกลงกันไว้ก่อน"
-- ค่าที่ไม่อยู่ในรายการจะถูกบันทึกเป็น 'unknown' ไม่ใช่เก็บของเดิมไว้
--
-- รายการที่เสนอ — ตรงกับวิธีที่ทีมนี้จะโปรโมตจริง (ทีมยืนยันก่อนใช้จริงได้)
--   line     กลุ่ม LINE ผู้ปกครอง/ครู และข้อความจาก LINE OA
--   facebook โพสต์หรือกลุ่มบน Facebook
--   qr       QR ที่พิมพ์แล้วแปะจริง เช่น ใบปลิว ป้ายหน้าโรงเรียน
--   pitch    งานพิทช์ สไลด์ และลิงก์ที่แจกในงาน
--   friend   บอกต่อปากต่อปาก ลิงก์ที่ครูส่งให้กันเอง
--   unknown  มี ?c= มาแต่ไม่อยู่ในรายการ — รู้ว่ามีคนกดลิงก์ที่เราไม่รู้จัก แต่ไม่เก็บค่านั้น
-- null (ไม่มีคอลัมน์นี้) = ไม่มี ?c= เลย · แดชบอร์ดแสดงเป็น 'none' ไม่ใช่เดาว่ามาจากไหน
--
-- เพิ่มค่าใหม่ = เติมคำเดียวในรายการนี้ แล้วเติมคำเดียวกันใน src/core/usage.ts และ
-- supabase/functions/usage/index.ts · tests/unit/campaign-allowlist.test.ts จะล้มทันทีถ้าสามที่ไม่ตรงกัน
-- ลำดับที่ปลอดภัยคือแก้ไฟล์นี้และ deploy migration ก่อน แล้วค่อย deploy ตัวรับ
alter table public.usage_events add column campaign text;
alter table public.usage_events add constraint usage_events_campaign_check
  check (campaign is null or campaign in ('line', 'facebook', 'qr', 'pitch', 'friend', 'unknown'));
create index usage_events_campaign_idx on public.usage_events (campaign, at desc)
  where campaign is not null;
comment on column public.usage_events.campaign is
  'แหล่งที่มาที่อยู่ในรายการเท่านั้น — ไม่ใช่ referrer เต็ม ไม่ใช่ UTM อิสระ · null = ไม่มี ?c= · unknown = มีแต่ไม่อยู่ในรายการ';

-- ─────────────────────────────────────────────────────────────────────────────
-- ใครคือเจ้าของ — ตอบด้วยแถวในฐานข้อมูลที่มีแต่ service_role เขียนได้
--
-- ไม่ใช่ค่าใน localStorage ไม่ใช่ email ที่ hardcode ไว้ในโค้ดหน้าเว็บ และไม่ใช่ claim ใน JWT
-- ที่ client แต่งเองได้ · ครูที่ล็อกอินอยู่มองไม่เห็นตารางนี้ และเพิ่มตัวเองเข้ามาไม่ได้
create table public.analytics_owners (
  provider_id uuid primary key references public.providers(id) on delete cascade,
  added_at timestamptz not null default now(),
  note text check (note is null or (note = btrim(note) and char_length(note) between 1 and 120))
);
alter table public.analytics_owners enable row level security;
revoke all on public.analytics_owners from public, anon, authenticated;
grant select, insert, delete on public.analytics_owners to service_role;
comment on table public.analytics_owners is
  'บัญชีที่เปิดแดชบอร์ดเจ้าของได้ — เพิ่ม/ลบด้วย service_role เท่านั้น ครูมองไม่เห็นตารางนี้';

create function public.is_analytics_owner() returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from public.analytics_owners o where o.provider_id = auth.uid()
  );
$$;
revoke all on function public.is_analytics_owner() from public, anon;
grant execute on function public.is_analytics_owner() to authenticated, service_role;
comment on function public.is_analytics_owner() is
  'true เฉพาะเมื่อบัญชีที่เรียกอยู่ในตาราง analytics_owners — ใช้กั้นแดชบอร์ดฝั่งเซิร์ฟเวอร์';

-- ─────────────────────────────────────────────────────────────────────────────
-- ตัวเลขทั้งแดชบอร์ดในการเรียกครั้งเดียว — ประตูเดียว ด่านเดียว ตรวจสิทธิ์ที่บรรทัดแรก
--
-- นิยามที่ตรึงไว้ที่นี่ (หน้าเว็บต้องแสดงข้อความเดียวกันข้างตัวเลข ไม่ใช่ซ่อนไว้ท้ายหน้า)
--   visitor  = จำนวน browser ID โดยประมาณ ไม่ใช่จำนวนคน · คนเดียวสองเครื่องนับสอง ล้างข้อมูลแล้วนับใหม่
--   session  = ช่วงการใช้งาน ขาดกิจกรรม 30 นาทีเริ่มใหม่ (ตรึงไว้ที่ src/core/usage.ts เช่นกัน)
--   pageview = จำนวนครั้งที่เปิดหน้า ไม่ใช่จำนวนคน · reload นับเพิ่ม
--   activated teacher = บัญชีที่ "ออกบิลจริงใบแรก" ตกอยู่ในช่วงที่เลือก ไม่ใช่แค่เปิดแอป
--   returning teacher = บัญชีที่เปิดแอปโหมดจริงอย่างน้อยสองวัน (เวลาไทย) ในช่วงที่เลือก
--   paid customer = ผู้ที่มีหลักฐานรับเงินจากธนาคารและยังเหลือยอดสุทธิเป็นบวกหลังหักคืนเงิน
--
-- ข้อจำกัดที่ต้องบอกผู้อ่านเสมอ
--   · ครูที่ใช้จริงแต่ไม่ได้ล็อกอินคลาวด์ ไม่มี provider_id — activated/returning จึงนับไม่ถึงเขา
--   · เหตุการณ์ผู้เยี่ยมชมถูกลบตาม retention 30 วัน ช่วงที่ยาวกว่านั้นจึงต่ำกว่าความจริง
--   · ตัวเลขเงินไม่ขึ้นกับตัวกรองผู้ชม/โหมด/แหล่งที่มา เพราะหลักฐานธนาคารไม่มีแกนพวกนั้น
--   · คืนเงินนับตามเดือนที่เงินออกจริง จึงหักข้ามช่วงกับการจ่ายที่เกิดก่อนหน้าได้
create function public.owner_analytics(
  p_from date default null,
  p_to date default null,
  p_audience text default 'public',
  p_mode text default null,
  p_campaign text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_from date := coalesce(p_from, public.thai_today() - 29);
  v_to date := coalesce(p_to, public.thai_today());
  v_audience text := nullif(btrim(coalesce(p_audience, '')), '');
  v_mode text := nullif(btrim(coalesce(p_mode, '')), '');
  v_campaign text := nullif(btrim(coalesce(p_campaign, '')), '');
  v_result jsonb;
begin
  -- ด่านเดียวของทั้งแดชบอร์ด และเป็นด่านฝั่งเซิร์ฟเวอร์
  -- ตั้งใจไม่เปิดทางลัดให้ current_user/บทบาทใด ๆ เพราะภายในฟังก์ชัน security definer
  -- current_user คือเจ้าของฟังก์ชันเสมอ ทางลัดแบบนั้นจะเปิดประตูให้ทุกคนโดยไม่มีใครเห็น
  -- งานฝั่งเซิร์ฟเวอร์ที่ถือ service key อ่านตารางและ view ได้ตรง ๆ อยู่แล้ว ไม่ต้องผ่านฟังก์ชันนี้
  if not public.is_analytics_owner() then
    raise exception 'owner analytics is restricted to the owner account' using errcode = '42501';
  end if;
  if v_from > v_to then
    raise exception 'range start is after its end' using errcode = '22023';
  end if;
  if v_to - v_from > 400 then
    raise exception 'range is longer than 400 days' using errcode = '22023';
  end if;
  if v_audience is not null and v_audience not in ('public', 'team') then
    raise exception 'unknown audience' using errcode = '22023';
  end if;
  if v_mode is not null and v_mode not in ('demo', 'real') then
    raise exception 'unknown mode' using errcode = '22023';
  end if;
  -- แหล่งที่มาที่ไม่รู้จักไม่ใช่ error — ผลลัพธ์เป็น 0 ตามจริง ('none' = แถวที่ไม่มี ?c= เลย)
  if v_campaign is not null and char_length(v_campaign) > 32 then
    raise exception 'campaign filter is too long' using errcode = '22023';
  end if;

  with scoped as (
    select e.teacher_id, e.provider_id, e.session_id, e.event, e.count, e.campaign
    from public.usage_events e
    where (e.at at time zone 'Asia/Bangkok')::date between v_from and v_to
      and (v_audience is null or e.audience = v_audience)
      and (v_mode is null or e.mode = v_mode)
      and (v_campaign is null or coalesce(e.campaign, 'none') = v_campaign)
  ),
  -- ใบแรกของบัญชีคิดจากทั้งประวัติที่ยังเหลืออยู่ แล้วค่อยถามว่าใบแรกนั้นตกอยู่ในช่วงที่เลือกไหม
  -- ถ้าคิดเฉพาะในช่วง ครูที่ออกบิลมาตั้งแต่ปีที่แล้วจะกลายเป็น "เพิ่งเริ่มใช้" ทุกเดือน
  first_invoice as (
    select e.provider_id, min(e.at) as first_at
    from public.usage_events e
    where e.event = 'invoice_issued' and e.mode = 'real' and e.provider_id is not null
      and (v_audience is null or e.audience = v_audience)
    group by 1
  ),
  active_days as (
    select e.provider_id, (e.at at time zone 'Asia/Bangkok')::date as day
    from public.usage_events e
    where e.event = 'app_open' and e.mode = 'real' and e.provider_id is not null
      and (e.at at time zone 'Asia/Bangkok')::date between v_from and v_to
      and (v_audience is null or e.audience = v_audience)
    group by 1, 2
  ),
  campaign_rows as (
    select coalesce(campaign, 'none') as source,
           count(distinct teacher_id) as visitors,
           count(distinct session_id) as sessions,
           count(*) filter (where event in ('landing_view', 'pricing_view')) as pageviews,
           count(distinct session_id) filter (where event = 'signup_started') as signup_started
    from scoped group by 1
  ),
  payments as (
    select e.id, e.amount, r.provider_id,
           e.amount - coalesce((select sum(x.amount) from public.plan_financial_evidence x
             where x.payment_evidence_id = e.id and x.evidence_type = 'refund'), 0) as net_amount
    from public.plan_financial_evidence e
    join public.plan_requests r on r.id = e.plan_request_id
    where e.evidence_type = 'payment'
      and (e.occurred_at at time zone 'Asia/Bangkok')::date between v_from and v_to
  ),
  refunds as (
    select e.amount from public.plan_financial_evidence e
    where e.evidence_type = 'refund'
      and (e.occurred_at at time zone 'Asia/Bangkok')::date between v_from and v_to
  )
  select jsonb_build_object(
    'generated_at', now(),
    'filters', jsonb_build_object(
      'from', v_from, 'to', v_to,
      'audience', v_audience, 'mode', v_mode, 'campaign', v_campaign),
    'traffic', (select jsonb_build_object(
      'visitors', count(distinct teacher_id),
      'sessions', count(distinct session_id),
      'landing_views', count(*) filter (where event = 'landing_view'),
      'pricing_views', count(*) filter (where event = 'pricing_view')) from scoped),
    'demo', (select jsonb_build_object(
      'started', count(distinct session_id) filter (where event = 'demo_started'),
      'completed', count(distinct session_id) filter (where event = 'demo_completed')) from scoped),
    'accounts', (select jsonb_build_object(
      'signup_started', count(distinct session_id) filter (where event = 'signup_started'),
      'signup_completed', count(distinct provider_id) filter (where event = 'signup_completed'),
      'email_verified', count(distinct provider_id) filter (where event = 'email_verified'),
      'onboarding_completed', count(distinct teacher_id) filter (where event = 'onboarding_completed'))
      from scoped),
    'teachers', jsonb_build_object(
      'opened_app', (select count(distinct teacher_id) filter (where event = 'app_open') from scoped),
      'activated', (select count(*) from first_invoice
        where (first_at at time zone 'Asia/Bangkok')::date between v_from and v_to),
      'returning', (select count(*) from (
        select provider_id from active_days group by provider_id having count(*) >= 2) repeat_days)),
    'campaigns', (select coalesce(jsonb_agg(jsonb_build_object(
      'source', source, 'visitors', visitors, 'sessions', sessions,
      'pageviews', pageviews, 'signup_started', signup_started)
      order by visitors desc, source), '[]'::jsonb) from campaign_rows),
    'money', jsonb_build_object(
      'pending_requests', (select count(*) from public.plan_requests where status = 'pending'),
      'pro_requested', (select count(*) from public.plan_requests
        where (created_at at time zone 'Asia/Bangkok')::date between v_from and v_to),
      'paying_customers', (select count(distinct provider_id) from payments
        where net_amount > 0 and provider_id is not null),
      'verified_payments', (select count(*) from payments),
      'gross_baht', (select coalesce(sum(amount), 0) from payments),
      'refund_baht', (select coalesce(sum(amount), 0) from refunds),
      'net_baht', (select coalesce(sum(amount), 0) from payments)
        - (select coalesce(sum(amount), 0) from refunds)),
    'renewal', (select coalesce(jsonb_agg(jsonb_build_object(
      'cohort_month', cohort_month,
      'first_month_payers', verified_first_month_payers,
      'renewed_month_2', verified_renewed_in_month_2,
      'percent', verified_renewal_percent) order by cohort_month desc), '[]'::jsonb)
      from public.pitch_verified_month2_renewal
      where cohort_month between date_trunc('month', v_from::timestamp)::date and v_to)
  ) into v_result;

  return v_result;
end $$;
revoke all on function public.owner_analytics(date, date, text, text, text) from public, anon;
grant execute on function public.owner_analytics(date, date, text, text, text) to authenticated, service_role;
comment on function public.owner_analytics(date, date, text, text, text) is
  'ตัวเลขแดชบอร์ดเจ้าของทั้งหมดในครั้งเดียว — ปฏิเสธผู้ที่ไม่ได้อยู่ใน analytics_owners ที่ฐานข้อมูล · เงินมาจากหลักฐานธนาคารเท่านั้น · ช่วงที่ไม่มีข้อมูลคืน 0';
