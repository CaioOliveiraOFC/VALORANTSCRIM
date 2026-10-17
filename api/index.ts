/** API serverless Vercel: somente o serviço usa a chave secreta do Supabase. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fetchMatch, findMatches, ProviderError, regionCode } from '../src/server/henrik.js';
import type { PlayerLink } from '../src/shared/imports.js';
import { MAPS } from '../src/shared/maps.js';
import { toMarkdown } from '../src/shared/report.js';
import { applyEvent, initialState, DomainError, seriesScore, type Command, type ScrimEvent, type ScrimState } from '../src/shared/scrim.js';
import type { SeriesFormat } from '../src/shared/veto.js';
import type { ScrimSummary } from '../src/shared/protocol.js';

const ID_RE = /^[a-z0-9]{6,32}$/;
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

function authorize(row: DbScrim, key: unknown): boolean {
  if (typeof key !== 'string' || key.length > 256 || !key) return false;
  const expected = Buffer.from(row.admin_key_hash, 'hex');
  const actual = Buffer.from(hash(key), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
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
  if (path[0] !== 'scrims') throw new ApiError(404, 'Rota não encontrada.');

  if (path.length === 1 && req.method === 'POST') {
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
    return send(res, 201, { id, adminKey });
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
    return send(res, 200, { state: current.state, events });
  }
  if (path.length === 3 && path[2] === 'report.md' && req.method === 'GET') {
    res.setHeader('content-disposition', `attachment; filename="scrim-${id}.md"`);
    return send(res, 200, toMarkdown(current.state), 'text/markdown; charset=utf-8');
  }
  if (path.length === 3 && path[2] === 'session' && req.method === 'POST') {
    const body = await jsonBody(req);
    return send(res, 200, { role: authorize(current, body.adminKey) ? 'admin' : 'viewer' });
  }
  if (path.length === 3 && path[2] === 'imports' && req.method === 'POST') {
    const body = await jsonBody(req);
    if (!authorize(current, body.adminKey)) throw new ApiError(403, 'Somente o admin pode importar.');
    const region = regionCode(body.region);
    if (!['search', 'detail', 'confirm'].includes(String(body.action))) throw new ApiError(400, 'Ação de importação inválida.');
    const allowed = await db('rpc/claim_match_lookup', { method: 'POST', body: JSON.stringify({ p_id: id, p_key_hash: hash(body.adminKey as string) }) });
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
    await db('rpc/import_match_result', { method: 'POST', body: JSON.stringify({ p_id: id, p_key_hash: hash(body.adminKey as string),
      p_expected_version: current.version, p_state: state, p_event: event, p_raw: raw }) });
    return send(res, 200, { state, event });
  }
  if (path.length === 3 && path[2] === 'command' && req.method === 'POST') {
    const body = await jsonBody(req);
    if (!authorize(current, body.adminKey)) throw new ApiError(403, 'Somente o admin pode editar.');
    const command = body.command;
    if (!command || typeof command !== 'object' || Array.isArray(command) || !('type' in command) || (command.type === 'scrim.create' || command.type === 'match.import')) {
      throw new ApiError(400, 'Comando inválido.');
    }
    const event = { ...(command as Command), seq: current.version + 1, at: Date.now() } as ScrimEvent;
    const state = applyEvent(current.state, event);
    await db('rpc/append_scrim_event', { method: 'POST', body: JSON.stringify({
      p_id: id, p_key_hash: hash(body.adminKey as string), p_expected_version: current.version,
      p_state: state, p_event: event,
    }) });
    return send(res, 200, { state, event });
  }
  throw new ApiError(405, 'Método ou rota não permitido.');
}

export default async function serve(req: IncomingMessage, res: ServerResponse) {
  try { await handler(req, res); }
  catch (err) {
    if (err instanceof ProviderError) return send(res, err.status, { error: err.message });
    if (err instanceof ApiError) return send(res, err.status, { error: err.message });
    if (err instanceof DomainError) return send(res, 400, { error: err.message });
    console.error('Erro inesperado:', err instanceof Error ? err.message : err);
    return send(res, 500, { error: 'Erro interno.' });
  }
}
