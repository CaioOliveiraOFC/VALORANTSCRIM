/**
 * Modelo de domínio da scrim, em event sourcing.
 *
 * Toda alteração feita pelo admin vira um evento numerado e com horário. O
 * estado é sempre `events.reduce(applyEvent)`, o que dá de graça:
 *   - sincronização em tempo real (o servidor só retransmite eventos/estado);
 *   - histórico completo e replay da scrim para análise;
 *   - desfazer sem apagar nada (o "desfazer" também é um evento).
 *
 * `applyEvent` é puro e lança `DomainError` se o comando for inválido. O
 * servidor valida cada comando aplicando-o antes de gravar.
 */

import { ACTIVE_COMPETITIVE_POOL, MAPS, POOL_SIZE, isMapId, type MapId } from './maps.js';
import { MAPS_IN_SERIES, VETO_SEQUENCES, mapsToWinSeries, type SeriesFormat, type VetoRole, type VetoStepDef } from './veto.js';

export type TeamId = 'A' | 'B';
export type Side = 'atk' | 'def';

export const TEAM_IDS: readonly TeamId[] = ['A', 'B'];
export const MAX_PLAYERS = 12;
const MAX_NAME = 32;
const MAX_NOTE = 280;

export class DomainError extends Error {
  override name = 'DomainError';
}

export interface Player {
  id: string;
  name: string;
  team: TeamId | null;
}

export interface Team {
  name: string;
  captainId: string | null;
}

export interface VetoEntry {
  step: number;
  kind: VetoStepDef['kind'];
  team: TeamId | null;
  mapId: MapId;
  side?: Side;
  at: number;
}

export interface Round {
  number: number;
  winner: TeamId;
  note?: string;
  at: number;
}

export interface PlayerStatLine {
  kills: number;
  deaths: number;
  assists: number;
}

export interface SeriesMap {
  mapId: MapId;
  /** Quem escolheu o mapa; null = decider. */
  pickedBy: TeamId | null;
  /** Lado inicial de cada time, definido no veto. */
  startingSide: Record<TeamId, Side> | null;
  rounds: Round[];
  stats: Record<string, PlayerStatLine>;
}

export type Phase = 'setup' | 'veto' | 'live' | 'finished';

export interface ScrimState {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  format: SeriesFormat;
  pool: MapId[];
  teams: Record<TeamId, Team>;
  players: Player[];
  phase: Phase;
  /** Time que é o "Team A" do rulebook (começa o veto). */
  vetoFirst: TeamId | null;
  veto: VetoEntry[];
  maps: SeriesMap[];
  notes: { text: string; at: number }[];
  /** Número de eventos aplicados (próximo seq = version + 1). */
  version: number;
}

// ─── Comandos (o que o admin envia) ──────────────────────────────────────────

export type Command =
  | { type: 'settings.update'; title?: string; format?: SeriesFormat; pool?: MapId[] }
  | { type: 'team.rename'; team: TeamId; name: string }
  | { type: 'team.captain'; team: TeamId; playerId: string | null }
  | { type: 'player.add'; playerId: string; name: string }
  | { type: 'player.rename'; playerId: string; name: string }
  | { type: 'player.remove'; playerId: string }
  | { type: 'player.assign'; playerId: string; team: TeamId | null }
  | { type: 'teams.set'; A: string[]; B: string[] }
  | { type: 'veto.start'; first: TeamId }
  | { type: 'veto.ban'; mapId: MapId }
  | { type: 'veto.pick'; mapId: MapId }
  | { type: 'veto.side'; side: Side }
  | { type: 'veto.undo' }
  | { type: 'veto.reset' }
  | { type: 'round.win'; team: TeamId; note?: string }
  | { type: 'round.undo' }
  | { type: 'stats.set'; mapIndex: number; playerId: string; line: PlayerStatLine }
  | { type: 'note.add'; text: string };

export type ScrimEvent =
  | ({ seq: number; at: number } & Command)
  | { seq: number; at: number; type: 'scrim.create'; id: string; title: string; format: SeriesFormat };

// ─── Derivações ──────────────────────────────────────────────────────────────

