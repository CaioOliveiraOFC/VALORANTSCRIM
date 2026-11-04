/** API serverless Vercel: somente o serviço usa a chave secreta do Supabase. */
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AdminAuthError, assertSameOrigin, getAdminSession, loginAdmin, logoutAdmin } from '../src/serverless/adminAuth.js';
import { fetchMatch, findMatches, ProviderError, regionCode } from '../src/server/henrik.js';
import type { PlayerLink } from '../src/shared/imports.js';
import { MAPS } from '../src/shared/maps.js';
import { toMarkdown } from '../src/shared/report.js';
import { applyEvent, initialState, DomainError, seriesScore, type Command, type ScrimEvent, type ScrimState } from '../src/shared/scrim.js';
import type { SeriesFormat } from '../src/shared/veto.js';
import type { ScrimSummary } from '../src/shared/protocol.js';
import {
  activeDraw, validateFocusTarget, DRAW_REVEAL_MS, DRAW_TTL_MS, ROOM_FOCUS_TTL_MS,
  type RoomDraw, type RoomToolsEvent,
} from '../src/shared/roomTools.js';

const ID_RE = /^[a-z0-9]{6,32}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const MAX_BODY = 16 * 1024;
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
    if (['rpc/claim_match_lookup', 'rpc/import_match_result'].includes(path) && error.code === 'PGRST202') throw new ApiError(503, 'Importação indisponível: aplique a migração 20261017_match_imports.sql no Supabase.');
    if (path === 'rpc/import_match_result' && error.code === '23505') throw new ApiError(409, 'Esta partida já foi importada nesta scrim.');
    if (error.message?.includes('STALE_OR_FORBIDDEN')) throw new ApiError(409, 'Outra ação foi gravada. Recarregue e tente novamente.');
    console.error('Erro no Supabase:', response.status, error.code);
    throw new ApiError(502, 'Falha ao consultar o banco de dados.');
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

interface DbScrim { id: string; admin_key_hash: string; state: ScrimState; version: number; }

async function room(id: string): Promise<DbScrim> {
  if (!ID_RE.test(id)) throw new ApiError(404, 'Scrim não encontrada.');
  const rows = await db(`scrims?select=id,admin_key_hash,state,version&id=eq.${id}&limit=1`) as DbScrim[];
  if (!rows.length) throw new ApiError(404, 'Scrim não encontrada.');
  return rows[0]!;
}

