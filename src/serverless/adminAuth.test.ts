import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { noPermissions, presetPermissions } from '../shared/adminPermissions.js';
import {
  ADMIN_ACCESS_COOKIE, ADMIN_REFRESH_COOKIE, ADMIN_GENERATION_COOKIE, AdminAuthError,
  assertSameOrigin, getAdminSession, loginAdmin, logoutAdmin,
} from './adminAuth.js';

const access = 'opaque-access-token';
const refresh = 'opaque-refresh-token';
const userId = '11111111-1111-4111-8111-111111111111';
const user = { id: userId, email: 'admin@example.com', app_metadata: { scrim_admin: true } };
const tokens = { access_token: access, refresh_token: refresh, expires_in: 3600 };
const json = (value: unknown, status = 200) => status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(value), { status });
const defaultPolicy = () => ({ user_id: userId, active: true, is_super_admin: false,
  permissions: presetPermissions('organizer'), version: 1, session_version: 0, password_reset_pending: false });
let profile: Record<string, unknown>;
let policy: ReturnType<typeof defaultPolicy> | null;
let policyError: { status: number; code?: string } | null;
let expiredAccess: boolean;
let logoutExpired: number;
let onPassword: (() => void | Promise<void>) | undefined;
let onRefresh: (() => void) | undefined;
function request(headers: Record<string, string> = {}) {
  return { headers: { host: 'valorantscrim.vercel.app', ...headers } } as unknown as IncomingMessage;
}
function response() {
  const headers = new Map<string, unknown>();
  const res = {
    getHeader: (name: string) => headers.get(name),
    setHeader: (name: string, value: unknown) => { headers.set(name, value); return res; },
  } as unknown as ServerResponse;
  return { res, cookies: () => headers.get('set-cookie') as string[] | undefined };
}
function cookieHeader(accessToken: string | null = access, refreshToken: string | null = refresh, generation: string | null = null) {
  return [[ADMIN_ACCESS_COOKIE, accessToken], [ADMIN_REFRESH_COOKIE, refreshToken], [ADMIN_GENERATION_COOKIE, generation]]
    .filter(([, value]) => value !== null).map(([name, value]) => `${name}=${encodeURIComponent(value!)}`).join('; ');
}
function generationFrom(cookies: string[] | undefined): string {
  const value = cookies?.find(item => item.startsWith(`${ADMIN_GENERATION_COOKIE}=`))?.split(';')[0]?.slice(ADMIN_GENERATION_COOKIE.length + 1);
  if (!value) throw new Error('Expected a signed session generation');
  return decodeURIComponent(value);
}
function expectCleared(cookies: string[] | undefined) {
  expect(cookies).toHaveLength(3);
  expect(cookies?.every(item => item.includes('Max-Age=0'))).toBe(true);
}
async function signedGeneration(): Promise<string> {
  const result = response();
  await loginAdmin(request(), result.res, user.email, 'password');
  return generationFrom(result.cookies());
}
const paths = () => vi.mocked(fetch).mock.calls.map(([url]) => new URL(String(url)).pathname + new URL(String(url)).search);
const expectedSession = (extra: Record<string, unknown> = {}) => ({ userId, email: user.email, canDeleteRooms: false,
  isSuperAdmin: false, permissions: presetPermissions('organizer'), accountVersion: 1, sessionVersion: 0, ...extra });

