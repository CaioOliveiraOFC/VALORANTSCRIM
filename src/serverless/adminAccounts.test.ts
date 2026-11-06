import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAuthError, type AdminSession } from './adminAuth.js';
import { handleAdminAccountRoute } from './adminAccounts.js';
import { presetPermissions, type AdminAccount } from '../shared/adminPermissions.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const actor: AdminSession = { userId: OWNER, email: 'caio.oliveira2014@hotmail.com', isSuperAdmin: true,
  permissions: presetPermissions('full'), canDeleteRooms: true, accountVersion: 1, sessionVersion: 0 };
const account = (id = TARGET): AdminAccount => ({ id, email: id === OWNER ? actor.email : 'admin1@fiction.example', displayName: 'Organizador',
  active: true, preset: 'organizer', permissions: presetPermissions('organizer'), version: 1, isSuperAdmin: id === OWNER,
  provisioned: true, createdAt: 1, updatedAt: 1 });
const req = (method = 'GET', body?: unknown, query = '', origin = 'http://localhost') => ({
  method, body, url: '/api/admin/accounts' + query,
  headers: { host: 'localhost', origin, 'content-type': 'application/json' },
}) as IncomingMessage & { body?: unknown };
let accounts: Map<string, AdminAccount>;
let registerFails: boolean;
let conflict: boolean;
let providerStatus: number;
let providerThrows: boolean;
let providerCode: string;
let finishFails: boolean;
const dbCalls: { name: string; args: any }[] = [];
const fetcher = vi.fn();
const db = vi.fn(async (path: string, options?: RequestInit) => {
  const name = path.replace('rpc/', ''), args = JSON.parse(String(options?.body ?? '{}'));
  dbCalls.push({ name, args });
  if (name === 'list_admin_accounts') {
    const all = [...accounts.values()];
    return { accounts: all.slice(args.p_offset, args.p_offset + args.p_limit), total: all.length,
      nextOffset: args.p_offset + args.p_limit < all.length ? args.p_offset + args.p_limit : null };
  }
  if (name === 'get_admin_account') return accounts.get(args.p_user_id) ?? null;
  if (name === 'register_admin_account') {
    if (registerFails) throw new Error('Database temporarily unavailable');
    const value = { ...account(args.p_user_id), displayName: args.p_display_name, preset: args.p_preset, permissions: args.p_permissions, active: args.p_active };
    accounts.set(value.id, value); return value;
  }
  if (name === 'finish_admin_password_reset') {
    if (finishFails) throw new Error('Finalization unavailable');
    if (args.p_succeeded || args.p_error_code === 'auth_rejected') {
      accounts.set(TARGET, { ...accounts.get(TARGET)!, passwordResetPending: false });
    }
    return null;
  }
  const old = accounts.get(args.p_user_id)!;
  if (conflict || old.version !== args.p_expected_version) throw new AdminAuthError(409, 'Outra alteração foi gravada.');
  if (name === 'update_admin_account') {
    const next = { ...old, displayName: args.p_display_name, preset: args.p_preset, permissions: args.p_permissions, active: old.provisioned ? old.active : true,
      version: old.version + 1, provisioned: true };
    accounts.set(old.id, next); return next;
  }
  if (name === 'set_admin_account_active') {
    const next = { ...old, active: args.p_active, version: old.version + 1 }; accounts.set(old.id, next); return next;
  }
  if (name === 'begin_admin_password_reset') {
    const next = { ...old, version: old.version + 1, passwordResetPending: true }; accounts.set(old.id, next);
    return { account: next, auditId: 12, attemptVersion: 1 };
  }
  throw new Error('Unexpected account RPC');
});
beforeEach(() => {
  accounts = new Map([[TARGET, account()]]); registerFails = false; conflict = false; providerStatus = 200; providerThrows = false; providerCode = ''; finishFails = false;
  dbCalls.length = 0; db.mockClear(); fetcher.mockReset();
  vi.stubEnv('SUPABASE_URL', 'https://account-tests.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-private-test-key');
  fetcher.mockImplementation(async () => {
    if (providerThrows) throw new Error('network failure');
    return new Response(JSON.stringify(providerStatus === 200 ? { id: TARGET, email: account().email, encrypted_password: 'not-a-public-field', access_token: 'never-forward-auth-token' } : { code: providerCode || (providerStatus === 409 ? 'email_exists' : 'weak_password'), message: 'raw provider details must not leak' }), { status: providerStatus });
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('super administrator account management', () => {
  it('denies ordinary accounts even if they have every room permission', async () => {
    await expect(handleAdminAccountRoute(req(), [], { ...actor, isSuperAdmin: false }, db)).rejects.toMatchObject({ status: 403 });
    expect(db).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects cross-origin changes before touching Auth or policy data', async () => {
    await expect(handleAdminAccountRoute(req('POST', {}, '', 'https://untrusted.example'), [], actor, db)).rejects.toMatchObject({ status: 403 });
    expect(db).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });

  it('passes bounded pagination and filters to SQL and exposes only the management DTO', async () => {
    Object.assign(accounts.get(TARGET)!, { encrypted_password: 'private-hash', access_token: 'private-token', raw_app_meta_data: { secret: true } });
    const result = await handleAdminAccountRoute(req('GET', undefined, '?offset=0&limit=1&q=admin&status=suspended'), [], actor, db);
    expect(result.status).toBe(200);
    expect(dbCalls[0]).toMatchObject({ name: 'list_admin_accounts', args: { p_actor_id: OWNER, p_offset: 0, p_limit: 1, p_query: 'admin', p_status: 'suspended' } });
    expect(JSON.stringify(result.body)).not.toMatch(/private-hash|private-token|raw_app_meta_data/);
    for (const query of ['?limit=101', '?offset=-1', '?status=superadmin', '?limit=0', '?offset=1e3']) {
      await expect(handleAdminAccountRoute(req('GET', undefined, query), [], actor, db)).rejects.toMatchObject({ status: 400 });
    }
  });

  it('creates a confirmed fictitious-email account with server-only Auth credentials and default organizer permissions', async () => {
    const result = await handleAdminAccountRoute(req('POST', { email: 'Admin1@Fiction.Example', password: 'one-time-test-password', displayName: 'Amigo' }), [], actor, db);
    expect(result.status).toBe(201);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://account-tests.supabase.co/auth/v1/admin/users');
    expect(options.headers).toMatchObject({ apikey: 'server-private-test-key', authorization: 'Bearer server-private-test-key' });
    const payload = JSON.parse(options.body);
    expect(payload).toMatchObject({ email: 'admin1@fiction.example', password: 'one-time-test-password', email_confirm: true,
      app_metadata: { scrim_console_managed: true, scrim_console_preset: 'organizer' } });
    expect(payload.app_metadata).not.toHaveProperty('scrim_admin');
    expect(dbCalls[0]).toMatchObject({ name: 'register_admin_account', args: { p_actor_id: OWNER, p_user_id: TARGET, p_permissions: presetPermissions('organizer'), p_active: true } });
    expect(JSON.stringify(result.body)).not.toMatch(/one-time-test-password|server-private-test-key|encrypted_password|access_token/);
  });

  it('refuses unrecognized role fields and invalid capability values without creating a user', async () => {
    const base = { email: 'admin@fiction.example', password: 'test-password-123' };
    for (const extra of [{ isSuperAdmin: true }, { app_metadata: {} }, { permissions: { isSuperAdmin: true } }, { permissions: { deleteRooms: 'true' } }]) {
      await expect(handleAdminAccountRoute(req('POST', { ...base, ...extra }), [], actor, db)).rejects.toMatchObject({ status: 400 });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps a partially created Auth identity recoverable without repeating creation or exposing its password', async () => {
    registerFails = true;
    const result = await handleAdminAccountRoute(req('POST', { email: 'admin@fiction.example', password: 'test-password-123' }), [], actor, db);
    expect(result).toMatchObject({ status: 503, body: { pending: true, accountId: TARGET } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.body)).not.toContain('test-password-123');
  });

  it('directs an uncertain Auth timeout to the list instead of automatically repeating the request', async () => {
    providerThrows = true;
    const result = await handleAdminAccountRoute(req('POST', { email: 'admin@fiction.example', password: 'test-password-123' }), [], actor, db);
    expect(result).toMatchObject({ status: 503, body: { pending: true } });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(db).not.toHaveBeenCalled();
  });

  it('reports a duplicate account safely without registering or resetting it', async () => {
    providerStatus = 409;
    await expect(handleAdminAccountRoute(req('POST', { email: 'admin@fiction.example', password: 'test-password-123' }), [], actor, db)).rejects.toMatchObject({ status: 409 });
    expect(db).not.toHaveBeenCalled();
  });

  it('completes a pending identity through the version-zero policy operation without calling Auth again', async () => {
    accounts.set(TARGET, { ...account(), active: false, provisioned: false, version: 0 });
    const result = await handleAdminAccountRoute(req('PATCH', { expectedVersion: 0, displayName: 'Pronto', preset: 'organizer', permissions: presetPermissions('organizer') }), [TARGET], actor, db);
    expect(result).toMatchObject({ status: 200, body: { account: { provisioned: true, active: true, version: 1 } } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('preserves existing privileges on a name-only update and rejects a stale save', async () => {
    accounts.get(TARGET)!.permissions.correctStats = true;
    const result = await handleAdminAccountRoute(req('PATCH', { expectedVersion: 1, displayName: 'Novo nome' }), [TARGET], actor, db);
    expect(result).toMatchObject({ status: 200, body: { account: { displayName: 'Novo nome', permissions: { correctStats: true } } } });
    await expect(handleAdminAccountRoute(req('PATCH', { expectedVersion: 1, displayName: 'Stale' }), [TARGET], actor, db)).rejects.toMatchObject({ status: 409 });
  });

  it('passes suspension/reactivation with CAS while keeping permissions and not changing rooms', async () => {
    const before = structuredClone(account().permissions);
    await handleAdminAccountRoute(req('POST', { expectedVersion: 1, active: false }), [TARGET, 'status'], actor, db);
    expect(accounts.get(TARGET)).toMatchObject({ active: false, permissions: before });
    await handleAdminAccountRoute(req('POST', { expectedVersion: 2, active: true }), [TARGET, 'status'], actor, db);
    expect(accounts.get(TARGET)).toMatchObject({ active: true, permissions: before });
    expect(dbCalls.filter(call => call.name !== 'get_admin_account').map(call => call.name)).toEqual(['set_admin_account_active', 'set_admin_account_active']);
  });

  it('protects the principal identity from edits, status changes and password reset', async () => {
    accounts.set(OWNER, account(OWNER));
    for (const [method, segments, body] of [
      ['PATCH', [OWNER], { expectedVersion: 1, displayName: 'Changed' }],
      ['POST', [OWNER, 'status'], { expectedVersion: 1, active: false }],
      ['POST', [OWNER, 'password'], { expectedVersion: 1, password: 'test-password-123' }],
    ] as const) await expect(handleAdminAccountRoute(req(method, body), [...segments], actor, db)).rejects.toMatchObject({ status: 403 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(dbCalls.every(call => call.name === 'get_admin_account')).toBe(true);
  });

  it('bumps the session epoch before resetting a password and records no secret in policy/audit', async () => {
    fetcher.mockImplementation(async () => {
      expect(dbCalls.at(-1)?.name).toBe('begin_admin_password_reset');
      return new Response(JSON.stringify({ id: TARGET }));
    });
    const result = await handleAdminAccountRoute(req('POST', { expectedVersion: 1, password: 'new-one-time-password' }), [TARGET, 'password'], actor, db);
    expect(result).toMatchObject({ status: 200, body: { account: { version: 2 } } });
    expect(fetcher.mock.calls[0]![0]).toBe(`https://account-tests.supabase.co/auth/v1/admin/users/${TARGET}`);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ password: 'new-one-time-password' });
    expect(dbCalls.at(-1)).toMatchObject({ name: 'finish_admin_password_reset', args: { p_succeeded: true, p_error_code: null, p_attempt_version: 1 } });
    expect(dbCalls.find(call => call.name === 'begin_admin_password_reset')!.args.p_password_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(dbCalls)).not.toContain('new-one-time-password'); expect(JSON.stringify(result.body)).not.toContain('new-one-time-password');
  });

  it('does not call Auth if an atomic reset version check fails', async () => {
    conflict = true;
    await expect(handleAdminAccountRoute(req('POST', { expectedVersion: 1, password: 'test-password-123' }), [TARGET, 'password'], actor, db)).rejects.toMatchObject({ status: 409 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports a failed reset accurately after invalidation and keeps the updated version for refresh', async () => {
    providerStatus = 422;
    const result = await handleAdminAccountRoute(req('POST', { expectedVersion: 1, password: 'test-password-123' }), [TARGET, 'password'], actor, db);
    expect(result).toMatchObject({ status: 400, body: { account: { version: 2 } } });
    expect(JSON.stringify(result.body)).not.toMatch(/raw provider|test-password-123/);
    expect(dbCalls.at(-1)).toMatchObject({ name: 'finish_admin_password_reset', args: { p_succeeded: false, p_error_code: 'auth_rejected' } });
  });

  it('keeps an uncertain reset pending for a same-password retry without returning a credential proof', async () => {
    providerThrows = true;
    const result = await handleAdminAccountRoute(req('POST', { expectedVersion: 1, password: 'test-password-123' }), [TARGET, 'password'], actor, db);
    expect(result).toMatchObject({ status: 503, body: { samePasswordRequired: true, account: { version: 2, passwordResetPending: true } } });
    expect(JSON.stringify(result.body)).not.toMatch(/test-password-123|fingerprint/);
    expect(dbCalls.at(-1)).toMatchObject({ name: 'finish_admin_password_reset', args: { p_succeeded: false, p_error_code: 'auth_unavailable' } });
  });

  it('confirms an identical retry that Auth reports as already using the requested password', async () => {
    providerStatus = 422; providerCode = 'same_password';
    const result = await handleAdminAccountRoute(req('POST', { expectedVersion: 1, password: 'test-password-123' }), [TARGET, 'password'], actor, db);
    expect(result).toMatchObject({ status: 200, body: { account: { passwordResetPending: false } } });
    expect(dbCalls.at(-1)).toMatchObject({ name: 'finish_admin_password_reset', args: { p_succeeded: true } });
  });

  it('does not claim the password is ready when clearing the login barrier fails', async () => {
    finishFails = true;
    const result = await handleAdminAccountRoute(req('POST', { expectedVersion: 1, password: 'test-password-123' }), [TARGET, 'password'], actor, db);
    expect(result).toMatchObject({ status: 503, body: { samePasswordRequired: true, account: { passwordResetPending: true } } });
    expect((result.body as any).recoveryToken).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(result.body)).not.toContain('test-password-123');
  });

  it('keeps a rejected password attempt recoverable when its barrier finalization also fails', async () => {
    providerStatus = 422; finishFails = true;
    const result = await handleAdminAccountRoute(req('POST', { expectedVersion: 1, password: 'test-password-123' }), [TARGET, 'password'], actor, db);
    expect(result).toMatchObject({ status: 503, body: { samePasswordRequired: true, account: { passwordResetPending: true } } });
  });

  it('rejects wrong-candidate, wrong-actor and tampered completion receipts before contacting either provider', async () => {
    finishFails = true;
    const first = await handleAdminAccountRoute(req('POST', { expectedVersion: 1, password: 'test-password-123' }), [TARGET, 'password'], actor, db);
    const token = (first.body as any).recoveryToken as string;
    const calls = dbCalls.length;
    const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    for (const [candidate, receipt, identity] of [
      ['different-password', token, actor], ['test-password-123', tampered, actor],
      ['test-password-123', token, { ...actor, userId: '33333333-3333-4333-8333-333333333333' }],
    ] as const) {
      await expect(handleAdminAccountRoute(req('POST', { expectedVersion: 2, password: candidate, recoveryToken: receipt }), [TARGET, 'password'], identity, db)).rejects.toMatchObject({ status: 400 });
    }
    expect(dbCalls).toHaveLength(calls); expect(fetcher).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'));
    expect(payload).toEqual([OWNER, TARGET, 12, 1, 'success']);
    expect(JSON.stringify(payload)).not.toMatch(/fingerprint|password-123|server-private/);
  });

  it('replays a confirmed completion receipt without repeating the native password write', async () => {
    finishFails = true;
    const first = await handleAdminAccountRoute(req('POST', { expectedVersion: 1, password: 'test-password-123' }), [TARGET, 'password'], actor, db);
    finishFails = false;
    const result = await handleAdminAccountRoute(req('POST', { expectedVersion: 2, password: 'test-password-123', recoveryToken: (first.body as any).recoveryToken }), [TARGET, 'password'], actor, db);
    expect(result).toMatchObject({ status: 200, body: { account: { version: 2, passwordResetPending: false } } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(dbCalls.filter(call => call.name === 'begin_admin_password_reset')).toHaveLength(1);
  });

  it('replays a confirmed rejection receipt by clearing its barrier without another native request', async () => {
    providerStatus = 422; finishFails = true;
    const first = await handleAdminAccountRoute(req('POST', { expectedVersion: 1, password: 'test-password-123' }), [TARGET, 'password'], actor, db);
    finishFails = false;
    const result = await handleAdminAccountRoute(req('POST', { expectedVersion: 2, password: 'test-password-123', recoveryToken: (first.body as any).recoveryToken }), [TARGET, 'password'], actor, db);
    expect(result).toMatchObject({ status: 400, body: { account: { passwordResetPending: false } } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('password completion receipts with the canonical SQL policy', () => {
  let sql: PGlite;
  beforeAll(async () => {
    sql = new PGlite();
    await sql.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create publication supabase_realtime; create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,
        raw_app_meta_data jsonb not null default '{}',raw_user_meta_data jsonb not null default '{}',
        created_at timestamptz not null default clock_timestamp());`);
    for (const file of ['20261016_scrims.sql', '20261017_match_imports.sql', '20261104_room_access.sql']) {
      await sql.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    }
    await sql.query(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())`, [OWNER, actor.email]);
    await sql.exec(await readFile(new URL('../../supabase/migrations/20261105_super_admin.sql', import.meta.url), 'utf8'));
  }, 30_000);
  afterAll(async () => { await sql.close(); });

  async function sqlAccount() {
    const id = randomUUID();
    await sql.query(`insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
      values($1,$2,clock_timestamp(),'{"scrim_console_managed":true}')`, [id, `${id}@example.test`]);
    await sql.query(`select public.register_admin_account($1,$2,'Admin','organizer',$3,true)`, [OWNER, id, presetPermissions('organizer')]);
    return id;
  }
  function sqlDatabase(finishFailures = 1) {
    return vi.fn(async (path: string, options?: RequestInit) => {
      const name = path.replace('rpc/', ''), args = JSON.parse(String(options?.body ?? '{}')) as Record<string, unknown>;
      if (!['get_admin_account', 'begin_admin_password_reset', 'finish_admin_password_reset'].includes(name)) throw new Error('Unexpected SQL integration RPC');
      if (name === 'finish_admin_password_reset' && finishFailures-- > 0) throw new AdminAuthError(503, 'Database unavailable before commit');
      const named = Object.keys(args).map((key, index) => `${key} => $${index + 1}`).join(',');
      try { return (await sql.query<{ value: unknown }>(`select public.${name}(${named}) as value`, Object.values(args))).rows[0]!.value; }
      catch (error) {
        if (error instanceof Error && /STALE_ADMIN_VERSION|RESET_IN_PROGRESS/.test(error.message)) throw new AdminAuthError(409, 'Outra alteração foi gravada.');
        throw error;
      }
    });
  }
  const resetRequest = (id: string, expectedVersion: number, recoveryToken?: string, secret = 'same-recovery-password') => ({
    request: req('POST', { expectedVersion, password: secret, ...(recoveryToken ? { recoveryToken } : {}) }), segments: [id, 'password'],
  });
  async function reset(id: string, database: ReturnType<typeof sqlDatabase>, expectedVersion = 1, recoveryToken?: string, secret?: string) {
    const input = resetRequest(id, expectedVersion, recoveryToken, secret);
    return handleAdminAccountRoute(input.request, input.segments, actor, database);
  }

  it('recovers a failed finalization with the same candidate and rejects altered receipts without another native write', async () => {
    const id = await sqlAccount(), database = sqlDatabase();
    const first = await reset(id, database), token = (first.body as any).recoveryToken as string;
    expect(first).toMatchObject({ status: 503, body: { samePasswordRequired: true, account: { version: 2, passwordResetPending: true } } });
    expect((await sql.query(`select a.password_reset_pending,a.password_reset_attempt,u.error_code
      from public.scrim_admin_accounts a join public.scrim_admin_audit u on u.id=a.password_reset_audit_id where a.user_id=$1`, [id])).rows)
      .toEqual([{ password_reset_pending: true, password_reset_attempt: 1, error_code: null }]);
    const calls = database.mock.calls.length;
    await expect(reset(id, database, 2, token, 'different-recovery-password')).rejects.toMatchObject({ status: 400 });
    const badToken = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    await expect(reset(id, database, 2, badToken)).rejects.toMatchObject({ status: 400 });
    expect(database).toHaveBeenCalledTimes(calls);
    const recovered = await reset(id, database, 2, token);
    expect(recovered).toMatchObject({ status: 200, body: { account: { passwordResetPending: false, version: 2 } } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await sql.query('select password_reset_pending,session_version from public.scrim_admin_accounts where user_id=$1', [id])).rows)
      .toEqual([{ password_reset_pending: false, session_version: 1 }]);
    expect(JSON.stringify((await sql.query('select * from public.scrim_admin_audit where target_user_id=$1', [id])).rows))
      .not.toMatch(/same-recovery-password|recoveryToken|fingerprint/);
  });

  it('finishes a receipt after concurrent account edits and refuses it after a later reset completes', async () => {
    const id = await sqlAccount(), database = sqlDatabase();
    const first = await reset(id, database), token = (first.body as any).recoveryToken as string;
    const permissions = { ...presetPermissions('organizer'), manageNotes: false };
    await sql.query(`select public.update_admin_account($1,$2,2,'Edited name','organizer',$3)`, [OWNER, id, permissions]);
    const recovered = await reset(id, database, 2, token);
    expect(recovered).toMatchObject({ status: 200, body: { account: { version: 3, displayName: 'Edited name', permissions, passwordResetPending: false } } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const later = await reset(id, database, 3, undefined, 'different-later-password');
    expect(later.status).toBe(200);
    await expect(reset(id, database, 4, token)).rejects.toMatchObject({ status: 409 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not let an older unknown-outcome receipt reopen a newer native attempt', async () => {
    const id = await sqlAccount(), database = sqlDatabase();
    providerThrows = true;
    const first = await reset(id, database), token = (first.body as any).recoveryToken as string;
    expect(first.status).toBe(503);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    fetcher.mockImplementation(async () => { entered(); await gate; return new Response(JSON.stringify({ id })); });
    const retry = reset(id, database, 2, token);
    await started;
    try {
      await expect(reset(id, database, 2, token)).rejects.toMatchObject({ status: 409 });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect((await sql.query(`select a.password_reset_attempt,u.error_code from public.scrim_admin_accounts a
        join public.scrim_admin_audit u on u.id=a.password_reset_audit_id where a.user_id=$1`, [id])).rows)
        .toEqual([{ password_reset_attempt: 2, error_code: null }]);
    } finally { release(); }
    expect((await retry).status).toBe(200);
    await expect(reset(id, database, 2, token)).rejects.toMatchObject({ status: 409 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('preserves an unknown receipt across a version conflict before starting its native retry', async () => {
    const id = await sqlAccount(), database = sqlDatabase();
    providerThrows = true;
    const first = await reset(id, database), token = (first.body as any).recoveryToken as string;
    await sql.query(`select public.update_admin_account($1,$2,2,'Concurrent edit','organizer',$3)`, [OWNER, id, presetPermissions('organizer')]);
    providerThrows = false;
    const conflict = await reset(id, database, 2, token);
    expect(conflict).toMatchObject({ status: 409, body: { recoveryToken: token, samePasswordRequired: true, account: { version: 3, passwordResetPending: true } } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const recovered = await reset(id, database, 3, token);
    expect(recovered).toMatchObject({ status: 200, body: { account: { version: 3, displayName: 'Concurrent edit', passwordResetPending: false } } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
