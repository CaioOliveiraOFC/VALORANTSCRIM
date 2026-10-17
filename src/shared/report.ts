/**
 * Relatório pós-scrim, derivado apenas do estado (que vem do log de eventos).
 * Usado na tela de relatório e na exportação em Markdown.
 */

import { MAPS } from './maps.js';
import {
  TEAM_IDS,
  describeVetoEntry,
  mapScore,
  mapWinner,
  seriesScore,
  seriesWinner,
  sideInRound,
  type ScrimState,
  type SeriesMap,
  type Side,
  type TeamId,
} from './scrim.js';
import { FORMAT_LABEL } from './veto.js';

export interface MapReport {
  index: number;
  mapName: string;
  pickedBy: string;
  score: Record<TeamId, number>;
  winner: TeamId | null;
  /** Rounds vencidos por time em cada lado. */
  bySide: Record<TeamId, Record<Side, number>>;
  /** Vencedor dos rounds pistol (1 e 13). */
  pistols: { round: number; winner: TeamId }[];
  longestStreak: { team: TeamId; length: number; from: number } | null;
  overtime: boolean;
  durationMin: number | null;
}

export function buildMapReport(state: ScrimState, map: SeriesMap, index: number): MapReport {
  const bySide: MapReport['bySide'] = { A: { atk: 0, def: 0 }, B: { atk: 0, def: 0 } };
  let streak: MapReport['longestStreak'] = null;
  let run = { team: null as TeamId | null, length: 0, from: 0 };

  const startingSide = map.source?.actualStartingSide ?? map.startingSide;
  for (const r of map.rounds) {
    if (startingSide) bySide[r.winner][sideInRound(startingSide[r.winner], r.number)]++;
    run = r.winner === run.team ? { ...run, length: run.length + 1 } : { team: r.winner, length: 1, from: r.number };
    if (!streak || run.length > streak.length) streak = { team: r.winner, length: run.length, from: run.from };
  }

  const first = map.rounds[0];
  const last = map.rounds[map.rounds.length - 1];

  return {
    index,
    mapName: MAPS[map.mapId].name,
    pickedBy: map.pickedBy ? state.teams[map.pickedBy].name : 'Decider',
    score: mapScore(map),
    winner: mapWinner(map),
    bySide,
    pistols: map.rounds.filter((r) => r.number === 1 || r.number === 13).map((r) => ({ round: r.number, winner: r.winner })),
    longestStreak: streak,
    overtime: map.rounds.length > 24,
    durationMin: map.source ? Math.round(map.source.durationMs / 60000) : first && last && last !== first ? Math.round((last.at - first.at) / 60000) : null,
  };
}

export interface PlayerTotals {
  playerId: string;
  name: string;
  team: TeamId;
  kills: number;
  deaths: number;
  assists: number;
  maps: number;
}