beforeEach(() => {
  profile = structuredClone(user); policy = defaultPolicy(); policyError = null; expiredAccess = false; logoutExpired = 0; onPassword = undefined; onRefresh = undefined;
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-test-key');
  vi.stubGlobal('fetch', vi.fn(async (input: string, options: RequestInit = {}) => {
    const url = new URL(String(input));
    expect(new Headers(options.headers).get('apikey')).toBe('server-test-key');
    if (['/rest/v1/rpc/get_admin_access', '/rest/v1/rpc/get_admin_login_policy'].includes(url.pathname)) {
      expect(new Headers(options.headers).get('authorization')).toBe('Bearer server-test-key');
      const body = JSON.parse(String(options.body));
      if (url.pathname.endsWith('/get_admin_login_policy')) expect(body).toEqual({ p_email: user.email });
      else expect(typeof body.p_user_id).toBe('string');
      if (policyError) return json({ code: policyError.code, message: 'private database detail' }, policyError.status);
      return json(policy);
    }
    if (url.pathname === '/auth/v1/user') {
      if (expiredAccess && new Headers(options.headers).get('authorization') === `Bearer ${access}`) return json({ message: 'expired' }, 401);
      return json(profile);
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      await onPassword?.();
      return json({ ...tokens, user: { ...user, email: 'caio.oliveira2014@hotmail.com', email_confirmed_at: '2026-11-05T00:00:00Z', app_metadata: { scrim_admin: true, scrim_delete_rooms: true } } });
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      onRefresh?.(); return json({ ...tokens, access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 1800 });
    }
    if (url.pathname === '/auth/v1/logout') {
      if (logoutExpired && new Headers(options.headers).get('authorization') === `Bearer ${access}`) return json({ message: 'expired' }, logoutExpired);
      return json(null, 204);
    }
    throw new Error('Unexpected provider request');
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('canonical server-only admin identity and policy', () => {
  it('does not contact Auth or require server credentials for anonymous spectators', async () => {
    vi.stubEnv('SUPABASE_URL', ''); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const { res, cookies } = response();
    expect(await getAdminSession(request(), res)).toBeNull(); expect(fetch).not.toHaveBeenCalled(); expect(cookies()).toBeUndefined();
  });

  it('signs in only after independent Auth identity and canonical policy verification, with three secure HttpOnly cookies', async () => {
    const result = response();
    const session = await loginAdmin(request({ origin: 'https://valorantscrim.vercel.app' }), result.res, '  ADMIN@example.com ', ' secret password ');
    expect(session).toEqual(expectedSession());
    expect(JSON.stringify(session)).not.toMatch(/token|secret password|server-test-key/);
    expect(paths()).toEqual(['/rest/v1/rpc/get_admin_login_policy', '/auth/v1/token?grant_type=password', '/auth/v1/user', '/rest/v1/rpc/get_admin_access']);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body))).toEqual({ p_email: 'admin@example.com' });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]!.body))).toEqual({ email: 'admin@example.com', password: ' secret password ' });
    expect(new Headers(vi.mocked(fetch).mock.calls[2]![1]!.headers).get('authorization')).toBe(`Bearer ${access}`);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[3]![1]!.body))).toEqual({ p_user_id: userId });
    expect(result.cookies()).toHaveLength(3);
    for (const item of result.cookies()!) {
      expect(item).toContain('HttpOnly'); expect(item).toContain('Secure'); expect(item).toContain('SameSite=Lax');
      expect(item).toContain('Path=/'); expect(item).not.toContain('Domain=');
    }
    expect(result.cookies()![0]).toContain('Max-Age=3600');
    expect(result.cookies()![1]).toContain('Max-Age=604800'); expect(result.cookies()![2]).toContain('Max-Age=604800');
    expect(generationFrom(result.cookies())).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  });

  it('uses the private policy even when legacy app_metadata denies or grants contradictory powers', async () => {
    profile.app_metadata = { scrim_admin: false, scrim_delete_rooms: true, is_super_admin: true };
    profile.user_metadata = { scrim_admin: true, isSuperAdmin: true, permissions: presetPermissions('full') };
    expect(await getAdminSession(request({ cookie: cookieHeader() }), response().res)).toEqual(expectedSession());
    policy = null;
    expect(await getAdminSession(request({ cookie: cookieHeader() }), response().res)).toBeNull();
    const rejected = response();
    await expect(loginAdmin(request(), rejected.res, user.email, 'password')).rejects.toMatchObject({ status: 401 });
    expectCleared(rejected.cookies());
  });

  it('refreshes canonical permissions and account version on every request without caching', async () => {
    const generation = await signedGeneration(); vi.mocked(fetch).mockClear();
    const req = request({ cookie: cookieHeader(access, refresh, generation) });
    expect(await getAdminSession(req, response().res)).toEqual(expectedSession());
    policy!.permissions.correctStats = true; policy!.version = 2;
    expect(await getAdminSession(req, response().res)).toEqual(expectedSession({ permissions: { ...presetPermissions('organizer'), correctStats: true }, accountVersion: 2 }));
    expect(paths().filter(path => path === '/rest/v1/rpc/get_admin_access')).toHaveLength(2);
  });

  it('requires the canonical super flag, pinned UUID, confirmed identity and exact owner email together', async () => {
    profile.email = 'Caio.Oliveira2014@Hotmail.com'; profile.email_confirmed_at = '2026-11-05T12:00:00Z';
    policy!.is_super_admin = true; policy!.permissions = noPermissions();
    expect(await getAdminSession(request({ cookie: cookieHeader() }), response().res)).toEqual(expectedSession({ email: profile.email,
      isSuperAdmin: true, permissions: presetPermissions('full'), canDeleteRooms: true }));
    policy!.is_super_admin = false;
    expect(await getAdminSession(request({ cookie: cookieHeader() }), response().res)).toMatchObject({ isSuperAdmin: false, canDeleteRooms: false });
    policy!.is_super_admin = true; policy!.user_id = '22222222-2222-4222-8222-222222222222';
    expect(await getAdminSession(request({ cookie: cookieHeader() }), response().res)).toBeNull();
  });

  it.each([undefined, null, '', '   ', false])('never promotes an unconfirmed owner identity (%s)', async email_confirmed_at => {
    profile.email = 'caio.oliveira2014@hotmail.com'; profile.email_confirmed_at = email_confirmed_at;
    policy!.is_super_admin = true;
    expect(await getAdminSession(request({ cookie: cookieHeader() }), response().res)).toMatchObject({ isSuperAdmin: false });
  });

  it('does not promote another email or editable metadata even when a false policy response claims super status', async () => {
    profile.email_confirmed_at = '2026-11-05T12:00:00Z';
    profile.user_metadata = { email: 'caio.oliveira2014@hotmail.com', email_confirmed_at: '2026-11-05T12:00:00Z', is_super_admin: true };
    policy!.is_super_admin = true;
    expect(await getAdminSession(request({ cookie: cookieHeader() }), response().res)).toMatchObject({ isSuperAdmin: false });
  });

  it('fails closed with an actionable migration error instead of falling back to legacy metadata', async () => {
    policyError = { status: 404, code: 'PGRST202' };
    const result = response();
    await expect(getAdminSession(request({ cookie: cookieHeader() }), result.res)).rejects.toMatchObject({ status: 503, message: expect.stringContaining('20261105_super_admin.sql') });
    expect(result.cookies()).toBeUndefined();
  });

  it('rejects malformed canonical permissions rather than accepting owner-like keys or string booleans', async () => {
    policy!.permissions = { accessAll: true } as never;
    await expect(getAdminSession(request({ cookie: cookieHeader() }), response().res)).rejects.toMatchObject({ status: 503 });
    policy!.permissions = { deleteRooms: 'true' } as never;
    await expect(getAdminSession(request({ cookie: cookieHeader() }), response().res)).rejects.toMatchObject({ status: 503 });
  });

  it.each([undefined, null, 'false', 0])('requires an explicit boolean reset marker from both private policies (%s)', async password_reset_pending => {
    Object.assign(policy!, { password_reset_pending });
    await expect(getAdminSession(request({ cookie: cookieHeader() }), response().res)).rejects.toMatchObject({ status: 503 });
    vi.mocked(fetch).mockClear();
    await expect(loginAdmin(request(), response().res, user.email, 'password')).rejects.toMatchObject({ status: 503 });
    expect(paths()).toEqual(['/rest/v1/rpc/get_admin_login_policy']);
  });

  it('keeps malformed private RPC errors generic', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(null, 500));
    await expect(loginAdmin(request(), response().res, user.email, 'password')).rejects.toMatchObject({ status: 503,
      message: 'Login indisponível no momento. Tente novamente.' });
  });
});

