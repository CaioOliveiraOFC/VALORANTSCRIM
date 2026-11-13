-- Twitch broadcasts: independent home promotion or a broadcast linked to a VCT.
-- Apply after 20261105_super_admin.sql. No existing events or rooms are rewritten.
begin;

create table if not exists public.scrim_broadcasts (
  scope text primary key,
  room_id text unique references public.scrims(id) on delete cascade,
  title text not null default 'Transmissão da Brasa',
  channels jsonb not null default '[]',
  enabled boolean not null default false,
  promote_home boolean not null default false,
  version integer not null default 0 check (version >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id),
  check ((scope = 'home' and room_id is null) or (room_id is not null and scope = 'room:' || room_id)),
  check (length(trim(title)) between 1 and 100),
  check (jsonb_typeof(channels) = 'array' and jsonb_array_length(channels) <= 6)
);
alter table public.scrim_broadcasts enable row level security;
revoke all on public.scrim_broadcasts from public, anon, authenticated, service_role;

create or replace function public.scrim_broadcast_dto(p_row public.scrim_broadcasts)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('roomId', p_row.room_id,
    'roomTitle', (select s.state->>'title' from public.scrims s where s.id = p_row.room_id),
    'title', p_row.title, 'channels', p_row.channels, 'enabled', p_row.enabled,
    'promoteHome', p_row.promote_home, 'version', p_row.version);
$$;

create or replace function public.get_public_broadcasts()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(public.scrim_broadcast_dto(b) order by b.scope), '[]')
    from public.scrim_broadcasts b left join public.scrims s on s.id = b.room_id
    where b.enabled and (b.scope = 'home' or (b.promote_home and s.is_public and s.deleted_at is null));
$$;

