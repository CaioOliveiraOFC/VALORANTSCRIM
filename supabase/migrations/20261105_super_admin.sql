-- One-time upgrade: app-owned administrator policies and room ownership.
-- Apply after 20261104_room_access.sql. Run the whole file in SQL Editor.
-- No password, bearer token or service key is stored by this migration.
begin;

create or replace function public.scrim_admin_preset_permissions(p_preset text)
returns jsonb language sql immutable set search_path = '' as $$
  select case when p_preset in ('organizer', 'full') then jsonb_build_object(
    'createRooms', true, 'editRoom', true, 'manageTeams', true,
    'manageVeto', true, 'manageDraws', true, 'manageFocus', true,
    'importMatches', true, 'correctStats', p_preset = 'full',
    'manageNotes', true, 'publishRooms', true, 'deleteRooms', p_preset = 'full'
  ) else null end;
$$;

create or replace function public.scrim_admin_valid_permissions(p_permissions jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_permissions) = 'object' then
    (select count(*) from jsonb_object_keys(p_permissions)) = 11
    and not exists (
      select 1 from jsonb_each(p_permissions) as item(key, value)
       where item.key not in ('createRooms','editRoom','manageTeams','manageVeto',
         'manageDraws','manageFocus','importMatches','correctStats','manageNotes',
         'publishRooms','deleteRooms') or jsonb_typeof(item.value) <> 'boolean'
    ) else false end;
$$;

create table if not exists public.scrim_admin_settings (
  singleton boolean primary key default true check (singleton),
  owner_user_id uuid not null references auth.users(id) on delete restrict
);
create table if not exists public.scrim_admin_accounts (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (length(trim(display_name)) between 1 and 80),
  active boolean not null default true,
  preset text not null check (preset in ('organizer','full')),
  permissions jsonb not null check (public.scrim_admin_valid_permissions(permissions)),
  version integer not null default 1 check (version > 0),
  session_version integer not null default 0 check (session_version >= 0),
  password_reset_pending boolean not null default false,
  password_reset_fingerprint text check (password_reset_fingerprint ~ '^[a-f0-9]{64}$'),
  password_reset_audit_id bigint,
  last_password_reset_audit_id bigint,
  password_reset_attempt integer not null default 0 check (password_reset_attempt >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid
);
create table if not exists public.scrim_admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  action text not null check (length(action) between 1 and 80),
  target_user_id uuid,
  scrim_id text,
  previous jsonb,
  next jsonb,
  status text not null default 'success' check (status in ('success','pending','failure')),
  error_code text check (error_code is null or error_code in ('auth_rejected','auth_unavailable','unknown')),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);
-- Keep a partially installed Preview upgrade safe when the whole file is reapplied.
alter table public.scrim_admin_accounts
  add column if not exists password_reset_pending boolean not null default false,
  add column if not exists password_reset_fingerprint text check (password_reset_fingerprint ~ '^[a-f0-9]{64}$'),
  add column if not exists password_reset_audit_id bigint,
  add column if not exists last_password_reset_audit_id bigint,
  add column if not exists password_reset_attempt integer not null default 0 check (password_reset_attempt >= 0);
create index if not exists scrim_admin_accounts_order on public.scrim_admin_accounts(created_at,user_id);
create index if not exists scrim_admin_audit_actor on public.scrim_admin_audit(actor_id,created_at desc);

alter table public.scrim_admin_settings enable row level security;
alter table public.scrim_admin_accounts enable row level security;
alter table public.scrim_admin_audit enable row level security;
revoke all on public.scrim_admin_settings, public.scrim_admin_accounts, public.scrim_admin_audit from public, anon, authenticated, service_role;
grant select on public.scrim_admin_settings, public.scrim_admin_accounts, public.scrim_admin_audit to service_role;
revoke all on sequence public.scrim_admin_audit_id_seq from public, anon, authenticated, service_role;

