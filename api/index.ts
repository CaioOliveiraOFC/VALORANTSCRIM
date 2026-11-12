/** API serverless Vercel: somente o serviço usa a chave secreta do Supabase. */
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { noPermissions, type AdminPermissionKey } from '../src/shared/adminPermissions.js';
import { handleAdminAccountRoute } from '../src/serverless/adminAccounts.js';
import { AdminAuthError, assertSameOrigin, getAdminSession, loginAdmin, logoutAdmin, type AdminSession } from '../src/serverless/adminAuth.js';
import { fetchMatch, findMatches, ProviderError, regionCode } from '../src/server/henrik.js';
import type { PlayerLink } from '../src/shared/imports.js';
import { MAPS } from '../src/shared/maps.js';
import { toMarkdown } from '../src/shared/report.js';
import { applyEvent, initialState, DomainError, seriesScore, type Command, type ScrimEvent, type ScrimState } from '../src/shared/scrim.js';
import type { SeriesFormat } from '../src/shared/veto.js';
import type { RoomAccess, ScrimSummary } from '../src/shared/protocol.js';
import {
  activeDraw, validateFocusTarget, DRAW_REVEAL_MS, DRAW_TTL_MS, ROOM_FOCUS_TTL_MS,
  type RoomDraw, type RoomToolsEvent,
} from '../src/shared/roomTools.js';

const NO_PERMISSIONS = noPermissions();

const ID_RE = /^[a-z0-9]{6,32}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const MAX_BODY = 16 * 1024;
const ACCESS_MIGRATION = 'Aplique a migração 20261105_super_admin.sql no Supabase para usar a administração e a propriedade das salas.';
const HOME_MIGRATION = 'Aplique a migração 20261112_home_feature.sql no Supabase para fixar uma sala na página inicial.';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = (key: string) => createHash('sha256').update(key).digest('hex');

class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function env() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !/^https:\/\/[\w.-]+$/.test(url)) {
    throw new ApiError(503, 'Supabase não configurado. Consulte README-VERCEL.md.');
  }
  return { url, key };
}

