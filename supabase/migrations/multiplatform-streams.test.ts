import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111";
const admin = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const channels = [
  { channel: "masterpfi", label: "Master" },
  { channel: "riotgames", label: "Outra visão" },
];
async function value(sql: string, args: unknown[] = []) {
  return (await db.query(`select ${sql} as value`, args)).rows[0]?.value as any;
}
async function reject(sql: string, args: unknown[], message: string) {
  await db.exec("savepoint attempt");
  await expect(value(sql, args)).rejects.toThrow(message);
  await db.exec("rollback to savepoint attempt");
}
const saveSql = "public.set_broadcast($1,0,$2,$3,$4,$5,$6,$7)";
const args = (
  actor = admin,
  roomId: string | null = "publicroom",
  version = 0,
  extra: Partial<{
    channels: unknown;
    enabled: unknown;
    promote: unknown;
  }> = {},
) => [
  actor,
  roomId,
  version,
  "Brasa no ar",
  extra.channels ?? channels,
  extra.enabled ?? true,
  extra.promote ?? false,
];
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create publication supabase_realtime; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,
      raw_app_meta_data jsonb not null default '{}',raw_user_meta_data jsonb not null default '{}',
      created_at timestamptz not null default clock_timestamp(),last_sign_in_at timestamptz);`);
  for (const file of [
    "20261016_scrims.sql",
    "20261017_match_imports.sql",
    "20261104_room_access.sql",
  ])
    await db.exec(await readFile(new URL(file, import.meta.url), "utf8"));
  await db.query(
    `insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
    ($1,'caio.oliveira2014@hotmail.com',clock_timestamp(),'{"scrim_admin":true}'),
    ($2,'admin@example.test',clock_timestamp(),'{"scrim_admin":true}'),
    ($3,'other@example.test',clock_timestamp(),'{"scrim_admin":true}')`,
    [owner, admin, other],
  );
  await db.exec(
    await readFile(
      new URL("20261105_super_admin.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(new URL("20261113_streams.sql", import.meta.url), "utf8"),
  );
  await db.exec(await readFile(new URL('20261114_multiplatform_streams.sql', import.meta.url), 'utf8'));
  for (const [id, visible, actor] of [
    ["publicroom", true, admin],
    ["hiddenroom", false, admin],
    ["otherroom", true, other],
  ] as const)
    await value("public.create_owned_scrim($1,$2,$3,0,$4,$5,1,$6)", [
      id,
      "a".repeat(64),
      actor,
      { id, title: id, version: 1 },
      { id, type: "scrim.create", seq: 1, at: 1 },
      visible,
    ]);
}, 30000);
beforeEach(async () => {
  await db.exec("begin; set local role service_role");
});
afterEach(async () => {
  await db.exec("rollback; reset role");
});
afterAll(async () => {
  await db.close();
});
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const yt = { platform: 'youtube', kind: 'video', channel: 'aqz-KE-bpKQ', label: 'Replay' };
const add = (actor = admin, room: string | null = 'publicroom', isPublic = true, source: unknown = yt, recordingId = id) => value('public.create_stream_recording($1,$2,0,$3,$4,$5,$6)', [recordingId, actor, room, 'Replay de sexta', source, isPublic]);
const list = (actor: string | null = null, internal = false, offset = 0) => value('public.list_stream_recordings($1,0,$2,$3,null)', [actor, internal, offset]);
it('keeps legacy Twitch sources and accepts validated YouTube/Kick with separate provider identities', async () => {
  const mixed = [channels[0], { platform: 'youtube', channel: 'aqz-KE-bpKQ', label: 'YouTube' }, { platform: 'kick', channel: 'masterpfi', label: 'Kick' }];
  expect(await value(saveSql, args(admin, 'publicroom', 0, { channels: mixed }))).toMatchObject({ channels: mixed, version: 1 });
  expect(await value('public.get_stream_capabilities()')).toEqual({ multiplatform: true, recordings: true });
  for (const source of [{ platform: 'other', channel: 'masterpfi', label: 'Bad' }, { platform: 'youtube', channel: 'https://evil.test', label: 'Bad' }, { platform: 'kick', channel: '../bad', label: 'Bad' }, { platform: null, channel: 'masterpfi', label: 'Bad' }]) {
    await reject(saveSql, args(admin, 'publicroom', 1, { channels: [source] }), 'INVALID_BROADCAST');
  }
});
it('requires a fixed replay URL identity, keeps it after live configuration changes and audits', async () => {
  await reject('public.create_stream_recording($1,$2,0,$3,$4,$5,true)', [id, admin, 'publicroom', 'Replay', { channel: 'masterpfi', label: 'Canal' }], 'INVALID_RECORDING');
  const recording = await add();
  expect(recording).toMatchObject({ id, roomId: 'publicroom', source: yt, isPublic: true, version: 1 });
  await value(saveSql, args());
  await value(saveSql, args(admin, 'publicroom', 1, { channels: [{ channel: 'riotgames', label: 'Outro' }], enabled: false }));
  expect((await list()).recordings).toEqual([recording]);
  expect(await value("(select count(*)::integer from public.scrim_admin_audit where action='recording.create')")).toBe(1);
});
it('does not expose replays of hidden/deleted rooms and preserves their history for administrators', async () => {
  await add();
  await db.query("select * from public.manage_owned_scrim_access($1,$2,0,1,'hide',10)", ['publicroom', admin]);
  expect((await list()).recordings).toEqual([]);
  await reject('public.get_stream_recording($1,null,null)', [id], 'RECORDING_NOT_FOUND');
  expect((await list(admin, true)).recordings).toHaveLength(1);
  await db.query("select * from public.manage_owned_scrim_access($1,$2,0,2,'delete',11)", ['publicroom', owner]);
  expect((await list(owner, true)).recordings).toHaveLength(1);
  expect((await list()).recordings).toEqual([]);
});
it('restricts creation/visibility to current owners, permissions and session versions', async () => {
  await reject('public.create_stream_recording($1,$2,0,$3,$4,$5,true)', [id, other, 'publicroom', 'Replay', yt], 'ADMIN_FORBIDDEN');
  await reject('public.create_stream_recording($1,$2,0,null,$3,$4,true)', [id, admin, 'Replay', yt], 'ADMIN_FORBIDDEN');
  await add();
  await reject('public.manage_stream_recording($1,$2,0,1,false)', [id, other], 'ADMIN_FORBIDDEN');
  await reject('public.manage_stream_recording($1,$2,1,1,false)', [id, admin], 'ADMIN_FORBIDDEN');
  await db.exec('reset role'); await db.query("update public.scrim_admin_accounts set permissions=permissions || '{\"publishRooms\":false}' where user_id=$1", [admin]); await db.exec('set local role service_role');
  await value('public.manage_stream_recording($1,$2,0,1,false)', [id, admin]);
  await reject('public.manage_stream_recording($1,$2,0,2,true)', [id, admin], 'ADMIN_FORBIDDEN');
});
it('deduplicates replays and rejects stale visibility changes without deleting entries', async () => {
  await add();
  await reject('public.create_stream_recording($1,$2,0,$3,$4,$5,true)', ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', admin, 'publicroom', 'Same replay', yt], 'DUPLICATE_RECORDING');
  await value('public.manage_stream_recording($1,$2,0,1,false)', [id, admin]);
  await reject('public.manage_stream_recording($1,$2,0,1,true)', [id, admin], 'STALE_RECORDING');
  expect((await list()).total).toBe(0); expect((await list(admin, true)).total).toBe(1);
});
it('paginates the permanent archive and keeps provider-specific replay IDs', async () => {
  for (let i = 0; i < 25; i++) await add(admin, 'publicroom', true, { platform: 'twitch', kind: 'video', channel: String(1000+i), label: 'Twitch replay' }, `${String(i).padStart(8,'0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`);
  const first = await list(); expect(first.recordings).toHaveLength(24); expect(first.nextOffset).toBe(24);
  const second = await list(null, false, first.nextOffset); expect(second.recordings).toHaveLength(1); expect(second.nextOffset).toBe(null);
  expect(new Set([...first.recordings,...second.recordings].map(r=>r.id)).size).toBe(25);
});
it('permits only the server RPC boundary, with RLS and private audit intact', async () => {
  expect(await value("has_function_privilege('anon','public.list_stream_recordings(uuid,integer,boolean,integer,text)','EXECUTE')")).toBe(false);
  expect(await value("has_function_privilege('authenticated','public.create_stream_recording(uuid,uuid,integer,text,text,jsonb,boolean)','EXECUTE')")).toBe(false);
  expect(await value("has_table_privilege('service_role','public.scrim_stream_recordings','SELECT')")).toBe(false);
  await db.exec('set local role anon');
  await expect(db.query('select * from public.scrim_stream_recordings')).rejects.toThrow('permission denied');
});