export const other = (t: TeamId): TeamId => (t === 'A' ? 'B' : 'A');
export const flip = (s: Side): Side => (s === 'atk' ? 'def' : 'atk');

export function roleToTeam(state: Pick<ScrimState, 'vetoFirst'>, role: VetoRole): TeamId {
  if (!state.vetoFirst) throw new DomainError('O veto ainda não começou.');
  return role === 'first' ? state.vetoFirst : other(state.vetoFirst);
}

/** Próximo passo pendente do veto (nunca o "decider", que é automático). */
export function currentVetoStep(state: ScrimState): (VetoStepDef & { index: number; team: TeamId }) | null {
  if (state.phase !== 'veto') return null;
  const seq = VETO_SEQUENCES[state.format];
  const index = state.veto.length;
  const def = seq[index];
  if (!def || !def.role) return null;
  return { ...def, index, team: roleToTeam(state, def.role) };
}

export function availableMaps(state: ScrimState): MapId[] {
  const used = new Set(state.veto.map((v) => v.mapId));
  return state.pool.filter((m) => !used.has(m));
}

/** Lado do time no round, considerando troca no round 13 e alternância na prorrogação. */
export function sideInRound(startingSide: Side, round: number): Side {
  if (round <= 12) return startingSide;
  if (round <= 24) return flip(startingSide);
  // Prorrogação: troca a cada round, começando pelo lado do 1º tempo.
  return (round - 25) % 2 === 0 ? startingSide : flip(startingSide);
}

export function mapScore(map: SeriesMap): Record<TeamId, number> {
  const score = { A: 0, B: 0 };
  for (const r of map.rounds) score[r.winner]++;
  return score;
}

/** Vencedor do mapa: 13 rounds, ou vantagem de 2 depois do 12x12. */
export function mapWinner(map: SeriesMap): TeamId | null {
  const { A, B } = mapScore(map);
  const top = Math.max(A, B);
  if (top < 13) return null;
  if (A >= 12 && B >= 12) return Math.abs(A - B) >= 2 ? (A > B ? 'A' : 'B') : null;
  return A > B ? 'A' : 'B';
}

export function seriesScore(state: ScrimState): Record<TeamId, number> {
  const score = { A: 0, B: 0 };
  for (const m of state.maps) {
    const w = mapWinner(m);
    if (w) score[w]++;
  }
  return score;
}

export function seriesWinner(state: ScrimState): TeamId | null {
  const need = mapsToWinSeries(state.format);
  const s = seriesScore(state);
  return s.A >= need ? 'A' : s.B >= need ? 'B' : null;
}

/** Índice do mapa em andamento (o primeiro sem vencedor), ou -1. */
export function currentMapIndex(state: ScrimState): number {
  if (state.phase !== 'live') return -1;
  return state.maps.findIndex((m) => mapWinner(m) === null);
}

// ─── Redutor ─────────────────────────────────────────────────────────────────

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new DomainError(message);
}

function cleanText(value: unknown, max: number, label: string): string {
  assert(typeof value === 'string', `${label} inválido.`);
  const text = value.replace(/\s+/g, ' ').trim();
  assert(text.length > 0, `${label} não pode ficar vazio.`);
  assert(text.length <= max, `${label} pode ter no máximo ${max} caracteres.`);
  return text;
}

function isTeam(v: unknown): v is TeamId {
  return v === 'A' || v === 'B';
}

function findPlayer(state: ScrimState, playerId: unknown): Player {
  const p = state.players.find((x) => x.id === playerId);
  assert(p, 'Jogador não encontrado.');
  return p;
}

function requirePhase(state: ScrimState, ...phases: Phase[]) {
  assert(phases.includes(state.phase), `Ação indisponível nesta fase (${state.phase}).`);
}

function validatePool(pool: unknown): MapId[] {
  assert(Array.isArray(pool) && pool.every(isMapId), 'Pool de mapas inválida.');
  const unique = [...new Set(pool)];
  assert(unique.length === POOL_SIZE, `A pool precisa ter exatamente ${POOL_SIZE} mapas.`);
  return unique;
}