async function db(path: string, options: RequestInit = {}): Promise<any> {
  const { url, key } = env();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...options.headers,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { message?: string; code?: string };
    if (['rpc/get_public_home_feature', 'rpc/get_home_feature_admin', 'rpc/set_home_feature'].includes(path) && ['PGRST202', '42703', '42P01'].includes(error.code ?? '')) throw new ApiError(503, HOME_MIGRATION);
    if (error.message?.includes('STALE_HOME_FEATURE')) throw new ApiError(409, 'O destaque mudou em outra aba. Recarregue e revise a seleção.');
    if (error.message?.includes('ROOM_NOT_PUBLIC')) throw new ApiError(400, 'Escolha uma sala publicada e disponível para os espectadores.');
    if ((['42703', '42P01', 'PGRST204', 'PGRST205'].includes(error.code ?? '') &&
          (path.startsWith('scrims?') || path.startsWith('scrim_admin_'))) ||
        (path.startsWith('rpc/') && path !== 'rpc/claim_match_lookup' && error.code === 'PGRST202')) throw new ApiError(503, ACCESS_MIGRATION);
    if (error.message?.includes('SCRIM_DELETED') || error.message?.includes('ROOM_DELETED')) throw new ApiError(404, 'Scrim não encontrada.');
    if (error.message?.includes('ADMIN_NOT_FOUND')) throw new ApiError(404, 'Administrador não encontrado.');
    if (error.message?.includes('OWNER_PROTECTED')) throw new ApiError(403, 'A conta principal está protegida.');
    if (error.message?.includes('ADMIN_FORBIDDEN')) throw new ApiError(403, 'Sua conta não tem permissão para esta ação.');
    if (error.message?.includes('INVALID_ADMIN_INPUT')) throw new ApiError(400, 'Dados administrativos inválidos.');
    if (error.message?.includes('RESET_IN_PROGRESS')) throw new ApiError(409, 'Há uma redefinição de senha em andamento.');
    if (['STALE_ADMIN_VERSION', 'STALE_ACCESS', 'ACCESS_STALE', 'ACCESS_VERSION_CONFLICT'].some(marker => error.message?.includes(marker))) throw new ApiError(409, 'Outra alteração foi gravada. Atualize e tente novamente.');
    if (error.message?.includes('INVALID_ACCESS')) throw new ApiError(400, 'Alteração de acesso inválida.');
    if (path === 'rpc/claim_match_lookup' && error.code === 'PGRST202') throw new ApiError(503, 'Importação indisponível: aplique a migração 20261017_match_imports.sql no Supabase.');
    if (path === 'rpc/import_owned_match' && error.code === '23505') throw new ApiError(409, 'Esta partida já foi importada nesta scrim.');
    if (error.message?.includes('STALE_OR_FORBIDDEN')) throw new ApiError(409, 'Outra ação foi gravada. Recarregue e tente novamente.');
    console.error('Erro no Supabase:', response.status, error.code);
    throw new ApiError(502, 'Falha ao consultar o banco de dados.');
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

interface DbAccess { id: string; is_public: boolean; deleted_at: number | null; access_version: number; owner_user_id: string; created_by_user_id: string | null; }
interface DbScrim extends DbAccess { admin_key_hash: string; state: ScrimState; version: number; }

function accessOf(row: DbAccess): RoomAccess {
  if (typeof row.is_public !== 'boolean' || !(row.deleted_at === null || (Number.isSafeInteger(row.deleted_at) && row.deleted_at >= 0)) ||
      !Number.isInteger(row.access_version) || row.access_version < 1) throw new ApiError(503, ACCESS_MIGRATION);
  return { isPublic: row.is_public, deletedAt: row.deleted_at, accessVersion: row.access_version };
}

async function room(id: string): Promise<DbScrim> {
  if (!ID_RE.test(id)) throw new ApiError(404, 'Scrim não encontrada.');
  const rows = await db(`scrims?select=id,admin_key_hash,state,version,is_public,deleted_at,access_version,owner_user_id,created_by_user_id&id=eq.${id}&limit=1`) as DbScrim[];
  if (!rows.length) throw new ApiError(404, 'Scrim não encontrada.');
  accessOf(rows[0]!);
  if (!UUID_RE.test(rows[0]!.owner_user_id ?? '')) throw new ApiError(503, ACCESS_MIGRATION);
  return rows[0]!;
}

async function roomAccess(id: string): Promise<DbAccess> {
  if (!ID_RE.test(id)) throw new ApiError(404, 'Scrim não encontrada.');
  const rows = await db(`scrims?select=id,is_public,deleted_at,access_version,owner_user_id,created_by_user_id&id=eq.${id}&limit=1`) as DbAccess[];
  if (!rows.length) throw new ApiError(404, 'Scrim não encontrada.');
  accessOf(rows[0]!);
  if (!UUID_RE.test(rows[0]!.owner_user_id ?? '')) throw new ApiError(503, ACCESS_MIGRATION);
  return rows[0]!;
}

function managesRoom(row: DbAccess, actor: AdminSession | null): actor is AdminSession {
  return !!actor && (actor.isSuperAdmin || row.owner_user_id === actor.userId);
}

function requireReadable(row: DbAccess, actor: AdminSession | null): void {
  if (row.deleted_at !== null || (!row.is_public && !managesRoom(row, actor))) throw new ApiError(404, 'Scrim não encontrada.');
}

function requirePermission(session: AdminSession, permission: AdminPermissionKey): void {
  if (!session.isSuperAdmin && session.permissions[permission] !== true) throw new ApiError(403, 'Sua conta não tem permissão para esta ação.');
}

function requireOwnership(row: DbAccess, session: AdminSession): void {
  if (!managesRoom(row, session)) {
    if (!row.is_public || row.deleted_at !== null) throw new ApiError(404, 'Scrim não encontrada.');
    throw new ApiError(403, 'Você só pode administrar suas próprias salas.');
  }
}

function sessionBody(session: AdminSession | null) {
  return session ? { authenticated: true, user: { email: session.email }, isSuperAdmin: session.isSuperAdmin,
    permissions: { ...session.permissions, canDeleteRooms: session.permissions.deleteRooms } }
    : { authenticated: false, isSuperAdmin: false, permissions: { ...NO_PERMISSIONS, canDeleteRooms: false } };
}

function scopedSession(row: DbAccess, session: AdminSession | null) {
  const managed = managesRoom(row, session);
  const permissions = managed ? session.permissions : NO_PERMISSIONS;
  return { role: managed ? 'admin' : 'viewer', permissions: { ...permissions, canDeleteRooms: permissions.deleteRooms }, isSuperAdmin: session?.isSuperAdmin === true };
}

function commandPermission(type: string): AdminPermissionKey {
  if (type === 'settings.update') return 'editRoom';
  if (['team.rename', 'team.captain', 'player.add', 'player.rename', 'player.remove', 'player.assign', 'teams.set'].includes(type)) return 'manageTeams';
  if (['veto.start', 'veto.ban', 'veto.pick', 'veto.side', 'veto.undo', 'veto.reset'].includes(type)) return 'manageVeto';
  if (type === 'stats.set') return 'correctStats';
  if (type === 'note.add') return 'manageNotes';
  throw new ApiError(400, 'Comando inválido.');
}

/** Each tool accepts only its intent; winners and clocks are server-owned. */
function toolFields(body: Record<string, unknown>, fields: string[]) {
  const allowed = new Set(['action', ...fields]);
  if (Object.keys(body).some((field) => !allowed.has(field))) {
    throw new ApiError(400, 'Campos de sorteio ou foco inválidos. Envie apenas a ação desejada.');
  }
}

function requestId(value: unknown): string {
  if (typeof value !== 'string' || !REQUEST_ID_RE.test(value)) throw new ApiError(400, 'Identificador da tentativa inválido.');
  return value;
}

function drawPurpose(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ApiError(400, 'Explique o que está sendo sorteado em até 160 caracteres.');
  }
  return value.trim();
}

