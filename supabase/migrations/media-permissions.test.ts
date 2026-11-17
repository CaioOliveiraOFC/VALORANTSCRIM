import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { noPermissions, presetPermissions } from '../../src/shared/adminPermissions.js';

let db: PGlite;
const owner = '11111111-1111-4111-8111-111111111111';
const admin = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const pending = '44444444-4444-4444-8444-444444444444';
const malformed = '55555555-5555-4555-8555-555555555555';
const recordingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherRecordingId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const freshRecordingId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const channels = [{ channel: 'masterpfi', label: 'Master' }];
const source = { platform: 'youtube', kind: 'video', channel: 'aqz-KE-bpKQ', label: 'Replay' };
const migration = await readFile(new URL('20261116_media_permissions.sql', import.meta.url), 'utf8');
let beforeAccounts: any[], afterAccounts: any[], beforeHistory: any, afterHistory: any;
let beforePending: any, afterPending: any, afterMalformed: any, rerunBefore: any, rerunAfter: any;

async function value(sql: string, args: unknown[] = []) {
  return (await db.query(`select ${sql} as value`, args)).rows[0]?.value as any;
}
async function reject(sql: string, args: unknown[], error: string) {
  await db.exec('savepoint denied');
  await expect(value(sql, args)).rejects.toThrow(error);
  await db.exec('rollback to savepoint denied');
}
async function policy(patch: Record<string, boolean>, actor = admin) {
  const before = await value('public.scrim_admin_account_dto($1)', [actor]);
  return value('public.update_admin_account($1,$2,$3,$4,$5,$6)', [
    owner, actor, before.version, before.displayName, before.preset, { ...before.permissions, ...patch },
  ]);
}
const list = (actor: string | null = admin, room: string | null = null, session: number | null = 0) =>
  value('public.list_stream_recordings($1,$2,true,0,$3)', [actor, session, room]);
const saveSql = 'public.set_broadcast($1,0,$2,$3,$4,$5,$6,$7)';
const saveArgs = (actor = admin, room: string | null = 'hiddenroom', version = 1, enabled = true, promote = false) =>
  [actor, room, version, 'Live do evento', channels, enabled, promote];
const createSql = 'public.create_stream_recording($1,$2,0,$3,$4,$5,$6)';
const createArgs = (actor = admin, room: string | null = 'publicroom', isPublic = false) =>
  [freshRecordingId, actor, room, 'Replay novo', source, isPublic];
