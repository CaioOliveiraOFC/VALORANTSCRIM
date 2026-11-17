-- Additive media permissions. Apply after 20261114_multiplatform_streams.sql.
-- Existing admins retain their eleven policies and start with media editing off.
-- Room state, events, streams and replay links are not rewritten.
begin;

-- Serialize the policy backfill with account edits. Readers stay available.
lock table public.scrim_admin_accounts in share row exclusive mode;

-- Preserve legitimate, not-yet-provisioned console accounts before the validator
-- changes from eleven to twelve keys. Do not reinterpret malformed metadata.
update auth.users as u
   set raw_app_meta_data = jsonb_set(u.raw_app_meta_data,
     '{scrim_console_permissions}',
     (u.raw_app_meta_data->'scrim_console_permissions') || '{"manageStreams":false}'::jsonb)
 where u.raw_app_meta_data->'scrim_console_managed' = 'true'::jsonb
   and not ((u.raw_app_meta_data->'scrim_console_permissions') ? 'manageStreams')
   and case when jsonb_typeof(u.raw_app_meta_data->'scrim_console_permissions') = 'object' then
     (select count(*) from jsonb_object_keys(u.raw_app_meta_data->'scrim_console_permissions')) = 11
     and not exists (
       select 1 from jsonb_each(u.raw_app_meta_data->'scrim_console_permissions') as item(key,value)
        where item.key not in ('createRooms','editRoom','manageTeams','manageVeto',
          'manageDraws','manageFocus','importMatches','correctStats','manageNotes',
          'publishRooms','deleteRooms') or jsonb_typeof(item.value) <> 'boolean'
     ) else false end;

create or replace function public.scrim_admin_preset_permissions(p_preset text)
returns jsonb language sql immutable set search_path = '' as $$
  select case when p_preset in ('organizer', 'full') then jsonb_build_object(
    'createRooms', true, 'editRoom', true, 'manageTeams', true,
    'manageVeto', true, 'manageDraws', true, 'manageFocus', true,
    'importMatches', true, 'correctStats', p_preset = 'full',
    'manageNotes', true, 'publishRooms', true, 'deleteRooms', p_preset = 'full',
    'manageStreams', p_preset = 'full'
  ) else null end;
$$;

create or replace function public.scrim_admin_valid_permissions(p_permissions jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_permissions) = 'object' then
    (select count(*) from jsonb_object_keys(p_permissions)) = 12
    and not exists (
      select 1 from jsonb_each(p_permissions) as item(key,value)
       where item.key not in ('createRooms','editRoom','manageTeams','manageVeto',
         'manageDraws','manageFocus','importMatches','correctStats','manageNotes',
         'publishRooms','deleteRooms','manageStreams') or jsonb_typeof(item.value) <> 'boolean'
    ) else false end;
$$;

-- The new capability is opt-in even for accounts previously marked "full".
-- A repeated run leaves grants, versions and sessions established later intact.
update public.scrim_admin_accounts
   set permissions = permissions || '{"manageStreams":false}'::jsonb,
       version = version + 1, updated_at = clock_timestamp()
 where not (permissions ? 'manageStreams');

create or replace function public.get_admin_broadcasts(p_actor_id uuid, p_actor_session_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_super boolean;
begin
  if p_actor_session_version is null or p_actor_session_version < 0 then raise exception 'INVALID_ADMIN_INPUT'; end if;
  v_super := public.scrim_admin_assert_actor(p_actor_id, '{}', p_actor_session_version);
  return (select coalesce(jsonb_agg(public.scrim_broadcast_dto(b) order by b.scope), '[]')
    from public.scrim_broadcasts b left join public.scrims s on s.id = b.room_id
    where (v_super or s.owner_user_id = p_actor_id) and (b.scope = 'home' or s.deleted_at is null));
end;
$$;

create or replace function public.list_stream_recordings(p_actor_id uuid,p_actor_session_version integer,p_admin boolean,p_offset integer,p_room_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_super boolean := false; v_total integer; v_rows jsonb;
begin
  if p_admin is null or p_offset is null or p_offset not between 0 and 100000 or (p_room_id is not null and p_room_id !~ '^[a-z0-9]{6,32}$') then raise exception 'INVALID_RECORDING'; end if;
  if p_admin then
    if p_actor_session_version is null or p_actor_session_version < 0 then raise exception 'INVALID_ADMIN_INPUT'; end if;
    v_super := public.scrim_admin_assert_actor(p_actor_id,'{}',p_actor_session_version);
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
  v_super := public.scrim_admin_assert_actor(p_actor_id, array['manageStreams'], p_actor_session_version);
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

create or replace function public.create_stream_recording(p_id uuid,p_actor_id uuid,p_actor_session_version integer,p_room_id text,p_title text,p_source jsonb,p_is_public boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_super boolean; s public.scrims%rowtype; r public.scrim_stream_recordings%rowtype;
begin
  if p_id is null or p_actor_session_version is null or p_actor_session_version < 0 or p_is_public is null or
     p_title is null or length(trim(p_title)) not between 1 and 100 or p_title ~ '[[:cntrl:]]' or
     p_source is null or (p_source->>'kind') is distinct from 'video' or not (p_source ? 'platform') or
     not public.scrim_valid_stream_sources(jsonb_build_array(p_source)) then raise exception 'INVALID_RECORDING'; end if;
  v_super := public.scrim_admin_assert_actor(p_actor_id,array['manageStreams'],p_actor_session_version);
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
  v_super := public.scrim_admin_assert_actor(p_actor_id,array['manageStreams'],p_actor_session_version);
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

create or replace function public.get_stream_capabilities()
returns jsonb language sql stable set search_path = '' as $$
  select '{"multiplatform":true,"recordings":true,"mediaPermissions":true}'::jsonb;
$$;

-- Preserve the server-only RPC boundary and private tables/RLS.
revoke execute on function public.get_admin_broadcasts(uuid,integer) from public,anon,authenticated;
revoke execute on function public.list_stream_recordings(uuid,integer,boolean,integer,text) from public,anon,authenticated;
revoke execute on function public.set_broadcast(uuid,integer,text,integer,text,jsonb,boolean,boolean) from public,anon,authenticated;
revoke execute on function public.create_stream_recording(uuid,uuid,integer,text,text,jsonb,boolean) from public,anon,authenticated;
revoke execute on function public.manage_stream_recording(uuid,uuid,integer,integer,boolean) from public,anon,authenticated;
revoke execute on function public.get_stream_capabilities() from public,anon,authenticated;
grant execute on function public.get_admin_broadcasts(uuid,integer) to service_role;
grant execute on function public.list_stream_recordings(uuid,integer,boolean,integer,text) to service_role;
grant execute on function public.set_broadcast(uuid,integer,text,integer,text,jsonb,boolean,boolean) to service_role;
grant execute on function public.create_stream_recording(uuid,uuid,integer,text,text,jsonb,boolean) to service_role;
grant execute on function public.manage_stream_recording(uuid,uuid,integer,integer,boolean) to service_role;
grant execute on function public.get_stream_capabilities() to service_role;

notify pgrst,'reload schema';
commit;