async function requireAdmin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  assertSameOrigin(req);
  if (!await getAdminSession(req, res)) throw new ApiError(403, 'Entre como administrador para editar a sala.');
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
  const path = (url.searchParams.get('route') || url.pathname.replace(/^\/api\/(?:index\/?|)/, '')).split('/').filter(Boolean);
  if (path[0] === 'health' && req.method === 'GET') {
    await db('scrims?select=id&limit=1');
    return send(res, 200, { ok: true, storage: 'supabase', realtime: 'supabase-postgres-changes' });
  }
  if (path[0] === 'admin') {
    if (path.length === 2 && path[1] === 'session' && req.method === 'GET') {
      const session = await getAdminSession(req, res);
      return send(res, 200, session ? { authenticated: true, user: { email: session.email } } : { authenticated: false });
    }
    if (path.length === 2 && path[1] === 'login' && req.method === 'POST') {
      assertSameOrigin(req);
      if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new ApiError(400, 'Envie os dados de login em JSON.');
      const input = await jsonBody(req);
      if (Object.keys(input).some(key => !['email', 'password'].includes(key))) throw new ApiError(400, 'Dados de login inválidos.');
      const session = await loginAdmin(req, res, input.email, input.password);
      return send(res, 200, { authenticated: true, user: { email: session.email } });
    }
    if (path.length === 2 && path[1] === 'logout' && req.method === 'POST') {
      assertSameOrigin(req);
      await logoutAdmin(req, res);
      return send(res, 200, { authenticated: false });
    }
    throw new ApiError(405, 'Método ou rota não permitido.');
  }
  if (path[0] !== 'scrims') throw new ApiError(404, 'Rota não encontrada.');

  if (path.length === 1 && req.method === 'POST') {
    await requireAdmin(req, res);
    const input = await jsonBody(req);
    const format = input.format;
    if (format !== 'bo1' && format !== 'bo3' && format !== 'bo5') throw new ApiError(400, 'Formato inválido.');
    const title = typeof input.title === 'string' ? input.title : 'Scrim';
    const id = randomBytes(6).toString('hex');
    const adminKey = randomBytes(24).toString('base64url');
    const event: ScrimEvent = { seq: 1, at: Date.now(), type: 'scrim.create', id, title, format: format as SeriesFormat };
    const state = applyEvent(initialState(), event);
    await db('rpc/create_scrim', { method: 'POST', body: JSON.stringify({
      p_id: id, p_key_hash: hash(adminKey), p_state: state, p_event: event, p_at: event.at,
    }) });
    return send(res, 201, { id });
  }

  if (path.length === 1 && req.method === 'GET') {
    const rows = await db('scrims?select=state&order=created_at.desc&limit=500') as { state: ScrimState }[];
    return send(res, 200, rows.map((r) => summary(r.state)));
  }

  const id = path[1] || '';
  const current = await room(id);
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
    return send(res, 200, { state: current.state, events, serverNow: Date.now() });
  }
  if (path.length === 3 && path[2] === 'report.md' && req.method === 'GET') {
    res.setHeader('content-disposition', `attachment; filename="scrim-${id}.md"`);
    return send(res, 200, toMarkdown(current.state), 'text/markdown; charset=utf-8');
  }
  if (path.length === 3 && path[2] === 'session' && req.method === 'POST') {
    assertSameOrigin(req);
    return send(res, 200, { role: await getAdminSession(req, res) ? 'admin' : 'viewer' });
  }
  if (path.length === 3 && path[2] === 'tools' && req.method === 'POST') {
    const body = await jsonBody(req);
    await requireAdmin(req, res);
    const now = Date.now();
    let toolEvent: RoomToolsEvent;
    if (body.action === 'focus') {
      toolFields(body, ['target']);
      if (activeDraw(current.state, now)) throw new ApiError(409, 'Resolva o sorteio antes de chamar atenção para outra área.');
      const target = validateFocusTarget(body.target, current.state);
      toolEvent = { type: 'room.focus', focus: { id: randomUUID(), target, requestedAt: now, expiresAt: now + ROOM_FOCUS_TTL_MS } };
    } else if (body.action === 'draw.start') {
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
      toolFields(body, ['drawId']);
      const drawId = requestId(body.drawId);
      const draw = activeDraw(current.state, now);
      if (!draw || draw.id !== drawId) throw new ApiError(409, 'Este sorteio já foi resolvido, expirou ou não é o sorteio ativo.');
      if (body.action === 'draw.accept' && now < draw.revealAt) throw new ApiError(409, 'Aguarde o resultado antes de aceitar o sorteio.');
      toolEvent = { type: body.action, drawId };
    } else {
      throw new ApiError(400, 'Ação de foco ou sorteio inválida.');
    }
    const event: ScrimEvent = { ...toolEvent, seq: current.version + 1, at: now };
    const state = applyEvent(current.state, event);
    await db('rpc/append_scrim_event', { method: 'POST', body: JSON.stringify({
      p_id: id, p_key_hash: current.admin_key_hash, p_expected_version: current.version, p_state: state, p_event: event,
    }) });
    return send(res, 200, { state, event, serverNow: Date.now() });
  }
  if (path.length === 3 && path[2] === 'imports' && req.method === 'POST') {
    const body = await jsonBody(req);
    await requireAdmin(req, res);
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
    await db('rpc/import_match_result', { method: 'POST', body: JSON.stringify({ p_id: id, p_key_hash: current.admin_key_hash,
      p_expected_version: current.version, p_state: state, p_event: event, p_raw: raw }) });
    return send(res, 200, { state, event });
  }
  if (path.length === 3 && path[2] === 'command' && req.method === 'POST') {
    const body = await jsonBody(req);
    await requireAdmin(req, res);
    const command = body.command;
    if (!command || typeof command !== 'object' || Array.isArray(command) || !('type' in command) ||
        typeof command.type !== 'string' || command.type === 'scrim.create' || command.type === 'match.import' ||
        command.type === 'room.focus' || command.type.startsWith('draw.')) {
      throw new ApiError(400, 'Comando inválido.');
    }
    if (activeDraw(current.state, Date.now())) throw new ApiError(409, 'Resolva o sorteio antes de editar a sala.');
    const event = { ...(command as Command), seq: current.version + 1, at: Date.now() } as ScrimEvent;
    const state = applyEvent(current.state, event);
    await db('rpc/append_scrim_event', { method: 'POST', body: JSON.stringify({
      p_id: id, p_key_hash: current.admin_key_hash, p_expected_version: current.version,
      p_state: state, p_event: event,
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
