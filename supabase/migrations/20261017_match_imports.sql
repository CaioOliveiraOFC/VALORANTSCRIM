-- Additive migration: preserve all existing scrims and event history.
create table if not exists public.scrim_match_imports (
  scrim_id text not null references public.scrims(id) on delete cascade,
  provider text not null check (provider = 'henrik'),
  match_id uuid not null,
  map_index integer not null check (map_index >= 0),
  event_seq integer not null,
  imported_at bigint not null,
  confirmed_by text not null check (confirmed_by = 'scrim-admin'),
  raw jsonb not null,
  primary key(scrim_id, provider, match_id)
);
alter table public.scrim_match_imports enable row level security;
revoke all on public.scrim_match_imports from public, anon, authenticated;
grant select, insert on public.scrim_match_imports to service_role;

create or replace function public.import_match_result(
  p_id text, p_key_hash text, p_expected_version integer,
  p_state jsonb, p_event jsonb, p_raw jsonb
) returns void language plpgsql set search_path = '' as $$
begin
  if p_event->>'type' is distinct from 'match.import'
     or (p_event->>'seq')::integer is distinct from p_expected_version + 1
     or (p_state->>'version')::integer is distinct from p_expected_version + 1
     or p_state->>'id' is distinct from p_id then
    raise exception 'INVALID_IMPORT';
  end if;
  -- This locks the scrim row and performs the same compare-and-swap as commands.
  perform public.append_scrim_event(p_id, p_key_hash, p_expected_version, p_state, p_event);
  insert into public.scrim_match_imports(scrim_id, provider, match_id, map_index, event_seq, imported_at, confirmed_by, raw)
  values(p_id, 'henrik', (p_event->'match'->>'id')::uuid, (p_event->>'mapIndex')::integer,
         (p_event->>'seq')::integer, (p_event->>'at')::bigint, 'scrim-admin', p_raw);
  -- A duplicate import rolls back the state and event too. No partial writes.
end;
$$;
revoke execute on function public.import_match_result(text,text,integer,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.import_match_result(text,text,integer,jsonb,jsonb,jsonb) to service_role;
notify pgrst, 'reload schema';

-- Shared serverless rate limit: authenticated rooms still share one provider key.
create table if not exists public.scrim_import_limits (
  bucket text primary key,
  window_start bigint not null,
  requests integer not null
);
alter table public.scrim_import_limits enable row level security;
revoke all on public.scrim_import_limits from public, anon, authenticated;
grant select, insert, update, delete on public.scrim_import_limits to service_role;
create or replace function public.claim_match_lookup(p_id text, p_key_hash text)
returns boolean language plpgsql set search_path = '' as $$
declare slot bigint; n integer;
begin
  if not exists(select 1 from public.scrims where id=p_id and admin_key_hash=p_key_hash) then
    raise exception 'STALE_OR_FORBIDDEN';
  end if;
  slot := floor(extract(epoch from clock_timestamp()) / 60)::bigint;
  -- One bucket per room avoids a new row every minute; lock global first to avoid deadlocks.
  insert into public.scrim_import_limits(bucket, window_start, requests) values('global',slot,1)
  on conflict(bucket) do update set window_start=slot,
    requests=case when scrim_import_limits.window_start=slot then scrim_import_limits.requests+1 else 1 end
  returning requests into n;
  if n > 60 then return false; end if;
  insert into public.scrim_import_limits(bucket, window_start, requests) values('room:'||p_id,slot,1)
  on conflict(bucket) do update set window_start=slot,
    requests=case when scrim_import_limits.window_start=slot then scrim_import_limits.requests+1 else 1 end
  returning requests into n;
  return n <= 12;
end;
$$;
revoke execute on function public.claim_match_lookup(text,text) from public, anon, authenticated;
grant execute on function public.claim_match_lookup(text,text) to service_role;
notify pgrst, 'reload schema';
