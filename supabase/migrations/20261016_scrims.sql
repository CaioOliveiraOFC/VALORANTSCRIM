-- Scrims VALORANT: event sourcing transacional + Realtime.
-- Execute no SQL Editor de um projeto Supabase NOVO.
create table if not exists public.scrims (
  id text primary key check (id ~ '^[a-z0-9]{6,32}$'),
  admin_key_hash text not null,
  state jsonb not null,
  version integer not null default 1 check (version > 0),
  created_at bigint not null,
  updated_at bigint not null
);

create table if not exists public.scrim_events (
  scrim_id text not null references public.scrims(id) on delete restrict,
  seq integer not null check (seq > 0),
  at bigint not null,
  event jsonb not null,
  primary key (scrim_id, seq)
);
create index if not exists scrim_events_by_time on public.scrim_events(scrim_id, at);

alter table public.scrims enable row level security;
alter table public.scrim_events enable row level security;
-- A tabela scrims guarda o hash de admin e é acessível APENAS pelas funções serverless.
revoke all on table public.scrims from public, anon, authenticated;
revoke all on table public.scrim_events from public, anon, authenticated;
grant select on table public.scrim_events to anon, authenticated;
drop policy if exists scrim_events_public_read on public.scrim_events;
create policy scrim_events_public_read on public.scrim_events for select to anon, authenticated using (true);

-- RPC atômica: nunca deixa um estado gravado sem o primeiro evento.
create or replace function public.create_scrim(
  p_id text, p_key_hash text, p_state jsonb, p_event jsonb, p_at bigint
) returns void language plpgsql set search_path = '' as $$
begin
  insert into public.scrims(id, admin_key_hash, state, version, created_at, updated_at)
  values (p_id, p_key_hash, p_state, 1, p_at, p_at);
  insert into public.scrim_events(scrim_id, seq, at, event)
  values (p_id, 1, p_at, p_event);
end;
$$;

-- CAS + evento na MESMA transação: duas requisições concorrentes não sobrescrevem rounds.
create or replace function public.append_scrim_event(
  p_id text, p_key_hash text, p_expected_version integer,
  p_state jsonb, p_event jsonb
) returns void language plpgsql set search_path = '' as $$
begin
  update public.scrims
     set state = p_state, version = p_expected_version + 1,
         updated_at = (p_event->>'at')::bigint
   where id = p_id and admin_key_hash = p_key_hash and version = p_expected_version;
  if not found then
    raise exception 'STALE_OR_FORBIDDEN' using errcode = 'P0001';
  end if;
  insert into public.scrim_events(scrim_id, seq, at, event)
  values (p_id, p_expected_version + 1, (p_event->>'at')::bigint, p_event);
end;
$$;

-- Por padrão uma função pode ser executada por PUBLIC. Bloqueamos o acesso direto pelo navegador.
revoke execute on function public.create_scrim(text,text,jsonb,jsonb,bigint) from public, anon, authenticated;
revoke execute on function public.append_scrim_event(text,text,integer,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.create_scrim(text,text,jsonb,jsonb,bigint) to service_role;
grant execute on function public.append_scrim_event(text,text,integer,jsonb,jsonb) to service_role;

-- Publica inserts para os 10 participantes (sem acesso à chave de admin).
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'scrim_events') then
    alter publication supabase_realtime add table public.scrim_events;
  end if;
end $$;

-- Explicit privileges also work on projects without Supabase's default grants.
grant select, insert, update on public.scrims to service_role;
grant select, insert on public.scrim_events to service_role;

-- Import is append-only and atomic per scrim. Existing IDs are never overwritten.
create or replace function public.import_scrim(
  p_id text, p_key_hash text, p_state jsonb, p_events jsonb
) returns void language plpgsql set search_path = '' as $$
declare n integer; item jsonb; position bigint;
begin
  n := jsonb_array_length(p_events);
  if n < 1 or (p_state->>'version')::integer <> n or p_state->>'id' <> p_id
     or p_key_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'INVALID_IMPORT';
  end if;
  for item, position in select value, ordinality from jsonb_array_elements(p_events) with ordinality loop
    if (item->>'seq')::bigint is distinct from position then raise exception 'INVALID_IMPORT_SEQUENCE'; end if;
  end loop;
  if p_events->0->>'type' <> 'scrim.create' or p_events->0->>'id' <> p_id then
    raise exception 'INVALID_IMPORT_CREATE';
  end if;
  insert into public.scrims(id, admin_key_hash, state, version, created_at, updated_at)
  values(p_id, p_key_hash, p_state, n, (p_events->0->>'at')::bigint, (p_events->(n-1)->>'at')::bigint);
  insert into public.scrim_events(scrim_id, seq, at, event)
  select p_id, (value->>'seq')::integer, (value->>'at')::bigint, value
  from jsonb_array_elements(p_events);
end;
$$;
revoke execute on function public.import_scrim(text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.import_scrim(text,text,jsonb,jsonb) to service_role;
