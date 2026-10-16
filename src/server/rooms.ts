/**
 * Salas em memória. Cada scrim tem um único escritor (admin) e N espectadores.
 * Comandos são serializados por sala numa fila de promises, então dois cliques
 * simultâneos nunca geram eventos com o mesmo número.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { Role, ServerMessage } from '../shared/protocol.js';
import { DomainError, applyEvent, replay, type Command, type ScrimEvent, type ScrimState } from '../shared/scrim.js';
import type { SeriesFormat } from '../shared/veto.js';
import type { FileEventStore, ScrimMeta } from './store.js';

interface Client {
  socket: WebSocket;
  role: Role;
}

export class Room {
  readonly clients = new Set<Client>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly meta: ScrimMeta,
    public state: ScrimState,
    readonly events: ScrimEvent[],
    private readonly store: FileEventStore,
  ) {}

  /** Valida o comando aplicando-o, grava no log e só então transmite. */
  dispatch(command: Command): Promise<ScrimEvent> {
    const run = async () => {
      if (typeof command !== 'object' || command === null || (command.type as string) === 'scrim.create') {
        throw new DomainError('Comando inválido.');
      }
      const event = { ...command, seq: this.state.version + 1, at: Date.now() } as ScrimEvent;
      const next = applyEvent(this.state, event); // lança DomainError se inválido
      await this.store.append(this.meta.id, event);
      this.state = next;
      this.events.push(event);
      this.broadcast({ type: 'event', event, state: next });
      return event;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  broadcast(msg: ServerMessage) {
    const data = JSON.stringify(msg);
    for (const c of this.clients) if (c.socket.readyState === c.socket.OPEN) c.socket.send(data);
  }

  broadcastPresence() {
    let admins = 0;
    for (const c of this.clients) if (c.role === 'admin') admins++;
    this.broadcast({ type: 'presence', viewers: this.clients.size - admins, admins });
  }
}

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

export class RoomRegistry {
  private readonly rooms = new Map<string, Promise<Room | null>>();

  constructor(private readonly store: FileEventStore) {}

  async create(title: string, format: SeriesFormat): Promise<{ room: Room; adminKey: string }> {
    const id = randomBytes(6).toString('hex');
    const adminKey = randomBytes(24).toString('base64url');
    const meta: ScrimMeta = { id, adminKeyHash: hashKey(adminKey), createdAt: Date.now() };
    const first: ScrimEvent = { seq: 1, at: meta.createdAt, type: 'scrim.create', id, title, format };
    const state = applyEvent(replay([]), first); // valida título/formato antes de gravar
    await this.store.create(meta, first);
    const room = new Room(meta, state, [first], this.store);
    this.rooms.set(id, Promise.resolve(room));
    return { room, adminKey };
  }

  get(id: string): Promise<Room | null> {
    let pending = this.rooms.get(id);
    if (!pending) {
      pending = this.load(id);
      this.rooms.set(id, pending);
      // Não guarda "não encontrado" no cache.
      pending.then((r) => r ?? this.rooms.delete(id)).catch(() => this.rooms.delete(id));
    }
    return pending;
  }

  private async load(id: string): Promise<Room | null> {
    const meta = await this.store.meta(id);
    if (!meta) return null;
    const events = await this.store.events(id);
    return new Room(meta, replay(events), events, this.store);
  }

  isAdmin(room: Room, key: string | undefined): boolean {
    if (!key) return false;
    const a = Buffer.from(hashKey(key), 'hex');
    const b = Buffer.from(room.meta.adminKeyHash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
