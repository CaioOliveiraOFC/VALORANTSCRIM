import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

let db: PGlite;
let migration: string;
const owner = '11111111-1111-4111-8111-111111111111';
const adminA = '22222222-2222-4222-8222-222222222222';
const adminB = '33333333-3333-4333-8333-333333333333';
const inactive = '44444444-4444-4444-8444-444444444444';
const untrusted = '55555555-5555-4555-8555-555555555555';
const stringRole = '66666666-6666-4666-8666-666666666666';
const keyHash = 'a'.repeat(64);
const passwordFingerprint = 'b'.repeat(64);
const anotherPasswordFingerprint = 'c'.repeat(64);
const matchId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const keys = ['createRooms','editRoom','manageTeams','manageVeto','manageDraws','manageFocus','importMatches','correctStats','manageNotes','publishRooms','deleteRooms'];
const full = Object.fromEntries(keys.map(key => [key,true]));
const organizer = { ...full, correctStats: false, deleteRooms: false };
const first = (id: string) => ({ type: 'scrim.create',id,seq:1,at:1 });
const state = (id: string, version = 1) => ({ id,version });

async function value(sql: string, args: unknown[] = []) {
  const result = await db.query(`select ${sql} as value`,args);
  return result.rows[0]?.value as any;
}
async function setup(instance: PGlite) {
  await instance.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create publication supabase_realtime; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,
      raw_app_meta_data jsonb not null default '{}',raw_user_meta_data jsonb not null default '{}',
      created_at timestamptz not null default clock_timestamp(),last_sign_in_at timestamptz);`);
  for (const file of ['20261016_scrims.sql','20261017_match_imports.sql','20261104_room_access.sql']) {
    await instance.exec(await readFile(new URL(file,import.meta.url),'utf8'));
  }
}
async function addIdentity(id: string, email: string, metadata: unknown = {scrim_console_managed:true}) {
  await db.exec('reset role');
  await db.query(`insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
    values($1,$2,clock_timestamp(),$3)`,[id,email,metadata]);
  await db.exec('set role service_role');
}
async function account(permissions = organizer, active = true) {
  const id=randomUUID();await addIdentity(id,`${id}@example.test`);
  const dto=await value('public.register_admin_account($1,$2,$3,$4,$5,$6)',[owner,id,'Organizador','organizer',permissions,active]);
  return {id,dto};
}
async function createRoom(id: string, actor = owner, visible = true) {
  await db.exec('set role service_role');
  await value('public.create_owned_scrim($1,$2,$3,0,$4,$5,1,$6)',[id,keyHash,actor,state(id),first(id),visible]);
}
async function append(id: string, actor: string, version = 1, accessVersion = 1, permissions = ['manageNotes'], epoch = 0) {
  return value('public.append_owned_scrim_event($1,$2,$8,$3,$4,$5,$6,$7)',[
    id,actor,version,accessVersion,state(id,version+1),{type:'note.add',seq:version+1,at:version+1,text:'Preservar'},permissions,epoch,
  ]);
}
async function manage(id: string, actor: string, action: string, version = 1) {
  return (await db.query('select * from public.manage_owned_scrim_access($1,$2,0,$3,$4,20)',[id,actor,version,action])).rows;
}
async function transfer(id: string, actor: string, nextOwner: string, version = 1) {
  return (await db.query('select * from public.transfer_scrim_owner($1,$2,0,$3,$4)',[id,actor,version,nextOwner])).rows;
}
async function beginReset(id: string, version = 1, fingerprint: unknown = passwordFingerprint) {
  return value('public.begin_admin_password_reset($1,$2,$3,$4)',[owner,id,version,fingerprint]);
}

beforeAll(async()=>{
  db=new PGlite();await setup(db);
  for (const [id,email,metadata] of [
    [owner,'caio.oliveira2014@hotmail.com',{scrim_admin:true}],
    [adminA,'admin-a@example.test',{scrim_admin:true}],
    [adminB,'admin-b@example.test',{scrim_admin:true,scrim_delete_rooms:true}],
    [inactive,'inactive@example.test',{scrim_admin:false,scrim_delete_rooms:true}],
    [untrusted,'untrusted@example.test',{}],
    [stringRole,'string-role@example.test',{scrim_admin:'true'}],
  ] as const) await db.query('insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values($1,$2,clock_timestamp(),$3,$4)',[id,email,metadata,{scrim_admin:true,scrim_delete_rooms:true}]);
  for (const [id,visible] of [['legacypublic',true],['legacyhidden',false],['legacytrash',false]] as const) {
    await db.query('select public.create_scrim_with_access($1,$2,$3,$4,1,$5)',[id,keyHash,state(id),first(id),visible]);
  }
  await db.query('select * from public.manage_scrim_access($1,1,$2,10,$3)',['legacytrash','delete',owner]);
  migration=await readFile(new URL('20261105_super_admin.sql',import.meta.url),'utf8');
  await db.exec(migration);
},30_000);
afterEach(async()=>{await db.exec('reset role');});
afterAll(async()=>{await db.close();});

describe('canonical administrator policies and ownership migration',()=>{
  it('pins the confirmed owner, seeds strict legacy roles and preserves every legacy room',async()=>{
    expect(await value('public.scrim_admin_owner_id()')).toBe(owner);
    const own=await value('public.get_admin_access($1)',[owner]);
    expect(own).toMatchObject({user_id:owner,active:true,is_super_admin:true,version:1,session_version:0,permissions:full});
    expect((await value('public.get_admin_access($1)',[adminA])).permissions).toEqual({...full,deleteRooms:false});
    expect((await value('public.get_admin_access($1)',[adminB])).permissions).toEqual(full);
    expect(await value('public.get_admin_access($1)',[inactive])).toMatchObject({active:false,permissions:full});
    expect(await value('public.get_admin_access($1)',[untrusted])).toBeNull();
    expect(await value('public.get_admin_access($1)',[stringRole])).toBeNull();
    const rooms=(await db.query('select id,state,version,is_public,deleted_at,access_version,owner_user_id,created_by_user_id from public.scrims order by id')).rows;
    expect(rooms).toEqual([
      {id:'legacyhidden',state:state('legacyhidden'),version:1,is_public:false,deleted_at:null,access_version:1,owner_user_id:owner,created_by_user_id:null},
      {id:'legacypublic',state:state('legacypublic'),version:1,is_public:true,deleted_at:null,access_version:1,owner_user_id:owner,created_by_user_id:null},
      {id:'legacytrash',state:state('legacytrash'),version:1,is_public:false,deleted_at:10,access_version:2,owner_user_id:owner,created_by_user_id:null},
    ]);
    expect((await db.query('select count(*)::integer as n from public.scrim_events')).rows).toEqual([{n:3}]);
  });

  it('requires a confirmed owner before installing and rolls a failed upgrade back',async()=>{
    const empty=new PGlite();await setup(empty);
    try {
      await expect(empty.exec(migration)).rejects.toThrow('CONFIRMED_SUPER_ADMIN_REQUIRED');
      await empty.exec('rollback');
      expect((await empty.query("select to_regclass('public.scrim_admin_settings') as installed")).rows).toEqual([{installed:null}]);
    } finally {await empty.close();}
  },30_000);

  it('allows only complete boolean permission sets and preserves the two presets',async()=>{
    expect(await value("public.scrim_admin_preset_permissions('organizer')")).toEqual(organizer);
    expect(await value("public.scrim_admin_preset_permissions('full')")).toEqual(full);
    for (const invalid of [null,[],true,'true',{...organizer,accessAll:true},{...organizer,deleteRooms:'true'},{}]) {
      expect(await value('public.scrim_admin_valid_permissions($1)',[invalid])).toBe(false);
    }
    const target=await account();
    await expect(value('public.update_admin_account($1,$2,1,$3,$4,$5)',[owner,target.id,'Nome','organizer',{...organizer,accessAll:true}])).rejects.toThrow('INVALID_ADMIN_INPUT');
    expect((await value('public.get_admin_access($1)',[target.id])).version).toBe(1);
  });

  it('denies all policy tables and all new RPCs to anon and authenticated roles',async()=>{
    const procedures=(await db.query(`select p.oid::text as oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and (p.proname like 'scrim_admin_%' or p.proname in
      ('get_admin_access','get_admin_login_policy','get_admin_account','list_admin_accounts','register_admin_account','update_admin_account',
      'set_admin_account_active','begin_admin_password_reset','finish_admin_password_reset','create_owned_scrim',
      'append_owned_scrim_event','import_owned_match','manage_owned_scrim_access','transfer_scrim_owner'))`)).rows;
    expect(procedures.length).toBeGreaterThan(15);
    for (const role of ['anon','authenticated']) {
      for (const proc of procedures) expect(await value('has_function_privilege($1,$2::oid,$3)',[role,proc.oid,'EXECUTE'])).toBe(false);
      await db.exec(`set role ${role}`);
      for (const table of ['scrim_admin_settings','scrim_admin_accounts','scrim_admin_audit']) {
        await expect(db.query(`select * from public.${table}`)).rejects.toThrow('permission denied');
        await expect(db.query(`delete from public.${table}`)).rejects.toThrow('permission denied');
      }
      await expect(value('public.get_admin_access($1)',[owner])).rejects.toThrow('permission denied');
      await expect(value('public.get_admin_login_policy($1)',['caio.oliveira2014@hotmail.com'])).rejects.toThrow('permission denied');
      await expect(value('public.list_admin_accounts($1)',[owner])).rejects.toThrow('permission denied');
      await db.exec('reset role');
    }
    const hardened=(await db.query(`select prosecdef,proconfig from pg_proc where oid='public.get_admin_access(uuid)'::regprocedure`)).rows[0];
    expect(hardened?.prosecdef).toBe(true);expect(hardened?.proconfig).toContain('search_path=""');
    expect(await value("to_regprocedure('public.begin_admin_password_reset(uuid,uuid,integer)')")).toBeNull();
    expect(await value("to_regprocedure('public.finish_admin_password_reset(uuid,bigint,boolean,text)')")).toBeNull();
  });

  it('cannot grant super powers through a full profile or editable Auth metadata',async()=>{
    const target=await account(full);
    expect(await value('public.get_admin_access($1)',[target.id])).toMatchObject({is_super_admin:false,permissions:full});
    await expect(value('public.list_admin_accounts($1)',[target.id])).rejects.toThrow('ADMIN_FORBIDDEN');
    await expect(value('public.set_admin_account_active($1,$2,1,false)',[target.id,adminA])).rejects.toThrow('ADMIN_FORBIDDEN');
    await db.exec('reset role');
    await db.query(`update auth.users set raw_app_meta_data=raw_app_meta_data||'{"is_super_admin":true,"scrim_admin":true}'::jsonb where id=$1`,[untrusted]);
    await db.exec('set role service_role');
    expect(await value('public.get_admin_access($1)',[untrusted])).toBeNull();
  });

  it('protects the fixed owner against registration, demotion, suspension and password resets',async()=>{
    await db.exec('set role service_role');
    for (const attempt of [
      () => value('public.register_admin_account($1,$2,$3,$4,$5,true)',[owner,owner,'Outra pessoa','organizer',organizer]),
      () => value('public.update_admin_account($1,$2,1,$3,$4,$5)',[owner,owner,'Outra pessoa','organizer',organizer]),
      () => value('public.set_admin_account_active($1,$2,1,false)',[owner,owner]),
      () => beginReset(owner),
    ]) await expect(attempt()).rejects.toThrow('OWNER_PROTECTED');
    expect(await value('public.get_admin_access($1)',[owner])).toMatchObject({active:true,is_super_admin:true,version:1,session_version:0});
    await expect(db.query('update public.scrim_admin_settings set owner_user_id=$1',[adminA])).rejects.toThrow('permission denied');
  });

  it('recovers console-created Auth identities without exposing unrelated Auth accounts',async()=>{
    const pending=randomUUID();
    await addIdentity(pending,'pending@example.test',{scrim_console_managed:true,scrim_console_display_name:'Pendente',scrim_console_preset:'full',scrim_console_permissions:full});
    const before=await value('public.get_admin_account($1,$2)',[owner,pending]);
    expect(before).toMatchObject({id:pending,provisioned:false,active:false,version:0,displayName:'Pendente',preset:'full',permissions:full,passwordResetPending:false});
    expect(await value('public.get_admin_access($1)',[pending])).toBeNull();
    expect(await value('public.get_admin_login_policy($1)',['pending@example.test'])).toBeNull();
    const page=await value("public.list_admin_accounts($1,0,25,'','pending')",[owner]);
    expect(page.accounts.map((x:any)=>x.id)).toContain(pending);
    expect(page.accounts.map((x:any)=>x.id)).not.toContain(untrusted);
    const completed=await value('public.update_admin_account($1,$2,0,$3,$4,$5)',[owner,pending,'Concluído','organizer',organizer]);
    expect(completed).toMatchObject({provisioned:true,active:true,version:1,displayName:'Concluído',permissions:organizer});
    await expect(value('public.update_admin_account($1,$2,0,$3,$4,$5)',[owner,pending,'Repetido','organizer',organizer])).rejects.toThrow('STALE_ADMIN_VERSION');
    await expect(value('public.register_admin_account($1,$2,$3,$4,$5)',[owner,untrusted,'Não marcado','full',full])).rejects.toThrow('ADMIN_NOT_FOUND');
  });

  it('paginates all managed accounts, searches literally, and validates list bounds',async()=>{
    const seen:string[]=[];let offset:number|null=0;let total=0;
    while(offset!==null) {
      const page=await value("public.list_admin_accounts($1,$2,2,'','all')",[owner,offset]);
      total=page.total;seen.push(...page.accounts.map((x:any)=>x.id));offset=page.nextOffset;
    }
    expect(new Set(seen).size).toBe(total);expect(seen.length).toBe(total);
    expect(seen).toContain(owner);expect(seen).toContain(inactive);expect(seen).not.toContain(untrusted);
    expect((await value("public.list_admin_accounts($1,0,25,'admin-a','active')",[owner])).accounts.map((x:any)=>x.id)).toEqual([adminA]);
    expect((await value("public.list_admin_accounts($1,0,25,'%','all')",[owner])).accounts).toEqual([]);
    await expect(value("public.list_admin_accounts($1,-1,25,'','all')",[owner])).rejects.toThrow('INVALID_ADMIN_INPUT');
    await expect(value("public.list_admin_accounts($1,0,101,'','all')",[owner])).rejects.toThrow('INVALID_ADMIN_INPUT');
    await expect(value("public.list_admin_accounts($1,0,25,'','bogus')",[owner])).rejects.toThrow('INVALID_ADMIN_INPUT');
  });

  it('updates permissions with CAS and commits a whitelisted audit in the same transaction',async()=>{
    const target=await account();
    const before=(await db.query('select count(*)::integer as n from public.scrim_admin_audit')).rows[0]!.n;
    const attempts=await Promise.allSettled([
      value('public.update_admin_account($1,$2,1,$3,$4,$5)',[owner,target.id,'Nome novo','full',full]),
      value('public.update_admin_account($1,$2,1,$3,$4,$5)',[owner,target.id,'Nome atrasado','organizer',organizer]),
    ]);
    expect(attempts.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(attempts.filter(x=>x.status==='rejected')).toHaveLength(1);
    expect((await value('public.get_admin_access($1)',[target.id])).version).toBe(2);
    expect((await db.query('select count(*)::integer as n from public.scrim_admin_audit')).rows[0]!.n).toBe(Number(before)+1);
    const audit=(await db.query("select actor_id,target_user_id,previous,next,status from public.scrim_admin_audit where action='account.permissions' and target_user_id=$1",[target.id])).rows[0];
    expect(audit).toMatchObject({actor_id:owner,target_user_id:target.id,status:'success'});
    expect((audit!.previous as any).permissions).toEqual(organizer);
    expect((audit!.next as any).permissions).toEqual(full);
  });

  it('rolls back permission changes if their audit cannot be recorded',async()=>{
    const target=await account();await db.exec('reset role');
    await db.exec(`create function public.reject_admin_audit() returns trigger language plpgsql as $$ begin raise exception 'audit failure'; end $$;
      create trigger reject_admin_audit before insert on public.scrim_admin_audit for each row execute function public.reject_admin_audit();`);
    try {
      await db.exec('set role service_role');
      await expect(value('public.update_admin_account($1,$2,1,$3,$4,$5)',[owner,target.id,'Nome','full',full])).rejects.toThrow('audit failure');
      expect(await value('public.get_admin_access($1)',[target.id])).toMatchObject({version:1,permissions:organizer});
    } finally {await db.exec('reset role; drop trigger reject_admin_audit on public.scrim_admin_audit;');}
  });

  it('suspends immediately, preserves room visibility and restores permissions without restoring old sessions',async()=>{
    const target=await account();await createRoom('suspendroom',target.id,true);
    const before=(await db.query('select * from public.scrims where id=$1',['suspendroom'])).rows;
    const suspended=await value('public.set_admin_account_active($1,$2,1,false)',[owner,target.id]);
    expect(suspended).toMatchObject({active:false,permissions:organizer,version:2});
    expect(await value('public.get_admin_access($1)',[target.id])).toMatchObject({active:false,session_version:1});
    await expect(append('suspendroom',target.id)).rejects.toThrow('ADMIN_FORBIDDEN');
    await expect(createRoom('suspendednew',target.id)).rejects.toThrow('ADMIN_FORBIDDEN');
    expect((await db.query('select * from public.scrims where id=$1',['suspendroom'])).rows).toEqual(before);
    const active=await value('public.set_admin_account_active($1,$2,2,true)',[owner,target.id]);
    expect(active).toMatchObject({active:true,permissions:organizer,version:3});
    expect(await value('public.get_admin_access($1)',[target.id])).toMatchObject({session_version:1});
    await expect(append('suspendroom',target.id)).rejects.toThrow('ADMIN_FORBIDDEN');
    await append('suspendroom',target.id,1,1,['manageNotes'],1);
  });

  it('keeps uncertain password resets blocked and retries only the same password without another epoch bump',async()=>{
    const target=await account();
    const reset=await beginReset(target.id);
    expect(reset.account).toMatchObject({id:target.id,version:2,active:true,passwordResetPending:true});
    expect(typeof reset.auditId).toBe('number');
    expect(reset.attemptVersion).toBe(1);
    expect(await value('public.get_admin_access($1)',[target.id])).toMatchObject({session_version:1,password_reset_pending:true});
    expect(await value('public.get_admin_login_policy($1)',[`  ${target.id.toUpperCase()}@EXAMPLE.TEST  `]))
      .toEqual(await value('public.get_admin_access($1)',[target.id]));
    expect(await value('public.get_admin_login_policy($1)',['missing@example.test'])).toBeNull();
    await expect(beginReset(target.id,1)).rejects.toThrow('STALE_ADMIN_VERSION');
    await expect(value('public.finish_admin_password_reset($1,$2,false,$3,1)',[owner,reset.auditId,'password=secret'])).rejects.toThrow('INVALID_ADMIN_INPUT');
    await value('public.finish_admin_password_reset($1,$2,false,$3,1)',[owner,reset.auditId,'auth_unavailable']);
    expect((await db.query('select status,error_code,completed_at is not null as completed from public.scrim_admin_audit where id=$1',[reset.auditId])).rows)
      .toEqual([{status:'pending',error_code:'auth_unavailable',completed:false}]);
    await expect(beginReset(target.id,2,anotherPasswordFingerprint)).rejects.toThrow('RESET_IN_PROGRESS');
    await expect(beginReset(target.id,1)).rejects.toThrow('STALE_ADMIN_VERSION');
    const retry=await beginReset(target.id,2);
    expect(retry).toEqual({...reset,attemptVersion:2});
    expect(await value('public.get_admin_access($1)',[target.id])).toMatchObject({version:2,session_version:1,password_reset_pending:true});
    expect((await db.query('select error_code from public.scrim_admin_audit where id=$1',[reset.auditId])).rows).toEqual([{error_code:null}]);
    await expect(beginReset(target.id,2)).rejects.toThrow('RESET_IN_PROGRESS');
    await value('public.finish_admin_password_reset($1,$2,true,null,2)',[owner,retry.auditId]);
    expect(await value('public.get_admin_account($1,$2)',[owner,target.id])).toMatchObject({version:2,passwordResetPending:false});
    expect((await db.query('select password_reset_pending,password_reset_fingerprint,password_reset_audit_id from public.scrim_admin_accounts where user_id=$1',[target.id])).rows)
      .toEqual([{password_reset_pending:false,password_reset_fingerprint:null,password_reset_audit_id:null}]);
    expect((await db.query('select status,error_code,completed_at is not null as completed from public.scrim_admin_audit where id=$1',[reset.auditId])).rows)
      .toEqual([{status:'success',error_code:null,completed:true}]);
    const audits=JSON.stringify((await db.query('select * from public.scrim_admin_audit where target_user_id=$1',[target.id])).rows);
    expect(audits).not.toContain('password=secret');
    expect(audits).not.toContain(passwordFingerprint);
  });

  it('serializes password resets across current-version requests and ignores old completed operations',async()=>{
    const target=await account();
    const firstReset=await beginReset(target.id);
    await expect(beginReset(target.id,2)).rejects.toThrow('RESET_IN_PROGRESS');
    await expect(beginReset(target.id,2,anotherPasswordFingerprint)).rejects.toThrow('RESET_IN_PROGRESS');
    expect((await db.query("select count(*)::integer as n from public.scrim_admin_audit where target_user_id=$1 and action='account.password_reset'",[target.id])).rows).toEqual([{n:1}]);
    await value('public.finish_admin_password_reset($1,$2,true,null,1)',[owner,firstReset.auditId]);
    await value('public.finish_admin_password_reset($1,$2,true,null,1)',[owner,firstReset.auditId]);
    const secondReset=await beginReset(target.id,2,anotherPasswordFingerprint);
    expect(secondReset.account).toMatchObject({version:3,passwordResetPending:true});
    expect(secondReset.auditId).not.toBe(firstReset.auditId);
    expect(secondReset.attemptVersion).toBe(1);
    await expect(value('public.finish_admin_password_reset($1,$2,false,$3,1)',[owner,firstReset.auditId,'auth_rejected'])).rejects.toThrow('STALE_ADMIN_VERSION');
    expect(await value('public.get_admin_access($1)',[target.id])).toMatchObject({version:3,session_version:2,password_reset_pending:true});
    expect((await db.query('select password_reset_audit_id from public.scrim_admin_accounts where user_id=$1',[target.id])).rows)
      .toEqual([{password_reset_audit_id:secondReset.auditId}]);
    await value('public.finish_admin_password_reset($1,$2,false,$3,1)',[owner,secondReset.auditId,'auth_rejected']);
    expect(await value('public.get_admin_access($1)',[target.id])).toMatchObject({version:3,session_version:2,password_reset_pending:false});
    expect((await db.query('select status,error_code from public.scrim_admin_audit where id=$1',[secondReset.auditId])).rows)
      .toEqual([{status:'failure',error_code:'auth_rejected'}]);
    await expect(value('public.finish_admin_password_reset($1,$2,true,null,1)',[owner,firstReset.auditId])).rejects.toThrow('STALE_ADMIN_VERSION');
    const thirdReset=await beginReset(target.id,3);
    expect(thirdReset.account).toMatchObject({version:4,passwordResetPending:true});
    expect(await value('public.get_admin_access($1)',[target.id])).toMatchObject({session_version:3});
    expect(thirdReset.attemptVersion).toBe(1);
    await value('public.finish_admin_password_reset($1,$2,true,null,1)',[owner,thirdReset.auditId]);
  });

  it('rejects invalid password fingerprints and keeps unknown outcomes behind the reset barrier',async()=>{
    const target=await account();
    for (const invalid of [null,'',passwordFingerprint.toUpperCase(),'b'.repeat(63),'g'.repeat(64),'password=secret']) {
      await expect(beginReset(target.id,1,invalid)).rejects.toThrow('INVALID_ADMIN_INPUT');
    }
    expect(await value('public.get_admin_access($1)',[target.id])).toMatchObject({version:1,session_version:0,password_reset_pending:false});
    const reset=await beginReset(target.id);
    for (const invalid of [null,0,-1]) {
      await expect(value('public.finish_admin_password_reset($1,$2,true,null,$3)',[owner,reset.auditId,invalid])).rejects.toThrow('INVALID_ADMIN_INPUT');
    }
    await value('public.finish_admin_password_reset($1,$2,false,$3,1)',[owner,reset.auditId,'unknown']);
    expect(await value('public.get_admin_access($1)',[target.id])).toMatchObject({version:2,session_version:1,password_reset_pending:true});
    expect((await db.query('select status,error_code,completed_at is not null as completed from public.scrim_admin_audit where id=$1',[reset.auditId])).rows)
      .toEqual([{status:'pending',error_code:'unknown',completed:false}]);
    expect(await beginReset(target.id,2)).toMatchObject({auditId:reset.auditId,attemptVersion:2});
    await value('public.finish_admin_password_reset($1,$2,true,null,2)',[owner,reset.auditId]);
  });

  it('rejects stale reset outcomes without reopening an in-flight retry or clearing its barrier',async()=>{
    const target=await account();
    const reset=await beginReset(target.id);
    await value('public.finish_admin_password_reset($1,$2,false,$3,1)',[owner,reset.auditId,'unknown']);
    expect(await beginReset(target.id,2)).toMatchObject({auditId:reset.auditId,attemptVersion:2});
    for (const outcome of [
      () => value('public.finish_admin_password_reset($1,$2,false,$3,1)',[owner,reset.auditId,'unknown']),
      () => value('public.finish_admin_password_reset($1,$2,false,$3,1)',[owner,reset.auditId,'auth_rejected']),
      () => value('public.finish_admin_password_reset($1,$2,true,null,1)',[owner,reset.auditId]),
    ]) await expect(outcome()).rejects.toThrow('STALE_ADMIN_VERSION');
    expect((await db.query('select error_code from public.scrim_admin_audit where id=$1',[reset.auditId])).rows).toEqual([{error_code:null}]);
    await expect(beginReset(target.id,2)).rejects.toThrow('RESET_IN_PROGRESS');
    expect(await value('public.get_admin_access($1)',[target.id])).toMatchObject({version:2,session_version:1,password_reset_pending:true});
    await value('public.finish_admin_password_reset($1,$2,false,$3,2)',[owner,reset.auditId,'auth_unavailable']);
    expect(await beginReset(target.id,2)).toMatchObject({auditId:reset.auditId,attemptVersion:3});
    await expect(value('public.finish_admin_password_reset($1,$2,false,$3,2)',[owner,reset.auditId,'unknown'])).rejects.toThrow('STALE_ADMIN_VERSION');
    await expect(beginReset(target.id,2)).rejects.toThrow('RESET_IN_PROGRESS');
    expect((await db.query('select password_reset_attempt from public.scrim_admin_accounts where user_id=$1',[target.id])).rows).toEqual([{password_reset_attempt:3}]);
    await value('public.finish_admin_password_reset($1,$2,true,null,3)',[owner,reset.auditId]);
    await expect(value('public.finish_admin_password_reset($1,$2,false,$3,2)',[owner,reset.auditId,'unknown'])).rejects.toThrow('STALE_ADMIN_VERSION');
    expect(await value('public.get_admin_access($1)',[target.id])).toMatchObject({version:2,session_version:1,password_reset_pending:false});
    expect((await db.query('select status,error_code from public.scrim_admin_audit where id=$1',[reset.auditId])).rows).toEqual([{status:'success',error_code:null}]);
  });

  it('only accepts duplicate completion for the latest reset after all barriers have cleared',async()=>{
    const target=await account();
    const older=await beginReset(target.id);
    await value('public.finish_admin_password_reset($1,$2,true,null,1)',[owner,older.auditId]);
    const latest=await beginReset(target.id,2,anotherPasswordFingerprint);
    await value('public.finish_admin_password_reset($1,$2,true,null,1)',[owner,latest.auditId]);
    expect((await db.query('select password_reset_audit_id,last_password_reset_audit_id from public.scrim_admin_accounts where user_id=$1',[target.id])).rows)
      .toEqual([{password_reset_audit_id:null,last_password_reset_audit_id:latest.auditId}]);
    await expect(value('public.finish_admin_password_reset($1,$2,true,null,1)',[owner,older.auditId])).rejects.toThrow('STALE_ADMIN_VERSION');
    await expect(value('public.finish_admin_password_reset($1,$2,false,$3,1)',[owner,older.auditId,'unknown'])).rejects.toThrow('STALE_ADMIN_VERSION');
    await value('public.finish_admin_password_reset($1,$2,true,null,1)',[owner,latest.auditId]);
    expect(await value('public.get_admin_access($1)',[target.id])).toMatchObject({version:3,session_version:2,password_reset_pending:false});
    expect((await db.query("select status,error_code from public.scrim_admin_audit where target_user_id=$1 and action='account.password_reset' order by id",[target.id])).rows)
      .toEqual([{status:'success',error_code:null},{status:'success',error_code:null}]);
  });

  it('creates ownership and creator atomically and blocks publication when that permission is absent',async()=>{
    const target=await account({...organizer,publishRooms:false});
    await createRoom('ownprivate',target.id,false);
    expect((await db.query('select owner_user_id,created_by_user_id,is_public from public.scrims where id=$1',['ownprivate'])).rows)
      .toEqual([{owner_user_id:target.id,created_by_user_id:target.id,is_public:false}]);
    await expect(createRoom('ownpublicbad',target.id,true)).rejects.toThrow('ADMIN_FORBIDDEN');
    expect((await db.query('select id from public.scrims where id=$1',['ownpublicbad'])).rows).toEqual([]);
    await db.query('select public.create_scrim($1,$2,$3,$4,1)',['oldcaller',keyHash,state('oldcaller'),first('oldcaller')]);
    expect((await db.query('select owner_user_id,created_by_user_id from public.scrims where id=$1',['oldcaller'])).rows)
      .toEqual([{owner_user_id:owner,created_by_user_id:null}]);
  });

  it('rejects already-authorized room writes from an earlier session generation after password reset',async()=>{
    const target=await account(full);await createRoom('resetepoch',target.id,false);
    const reset=await beginReset(target.id);
    await expect(append('resetepoch',target.id)).rejects.toThrow('ADMIN_FORBIDDEN');
    await expect(manage('resetepoch',target.id,'show')).rejects.toThrow('ADMIN_FORBIDDEN');
    await expect(createRoom('resetnewbad',target.id,false)).rejects.toThrow('ADMIN_FORBIDDEN');
    const event={type:'match.import',seq:2,at:2,mapIndex:0,match:{id:matchId}};
    await expect(value('public.import_owned_match($1,$2,0,1,1,$3,$4,$5)', ['resetepoch',target.id,state('resetepoch',2),event,{private:'raw'}])).rejects.toThrow('ADMIN_FORBIDDEN');
    await expect(value('public.create_owned_scrim($1,$2,$3,null,$4,$5,1,false)',['nullsession',keyHash,target.id,state('nullsession'),first('nullsession')])).rejects.toThrow('INVALID_ADMIN_INPUT');
    await expect(value('public.create_owned_scrim($1,$2,$3,-1,$4,$5,1,false)',['badsession',keyHash,target.id,state('badsession'),first('badsession')])).rejects.toThrow('INVALID_ADMIN_INPUT');
    await expect(db.query('select * from public.transfer_scrim_owner($1,$2,99,1,$3)',['resetepoch',owner,adminB])).rejects.toThrow('ADMIN_FORBIDDEN');
    expect((await db.query('select version,access_version from public.scrims where id=$1',['resetepoch'])).rows).toEqual([{version:1,access_version:1}]);
    await expect(append('resetepoch',target.id,1,1,['manageNotes'],1)).rejects.toThrow('ADMIN_FORBIDDEN');
    await expect(value('public.create_owned_scrim($1,$2,$3,1,$4,$5,1,false)',['resetpendingnew',keyHash,target.id,state('resetpendingnew'),first('resetpendingnew')])).rejects.toThrow('ADMIN_FORBIDDEN');
    await expect(db.query('select * from public.manage_owned_scrim_access($1,$2,1,1,$3,20)',['resetepoch',target.id,'show'])).rejects.toThrow('ADMIN_FORBIDDEN');
    await expect(value('public.import_owned_match($1,$2,1,1,1,$3,$4,$5)', ['resetepoch',target.id,state('resetepoch',2),event,{private:'raw'}])).rejects.toThrow('ADMIN_FORBIDDEN');
    await value('public.finish_admin_password_reset($1,$2,true,null,1)',[owner,reset.auditId]);
    await expect(append('resetepoch',target.id)).rejects.toThrow('ADMIN_FORBIDDEN');
    await append('resetepoch',target.id,1,1,['manageNotes'],1);
  });

  it('requires ownership and the exact capability for commands, tools, imports and access changes',async()=>{
    const target=await account();await createRoom('ownscope',target.id,true);
    await expect(append('ownscope',adminB)).rejects.toThrow('ADMIN_FORBIDDEN');
    await expect(manage('ownscope',adminB,'hide')).rejects.toThrow('ADMIN_FORBIDDEN');
    await expect(manage('ownscope',target.id,'delete')).rejects.toThrow('ADMIN_FORBIDDEN');
    const noNotes=await account({...organizer,manageNotes:false});await createRoom('nonotes',noNotes.id,true);
    await expect(append('nonotes',noNotes.id)).rejects.toThrow('ADMIN_FORBIDDEN');
    await expect(append('ownscope',target.id,1,1,['unknown'])).rejects.toThrow('INVALID_ADMIN_INPUT');
    const noImport=await account({...organizer,importMatches:false});await createRoom('noimport',noImport.id,false);
    const event={type:'match.import',seq:2,at:2,mapIndex:0,match:{id:matchId}};
    await expect(value('public.import_owned_match($1,$2,0,1,1,$3,$4,$5)', ['noimport',noImport.id,state('noimport',2),event,{private:'raw'}])).rejects.toThrow('ADMIN_FORBIDDEN');
    await value('public.import_owned_match($1,$2,0,1,1,$3,$4,$5)', ['ownscope',target.id,state('ownscope',2),event,{private:'raw'}]);
    expect((await db.query('select raw from public.scrim_match_imports where scrim_id=$1',['ownscope'])).rows).toEqual([{raw:{private:'raw'}}]);
    await expect(value('public.import_owned_match($1,$2,0,2,1,$3,$4,$5)', ['ownscope',adminB,state('ownscope',3),{...event,seq:3},{private:'raw'}])).rejects.toThrow('ADMIN_FORBIDDEN');
    await append('nonotes',owner);
  });

  it('uses both domain and access versions so transfer/revocation cannot be bypassed by stale requests',async()=>{
    const target=await account(),other=await account();await createRoom('transfer1',target.id,false);
    const before=(await db.query('select state,version,is_public,deleted_at,created_by_user_id from public.scrims where id=$1',['transfer1'])).rows;
    await expect(transfer('transfer1',target.id,other.id)).rejects.toThrow('ADMIN_FORBIDDEN');
    const result=await transfer('transfer1',owner,other.id);
    expect(result).toEqual([{is_public:false,deleted_at:null,access_version:2,owner_user_id:other.id}]);
    expect((await db.query('select state,version,is_public,deleted_at,created_by_user_id from public.scrims where id=$1',['transfer1'])).rows).toEqual(before);
    await expect(append('transfer1',target.id,1,1)).rejects.toThrow('ADMIN_FORBIDDEN');
    await expect(append('transfer1',other.id,1,1)).rejects.toThrow('STALE_OR_FORBIDDEN');
    await append('transfer1',other.id,1,2);
    await expect(append('transfer1',other.id,1,2)).rejects.toThrow('STALE_OR_FORBIDDEN');
    const suspended=await account(organizer,false);
    await expect(transfer('transfer1',owner,suspended.id,2)).rejects.toThrow('ADMIN_NOT_FOUND');
  });

  it('preserves deleted room history and restores it hidden under the same owner',async()=>{
    const target=await account(full);await createRoom('owntrash',target.id,true);await append('owntrash',target.id);
    const before=(await db.query('select state,version from public.scrims where id=$1',['owntrash'])).rows;
    const events=(await db.query('select * from public.scrim_events where scrim_id=$1 order by seq',['owntrash'])).rows;
    expect(await manage('owntrash',target.id,'delete')).toEqual([{is_public:false,deleted_at:20,access_version:2,owner_user_id:target.id}]);
    await expect(append('owntrash',target.id,2,2)).rejects.toThrow('SCRIM_DELETED');
    await expect(transfer('owntrash',owner,adminB,2)).rejects.toThrow('SCRIM_DELETED');
    expect(await manage('owntrash',target.id,'restore',2)).toEqual([{is_public:false,deleted_at:null,access_version:3,owner_user_id:target.id}]);
    expect((await db.query('select state,version from public.scrims where id=$1',['owntrash'])).rows).toEqual(before);
    expect((await db.query('select * from public.scrim_events where scrim_id=$1 order by seq',['owntrash'])).rows).toEqual(events);
    await db.exec('set role anon');expect((await db.query('select * from public.scrim_events where scrim_id=$1',['owntrash'])).rows).toEqual([]);
  });

  it('keeps the owner UUID, suspended accounts, transfers and history unchanged when reapplied',async()=>{
    const target=await account(full);await createRoom('reapplyown',target.id,false);
    await value('public.set_admin_account_active($1,$2,1,false)',[owner,target.id]);
    const before=(await db.query('select * from public.scrim_admin_accounts where user_id=$1',[target.id])).rows;
    const room=(await db.query('select * from public.scrims where id=$1',['reapplyown'])).rows;
    const fake=randomUUID();await addIdentity(fake,'future-owner@example.test',{});
    const laterLegacy=randomUUID();await addIdentity(laterLegacy,'later-legacy@example.test',{scrim_admin:true,scrim_delete_rooms:true});
    expect(await value('public.get_admin_access($1)',[laterLegacy])).toBeNull();
    await db.exec('reset role');
    await db.query('update auth.users set email=$1 where id=$2',['changed-owner@example.test',owner]);
    await db.query('update auth.users set email=$1 where id=$2',['caio.oliveira2014@hotmail.com',fake]);
    try {
      await db.exec(migration);
      expect(await value('public.scrim_admin_owner_id()')).toBe(owner);
      expect(await value('public.get_admin_access($1)',[fake])).toBeNull();
      expect(await value('public.get_admin_access($1)',[laterLegacy])).toBeNull();
      expect(await value('public.get_admin_access($1)',[untrusted])).toBeNull();
      expect((await db.query('select * from public.scrim_admin_accounts where user_id=$1',[target.id])).rows).toEqual(before);
      expect((await db.query('select * from public.scrims where id=$1',['reapplyown'])).rows).toEqual(room);
    } finally {
      await db.query('update auth.users set email=$1 where id=$2',['future-owner@example.test',fake]);
      await db.query('update auth.users set email=$1 where id=$2',['caio.oliveira2014@hotmail.com',owner]);
    }
  });
});
