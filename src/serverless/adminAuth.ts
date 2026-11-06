/** Server-only Supabase Auth sessions. The browser never receives bearer tokens. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parsePermissions, presetPermissions, type AdminPermissions } from '../shared/adminPermissions.js';

export const ADMIN_ACCESS_COOKIE = 'vscrim_admin_access';
export const ADMIN_REFRESH_COOKIE = 'vscrim_admin_refresh';
export const ADMIN_GENERATION_COOKIE = 'vscrim_admin_generation';
const GENERATION_DOMAIN = 'valorantscrim:admin-generation:v1:';
const POLICY_MIGRATION = 'Aplique a migração 20261105_super_admin.sql no Supabase para liberar a administração.';
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60;
const ACCESS_MAX_AGE = 60 * 60;
const UNAVAILABLE = 'Login indisponível no momento. Tente novamente.';
const INVALID_LOGIN = 'E-mail ou senha inválidos, ou acesso de administrador não liberado.';

export class AdminAuthError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface AdminSession {
  userId: string;
  email: string;
  isSuperAdmin: boolean;
  permissions: AdminPermissions;
  accountVersion: number;
  sessionVersion: number;
  /** Compatibility alias for older presentation code. */
  canDeleteRooms: boolean;
}
interface AccountPolicy {
  userId: string; active: boolean; isSuperAdmin: boolean; permissions: AdminPermissions;
  version: number; sessionVersion: number; passwordResetPending: boolean;
}
interface GenerationBinding { userId: string; version: number; }
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

function appendCookies(res: ServerResponse, values: string[]): void {
  const existing = res.getHeader('set-cookie');
  const previous = Array.isArray(existing) ? existing : existing === undefined ? [] : [String(existing)];
  res.setHeader('set-cookie', [...previous, ...values]);
}

function generationSignature(payload: string): string {
  return createHmac('sha256', environment().key).update(GENERATION_DOMAIN).update(payload).digest('base64url');
}

function generationValue(session: Pick<AdminSession, 'userId' | 'sessionVersion'>): string {
  const payload = Buffer.from(JSON.stringify([session.userId, session.sessionVersion])).toString('base64url');
  return `v1.${payload}.${generationSignature(payload)}`;
}

function readGeneration(req: IncomingMessage): { provided: boolean; binding: GenerationBinding | null } {
  const provided = !!header(req, 'cookie')?.split(';').some(part => part.trim().startsWith(`${ADMIN_GENERATION_COOKIE}=`));
  if (!provided) return { provided: false, binding: null };
  const value = readCookie(req, ADMIN_GENERATION_COOKIE);
  const match = value && /^v1\.([A-Za-z0-9_-]{1,512})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) return { provided: true, binding: null };
  const payload = match[1]!, signature = match[2]!;
  const supplied = Buffer.from(signature, 'base64url');
  const expected = Buffer.from(generationSignature(payload), 'base64url');
  if (supplied.length !== expected.length || supplied.toString('base64url') !== signature ||
      !timingSafeEqual(supplied, expected)) return { provided: true, binding: null };
  try {
    const decoded = Buffer.from(payload, 'base64url');
    if (decoded.toString('base64url') !== payload) throw new Error();
    const value: unknown = JSON.parse(decoded.toString('utf8'));
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || !value[0] || value[0].length > 128 ||
        !Number.isSafeInteger(value[1]) || value[1] < 0) throw new Error();
    return { provided: true, binding: { userId: value[0], version: value[1] } };
  } catch { return { provided: true, binding: null }; }
}

function bindingMatches(session: AdminSession, binding: GenerationBinding | null): boolean {
  return binding ? binding.userId === session.userId && binding.version === session.sessionVersion : session.sessionVersion === 0;
}

function setCookies(req: IncomingMessage, res: ServerResponse, tokens: Tokens | null, session?: AdminSession): void {
  if (tokens && !session) throw new AdminAuthError(503, UNAVAILABLE);
  appendCookies(res, [
    cookie(req, ADMIN_ACCESS_COOKIE, tokens?.access ?? '', tokens?.maxAge ?? 0),
    cookie(req, ADMIN_REFRESH_COOKIE, tokens?.refresh ?? '', tokens ? REFRESH_MAX_AGE : 0),
    cookie(req, ADMIN_GENERATION_COOKIE, tokens && session ? generationValue(session) : '', tokens ? REFRESH_MAX_AGE : 0),
  ]);
}

async function fetchAccountPolicy(rpc: 'get_admin_access' | 'get_admin_login_policy', parameters: Record<string, string>, userId?: string): Promise<AccountPolicy | null> {
  const { url, key } = environment();
  let response: Response;
  try {
    response = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
      method: 'POST', headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(parameters), signal: AbortSignal.timeout(15_000), redirect: 'error',
    });
  } catch { throw new AdminAuthError(503, UNAVAILABLE); }
  if (!response.ok) {
    const error: unknown = await response.json().catch(() => null);
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code === 'PGRST202' || code === '42883') throw new AdminAuthError(503, POLICY_MIGRATION);
    throw new AdminAuthError(503, UNAVAILABLE);
  }
  try {
    const text = await response.text();
    const value: unknown = text ? JSON.parse(text) : null;
    if (value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const row = value as Record<string, unknown>;
    if (typeof row.user_id !== 'string' || !row.user_id || row.user_id.length > 128) throw new Error();
    if (userId && row.user_id !== userId) return null;
    if (typeof row.active !== 'boolean' || typeof row.is_super_admin !== 'boolean' ||
        typeof row.password_reset_pending !== 'boolean' ||
        !Number.isSafeInteger(row.version) || (row.version as number) < 1 ||
        !Number.isSafeInteger(row.session_version) || (row.session_version as number) < 0) throw new Error();
    return { userId: row.user_id, active: row.active, isSuperAdmin: row.is_super_admin, permissions: parsePermissions(row.permissions),
      version: row.version as number, sessionVersion: row.session_version as number, passwordResetPending: row.password_reset_pending };
  } catch { throw new AdminAuthError(503, UNAVAILABLE); }
}

