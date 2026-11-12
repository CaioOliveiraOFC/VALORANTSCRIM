/** Deterministic, acyclic routing shared by the local model and its visualizations. */
export type Elimination = 'single' | 'double';
export type Lane = 'upper' | 'lower' | 'final';
export type Source = { seed: number } | { matchId: string; outcome: 'winner' | 'loser' };
export interface MatchSpec {
  id: string;
  sources: [Source, Source];
}
export interface Stage {
  id: string;
  label: string;
  lane: Lane;
  laneRound: number;
  matches: MatchSpec[];
}

export function stageName(round: number, count: number): string {
  return (
    ['Final', 'Semifinais', 'Quartas de final', 'Oitavas de final', 'Dezesseis-avos'][
      count - round - 1
    ] ?? 'Fase inicial'
  );
}
export const matchId = (round: number, index: number) => `r${round}-m${index}`;
const upper = (round: number, index: number, outcome: 'winner' | 'loser' = 'winner'): Source => ({
  matchId: matchId(round, index),
  outcome,
});
const lowerId = (round: number, index: number) => `l${round}-m${index}`;
const lower = (round: number, index: number): Source => ({
  matchId: lowerId(round, index),
  outcome: 'winner',
});

export function stages(bracket: { size: number; elimination: Elimination }): Stage[] {
  const count = Math.log2(bracket.size);
  let seeds = [1, 2];
  while (seeds.length < bracket.size)
    seeds = seeds.flatMap((seed) => [seed, seeds.length * 2 + 1 - seed]);
  const result: Stage[] = Array.from({ length: count }, (_, round) => ({
    id: `upper-${round}`,
    lane: 'upper',
    laneRound: round,
    label: `${bracket.elimination === 'double' ? 'Upper · ' : ''}${stageName(round, count)}`,
    matches: Array.from({ length: bracket.size / 2 ** (round + 1) }, (_, index) => ({
      id: matchId(round, index),
      sources: round
        ? [upper(round - 1, index * 2), upper(round - 1, index * 2 + 1)]
        : [{ seed: seeds[index * 2]! }, { seed: seeds[index * 2 + 1]! }],
    })),
  }));
  if (bracket.elimination === 'single') return result;
  const lowerRounds = 2 * (count - 1);
  for (let round = 0; round < lowerRounds; round++) {
    const total = bracket.size / 2 ** (Math.floor(round / 2) + 2);
    result.push({
      id: `lower-${round}`,
      lane: 'lower',
      laneRound: round,
      label: round === lowerRounds - 1 ? 'Final da lower' : `Lower · Rodada ${round + 1}`,
      matches: Array.from({ length: total }, (_, index) => ({
        id: lowerId(round, index),
        sources:
          round === 0
            ? [upper(0, index * 2, 'loser'), upper(0, index * 2 + 1, 'loser')]
            : round % 2 === 1
              ? // Cross neighboring subtrees before merging, avoiding an immediate rematch.
                [
                  lower(round - 1, index),
                  upper((round + 1) / 2, total > 1 ? index ^ 1 : index, 'loser'),
                ]
              : [lower(round - 1, index * 2), lower(round - 1, index * 2 + 1)],
      })),
    });
  }
  result.push({
    id: 'grand-final',
    label: 'Grande final',
    lane: 'final',
    laneRound: 0,
    matches: [
      {
        id: 'gf-m0',
        sources: [
          upper(count - 1, 0),
          count === 1 ? upper(0, 0, 'loser') : lower(lowerRounds - 1, 0),
        ],
      },
    ],
  });
  return result;
}
