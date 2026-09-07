\set ON_ERROR_STOP on
-- สัญญาของ save_ledger_snapshot: เขียนครั้งแรกด้วย expected 0 · ชนเมื่อ expected ไม่ตรง · อีกบัญชีมองไม่เห็น
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
do $$
declare r record;
begin
  select * into r from public.save_ledger_snapshot(0, 1, 5, 'cipher-one', 'iv-one', 'pbkdf2-sha256-310000', 'phone');
  if not r.ok or r.revision <> 1 then raise exception 'first save must succeed with revision 1'; end if;

  select * into r from public.save_ledger_snapshot(0, 2, 5, 'cipher-stale', 'iv', 'pbkdf2-sha256-310000', 'laptop');
  if r.ok or r.revision <> 1 then raise exception 'stale writer must be refused and told the current revision'; end if;
  if (select cipher from public.ledger_snapshots) <> 'cipher-one' then raise exception 'stale writer overwrote the snapshot'; end if;

  select * into r from public.save_ledger_snapshot(1, 2, 5, 'cipher-two', 'iv-two', 'pbkdf2-sha256-310000', 'laptop');
  if not r.ok or r.revision <> 2 then raise exception 'writer with the current revision must succeed'; end if;

  begin
    perform public.save_ledger_snapshot(2, 2, 5, 'cipher-x', 'iv', 'kdf', null);
    raise exception 'revision must strictly increase';
  exception when sqlstate '22023' then null;
  end;

  if has_table_privilege('authenticated', 'public.ledger_snapshots', 'insert')
     or has_table_privilege('authenticated', 'public.ledger_snapshots', 'update')
     or has_table_privilege('authenticated', 'public.ledger_snapshots', 'delete') then
    raise exception 'authenticated role can bypass the revision check';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', false);
do $$
begin
  if (select count(*) from public.ledger_snapshots) <> 0 then raise exception 'RLS exposed another teacher''s snapshot'; end if;
  if public.delete_ledger_snapshot() then raise exception 'other account deleted a snapshot it cannot see'; end if;
end $$;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
do $$
begin
  if (select count(*) from public.ledger_snapshots) <> 1 then raise exception 'owner must see exactly one snapshot'; end if;
  if not public.delete_ledger_snapshot() then raise exception 'owner delete must report a removed row'; end if;
  if (select count(*) from public.ledger_snapshots) <> 0 then raise exception 'delete left the snapshot behind'; end if;
end $$;
reset role;
