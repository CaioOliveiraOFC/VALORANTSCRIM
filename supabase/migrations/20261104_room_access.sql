-- Additive room visibility and reversible removal. Existing history stays intact.
-- Apply after 20261016_scrims.sql and 20261017_match_imports.sql.
alter table public.scrims
  add column if not exists is_public boolean not null default true,
  add column if not exists deleted_at bigint,
  add column if not exists access_version integer not null default 1,
  add column if not exists access_updated_at bigint,
  add column if not exists access_updated_by uuid;

-- This narrowly scoped predicate exposes neither room metadata nor private hashes.
-- It runs as the migration owner because anon/authenticated cannot read scrims.
create or replace function public.scrim_is_public(p_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.scrims
     where id = p_id and is_public and deleted_at is null
  );
$$;
revoke execute on function public.scrim_is_public(text) from public, anon, authenticated;
grant execute on function public.scrim_is_public(text) to anon, authenticated, service_role;

drop policy if exists scrim_events_public_read on public.scrim_events;
create policy scrim_events_public_read on public.scrim_events
  for select to anon, authenticated
  using (public.scrim_is_public(scrim_id));

-- Keep the original five-argument create_scrim RPC for legacy imports/callers.
-- The first event and the initial visibility commit in one transaction.
create or replace function public.create_scrim_with_access(
  p_id text, p_key_hash text, p_state jsonb, p_event jsonb,
  p_at bigint, p_is_public boolean
) returns void language plpgsql set search_path = '' as $$
begin
  if p_is_public is null then
    raise exception 'INVALID_ACCESS' using errcode = 'P0001';
  end if;
  perform public.create_scrim(p_id, p_key_hash, p_state, p_event, p_at);
  update public.scrims set is_public = p_is_public where id = p_id;
end;
$$;

-- Authorization (admin vs room-removal capability) belongs to the server.
-- The database enforces atomic transitions, optimistic locking and audit fields.
create or replace function public.manage_scrim_access(
  p_id text, p_expected_access_version integer, p_action text,
  p_at bigint, p_actor_id uuid
) returns table(is_public boolean, deleted_at bigint, access_version integer)
language plpgsql set search_path = '' as $$
begin
  if p_action is null or p_action not in ('show', 'hide', 'delete', 'restore')
     or p_expected_access_version is null or p_expected_access_version < 1
     or p_at is null or p_at < 0 or p_actor_id is null then
    raise exception 'INVALID_ACCESS' using errcode = 'P0001';
  end if;
  return query
    update public.scrims as s
       set is_public = (p_action = 'show'),
           deleted_at = case when p_action = 'delete' then p_at else null end,
           access_version = s.access_version + 1,
           access_updated_at = p_at,
           access_updated_by = p_actor_id
     where s.id = p_id
       and s.access_version = p_expected_access_version
       and ((p_action = 'restore' and s.deleted_at is not null)
         or (p_action <> 'restore' and s.deleted_at is null))
    returning s.is_public, s.deleted_at, s.access_version;
  if not found then
    raise exception 'STALE_OR_FORBIDDEN' using errcode = 'P0001';
  end if;
end;
$$;

-- This guard is shared by commands, room tools and transactional match imports.
-- A writer racing a removal rechecks deleted_at after acquiring the row lock.
create or replace function public.append_scrim_event(
  p_id text, p_key_hash text, p_expected_version integer,
  p_state jsonb, p_event jsonb
) returns void language plpgsql set search_path = '' as $$
begin
  update public.scrims
     set state = p_state, version = p_expected_version + 1,
         updated_at = (p_event->>'at')::bigint
   where id = p_id and admin_key_hash = p_key_hash
     and version = p_expected_version and deleted_at is null;
  if not found then
    raise exception 'STALE_OR_FORBIDDEN' using errcode = 'P0001';
  end if;
  insert into public.scrim_events(scrim_id, seq, at, event)
  values (p_id, p_expected_version + 1, (p_event->>'at')::bigint, p_event);
end;
$$;

create or replace function public.claim_match_lookup(p_id text, p_key_hash text)
returns boolean language plpgsql set search_path = '' as $$
declare slot bigint; n integer;
begin
  if not exists (
    select 1 from public.scrims
     where id = p_id and admin_key_hash = p_key_hash and deleted_at is null
  ) then
    raise exception 'STALE_OR_FORBIDDEN';
  end if;
  slot := floor(extract(epoch from clock_timestamp()) / 60)::bigint;
  insert into public.scrim_import_limits(bucket, window_start, requests) values('global', slot, 1)
  on conflict(bucket) do update set window_start = slot,
    requests = case when scrim_import_limits.window_start = slot then scrim_import_limits.requests + 1 else 1 end
  returning requests into n;
  if n > 60 then return false; end if;
  insert into public.scrim_import_limits(bucket, window_start, requests) values('room:' || p_id, slot, 1)
  on conflict(bucket) do update set window_start = slot,
    requests = case when scrim_import_limits.window_start = slot then scrim_import_limits.requests + 1 else 1 end
  returning requests into n;
  return n <= 12;
end;
$$;

revoke execute on function public.create_scrim_with_access(text,text,jsonb,jsonb,bigint,boolean) from public, anon, authenticated;
revoke execute on function public.manage_scrim_access(text,integer,text,bigint,uuid) from public, anon, authenticated;
revoke execute on function public.append_scrim_event(text,text,integer,jsonb,jsonb) from public, anon, authenticated;
revoke execute on function public.claim_match_lookup(text,text) from public, anon, authenticated;
grant execute on function public.create_scrim_with_access(text,text,jsonb,jsonb,bigint,boolean) to service_role;
grant execute on function public.manage_scrim_access(text,integer,text,bigint,uuid) to service_role;
grant execute on function public.append_scrim_event(text,text,integer,jsonb,jsonb) to service_role;
grant execute on function public.claim_match_lookup(text,text) to service_role;

notify pgrst, 'reload schema';
