/** LOCAL VIDEO FIXTURE ONLY. Real app/API/SQL, in-memory database and dummy providers.
 * Never deploy this process. Test credentials are fictional and confined to this fixture. */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { WebSocketServer, WebSocket } from 'ws';
import api from '../../../api/index.ts';
import { initialState, applyEvent } from '../../../src/shared/scrim.ts';
import { presetPermissions } from '../../../src/shared/adminPermissions.ts';
import {
  readyScrim,
  sampleMatch,
  sampleLinks,
  rawMatch,
} from '../../../src/test/import-fixture.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PORT = Number(process.env.PILOT_PORT ?? 4203);
const DIST = process.env.PILOT_DIST ?? path.join(ROOT, 'dist');
const PROVIDER = 'https://super-admin.local-test';
process.env.SUPABASE_URL = PROVIDER;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-server-test-key';
process.env.HENRIK_API_KEY = 'local-henrik-test-key';
const OWNER = '11111111-1111-4111-8111-111111111111';
const ADMIN_A = '22222222-2222-4222-8222-222222222222';
const ADMIN_B = '33333333-3333-4333-8333-333333333333';
const VIEWER = '44444444-4444-4444-8444-444444444444';
type Identity = {
  id: string;
  email: string;
  email_confirmed_at: string;
  app_metadata: Record<string, any>;
  user_metadata: Record<string, any>;
};
const identities = new Map<string, Identity>(),
  passwords = new Map<string, string>();
const accessTokens = new Map<string, { userId: string; sessionId: string; expired?: boolean }>();
const refreshTokens = new Map<string, { userId: string; sessionId: string }>();
const sockets = new Map<WebSocket, string>();
const presences = new Map<WebSocket, { role: string; phx_ref: string }>();
function announcePresence(topic: string) {
  const payload = Object.fromEntries(
    [...sockets]
      .filter(([socket, t]) => t === topic && presences.has(socket))
      .map(([socket]) => [presences.get(socket)!.phx_ref, { metas: [presences.get(socket)!] }]),
  );
  for (const [socket, t] of sockets)
    if (t === topic && socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ topic, event: 'presence_state', payload }));
}
let db: PGlite,
  queue: Promise<unknown> = Promise.resolve(),
  failRegistration = false;
let rpcCount = 0,
  authCreateCount = 0,
  authPasswordCount = 0,
  authPasswordRequestCount = 0,
  blockedOutbound = 0,
  wsDenied = 0;
let pauseLogin = false,
  pausePasswordUpdate = false,
  failPasswordResponseOnce = false;
const loginWaiters: (() => void)[] = [],
  passwordUpdateWaiters: (() => void)[] = [];
function release(waiters: (() => void)[]) {
  for (const resume of waiters.splice(0)) resume();
}
const rpcNames = new Set<string>();
const procedures = new Map<
  string,
  { names: string[]; types: string[]; set: boolean; type: string }
