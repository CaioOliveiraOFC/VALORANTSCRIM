/** Local-only prototype state. This module never reads or writes a hosted room. */
import { stages, type Elimination, type Lane, type Source } from './structure';
export { stages, stageName, matchId, type Elimination } from './structure';
export type BestOf = 1 | 3 | 5;
export interface Entrant {
  id: string;
  name: string;
}
export interface Result {
  winnerId: string;
  wins?: [number, number];
}
export interface Decision {
  id: number;
  message: string;
}
export interface Bracket {
  title: string;
  elimination: Elimination;
  entrants: Entrant[];
  size: number;
  formats: BestOf[];
  results: Record<string, Result>;
  revision: number;
  decisions: Decision[];
}
export interface Match {
  id: string;
  round: number;
  index: number;
  lane: Lane;
  laneRound: number;
  sources: [Source, Source];
  players: [Entrant | null, Entrant | null];
  waiting: [boolean, boolean];
  status: 'waiting' | 'ready' | 'finished' | 'bye' | 'empty';
  winner: Entrant | null;
  loser: Entrant | null;
  result?: Result;
  format: BestOf;
}
export interface Proposal {
  id: string;
  authorId: string;
  kind: 'nickname' | 'title';
  value: string;
  previous: string;
  status: 'pending' | 'accepted' | 'rejected';
}

export function cleanName(value: string, max = 32): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > max || /[\u0000-\u001f\u007f]/.test(name))
    throw new Error(`Use um nome entre 1 e ${max} caracteres.`);
  return name;
}
export const roundCount = (bracket: Bracket) => stages(bracket).length;
export const stageLabel = (bracket: Bracket, round: number) => stages(bracket)[round]!.label;
export const eliminationLabel = (mode: Elimination) =>
  mode === 'double' ? 'Dupla eliminação' : 'Eliminação simples';
export function defaultFormat(
  stage: ReturnType<typeof stages>[number],
  size: number,
  elimination: Elimination,
): BestOf {
  const count = Math.log2(size);
  if (stage.lane === 'final') return 5;
  if (stage.lane === 'lower') return stage.laneRound === 2 * (count - 1) - 1 ? 3 : 1;
  if (stage.laneRound === count - 1) return elimination === 'double' ? 3 : 5;
  return stage.laneRound === count - 2 ? 3 : 1;
}
export function createBracket(
  names: string[],
  size?: number,
  title = 'Copa da Brasa',
  elimination: Elimination = 'single',
): Bracket {
  if (!['single', 'double'].includes(elimination))
    throw new Error('Modelo de campeonato inválido.');
  if (names.length < 2 || names.length > 32)
    throw new Error('Adicione entre 2 e 32 participantes.');
  const cleaned = names.map((name) => cleanName(name));
  if (new Set(cleaned.map((name) => name.toLocaleLowerCase('pt-BR'))).size !== names.length)
    throw new Error(
      'Dois participantes estão com o mesmo nome. Adicione um apelido para diferenciá-los.',
    );
  const capacity = size ?? 2 ** Math.ceil(Math.log2(names.length));
  if (![2, 4, 8, 16, 32].includes(capacity) || capacity < names.length)
    throw new Error('Escolha uma chave que comporte todos os participantes.');
  return {
    title: cleanName(title, 80),
    elimination,
    entrants: cleaned.map((name, i) => ({ id: `p${i + 1}`, name })),
    size: capacity,
    formats: stages({ size: capacity, elimination }).map((stage) =>
      defaultFormat(stage, capacity, elimination),
    ),
    results: {},
    revision: 0,
    decisions: [],
  };
}
export function matches(bracket: Bracket): Match[][] {
  const resolved = new Map<string, Match>();
  return stages(bracket).map((stage, round) =>
    stage.matches.map((spec, index) => {
      const slots = spec.sources.map((source) => {
        if ('seed' in source)
          return { player: bracket.entrants[source.seed - 1] ?? null, waiting: false };
        const match = resolved.get(source.matchId)!;
        return {
          player: match[source.outcome],
          waiting: ['ready', 'waiting'].includes(match.status),
        };
      });
      const players = slots.map((slot) => slot.player) as Match['players'];
      const waiting = slots.map((slot) => slot.waiting) as Match['waiting'];
      const result = bracket.results[spec.id];
      // A stale result must never turn a waiting or one-player match into a played game.
      const winner =
        !waiting.some(Boolean) && players.every(Boolean) && result
          ? (players.find((player) => player?.id === result.winnerId) ?? null)
          : null;
      const automatic = !waiting.some(Boolean) && players.filter(Boolean).length === 1;
      const status: Match['status'] = waiting.some(Boolean)
        ? 'waiting'
        : winner
          ? 'finished'
          : players.every(Boolean)
            ? 'ready'
            : automatic
              ? 'bye'
              : 'empty';
      const match: Match = {
        id: spec.id,
        round,
        index,
        lane: stage.lane,
        laneRound: stage.laneRound,
        sources: spec.sources,
        players,
        waiting,
        status,
        winner: winner ?? (automatic ? players.find(Boolean)! : null),
        loser: winner ? players.find((player) => player && player.id !== winner.id)! : null,
        format: bracket.formats[round]!,
        ...(winner && result ? { result } : {}),
      };
      resolved.set(spec.id, match);
      return match;
    }),
  );
}
export function findMatch(bracket: Bracket, id: string): Match {
  const match = matches(bracket)
    .flat()
    .find((item) => item.id === id);
  if (!match) throw new Error('Este confronto não existe.');
  return match;
}
export function destinationId(
  bracket: Bracket,
  id: string,
  outcome: 'winner' | 'loser',
): string | null {
  return (
    stages(bracket)
      .flatMap((stage) => stage.matches)
      .find((match) =>
        match.sources.some(
          (source) => 'matchId' in source && source.matchId === id && source.outcome === outcome,
        ),
      )?.id ?? null
  );
}
export const nextMatchId = (bracket: Bracket, match: Match) =>
  destinationId(bracket, match.id, 'winner');