async function jsonBody(req: IncomingMessage & { body?: unknown }): Promise<Record<string, unknown>> {
  // Vercel may have already consumed and parsed the request stream.
  if (req.body !== undefined) {
    const raw = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body);
    if (Buffer.byteLength(raw) > MAX_BODY) throw new ApiError(413, 'Requisição muito grande.');
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      return parsed as Record<string, unknown>;
    } catch { throw new ApiError(400, 'JSON inválido.'); }
  }
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    bytes += (chunk as Buffer).length;
    if (bytes > MAX_BODY) throw new ApiError(413, 'Requisição muito grande.');
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { throw new ApiError(400, 'JSON inválido.'); }
}

function send(res: ServerResponse, status: number, value: unknown, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(typeof value === 'string' ? value : JSON.stringify(value));
}

function summary(state: ScrimState): ScrimSummary {
  const score = seriesScore(state);
  return {
    id: state.id, title: state.title, createdAt: state.createdAt,
    updatedAt: state.updatedAt, phase: state.phase,
    teams: [state.teams.A.name, state.teams.B.name], score: [score.A, score.B],
    maps: state.maps.map((m) => MAPS[m.mapId].name),
  };
}

async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://localhost');
  // A single verified role lookup per request, shared by visibility and mutation checks.
  let actorPromise: Promise<AdminSession | null> | undefined;
  const actor = () => actorPromise ??= getAdminSession(req, res);
  const requireAdmin = async (): Promise<AdminSession> => {
    assertSameOrigin(req);
    const session = await actor();
    if (!session) throw new ApiError(403, 'Entre como administrador para editar a sala.');
    return session;
  };
  const path = (url.searchParams.get('route') || url.pathname.replace(/^\/api\/(?:index\/?|)/, '')).split('/').filter(Boolean);
  if (path[0] === 'health' && req.method === 'GET') {
    await db('scrims?select=id,is_public,deleted_at,access_version,owner_user_id,created_by_user_id&limit=1');
    return send(res, 200, { ok: true, storage: 'supabase', realtime: 'supabase-postgres-changes' });
  }
  if (path.length === 2 && path[0] === 'home' && path[1] === 'featured' && req.method === 'GET') {
    try { return send(res, 200, await db('rpc/get_public_home_feature', { method: 'POST', body: '{}' })); }
    catch (error) {
      // Pinning is optional: a pending upgrade must not break public rooms.
      if (error instanceof ApiError && error.status === 503 && error.message === HOME_MIGRATION) return send(res, 200, { roomId: null });
      throw error;
    }
  }
  if (path[0] === 'admin') {
    if (path.length === 2 && path[1] === 'home-feature') {
      const session = await actor();
      if (!session?.isSuperAdmin) throw new ApiError(403, 'Somente a conta principal pode fixar uma sala na página inicial.');
      if (req.method === 'GET') return send(res, 200, await db('rpc/get_home_feature_admin', { method: 'POST', body: JSON.stringify({ p_actor_id: session.userId, p_actor_session_version: session.sessionVersion }) }));
      if (req.method !== 'PUT') throw new ApiError(405, 'Método não permitido.');
      assertSameOrigin(req);
      const input = await jsonBody(req);
      if (Object.keys(input).some(key => !['roomId', 'expectedVersion'].includes(key)) ||
          (input.roomId !== null && (typeof input.roomId !== 'string' || !ID_RE.test(input.roomId))) ||
          !Number.isInteger(input.expectedVersion) || (input.expectedVersion as number) < 1) throw new ApiError(400, 'Revise a sala e a versão do destaque.');
      return send(res, 200, await db('rpc/set_home_feature', { method: 'POST', body: JSON.stringify({ p_actor_id: session.userId, p_actor_session_version: session.sessionVersion, p_expected_version: input.expectedVersion, p_scrim_id: input.roomId }) }));
    }
    if (path[1] === 'accounts') {
      const session = await actor();
      if (!session?.isSuperAdmin) throw new ApiError(403, 'Somente a conta principal pode gerenciar administradores.');
      if (req.method !== 'GET') assertSameOrigin(req);
      const result = await handleAdminAccountRoute(req, path.slice(2), session, db);
      return send(res, result.status, result.body);
    }
    if (path.length === 2 && path[1] === 'session' && req.method === 'GET') {
      const session = await actor();
      return send(res, 200, sessionBody(session));
    }
    if (path.length === 2 && path[1] === 'login' && req.method === 'POST') {
      assertSameOrigin(req);
      if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new ApiError(400, 'Envie os dados de login em JSON.');
      const input = await jsonBody(req);
      if (Object.keys(input).some(key => !['email', 'password'].includes(key))) throw new ApiError(400, 'Dados de login inválidos.');
      const session = await loginAdmin(req, res, input.email, input.password);
      return send(res, 200, sessionBody(session));
    }
    if (path.length === 2 && path[1] === 'logout' && req.method === 'POST') {
      assertSameOrigin(req);
      await logoutAdmin(req, res);
      return send(res, 200, sessionBody(null));
    }
    throw new ApiError(405, 'Método ou rota não permitido.');
  }
  if (path[0] !== 'scrims') throw new ApiError(404, 'Rota não encontrada.');

  if (path.length === 1 && req.method === 'POST') {
    const session = await requireAdmin();
    requirePermission(session, 'createRooms');
    const input = await jsonBody(req);
    if (Object.keys(input).some(key => !['title', 'format', 'isPublic'].includes(key))) throw new ApiError(400, 'Dados da sala inválidos.');
    if (input.isPublic !== undefined && typeof input.isPublic !== 'boolean') throw new ApiError(400, 'Escolha se a sala aparece para espectadores.');
    const isPublic = input.isPublic ?? false;
    if (isPublic) requirePermission(session, 'publishRooms');
    const format = input.format;
    if (format !== 'bo1' && format !== 'bo3' && format !== 'bo5') throw new ApiError(400, 'Formato inválido.');
    const title = typeof input.title === 'string' ? input.title : 'Scrim';
    const id = randomBytes(6).toString('hex');
    const adminKey = randomBytes(24).toString('base64url');
    const event: ScrimEvent = { seq: 1, at: Date.now(), type: 'scrim.create', id, title, format: format as SeriesFormat };
    const state = applyEvent(initialState(), event);
    await db('rpc/create_owned_scrim', { method: 'POST', body: JSON.stringify({
      p_id: id, p_key_hash: hash(adminKey), p_actor_id: session.userId, p_actor_session_version: session.sessionVersion, p_state: state, p_event: event, p_at: event.at, p_is_public: isPublic,
    }) });
    return send(res, 201, { id });
  }

  if (path.length === 1 && req.method === 'GET') {
    if (url.searchParams.get('scope') === 'admin') {
      const session = await actor();
      if (!session) throw new ApiError(403, 'Entre como administrador para acessar as salas internas.');
      const deleted = url.searchParams.get('deleted') === 'true';
      if (deleted && !session.isSuperAdmin && !session.permissions.deleteRooms) throw new ApiError(403, 'Sua conta não tem permissão para acessar salas excluídas.');
      const ownerFilter = session.isSuperAdmin ? '' : `&owner_user_id=eq.${session.userId}`;
      const rows = await db(`scrims?select=state,is_public,deleted_at,access_version,owner_user_id,created_by_user_id${ownerFilter}&deleted_at=${deleted ? 'not.is.null' : 'is.null'}&order=created_at.desc&limit=500`) as DbScrim[];
      return send(res, 200, rows.map(row => ({ ...summary(row.state), access: accessOf(row), ownerId: row.owner_user_id })));
    }
    // Apply visibility filters in Postgres before the limit; never fetch hidden rows for public listing.
    const rows = await db('scrims?select=state,is_public,deleted_at,access_version,owner_user_id,created_by_user_id&is_public=eq.true&deleted_at=is.null&order=created_at.desc&limit=500') as DbScrim[];
    for (const row of rows) accessOf(row);
    return send(res, 200, rows.map(row => summary(row.state)));
  }

  const id = path[1] || '';
  if (path.length === 3 && (path[2] === 'access' || path[2] === 'session')) {
    const metadata = await roomAccess(id);
    if (path[2] === 'access' && req.method === 'POST') {
      assertSameOrigin(req);
      const session = await actor();
      if (!session) {
        requireReadable(metadata, null);
        throw new ApiError(403, 'Entre como administrador para alterar o acesso da sala.');
      }
      const input = await jsonBody(req);
      if (Object.keys(input).some(key => !['action', 'expectedAccessVersion'].includes(key)) ||
          !['show', 'hide', 'delete', 'restore'].includes(String(input.action)) ||
          !Number.isSafeInteger(input.expectedAccessVersion) || (input.expectedAccessVersion as number) < 1 || (input.expectedAccessVersion as number) > 2147483647) throw new ApiError(400, 'Alteração de acesso inválida.');
      requireOwnership(metadata, session);
      if (metadata.deleted_at !== null && input.action !== 'restore') throw new ApiError(404, 'Scrim não encontrada.');
      requirePermission(session, input.action === 'delete' || input.action === 'restore' ? 'deleteRooms' : 'publishRooms');
      const rows = await db('rpc/manage_owned_scrim_access', { method: 'POST', body: JSON.stringify({
        p_id: id, p_expected_access_version: input.expectedAccessVersion, p_action: input.action, p_at: Date.now(), p_actor_id: session.userId, p_actor_session_version: session.sessionVersion,
      }) }) as DbAccess[];
      if (!Array.isArray(rows) || !rows.length) throw new ApiError(409, 'Outra alteração de acesso foi gravada. Atualize e tente novamente.');
      return send(res, 200, { access: accessOf(rows[0]!) });
    }
    if ((path[2] === 'access' && req.method === 'GET') || (path[2] === 'session' && req.method === 'POST')) {
      if (req.method === 'POST') assertSameOrigin(req);
      const session = await actor();
      requireReadable(metadata, session);
      return send(res, 200, { ...scopedSession(metadata, session), access: accessOf(metadata), serverNow: Date.now() });
    }
    throw new ApiError(405, 'Método ou rota não permitido.');
  }
  if (path.length === 3 && path[2] === 'owner' && req.method === 'POST') {
    const session = await requireAdmin();
    if (!session.isSuperAdmin) throw new ApiError(403, 'Somente a conta principal pode transferir salas.');
    const input = await jsonBody(req);
    if (Object.keys(input).some(key => !['ownerId', 'expectedAccessVersion'].includes(key)) ||
        typeof input.ownerId !== 'string' || !UUID_RE.test(input.ownerId) ||
        !Number.isSafeInteger(input.expectedAccessVersion) || (input.expectedAccessVersion as number) < 1 || (input.expectedAccessVersion as number) > 2147483647) throw new ApiError(400, 'Transferência inválida.');
    const metadata = await roomAccess(id);
    if (metadata.deleted_at !== null) throw new ApiError(404, 'Scrim não encontrada.');
    const rows = await db('rpc/transfer_scrim_owner', { method: 'POST', body: JSON.stringify({
      p_id: id, p_actor_id: session.userId, p_actor_session_version: session.sessionVersion, p_expected_access_version: input.expectedAccessVersion, p_owner_id: input.ownerId,
    }) }) as DbAccess[];
    if (!Array.isArray(rows) || !rows.length) throw new ApiError(409, 'Outra alteração foi gravada. Atualize e tente novamente.');
    return send(res, 200, { access: accessOf(rows[0]!), ownerId: input.ownerId });
  }
  const current = await room(id);
  requireReadable(current, await actor());
  if (path.length === 2 && req.method === 'GET') {
    // Pin to the version read above: concurrent appends cannot mix newer events
    // with an older state. PostgREST can cap page size below the requested limit.
    const events: ScrimEvent[] = [];
    let after = 0;
    while (after < current.version) {
      const page = await db(`scrim_events?select=event&scrim_id=eq.${id}&seq=gt.${after}&seq=lte.${current.version}&order=seq.asc&limit=500`) as { event: ScrimEvent }[];
      if (!page.length) throw new ApiError(502, 'Histórico de eventos incompleto.');
      for (const { event } of page) {
        if (event.seq !== after + 1 || event.seq > current.version) throw new ApiError(502, 'Histórico de eventos inconsistente.');
        events.push(event);
        after = event.seq;
      }
    }
    return send(res, 200, { state: current.state, events, serverNow: Date.now(), access: accessOf(current) });
  }
  if (path.length === 3 && path[2] === 'report.md' && req.method === 'GET') {
    res.setHeader('content-disposition', `attachment; filename="scrim-${id}.md"`);
    return send(res, 200, toMarkdown(current.state), 'text/markdown; charset=utf-8');
  }
  if (path.length === 3 && path[2] === 'tools' && req.method === 'POST') {
    const body = await jsonBody(req);
    const session = await requireAdmin();
    requireOwnership(current, session);
    const requiredPermissions: AdminPermissionKey[] = [];
    const now = Date.now();
    let toolEvent: RoomToolsEvent;
    if (body.action === 'focus') {
      requirePermission(session, 'manageFocus');
      requiredPermissions.push('manageFocus');
      toolFields(body, ['target']);
      if (activeDraw(current.state, now)) throw new ApiError(409, 'Resolva o sorteio antes de chamar atenção para outra área.');
      const target = validateFocusTarget(body.target, current.state);
      toolEvent = { type: 'room.focus', focus: { id: randomUUID(), target, requestedAt: now, expiresAt: now + ROOM_FOCUS_TTL_MS } };
    } else if (body.action === 'draw.start') {
      requirePermission(session, 'manageDraws');
      requiredPermissions.push('manageDraws');
      if (body.kind === 'captains') {
        requirePermission(session, 'manageTeams');
        requiredPermissions.push('manageTeams');
      }
      toolFields(body, ['kind', 'purpose', 'requestId']);
      const id = requestId(body.requestId);
      if (body.kind !== 'captains' && body.kind !== 'coin') throw new ApiError(400, 'Tipo de sorteio inválido.');
      const purpose = drawPurpose(body.purpose);
      // A response can be lost after commit. Retrying the same request never rerolls.
      const existing = current.state.draws?.find((draw) => draw.id === id);
      if (existing) {
        if (existing.kind !== body.kind || existing.purpose !== purpose) throw new ApiError(409, 'Esta tentativa já pertence a outro sorteio.');
        return send(res, 200, { state: current.state, draw: existing, serverNow: now });
      }
      if (activeDraw(current.state, now)) throw new ApiError(409, 'Já existe um sorteio aguardando a decisão do admin.');
      const base = { id, purpose, status: 'pending' as const, startedAt: now, revealAt: now + DRAW_REVEAL_MS, expiresAt: now + DRAW_TTL_MS };
      let draw: RoomDraw;
      if (body.kind === 'captains') {
        if (current.state.phase !== 'setup') throw new ApiError(400, 'Sorteie os capitães antes de iniciar a escolha dos mapas.');
        const candidates = current.state.players.map(({ id, name }) => ({ id, name }));
        if (candidates.length < 2) throw new ApiError(400, 'Adicione pelo menos dois jogadores para sortear os capitães.');
        const first = randomInt(candidates.length);
        const secondIndex = randomInt(candidates.length - 1);
        const second = secondIndex >= first ? secondIndex + 1 : secondIndex;
        draw = { ...base, kind: 'captains', candidates, result: { A: candidates[first]!.id, B: candidates[second]!.id } };
      } else {
        draw = { ...base, kind: 'coin', result: randomInt(2) === 0 ? 'heads' : 'tails' };
      }
      toolEvent = { type: 'draw.start', draw };
    } else if (body.action === 'draw.accept' || body.action === 'draw.reject') {
      requirePermission(session, 'manageDraws');
      requiredPermissions.push('manageDraws');
      toolFields(body, ['drawId']);
      const drawId = requestId(body.drawId);
      const draw = activeDraw(current.state, now);
      if (!draw || draw.id !== drawId) throw new ApiError(409, 'Este sorteio já foi resolvido, expirou ou não é o sorteio ativo.');
      if (body.action === 'draw.accept' && draw.kind === 'captains') {
        requirePermission(session, 'manageTeams');
        requiredPermissions.push('manageTeams');
      }
      if (body.action === 'draw.accept' && now < draw.revealAt) throw new ApiError(409, 'Aguarde o resultado antes de aceitar o sorteio.');
      toolEvent = { type: body.action, drawId };
    } else {
      throw new ApiError(400, 'Ação de foco ou sorteio inválida.');
    }
    const event: ScrimEvent = { ...toolEvent, seq: current.version + 1, at: now };
    const state = applyEvent(current.state, event);
    await db('rpc/append_owned_scrim_event', { method: 'POST', body: JSON.stringify({
      p_id: id, p_actor_id: session.userId, p_actor_session_version: session.sessionVersion, p_expected_version: current.version, p_expected_access_version: current.access_version,
      p_state: state, p_event: event, p_required_permissions: requiredPermissions,
    }) });
    return send(res, 200, { state, event, serverNow: Date.now() });
  }
  if (path.length === 3 && path[2] === 'imports' && req.method === 'POST') {
    const body = await jsonBody(req);
    const session = await requireAdmin();
    requireOwnership(current, session);
    requirePermission(session, 'importMatches');
    const region = regionCode(body.region);
    if (!['search', 'detail', 'confirm'].includes(String(body.action))) throw new ApiError(400, 'Ação de importação inválida.');
    if (body.action === 'confirm' && activeDraw(current.state, Date.now())) throw new ApiError(409, 'Resolva o sorteio antes de importar a partida.');
    const allowed = await db('rpc/claim_match_lookup', { method: 'POST', body: JSON.stringify({ p_id: id, p_key_hash: current.admin_key_hash }) });
    if (allowed !== true) throw new ApiError(429, 'Muitas consultas. Aguarde um minuto antes de buscar novamente.');
    if (body.action === 'search') return send(res, 200, { matches: await findMatches(region, body.riotId) });
    if (body.action === 'detail') {
      if (typeof body.matchId !== 'string') throw new ApiError(400, 'Partida inválida.');
      return send(res, 200, { match: (await fetchMatch(region, body.matchId)).match });
    }
    if (body.action !== 'confirm') throw new ApiError(400, 'Ação de importação inválida.');
    if (body.expectedVersion !== current.version) throw new ApiError(409, 'A sala mudou. Atualize e revise a importação novamente.');
    if (typeof body.matchId !== 'string' || !Number.isInteger(body.mapIndex) || !['A', 'B'].includes(String(body.redTeam)) || !Array.isArray(body.links) || body.links.length !== 10 || body.links.some((l: any) => !l || typeof l.playerId !== 'string' || typeof l.puuid !== 'string')) throw new ApiError(400, 'Revise as dez associações e os times.');
    // Fetch again on confirmation: never trust scores or statistics submitted by a browser.
    const { match, raw } = await fetchMatch(region, body.matchId);
    const event: ScrimEvent = { type: 'match.import', seq: current.version + 1, at: Date.now(), match,
      mapIndex: body.mapIndex as number, redTeam: body.redTeam as 'A' | 'B',
      links: body.links.map((l: PlayerLink) => ({ playerId: l.playerId, puuid: l.puuid })) };
    const state = applyEvent(current.state, event);
    await db('rpc/import_owned_match', { method: 'POST', body: JSON.stringify({ p_id: id, p_actor_id: session.userId, p_actor_session_version: session.sessionVersion,
      p_expected_version: current.version, p_expected_access_version: current.access_version, p_state: state, p_event: event, p_raw: raw }) });
    return send(res, 200, { state, event });
  }
  if (path.length === 3 && path[2] === 'command' && req.method === 'POST') {
    const body = await jsonBody(req);
    const session = await requireAdmin();
    requireOwnership(current, session);
    const command = body.command;
    if (!command || typeof command !== 'object' || Array.isArray(command) || !('type' in command) ||
        typeof command.type !== 'string' || command.type === 'scrim.create' || command.type === 'match.import' ||
        command.type === 'room.focus' || command.type.startsWith('draw.')) {
      throw new ApiError(400, 'Comando inválido.');
    }
    if (command.type === 'round.win' || command.type === 'round.undo') throw new ApiError(400, 'O placar e os rounds devem vir da importação da partida.');
    const permission = commandPermission(command.type);
    requirePermission(session, permission);
    if (command.type === 'stats.set') {
      const mapIndex = (command as Record<string, unknown>).mapIndex;
      if (!Number.isInteger(mapIndex) || (mapIndex as number) < 0 || !current.state.maps[mapIndex as number]?.source) throw new ApiError(400, 'Só é possível corrigir estatísticas depois de importar a partida.');
    }
    if (activeDraw(current.state, Date.now())) throw new ApiError(409, 'Resolva o sorteio antes de editar a sala.');
    const event = { ...(command as Command), seq: current.version + 1, at: Date.now() } as ScrimEvent;
    const state = applyEvent(current.state, event);
    await db('rpc/append_owned_scrim_event', { method: 'POST', body: JSON.stringify({
      p_id: id, p_actor_id: session.userId, p_actor_session_version: session.sessionVersion, p_expected_version: current.version, p_expected_access_version: current.access_version,
      p_state: state, p_event: event, p_required_permissions: [permission],
    }) });
    return send(res, 200, { state, event });
  }
  throw new ApiError(405, 'Método ou rota não permitido.');
}

export default async function serve(req: IncomingMessage, res: ServerResponse) {
  try { await handler(req, res); }
  catch (err) {
    if (err instanceof AdminAuthError) return send(res, err.status, { error: err.message });
    if (err instanceof ProviderError) return send(res, err.status, { error: err.message });
    if (err instanceof ApiError) return send(res, err.status, { error: err.message });
    if (err instanceof DomainError) return send(res, 400, { error: err.message });
    console.error('Erro inesperado:', err instanceof Error ? err.message : err);
    return send(res, 500, { error: 'Erro interno.' });
  }
}