/** Monta a lista de mapas da série a partir do veto concluído. */
function buildSeriesMaps(state: ScrimState): SeriesMap[] {
  const maps: SeriesMap[] = [];
  for (const entry of state.veto) {
    if (entry.kind === 'pick' || entry.kind === 'decider') {
      maps.push({ mapId: entry.mapId, pickedBy: entry.team, startingSide: null, rounds: [], stats: {} });
    } else if (entry.kind === 'side') {
      const target = maps.find((m) => m.mapId === entry.mapId);
      if (target && entry.team && entry.side) {
        target.startingSide = { [entry.team]: entry.side, [other(entry.team)]: flip(entry.side) } as Record<TeamId, Side>;
      }
    }
  }
  return maps;
}

/** Mapa que recebe a escolha de lado no passo atual: o último escolhido/decider sem lado. */
function mapAwaitingSide(state: ScrimState): MapId {
  const sided = new Set(state.veto.filter((v) => v.kind === 'side').map((v) => v.mapId));
  const candidates = state.veto.filter((v) => (v.kind === 'pick' || v.kind === 'decider') && !sided.has(v.mapId));
  const target = candidates[candidates.length - 1];
  assert(target, 'Nenhum mapa aguardando escolha de lado.');
  return target.mapId;
}

/** Aplica passos automáticos (decider) e fecha o veto quando a sequência termina. */
function advanceVeto(state: ScrimState, at: number): ScrimState {
  const seq = VETO_SEQUENCES[state.format];
  let next = state;
  while (next.veto.length < seq.length && seq[next.veto.length]!.kind === 'decider') {
    const remaining = availableMaps(next);
    assert(remaining.length === 1, 'O decider precisa de exatamente um mapa restante.');
    next = { ...next, veto: [...next.veto, { step: next.veto.length + 1, kind: 'decider', team: null, mapId: remaining[0]!, at }] };
  }
  if (next.veto.length === seq.length) {
    const maps = buildSeriesMaps(next);
    assert(maps.length === MAPS_IN_SERIES[next.format], 'Veto inconsistente com o formato da série.');
    next = { ...next, phase: 'live', maps };
  }
  return next;
}

export function initialState(): ScrimState {
  return {
    id: '',
    title: '',
    createdAt: 0,
    updatedAt: 0,
    format: 'bo3',
    pool: [...ACTIVE_COMPETITIVE_POOL],
    teams: { A: { name: 'Time A', captainId: null }, B: { name: 'Time B', captainId: null } },
    players: [],
    phase: 'setup',
    vetoFirst: null,
    veto: [],
    maps: [],
    notes: [],
    version: 0,
  };
}

export function applyEvent(prev: ScrimState, event: ScrimEvent): ScrimState {
  assert(event.seq === prev.version + 1, `Evento fora de ordem (esperado ${prev.version + 1}, veio ${event.seq}).`);
  const next = reduce(prev, event);
  return { ...next, version: event.seq, updatedAt: event.at };
}

export function replay(events: readonly ScrimEvent[]): ScrimState {
  return events.reduce(applyEvent, initialState());
}