create or replace function public.get_room_broadcast(p_room_id text, p_actor_id uuid, p_actor_session_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room public.scrims%rowtype; v_super boolean;
begin
  select * into v_room from public.scrims where id = p_room_id and deleted_at is null;
  if not found then raise exception 'SCRIM_DELETED'; end if;
  if not v_room.is_public then
    if p_actor_id is null or p_actor_session_version is null or p_actor_session_version < 0 then raise exception 'SCRIM_DELETED'; end if;
    v_super := public.scrim_admin_assert_actor(p_actor_id, '{}', p_actor_session_version);
    if not v_super and v_room.owner_user_id <> p_actor_id then raise exception 'SCRIM_DELETED'; end if;
  end if;
  return (select public.scrim_broadcast_dto(b) from public.scrim_broadcasts b where b.room_id = p_room_id and b.enabled);
end;
$$;

create or replace function public.get_admin_broadcasts(p_actor_id uuid, p_actor_session_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_super boolean;
begin
  if p_actor_session_version is null or p_actor_session_version < 0 then raise exception 'INVALID_ADMIN_INPUT'; end if;
  v_super := public.scrim_admin_assert_actor(p_actor_id, array['editRoom'], p_actor_session_version);
  return (select coalesce(jsonb_agg(public.scrim_broadcast_dto(b) order by b.scope), '[]')
    from public.scrim_broadcasts b left join public.scrims s on s.id = b.room_id
    where (v_super or s.owner_user_id = p_actor_id) and (b.scope = 'home' or s.deleted_at is null));
end;
$$;

create or replace function public.set_broadcast(
  p_actor_id uuid, p_actor_session_version integer, p_room_id text,
  p_expected_version integer, p_title text, p_channels jsonb, p_enabled boolean, p_promote_home boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_super boolean; v_room public.scrims%rowtype; v_scope text;
  v_before public.scrim_broadcasts%rowtype; v_after public.scrim_broadcasts%rowtype;
  v_channel jsonb; v_seen text[] := '{}';
begin
  if p_actor_session_version is null or p_actor_session_version < 0 or
     p_expected_version is null or p_expected_version < 0 or
     p_title is null or length(trim(p_title)) not between 1 and 100 or p_title ~ '[[:cntrl:]]' or
     p_enabled is null or p_promote_home is null or p_channels is null or
     jsonb_typeof(p_channels) <> 'array' then raise exception 'INVALID_BROADCAST'; end if;
  if jsonb_array_length(p_channels) > 6 or (p_enabled and jsonb_array_length(p_channels) = 0) then raise exception 'INVALID_BROADCAST'; end if;
  for v_channel in select value from jsonb_array_elements(p_channels) loop
    if jsonb_typeof(v_channel) <> 'object' or
       (select count(*) from jsonb_object_keys(v_channel)) <> 2 or
       jsonb_typeof(v_channel->'channel') is distinct from 'string' or
       jsonb_typeof(v_channel->'label') is distinct from 'string' or
       (v_channel->>'channel') !~ '^[a-z0-9_]{1,25}$' or
       (v_channel->>'channel') = any(array['videos','directory','downloads','settings','subscriptions','inventory','search','login','signup','embed','moderator','payments','wallet','turbo','jobs','p']) or
       length(trim(v_channel->>'label')) not between 1 and 40 or (v_channel->>'label') ~ '[[:cntrl:]]' or
       (v_channel->>'channel') = any(v_seen) then raise exception 'INVALID_BROADCAST'; end if;
    v_seen := array_append(v_seen, v_channel->>'channel');
  end loop;
  -- Lock order matches room management: account -> room -> broadcast.
  v_super := public.scrim_admin_assert_actor(p_actor_id, array['editRoom'], p_actor_session_version);
  if p_room_id is null then
    if not v_super or p_promote_home then raise exception 'ADMIN_FORBIDDEN'; end if;
    v_scope := 'home';
  else
    select * into v_room from public.scrims where id = p_room_id for update;
    if not found or v_room.deleted_at is not null then raise exception 'SCRIM_DELETED'; end if;
    if not v_super and v_room.owner_user_id <> p_actor_id then raise exception 'ADMIN_FORBIDDEN'; end if;
    if p_promote_home then
      perform public.scrim_admin_assert_actor(p_actor_id, array['publishRooms'], p_actor_session_version);
      if not v_room.is_public then raise exception 'ROOM_NOT_PUBLIC'; end if;
    end if;
    v_scope := 'room:' || p_room_id;
  end if;
  insert into public.scrim_broadcasts(scope, room_id) values(v_scope, p_room_id) on conflict(scope) do nothing;
  select * into v_before from public.scrim_broadcasts where scope = v_scope for update;
  if v_before.version <> p_expected_version then raise exception 'STALE_BROADCAST'; end if;
  update public.scrim_broadcasts set title = trim(p_title), channels = p_channels, enabled = p_enabled,
    promote_home = p_promote_home, version = version + 1, updated_at = clock_timestamp(), updated_by = p_actor_id
    where scope = v_scope returning * into v_after;
  perform public.scrim_admin_write_audit(p_actor_id, 'broadcast.update', null, p_room_id,
    public.scrim_broadcast_dto(v_before), public.scrim_broadcast_dto(v_after));
  return public.scrim_broadcast_dto(v_after);
end;
$$;

revoke execute on function public.scrim_broadcast_dto(public.scrim_broadcasts) from public, anon, authenticated, service_role;
revoke execute on function public.get_public_broadcasts() from public, anon, authenticated;
revoke execute on function public.get_room_broadcast(text,uuid,integer) from public, anon, authenticated;
revoke execute on function public.get_admin_broadcasts(uuid,integer) from public, anon, authenticated;
revoke execute on function public.set_broadcast(uuid,integer,text,integer,text,jsonb,boolean,boolean) from public, anon, authenticated;
grant execute on function public.get_public_broadcasts() to service_role;
grant execute on function public.get_room_broadcast(text,uuid,integer) to service_role;
grant execute on function public.get_admin_broadcasts(uuid,integer) to service_role;
grant execute on function public.set_broadcast(uuid,integer,text,integer,text,jsonb,boolean,boolean) to service_role;
notify pgrst, 'reload schema';
commit;