const visibilitySql = 'public.manage_stream_recording($1,$2,0,$3,$4)';
async function history() {
  return value(`jsonb_build_object(
    'scrims',(select jsonb_agg(to_jsonb(s) order by id) from public.scrims s),
    'events',(select jsonb_agg(to_jsonb(e) order by scrim_id,seq) from public.scrim_events e),
    'broadcasts',(select jsonb_agg(to_jsonb(b) order by scope) from public.scrim_broadcasts b),
    'recordings',(select jsonb_agg(to_jsonb(r) order by id) from public.scrim_stream_recordings r),
    'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.scrim_admin_audit a)
  )`);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create publication supabase_realtime; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,
      raw_app_meta_data jsonb not null default '{}',raw_user_meta_data jsonb not null default '{}',
      created_at timestamptz not null default clock_timestamp(),last_sign_in_at timestamptz);`);
  for (const file of ['20261016_scrims.sql', '20261017_match_imports.sql', '20261104_room_access.sql'])
    await db.exec(await readFile(new URL(file, import.meta.url), 'utf8'));
  await db.query(`insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
    ($1,'caio.oliveira2014@hotmail.com',clock_timestamp(),'{"scrim_admin":true}'),
    ($2,'admin@example.test',clock_timestamp(),'{"scrim_admin":true}'),
    ($3,'other@example.test',clock_timestamp(),'{"scrim_admin":true}')`, [owner, admin, other]);
  for (const file of ['20261105_super_admin.sql', '20261113_streams.sql', '20261114_multiplatform_streams.sql'])
    await db.exec(await readFile(new URL(file, import.meta.url), 'utf8'));
  await db.query(`update public.scrim_admin_accounts set permissions=permissions || '{"manageTeams":false,"manageNotes":false}' where user_id=$1`, [admin]);
  const oldPermissions = await value("public.scrim_admin_preset_permissions('full') || '{\"editRoom\":false,\"manageVeto\":false}'::jsonb");
  beforePending = { scrim_console_managed: true, scrim_console_display_name: 'Pendente',
    scrim_console_preset: 'full', scrim_console_permissions: oldPermissions, unrelated: 'preserve' };
  await db.query(`insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
    ($1,'pending@example.test',clock_timestamp(),$2),
    ($3,'malformed@example.test',clock_timestamp(),'{"scrim_console_managed":true,"scrim_console_permissions":[]}')`,
  [pending, beforePending, malformed]);
  for (const [id, visible, actor] of [['publicroom', true, admin], ['hiddenroom', false, admin], ['otherroom', false, other]] as const)
    await value('public.create_owned_scrim($1,$2,$3,0,$4,$5,1,$6)', [id, 'a'.repeat(64), actor,
      { id, title: id, version: 1, phase: 'paused', players: [{ id: 'p1', name: 'Preservado' }], score: [1, 1] },
      { id, type: 'scrim.create', seq: 1, at: 1 }, visible]);
  for (const room of ['hiddenroom', 'otherroom']) await value(saveSql, saveArgs(owner, room, 0, false));
  await value(createSql, [recordingId, owner, 'hiddenroom', 'Replay privado', source, false]);
  await value(createSql, [otherRecordingId, owner, 'otherroom', 'Replay alheio', source, false]);
  beforeAccounts = (await db.query('select user_id,permissions,version,session_version,preset from public.scrim_admin_accounts order by user_id')).rows;
  beforeHistory = await history();
  await db.exec(migration);
  afterHistory = await history();
  afterAccounts = (await db.query('select user_id,permissions,version,session_version,preset from public.scrim_admin_accounts order by user_id')).rows;
  afterPending = await value('(select raw_app_meta_data from auth.users where id=$1)', [pending]);
  afterMalformed = await value('(select raw_app_meta_data from auth.users where id=$1)', [malformed]);
  // Rerunning an already applied upgrade must retain a later explicit grant.
  await db.query(`update public.scrim_admin_accounts set permissions=permissions || '{"manageStreams":true}' where user_id=$1`, [admin]);
  rerunBefore = (await db.query('select user_id,permissions,version,session_version from public.scrim_admin_accounts order by user_id')).rows;
  await db.exec(migration);
  rerunAfter = (await db.query('select user_id,permissions,version,session_version from public.scrim_admin_accounts order by user_id')).rows;
  await db.query(`update public.scrim_admin_accounts set permissions=permissions || '{"manageStreams":false}' where user_id=$1`, [admin]);
}, 30000);
beforeEach(async () => { await db.exec('begin; set local role service_role'); });
afterEach(async () => { await db.exec('rollback; reset role'); });
afterAll(async () => { await db.close(); });

it('upgrades existing accounts to opt-in media editing without changing their eleven policies or sessions', () => {
  expect(afterAccounts).toHaveLength(beforeAccounts.length);
  for (const [index, before] of beforeAccounts.entries()) {
    expect(afterAccounts[index]).toEqual({ ...before, permissions: { ...before.permissions, manageStreams: false }, version: before.version + 1 });
  }
  expect(afterHistory).toEqual(beforeHistory);
  expect(rerunAfter).toEqual(rerunBefore);
  expect(rerunAfter.find(item => item.user_id === admin).permissions.manageStreams).toBe(true);
});

it('preserves legitimate pending account metadata and custom flags without reinterpreting malformed policies', async () => {
  expect(afterPending).toEqual({ ...beforePending,
    scrim_console_permissions: { ...beforePending.scrim_console_permissions, manageStreams: false } });
  const dto = await value('public.scrim_admin_account_dto($1)', [pending]);
  expect(dto).toMatchObject({ provisioned: false, active: false, preset: 'full', permissions: afterPending.scrim_console_permissions });
  expect(afterMalformed).toEqual({ scrim_console_managed: true, scrim_console_permissions: [] });
});

it('validates twelve boolean capabilities and keeps organizer opt-in while explicit full includes media', async () => {
  expect(await value("public.scrim_admin_preset_permissions('organizer')")).toEqual(presetPermissions('organizer'));
  expect(await value("public.scrim_admin_preset_permissions('full')")).toEqual(presetPermissions('full'));
  for (const invalid of [beforeAccounts[0].permissions, { ...noPermissions(), manageStreams: 'true' },
    { ...noPermissions(), accessAll: true }, null, [], 'all'])
    expect(await value('public.scrim_admin_valid_permissions($1)', [JSON.stringify(invalid)])).toBe(false);
  expect(await value('public.scrim_admin_valid_permissions($1)', [noPermissions()])).toBe(true);
  expect(await value('public.get_stream_capabilities()')).toEqual({ multiplatform: true, recordings: true, mediaPermissions: true });
});

it('lets an administrator without any edit capability consult only their own hidden configurations and replays', async () => {
  await policy({ editRoom: false, manageStreams: false });
  expect(await value('public.get_admin_broadcasts($1,0)', [admin])).toMatchObject([{ roomId: 'hiddenroom', enabled: false }]);
  const page = await list();
  expect(page.total).toBe(1);
  expect(page.recordings[0]).toMatchObject({ id: recordingId, roomId: 'hiddenroom', isPublic: false });
  expect((await list(admin, 'otherroom')).recordings).toEqual([]);
  expect((await value('public.get_stream_recording($1,$2,0)', [recordingId, admin])).id).toBe(recordingId);
  await reject('public.get_stream_recording($1,$2,0)', [otherRecordingId, admin], 'RECORDING_NOT_FOUND');
  await reject('public.get_room_broadcast($1,$2,0)', ['otherroom', admin], 'SCRIM_DELETED');
  expect((await list(owner)).total).toBe(2);
  expect((await value('public.get_admin_broadcasts($1,0)', [owner])).length).toBe(2);
});

it('does not let editRoom alone configure, create or change visibility of media', async () => {
  await policy({ editRoom: true, manageStreams: false });
  await reject(saveSql, saveArgs(), 'ADMIN_FORBIDDEN');
  await reject(createSql, createArgs(), 'ADMIN_FORBIDDEN');
  await reject(visibilitySql, [recordingId, admin, 1, true], 'ADMIN_FORBIDDEN');
  expect((await list()).recordings).toHaveLength(1);
});

it('applies grants and revocations immediately, independently of room editing', async () => {
  const before = await value('public.scrim_admin_account_dto($1)', [admin]);
  await policy({ editRoom: false, manageStreams: true });
  await reject('public.update_admin_account($1,$2,$3,$4,$5,$6)', [owner, admin, before.version, before.displayName, before.preset, before.permissions], 'STALE_ADMIN_VERSION');
  expect(await value(saveSql, saveArgs())).toMatchObject({ roomId: 'hiddenroom', version: 2, enabled: true });
  expect(await value(createSql, createArgs())).toMatchObject({ id: freshRecordingId, isPublic: false });
  expect(await value(visibilitySql, [freshRecordingId, admin, 1, true])).toMatchObject({ version: 2, isPublic: true });
  await policy({ manageStreams: false });
  await reject(saveSql, saveArgs(admin, 'hiddenroom', 2), 'ADMIN_FORBIDDEN');
  await reject(visibilitySql, [freshRecordingId, admin, 2, false], 'ADMIN_FORBIDDEN');
  expect((await list()).total).toBe(2);
});

it('retains super-only independent media, owner scope, publication permission and concurrency guards', async () => {
  await policy({ manageStreams: true });
  await reject(saveSql, saveArgs(admin, null, 0), 'ADMIN_FORBIDDEN');
  await reject(createSql, createArgs(admin, null), 'ADMIN_FORBIDDEN');
  await reject(saveSql, saveArgs(admin, 'otherroom'), 'ADMIN_FORBIDDEN');
  await reject(visibilitySql, [otherRecordingId, admin, 1, false], 'ADMIN_FORBIDDEN');
  await policy({ publishRooms: false });
  await reject(saveSql, saveArgs(admin, 'publicroom', 0, true, true), 'ADMIN_FORBIDDEN');
  await reject(createSql, createArgs(admin, 'publicroom', true), 'ADMIN_FORBIDDEN');
  await value(createSql, createArgs());
  await reject(visibilitySql, [freshRecordingId, admin, 1, true], 'ADMIN_FORBIDDEN');
  await value(visibilitySql, [freshRecordingId, admin, 1, false]);
  await reject(visibilitySql, [freshRecordingId, admin, 1, false], 'STALE_RECORDING');
  await reject(saveSql, saveArgs(admin, 'hiddenroom', 0), 'STALE_BROADCAST');
  expect(await value(saveSql, saveArgs(owner, null, 0))).toMatchObject({ roomId: null, enabled: true });
});

it('rejects missing or stale sessions and suspended administrators while leaving public reads available', async () => {
  await reject('public.get_admin_broadcasts($1,$2)', [admin, null], 'INVALID_ADMIN_INPUT');
  await reject('public.get_admin_broadcasts($1,0)', [null], 'INVALID_ADMIN_INPUT');
  await reject('public.get_admin_broadcasts($1,9)', [admin], 'ADMIN_FORBIDDEN');
  await reject('public.list_stream_recordings($1,$2,true,0,null)', [admin, null], 'INVALID_ADMIN_INPUT');
  await reject('public.list_stream_recordings($1,9,true,0,null)', [admin], 'ADMIN_FORBIDDEN');
  await db.exec('reset role');
  await db.query('update public.scrim_admin_accounts set active=false where user_id=$1', [admin]);
  await db.exec('set local role service_role');
  await reject('public.get_admin_broadcasts($1,0)', [admin], 'ADMIN_FORBIDDEN');
  await reject('public.list_stream_recordings($1,0,true,0,null)', [admin], 'ADMIN_FORBIDDEN');
  expect((await value('public.list_stream_recordings(null,null,false,0,null)')).recordings).toEqual([]);
});

it('keeps tables and RPCs private to the server with RLS still enabled', async () => {
  for (const table of ['scrim_broadcasts', 'scrim_stream_recordings']) {
    expect(await value("has_table_privilege('service_role',$1,'SELECT')", [`public.${table}`])).toBe(false);
    expect(await value('(select relrowsecurity from pg_class where oid=$1::regclass)', [`public.${table}`])).toBe(true);
  }
  for (const signature of [
    'public.get_admin_broadcasts(uuid,integer)', 'public.list_stream_recordings(uuid,integer,boolean,integer,text)',
    'public.set_broadcast(uuid,integer,text,integer,text,jsonb,boolean,boolean)',
    'public.create_stream_recording(uuid,uuid,integer,text,text,jsonb,boolean)',
    'public.manage_stream_recording(uuid,uuid,integer,integer,boolean)',
  ]) {
    for (const role of ['anon', 'authenticated'])
      expect(await value('has_function_privilege($1,$2,\'EXECUTE\')', [role, signature])).toBe(false);
    expect(await value("has_function_privilege('service_role',$1,'EXECUTE')", [signature])).toBe(true);
  }
});
