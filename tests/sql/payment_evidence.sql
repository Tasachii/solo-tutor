\set ON_ERROR_STOP on
begin;

insert into auth.users(id) values
  ('e1000000-0000-4000-8000-000000000001'),
  ('e1000000-0000-4000-8000-000000000002');
insert into public.plan_requests(provider_id, months, amount, note) values
  ('e1000000-0000-4000-8000-000000000001', 1, 299, 'synthetic payment test'),
  ('e1000000-0000-4000-8000-000000000002', 1, 299, 'synthetic payment test');

do $$
begin
  if has_table_privilege('authenticated', 'public.plan_financial_evidence', 'select')
    or has_table_privilege('authenticated', 'public.plan_financial_evidence', 'insert') then
    raise exception 'teacher can access payment evidence';
  end if;
  if has_table_privilege('service_role', 'public.plan_financial_evidence', 'insert') then
    raise exception 'service role can bypass evidence RPC validation';
  end if;
  if has_function_privilege('authenticated',
      'public.approve_plan_request_verified(uuid,text,integer,timestamptz,text)', 'execute')
    or has_function_privilege('authenticated',
      'public.record_plan_refund(uuid,text,integer,timestamptz,text)', 'execute') then
    raise exception 'teacher can verify payments or refunds';
  end if;
end $$;

set role service_role;
do $$
declare
  v_first_request uuid := (select id from public.plan_requests
    where provider_id = 'e1000000-0000-4000-8000-000000000001' and status = 'pending');
begin
  begin
    perform public.approve_plan_request_verified(v_first_request, 'BANK-WRONG-AMOUNT', 298, now(), 'ops-a');
    raise exception 'wrong received amount was accepted';
  exception when sqlstate '22023' then null;
  end;
  if (select status from public.plan_requests where id = v_first_request) <> 'pending'
    or exists (select 1 from public.plan_financial_evidence where plan_request_id = v_first_request) then
    raise exception 'failed verification did not roll approval/evidence back atomically';
  end if;
end $$;

do $$
declare
  v_first_request uuid := (select id from public.plan_requests
    where provider_id = 'e1000000-0000-4000-8000-000000000001' and status = 'pending');
  v_second_request uuid := (select id from public.plan_requests
    where provider_id = 'e1000000-0000-4000-8000-000000000002' and status = 'pending');
  v_payment uuid;
  v_second_payment uuid;
  v_previous_month timestamptz := ((date_trunc('month', now() at time zone 'Asia/Bangkok')::date - 1
    + time '12:00') at time zone 'Asia/Bangkok');
  v_current_month timestamptz := ((date_trunc('month', now() at time zone 'Asia/Bangkok')::date
    + time '12:00') at time zone 'Asia/Bangkok');
  r record;
begin
  begin
    perform public.approve_plan_request_verified(
      v_first_request, 'BANK-INFINITE', 299, '-infinity'::timestamptz, 'operator one'
    );
    raise exception 'non-finite payment occurrence was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.approve_plan_request_verified(
      v_first_request, 'BANK-FUTURE', 299, now() + interval '6 minutes', 'operator one'
    );
    raise exception 'future bank occurrence was accepted';
  exception when sqlstate '22023' then null;
  end;
  select * into r from public.approve_plan_request_verified(
    v_first_request, ' bank-txn-001 ', 299, v_previous_month, ' operator one '
  );
  v_payment := r.evidence_id;
  if r.plan <> 'pro' or r.receipt_no is null then raise exception 'verified approval did not grant plan/receipt'; end if;
  if not exists (select 1 from public.plan_financial_evidence
      where id = v_payment and evidence_type = 'payment' and bank_reference = 'BANK-TXN-001'
        and amount = 299 and occurred_at = v_previous_month
        and verified_by = 'operator one' and verified_at is not null) then
    raise exception 'verified payment evidence fields are incomplete';
  end if;

  begin
    perform public.approve_plan_request_verified(v_second_request, 'BANK-TXN-001', 299, v_current_month, 'operator two');
    raise exception 'duplicate bank reference was accepted';
  exception when unique_violation then null;
  end;
  if (select status from public.plan_requests where id = v_second_request) <> 'pending'
    or exists (select 1 from public.plan_financial_evidence where plan_request_id = v_second_request) then
    raise exception 'duplicate reference did not roll second approval back';
  end if;

  select * into r from public.approve_plan_request_verified(
    v_second_request, 'BANK-TXN-002', 299, v_current_month, 'operator two'
  );
  if r.evidence_id is null then raise exception 'second verified approval returned no evidence'; end if;
  v_second_payment := r.evidence_id;

  begin
    perform public.record_plan_refund(
      v_payment, 'BANK-REFUND-INFINITE', 1, '-infinity'::timestamptz, 'operator one'
    );
    raise exception 'non-finite refund occurrence was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.record_plan_refund(
      v_payment, 'BANK-REFUND-BEFORE', 1, v_previous_month - interval '1 second', 'operator one'
    );
    raise exception 'refund before payment occurrence was accepted';
  exception when sqlstate '22023' then null;
  end;
  select * into r from public.record_plan_refund(
    v_payment, 'BANK-REFUND-001', 100, v_previous_month + interval '1 hour', 'operator one'
  );
  if r.refunded_amount <> 100 or r.total_refunded <> 100 then raise exception 'first refund totals are wrong'; end if;
  begin
    perform public.record_plan_refund(
      v_second_payment, ' bank-refund-001 ', 1, v_current_month + interval '1 hour', 'operator two'
    );
    raise exception 'duplicate refund bank reference was accepted';
  exception when unique_violation then null;
  end;
  if exists (select 1 from public.plan_financial_evidence
      where payment_evidence_id = v_second_payment and evidence_type = 'refund') then
    raise exception 'duplicate refund reference left a refund row';
  end if;
  select * into r from public.record_plan_refund(
    v_payment, 'BANK-REFUND-002', 199, v_previous_month + interval '2 hours', 'operator one'
  );
  if r.total_refunded <> 299 then raise exception 'cumulative refund cap did not reach exact payment'; end if;
  begin
    perform public.record_plan_refund(
      v_payment, 'BANK-REFUND-003', 1, v_previous_month + interval '3 hours', 'operator one'
    );
    raise exception 'refund above paid amount was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.record_plan_refund(
      r.evidence_id, 'BANK-REFUND-004', 1, v_previous_month + interval '3 hours', 'operator one'
    );
    raise exception 'refund evidence was reused as a payment parent';
  exception when sqlstate '22023' then null;
  end;
