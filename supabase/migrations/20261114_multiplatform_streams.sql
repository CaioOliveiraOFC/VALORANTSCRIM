-- Apply after 20261113_streams.sql. Existing Twitch configuration stays valid.
begin;

create or replace function public.scrim_valid_stream_sources(p_sources jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v jsonb; platform text; kind text; channel text; identity text; seen text[] := '{}';
begin
  if p_sources is null or jsonb_typeof(p_sources) <> 'array' then return false; end if;
  if jsonb_array_length(p_sources) > 6 then return false; end if;
  for v in select value from jsonb_array_elements(p_sources) loop
    if jsonb_typeof(v) <> 'object' then return false; end if;
    if exists(select 1 from jsonb_object_keys(v) k where k not in ('channel','label','platform','kind')) or
       jsonb_typeof(v->'channel') is distinct from 'string' or jsonb_typeof(v->'label') is distinct from 'string' or
       (v ? 'platform' and jsonb_typeof(v->'platform') is distinct from 'string') or
       (v ? 'kind' and (jsonb_typeof(v->'kind') is distinct from 'string' or v->>'kind' <> 'video')) then return false; end if;
    platform := coalesce(v->>'platform', 'twitch'); kind := coalesce(v->>'kind', 'live'); channel := v->>'channel';
    if length(trim(v->>'label')) not between 1 and 40 or (v->>'label') ~ '[[:cntrl:]]' then return false; end if;
    if platform = 'youtube' then
      if channel !~ '^[A-Za-z0-9_-]{11}$' then return false; end if;
    elsif platform = 'kick' then
      if kind = 'video' then
        if channel !~ '^[a-z0-9_][a-z0-9_-]{0,24}/videos/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
      elsif channel !~ '^[a-z0-9_][a-z0-9_-]{0,24}$' then return false; end if;
    elsif platform = 'twitch' then
      if kind = 'video' then
        if channel !~ '^[1-9][0-9]{0,19}$' then return false; end if;
      elsif channel !~ '^[a-z0-9_]{1,25}$' then return false; end if;
    else return false;
    end if;
    if kind = 'live' and platform <> 'youtube' and channel = any(array['videos','directory','downloads','settings','subscriptions','inventory','search','login','signup','embed','moderator','payments','wallet','turbo','jobs','p']) then return false; end if;
    identity := platform || ':' || case when platform = 'youtube' then 'video' else kind end || ':' || channel;
    if identity = any(seen) then return false; end if;
    seen := array_append(seen, identity);
  end loop;
  return true;
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
  if not public.scrim_valid_stream_sources(p_channels) then raise exception 'INVALID_BROADCAST'; end if;
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



create table if not exists public.scrim_stream_recordings (
  id uuid primary key,
  scope text not null,
  room_id text references public.scrims(id) on delete restrict,
  room_title text,
  title text not null check (length(trim(title)) between 1 and 100),
  source jsonb not null,
  is_public boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references auth.users(id),
  check ((scope = 'home' and room_id is null) or (room_id is not null and scope = 'room:' || room_id)),
  check ((source->>'kind') is not distinct from 'video' and source ? 'platform' and public.scrim_valid_stream_sources(jsonb_build_array(source)))
);
create unique index if not exists scrim_recording_video_per_scope on public.scrim_stream_recordings(scope, (source->>'platform'), (source->>'channel'));
create index if not exists scrim_recording_chronology on public.scrim_stream_recordings(created_at desc, id desc);
alter table public.scrim_stream_recordings enable row level security;
revoke all on public.scrim_stream_recordings from public, anon, authenticated, service_role;

create or replace function public.stream_recording_dto(r public.scrim_stream_recordings)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',r.id,'roomId',r.room_id,'roomTitle',coalesce((select s.state->>'title' from public.scrims s where s.id=r.room_id),r.room_title),
    'title',r.title,'source',r.source,'isPublic',r.is_public,'version',r.version,'createdAt',(extract(epoch from r.created_at)*1000)::bigint);
$$;