describe('password login reset guard', () => {
  it.each(['missing', 'inactive', 'reset pending'])('denies %s accounts before Auth with the same generic credential error', async state => {
    if (state === 'missing') policy = null;
    else if (state === 'inactive') policy!.active = false;
    else policy!.password_reset_pending = true;
    const result = response();
    await expect(loginAdmin(request(), result.res, user.email, 'password')).rejects.toMatchObject({ status: 401,
      message: 'E-mail ou senha inválidos, ou acesso de administrador não liberado.' });
    expect(paths()).toEqual(['/rest/v1/rpc/get_admin_login_policy']);
    expectCleared(result.cookies());
  });

  it('rejects an old password accepted by Auth when a complete reset races its response', async () => {
    let acceptedPassword!: () => void;
    let releaseGrant!: () => void;
    const accepted = new Promise<void>(resolve => { acceptedPassword = resolve; });
    const grantResponse = new Promise<void>(resolve => { releaseGrant = resolve; });
    onPassword = () => { acceptedPassword(); return grantResponse; };
    const result = response();
    const login = expect(loginAdmin(request(), result.res, user.email, 'old-password')).rejects.toMatchObject({ status: 401 });
    await accepted;
    policy!.password_reset_pending = true;
    policy!.session_version++;
    policy!.password_reset_pending = false;
    releaseGrant();
    await login;
    expect(paths()).toEqual(['/rest/v1/rpc/get_admin_login_policy', '/auth/v1/token?grant_type=password', '/auth/v1/user', '/rest/v1/rpc/get_admin_access']);
    expectCleared(result.cookies());
  });

  it('rejects a reset that becomes pending during login even before its generation changes', async () => {
    onPassword = () => { policy!.password_reset_pending = true; };
    const result = response();
    await expect(loginAdmin(request(), result.res, user.email, 'old-password')).rejects.toMatchObject({ status: 401 });
    expect(policy!.session_version).toBe(0);
    expectCleared(result.cookies());
  });

  it('requires the post-grant Auth UUID to match the preflight account even when its fresh policy is valid', async () => {
    onPassword = () => {
      profile.id = '22222222-2222-4222-8222-222222222222';
      policy!.user_id = String(profile.id);
    };
    const result = response();
    await expect(loginAdmin(request(), result.res, user.email, 'password')).rejects.toMatchObject({ status: 401 });
    expectCleared(result.cookies());
  });

  it('permits a new password login after reset completion and binds the captured generation', async () => {
    policy!.session_version = 2;
    const result = response();
    expect(await loginAdmin(request(), result.res, user.email, 'new-password')).toEqual(expectedSession({ sessionVersion: 2 }));
    const generation = generationFrom(result.cookies());
    expect(await getAdminSession(request({ cookie: cookieHeader(access, refresh, generation) }), response().res)).toMatchObject({ sessionVersion: 2 });
    expect(result.cookies()?.every(value => !value.includes('Max-Age=0'))).toBe(true);
  });

  it('uses fresh capabilities when ordinary policy edits race an otherwise valid login', async () => {
    onPassword = () => { policy!.version++; policy!.permissions.correctStats = true; };
    expect(await loginAdmin(request(), response().res, user.email, 'password')).toEqual(expectedSession({ accountVersion: 2,
      permissions: { ...presetPermissions('organizer'), correctStats: true } }));
  });
});

