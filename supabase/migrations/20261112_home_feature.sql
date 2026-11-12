-- Optional VCT home pin. Automatic home selection works before this upgrade.
-- Apply after 20261105_super_admin.sql. Existing rooms and events are untouched.
begin;

alter table public.scrim_admin_settings
  add column if not exists home_feature_scrim_id text references public.scrims(id) on delete set null,
  add column if not exists home_feature_version integer not null default 1 check (home_feature_version > 0);

create or replace function public.get_public_home_feature()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('roomId', (
    select s.id from public.scrim_admin_settings cfg
    join public.scrims s on s.id = cfg.home_feature_scrim_id
    where cfg.singleton and s.is_public and s.deleted_at is null
  ));
$$;

create or replace function public.get_home_feature_admin(p_actor_id uuid, p_actor_session_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_actor_session_version is null or p_actor_session_version < 0 then raise exception 'INVALID_ADMIN_INPUT'; end if;
  if not public.scrim_admin_assert_actor(p_actor_id, '{}', p_actor_session_version) then raise exception 'ADMIN_FORBIDDEN'; end if;
  return (select jsonb_build_object('roomId', home_feature_scrim_id, 'version', home_feature_version)
    from public.scrim_admin_settings where singleton);
end;
$$;

create or replace function public.set_home_feature(
  p_actor_id uuid, p_actor_session_version integer, p_expected_version integer, p_scrim_id text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_before jsonb; v_after jsonb; v_id text;
begin
  if p_actor_session_version is null or p_actor_session_version < 0 or
     p_expected_version is null or p_expected_version < 1 or
     (p_scrim_id is not null and p_scrim_id !~ '^[a-z0-9]{6,32}$') then
    raise exception 'INVALID_ADMIN_INPUT';
  end if;
  if not public.scrim_admin_assert_actor(p_actor_id, '{}', p_actor_session_version) then raise exception 'ADMIN_FORBIDDEN'; end if;
  -- Account -> room -> settings. A hide/delete racing this transaction must
  -- serialize on the room; public reads always recheck current visibility.
  if p_scrim_id is not null then
    select id into v_id from public.scrims
    where id = p_scrim_id and is_public and deleted_at is null for share;
    if not found then raise exception 'ROOM_NOT_PUBLIC'; end if;
  end if;
  select jsonb_build_object('roomId', home_feature_scrim_id, 'version', home_feature_version)
    into v_before from public.scrim_admin_settings where singleton for update;
  update public.scrim_admin_settings
    set home_feature_scrim_id = p_scrim_id, home_feature_version = home_feature_version + 1
    where singleton and home_feature_version = p_expected_version
    returning jsonb_build_object('roomId', home_feature_scrim_id, 'version', home_feature_version) into v_after;
  if not found then raise exception 'STALE_HOME_FEATURE'; end if;
  perform public.scrim_admin_write_audit(p_actor_id, 'home.feature', null, p_scrim_id, v_before, v_after);
  return v_after;
end;
$$;

revoke execute on function public.get_public_home_feature() from public, anon, authenticated;
revoke execute on function public.get_home_feature_admin(uuid,integer) from public, anon, authenticated;
revoke execute on function public.set_home_feature(uuid,integer,integer,text) from public, anon, authenticated;
grant execute on function public.get_public_home_feature() to service_role;
grant execute on function public.get_home_feature_admin(uuid,integer) to service_role;
grant execute on function public.set_home_feature(uuid,integer,integer,text) to service_role;

notify pgrst, 'reload schema';
commit;