export function playerTotals(state: ScrimState): PlayerTotals[] {
  const rows = new Map<string, PlayerTotals>();
  for (const map of state.maps) {
    for (const [playerId, line] of Object.entries(map.stats)) {
      const p = state.players.find((x) => x.id === playerId);
      if (!p?.team) continue;
      const row = rows.get(playerId) ?? { playerId, name: p.name, team: p.team, kills: 0, deaths: 0, assists: 0, maps: 0 };
      row.kills += line.kills;
      row.deaths += line.deaths;
      row.assists += line.assists;
      row.maps += 1;
      rows.set(playerId, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.kills - b.deaths - (a.kills - a.deaths));
}

export const kd = (k: number, d: number) => (d === 0 ? k.toFixed(2) : (k / d).toFixed(2));

const sideLabel = (s: Side) => (s === 'atk' ? 'Ataque' : 'Defesa');
const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

export function toMarkdown(state: ScrimState): string {
  const t = (id: TeamId) => state.teams[id].name;
  const score = seriesScore(state);
  const winner = seriesWinner(state);
  const lines: string[] = [];

  lines.push(`# ${state.title}`, '');
  lines.push(`- **Data:** ${fmtDate(state.createdAt)}`);
  lines.push(`- **Formato:** ${FORMAT_LABEL[state.format]}`);
  lines.push(`- **Placar da série:** ${t('A')} ${score.A} x ${score.B} ${t('B')}${winner ? ` — vitória de **${t(winner)}**` : ' (em andamento)'}`);
  lines.push('');

  lines.push('## Times', '');
  for (const id of TEAM_IDS) {
    const roster = state.players
      .filter((p) => p.team === id)
      .map((p) => (state.teams[id].captainId === p.id ? `${p.name} (C)` : p.name));
    lines.push(`- **${t(id)}:** ${roster.join(', ') || '—'}`);
  }
  lines.push('');

  if (state.veto.length) {
    lines.push('## Veto', '');
    state.veto.forEach((v) => lines.push(`${v.step}. ${describeVetoEntry(state, v)}`));
    lines.push('');
  }

  state.maps.forEach((map, i) => {
    const r = buildMapReport(state, map, i);
    lines.push(`## Mapa ${i + 1}: ${r.mapName} (pick: ${r.pickedBy})`, '');
    if (!map.rounds.length) {
      lines.push('_Não jogado._', '');
      return;
    }
    lines.push(`**${t('A')} ${r.score.A} x ${r.score.B} ${t('B')}**${r.overtime ? ' (prorrogação)' : ''}${r.durationMin ? ` · ~${r.durationMin} min` : ''}`, '');
    const startingSide = map.source?.actualStartingSide ?? map.startingSide;
    if (map.source) lines.push(`- Fonte: HenrikDev · partida ${map.source.matchId} · início ${fmtDate(map.source.startedAt)} · importada ${fmtDate(map.source.importedAt)} pelo admin da scrim`, '');
    if (startingSide) {
      lines.push('| Time | Lado inicial | Rounds no ataque | Rounds na defesa |', '|---|---|---|---|');
      for (const id of TEAM_IDS) {
        lines.push(`| ${t(id)} | ${sideLabel(startingSide[id])} | ${r.bySide[id].atk} | ${r.bySide[id].def} |`);
      }
      lines.push('');
    }
    if (r.pistols.length) lines.push(`- Pistols: ${r.pistols.map((p) => `R${p.round} → ${t(p.winner)}`).join(', ')}`);
    if (r.longestStreak) lines.push(`- Maior sequência: ${t(r.longestStreak.team)}, ${r.longestStreak.length} rounds a partir do R${r.longestStreak.from}`);
    lines.push(`- Rounds: ${map.rounds.map((x) => (x.winner === 'A' ? 'A' : 'B')).join('')}`);
    const notes = map.rounds.filter((x) => x.note);
    if (notes.length) {
      lines.push('', '**Notas de round:**');
      notes.forEach((x) => lines.push(`- R${x.number} (${t(x.winner)}): ${x.note}`));
    }
    const stats = Object.entries(map.stats);
    if (stats.length) {
      lines.push('', '| Jogador | Time | K | D | A | K/D | Agente | Dano | ADR | ACS | HS% |', '|---|---|---|---|---|---|---|---|---|---|---|');
      for (const [pid, s] of stats) {
        const p = state.players.find((x) => x.id === pid);
        if (p?.team) lines.push(`| ${p.name}${s.manualCorrection ? ' (K/D/A corrigido)' : ''} | ${t(p.team)} | ${s.kills} | ${s.deaths} | ${s.assists} | ${kd(s.kills, s.deaths)} | ${s.detail?.agent ?? '—'} | ${s.detail?.damage ?? '—'} | ${s.detail ? (s.detail.damage / map.rounds.length).toFixed(1) : '—'} | ${s.detail ? (s.detail.score / map.rounds.length).toFixed(1) : '—'} | ${s.detail && (s.detail.headshots + s.detail.bodyshots + s.detail.legshots) ? (100 * s.detail.headshots / (s.detail.headshots + s.detail.bodyshots + s.detail.legshots)).toFixed(1) : '—'} |`);
      }
    }
    lines.push('');
  });

  const totals = playerTotals(state);
  if (totals.length) {
    lines.push('## Totais por jogador', '', '| Jogador | Time | Mapas | K | D | A | K/D |', '|---|---|---|---|---|---|---|');
    totals.forEach((p) => lines.push(`| ${p.name} | ${t(p.team)} | ${p.maps} | ${p.kills} | ${p.deaths} | ${p.assists} | ${kd(p.kills, p.deaths)} |`));
    lines.push('');
  }

  if (state.notes.length) {
    lines.push('## Anotações', '');
    state.notes.forEach((n) => lines.push(`- ${fmtDate(n.at)} — ${n.text}`));
    lines.push('');
  }

  return lines.join('\n');
}