describe('signed session generations', () => {
  it('accepts a legacy session only at generation zero and binds it without exposing tokens', async () => {
    const result = response();
    expect(await getAdminSession(request({ cookie: cookieHeader() }), result.res)).toEqual(expectedSession());
    expect(result.cookies()).toHaveLength(1); expect(result.cookies()![0]).toContain(`${ADMIN_GENERATION_COOKIE}=`);
    policy!.session_version = 1;
    const reset = response();
    expect(await getAdminSession(request({ cookie: cookieHeader() }), reset.res)).toBeNull(); expectCleared(reset.cookies());
  });

  it('never renews a tampered or malformed binding, even with a valid access token and generation zero', async () => {
    const generation = await signedGeneration(); vi.mocked(fetch).mockClear();
    const tampered = generation.slice(0, -1) + (generation.endsWith('A') ? 'B' : 'A');
    for (const value of [tampered, 'v1.not-signed', generation.replace('v1.', 'v2.')]) {
      const result = response();
      expect(await getAdminSession(request({ cookie: cookieHeader(access, refresh, value) }), result.res)).toBeNull();
      expectCleared(result.cookies());
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a valid signed binding paired with a different verified Auth UUID', async () => {
    const generation = await signedGeneration();
    profile.id = '22222222-2222-4222-8222-222222222222'; policy!.user_id = String(profile.id);
    const result = response();
    expect(await getAdminSession(request({ cookie: cookieHeader(access, refresh, generation) }), result.res)).toBeNull(); expectCleared(result.cookies());
  });

  it('suspension and reactivation invalidate old sessions until a fresh password login', async () => {
    const generation = await signedGeneration();
    policy!.active = false; policy!.version = 2; policy!.session_version = 1;
    const suspended = response();
    expect(await getAdminSession(request({ cookie: cookieHeader(access, refresh, generation) }), suspended.res)).toBeNull(); expectCleared(suspended.cookies());
    policy!.active = true; policy!.version = 3; policy!.session_version = 2;
    const reactivated = response();
    expect(await getAdminSession(request({ cookie: cookieHeader(access, refresh, generation) }), reactivated.res)).toBeNull(); expectCleared(reactivated.cookies());
    const fresh = response();
    expect(await loginAdmin(request({ cookie: cookieHeader(access, refresh, generation) }), fresh.res, user.email, 'new-password')).toMatchObject({ sessionVersion: 2 });
    expect(await getAdminSession(request({ cookie: cookieHeader(access, refresh, generationFrom(fresh.cookies())) }), response().res)).toMatchObject({ sessionVersion: 2 });
  });

  it('rejects an old generation before refreshing access after a password reset', async () => {
    const generation = await signedGeneration(); vi.mocked(fetch).mockClear();
    policy!.session_version = 1;
    const result = response();
    expect(await getAdminSession(request({ cookie: cookieHeader(null, refresh, generation) }), result.res)).toBeNull();
    expectCleared(result.cookies());
    expect(paths()).toEqual(['/rest/v1/rpc/get_admin_access']);
  });

  it('never upgrades a missing legacy binding past generation zero through a refresh token', async () => {
    policy!.session_version = 1;
    const result = response();
    expect(await getAdminSession(request({ cookie: cookieHeader(null, refresh) }), result.res)).toBeNull(); expectCleared(result.cookies());
    expect(paths()).toContain('/auth/v1/token?grant_type=refresh_token');
    expect(result.cookies()!.some(value => !value.includes('Max-Age=0'))).toBe(false);
  });

  it('detects a reset racing a permitted provider refresh instead of minting a new generation', async () => {
    const generation = await signedGeneration(); vi.mocked(fetch).mockClear();
    onRefresh = () => { policy!.session_version++; };
    const result = response();
    expect(await getAdminSession(request({ cookie: cookieHeader(null, refresh, generation) }), result.res)).toBeNull(); expectCleared(result.cookies());
    expect(paths().filter(path => path === '/rest/v1/rpc/get_admin_access')).toHaveLength(2);
  });

  it('rejects pending reset sessions before refreshing or accepting their existing access token', async () => {
    const generation = await signedGeneration();
    policy!.password_reset_pending = true;
    vi.mocked(fetch).mockClear();
    const refreshed = response();
    expect(await getAdminSession(request({ cookie: cookieHeader(null, refresh, generation) }), refreshed.res)).toBeNull();
    expectCleared(refreshed.cookies());
    expect(paths()).toEqual(['/rest/v1/rpc/get_admin_access']);
    vi.mocked(fetch).mockClear();
    const existing = response();
    expect(await getAdminSession(request({ cookie: cookieHeader(access, refresh, generation) }), existing.res)).toBeNull();
    expectCleared(existing.cookies());
    expect(paths()).toEqual(['/auth/v1/user', '/rest/v1/rpc/get_admin_access']);
  });

  it('rejects a reset becoming pending during a permitted refresh even without a generation change', async () => {
    const generation = await signedGeneration();
    onRefresh = () => { policy!.password_reset_pending = true; };
    const result = response();
    expect(await getAdminSession(request({ cookie: cookieHeader(null, refresh, generation) }), result.res)).toBeNull();
    expectCleared(result.cookies());
  });

  it('rotates tokens and preserves a valid nonzero generation after a normal access-token expiry', async () => {
    policy!.session_version = 3;
    const generation = await signedGeneration(); vi.mocked(fetch).mockClear(); expiredAccess = true;
    const result = response();
    expect(await getAdminSession(request({ cookie: cookieHeader(access, refresh, generation) }), result.res)).toMatchObject({ sessionVersion: 3 });
    expect(result.cookies()![0]).toContain('rotated-access'); expect(result.cookies()![1]).toContain('rotated-refresh');
    expect(generationFrom(result.cookies())).toBe(generation);
    expect(paths()).toEqual(['/auth/v1/user', '/rest/v1/rpc/get_admin_access', '/auth/v1/token?grant_type=refresh_token', '/auth/v1/user', '/rest/v1/rpc/get_admin_access']);
  });

  it('rejects a binding after its signing key changes and clears a stale generation-only cookie', async () => {
    const generation = await signedGeneration(); vi.mocked(fetch).mockClear(); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'new-server-key');
    const result = response();
    expect(await getAdminSession(request({ cookie: cookieHeader(access, refresh, generation) }), result.res)).toBeNull(); expectCleared(result.cookies());
    expect(fetch).not.toHaveBeenCalled();
    const stale = response();
    expect(await getAdminSession(request({ cookie: cookieHeader(null, null, generation) }), stale.res)).toBeNull(); expectCleared(stale.cookies());
  });
});

