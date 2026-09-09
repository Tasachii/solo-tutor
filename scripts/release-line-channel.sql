-- ปลด OA ออกจากบัญชีครูที่ถืออยู่ · ต้องมีช่องเดียวในระบบ ไม่งั้นหยุดทันที (กันลบผิดคน)
\set ON_ERROR_STOP on
begin;
do $$
declare v_count integer; v_provider uuid; v_bot text;
begin
  select count(*) into v_count from public.line_channels;
  if v_count <> 1 then
    raise exception 'expected exactly one LINE channel, found % — refusing to guess', v_count;
  end if;
  select provider_id, bot_user_id into v_provider, v_bot from public.line_channels;
  delete from public.line_link_codes where provider_id = v_provider;
  delete from public.line_channels where provider_id = v_provider;
  raise notice 'released channel for bot %… from one teacher account; link codes cleared', left(v_bot, 6);
end $$;
select 'line_channels_left=' || count(*) from public.line_channels;
select 'line_recipients_kept=' || count(*) from public.line_recipients;
commit;
