/** Server-only Supabase Auth sessions. The browser never receives bearer tokens. */
import type { IncomingMessage, ServerResponse } from 'node:http';

export const ADMIN_ACCESS_COOKIE = 'vscrim_admin_access';
export const ADMIN_REFRESH_COOKIE = 'vscrim_admin_refresh';
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60;
const ACCESS_MAX_AGE = 60 * 60;
const UNAVAILABLE = 'Login indisponível no momento. Tente novamente.';
const INVALID_LOGIN = 'E-mail ou senha inválidos, ou acesso de administrador não liberado.';

export class AdminAuthError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface AdminSession { userId: string; email: string; canDeleteRooms: boolean; }
interface Tokens { access: string; refresh: string; maxAge: number; }
interface VerifiedUser { session: AdminSession | null; invalidToken: boolean; }

function environment() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !/^https:\/\/[A-Za-z0-9.-]+$/.test(url)) {
    throw new AdminAuthError(503, UNAVAILABLE);
  }
  return { url, key };
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function localHost(req: IncomingMessage): boolean {
  try {
    const hostname = new URL(`http://${header(req, 'host') || ''}`).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch { return false; }
}

/** Browser mutations are same-origin; non-browser clients may omit Origin. */
export function assertSameOrigin(req: IncomingMessage): void {
  const origin = header(req, 'origin');
  const fetchSite = header(req, 'sec-fetch-site');
  if (req.headers.origin !== undefined && origin === undefined) {
    throw new AdminAuthError(403, 'Acesse o login pelo próprio site.');
  }
  if (fetchSite === 'cross-site' || (!origin && fetchSite === 'same-site')) {
    throw new AdminAuthError(403, 'Acesse o login pelo próprio site.');
  }
  if (origin === undefined) return;
  try {
    const requestHost = header(req, 'host');
    if (!requestHost || origin === 'null') throw new Error();
    const expected = new URL(`${localHost(req) ? 'http' : 'https'}://${requestHost}`);
    const supplied = new URL(origin);
    if (supplied.origin !== expected.origin || supplied.pathname !== '/' || supplied.search || supplied.hash || supplied.username || supplied.password) throw new Error();
  } catch { throw new AdminAuthError(403, 'Acesse o login pelo próprio site.'); }
}

function validToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/[^\x21-\x7e]/.test(value) && encodeURIComponent(value).length <= 3800;
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
  const raw = header(req, 'cookie');
  if (!raw || raw.length > 16_384) return undefined;
  const matches = raw.split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (matches.length !== 1) return undefined;
  try {
    const token = decodeURIComponent(matches[0]!.slice(name.length + 1));
    return validToken(token) ? token : undefined;
  } catch { return undefined; }
}