describe('admin provider lifecycle and request safety', () => {
  it('renews an epoch-zero refresh-only session and independently verifies its fresh identity and policy', async () => {
    const result = response();
    expect(await getAdminSession(request({ cookie: cookieHeader(null, refresh) }), result.res)).toEqual(expectedSession());
    expect(paths()).toEqual(['/auth/v1/token?grant_type=refresh_token', '/auth/v1/user', '/rest/v1/rpc/get_admin_access']);
    expect(result.cookies()![0]).toContain('rotated-access'); expect(result.cookies()![0]).toContain('Max-Age=1800');
    expect(result.cookies()).toHaveLength(3);
  });

  it('permits local HTTP development cookies without weakening HTTPS deployments', async () => {
    const result = response();
    await loginAdmin(request({ host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173' }), result.res, user.email, 'password');
    expect(result.cookies()!.some(item => item.includes('; Secure'))).toBe(false);
    expect(result.cookies()!.every(item => item.includes('HttpOnly'))).toBe(true);
  });

  it('always clears all logout cookies including during a provider outage', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('private upstream details'));
    const result = response();
    await expect(logoutAdmin(request({ cookie: cookieHeader() }), result.res)).resolves.toBeUndefined();
    expectCleared(result.cookies()); expect(paths()[0]).toBe('/auth/v1/logout?scope=local');
  });

  it('revokes refresh-only logout sessions without issuing replacement browser cookies', async () => {
    const result = response();
    await logoutAdmin(request({ cookie: cookieHeader(null, refresh) }), result.res);
    expect(paths()).toEqual(['/auth/v1/token?grant_type=refresh_token', '/auth/v1/logout?scope=local']);
    expect(new Headers(vi.mocked(fetch).mock.calls[1]![1]!.headers).get('authorization')).toBe('Bearer rotated-access');
    expectCleared(result.cookies()); expect(result.cookies()!.join('')).not.toContain('rotated-access');
  });

  it.each([401, 403])('revokes expired-access logout sessions via a refresh after status %s', async status => {
    logoutExpired = status;
    const result = response();
    await logoutAdmin(request({ cookie: cookieHeader() }), result.res);
    expect(paths()).toEqual(['/auth/v1/logout?scope=local', '/auth/v1/token?grant_type=refresh_token', '/auth/v1/logout?scope=local']);
    expectCleared(result.cookies());
  });

  it('clears malformed token cookies without contacting Auth or throwing', async () => {
    const result = response();
    await expect(logoutAdmin(request({ cookie: `${ADMIN_REFRESH_COOKIE}=%00invalid` }), result.res)).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled(); expectCleared(result.cookies());
  });

  it('keeps credential errors generic, preserves rate limits, and does not leak upstream messages', async () => {
    const secret = 'do-not-expose-password-token';
    const invalid = response();
    vi.mocked(fetch).mockResolvedValueOnce(json(defaultPolicy())).mockResolvedValueOnce(json({ message: secret }, 400));
    await expect(loginAdmin(request(), invalid.res, user.email, secret)).rejects.toMatchObject({ status: 401,
      message: 'E-mail ou senha inválidos, ou acesso de administrador não liberado.' });
    expectCleared(invalid.cookies());
    vi.mocked(fetch).mockResolvedValueOnce(json(defaultPolicy())).mockResolvedValueOnce(json({ message: secret }, 429));
    await expect(loginAdmin(request(), response().res, user.email, secret)).rejects.toMatchObject({ status: 429 });
    vi.mocked(fetch).mockResolvedValueOnce(json(defaultPolicy())).mockRejectedValueOnce(new Error(secret));
    await expect(loginAdmin(request(), response().res, user.email, secret)).rejects.toMatchObject({ status: 503, message: expect.not.stringContaining(secret) });
  });

  it('preserves the browser session on temporary policy or provider outages and rejects malformed token replies', async () => {
    policyError = { status: 500 };
    const result = response();
    await expect(getAdminSession(request({ cookie: cookieHeader() }), result.res)).rejects.toMatchObject({ status: 503 });
    expect(result.cookies()).toBeUndefined(); policyError = null;
    vi.mocked(fetch).mockResolvedValueOnce(json(defaultPolicy())).mockResolvedValueOnce(json({ ...tokens, access_token: '\nheader-injection' }));
    await expect(loginAdmin(request(), response().res, user.email, 'password')).rejects.toMatchObject({ status: 503 });
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    await expect(loginAdmin(request(), response().res, user.email, 'password')).rejects.toMatchObject({ status: 503 });
  });
});

describe('admin mutation origins', () => {
  it('allows same-origin browser requests and server clients without Origin', () => {
    expect(() => assertSameOrigin(request({ origin: 'https://valorantscrim.vercel.app', 'sec-fetch-site': 'same-origin' }))).not.toThrow();
    expect(() => assertSameOrigin(request())).not.toThrow();
    expect(() => assertSameOrigin(request({ host: 'localhost:4173', origin: 'http://localhost:4173' }))).not.toThrow();
  });
  it('rejects foreign origins, null origins, insecure production origins and cross-site requests', () => {
    const cases: Record<string, string>[] = [
      { origin: 'https://attacker.example' }, { origin: 'null' }, { origin: 'http://valorantscrim.vercel.app' },
      { origin: 'https://valorantscrim.vercel.app.attacker.example' }, { 'sec-fetch-site': 'cross-site' },
      { origin: 'https://valorantscrim.vercel.app', 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' },
    ];
    for (const headers of cases) expect(() => assertSameOrigin(request(headers))).toThrow(AdminAuthError);
  });
});
