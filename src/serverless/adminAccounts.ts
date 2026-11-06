/** Server-only account management. Supabase owns passwords; Postgres owns access. */
import type { IncomingMessage } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AdminAuthError, assertSameOrigin, type AdminSession } from './adminAuth.js';
import {
  parsePermissions, presetPermissions,
  type AdminAccount, type AdminAccountsPage, type AdminPermissions, type AdminPreset,
} from '../shared/adminPermissions.js';

type Database = (path: string, options?: RequestInit) => Promise<any>;
type Reply = { status: number; body: unknown };
type Request = IncomingMessage & { body?: unknown };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_BODY = 16_384;

class ProviderFailure extends AdminAuthError {
  constructor(status: number, message: string, readonly kind: 'auth_rejected' | 'auth_unavailable') { super(status, message); }
}

function bad(message = 'Confira os dados do administrador e tente novamente.'): never { throw new AdminAuthError(400, message); }
function only(body: Record<string, unknown>, fields: readonly string[]) {
  if (Object.keys(body).some(key => !fields.includes(key))) bad('A alteração contém campos não permitidos.');
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new AdminAuthError(404, 'Administrador não encontrado.');
  return value.toLowerCase();
}
function email(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length > 254 || !/^[^\s@]+@[^\s@]+$/.test(value.trim())) bad('Informe um e-mail em formato válido.');
  return value.trim().toLowerCase();
}
function name(value: unknown, fallback?: string): string {
  if (value === undefined && fallback) return fallback.slice(0, 80);
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(value)) bad('Informe um nome com até 80 caracteres.');
  return value.trim();
}
function preset(value: unknown): AdminPreset {
  if (value !== 'organizer' && value !== 'full') bad('Escolha o modelo Organizador ou Completo.');
  return value;
}
function permissions(value: unknown): AdminPermissions {
  try { return parsePermissions(value); }
  catch { return bad('As permissões devem conter somente as ações disponíveis, ligadas ou desligadas.'); }
}
function version(value: unknown, pending = false): number {
  if (!Number.isSafeInteger(value) || (value as number) < (pending ? 0 : 1)) bad('Atualize a lista antes de alterar esta conta.');
  return value as number;
}
function password(value: unknown): string {
  if (typeof value !== 'string' || value.length > 256 || value.trim().length < 8) bad('Defina uma senha com pelo menos 8 caracteres e no máximo 256.');
  return value;
}
function passwordFingerprint(id: string, secret: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new AdminAuthError(503, 'A gestão de contas está indisponível.');
  // Temporary, server-keyed equality proof for safe resumption of an uncertain
  // reset. It is never returned, audited, or usable as a password verifier.
  return createHmac('sha256', key).update(`valorantscrim:password-reset:v1:${id}\0${secret}`).digest('hex');
}

type ResetOutcome = 'success' | 'rejected' | 'unknown';
interface ResetRecovery { auditId: number; attemptVersion: number; outcome: ResetOutcome; }
function recoverySignature(payload: string, fingerprint: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new AdminAuthError(503, 'A gestão de contas está indisponível.');
  return createHmac('sha256', key).update('valorantscrim:password-reset-recovery:v1:')
    .update(payload).update('\0').update(fingerprint).digest('base64url');
}
/** A completion receipt authorizes only the recorded attempt and same candidate. */
function recoveryToken(actor: AdminSession, id: string, recovery: ResetRecovery, fingerprint: string): string {
  const payload = Buffer.from(JSON.stringify([actor.userId, id, recovery.auditId, recovery.attemptVersion, recovery.outcome])).toString('base64url');
  return `v1.${payload}.${recoverySignature(payload, fingerprint)}`;
}
function readRecovery(value: unknown, actor: AdminSession, id: string, fingerprint: string): ResetRecovery | null {
  if (value === undefined) return null;
  const invalid = () => bad('Não foi possível conferir a recuperação desta redefinição. Confira a conta e tente novamente.');
  const match = typeof value === 'string' && /^v1\.([A-Za-z0-9_-]{1,1024})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) return invalid();
  const payload = match[1]!, signature = match[2]!;
  const supplied = Buffer.from(signature, 'base64url');
  const expectedSignature = Buffer.from(recoverySignature(payload, fingerprint), 'base64url');
  if (supplied.length !== expectedSignature.length || supplied.toString('base64url') !== signature || !timingSafeEqual(supplied, expectedSignature)) return invalid();
  try {
    const decoded = Buffer.from(payload, 'base64url');
    if (decoded.toString('base64url') !== payload) return invalid();
    const fields: unknown = JSON.parse(decoded.toString('utf8'));
    if (!Array.isArray(fields) || fields.length !== 5 || fields[0] !== actor.userId || fields[1] !== id ||
        !Number.isSafeInteger(fields[2]) || fields[2] < 1 || !Number.isSafeInteger(fields[3]) || fields[3] < 1 ||
        !['success', 'rejected', 'unknown'].includes(fields[4])) return invalid();
    return { auditId: fields[2], attemptVersion: fields[3], outcome: fields[4] as ResetOutcome };
  } catch { return invalid(); }
}