end $$;
reset role;

do $$
begin
  begin
    update public.plan_financial_evidence set verified_by = 'rewritten' where bank_reference = 'BANK-TXN-001';
    raise exception 'payment evidence update was accepted';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from public.plan_financial_evidence where bank_reference = 'BANK-REFUND-001';
    raise exception 'refund evidence delete was accepted';
  exception when sqlstate '55000' then null;
  end;
end $$;

-- A legacy approval is visible only in the explicitly unverified columns.
insert into public.plan_requests(provider_id, months, amount, status, decided_at, receipt_no)
values ('e1000000-0000-4000-8000-000000000002', 3, 799, 'approved', now(), 'SP-EVIDENCE-LEGACY');

-- Paid account erasure detaches the retained receipt but preserves minimal
-- financial evidence and removes it from identity-based customer counts.
delete from auth.users where id = 'e1000000-0000-4000-8000-000000000001';
do $$
declare
  v_month date := date_trunc('month', now() at time zone 'Asia/Bangkok')::date;
  v_previous_month date := (date_trunc('month', now() at time zone 'Asia/Bangkok')::date - 1);
  r record;
begin
  if (select count(*) from public.plan_financial_evidence
      where bank_reference in ('BANK-TXN-001', 'BANK-REFUND-001', 'BANK-REFUND-002')) <> 3 then
    raise exception 'account erasure removed retained financial evidence';
  end if;
  if exists (select 1 from public.plan_requests pr join public.plan_financial_evidence e
      on e.plan_request_id = pr.id where e.bank_reference = 'BANK-TXN-001'
        and (pr.provider_id is not null or pr.note is not null)) then
    raise exception 'erased payment retained provider identity or request note';
  end if;
  select * into r from public.pitch_revenue_monthly where revenue_month = v_month;
  if r.verified_payments <> 1 or r.verified_net_positive_providers <> 1
    or r.verified_gross_baht <> 299 or r.verified_refund_baht <> 0 or r.verified_net_baht <> 299
    or r.erased_verified_payments <> 0 or r.legacy_unverified_approvals < 1
    or r.legacy_unverified_gross_baht < 799 then
    raise exception 'pitch revenue did not separate verified/refund/net/legacy values: %', row_to_json(r);
  end if;
  select * into r from public.pitch_revenue_monthly
    where revenue_month = date_trunc('month', v_previous_month)::date;
  if r.verified_payments <> 1 or r.verified_net_positive_providers <> 0
    or r.verified_gross_baht <> 299 or r.verified_refund_baht <> 299 or r.verified_net_baht <> 0
    or r.erased_verified_payments <> 1 then
    raise exception 'delayed verification was not attributed to bank occurrence month: %', row_to_json(r);
  end if;
  if (select plan from public.providers where id = 'e1000000-0000-4000-8000-000000000002') <> 'pro' then
    raise exception 'refund recording unexpectedly revoked a plan';
  end if;
end $$;

rollback;