>();
function database<T>(fn: () => Promise<T>, privileged = false): Promise<T> {
  const operation = queue.then(async () => {
    await db.exec(privileged ? 'reset role' : 'set role service_role');
    return fn();
  });
  queue = operation.catch(() => undefined);
  return operation;
}
async function sqlValue(sql: string, args: unknown[] = []) {
  return (await db.query(`select ${sql} as value`, args)).rows[0]?.value as any;
}
const response = (value: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
function issue(userId: string, sessionId = randomUUID()) {
  const access = `local-access-${randomUUID()}`,
    refresh = `local-refresh-${randomUUID()}`;
  accessTokens.set(access, { userId, sessionId });
  refreshTokens.set(refresh, { userId, sessionId });
  return { access_token: access, refresh_token: refresh, expires_in: 3600 };
}
async function identity(
  id: string,
  email: string,
  metadata: Record<string, any>,
  password = 'local-test-password',
) {
  const user: Identity = {
    id,
    email,
    email_confirmed_at: new Date().toISOString(),
    app_metadata: metadata,
    user_metadata: {},
  };
  identities.set(id, user);
  passwords.set(id, password);
  await db.query(
    `insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values($1,$2,$3,$4,$5)`,
    [id, email, user.email_confirmed_at, metadata, {}],
  );
  return user;
}
async function seedRoom(
  id: string,
  owner: string,
  isPublic: boolean,
  title: string,
  imported = false,
) {
  const fixture = readyScrim();
  let state = initialState();
  const log = fixture.events.map((event, i) => ({
    ...event,
    at: Date.now() - 1_800_000 + i * 1000,
    ...(i === 0 ? { id, title } : {}),
  }));
  const key = createHash('sha256').update('local-room-key').digest('hex');
  for (const event of log) {
    state = applyEvent(state, event);
    if (event.seq === 1)
      await db.query(`select public.create_owned_scrim($1,$2,$3,0,$4,$5,$6,$7)`, [
        id,
        key,
        owner,
        state,
        event,
        event.at,
        isPublic,
      ]);
    else
      await db.query(
        `select public.append_owned_scrim_event($1,$2,0,$3,1,$4,$5,array['manageTeams'])`,
        [id, owner, event.seq - 1, state, event],
      );
  }
  if (imported) {
    const event = {
      type: 'match.import',
      seq: state.version + 1,
      at: Date.now(),
      match: sampleMatch(),
      mapIndex: 0,
      redTeam: 'A',
      links: sampleLinks(),
    };
    state = applyEvent(state, event as any);
    await db.query(`select public.import_owned_match($1,$2,0,$3,1,$4,$5,$6)`, [
      id,
      owner,
      event.seq - 1,
      state,
      event,
      rawMatch(),
    ]);
  }
}
async function reset() {
  if (db) await db.close();
  db = new PGlite();
  identities.clear();
  passwords.clear();
  accessTokens.clear();
  refreshTokens.clear();
  procedures.clear();
  failRegistration = false;
  rpcCount =
    authCreateCount =
    authPasswordCount =
    authPasswordRequestCount =
    blockedOutbound =
    wsDenied =
      0;
  rpcNames.clear();
  pauseLogin = pausePasswordUpdate = failPasswordResponseOnce = false;
  release(loginWaiters);
  release(passwordUpdateWaiters);
  for (const socket of sockets.keys()) socket.close();
  sockets.clear();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create publication supabase_realtime; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,
      raw_app_meta_data jsonb not null default '{}',raw_user_meta_data jsonb not null default '{}',
      created_at timestamptz not null default clock_timestamp(),last_sign_in_at timestamptz);`);
  for (const name of [
    '20261016_scrims.sql',
    '20261017_match_imports.sql',
    '20261104_room_access.sql',
  ])
    await db.exec(await readFile(path.join(ROOT, 'supabase/migrations', name), 'utf8'));
  await identity(OWNER, 'caio.oliveira2014@hotmail.com', { scrim_admin: true });
  await identity(ADMIN_A, 'organizador@brasa.example', { scrim_admin: true });
  await identity(ADMIN_B, 'admin-b@example.test', { scrim_admin: true, scrim_delete_rooms: true });
  await identity(VIEWER, 'viewer@example.test', {});
  await db.exec(
    await readFile(path.join(ROOT, 'supabase/migrations/20261105_super_admin.sql'), 'utf8'),
  );
  await db.exec(
    await readFile(path.join(ROOT, 'supabase/migrations/20261112_home_feature.sql'), 'utf8'),
  );
  // The pilot starts without rooms; every new room is created through the real UI.
  await db.exec('set role service_role');
}
async function procedure(name: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('Invalid RPC name');
  if (!procedures.has(name)) {
    const result = await db.query(
      `select p.proargnames[1:p.pronargs] as names,
      array(select format_type(t,null) from unnest(p.proargtypes::oid[]) with ordinality as a(t,n) order by n) as types,
      p.proretset as "set",format_type(p.prorettype,null) as type
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`,
      [name],
    );
    if (result.rows.length !== 1)
      throw Object.assign(new Error('Unknown or ambiguous RPC'), { code: 'PGRST202' });
    procedures.set(name, result.rows[0] as any);
  }
  return procedures.get(name)!;
}
async function invoke(name: string, body: Record<string, unknown>) {
  return database(async () => {
    rpcCount++;
    rpcNames.add(name);
    if (name === 'register_admin_account' && failRegistration) {
      failRegistration = false;
      throw Object.assign(new Error('LOCAL_INJECTED_SQL_FAILURE'), { code: 'XX000' });
    }
    const info = await procedure(name),
      args: unknown[] = [];
    const parts = Object.keys(body).map((key) => {
      const index = info.names.indexOf(key);
      if (index < 0) throw new Error(`Unknown RPC parameter ${key}`);
      args.push(body[key]);
      return `${key} => $${args.length}::${info.types[index]}`;
    });
    const call = `public.${name}(${parts.join(',')})`;
    const result = await db.query(
      info.set ? `select * from ${call}` : `select ${call} as value`,
      args,
    );
    return {
      value: info.set ? result.rows : result.rows[0]?.value,
      status: info.type === 'void' ? 204 : 200,
    };
  });
}
const tableColumns: Record<string, Set<string>> = {
  scrims: new Set([
    'id',
    'admin_key_hash',
    'state',
    'version',
    'created_at',
    'updated_at',
    'is_public',
    'deleted_at',
    'access_version',
    'owner_user_id',
    'created_by_user_id',
  ]),
  scrim_events: new Set(['scrim_id', 'seq', 'at', 'event']),
};
async function table(name: string, query: URLSearchParams) {
  const columns = tableColumns[name];
  if (!columns) throw new Error('Unexpected REST table');
  const selected = (query.get('select') ?? '*').split(',');
  if (selected.some((column) => !columns.has(column)))
    throw new Error('Unapproved REST projection');
  const args: unknown[] = [],
    clauses: string[] = [];
  let order = '',
    limit = '';
  for (const [key, value] of query) {
    if (key === 'select') continue;
    if (key === 'order') {
      const [column, direction] = value.split('.');
      if (!columns.has(column) || !['asc', 'desc'].includes(direction))
        throw new Error('Invalid order');
      order = `order by ${column} ${direction}`;
      continue;
    }
    if (key === 'limit') {
      if (!/^\d{1,4}$/.test(value)) throw new Error('Invalid limit');
      args.push(Number(value));
      limit = `limit $${args.length}`;
      continue;
    }
    if (!columns.has(key)) throw new Error('Unapproved REST filter');
    if (value === 'is.null' || value === 'not.is.null') {
      clauses.push(`${key} is ${value.startsWith('not.') ? 'not ' : ''}null`);
      continue;
    }
    const match = /^(eq|gt|lte)\.(.*)$/.exec(value);
    if (!match) throw new Error('Unsupported REST predicate');
    args.push(match[2]);
    clauses.push(`${key} ${{ eq: '=', gt: '>', lte: '<=' }[match[1]]} $${args.length}`);
  }
  return database(
    async () =>
      (
        await db.query(
          `select ${selected.join(',')} from public.${name} ${clauses.length ? 'where ' + clauses.join(' and ') : ''} ${order} ${limit}`,
          args,
        )
      ).rows,
  );
}
async function publish(id: string, event: unknown) {
  const visible = await database(() => sqlValue('public.scrim_is_public($1)', [id]));
  if (!visible) return;
  for (const [socket, topic] of sockets)
    if (topic === `realtime:scrim-${id}` && socket.readyState === WebSocket.OPEN)
      socket.send(
        JSON.stringify({
          topic,
          event: 'postgres_changes',
          payload: { data: { record: { event } } },
        }),
      );
}
globalThis.fetch = async (input: any, options: any = {}) => {
  const target = new URL(String(input)),
    body = options.body ? JSON.parse(options.body) : {};
  if (target.hostname === 'api.henrikdev.xyz')
    return response({ data: target.pathname.includes('/matches/') ? [rawMatch()] : rawMatch() });
  if (target.origin !== PROVIDER) {
    blockedOutbound++;
    throw new Error(`Outbound network blocked by local harness (${target.hostname})`);
  }
  if (target.pathname.startsWith('/auth/v1/')) {
    if (target.pathname === '/auth/v1/admin/users' && options.method === 'POST') {
      if ([...identities.values()].some((user) => user.email === body.email))
        return response({ code: 'email_exists' }, 422);
      if (body.email_confirm !== true) throw new Error('Console did not auto-confirm identity');
      const user = await database(
        () => identity(randomUUID(), body.email, body.app_metadata ?? {}, body.password),
        true,
      );
      authCreateCount++;
      return response({ user }, 201);
    }
    if (target.pathname.startsWith('/auth/v1/admin/users/') && options.method === 'PUT') {
      const id = target.pathname.split('/').pop()!;
      if (!identities.has(id)) return response({}, 404);
      authPasswordRequestCount++;
      if (pausePasswordUpdate)
        await new Promise<void>((resolve) => passwordUpdateWaiters.push(resolve));
      passwords.set(id, body.password);
      authPasswordCount++;
      // Deliberately retain provider sessions: canonical app epoch must reject old cookies.
      if (failPasswordResponseOnce) {
        failPasswordResponseOnce = false;
        throw new Error('Local provider response lost after successful password update');
      }
      return response({ user: identities.get(id) });
    }
    if (target.pathname === '/auth/v1/token') {
      if (target.searchParams.get('grant_type') === 'password') {
        const user = [...identities.values()].find((user) => user.email === body.email);
        if (!user || passwords.get(user.id) !== body.password)
          return response({ error: 'invalid_credentials' }, 400);
        // The old password has already been accepted; release after a concurrent reset.
        if (pauseLogin) await new Promise<void>((resolve) => loginWaiters.push(resolve));
        return response(issue(user.id));
      }
      const session = refreshTokens.get(body.refresh_token);
      if (!session) return response({ error: 'invalid_refresh' }, 400);
      refreshTokens.delete(body.refresh_token);
      return response(issue(session.userId, session.sessionId));
    }
    const token = new Headers(options.headers).get('authorization')?.replace('Bearer ', ''),
      info = accessTokens.get(token ?? '');
    if (target.pathname === '/auth/v1/user')
      return !info || info.expired
        ? response({ error: 'invalid_token' }, 401)
        : response(identities.get(info.userId));
    if (target.pathname === '/auth/v1/logout') {
      if (!info) return response({}, 401);
      // Do not revoke in the provider fixture; test the signed generation DB guard independently.
      return response(null, 204);
    }
    throw new Error(`Unexpected Auth endpoint ${target.pathname}`);
  }
  if (target.pathname.startsWith('/rest/v1/rpc/')) {
    try {
      const name = target.pathname.split('/').pop()!,
        result = await invoke(name, body);
      if (['append_owned_scrim_event', 'import_owned_match'].includes(name))
        await publish(body.p_id, body.p_event);
      return response(result.value, result.status);
    } catch (error: any) {
      return response({ message: error.message, code: error.code ?? 'XX000' }, 400);
    }
  }
  if (target.pathname.startsWith('/rest/v1/'))
    return response(await table(target.pathname.replace('/rest/v1/', ''), target.searchParams));
  throw new Error(`Unexpected mock provider route ${target.pathname}`);
};

async function main() {
  await reset();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, 'http://127.0.0.1:' + PORT);
      const json = (value: unknown) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(value));
      };
      if (url.pathname === '/__test__/reset') {
        await queue;
        await reset();
        res.end('ok');
        return;
      }
      if (url.pathname === '/__test__/state') {
        const id = url.searchParams.get('id') ?? 'ownerpub';
        json(
          await database(async () => ({
            row: (await db.query('select * from public.scrims where id=$1', [id])).rows[0],
            events: (
              await db.query(
                'select event from public.scrim_events where scrim_id=$1 order by seq',
                [id],
              )
            ).rows.map((row) => row.event),
          })),
        );
        return;
      }
      if (url.pathname === '/__test__/stats') {
        json({
          rpcCount,
          rpcNames: [...rpcNames].sort(),
          authCreateCount,
          authPasswordCount,
          authPasswordRequestCount,
          blockedOutbound,
          wsDenied,
          db: await database(
            async () => ({
              accounts: (
                await db.query('select count(*)::int as n from public.scrim_admin_accounts')
              ).rows[0]?.n,
              audit: (
                await db.query(
                  'select action,status,count(*)::int as n from public.scrim_admin_audit group by action,status order by action,status',
                )
              ).rows,
            }),
            true,
          ),
        });
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        await api(req, res);
        return;
      }
      const relative =
        url.pathname.startsWith('/assets/') ||
        url.pathname.startsWith('/brand/') ||
        ['/guia-admin.html', '/guia-admin.pdf'].includes(url.pathname)
          ? url.pathname
          : '/index.html';
      const file = path.join(DIST, relative),
        data = await readFile(file);
      res.setHeader(
        'content-type',
        file.endsWith('.svg')
          ? 'image/svg+xml'
          : file.endsWith('.woff2')
            ? 'font/woff2'
            : file.endsWith('.png')
              ? 'image/png'
              : file.endsWith('.js')
                ? 'text/javascript'
                : file.endsWith('.css')
                  ? 'text/css'
                  : file.endsWith('.pdf')
                    ? 'application/pdf'
                    : 'text/html',
      );
      res.end(data);
    } catch (error) {
      console.error('Local harness error:', error);
      res.statusCode = 500;
      res.end(String(error));
    }
  });
  const wss = new WebSocketServer({ server, path: '/realtime/v1/websocket' });
  wss.on('connection', (socket) => {
    socket.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.event === 'phx_join') {
          const id = /^realtime:scrim-([a-z0-9]{6,32})$/.exec(msg.topic)?.[1];
          const visible =
            id && (await database(() => sqlValue('public.scrim_is_public($1)', [id])));
          if (visible) sockets.set(socket, msg.topic);
          else wsDenied++;
          socket.send(
            JSON.stringify({
              topic: msg.topic,
              event: 'phx_reply',
              ref: msg.ref,
              payload: {
                status: visible ? 'ok' : 'error',
                response: visible ? {} : { reason: 'public room required' },
              },
            }),
          );
          if (visible)
            socket.send(JSON.stringify({ topic: msg.topic, event: 'presence_state', payload: {} }));
        } else if (
          msg.event === 'presence' &&
          msg.payload?.event === 'track' &&
          sockets.has(socket)
        ) {
          presences.set(socket, { role: msg.payload.payload.role, phx_ref: randomUUID() });
          announcePresence(sockets.get(socket)!);
        } else if (msg.event === 'heartbeat')
          socket.send(
            JSON.stringify({
              topic: 'phoenix',
              event: 'phx_reply',
              ref: msg.ref,
              payload: { status: 'ok' },
            }),
          );
      } catch (error) {
        console.error('Local Phoenix error', error);
      }
    });
    socket.on('close', () => {
      const topic = sockets.get(socket);
      sockets.delete(socket);
      presences.delete(socket);
      if (topic) announcePresence(topic);
    });
  });
  server.listen(PORT, '127.0.0.1', () =>
    process.stdout.write(
      `Pilot server :${PORT} ready; isolated PGlite/Auth/Phoenix; no hosted writes.\n`,
    ),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