create or replace function public.get_stream_capabilities()
returns jsonb language sql stable set search_path = '' as $$ select '{"multiplatform":true,"recordings":true}'::jsonb; $$;

create or replace function public.list_stream_recordings(p_actor_id uuid,p_actor_session_version integer,p_admin boolean,p_offset integer,p_room_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_super boolean := false; v_total integer; v_rows jsonb;
begin
  if p_admin is null or p_offset is null or p_offset not between 0 and 100000 or (p_room_id is not null and p_room_id !~ '^[a-z0-9]{6,32}$') then raise exception 'INVALID_RECORDING'; end if;
  if p_admin then
    if p_actor_session_version is null or p_actor_session_version < 0 then raise exception 'INVALID_ADMIN_INPUT'; end if;
    v_super := public.scrim_admin_assert_actor(p_actor_id,array['editRoom'],p_actor_session_version);
  end if;
  with matching as (
    select r.* from public.scrim_stream_recordings r left join public.scrims s on s.id=r.room_id
      where (p_room_id is null or r.room_id=p_room_id) and
        ((p_admin and (v_super or s.owner_user_id=p_actor_id)) or
         (not p_admin and r.is_public and (r.scope='home' or (s.is_public and s.deleted_at is null))))
  ) select (select count(*)::integer from matching),
    coalesce((select jsonb_agg(public.stream_recording_dto(page::public.scrim_stream_recordings) order by page.created_at desc,page.id desc)
      from (select * from matching order by created_at desc,id desc offset p_offset limit 24) page),'[]'::jsonb)
    into v_total,v_rows;
  return jsonb_build_object('recordings',v_rows,'total',v_total,'nextOffset',case when p_offset+24<v_total then p_offset+24 else null end);
end;
$$;

create or replace function public.get_stream_recording(p_id uuid,p_actor_id uuid,p_actor_session_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.scrim_stream_recordings%rowtype; s public.scrims%rowtype; v_super boolean;
begin
  select * into r from public.scrim_stream_recordings where id=p_id;
  if not found then raise exception 'RECORDING_NOT_FOUND'; end if;
  if r.room_id is not null then select * into s from public.scrims where id=r.room_id; end if;
  if not (r.is_public and (r.scope='home' or (s.is_public and s.deleted_at is null))) then
    if p_actor_id is null or p_actor_session_version is null or p_actor_session_version < 0 then raise exception 'RECORDING_NOT_FOUND'; end if;
    v_super := public.scrim_admin_assert_actor(p_actor_id,'{}',p_actor_session_version);
    if not v_super and (r.room_id is null or s.owner_user_id is distinct from p_actor_id) then raise exception 'RECORDING_NOT_FOUND'; end if;
  end if;
  return public.stream_recording_dto(r);
end;
$$;

create or replace function public.create_stream_recording(p_id uuid,p_actor_id uuid,p_actor_session_version integer,p_room_id text,p_title text,p_source jsonb,p_is_public boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_super boolean; s public.scrims%rowtype; r public.scrim_stream_recordings%rowtype;
begin
  if p_id is null or p_actor_session_version is null or p_actor_session_version < 0 or p_is_public is null or
     p_title is null or length(trim(p_title)) not between 1 and 100 or p_title ~ '[[:cntrl:]]' or
     p_source is null or (p_source->>'kind') is distinct from 'video' or not (p_source ? 'platform') or
     not public.scrim_valid_stream_sources(jsonb_build_array(p_source)) then raise exception 'INVALID_RECORDING'; end if;
  v_super := public.scrim_admin_assert_actor(p_actor_id,array['editRoom'],p_actor_session_version);
  if p_room_id is null then
    if not v_super then raise exception 'ADMIN_FORBIDDEN'; end if;
  else
    select * into s from public.scrims where id=p_room_id for update;
    if not found or s.deleted_at is not null then raise exception 'SCRIM_DELETED'; end if;
    if not v_super and s.owner_user_id<>p_actor_id then raise exception 'ADMIN_FORBIDDEN'; end if;
    if p_is_public then
      perform public.scrim_admin_assert_actor(p_actor_id,array['publishRooms'],p_actor_session_version);
      if not s.is_public then raise exception 'ROOM_NOT_PUBLIC'; end if;
    end if;
  end if;
  insert into public.scrim_stream_recordings(id,scope,room_id,room_title,title,source,is_public,created_by)
    values(p_id,case when p_room_id is null then 'home' else 'room:'||p_room_id end,p_room_id,s.state->>'title',trim(p_title),p_source,p_is_public,p_actor_id)
    on conflict do nothing returning * into r;
  if not found then raise exception 'DUPLICATE_RECORDING'; end if;
  perform public.scrim_admin_write_audit(p_actor_id,'recording.create',null,p_room_id,null,public.stream_recording_dto(r));
  return public.stream_recording_dto(r);
end;
$$;

create or replace function public.manage_stream_recording(p_id uuid,p_actor_id uuid,p_actor_session_version integer,p_expected_version integer,p_is_public boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_super boolean; before_row public.scrim_stream_recordings%rowtype; after_row public.scrim_stream_recordings%rowtype; s public.scrims%rowtype;
begin
  if p_actor_session_version is null or p_actor_session_version<0 or p_expected_version is null or p_expected_version<1 or p_is_public is null then raise exception 'INVALID_RECORDING'; end if;
  v_super := public.scrim_admin_assert_actor(p_actor_id,array['editRoom'],p_actor_session_version);
  select * into before_row from public.scrim_stream_recordings where id=p_id;
  if not found then raise exception 'RECORDING_NOT_FOUND'; end if;
  if before_row.room_id is null then
    if not v_super then raise exception 'ADMIN_FORBIDDEN'; end if;
  else
    select * into s from public.scrims where id=before_row.room_id for update;
    if not v_super and s.owner_user_id<>p_actor_id then raise exception 'ADMIN_FORBIDDEN'; end if;
    if p_is_public then
      perform public.scrim_admin_assert_actor(p_actor_id,array['publishRooms'],p_actor_session_version);
      if s.deleted_at is not null or not s.is_public then raise exception 'ROOM_NOT_PUBLIC'; end if;
    end if;
  end if;
  select * into before_row from public.scrim_stream_recordings where id=p_id for update;
  if not found then raise exception 'RECORDING_NOT_FOUND'; end if;
  if before_row.version<>p_expected_version then raise exception 'STALE_RECORDING'; end if;
  update public.scrim_stream_recordings set is_public=p_is_public,version=version+1,updated_at=clock_timestamp() where id=p_id returning * into after_row;
  perform public.scrim_admin_write_audit(p_actor_id,'recording.visibility',null,before_row.room_id,public.stream_recording_dto(before_row),public.stream_recording_dto(after_row));
  return public.stream_recording_dto(after_row);
end;
$$;

revoke execute on function public.scrim_valid_stream_sources(jsonb) from public,anon,authenticated,service_role;
revoke execute on function public.stream_recording_dto(public.scrim_stream_recordings) from public,anon,authenticated,service_role;
revoke execute on function public.get_stream_capabilities() from public,anon,authenticated;
revoke execute on function public.list_stream_recordings(uuid,integer,boolean,integer,text) from public,anon,authenticated;
revoke execute on function public.get_stream_recording(uuid,uuid,integer) from public,anon,authenticated;
revoke execute on function public.create_stream_recording(uuid,uuid,integer,text,text,jsonb,boolean) from public,anon,authenticated;
revoke execute on function public.manage_stream_recording(uuid,uuid,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.get_stream_capabilities() to service_role;
grant execute on function public.list_stream_recordings(uuid,integer,boolean,integer,text) to service_role;
grant execute on function public.get_stream_recording(uuid,uuid,integer) to service_role;
grant execute on function public.create_stream_recording(uuid,uuid,integer,text,text,jsonb,boolean) to service_role;
grant execute on function public.manage_stream_recording(uuid,uuid,integer,integer,boolean) to service_role;
notify pgrst,'reload schema';
commit;