-- Pin the current confirmed owner once. Reapplying never changes that identity.
do $bootstrap$
declare v_owner uuid; v_found uuid; v_count integer;
begin
  select owner_user_id into v_owner from public.scrim_admin_settings where singleton;
  if v_owner is null then
    select count(*), min(id::text)::uuid into v_count, v_found from auth.users
     where lower(email) = 'caio.oliveira2014@hotmail.com' and email_confirmed_at is not null;
    if v_count <> 1 then
      raise exception 'CONFIRMED_SUPER_ADMIN_REQUIRED: confirme a conta caio.oliveira2014@hotmail.com no Supabase Auth antes de aplicar esta atualização.';
    end if;
    insert into public.scrim_admin_settings(singleton, owner_user_id) values (true, v_found);
    v_owner := v_found;
    -- Legacy metadata is imported only when the owner is first pinned. Later
    -- migration reapplication must not turn new legacy flags into live access.
    insert into public.scrim_admin_accounts(user_id,display_name,active,preset,permissions,updated_by)
    select u.id,
           case when u.id = v_owner then 'Caio' else
             left(coalesce(nullif(trim(u.raw_user_meta_data->>'name'),''), split_part(u.email,'@',1), 'Administrador'),80) end,
           u.id = v_owner or u.raw_app_meta_data->'scrim_admin' = 'true'::jsonb,
           'full',
           public.scrim_admin_preset_permissions('full') || jsonb_build_object('deleteRooms',
             u.id = v_owner or coalesce(u.raw_app_meta_data->'scrim_delete_rooms' = 'true'::jsonb,false)),
           v_owner
      from auth.users u
     where u.id = v_owner or jsonb_typeof(u.raw_app_meta_data->'scrim_admin') = 'boolean'
    on conflict (user_id) do nothing;
  end if;
end;
$bootstrap$;

create or replace function public.scrim_admin_owner_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select owner_user_id from public.scrim_admin_settings where singleton;
$$;

alter table public.scrims
  add column if not exists owner_user_id uuid,
  add column if not exists created_by_user_id uuid;