function finishReset(db: Database, actor: AdminSession, recovery: ResetRecovery) {
  return rpc(db, 'finish_admin_password_reset', {
    p_actor_id: actor.userId, p_audit_id: recovery.auditId, p_attempt_version: recovery.attemptVersion,
    p_succeeded: recovery.outcome === 'success', p_error_code: recovery.outcome === 'success' ? null : recovery.outcome === 'rejected' ? 'auth_rejected' : 'unknown',
  });
}
function recoveryReply(actor: AdminSession, id: string, account: AdminAccount, recovery: ResetRecovery, fingerprint: string): Reply {
  return { status: 503, body: {
    error: 'A conclusão não foi confirmada. Conclua com esta mesma senha antes de compartilhar o acesso.',
    account: { ...account, passwordResetPending: true }, samePasswordRequired: true,
    recoveryToken: recoveryToken(actor, id, recovery, fingerprint),
  } };
}

async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) bad('Envie os dados em JSON.');
  let raw: string;
  if (req.body !== undefined) {
    try { raw = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body); }
    catch { return bad('JSON inválido.'); }
  } else {
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_BODY) throw new AdminAuthError(413, 'Requisição muito grande.');
      chunks.push(buffer);
    }
    raw = Buffer.concat(chunks).toString('utf8') || '{}';
  }
  if (Buffer.byteLength(raw) > MAX_BODY) throw new AdminAuthError(413, 'Requisição muito grande.');
  try { const parsed: unknown = JSON.parse(raw); if (object(parsed)) return parsed; }
  catch { /* The caller receives a safe validation message. */ }
  return bad('JSON inválido.');
}

/** Explicit projection: neither Auth responses nor DB internals become public DTOs. */
function dto(value: unknown): AdminAccount {
  if (!object(value) || typeof value.id !== 'string' || !UUID.test(value.id) ||
      typeof value.email !== 'string' || typeof value.displayName !== 'string' ||
      typeof value.active !== 'boolean' || typeof value.isSuperAdmin !== 'boolean' || typeof value.provisioned !== 'boolean' ||
      !Number.isSafeInteger(value.version) || (value.version as number) < (value.provisioned ? 1 : 0) ||
      (!value.provisioned && value.version !== 0) ||
      !Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.updatedAt) ||
      (value.preset !== 'organizer' && value.preset !== 'full')) {
    throw new AdminAuthError(503, 'Não foi possível conferir a conta. Atualize a lista e tente novamente.');
  }
  let parsed: AdminPermissions;
  try { parsed = parsePermissions(value.permissions); }
  catch { throw new AdminAuthError(503, 'Não foi possível conferir as permissões da conta.'); }
  return {
    id: value.id, email: value.email, displayName: value.displayName, active: value.active,
    preset: value.preset, permissions: parsed, version: value.version as number, isSuperAdmin: value.isSuperAdmin,
    provisioned: value.provisioned, createdAt: value.createdAt as number, updatedAt: value.updatedAt as number,
    passwordResetPending: value.passwordResetPending === true,
  };
}
async function rpc(db: Database, fn: string, parameters: Record<string, unknown>): Promise<any> {
  return db(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(parameters) });
}
async function target(db: Database, actor: AdminSession, userId: string): Promise<AdminAccount> {
  const value = await rpc(db, 'get_admin_account', { p_actor_id: actor.userId, p_user_id: userId });
  if (!value) throw new AdminAuthError(404, 'Administrador não encontrado.');
  const account = dto(value);
  if (account.isSuperAdmin || account.id === actor.userId) throw new AdminAuthError(403, 'A conta principal é protegida neste painel.');
  return account;
}
function expected(account: AdminAccount, requested: number) {
  if (account.version !== requested) throw new AdminAuthError(409, 'Esta conta mudou em outro lugar. Atualize a lista e confira antes de salvar.');
}

