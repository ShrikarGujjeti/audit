-- 0016_media_confirm_lockdown.sql
-- Phase 6 backend hardening (Claude 1). Fixes three issues found by tracing the
-- FINAL state of the 0012 -> 0013 -> 0014 -> 0015 chain.
--
-- ISSUE 1 -- confirm_media_upload may still be callable by `authenticated`
--
-- 0014 revoked EXECUTE on the 2-arg overload from authenticated, and created
-- a 3-arg overload with `revoke ... from public; grant ... to service_role`.
-- `REVOKE ... FROM PUBLIC` only removes the implicit PUBLIC grant. It does NOT
-- remove grants made directly to `anon` / `authenticated` by Supabase's
-- default privileges (`ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS
-- TO anon, authenticated, service_role`), which are applied at CREATE time on
-- projects that have them. 0008 shows the author knew this for TABLES (it
-- revokes from anon explicitly); the same care was not applied to functions.
-- On such a project the 3-arg overload is executable by `authenticated`, and
-- because it trusts p_caller_id, any signed-in user can call
-- rpc('confirm_media_upload', {p_media_id, p_actual_file_size_bytes,
-- p_caller_id: <own id>}) and mark their own pending row `ready` with no R2
-- object -- the exact bypass 0014 was written to close.
-- Whether the hosted project has those default privileges is UNKNOWN from the
-- repository; this migration is correct either way.
--
-- Fix, two independent layers:
--   (a) explicit REVOKE from public, anon, authenticated; GRANT to service_role.
--   (b) the function itself rejects any caller whose JWT role claim is not
--       'service_role', so correctness no longer depends on ACL state.
-- The dead 2-arg overload is dropped (nothing calls it; a privileged function
-- nobody uses is pure attack surface).
--
-- ISSUE 2 -- the 'failed' transition never persisted
--
-- 0012/0013/0014 do `update ... set processing_status='failed'` and then
-- `raise exception`. A RAISE aborts the transaction (PostgREST runs each RPC
-- in one), so the UPDATE is rolled back. An oversize object therefore left its
-- row 'pending' forever. The function now RETURNS text ('ready' | 'failed') and
-- returns normally on the oversize path so the update commits. The caller
-- (confirmMediaUploadAction) then deletes the R2 object best-effort.
-- Changing the return type requires DROP + CREATE, hence the drop below.
--
-- ISSUE 3 -- client-supplied metadata was stored verbatim
--
-- request_media_upload is directly callable by any authenticated user, so
-- application-layer sanitisation is not authoritative. Dimensions, duration
-- and captured_at are normalised to NULL when implausible. This is a
-- DATA-QUALITY measure, not a security boundary (spec section 0.4: untrusted).
--
-- Also: explicit table-level revokes so media immutability does not depend on
-- RLS default-deny alone.

-- ============ 1. Confirm: drop old overloads, recreate service_role-only ============
drop function if exists public.confirm_media_upload(uuid, bigint);
drop function if exists public.confirm_media_upload(uuid, bigint, uuid);