/** Corrections affect BOTH outgoing paths, including lower results already played. */
function descendants(bracket: Bracket, ids: string[]): Set<string> {
  const seen = new Set(ids);
  for (const match of stages(bracket).flatMap((stage) => stage.matches)) {
    if (match.sources.some((source) => 'matchId' in source && seen.has(source.matchId)))
      seen.add(match.id);
  }
  ids.forEach((id) => seen.delete(id));
  return seen;
}
export function affectedResults(bracket: Bracket, id: string, winnerId: string): string[] {
  if (findMatch(bracket, id).winner?.id === winnerId) return [];
  return [...descendants(bracket, [id])].filter((id) => bracket.results[id]);
}
export function isFormatLocked(bracket: Bracket, round: number): boolean {
  const ids = stages(bracket)[round]!.matches.map((match) => match.id);
  return [...ids, ...descendants(bracket, ids)].some((id) => !!bracket.results[id]);
}
export function sourceLabel(bracket: Bracket, match: Match, index: number): string {
  const source = match.sources[index]!;
  if ('seed' in source) return 'Vaga livre';
  const parent = findMatch(bracket, source.matchId);
  return `${source.outcome === 'winner' ? 'Vencedor' : 'Perdedor'}: ${stageLabel(bracket, parent.round)}, duelo ${parent.index + 1}`;
}
export function winnerConsequence(bracket: Bracket, match: Match, winnerId: string): string {
  const loser = match.players.find((player) => player && player.id !== winnerId);
  const next = nextMatchId(bracket, match);
  if (!next) return 'Será o campeão deste exemplo. A final é uma série única.';
  const advancement = `Avança para ${stageLabel(bracket, findMatch(bracket, next).round)}.`;
  if (bracket.elimination === 'single') return `${advancement} ${loser?.name} será eliminado.`;
  if (match.lane === 'lower')
    return `${advancement} ${loser?.name} será eliminado pela segunda derrota.`;
  const loserNext = destinationId(bracket, match.id, 'loser');
  return `${advancement} ${loser?.name} segue para ${loserNext === 'gf-m0' ? 'a grande final' : 'a lower'} e continua no campeonato.`;
}
export const champion = (bracket: Bracket) => matches(bracket).at(-1)![0]!.winner;
function decision(bracket: Bracket, message: string): Pick<Bracket, 'revision' | 'decisions'> {
  const revision = bracket.revision + 1;
  return { revision, decisions: [{ id: revision, message }, ...bracket.decisions] };
}
export function confirmWinner(
  bracket: Bracket,
  id: string,
  winnerId: string,
  revision: number,
  invalidate = false,
  wins?: [number, number],
): Bracket {
  if (revision !== bracket.revision)
    throw new Error('A chave mudou. Confira o confronto antes de confirmar.');
  const match = findMatch(bracket, id);
  if (
    !['ready', 'finished'].includes(match.status) ||
    !match.players.some((player) => player?.id === winnerId)
  )
    throw new Error('Escolha um dos dois participantes de um confronto pronto.');
  if (wins) {
    const needed = (match.format + 1) / 2;
    const winnerIndex = match.players.findIndex((player) => player?.id === winnerId);
    if (
      !wins.every((value) => Number.isInteger(value) && value >= 0) ||
      wins[winnerIndex] !== needed ||
      wins[1 - winnerIndex]! >= needed
    )
      throw new Error('Este placar não corresponde ao formato da série.');
  }
  const affected = affectedResults(bracket, id, winnerId);
  if (affected.length && !invalidate)
    throw new Error('Revise os resultados seguintes antes de alterar o vencedor.');
  const results = { ...bracket.results, [id]: { winnerId, ...(wins ? { wins } : {}) } };
  for (const dependent of affected) delete results[dependent];
  const player = match.players.find((item) => item?.id === winnerId)!;
  return {
    ...bracket,
    results,
    ...decision(
      bracket,
      `${player.name} venceu ${stageLabel(bracket, match.round).toLocaleLowerCase('pt-BR')}${affected.length ? `; ${affected.length} resultado(s) seguinte(s) reaberto(s)` : ''}.`,
    ),
  };
}
export function changeFormat(bracket: Bracket, round: number, format: BestOf): Bracket {
  if (
    !Number.isInteger(round) ||
    round < 0 ||
    round >= roundCount(bracket) ||
    ![1, 3, 5].includes(format)
  )
    throw new Error('Fase ou formato inválido.');
  if (isFormatLocked(bracket, round))
    throw new Error('Essa fase já tem resultados. O formato ficou protegido.');
  return {
    ...bracket,
    formats: bracket.formats.map((current, index) => (index === round ? format : current)),
    ...decision(bracket, `${stageLabel(bracket, round)} configurada como MD${format}.`),
  };
}
export function acceptProposal(bracket: Bracket, proposal: Proposal, adjusted?: string): Bracket {
  if (proposal.status !== 'pending') throw new Error('Esta sugestão já foi revisada.');
  const value = cleanName(adjusted ?? proposal.value, proposal.kind === 'title' ? 80 : 32);
  if (proposal.kind === 'title') {
    if (proposal.previous !== bracket.title)
      throw new Error('O título mudou desde o envio. Revise a sugestão com o título atual.');
    return {
      ...bracket,
      title: value,
      ...decision(bracket, `Nome do campeonato atualizado para ${value}.`),
    };
  }
  const player = bracket.entrants.find((item) => item.id === proposal.authorId);
  if (!player) throw new Error('Participante não encontrado.');
  if (proposal.previous !== player.name)
    throw new Error('O apelido mudou desde o envio. Revise a sugestão com o nome atual.');
  if (
    bracket.entrants.some(
      (item) =>
        item.id !== player.id &&
        item.name.toLocaleLowerCase('pt-BR') === value.toLocaleLowerCase('pt-BR'),
    )
  )
    throw new Error('Este apelido já está em uso. Adicione um diferenciador.');
  return {
    ...bracket,
    entrants: bracket.entrants.map((item) =>
      item.id === player.id ? { ...item, name: value } : item,
    ),
    ...decision(bracket, `${player.name} agora aparece como ${value}.`),
  };
}
export function demoBracket(elimination: Elimination = 'double'): Bracket {
  let bracket = createBracket(
    ['Caio', 'Duda', 'Rafa', 'Alef', 'Isa', 'JP', 'Nando', 'Lucas'],
    undefined,
    'Copa da Brasa',
    elimination,
  );
  bracket = confirmWinner(bracket, 'r0-m0', 'p1', bracket.revision, false, [1, 0]);
  bracket = confirmWinner(bracket, 'r0-m1', 'p4', bracket.revision, false, [1, 0]);
  return bracket;
}
export function demoProposals(bracket: Bracket): Proposal[] {
  return [
    {
      id: 'proposal1',
      authorId: 'p2',
      kind: 'nickname',
      value: 'dudinha',
      previous: bracket.entrants[1]!.name,
      status: 'pending',
    },
    {
      id: 'proposal2',
      authorId: 'p3',
      kind: 'title',
      value: 'Só mais uma, Brasa',
      previous: bracket.title,
      status: 'pending',
    },
    {
      id: 'proposal3',
      authorId: 'p6',
      kind: 'nickname',
      value: 'JP do churras',
      previous: bracket.entrants[5]!.name,
      status: 'pending',
    },
  ];
}