async function authAdmin(path: string, method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, ''), key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !/^https:\/\/[A-Za-z0-9.-]+$/.test(url)) throw new ProviderFailure(503, 'A gestão de contas está indisponível. Tente novamente.', 'auth_unavailable');
  let response: Response;
  try {
    response = await fetch(`${url}/auth/v1/admin/${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch { throw new ProviderFailure(503, 'Não foi possível confirmar a operação. Confira a lista antes de tentar novamente.', 'auth_unavailable'); }
  const value: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = object(value) && typeof value.code === 'string' ? value.code : '';
    // An identical retry may find that the first request already set this exact
    // password. The provider's specific code confirms that desired outcome.
    if (method === 'PUT' && code === 'same_password') return { alreadySet: true };
    if (['email_exists', 'user_already_exists', 'identity_already_exists'].includes(code) || response.status === 409) {
      throw new ProviderFailure(409, 'Já existe uma conta com esse e-mail. Confira os administradores cadastrados.', 'auth_rejected');
    }
    if (response.status === 429) throw new ProviderFailure(429, 'Muitas tentativas. Aguarde um pouco antes de tentar novamente.', 'auth_rejected');
    if ([400, 422].includes(response.status)) throw new ProviderFailure(400, 'O Supabase recusou os dados. Confira o e-mail e as regras da senha do projeto.', 'auth_rejected');
    throw new ProviderFailure(503, 'A gestão de contas está indisponível. Tente novamente.', 'auth_unavailable');
  }
  if (!object(value)) throw new ProviderFailure(503, 'Não foi possível confirmar a operação. Atualize a lista.', 'auth_unavailable');
  return value;
}

export async function handleAdminAccountRoute(req: Request, segments: string[], actor: AdminSession, db: Database): Promise<Reply> {
  if (!actor.isSuperAdmin) throw new AdminAuthError(403, 'Esta área é exclusiva do super admin.');
  if (req.method !== 'GET') assertSameOrigin(req);
  if (segments.length === 0 && req.method === 'GET') {
    const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
    const integer = (key: string, fallback: number, min: number, max: number) => {
      const raw = query.get(key); if (raw === null) return fallback;
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < min || Number(raw) > max) bad('A paginação da lista é inválida.');
      return Number(raw);
    };
    const offset = integer('offset', 0, 0, 1_000_000), limit = integer('limit', 25, 1, 100);
    const search = (query.get('q') ?? '').trim(), status = query.get('status') ?? 'all';
    if (search.length > 100 || /[\u0000-\u001f\u007f]/.test(search) || !['all', 'active', 'suspended', 'pending'].includes(status)) bad('O filtro da lista é inválido.');
    const result = await rpc(db, 'list_admin_accounts', { p_actor_id: actor.userId, p_offset: offset, p_limit: limit, p_query: search, p_status: status });
    if (!object(result) || !Array.isArray(result.accounts) || !Number.isSafeInteger(result.total) || (result.total as number) < 0 ||
        !(result.nextOffset === null || (Number.isSafeInteger(result.nextOffset) && (result.nextOffset as number) > offset))) {
      throw new AdminAuthError(503, 'Não foi possível carregar a lista de administradores.');
    }
    const page: AdminAccountsPage = { accounts: result.accounts.map(dto), total: result.total as number, nextOffset: result.nextOffset as number | null };
    return { status: 200, body: page };
  }
  if (segments.length === 0 && req.method === 'POST') {
    const body = await bodyOf(req); only(body, ['email', 'password', 'displayName', 'preset', 'permissions']);
    const address = email(body.email), secret = password(body.password), displayName = name(body.displayName, address.split('@')[0]);
    const profile = body.preset === undefined ? 'organizer' : preset(body.preset);
    const allowed = body.permissions === undefined ? presetPermissions(profile) : permissions(body.permissions);
    let result: Record<string, unknown>;
    try {
      result = await authAdmin('users', 'POST', {
        email: address, password: secret, email_confirm: true,
        app_metadata: { scrim_console_managed: true, scrim_console_display_name: displayName, scrim_console_preset: profile, scrim_console_permissions: allowed },
      });
    } catch (error) {
      if (error instanceof ProviderFailure && error.kind === 'auth_unavailable') return { status: error.status, body: { error: error.message, pending: true } };
      throw error;
    }
    const user = object(result.user) ? result.user : result;
    if (typeof user.id !== 'string' || !UUID.test(user.id) || user.id === actor.userId) return { status: 503, body: { error: 'Não foi possível confirmar a criação. Confira a lista antes de tentar novamente.', pending: true } };
    const id = user.id;
    try {
      const account = dto(await rpc(db, 'register_admin_account', { p_actor_id: actor.userId, p_user_id: id, p_display_name: displayName, p_preset: profile, p_permissions: allowed, p_active: true }));
      return { status: 201, body: { account } };
    } catch {
      // The Auth identity is harmless without an active canonical account. Its
      // managed marker lets the owner complete a partial creation from the UI.
      return { status: 503, body: { error: 'A conta foi criada, mas o acesso está pendente. Atualize a lista e use Concluir cadastro.', pending: true, accountId: id } };
    }
  }
  if (!segments.length || segments.length > 2) throw new AdminAuthError(405, 'Método ou rota não permitido.');
  const id = identifier(segments[0]);
  if (segments.length === 1 && req.method === 'PATCH') {
    const body = await bodyOf(req); only(body, ['expectedVersion', 'displayName', 'preset', 'permissions']);
    const requested = version(body.expectedVersion, true), account = await target(db, actor, id); expected(account, requested);
    const profile = body.preset === undefined ? account.preset : preset(body.preset);
    const allowed = body.permissions === undefined ? (body.preset === undefined ? account.permissions : presetPermissions(profile)) : permissions(body.permissions);
    const updated = dto(await rpc(db, 'update_admin_account', {
      p_actor_id: actor.userId, p_user_id: id, p_expected_version: requested,
      p_display_name: body.displayName === undefined ? account.displayName : name(body.displayName), p_preset: profile, p_permissions: allowed,
    }));
    return { status: 200, body: { account: updated } };
  }
  if (segments.length === 2 && segments[1] === 'status' && req.method === 'POST') {
    const body = await bodyOf(req); only(body, ['expectedVersion', 'active']);
    if (typeof body.active !== 'boolean') bad('Escolha suspender ou reativar a conta.');
    const requested = version(body.expectedVersion), account = await target(db, actor, id); expected(account, requested);
    if (!account.provisioned) bad('Conclua o cadastro antes de alterar o status da conta.');
    const updated = dto(await rpc(db, 'set_admin_account_active', { p_actor_id: actor.userId, p_user_id: id, p_expected_version: requested, p_active: body.active }));
    return { status: 200, body: { account: updated } };
  }
  if (segments.length === 2 && segments[1] === 'password' && req.method === 'POST') {
    const body = await bodyOf(req); only(body, ['expectedVersion', 'password', 'recoveryToken']);
    const requested = version(body.expectedVersion), secret = password(body.password), fingerprint = passwordFingerprint(id, secret);
    const recovery = readRecovery(body.recoveryToken, actor, id, fingerprint);
    let account = await target(db, actor, id);
    if (!recovery) expected(account, requested);
    if (!account.provisioned) bad('Conclua o cadastro antes de redefinir a senha.');
    if (recovery) {
      // A signed known outcome can finish without another native password write.
      // Unknown outcomes first release only their own attempt for a safe retry.
      try { await finishReset(db, actor, recovery); }
      catch (error) {
        if ((error as { status?: number }).status === 409) throw error;
        return recoveryReply(actor, id, account, recovery, fingerprint);
      }
      if (recovery.outcome !== 'unknown') {
        let current: AdminAccount;
        try { current = await target(db, actor, id); }
        catch { return recoveryReply(actor, id, account, recovery, fingerprint); }
        if (current.passwordResetPending) return { status: 409, body: {
          error: 'Há outra redefinição em andamento. Atualize a conta antes de continuar.', account: current,
        } };
        return recovery.outcome === 'success' ? { status: 200, body: { account: current } } : { status: 400, body: {
          error: 'A senha foi recusada. Confira as regras do projeto antes de redefinir novamente.', account: current,
        } };
      }
      try { account = await target(db, actor, id); }
      catch { return recoveryReply(actor, id, account, recovery, fingerprint); }
      if (account.version !== requested) return { status: 409, body: {
        error: 'Esta conta mudou. Confira o acesso atualizado e conclua com a mesma senha.', account,
        samePasswordRequired: true, recoveryToken: body.recoveryToken,
      } };
    }
    let begun: any;
    try {
      begun = await rpc(db, 'begin_admin_password_reset', {
        p_actor_id: actor.userId, p_user_id: id, p_expected_version: requested,
        p_password_fingerprint: fingerprint,
      });
    } catch (error) {
      if ((error as { status?: number }).status === 409) {
        const current = await target(db, actor, id);
        if (current.passwordResetPending) return { status: 409, body: {
          error: 'Há uma redefinição em andamento. Se a tentativa anterior não foi confirmada, conclua usando a mesma senha.',
          samePasswordRequired: true, account: current,
        } };
      }
      throw error;
    }
    if (!object(begun) || !Number.isSafeInteger(begun.auditId) || (begun.auditId as number) < 1 ||
        !Number.isSafeInteger(begun.attemptVersion) || (begun.attemptVersion as number) < 1 || !begun.account) throw new AdminAuthError(503, 'Não foi possível iniciar a redefinição da senha.');
    const updated = dto(begun.account);
    const attempt = { auditId: begun.auditId as number, attemptVersion: begun.attemptVersion as number };
    try {
      await authAdmin(`users/${id}`, 'PUT', { password: secret });
    } catch (error) {
      const code = error instanceof ProviderFailure ? error.kind : 'unknown';
      const outcome: ResetOutcome = code === 'auth_rejected' ? 'rejected' : 'unknown';
      let finalized = true;
      try { await rpc(db, 'finish_admin_password_reset', { p_actor_id: actor.userId, p_audit_id: attempt.auditId,
        p_attempt_version: attempt.attemptVersion, p_succeeded: false, p_error_code: code }); }
      catch { finalized = false; }
      if (!finalized) return recoveryReply(actor, id, updated, { ...attempt, outcome }, fingerprint);
      const status = error instanceof AdminAuthError ? error.status : 503;
      const uncertain = code !== 'auth_rejected';
      return { status, body: {
        error: uncertain ? 'As sessões foram encerradas, mas a troca não foi confirmada. Tente concluir com esta mesma senha; não gere outra enquanto a operação estiver pendente.' : 'As sessões anteriores foram encerradas, mas a senha foi recusada. Confira as regras do projeto antes de redefinir novamente.',
        account: { ...updated, passwordResetPending: uncertain }, samePasswordRequired: uncertain,
      } };
    }
    // A successful provider update is not complete until the login barrier is
    // cleared. Retain the same-value recovery flow if finalization is uncertain.
    try { await finishReset(db, actor, { ...attempt, outcome: 'success' }); }
    catch { return recoveryReply(actor, id, updated, { ...attempt, outcome: 'success' }, fingerprint); }
    return { status: 200, body: { account: { ...updated, passwordResetPending: false } } };
  }
  throw new AdminAuthError(405, 'Método ou rota não permitido.');
}