function accountPolicy(userId: string): Promise<AccountPolicy | null> {
  return fetchAccountPolicy('get_admin_access', { p_user_id: userId }, userId);
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
  if (typeof body.id !== 'string' || !body.id || typeof body.email !== 'string' || !body.email) {
    return { session: null, invalidToken: false };
  }
  const policy = await accountPolicy(body.id);
  if (!policy?.active || policy.passwordResetPending) return { session: null, invalidToken: false };
  // UUID is pinned by the private policy. Email confirmation is independently
  // checked against Auth; neither metadata nor the signed cookie grants ownership.
  const isSuperAdmin = policy.isSuperAdmin && policy.userId === body.id &&
    body.email.toLowerCase() === 'caio.oliveira2014@hotmail.com' &&
    typeof body.email_confirmed_at === 'string' && body.email_confirmed_at.trim().length > 0;
  const permissions = isSuperAdmin ? presetPermissions('full') : policy.permissions;
  return { session: { userId: body.id, email: body.email, isSuperAdmin, permissions,
    accountVersion: policy.version, sessionVersion: policy.sessionVersion, canDeleteRooms: permissions.deleteRooms }, invalidToken: false };
}

/** Auth establishes identity; fresh private policy establishes all capabilities. */
export async function getAdminSession(req: IncomingMessage, res: ServerResponse): Promise<AdminSession | null> {
  const rawCookies = header(req, 'cookie');
  const access = readCookie(req, ADMIN_ACCESS_COOKIE);
  const refresh = readCookie(req, ADMIN_REFRESH_COOKIE);
  if (!access && !refresh) {
    if ([ADMIN_ACCESS_COOKIE, ADMIN_REFRESH_COOKIE, ADMIN_GENERATION_COOKIE].some(name => rawCookies?.split(';').some(part => part.trim().startsWith(`${name}=`)))) setCookies(req, res, null);
    return null;
  }
  const generation = readGeneration(req);
  if (generation.provided && !generation.binding) { setCookies(req, res, null); return null; }
  if (access) {
    const verified = await verifyUser(access);
    if (verified.session) {
      if (!bindingMatches(verified.session, generation.binding)) { setCookies(req, res, null); return null; }
      if (!generation.provided) appendCookies(res, [cookie(req, ADMIN_GENERATION_COOKIE, generationValue(verified.session), REFRESH_MAX_AGE)]);
      return verified.session;
    }
    if (!verified.invalidToken) { setCookies(req, res, null); return null; }
  }
  if (!refresh) { setCookies(req, res, null); return null; }
  // A signed old generation can be rejected before touching a refresh token.
  // We still verify Auth identity and policy again after any permitted refresh.
  if (generation.binding) {
    const policy = await accountPolicy(generation.binding.userId);
    if (!policy?.active || policy.passwordResetPending || policy.sessionVersion !== generation.binding.version) {
      setCookies(req, res, null); return null;
    }
  }
  const response = await authFetch('token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: refresh }) });
  if ([400, 401, 403, 422].includes(response.status)) { setCookies(req, res, null); return null; }
  if (!response.ok) providerError(response);
  const tokens = await tokensFrom(response);
  const verified = await verifyUser(tokens.access);
  if (!verified.session || !bindingMatches(verified.session, generation.binding)) { setCookies(req, res, null); return null; }
  setCookies(req, res, tokens, verified.session);
  return verified.session;
}

export async function loginAdmin(req: IncomingMessage, res: ServerResponse, email: unknown, password: unknown): Promise<AdminSession> {
  assertSameOrigin(req);
  if (typeof email !== 'string' || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email.trim()) ||
      typeof password !== 'string' || !password || password.length > 256) throw new AdminAuthError(401, INVALID_LOGIN);
  const normalizedEmail = email.trim().toLowerCase();
  // Capture the generation before Auth can accept a password. A reset may change
  // it while the password grant is in flight, so fresh policy alone is not enough.
  const initialPolicy = await fetchAccountPolicy('get_admin_login_policy', { p_email: normalizedEmail });
  if (!initialPolicy?.active || initialPolicy.passwordResetPending) {
    setCookies(req, res, null); throw new AdminAuthError(401, INVALID_LOGIN);
  }
  const response = await authFetch('token?grant_type=password', {
    method: 'POST', body: JSON.stringify({ email: normalizedEmail, password }),
  });
  if ([400, 401, 403, 422].includes(response.status)) {
    setCookies(req, res, null); throw new AdminAuthError(401, INVALID_LOGIN);
  }
  if (!response.ok) providerError(response);
  const tokens = await tokensFrom(response);
  // The token response's user/claims are not an authorization decision.
  const verified = await verifyUser(tokens.access);
  if (!verified.session || verified.session.userId !== initialPolicy.userId || verified.session.sessionVersion !== initialPolicy.sessionVersion) {
    setCookies(req, res, null); throw new AdminAuthError(401, INVALID_LOGIN);
  }
  setCookies(req, res, tokens, verified.session);
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
