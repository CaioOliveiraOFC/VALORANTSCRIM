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
it("publishes independent home streams only through the super admin and audits without changing room events", async () => {
  expect(await value("public.get_public_broadcasts()")).toEqual([]);
  await reject(saveSql, args(admin, null), "ADMIN_FORBIDDEN");
  const saved = await value(saveSql, args(owner, null));
  expect(saved).toMatchObject({
    roomId: null,
    version: 1,
    channels,
    enabled: true,
  });
  expect(await value("public.get_public_broadcasts()")).toEqual([saved]);
  expect(
    await value(
      "(select count(*)::integer from public.scrim_admin_audit where action='broadcast.update')",
    ),
  ).toBe(1);
  expect(
    await value("(select count(*)::integer from public.scrim_events)"),
  ).toBe(3);
});
it("keeps event streams in the event unless promotion is explicitly enabled", async () => {
  const saved = await value(saveSql, args());
  expect(
    await value("public.get_room_broadcast($1,null,null)", ["publicroom"]),
  ).toEqual(saved);
  expect(await value("public.get_public_broadcasts()")).toEqual([]);
  await value(saveSql, args(admin, "publicroom", 1, { promote: true }));
  expect(await value("public.get_public_broadcasts()")).toHaveLength(1);
  await db.query(
    "select * from public.manage_owned_scrim_access($1,$2,0,1,'hide',10)",
    ["publicroom", admin],
  );
  expect(await value("public.get_public_broadcasts()")).toEqual([]);
  await reject(
    "public.get_room_broadcast($1,null,null)",
    ["publicroom"],
    "SCRIM_DELETED",
  );
  expect(
    await value("public.get_room_broadcast($1,$2,0)", ["publicroom", admin]),
  ).toMatchObject({ channels });
});
it("blocks other admins, stale sessions, suspended accounts and missing room permissions in SQL", async () => {
  await reject(saveSql, args(other), "ADMIN_FORBIDDEN");
  await reject(
    "public.set_broadcast($1,1,$2,0,$3,$4,true,false)",
    [admin, "publicroom", "VCT", channels],
    "ADMIN_FORBIDDEN",
  );
  await db.exec("reset role");
  await db.query(
    "update public.scrim_admin_accounts set permissions = permissions || '{\"editRoom\":false}' where user_id=$1",
    [admin],
  );
  await db.exec("set local role service_role");
  await reject(saveSql, args(), "ADMIN_FORBIDDEN");
  await db.exec("reset role");
  await db.query(
    "update public.scrim_admin_accounts set active=false where user_id=$1",
    [admin],
  );
  await db.exec("set local role service_role");
  await reject(saveSql, args(), "ADMIN_FORBIDDEN");
});
it("keeps hidden/deleted events private and filters administrative lists by current room ownership", async () => {
  await value(saveSql, args());
  await value(saveSql, args(admin, "hiddenroom"));
  await value(saveSql, args(other, "otherroom"));
  await value(saveSql, args(owner, null));
  expect(
    await value("public.get_admin_broadcasts($1,0)", [admin]),
  ).toHaveLength(2);
  expect(
    await value("public.get_admin_broadcasts($1,0)", [owner]),
  ).toHaveLength(4);
  await reject(
    "public.get_room_broadcast($1,$2,0)",
    ["hiddenroom", other],
    "SCRIM_DELETED",
  );
  await db.query(
    "select * from public.manage_owned_scrim_access($1,$2,0,1,'delete',10)",
    ["publicroom", owner],
  );
  await reject(
    "public.get_room_broadcast($1,$2,0)",
    ["publicroom", admin],
    "SCRIM_DELETED",
  );
  await reject(saveSql, args(admin, "publicroom", 1), "SCRIM_DELETED");
});
it("requires public visibility and publication permission for home promotion", async () => {
  await reject(
    saveSql,
    args(admin, "hiddenroom", 0, { promote: true }),
    "ROOM_NOT_PUBLIC",
  );
  await db.exec("reset role");
  await db.query(
    "update public.scrim_admin_accounts set permissions = permissions || '{\"publishRooms\":false}' where user_id=$1",
    [admin],
  );
  await db.exec("set local role service_role");
  await reject(
    saveSql,
    args(admin, "publicroom", 0, { promote: true }),
    "ADMIN_FORBIDDEN",
  );
  expect(await value(saveSql, args())).toMatchObject({ version: 1 });
});
it("rejects concurrent stale writes instead of overwriting, and retains disabled configuration", async () => {
  const first = await value(saveSql, args());
  await reject(saveSql, args(), "STALE_BROADCAST");
  await value(saveSql, args(admin, "publicroom", 1, { enabled: false }));
  await reject(saveSql, args(admin, "publicroom", 1), "STALE_BROADCAST");
  expect(
    await value("public.get_room_broadcast($1,null,null)", ["publicroom"]),
  ).toBe(null);
  expect(await value("public.get_admin_broadcasts($1,0)", [admin])).toEqual([
    { ...first, enabled: false, version: 2 },
  ]);
});
it("rejects malformed payloads even from a privileged caller", async () => {
  for (const invalid of [
    [{ channel: "https://evil.test", label: "Bad" }],
    [channels[0], channels[0]],
    [{ channel: "masterpfi", label: "a", src: "https://evil.test" }],
    [],
    [{ channel: "videos", label: "Vídeos" }],
    { bad: true },
    Array(7).fill(channels[0]),
  ])
    await reject(
      saveSql,
      args(admin, "publicroom", 0, { channels: invalid }),
      "INVALID_BROADCAST",
    );
  expect(await value("public.get_admin_broadcasts($1,0)", [owner])).toEqual([]);
});
it("restricts RPCs and tables to server-controlled functions; no anonymous direct reads/writes", async () => {
  expect(
    await value(
      "has_function_privilege('anon','public.get_public_broadcasts()','EXECUTE')",
    ),
  ).toBe(false);
  expect(
    await value(
      "has_function_privilege('authenticated','public.set_broadcast(uuid,integer,text,integer,text,jsonb,boolean,boolean)','EXECUTE')",
    ),
  ).toBe(false);
  expect(
    await value(
      "has_table_privilege('service_role','public.scrim_broadcasts','UPDATE')",
    ),
  ).toBe(false);
  await db.exec("set local role anon");
  await expect(
    db.query("select * from public.scrim_broadcasts"),
  ).rejects.toThrow("permission denied");
});
