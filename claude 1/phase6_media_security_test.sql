-- phase6_media_security_test.sql
-- Run in the Supabase SQL Editor (as postgres) AFTER applying 0012-0016, or
-- via psql with ON_ERROR_STOP=1. Everything is rolled back at the end.
-- Any FAIL raises an exception; every PASS emits a NOTICE.

begin;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'uploader@t.test'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'outsider@t.test');

insert into public.trips (id, owner_id, name)
values ('cccccccc-0000-0000-0000-00000000000c', 'aaaaaaaa-0000-0000-0000-00000000000a', 'T');

-- The on_trip_created trigger already adds the owner; harmless if absent.
insert into public.trip_members (trip_id, user_id, role)
values ('cccccccc-0000-0000-0000-00000000000c', 'aaaaaaaa-0000-0000-0000-00000000000a', 'owner')
on conflict do nothing;

-- T1: member can request uploads (three rows; third has junk metadata)
do $$
declare v1 uuid; v2 uuid; v3 uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  select media_id into v1 from public.request_media_upload('cccccccc-0000-0000-0000-00000000000c', 'image/jpeg', 1000, 'a.jpg');
  select media_id into v2 from public.request_media_upload('cccccccc-0000-0000-0000-00000000000c', 'image/jpeg', 1000, 'b.jpg');
  select media_id into v3 from public.request_media_upload('cccccccc-0000-0000-0000-00000000000c', 'video/mp4', 5000, 'c.mp4', timestamptz '1970-01-01', -5, 0, -1);
  perform set_config('t.m1', v1::text, true);
  perform set_config('t.m2', v2::text, true);
  perform set_config('t.m3', v3::text, true);
  reset role;
  raise notice 'PASS T1 member request_media_upload';
end $$;

-- T2: authenticated can NOT call confirm directly (the bypass)
do $$
declare v_ok boolean := false;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  begin
    perform public.confirm_media_upload(current_setting('t.m1')::uuid, 1000, 'aaaaaaaa-0000-0000-0000-00000000000a'::uuid);
  exception when insufficient_privilege then v_ok := true;
  end;
  reset role;
  if not v_ok then raise exception 'FAIL T2: authenticated reached confirm_media_upload'; end if;
  raise notice 'PASS T2 authenticated cannot EXECUTE confirm_media_upload';
end $$;

-- T3: the legacy 2-arg overload no longer exists
do $$
declare v_ok boolean := false;
begin
  set local role authenticated;
  begin
    perform public.confirm_media_upload(current_setting('t.m1')::uuid, 1000::bigint);
  exception when undefined_function then v_ok := true;
  end;
  reset role;
  if not v_ok then raise exception 'FAIL T3: 2-arg overload still present'; end if;
  raise notice 'PASS T3 legacy overload dropped';
end $$;

-- T4/T5: no direct UPDATE / INSERT on media for authenticated
do $$
declare v_upd boolean := false; v_ins boolean := false;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  begin
    update public.media set processing_status = 'ready' where id = current_setting('t.m1')::uuid;
  exception when insufficient_privilege then v_upd := true;
  end;
  begin
    insert into public.media (trip_id, uploader_id, storage_key, media_type, mime_type, file_size_bytes)
    values ('cccccccc-0000-0000-0000-00000000000c', 'aaaaaaaa-0000-0000-0000-00000000000a', 'x/y.jpg', 'photo', 'image/jpeg', 1);
  exception when insufficient_privilege then v_ins := true;
  end;
  reset role;
  if not v_upd then raise exception 'FAIL T4: authenticated may UPDATE media'; end if;
  if not v_ins then raise exception 'FAIL T5: authenticated may INSERT media'; end if;
  raise notice 'PASS T4/T5 media UPDATE and INSERT closed';
end $$;

-- T6: anon cannot call either RPC
do $$
declare v_a boolean := false; v_b boolean := false;
begin
  set local role anon;
  begin
    perform public.request_media_upload('cccccccc-0000-0000-0000-00000000000c', 'image/jpeg', 1000);
  exception when insufficient_privilege then v_a := true;
  end;
  begin
    perform public.confirm_media_upload(current_setting('t.m1')::uuid, 1000, 'aaaaaaaa-0000-0000-0000-00000000000a'::uuid);
  exception when insufficient_privilege then v_b := true;
  end;
  reset role;
  if not (v_a and v_b) then raise exception 'FAIL T6: anon reached a media RPC'; end if;
  raise notice 'PASS T6 anon denied';
end $$;

-- T7: service_role path: non-uploader rejected, uploader confirmed, replay rejected
do $$
declare r text; v_non boolean := false; v_replay boolean := false;
begin
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    perform public.confirm_media_upload(current_setting('t.m1')::uuid, 1000, 'bbbbbbbb-0000-0000-0000-00000000000b'::uuid);
  exception when raise_exception then v_non := sqlerrm like 'Not authorized%';
  end;
  r := public.confirm_media_upload(current_setting('t.m1')::uuid, 1000, 'aaaaaaaa-0000-0000-0000-00000000000a'::uuid);
  begin
    perform public.confirm_media_upload(current_setting('t.m1')::uuid, 1000, 'aaaaaaaa-0000-0000-0000-00000000000a'::uuid);
  exception when raise_exception then v_replay := sqlerrm like '%already been processed%';
  end;
  reset role;
  if not v_non then raise exception 'FAIL T7a: non-uploader not rejected'; end if;
  if r is distinct from 'ready' then raise exception 'FAIL T7b: expected ready, got %', r; end if;
  if not v_replay then raise exception 'FAIL T7c: replay not rejected'; end if;
  raise notice 'PASS T7 service_role confirm semantics';
end $$;

-- T8: oversize -> 'failed' and the status PERSISTS (the old raise rolled it back)
do $$
declare r text;
begin
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r := public.confirm_media_upload(current_setting('t.m2')::uuid, 26214401, 'aaaaaaaa-0000-0000-0000-00000000000a'::uuid);
  reset role;
  if r is distinct from 'failed' then raise exception 'FAIL T8a: got %', r; end if;
  if (select processing_status from public.media where id = current_setting('t.m2')::uuid) <> 'failed' then
    raise exception 'FAIL T8b: failed status did not persist';
  end if;
  raise notice 'PASS T8 oversize persists failed';
end $$;

-- T9: the in-function role check holds even if EXECUTE is (mis)granted
grant execute on function public.confirm_media_upload(uuid, bigint, uuid) to authenticated;
do $$
declare v_ok boolean := false;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  begin
    perform public.confirm_media_upload(current_setting('t.m3')::uuid, 5000, 'aaaaaaaa-0000-0000-0000-00000000000a'::uuid);
  exception when raise_exception then v_ok := sqlerrm like '%restricted to trusted server code%';
  end;
  reset role;
  if not v_ok then raise exception 'FAIL T9: role self-check did not fire'; end if;
  raise notice 'PASS T9 self-check independent of ACL';
end $$;
revoke execute on function public.confirm_media_upload(uuid, bigint, uuid) from authenticated;

-- T10: metadata normalisation
do $$
declare w int; h int; d numeric; c timestamptz;
begin
  select width, height, duration_seconds, captured_at into w, h, d, c
  from public.media where id = current_setting('t.m3')::uuid;
  if w is not null or h is not null or d is not null or c is not null then
    raise exception 'FAIL T10: junk metadata stored (% % % %)', w, h, d, c;
  end if;
  raise notice 'PASS T10 metadata normalised';
end $$;

rollback;