function reduce(s: ScrimState, e: ScrimEvent): ScrimState {
  switch (e.type) {
    case 'scrim.create':
      assert(s.version === 0, 'A scrim já foi criada.');
      return { ...s, id: e.id, title: cleanText(e.title, 60, 'Título'), format: e.format, createdAt: e.at };

    case 'settings.update': {
      const patch: Partial<ScrimState> = {};
      if (e.title !== undefined) patch.title = cleanText(e.title, 60, 'Título');
      if (e.format !== undefined || e.pool !== undefined) requirePhase(s, 'setup');
      if (e.format !== undefined) {
        assert(e.format in VETO_SEQUENCES, 'Formato inválido.');
        patch.format = e.format;
      }
      if (e.pool !== undefined) patch.pool = validatePool(e.pool);
      return { ...s, ...patch };
    }

    case 'team.rename': {
      assert(isTeam(e.team), 'Time inválido.');
      return { ...s, teams: { ...s.teams, [e.team]: { ...s.teams[e.team], name: cleanText(e.name, MAX_NAME, 'Nome do time') } } };
    }

    case 'team.captain': {
      assert(isTeam(e.team), 'Time inválido.');
      if (e.playerId !== null) assert(findPlayer(s, e.playerId).team === e.team, 'O capitão precisa estar no time.');
      return { ...s, teams: { ...s.teams, [e.team]: { ...s.teams[e.team], captainId: e.playerId } } };
    }

    case 'player.add': {
      assert(typeof e.playerId === 'string' && /^[\w-]{1,40}$/.test(e.playerId), 'ID de jogador inválido.');
      assert(!s.players.some((p) => p.id === e.playerId), 'Jogador já existe.');
      assert(s.players.length < MAX_PLAYERS, `Máximo de ${MAX_PLAYERS} jogadores.`);
      const name = cleanText(e.name, MAX_NAME, 'Nome do jogador');
      assert(!s.players.some((p) => p.name.toLowerCase() === name.toLowerCase()), 'Já existe um jogador com esse nome.');
      return { ...s, players: [...s.players, { id: e.playerId, name, team: null }] };
    }

    case 'player.rename': {
      findPlayer(s, e.playerId);
      const name = cleanText(e.name, MAX_NAME, 'Nome do jogador');
      return { ...s, players: s.players.map((p) => (p.id === e.playerId ? { ...p, name } : p)) };
    }

    case 'player.remove': {
      requirePhase(s, 'setup');
      findPlayer(s, e.playerId);
      return {
        ...s,
        players: s.players.filter((p) => p.id !== e.playerId),
        teams: clearCaptain(s.teams, e.playerId),
      };
    }

    case 'player.assign': {
      requirePhase(s, 'setup');
      findPlayer(s, e.playerId);
      assert(e.team === null || isTeam(e.team), 'Time inválido.');
      return {
        ...s,
        players: s.players.map((p) => (p.id === e.playerId ? { ...p, team: e.team } : p)),
        teams: clearCaptain(s.teams, e.playerId),
      };
    }

    case 'teams.set': {
      requirePhase(s, 'setup');
      assert(Array.isArray(e.A) && Array.isArray(e.B), 'Times inválidos.');
      const ids = [...e.A, ...e.B];
      assert(new Set(ids).size === ids.length, 'Um jogador não pode estar nos dois times.');
      ids.forEach((id) => findPlayer(s, id));
      const teamOf = (id: string): TeamId | null => (e.A.includes(id) ? 'A' : e.B.includes(id) ? 'B' : null);
      return {
        ...s,
        players: s.players.map((p) => ({ ...p, team: teamOf(p.id) })),
        teams: { A: { ...s.teams.A, captainId: null }, B: { ...s.teams.B, captainId: null } },
      };
    }

    case 'veto.start':
      requirePhase(s, 'setup');
      assert(isTeam(e.first), 'Time inválido.');
      assert(s.pool.length === POOL_SIZE, `A pool precisa ter ${POOL_SIZE} mapas.`);
      return { ...s, phase: 'veto', vetoFirst: e.first, veto: [] };

    case 'veto.ban':
    case 'veto.pick': {
      const step = currentVetoStep(s);
      const kind = e.type === 'veto.ban' ? 'ban' : 'pick';
      assert(step, 'O veto não está em andamento.');
      assert(step.kind === kind, `Agora é a vez de ${stepVerb(step.kind)}, não de ${stepVerb(kind)}.`);
      assert(isMapId(e.mapId) && availableMaps(s).includes(e.mapId), 'Mapa indisponível.');
      const entry: VetoEntry = { step: step.index + 1, kind, team: step.team, mapId: e.mapId, at: e.at };
      return advanceVeto({ ...s, veto: [...s.veto, entry] }, e.at);
    }

    case 'veto.side': {
      const step = currentVetoStep(s);
      assert(step, 'O veto não está em andamento.');
      assert(step.kind === 'side', `Agora é a vez de ${stepVerb(step.kind)}, não de escolher lado.`);
      assert(e.side === 'atk' || e.side === 'def', 'Lado inválido.');
      const entry: VetoEntry = { step: step.index + 1, kind: 'side', team: step.team, mapId: mapAwaitingSide(s), side: e.side, at: e.at };
      return advanceVeto({ ...s, veto: [...s.veto, entry] }, e.at);
    }

    case 'veto.undo': {
      requirePhase(s, 'veto', 'live');
      assert(s.maps.every((m) => m.rounds.length === 0), 'Não dá para desfazer o veto depois que a partida começou.');
      // Remove a última ação humana e os passos automáticos que vieram depois dela.
      const veto = [...s.veto];
      while (veto.length && veto[veto.length - 1]!.kind === 'decider') veto.pop();
      assert(veto.length > 0, 'Nada para desfazer.');
      veto.pop();
      return { ...s, phase: 'veto', veto, maps: [] };
    }

    case 'veto.reset':
      requirePhase(s, 'veto', 'live');
      assert(s.maps.every((m) => m.rounds.length === 0), 'Não dá para reiniciar o veto depois que a partida começou.');
      return { ...s, phase: 'setup', vetoFirst: null, veto: [], maps: [] };

    case 'round.win': {
      requirePhase(s, 'live');
      assert(isTeam(e.team), 'Time inválido.');
      const idx = currentMapIndex(s);
      assert(idx >= 0, 'Nenhum mapa em andamento.');
      const note = e.note ? cleanText(e.note, MAX_NOTE, 'Nota') : undefined;
      const map = s.maps[idx]!;
      const round: Round = { number: map.rounds.length + 1, winner: e.team, at: e.at, ...(note ? { note } : {}) };
      const maps = s.maps.map((m, i) => (i === idx ? { ...m, rounds: [...m.rounds, round] } : m));
      const next = { ...s, maps };
      return seriesWinner(next) ? { ...next, phase: 'finished' } : next;
    }

    case 'round.undo': {
      requirePhase(s, 'live', 'finished');
      // O último round registrado está no último mapa com rounds.
      const idx = s.maps.findLastIndex((m) => m.rounds.length > 0);
      assert(idx >= 0, 'Nenhum round para desfazer.');
      const maps = s.maps.map((m, i) => (i === idx ? { ...m, rounds: m.rounds.slice(0, -1) } : m));
      return { ...s, maps, phase: 'live' };
    }

    case 'stats.set': {
      requirePhase(s, 'live', 'finished');
      const map = s.maps[e.mapIndex];
      assert(map, 'Mapa inválido.');
      const player = findPlayer(s, e.playerId);
      assert(player.team, 'Jogador sem time.');
      const { kills, deaths, assists } = e.line ?? ({} as PlayerStatLine);
      for (const n of [kills, deaths, assists]) assert(Number.isInteger(n) && n >= 0 && n <= 200, 'Estatística inválida.');
      const maps = s.maps.map((m, i) =>
        i === e.mapIndex ? { ...m, stats: { ...m.stats, [e.playerId]: { kills, deaths, assists } } } : m,
      );
      return { ...s, maps };
    }

    case 'note.add':
      return { ...s, notes: [...s.notes, { text: cleanText(e.text, MAX_NOTE, 'Nota'), at: e.at }] };

    default: {
      const unknown: never = e;
      throw new DomainError(`Evento desconhecido: ${(unknown as { type: string }).type}`);
    }
  }
}

function clearCaptain(teams: Record<TeamId, Team>, playerId: string): Record<TeamId, Team> {
  return {
    A: teams.A.captainId === playerId ? { ...teams.A, captainId: null } : teams.A,
    B: teams.B.captainId === playerId ? { ...teams.B, captainId: null } : teams.B,
  };
}

function stepVerb(kind: VetoStepDef['kind']): string {
  return { ban: 'banir', pick: 'escolher mapa', side: 'escolher lado', decider: 'decider' }[kind];
}

export function describeVetoEntry(state: ScrimState, v: VetoEntry): string {
  const team = v.team ? state.teams[v.team].name : '';
  const map = MAPS[v.mapId].name;
  switch (v.kind) {
    case 'ban':
      return `${team} baniu ${map}`;
    case 'pick':
      return `${team} escolheu ${map}`;
    case 'side':
      return `${team} começa ${v.side === 'atk' ? 'no ataque' : 'na defesa'} em ${map}`;
    case 'decider':
      return `${map} é o decider`;
  }
}