create function public.confirm_media_upload(
  p_media_id uuid,
  p_actual_file_size_bytes bigint,
  p_caller_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims text;
  v_role text;
  v_media public.media;
  v_max_bytes bigint;
  v_is_member boolean;
begin
  -- Defence in depth (layer b): independent of EXECUTE grants.
  v_claims := nullif(current_setting('request.jwt.claims', true), '');
  v_role := coalesce(v_claims::jsonb ->> 'role', current_setting('request.jwt.claim.role', true));
  if v_role is distinct from 'service_role' then
    raise exception 'confirm_media_upload is restricted to trusted server code';
  end if;

  if p_caller_id is null then
    raise exception 'Caller id is required';
  end if;

  select * into v_media
  from public.media
  where id = p_media_id
  for update;

  if v_media is null then
    raise exception 'Media not found';
  end if;

  if v_media.uploader_id is distinct from p_caller_id then
    raise exception 'Not authorized to confirm this upload';
  end if;

  select exists (
    select 1 from public.trip_members
    where trip_id = v_media.trip_id and user_id = p_caller_id
  ) into v_is_member;

  if not v_is_member then
    raise exception 'You are no longer a member of this trip';
  end if;

  if v_media.processing_status <> 'pending' then
    raise exception 'This upload has already been processed';
  end if;

  if p_actual_file_size_bytes is null or p_actual_file_size_bytes <= 0 then
    raise exception 'Invalid confirmed file size';
  end if;

  v_max_bytes := public.max_media_bytes_for_type(v_media.media_type);
  if p_actual_file_size_bytes > v_max_bytes then
    -- Return, do not raise: a raise would roll this UPDATE back (issue 2).
    update public.media set processing_status = 'failed' where id = p_media_id;
    return 'failed';
  end if;

  update public.media
  set processing_status = 'ready',
      file_size_bytes = p_actual_file_size_bytes,
      uploaded_at = now()
  where id = p_media_id;

  return 'ready';
end;
$$;

revoke all on function public.confirm_media_upload(uuid, bigint, uuid) from public, anon, authenticated;
grant execute on function public.confirm_media_upload(uuid, bigint, uuid) to service_role;

-- ============ 2. request_media_upload: same contract, normalised metadata ============
create or replace function public.request_media_upload(
  p_trip_id uuid,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_original_filename text default null,
  p_captured_at timestamptz default null,
  p_width integer default null,
  p_height integer default null,
  p_duration_seconds numeric default null
)
returns table (media_id uuid, storage_key text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media_type text;
  v_max_bytes bigint;
  v_media_id uuid;
  v_storage_key text;
  v_extension text;
  v_safe_filename text;
  v_width integer;
  v_height integer;
  v_duration numeric;
  v_captured timestamptz;
begin
  if not public.is_trip_member(p_trip_id) then
    raise exception 'You must be a member of this trip to upload media';
  end if;

  v_media_type := public.media_type_for_mime(p_mime_type);
  if v_media_type is null then
    raise exception 'Unsupported file type: %', p_mime_type;
  end if;

  if p_file_size_bytes is null or p_file_size_bytes <= 0 then
    raise exception 'Invalid file size';
  end if;

  v_max_bytes := public.max_media_bytes_for_type(v_media_type);
  if p_file_size_bytes > v_max_bytes then
    raise exception 'File exceeds the % byte limit for %', v_max_bytes, v_media_type;
  end if;

  v_safe_filename := left(nullif(trim(p_original_filename), ''), 255);

  -- Data-quality normalisation (NULL comparisons yield NULL -> CASE gives NULL).
  v_width := case when p_width between 1 and 100000 then p_width end;
  v_height := case when p_height between 1 and 100000 then p_height end;
  v_duration := case when p_duration_seconds > 0 and p_duration_seconds <= 86400 then p_duration_seconds end;
  v_captured := case
    when p_captured_at >= timestamptz '1990-01-01 00:00:00+00'
     and p_captured_at <= now() + interval '1 day' then p_captured_at
  end;

  v_extension := case p_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    when 'image/heic' then 'heic'
    when 'image/heif' then 'heif'
    when 'video/mp4' then 'mp4'
    when 'video/quicktime' then 'mov'
    when 'video/webm' then 'webm'
  end;

  v_media_id := gen_random_uuid();
  v_storage_key := p_trip_id::text || '/' || v_media_id::text || '.' || v_extension;

  insert into public.media (
    id, trip_id, uploader_id, storage_key, media_type, original_filename,
    mime_type, file_size_bytes, width, height, duration_seconds,
    captured_at, processing_status
  )
  values (
    v_media_id, p_trip_id, auth.uid(), v_storage_key, v_media_type, v_safe_filename,
    p_mime_type, p_file_size_bytes, v_width, v_height, v_duration,
    v_captured, 'pending'
  );

  return query select v_media_id, v_storage_key;
end;
$$;

revoke all on function public.request_media_upload(uuid, text, bigint, text, timestamptz, integer, integer, numeric) from public, anon;
grant execute on function public.request_media_upload(uuid, text, bigint, text, timestamptz, integer, integer, numeric) to authenticated;

-- ============ 3. Grant hygiene ============
-- Internal helpers: only ever called from SECURITY DEFINER bodies (run as owner).
revoke all on function public.media_type_for_mime(text) from public, anon, authenticated;
revoke all on function public.max_media_bytes_for_type(text) from public, anon, authenticated;

-- media is immutable via the Data API and created only via request_media_upload().
revoke insert, update on public.media from anon, authenticated;