update public.scrims set owner_user_id = public.scrim_admin_owner_id() where owner_user_id is null;
alter table public.scrims alter column owner_user_id set not null;
-- Old create/import RPCs remain safe during rollout; new calls pass the creator.
alter table public.scrims alter column owner_user_id set default public.scrim_admin_owner_id();
do $constraints$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.scrims'::regclass and conname='scrims_owner_user_id_fkey') then
    alter table public.scrims add constraint scrims_owner_user_id_fkey foreign key(owner_user_id) references public.scrim_admin_accounts(user_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.scrims'::regclass and conname='scrims_created_by_user_id_fkey') then
    alter table public.scrims add constraint scrims_created_by_user_id_fkey foreign key(created_by_user_id) references public.scrim_admin_accounts(user_id) on delete restrict;
  end if;
end; $constraints$;
create index if not exists scrims_owner_listing on public.scrims(owner_user_id,created_at desc);

-- All authorization helpers are server-only; the public event RLS is unchanged.
create or replace function public.scrim_admin_assert_actor(p_actor_id uuid, p_permissions text[] default '{}', p_actor_session_version integer default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_account public.scrim_admin_accounts%rowtype; v_super boolean; v_permission text;
begin
  if p_actor_id is null or p_permissions is null then raise exception 'INVALID_ADMIN_INPUT'; end if;
  select * into v_account from public.scrim_admin_accounts where user_id=p_actor_id for share;
  if not found or not v_account.active or v_account.password_reset_pending then raise exception 'ADMIN_FORBIDDEN'; end if;
  if p_actor_session_version is not null and v_account.session_version<>p_actor_session_version then
    raise exception 'ADMIN_FORBIDDEN';
  end if;
  v_super := p_actor_id = public.scrim_admin_owner_id();
  foreach v_permission in array p_permissions loop
    if v_permission is null or not (public.scrim_admin_preset_permissions('full') ? v_permission) then
      raise exception 'INVALID_ADMIN_INPUT';
    end if;
    if not v_super and v_account.permissions->v_permission is distinct from 'true'::jsonb then
      raise exception 'ADMIN_FORBIDDEN';
    end if;
  end loop;
  return v_super;
end;
$$;

create or replace function public.scrim_admin_assert_super(p_actor_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.scrim_admin_assert_actor(p_actor_id) then raise exception 'ADMIN_FORBIDDEN'; end if;
end;
$$;

create or replace function public.scrim_admin_account_dto(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id',u.id,'email',u.email,'displayName',coalesce(a.display_name,
      nullif(left(trim(u.raw_app_meta_data->>'scrim_console_display_name'),80),''),split_part(u.email,'@',1)),
    'active',coalesce(a.active,false),'preset',coalesce(a.preset,
      case when u.raw_app_meta_data->>'scrim_console_preset'='full' then 'full' else 'organizer' end),
    'permissions',coalesce(a.permissions,
      case when public.scrim_admin_valid_permissions(u.raw_app_meta_data->'scrim_console_permissions') then
        u.raw_app_meta_data->'scrim_console_permissions' else public.scrim_admin_preset_permissions('organizer') end),
    'version',coalesce(a.version,0),'isSuperAdmin',u.id=public.scrim_admin_owner_id(),
    'provisioned',a.user_id is not null,'passwordResetPending',coalesce(a.password_reset_pending,false),
    'createdAt',floor(extract(epoch from coalesce(a.created_at,u.created_at))*1000)::bigint,
    'updatedAt',floor(extract(epoch from coalesce(a.updated_at,u.created_at))*1000)::bigint
  ) from auth.users u left join public.scrim_admin_accounts a on a.user_id=u.id
  where u.id=p_user_id and (a.user_id is not null or u.raw_app_meta_data->'scrim_console_managed'='true'::jsonb);
$$;

create or replace function public.get_admin_access(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('user_id',a.user_id,'active',a.active,
    'is_super_admin',a.user_id=public.scrim_admin_owner_id(),
    'permissions',case when a.user_id=public.scrim_admin_owner_id() then public.scrim_admin_preset_permissions('full') else a.permissions end,
    'version',a.version,'session_version',a.session_version,'password_reset_pending',a.password_reset_pending)
  from public.scrim_admin_accounts a where a.user_id=p_user_id;
$$;

-- Read before password authentication, then compare with freshly verified access.
-- This preflight remains private and never gives callers a browser-visible policy.
create or replace function public.get_admin_login_policy(p_email text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.get_admin_access(a.user_id)
    from auth.users u join public.scrim_admin_accounts a on a.user_id=u.id
   where lower(u.email)=lower(trim(p_email))
   limit 1;
$$;

create or replace function public.get_admin_account(p_actor_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.scrim_admin_assert_super(p_actor_id);
  return public.scrim_admin_account_dto(p_user_id);
end;
$$;

create or replace function public.list_admin_accounts(
  p_actor_id uuid,p_offset integer default 0,p_limit integer default 25,
  p_query text default '',p_status text default 'all'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_rows jsonb; v_total integer;
begin
  perform public.scrim_admin_assert_super(p_actor_id);
  if p_offset is null or p_offset<0 or p_limit is null or p_limit<1 or p_limit>100
     or p_query is null or length(p_query)>100 or p_status is null
     or p_status not in ('all','active','suspended','pending') then raise exception 'INVALID_ADMIN_INPUT'; end if;
  with accounts as (
    select public.scrim_admin_account_dto(u.id) as value from auth.users u
    left join public.scrim_admin_accounts a on a.user_id=u.id
    where a.user_id is not null or u.raw_app_meta_data->'scrim_console_managed'='true'::jsonb
  ), matching as (
    select value from accounts where
      (p_query='' or position(lower(p_query) in lower(value->>'email'))>0 or position(lower(p_query) in lower(value->>'displayName'))>0)
      and (p_status='all'
        or (p_status='active' and value->'active'='true'::jsonb)
        or (p_status='suspended' and value->'provisioned'='true'::jsonb and value->'active'='false'::jsonb)
        or (p_status='pending' and value->'provisioned'='false'::jsonb))
  ) select (select count(*)::integer from matching),
           coalesce((select jsonb_agg(page.value order by (page.value->>'createdAt')::bigint,page.value->>'id')
             from (select value from matching order by (value->>'createdAt')::bigint,value->>'id' offset p_offset limit p_limit) page),'[]'::jsonb)
    into v_total,v_rows;
  return jsonb_build_object('accounts',v_rows,'total',v_total,
    'nextOffset',case when p_offset+jsonb_array_length(v_rows)<v_total then p_offset+jsonb_array_length(v_rows) else null end);
end;
$$;

create or replace function public.scrim_admin_write_audit(
  p_actor_id uuid,p_action text,p_target_user_id uuid,p_scrim_id text,
  p_previous jsonb,p_next jsonb,p_status text default 'success'
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  insert into public.scrim_admin_audit(actor_id,action,target_user_id,scrim_id,previous,next,status,completed_at)
  values(p_actor_id,p_action,p_target_user_id,p_scrim_id,p_previous,p_next,p_status,
    case when p_status='pending' then null else clock_timestamp() end) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.register_admin_account(
  p_actor_id uuid,p_user_id uuid,p_display_name text,p_preset text,p_permissions jsonb,p_active boolean default true
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_dto jsonb;
begin
  perform public.scrim_admin_assert_super(p_actor_id);
  if p_user_id=public.scrim_admin_owner_id() then raise exception 'OWNER_PROTECTED'; end if;
  if p_user_id is null or p_active is null or p_display_name is null or length(trim(p_display_name)) not between 1 and 80
     or p_preset is null or p_preset not in ('organizer','full')
     or not public.scrim_admin_valid_permissions(p_permissions) then raise exception 'INVALID_ADMIN_INPUT'; end if;
  if not exists(select 1 from auth.users where id=p_user_id and raw_app_meta_data->'scrim_console_managed'='true'::jsonb) then
    raise exception 'ADMIN_NOT_FOUND';
  end if;
  insert into public.scrim_admin_accounts(user_id,display_name,active,preset,permissions,updated_by)
  values(p_user_id,trim(p_display_name),p_active,p_preset,p_permissions,p_actor_id)
  on conflict(user_id) do nothing;
  if not found then raise exception 'STALE_ADMIN_VERSION'; end if;
  v_dto := public.scrim_admin_account_dto(p_user_id);
  perform public.scrim_admin_write_audit(p_actor_id,'account.create',p_user_id,null,null,v_dto);
  return v_dto;
end;
$$;

create or replace function public.update_admin_account(
  p_actor_id uuid,p_user_id uuid,p_expected_version integer,p_display_name text,p_preset text,p_permissions jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_before jsonb; v_after jsonb;
begin
  perform public.scrim_admin_assert_super(p_actor_id);
  if p_user_id=public.scrim_admin_owner_id() then raise exception 'OWNER_PROTECTED'; end if;
  if p_expected_version is null or p_expected_version<0 or p_display_name is null or length(trim(p_display_name)) not between 1 and 80
     or p_preset is null or p_preset not in ('organizer','full')
     or not public.scrim_admin_valid_permissions(p_permissions) then raise exception 'INVALID_ADMIN_INPUT'; end if;
  if p_expected_version=0 then
    return public.register_admin_account(p_actor_id,p_user_id,p_display_name,p_preset,p_permissions,true);
  end if;
  select public.scrim_admin_account_dto(user_id) into v_before from public.scrim_admin_accounts where user_id=p_user_id for update;
  if not found then raise exception 'ADMIN_NOT_FOUND'; end if;
  update public.scrim_admin_accounts set display_name=trim(p_display_name),preset=p_preset,permissions=p_permissions,
    version=version+1,updated_at=clock_timestamp(),updated_by=p_actor_id
   where user_id=p_user_id and version=p_expected_version;
  if not found then raise exception 'STALE_ADMIN_VERSION'; end if;
  v_after := public.scrim_admin_account_dto(p_user_id);
  perform public.scrim_admin_write_audit(p_actor_id,'account.permissions',p_user_id,null,v_before,v_after);
  return v_after;
end;
$$;

create or replace function public.set_admin_account_active(
  p_actor_id uuid,p_user_id uuid,p_expected_version integer,p_active boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_before jsonb; v_after jsonb;
begin
  perform public.scrim_admin_assert_super(p_actor_id);
  if p_user_id=public.scrim_admin_owner_id() then raise exception 'OWNER_PROTECTED'; end if;
  if p_expected_version is null or p_expected_version<1 or p_active is null then raise exception 'INVALID_ADMIN_INPUT'; end if;
  select public.scrim_admin_account_dto(user_id) into v_before from public.scrim_admin_accounts where user_id=p_user_id for update;
  if not found then raise exception 'ADMIN_NOT_FOUND'; end if;
  update public.scrim_admin_accounts set active=p_active,
    session_version=session_version+case when active and not p_active then 1 else 0 end,
    version=version+1,updated_at=clock_timestamp(),updated_by=p_actor_id
   where user_id=p_user_id and version=p_expected_version;
  if not found then raise exception 'STALE_ADMIN_VERSION'; end if;
  v_after := public.scrim_admin_account_dto(p_user_id);
  perform public.scrim_admin_write_audit(p_actor_id,case when p_active then 'account.reactivate' else 'account.suspend' end,p_user_id,null,v_before,v_after);
  return v_after;
end;
$$;

-- Remove the earlier Preview signature: every reset must supply a private HMAC
-- fingerprint so an uncertain provider response can only retry the same value.
drop function if exists public.begin_admin_password_reset(uuid,uuid,integer);
create or replace function public.begin_admin_password_reset(
  p_actor_id uuid,p_user_id uuid,p_expected_version integer,p_password_fingerprint text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_before jsonb; v_after jsonb; v_id bigint; v_attempt integer;
  v_account public.scrim_admin_accounts%rowtype; v_audit public.scrim_admin_audit%rowtype;
begin
  perform public.scrim_admin_assert_super(p_actor_id);
  if p_user_id=public.scrim_admin_owner_id() then raise exception 'OWNER_PROTECTED'; end if;
  if p_expected_version is null or p_expected_version<1 or p_password_fingerprint is null
     or p_password_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_ADMIN_INPUT'; end if;
  select * into v_account from public.scrim_admin_accounts where user_id=p_user_id for update;
  if not found then raise exception 'ADMIN_NOT_FOUND'; end if;
  if v_account.version<>p_expected_version then raise exception 'STALE_ADMIN_VERSION'; end if;
  if v_account.password_reset_pending then
    select * into v_audit from public.scrim_admin_audit
     where id=v_account.password_reset_audit_id and actor_id=p_actor_id
       and target_user_id=p_user_id and action='account.password_reset' for update;
    if not found or v_audit.status<>'pending'
       or v_audit.error_code is null or v_audit.error_code not in ('auth_unavailable','unknown')
       or v_account.password_reset_fingerprint is distinct from p_password_fingerprint then
      raise exception 'RESET_IN_PROGRESS';
    end if;
    -- Claim the explicit retry under the same account/audit locks. An outstanding
    -- native call (NULL error_code) never admits another password write.
    update public.scrim_admin_accounts set password_reset_attempt=password_reset_attempt+1
     where user_id=p_user_id returning password_reset_attempt into v_attempt;
    update public.scrim_admin_audit set error_code=null where id=v_audit.id;
    return jsonb_build_object('account',public.scrim_admin_account_dto(p_user_id),'auditId',v_audit.id,'attemptVersion',v_attempt);
  end if;
  v_before := public.scrim_admin_account_dto(p_user_id);
  update public.scrim_admin_accounts set session_version=session_version+1,version=version+1,
    password_reset_pending=true,password_reset_fingerprint=p_password_fingerprint,password_reset_attempt=1,
    updated_at=clock_timestamp(),updated_by=p_actor_id where user_id=p_user_id and version=p_expected_version;
  if not found then raise exception 'STALE_ADMIN_VERSION'; end if;
  v_after := public.scrim_admin_account_dto(p_user_id);
  v_id := public.scrim_admin_write_audit(p_actor_id,'account.password_reset',p_user_id,null,v_before,v_after,'pending');
  update public.scrim_admin_accounts set password_reset_audit_id=v_id,last_password_reset_audit_id=v_id where user_id=p_user_id;
  return jsonb_build_object('account',v_after,'auditId',v_id,'attemptVersion',1);
end;
$$;

-- Old receipts cannot finish a later retry under the same audit ID.
drop function if exists public.finish_admin_password_reset(uuid,bigint,boolean,text);
create or replace function public.finish_admin_password_reset(
  p_actor_id uuid,p_audit_id bigint,p_succeeded boolean,p_error_code text,p_attempt_version integer
) returns void language plpgsql security definer set search_path = '' as $$
declare v_target uuid; v_account public.scrim_admin_accounts%rowtype; v_audit public.scrim_admin_audit%rowtype;
begin
  perform public.scrim_admin_assert_super(p_actor_id);
  if p_audit_id is null or p_succeeded is null or p_attempt_version is null or p_attempt_version<1 or
    (p_succeeded and p_error_code is not null) or
    (not p_succeeded and (p_error_code is null or p_error_code not in ('auth_rejected','auth_unavailable','unknown'))) then
    raise exception 'INVALID_ADMIN_INPUT';
  end if;
  select target_user_id into v_target from public.scrim_admin_audit
   where id=p_audit_id and actor_id=p_actor_id and action='account.password_reset';
  if not found then raise exception 'STALE_ADMIN_VERSION'; end if;
  -- Match begin's account-then-audit lock order, including uncertain retries.
  select * into v_account from public.scrim_admin_accounts where user_id=v_target for update;
  if not found then raise exception 'ADMIN_NOT_FOUND'; end if;
  select * into v_audit from public.scrim_admin_audit
   where id=p_audit_id and actor_id=p_actor_id and action='account.password_reset' for update;
  if not found then raise exception 'STALE_ADMIN_VERSION'; end if;
  if v_account.last_password_reset_audit_id is distinct from p_audit_id then
    raise exception 'STALE_ADMIN_VERSION';
  end if;
  if v_account.password_reset_attempt<>p_attempt_version then
    raise exception 'STALE_ADMIN_VERSION';
  end if;
  -- A delayed duplicate cannot downgrade a finished reset or clear a newer one.
  if v_audit.status in ('success','failure') then return; end if;
  if not v_account.password_reset_pending or v_account.password_reset_audit_id is distinct from p_audit_id
     or v_account.password_reset_attempt<>p_attempt_version then
    raise exception 'STALE_ADMIN_VERSION';
  end if;
  if not p_succeeded and p_error_code in ('auth_unavailable','unknown') then
    update public.scrim_admin_audit set error_code=p_error_code where id=p_audit_id;
    return;
  end if;
  update public.scrim_admin_accounts set password_reset_pending=false,
    password_reset_fingerprint=null,password_reset_audit_id=null,
    updated_at=clock_timestamp(),updated_by=p_actor_id where user_id=v_target;
  update public.scrim_admin_audit set status=case when p_succeeded then 'success' else 'failure' end,
    error_code=p_error_code,completed_at=clock_timestamp() where id=p_audit_id;
end;
$$;

create or replace function public.scrim_admin_lock_room(
  p_id text,p_actor_id uuid,p_actor_session_version integer,p_permissions text[],p_expected_access_version integer,p_allow_deleted boolean default false
) returns public.scrims language plpgsql security definer set search_path = '' as $$
declare v_super boolean; v_room public.scrims%rowtype;
begin
  if p_actor_session_version is null or p_actor_session_version<0 then raise exception 'INVALID_ADMIN_INPUT'; end if;
  v_super := public.scrim_admin_assert_actor(p_actor_id,p_permissions,p_actor_session_version);
  if p_expected_access_version is null or p_expected_access_version<1 then raise exception 'INVALID_ADMIN_INPUT'; end if;
  select * into v_room from public.scrims where id=p_id for update;
  if not found then raise exception 'SCRIM_DELETED'; end if;
  if not v_super and v_room.owner_user_id<>p_actor_id then raise exception 'ADMIN_FORBIDDEN'; end if;
  if v_room.deleted_at is not null and not p_allow_deleted then raise exception 'SCRIM_DELETED'; end if;
  if v_room.access_version<>p_expected_access_version then raise exception 'STALE_OR_FORBIDDEN'; end if;
  return v_room;
end;
$$;

create or replace function public.create_owned_scrim(
  p_id text,p_key_hash text,p_actor_id uuid,p_actor_session_version integer,p_state jsonb,p_event jsonb,p_at bigint,p_is_public boolean
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_actor_session_version is null or p_actor_session_version<0 then raise exception 'INVALID_ADMIN_INPUT'; end if;
  perform public.scrim_admin_assert_actor(p_actor_id,array['createRooms'],p_actor_session_version);
  if p_is_public then perform public.scrim_admin_assert_actor(p_actor_id,array['publishRooms'],p_actor_session_version); end if;
  perform public.create_scrim_with_access(p_id,p_key_hash,p_state,p_event,p_at,p_is_public);
  update public.scrims set owner_user_id=p_actor_id,created_by_user_id=p_actor_id where id=p_id;
  perform public.scrim_admin_write_audit(p_actor_id,'room.create',null,p_id,null,
    jsonb_build_object('ownerId',p_actor_id,'isPublic',p_is_public));
end;
$$;

create or replace function public.append_owned_scrim_event(
  p_id text,p_actor_id uuid,p_actor_session_version integer,p_expected_version integer,p_expected_access_version integer,
  p_state jsonb,p_event jsonb,p_required_permissions text[]
) returns void language plpgsql security definer set search_path = '' as $$
declare v_room public.scrims%rowtype;
begin
  if p_required_permissions is null or cardinality(p_required_permissions)=0 then raise exception 'INVALID_ADMIN_INPUT'; end if;
  v_room := public.scrim_admin_lock_room(p_id,p_actor_id,p_actor_session_version,p_required_permissions,p_expected_access_version);
  perform public.append_scrim_event(p_id,v_room.admin_key_hash,p_expected_version,p_state,p_event);
end;
$$;

create or replace function public.import_owned_match(
  p_id text,p_actor_id uuid,p_actor_session_version integer,p_expected_version integer,p_expected_access_version integer,
  p_state jsonb,p_event jsonb,p_raw jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare v_room public.scrims%rowtype;
begin
  v_room := public.scrim_admin_lock_room(p_id,p_actor_id,p_actor_session_version,array['importMatches'],p_expected_access_version);
  perform public.import_match_result(p_id,v_room.admin_key_hash,p_expected_version,p_state,p_event,p_raw);
end;
$$;

create or replace function public.manage_owned_scrim_access(
  p_id text,p_actor_id uuid,p_actor_session_version integer,p_expected_access_version integer,p_action text,p_at bigint
) returns table(is_public boolean,deleted_at bigint,access_version integer,owner_user_id uuid)
language plpgsql security definer set search_path = '' as $$
declare v_room public.scrims%rowtype; v_permission text; v_after jsonb;
begin
  if p_action is null or p_action not in ('show','hide','delete','restore') then raise exception 'INVALID_ADMIN_INPUT'; end if;
  v_permission := case when p_action in ('show','hide') then 'publishRooms' else 'deleteRooms' end;
  v_room := public.scrim_admin_lock_room(p_id,p_actor_id,p_actor_session_version,array[v_permission],p_expected_access_version,p_action='restore');
  perform public.manage_scrim_access(p_id,p_expected_access_version,p_action,p_at,p_actor_id);
  select jsonb_build_object('isPublic',s.is_public,'deletedAt',s.deleted_at,'accessVersion',s.access_version,'ownerId',s.owner_user_id)
    into v_after from public.scrims s where s.id=p_id;
  perform public.scrim_admin_write_audit(p_actor_id,'room.'||p_action,null,p_id,
    jsonb_build_object('isPublic',v_room.is_public,'deletedAt',v_room.deleted_at,'accessVersion',v_room.access_version,'ownerId',v_room.owner_user_id),v_after);
  return query select s.is_public,s.deleted_at,s.access_version,s.owner_user_id from public.scrims s where s.id=p_id;
end;
$$;

create or replace function public.transfer_scrim_owner(
  p_id text,p_actor_id uuid,p_actor_session_version integer,p_expected_access_version integer,p_owner_id uuid
) returns table(is_public boolean,deleted_at bigint,access_version integer,owner_user_id uuid)
language plpgsql security definer set search_path = '' as $$
declare v_room public.scrims%rowtype; v_target public.scrim_admin_accounts%rowtype;
begin
  perform public.scrim_admin_assert_super(p_actor_id);
  select * into v_target from public.scrim_admin_accounts where user_id=p_owner_id for share;
  if not found or not v_target.active then raise exception 'ADMIN_NOT_FOUND'; end if;
  v_room := public.scrim_admin_lock_room(p_id,p_actor_id,p_actor_session_version,'{}',p_expected_access_version);
  if v_room.owner_user_id<>p_owner_id then
    update public.scrims s set owner_user_id=p_owner_id,access_version=s.access_version+1,
      access_updated_at=floor(extract(epoch from clock_timestamp())*1000)::bigint,access_updated_by=p_actor_id where s.id=p_id;
    perform public.scrim_admin_write_audit(p_actor_id,'room.transfer',p_owner_id,p_id,
      jsonb_build_object('ownerId',v_room.owner_user_id,'accessVersion',v_room.access_version),
      jsonb_build_object('ownerId',p_owner_id,'accessVersion',v_room.access_version+1));
  end if;
  return query select s.is_public,s.deleted_at,s.access_version,s.owner_user_id from public.scrims s where s.id=p_id;
end;
$$;

-- No default PUBLIC execution, including internal helpers and DTO functions.
do $privileges$
declare f record;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'scrim_admin_%' or p.proname in (
      'get_admin_access','get_admin_login_policy','get_admin_account','list_admin_accounts','register_admin_account','update_admin_account',
      'set_admin_account_active','begin_admin_password_reset','finish_admin_password_reset','create_owned_scrim',
      'append_owned_scrim_event','import_owned_match','manage_owned_scrim_access','transfer_scrim_owner'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated',f.oid::regprocedure);
    execute format('grant execute on function %s to service_role',f.oid::regprocedure);
  end loop;
end;
$privileges$;
notify pgrst, 'reload schema';
commit;
