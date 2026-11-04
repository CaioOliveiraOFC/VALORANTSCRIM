import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ADMIN_ACCESS_COOKIE, ADMIN_REFRESH_COOKIE, AdminAuthError,
  assertSameOrigin, getAdminSession, loginAdmin, logoutAdmin,
} from './adminAuth.js';

const access = 'opaque-access-token';
const refresh = 'opaque-refresh-token';
const user = { id: 'user-admin-1', email: 'admin@example.com', app_metadata: { scrim_admin: true } };
const tokens = { access_token: access, refresh_token: refresh, expires_in: 3600 };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
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
function cookieHeader(accessToken: string | null = access, refreshToken: string | null = refresh) {
  return [accessToken ? `${ADMIN_ACCESS_COOKIE}=${encodeURIComponent(accessToken)}` : '',
    refreshToken ? `${ADMIN_REFRESH_COOKIE}=${encodeURIComponent(refreshToken)}` : ''].filter(Boolean).join('; ');
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-test-key');
  vi.stubGlobal('fetch', vi.fn(async () => json(user)));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('server-only admin authentication', () => {
  it('does not contact Auth or need credentials for anonymous spectators', async () => {
    vi.stubEnv('SUPABASE_URL', ''); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const { res, cookies } = response();
    expect(await getAdminSession(request(), res)).toBeNull();
    expect(fetch).not.toHaveBeenCalled(); expect(cookies()).toBeUndefined();
  });

  it('signs in, independently verifies the role, and keeps tokens only in secure HttpOnly cookies', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...tokens, user: { ...user, app_metadata: {} } })).mockResolvedValueOnce(json(user));
    const { res, cookies } = response();
    const session = await loginAdmin(request({ origin: 'https://valorantscrim.vercel.app' }), res, '  ADMIN@example.com ', ' secret password ');
    expect(session).toEqual({ userId: user.id, email: user.email });
    expect(JSON.stringify(session)).not.toMatch(/token|secret password|server-test-key/);
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0]![0]).toBe('https://test.supabase.co/auth/v1/token?grant_type=password');
    expect(JSON.parse(String(calls[0]![1]!.body))).toEqual({ email: 'admin@example.com', password: ' secret password ' });
    expect(new Headers(calls[0]![1]!.headers).get('apikey')).toBe('server-test-key');
    expect(calls[1]![0]).toBe('https://test.supabase.co/auth/v1/user');
    expect(new Headers(calls[1]![1]!.headers).get('authorization')).toBe(`Bearer ${access}`);
    expect(cookies()).toHaveLength(2);
    for (const item of cookies()!) {
      expect(item).toContain('HttpOnly'); expect(item).toContain('Secure');
      expect(item).toContain('SameSite=Lax'); expect(item).toContain('Path=/'); expect(item).not.toContain('Domain=');
    }
    expect(cookies()![0]).toContain('Max-Age=3600'); expect(cookies()![1]).toContain('Max-Age=604800');
  });

  it('does not trust the token response, editable user metadata, or a string-valued admin flag', async () => {
    for (const profile of [
      { ...user, app_metadata: {}, user_metadata: { scrim_admin: true } },
      { ...user, app_metadata: { scrim_admin: 'true' } },
      { ...user, app_metadata: { role: 'admin' } },
    ]) {
      vi.mocked(fetch).mockResolvedValueOnce(json({ ...tokens, user })).mockResolvedValueOnce(json(profile));
      const { res, cookies } = response();
      await expect(loginAdmin(request(), res, user.email, 'password')).rejects.toMatchObject({ status: 401 });
      expect(cookies()!.every(item => item.includes('Max-Age=0'))).toBe(true);
      expect(cookies()!.join('')).not.toContain(access);
    }
  });

  it('checks current provider metadata on every request so removing an admin role revokes access', async () => {
    const req = request({ cookie: cookieHeader() });
    expect(await getAdminSession(req, response().res)).toEqual({ userId: user.id, email: user.email });
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...user, app_metadata: {} }));
    const revoked = response();
    expect(await getAdminSession(req, revoked.res)).toBeNull();
    expect(revoked.cookies()!.every(item => item.includes('Max-Age=0'))).toBe(true);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith('/user'))).toBe(true);
  });

  it('refreshes an expired access token and rotates both cookies only after verifying the new user', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ message: 'expired' }, 401))
      .mockResolvedValueOnce(json({ ...tokens, access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 1800 }))
      .mockResolvedValueOnce(json(user));
    const { res, cookies } = response();
    expect(await getAdminSession(request({ cookie: cookieHeader() }), res)).toEqual({ userId: user.id, email: user.email });
    expect(vi.mocked(fetch).mock.calls[1]![0]).toBe('https://test.supabase.co/auth/v1/token?grant_type=refresh_token');
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]!.body))).toEqual({ refresh_token: refresh });
    expect(cookies()![0]).toContain('rotated-access'); expect(cookies()![0]).toContain('Max-Age=1800');
    expect(cookies()![1]).toContain('rotated-refresh');
  });

  it('can restore a session after the browser has expired the access cookie', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(tokens)).mockResolvedValueOnce(json(user));
    const { res } = response();
    expect(await getAdminSession(request({ cookie: cookieHeader(null, refresh) }), res)).toEqual({ userId: user.id, email: user.email });
    expect(vi.mocked(fetch).mock.calls[0]![0]).toContain('grant_type=refresh_token');
  });

  it('clears invalid or revoked refresh credentials without turning upstream errors into admin sessions', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ message: 'expired' }, 401)).mockResolvedValueOnce(json({ message: 'revoked' }, 400));
    const invalid = response();
    expect(await getAdminSession(request({ cookie: cookieHeader() }), invalid.res)).toBeNull();
    expect(invalid.cookies()!.every(item => item.includes('Max-Age=0'))).toBe(true);
    const malformed = response();
    expect(await getAdminSession(request({ cookie: `${ADMIN_ACCESS_COOKIE}=%00bad` }), malformed.res)).toBeNull();
    expect(malformed.cookies()!.every(item => item.includes('Max-Age=0'))).toBe(true);
  });

  it('permits local HTTP development cookies without weakening HTTPS deployments', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(tokens)).mockResolvedValueOnce(json(user));
    const { res, cookies } = response();
    await loginAdmin(request({ host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173' }), res, user.email, 'password');
    expect(cookies()!.some(item => item.includes('; Secure'))).toBe(false);
    expect(cookies()!.every(item => item.includes('HttpOnly'))).toBe(true);
  });

  it('always clears logout cookies and asks Auth to invalidate the current provider session', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('internal network detail with token'));
    const { res, cookies } = response();
    await expect(logoutAdmin(request({ cookie: cookieHeader() }), res)).resolves.toBeUndefined();
    expect(cookies()!.every(item => item.includes('Max-Age=0'))).toBe(true);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('https://test.supabase.co/auth/v1/logout?scope=local');
  });

  it('revokes a refresh-only session without issuing replacement browser cookies', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...tokens, access_token: 'logout-access', refresh_token: 'logout-refresh' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { res, cookies } = response();
    await expect(logoutAdmin(request({ cookie: cookieHeader(null, refresh) }), res)).resolves.toBeUndefined();
    expect(vi.mocked(fetch).mock.calls[0]![0]).toContain('token?grant_type=refresh_token');
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body))).toEqual({ refresh_token: refresh });
    expect(vi.mocked(fetch).mock.calls[1]![0]).toContain('logout?scope=local');
    expect(new Headers(vi.mocked(fetch).mock.calls[1]![1]!.headers).get('authorization')).toBe('Bearer logout-access');
    expect(cookies()).toHaveLength(2);
    expect(cookies()!.every(item => item.includes('Max-Age=0'))).toBe(true);
    expect(cookies()!.join('')).not.toContain('logout-access');
    expect(cookies()!.join('')).not.toContain('logout-refresh');
  });

  it.each([401, 403])('refreshes only to revoke after logout rejects the expired access token with %s', async status => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ message: 'expired' }, status))
      .mockResolvedValueOnce(json({ ...tokens, access_token: 'revocation-access' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { res, cookies } = response();
    await expect(logoutAdmin(request({ cookie: cookieHeader() }), res)).resolves.toBeUndefined();
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls.map(([url]) => String(url).split('/auth/v1/')[1])).toEqual([
      'logout?scope=local', 'token?grant_type=refresh_token', 'logout?scope=local',
    ]);
    expect(new Headers(calls[2]![1]!.headers).get('authorization')).toBe('Bearer revocation-access');
    expect(cookies()!.every(item => item.includes('Max-Age=0'))).toBe(true);
  });

  it('clears malformed refresh-only cookies without contacting Auth or throwing', async () => {
    const { res, cookies } = response();
    await expect(logoutAdmin(request({ cookie: `${ADMIN_REFRESH_COOKIE}=%00invalid` }), res)).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(cookies()!.every(item => item.includes('Max-Age=0'))).toBe(true);
  });

  it('returns generic credential errors and preserves provider rate limits without leaking response details', async () => {
    const secret = 'do-not-expose-password-token';
    vi.mocked(fetch).mockResolvedValueOnce(json({ message: secret }, 400));
    const invalid = await loginAdmin(request(), response().res, user.email, secret).catch(error => error as AdminAuthError);
    expect(invalid).toMatchObject({ status: 401 });
    if (!(invalid instanceof AdminAuthError)) throw new Error('Expected an auth error');
    expect(invalid.message).not.toContain(secret);
    vi.mocked(fetch).mockResolvedValueOnce(json({ message: secret }, 429));
    await expect(loginAdmin(request(), response().res, user.email, secret)).rejects.toMatchObject({ status: 429 });
    vi.mocked(fetch).mockRejectedValueOnce(new Error(secret));
    const outage = await loginAdmin(request(), response().res, user.email, secret).catch(error => error as AdminAuthError);
    expect(outage).toMatchObject({ status: 503 });
    if (!(outage instanceof AdminAuthError)) throw new Error('Expected an auth error');
    expect(outage.message).not.toContain(secret);
  });

  it('does not log out a valid browser session because Auth is temporarily unavailable', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ message: 'unavailable' }, 500));
    const { res, cookies } = response();
    await expect(getAdminSession(request({ cookie: cookieHeader() }), res)).rejects.toMatchObject({ status: 503 });
    expect(cookies()).toBeUndefined();
  });

  it('fails closed for malformed token responses and absent server configuration', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...tokens, access_token: '\nheader-injection' }));
    await expect(loginAdmin(request(), response().res, user.email, 'password')).rejects.toMatchObject({ status: 503 });
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    await expect(loginAdmin(request(), response().res, user.email, 'password')).rejects.toMatchObject({ status: 503 });
  });
});

describe('admin mutation origins', () => {
  it('allows same-origin browser requests and non-browser clients without Origin', () => {
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
