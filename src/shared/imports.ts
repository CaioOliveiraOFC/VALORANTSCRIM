import { DomainError, currentMapIndex, mapScore, mapWinner, seriesWinner, type ScrimState, type TeamId } from './scrim.js';
import type { MapId } from './maps.js';

export interface RiotIdentity { puuid: string; name: string; tag: string }
export interface MatchPlayer extends RiotIdentity {
  team: 'Red' | 'Blue'; agent: string;
  kills: number; deaths: number; assists: number;
  score: number; damage: number; headshots: number; bodyshots: number; legshots: number;
}
export interface ExternalMatch {
  id: string; region: string; mapId: MapId; startedAt: number; durationMs: number; redStartingSide?: 'atk' | 'def';
  players: MatchPlayer[]; rounds: ('Red' | 'Blue')[];
  score: { Red: number; Blue: number };
}
export interface PlayerLink { playerId: string; puuid: string }
export interface MatchImport {
  match: ExternalMatch; mapIndex: number; redTeam: TeamId; links: PlayerLink[];
}
export interface ImportSource {
  provider: 'henrik'; matchId: string; region: string; startedAt: number; durationMs: number;
  importedAt: number; confirmedBy: 'scrim-admin'; actualStartingSide?: Record<TeamId, 'atk' | 'def'>;
}
function check(value: unknown, message: string): asserts value { if (!value) throw new DomainError(message); }
export function validateMapping(state: ScrimState, match: ExternalMatch, links: PlayerLink[], redTeam: TeamId) {
  check(redTeam === 'A' || redTeam === 'B', 'Escolha o time correspondente ao Red.');
  check(Array.isArray(links) && links.length === 10 && state.players.length === 10, 'Associe os dez jogadores.');
  check(new Set(links.map(x => x.playerId)).size === 10 && new Set(links.map(x => x.puuid)).size === 10, 'Um jogador não pode ter duas associações.');
  for (const link of links) {
    const manual = state.players.find(p => p.id === link.playerId);
    const external = match.players.find(p => p.puuid === link.puuid);
    check(manual && external, 'Associação de jogador inválida.');
    check(manual.team === (external.team === 'Red' ? redTeam : redTeam === 'A' ? 'B' : 'A'), `Confira o time de ${manual.name}.`);
  }
}
export function applyMatchImport(state: ScrimState, input: MatchImport, at: number): ScrimState {
  const { match, mapIndex, redTeam, links } = input;
  check(match && Array.isArray(match.players) && Array.isArray(match.rounds), 'Partida inválida.');
  check(state.phase === 'live' && currentMapIndex(state) === mapIndex, 'Importe o próximo mapa da série, após concluir o veto.');
  const map = state.maps[mapIndex];
  check(map && map.mapId === match.mapId, 'O mapa da API não corresponde ao mapa selecionado.');
  check(!map.rounds.length && !Object.keys(map.stats).length && !map.source, 'Este mapa já possui resultado ou estatísticas; a importação não sobrescreve dados.');
  check(!state.maps.some(m => m.source?.matchId === match.id), 'Esta partida já foi importada.');
  check(/^[a-f0-9-]{36}$/.test(match.id) && Number.isFinite(match.startedAt) && match.durationMs > 0, 'Identificação da partida inválida.');
  check(match.players.length === 10 && new Set(match.players.map(p => p.puuid)).size === 10, 'A partida precisa ter dez jogadores distintos.');
  check(['Red', 'Blue'].every(t => match.players.filter(p => p.team === t).length === 5), 'A partida precisa ter dois times de cinco.');
  validateMapping(state, match, links, redTeam);
  const team = (t: string): TeamId => t === 'Red' ? redTeam : redTeam === 'A' ? 'B' : 'A';
  const rounds = match.rounds.map((winner, i) => {
    check(winner === 'Red' || winner === 'Blue', 'Vencedor de round inválido.');
    // The provider does not supply round wall-clock timestamps. Keep match start,
    // and use source.durationMs for duration rather than inventing round times.
    return { number: i + 1, winner: team(winner), at: match.startedAt };
  });
  check(rounds.length >= 13 && rounds.length <= 200, 'Partida incompleta ou formato não suportado.');
  const finished = { ...map, rounds };
  check(mapWinner(finished), 'A partida ainda não terminou.');
  for (let end = 1; end < rounds.length; end++) check(!mapWinner({ ...finished, rounds: rounds.slice(0, end) }), 'Sequência de rounds inválida.');
  const score = mapScore(finished);
  check(score[redTeam] === match.score.Red && score[redTeam === 'A' ? 'B' : 'A'] === match.score.Blue, 'Placar e rounds divergentes.');
  const stats = Object.fromEntries(links.map(link => {
    const p = match.players.find(p => p.puuid === link.puuid)!;
    for (const n of [p.kills, p.deaths, p.assists, p.score, p.damage, p.headshots, p.bodyshots, p.legshots]) check(Number.isSafeInteger(n) && n >= 0 && n <= 1000000, 'Estatísticas inválidas.');
    return [link.playerId, { kills: p.kills, deaths: p.deaths, assists: p.assists,
      detail: { agent: p.agent, score: p.score, damage: p.damage, headshots: p.headshots, bodyshots: p.bodyshots, legshots: p.legshots } }];
  }));
  const source: ImportSource = { provider: 'henrik', matchId: match.id, region: match.region, startedAt: match.startedAt,
    durationMs: match.durationMs, importedAt: at, confirmedBy: 'scrim-admin',
    ...(match.redStartingSide ? { actualStartingSide: { [redTeam]: match.redStartingSide, [redTeam === 'A' ? 'B' : 'A']: match.redStartingSide === 'atk' ? 'def' : 'atk' } as Record<TeamId, 'atk' | 'def'> } : {}) };
  const maps = state.maps.map((m, i) => i === mapIndex ? { ...m, rounds, stats, source } : m);
  const players = state.players.map(p => {
    const link = links.find(l => l.playerId === p.id)!;
    const remote = match.players.find(x => x.puuid === link.puuid)!;
    return { ...p, riot: { puuid: remote.puuid, name: remote.name, tag: remote.tag } };
  });
  const next = { ...state, maps, players };
  return { ...next, phase: seriesWinner(next) ? 'finished' : 'live' };
}

const normalized = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9#]/g, '');
/** Only unique candidates within the corresponding team are suggested. Admin reviews all. */
export function suggestLinks(state: ScrimState, match: ExternalMatch, redTeam: TeamId): PlayerLink[] {
  const result: PlayerLink[] = [];
  for (const manual of state.players) {
    const candidates = match.players.filter(p => (p.team === 'Red' ? redTeam : redTeam === 'A' ? 'B' : 'A') === manual.team &&
      (manual.riot ? manual.riot.puuid === p.puuid : [p.name, `${p.name}#${p.tag}`].some(n => normalized(n) === normalized(manual.name))));
    if (candidates.length === 1) result.push({ playerId: manual.id, puuid: candidates[0]!.puuid });
  }
  const counts = new Map<string, number>();
  for (const x of result) counts.set(x.puuid, (counts.get(x.puuid) ?? 0) + 1);
  return result.filter(x => counts.get(x.puuid) === 1);
}
export function extractMatchId(input: string): string | null {
  const raw = input.trim();
  if (/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(raw)) return raw.toLowerCase();
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.hostname !== 'tracker.gg') return null;
    return extractMatchId(u.pathname.match(/^\/valorant\/match\/([^/]+)\/?$/)?.[1] ?? '');
  } catch { return null; }
}