function cookie(req: IncomingMessage, name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${localHost(req) ? '' : '; Secure'}`;
}

function setCookies(req: IncomingMessage, res: ServerResponse, tokens: Tokens | null): void {
  const existing = res.getHeader('set-cookie');
  const previous = Array.isArray(existing) ? existing : existing === undefined ? [] : [String(existing)];
  res.setHeader('set-cookie', [...previous,
    cookie(req, ADMIN_ACCESS_COOKIE, tokens?.access ?? '', tokens?.maxAge ?? 0),
    cookie(req, ADMIN_REFRESH_COOKIE, tokens?.refresh ?? '', tokens ? REFRESH_MAX_AGE : 0),
  ]);
}

async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const { url, key } = environment();
  try {
    return await fetch(`${url}/auth/v1/${path}`, {
      ...options,
      headers: { apikey: key, 'content-type': 'application/json', ...options.headers },
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
  } catch { throw new AdminAuthError(503, UNAVAILABLE); }
}

function providerError(response: Response): never {
  if (response.status === 429) throw new AdminAuthError(429, 'Muitas tentativas. Aguarde um pouco e tente novamente.');
  throw new AdminAuthError(503, UNAVAILABLE);
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new AdminAuthError(503, UNAVAILABLE); }
}

async function tokensFrom(response: Response): Promise<Tokens> {
  const body = await parseJson(response);
  if (!validToken(body.access_token) || !validToken(body.refresh_token) || typeof body.expires_in !== 'number' ||
      !Number.isFinite(body.expires_in) || body.expires_in < 1) throw new AdminAuthError(503, UNAVAILABLE);
  return { access: body.access_token, refresh: body.refresh_token, maxAge: Math.min(ACCESS_MAX_AGE, Math.floor(body.expires_in)) };
}

async function verifyUser(access: string): Promise<VerifiedUser> {
  const response = await authFetch('user', { headers: { authorization: `Bearer ${access}` } });
  if (response.status === 401 || response.status === 403) return { session: null, invalidToken: true };
  if (!response.ok) providerError(response);
  const body = await parseJson(response);
  const metadata = body.app_metadata;
  const admin = !!metadata && typeof metadata === 'object' && !Array.isArray(metadata) &&
    Object.prototype.hasOwnProperty.call(metadata, 'scrim_admin') && (metadata as Record<string, unknown>).scrim_admin === true;
  if (!admin || typeof body.id !== 'string' || !body.id || typeof body.email !== 'string' || !body.email) {
    return { session: null, invalidToken: false };
  }
  const canDeleteRooms = (metadata as Record<string, unknown>).scrim_delete_rooms === true ||
    (body.email.toLowerCase() === 'caio.oliveira2014@hotmail.com' &&
      typeof body.email_confirmed_at === 'string' && body.email_confirmed_at.trim().length > 0);
  return { session: { userId: body.id, email: body.email, canDeleteRooms }, invalidToken: false };
}

/** Verifies roles against Auth on every request, so revoking metadata takes effect immediately. */
export async function getAdminSession(req: IncomingMessage, res: ServerResponse): Promise<AdminSession | null> {
  const rawCookies = header(req, 'cookie');
  const access = readCookie(req, ADMIN_ACCESS_COOKIE);
  const refresh = readCookie(req, ADMIN_REFRESH_COOKIE);
  if (!access && !refresh) {
    if (rawCookies?.includes(`${ADMIN_ACCESS_COOKIE}=`) || rawCookies?.includes(`${ADMIN_REFRESH_COOKIE}=`)) setCookies(req, res, null);
    return null;
  }
  if (access) {
    const verified = await verifyUser(access);
    if (verified.session) return verified.session;
    if (!verified.invalidToken) { setCookies(req, res, null); return null; }
  }
  if (!refresh) { setCookies(req, res, null); return null; }
  const response = await authFetch('token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: refresh }) });
  if ([400, 401, 403, 422].includes(response.status)) { setCookies(req, res, null); return null; }
  if (!response.ok) providerError(response);
  const tokens = await tokensFrom(response);
  const verified = await verifyUser(tokens.access);
  if (!verified.session) { setCookies(req, res, null); return null; }
  setCookies(req, res, tokens);
  return verified.session;
}

export async function loginAdmin(req: IncomingMessage, res: ServerResponse, email: unknown, password: unknown): Promise<AdminSession> {
  assertSameOrigin(req);
  if (typeof email !== 'string' || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email.trim()) ||
      typeof password !== 'string' || !password || password.length > 256) throw new AdminAuthError(401, INVALID_LOGIN);
  const response = await authFetch('token?grant_type=password', {
    method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  if ([400, 401, 403, 422].includes(response.status)) throw new AdminAuthError(401, INVALID_LOGIN);
  if (!response.ok) providerError(response);
  const tokens = await tokensFrom(response);
  // The token response's user/claims are not an authorization decision.
  const verified = await verifyUser(tokens.access);
  if (!verified.session) { setCookies(req, res, null); throw new AdminAuthError(401, INVALID_LOGIN); }
  setCookies(req, res, tokens);
  return verified.session;
}

export async function logoutAdmin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  assertSameOrigin(req);
  const access = readCookie(req, ADMIN_ACCESS_COOKIE);
  const refresh = readCookie(req, ADMIN_REFRESH_COOKIE);
  // Never issue replacement cookies during logout, even when a refresh is needed
  // to revoke a session whose short-lived access cookie has already expired.
  setCookies(req, res, null);
  try {
    if (access) {
      const response = await authFetch('logout?scope=local', { method: 'POST', headers: { authorization: `Bearer ${access}` } });
      if (response.status !== 401 && response.status !== 403) return;
    }
    if (!refresh) return;
    const response = await authFetch('token?grant_type=refresh_token', {
      method: 'POST', body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!response.ok) return;
    const tokens = await tokensFrom(response);
    await authFetch('logout?scope=local', { method: 'POST', headers: { authorization: `Bearer ${tokens.access}` } });
  } catch { /* Logout always clears the local browser session, including during an outage. */ }
}
