import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
let db: PGlite;
const owner = '11111111-1111-4111-8111-111111111111';
const admin = '22222222-2222-4222-8222-222222222222';
async function value(sql: string, args: unknown[] = []) { return (await db.query(`select ${sql} as value`, args)).rows[0]?.value as any; }
async function reject(sql: string, args: unknown[], message: string) {
  await db.exec('savepoint attempt');
  await expect(value(sql, args)).rejects.toThrow(message);
  await db.exec('rollback to savepoint attempt');
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create publication supabase_realtime; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,
      raw_app_meta_data jsonb not null default '{}',raw_user_meta_data jsonb not null default '{}',
      created_at timestamptz not null default clock_timestamp(),last_sign_in_at timestamptz);`);
  for (const file of ['20261016_scrims.sql', '20261017_match_imports.sql', '20261104_room_access.sql']) await db.exec(await readFile(new URL(file, import.meta.url), 'utf8'));
  await db.query(`insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
    ($1,'caio.oliveira2014@hotmail.com',clock_timestamp(),'{"scrim_admin":true}'),
    ($2,'admin@example.test',clock_timestamp(),'{"scrim_admin":true}')`, [owner, admin]);
  await db.exec(await readFile(new URL('20261105_super_admin.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('20261112_home_feature.sql', import.meta.url), 'utf8'));
  for (const [id, visible] of [['publicroom', true], ['hiddenroom', false]] as const) await value('public.create_owned_scrim($1,$2,$3,0,$4,$5,1,$6)', [id, 'a'.repeat(64), owner, { id, version: 1 }, { id, type: 'scrim.create', seq: 1, at: 1 }, visible]);
}, 30000);
beforeEach(async () => { await db.exec('begin; set local role service_role'); });
afterEach(async () => { await db.exec('rollback; reset role'); });
afterAll(async () => { await db.close(); });
it('pins and clears through the owner, with versioning and private audit', async () => {
  expect(await value('public.get_public_home_feature()')).toEqual({ roomId: null });
  expect(await value('public.set_home_feature($1,0,1,$2)', [owner, 'publicroom'])).toEqual({ roomId: 'publicroom', version: 2 });
  expect(await value('public.get_public_home_feature()')).toEqual({ roomId: 'publicroom' });
  expect(await value("(select count(*)::integer from public.scrim_admin_audit where action='home.feature')")).toBe(1);
  expect(await value('public.set_home_feature($1,0,2,null)', [owner])).toEqual({ roomId: null, version: 3 });
  expect(await value("(select count(*)::integer from public.scrim_events where scrim_id='publicroom')")).toBe(1);
});
it('rejects ordinary admins and a stale owner session even with a service caller', async () => {
  await reject('public.set_home_feature($1,0,1,$2)', [admin, 'publicroom'], 'ADMIN_FORBIDDEN');
  await reject('public.get_home_feature_admin($1,0)', [admin], 'ADMIN_FORBIDDEN');
  await reject('public.set_home_feature($1,1,1,$2)', [owner, 'publicroom'], 'ADMIN_FORBIDDEN');
  expect(await value('public.get_home_feature_admin($1,0)', [owner])).toEqual({ roomId: null, version: 1 });
});
it('rejects hidden, missing and stale selections without changing the previous choice', async () => {
  await reject('public.set_home_feature($1,0,1,$2)', [owner, 'hiddenroom'], 'ROOM_NOT_PUBLIC');
  await reject('public.set_home_feature($1,0,1,$2)', [owner, 'absentroom'], 'ROOM_NOT_PUBLIC');
  await value('public.set_home_feature($1,0,1,$2)', [owner, 'publicroom']);
  await reject('public.set_home_feature($1,0,1,null)', [owner], 'STALE_HOME_FEATURE');
  expect(await value('public.get_public_home_feature()')).toEqual({ roomId: 'publicroom' });
});
it('does not expose a pinned identifier after a room is hidden or removed', async () => {
  await value('public.set_home_feature($1,0,1,$2)', [owner, 'publicroom']);
  await db.query("select * from public.manage_owned_scrim_access($1,$2,0,1,'hide',10)", ['publicroom', owner]);
  expect(await value('public.get_public_home_feature()')).toEqual({ roomId: null });
  expect(await value('public.get_home_feature_admin($1,0)', [owner])).toEqual({ roomId: 'publicroom', version: 2 });
  await db.query("select * from public.manage_owned_scrim_access($1,$2,0,2,'delete',11)", ['publicroom', owner]);
  expect(await value('public.get_public_home_feature()')).toEqual({ roomId: null });
});
it('keeps settings private and gives only service_role access to the new RPCs', async () => {
  expect(await value("has_function_privilege('anon','public.get_public_home_feature()','EXECUTE')")).toBe(false);
  expect(await value("has_function_privilege('authenticated','public.set_home_feature(uuid,integer,integer,text)','EXECUTE')")).toBe(false);
  expect(await value("has_table_privilege('service_role','public.scrim_admin_settings','UPDATE')")).toBe(false);
  await db.exec('set local role anon');
  await expect(db.query('select * from public.scrim_admin_settings')).rejects.toThrow('permission denied');
});
