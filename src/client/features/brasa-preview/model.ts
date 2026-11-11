/** Local-only prototype state. This module never reads or writes a hosted room. */
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
  players: [Entrant | null, Entrant | null];
  waiting: [boolean, boolean];
  status: 'waiting' | 'ready' | 'finished' | 'bye' | 'empty';
  winner: Entrant | null;
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
export const roundCount = (bracket: Bracket) => Math.log2(bracket.size);
export function stageName(round: number, count: number): string {
  return (
    ['Final', 'Semifinais', 'Quartas de final', 'Oitavas de final', 'Dezesseis-avos'][
      count - round - 1
    ] ?? 'Fase inicial'
  );
}
/** Seed placement spreads free slots, so absent opponents do not create fake matches. */
function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) order = order.flatMap((seed) => [seed, order.length * 2 + 1 - seed]);
  return order;
}
export function createBracket(names: string[], size?: number, title = 'Copa da Brasa'): Bracket {
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
  const count = Math.log2(capacity);
  return {
    title: cleanName(title, 80),
    entrants: cleaned.map((name, i) => ({ id: `p${i + 1}`, name })),
    size: capacity,
    formats: Array.from({ length: count }, (_, r) =>
      r === count - 1 ? 5 : r === count - 2 ? 3 : 1,
    ),
    results: {},
    revision: 0,
    decisions: [],
  };
}
export const matchId = (round: number, index: number) => `r${round}-m${index}`;
export function matches(bracket: Bracket): Match[][] {
  const seeds = seedOrder(bracket.size);
  const rounds: Match[][] = [];
  for (let round = 0; round < roundCount(bracket); round++) {
    const stage: Match[] = [];
    for (let index = 0; index < bracket.size / 2 ** (round + 1); index++) {
      const before = round
        ? [rounds[round - 1]![index * 2]!, rounds[round - 1]![index * 2 + 1]!]
        : null;
      const players = (
        before
          ? before.map((match) => match.winner)
          : [0, 1].map((offset) => bracket.entrants[seeds[index * 2 + offset]! - 1] ?? null)
      ) as Match['players'];
      const waiting = (
        before ? before.map((match) => ['ready', 'waiting'].includes(match.status)) : [false, false]
      ) as Match['waiting'];
      const id = matchId(round, index);
      const result = bracket.results[id];
      const winner = result
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
      stage.push({
        id,
        round,
        index,
        players,
        waiting,
        status,
        winner: winner ?? (automatic ? players.find(Boolean)! : null),
        format: bracket.formats[round]!,
        ...(winner && result ? { result } : {}),
      });
    }
    rounds.push(stage);
  }
  return rounds;
}
export function findMatch(bracket: Bracket, id: string): Match {
  const match = matches(bracket)
    .flat()
    .find((item) => item.id === id);
  if (!match) throw new Error('Este confronto não existe.');
  return match;
}
export function nextMatchId(bracket: Bracket, match: Match): string | null {
  return match.round + 1 < roundCount(bracket)
    ? matchId(match.round + 1, Math.floor(match.index / 2))
    : null;
}
export function affectedResults(bracket: Bracket, id: string, winnerId: string): string[] {
  let match = findMatch(bracket, id);
  if (match.winner?.id === winnerId) return [];
  const affected: string[] = [];
  let next: string | null;
  while ((next = nextMatchId(bracket, match))) {
    if (bracket.results[next]) affected.push(next);
    match = findMatch(bracket, next);
  }
  return affected;
}
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
      `${player.name} venceu ${stageName(match.round, roundCount(bracket)).toLocaleLowerCase('pt-BR')}${affected.length ? `; ${affected.length} resultado(s) seguinte(s) reaberto(s)` : ''}.`,
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
  if (
    matches(bracket)
      .slice(round)
      .flat()
      .some((match) => match.result)
  )
    throw new Error('Essa fase já tem resultados. O formato ficou protegido.');
  return {
    ...bracket,
    formats: bracket.formats.map((current, index) => (index === round ? format : current)),
    ...decision(bracket, `${stageName(round, roundCount(bracket))} configurada como MD${format}.`),
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
export function demoBracket(): Bracket {
  let bracket = createBracket(['Caio', 'Duda', 'Rafa', 'Alef', 'Isa', 'JP', 'Nando', 'Lucas']);
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
