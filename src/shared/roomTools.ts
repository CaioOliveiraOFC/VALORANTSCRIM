import { DomainError, type ScrimState } from './scrim.js';

/** Shared presentation identifiers; no browser can supply an arbitrary selector. */
export const ROOM_FOCUS_AREAS = {
  teams: ['overview', 'players', 'team-A', 'team-B', 'settings'],
  veto: ['overview', 'maps', 'turn'],
  match: ['overview', 'scoreboard', 'import', 'stats', 'rounds'],
  report: ['overview', 'notes'],
  timeline: ['overview'],
} as const;

export type RoomTab = keyof typeof ROOM_FOCUS_AREAS;
export interface FocusTarget {
  tab: RoomTab;
  area: string;
  mapIndex?: number;
}
export interface RoomFocus {
  id: string;
  target: FocusTarget;
  requestedAt: number;
  expiresAt: number;
}

export const ROOM_FOCUS_TTL_MS = 10_000;
export const DRAW_REVEAL_MS = 4_000;
export const DRAW_TTL_MS = 120_000;

export interface DrawBase {
  id: string;
  kind: 'captains' | 'coin';
  purpose: string;
  startedAt: number;
  revealAt: number;
  expiresAt: number;
  status: 'pending' | 'accepted' | 'rejected';
  resolvedAt?: number;
}
export type RoomDraw =
  | (DrawBase & { kind: 'captains'; candidates: { id: string; name: string }[]; result: { A: string; B: string } })
  | (DrawBase & { kind: 'coin'; result: 'heads' | 'tails' });

/** These events are issued by authenticated server routes, never generic commands. */
export type RoomToolsEvent =
  | { type: 'room.focus'; focus: RoomFocus }
  | { type: 'draw.start'; draw: RoomDraw }
  | { type: 'draw.accept'; drawId: string }
  | { type: 'draw.reject'; drawId: string };

type TimedRoomToolsEvent = RoomToolsEvent & { at: number };
const TOOL_ID = /^[A-Za-z0-9_-]{6,80}$/;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new DomainError(message);
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function validTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function validId(value: unknown): value is string {
  return typeof value === 'string' && TOOL_ID.test(value);
}

/** Uses the event/server time in the reducer; the UI supplies its current clock. */
export function activeDraw(state: Pick<ScrimState, 'draws'>, now: number): RoomDraw | undefined {
  return state.draws?.findLast(draw => draw.status === 'pending' && draw.expiresAt > now);
}

export function validateFocusTarget(target: unknown, state: Pick<ScrimState, 'maps'>): FocusTarget {
  assert(record(target), 'Destino de atenção inválido.');
  const tab = target.tab;
  assert(typeof tab === 'string' && Object.prototype.hasOwnProperty.call(ROOM_FOCUS_AREAS, tab), 'Aba de atenção inválida.');
  const areas: readonly string[] = ROOM_FOCUS_AREAS[tab as RoomTab];
  assert(typeof target.area === 'string' && areas.includes(target.area), 'Área de atenção inválida.');
  if (target.mapIndex !== undefined) {
    assert(tab === 'match' || tab === 'report', 'Esta aba não aceita seleção de mapa.');
    assert(Number.isInteger(target.mapIndex) && (target.mapIndex as number) >= 0 &&
      (target.mapIndex as number) < state.maps.length, 'Mapa de atenção inválido.');
  }
  return { tab: tab as RoomTab, area: target.area,
    ...(target.mapIndex !== undefined ? { mapIndex: target.mapIndex as number } : {}) };
}

export function validateRoomFocus(focus: RoomFocus, state: ScrimState, eventAt: number): void {
  assert(record(focus) && validId(focus.id), 'Pedido de atenção inválido.');
  assert(validTime(eventAt) && focus.requestedAt === eventAt &&
    focus.expiresAt === eventAt + ROOM_FOCUS_TTL_MS, 'Prazo do pedido de atenção inválido.');
  validateFocusTarget(focus.target, state);
}

