/**
 * Servidor HTTP + WebSocket.
 *
 *   POST /api/scrims               cria scrim → { id, adminKey }
 *   GET  /api/scrims               histórico (resumos)
 *   GET  /api/scrims/:id           estado + log completo de eventos (JSON)
 *   GET  /api/scrims/:id/report.md relatório em Markdown
 *   WS   /ws                       sala em tempo real
 *
 * Em produção também serve o front-end compilado (dist/).
 */

import { createReadStream, promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAPS } from '../shared/maps.js';
import { WS_PATH, type ClientMessage, type CreateScrimResponse, type Role, type ScrimSummary, type ServerMessage } from '../shared/protocol.js';
import { toMarkdown } from '../shared/report.js';
import { DomainError, seriesScore } from '../shared/scrim.js';
import { VETO_SEQUENCES, type SeriesFormat } from '../shared/veto.js';
import { RoomRegistry, type Room } from './rooms.js';
import { FileEventStore } from './store.js';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(ROOT, 'data'));
const STATIC_DIR = path.join(ROOT, 'dist');
const MAX_BODY = 4 * 1024;

const store = new FileEventStore(DATA_DIR);
const registry = new RoomRegistry(store);

// ─── HTTP ────────────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function send(res: http.ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'Corpo muito grande.');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}

async function requireRoom(id: string): Promise<Room> {
  const room = /^[a-z0-9]{6,32}$/.test(id) ? await registry.get(id) : null;
  if (!room) throw new HttpError(404, 'Scrim não encontrada.');
  return room;
}

function summarize(room: Room): ScrimSummary {
  const s = room.state;
  const score = seriesScore(s);
  return {
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    phase: s.phase,
    teams: [s.teams.A.name, s.teams.B.name],
    score: [score.A, score.B],
    maps: s.maps.map((m) => MAPS[m.mapId].name),
  };
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // remove "api"

  if (parts[0] !== 'scrims') throw new HttpError(404, 'Rota não encontrada.');

  if (parts.length === 1 && req.method === 'POST') {
    const body = (await readJson(req)) as { title?: unknown; format?: unknown };
    const format = (typeof body.format === 'string' && body.format in VETO_SEQUENCES ? body.format : 'bo3') as SeriesFormat;
    const title = typeof body.title === 'string' && body.title.trim() ? body.title : 'Scrim';
    const { room, adminKey } = await registry.create(title, format);
    const payload: CreateScrimResponse = { id: room.meta.id, adminKey };
    return send(res, 201, payload);
  }

  if (parts.length === 1 && req.method === 'GET') {
    const ids = await store.ids();
    const rooms = (await Promise.all(ids.map((id) => registry.get(id)))).filter((r): r is Room => r !== null);
    return send(res, 200, rooms.map(summarize).sort((a, b) => b.createdAt - a.createdAt));
  }

  if (req.method !== 'GET') throw new HttpError(405, 'Método não permitido.');
  const room = await requireRoom(parts[1]!);

  if (parts.length === 2) return send(res, 200, { state: room.state, events: room.events });
  if (parts.length === 3 && parts[2] === 'report.md') {
    res.setHeader('content-disposition', `attachment; filename="scrim-${room.meta.id}.md"`);
    return send(res, 200, toMarkdown(room.state), 'text/markdown; charset=utf-8');
  }
  throw new HttpError(404, 'Rota não encontrada.');
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

async function serveStatic(res: http.ServerResponse, pathname: string) {
  const target = path.normalize(path.join(STATIC_DIR, decodeURIComponent(pathname)));
  const inside = target.startsWith(STATIC_DIR + path.sep);
  const stat = inside ? await fs.stat(target).catch(() => null) : null;
  // Fallback de SPA: qualquer rota desconhecida devolve o index.html.
  const file = stat?.isFile() ? target : path.join(STATIC_DIR, 'index.html');
  const isAsset = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file)
    .on('error', () => res.end())
    .pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método não permitido.');
    return await serveStatic(res, url.pathname);
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    if (err instanceof DomainError) return send(res, 400, { error: err.message });
    console.error(err);
    return send(res, 500, { error: 'Erro interno.' });
  }
});

// ─── WebSocket ───────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server, path: WS_PATH, maxPayload: 16 * 1024 });

const reply = (socket: WebSocket, msg: ServerMessage) => socket.send(JSON.stringify(msg));

wss.on('connection', (socket) => {
  let room: Room | null = null;
  let role: Role = 'viewer';
  let alive = true;
  socket.on('pong', () => (alive = true));
  const heartbeat = setInterval(() => {
    if (!alive) return socket.terminate();
    alive = false;
    socket.ping();
  }, 30_000);

  const client: { socket: WebSocket; role: Role } = { socket, role };

  socket.on('message', async (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return reply(socket, { type: 'error', message: 'Mensagem inválida.' });
    }

    if (msg.type === 'join') {
      if (room) return reply(socket, { type: 'error', message: 'Já conectado a uma scrim.' });
      const found = typeof msg.scrimId === 'string' ? await registry.get(msg.scrimId).catch(() => null) : null;
      if (!found) {
        reply(socket, { type: 'error', message: 'Scrim não encontrada.' });
        return socket.close(4404, 'not-found');
      }
      room = found;
      role = registry.isAdmin(found, msg.adminKey) ? 'admin' : 'viewer';
      client.role = role;
      found.clients.add(client);
      reply(socket, { type: 'welcome', role, state: found.state, events: found.events });
      return found.broadcastPresence();
    }

    if (msg.type === 'command') {
      const requestId = typeof msg.requestId === 'string' ? msg.requestId.slice(0, 64) : undefined;
      if (!room) return reply(socket, { type: 'error', requestId, message: 'Entre numa scrim primeiro.' });
      // Espectadores são somente leitura: o servidor é quem garante isso.
      if (role !== 'admin') return reply(socket, { type: 'error', requestId, message: 'Somente o admin pode editar.' });
      try {
        await room.dispatch(msg.command);
        if (requestId) reply(socket, { type: 'ack', requestId });
      } catch (err) {
        const message = err instanceof DomainError ? err.message : 'Erro interno.';
        if (!(err instanceof DomainError)) console.error(err);
        reply(socket, { type: 'error', requestId, message });
      }
    }
  });

  socket.on('close', () => {
    clearInterval(heartbeat);
    if (room) {
      room.clients.delete(client);
      room.broadcastPresence();
    }
  });
});

await store.init();
server.listen(PORT, () => {
  console.log(`Scrims rodando em http://localhost:${PORT} (dados em ${DATA_DIR})`);
});