function validateCaptainCandidates(draw: Extract<RoomDraw, { kind: 'captains' }>, state: ScrimState): void {
  assert(state.phase === 'setup', 'Sorteie os capitães antes de começar o veto.');
  assert(state.players.length >= 2, 'Adicione pelo menos dois jogadores para sortear os capitães.');
  assert(Array.isArray(draw.candidates) && draw.candidates.length === state.players.length,
    'A lista do sorteio precisa incluir todos os jogadores da sala.');
  const ids = new Set<string>();
  for (const candidate of draw.candidates) {
    assert(record(candidate) && typeof candidate.id === 'string' && typeof candidate.name === 'string', 'Candidato inválido.');
    assert(!ids.has(candidate.id), 'Um jogador não pode aparecer duas vezes no sorteio.');
    ids.add(candidate.id);
    const player = state.players.find(p => p.id === candidate.id);
    assert(player && player.name === candidate.name, 'A lista de jogadores mudou. Inicie outro sorteio.');
  }
  assert(record(draw.result) && typeof draw.result.A === 'string' && typeof draw.result.B === 'string' &&
    draw.result.A !== draw.result.B && ids.has(draw.result.A) && ids.has(draw.result.B),
  'O sorteio precisa escolher dois capitães distintos da lista.');
}

export function validateDrawStart(draw: RoomDraw, state: ScrimState, eventAt: number): void {
  assert(record(draw) && validId(draw.id), 'Sorteio inválido.');
  assert(draw.kind === 'captains' || draw.kind === 'coin', 'Tipo de sorteio inválido.');
  assert(draw.status === 'pending' && draw.resolvedAt === undefined, 'O sorteio precisa começar aguardando decisão.');
  assert(typeof draw.purpose === 'string' && draw.purpose.trim().length > 0 && draw.purpose.trim().length <= 160,
    'Diga o que está sendo sorteado, em até 160 caracteres.');
  assert(validTime(eventAt) && draw.startedAt === eventAt && draw.revealAt === eventAt + DRAW_REVEAL_MS &&
    draw.expiresAt === eventAt + DRAW_TTL_MS, 'Prazo do sorteio inválido.');
  assert(!state.draws?.some(previous => previous.id === draw.id), 'Este sorteio já foi registrado.');
  assert(!activeDraw(state, eventAt), 'Conclua ou descarte o sorteio em andamento.');
  if (draw.kind === 'captains') validateCaptainCandidates(draw, state);
  else assert(draw.result === 'heads' || draw.result === 'tails', 'Resultado da moeda inválido.');
}

export function applyRoomToolsEvent(state: ScrimState, event: TimedRoomToolsEvent): ScrimState {
  if (event.type === 'room.focus') {
    assert(!activeDraw(state, event.at), 'Conclua ou descarte o sorteio antes de chamar a atenção da sala.');
    validateRoomFocus(event.focus, state, event.at);
    const focus = event.focus;
    return { ...state, roomFocus: { ...focus, target: validateFocusTarget(focus.target, state) } };
  }
  if (event.type === 'draw.start') {
    validateDrawStart(event.draw, state, event.at);
    const draw: RoomDraw = event.draw.kind === 'captains'
      ? { ...event.draw, purpose: event.draw.purpose.trim(),
          candidates: event.draw.candidates.map(candidate => ({ ...candidate })), result: { ...event.draw.result } }
      : { ...event.draw, purpose: event.draw.purpose.trim() };
    return { ...state, draws: [...(state.draws ?? []), draw] };
  }
  assert(validId(event.drawId), 'Sorteio inválido.');
  const draw = activeDraw(state, event.at);
  assert(draw && draw.id === event.drawId, 'Este sorteio já terminou, expirou ou foi substituído.');
  assert(validTime(event.at) && event.at >= draw.startedAt, 'Horário da decisão inválido.');
  const accepting = event.type === 'draw.accept';
  if (accepting) assert(event.at >= draw.revealAt, 'Aguarde o resultado do sorteio antes de aceitar.');
  if (accepting && draw.kind === 'captains') validateCaptainCandidates(draw, state);
  const draws = state.draws!.map(previous => previous.id === draw.id
    ? { ...previous, status: accepting ? 'accepted' as const : 'rejected' as const, resolvedAt: event.at }
    : previous);
  if (!accepting || draw.kind === 'coin') return { ...state, draws };
  // One accepted event sets both captains and their teams atomically. Other players
  // return to the general list so the captains can build their teams afterwards.
  return { ...state, draws,
    players: state.players.map(player => ({ ...player,
      team: player.id === draw.result.A ? 'A' : player.id === draw.result.B ? 'B' : null })),
    teams: {
      A: { ...state.teams.A, captainId: draw.result.A },
      B: { ...state.teams.B, captainId: draw.result.B },
    },
  };
}
