import { describe, expect, it } from 'vitest';
import {
  affectedResults,
  champion,
  changeFormat,
  confirmWinner,
  createBracket,
  findMatch,
  isFormatLocked,
  matches,
  stages,
  type Bracket,
} from './model';

const names = (count: number) => Array.from({ length: count }, (_, i) => `Jogador ${i + 1}`);
function play(bracket: Bracket, index = 0): Bracket {
  let guard = 100;
  const losses = new Map<string, number>();
  const games = new Map<string, number>();
  while (!champion(bracket) && guard-- > 0) {
    const match = matches(bracket)
      .flat()
      .find((item) => item.status === 'ready');
    expect(match, 'unfinished bracket must have a playable match').toBeDefined();
    for (const player of match!.players) {
      expect(player).not.toBeNull();
      expect(losses.get(player!.id) ?? 0).toBe(
        match!.lane === 'upper'
          ? 0
          : match!.lane === 'lower'
            ? 1
            : match!.players[0]!.id === player!.id
              ? 0
              : 1,
      );
      games.set(player!.id, (games.get(player!.id) ?? 0) + 1);
    }
    const winner = match!.players[index]!;
    const loser = match!.players[1 - index]!;
    losses.set(loser.id, (losses.get(loser.id) ?? 0) + 1);
    bracket = confirmWinner(bracket, match!.id, winner.id, bracket.revision);
  }
  expect(guard).toBeGreaterThan(0);
  expect(Object.keys(bracket.results)).toHaveLength(2 * bracket.entrants.length - 2);
  // Every entrant actually plays at least twice; automatic advances are not games.
  for (const entrant of bracket.entrants) expect(games.get(entrant.id)).toBeGreaterThanOrEqual(2);
  expect(
    matches(bracket)
      .flat()
      .some((match) => match.status === 'ready' || match.status === 'waiting'),
  ).toBe(false);
  return bracket;
}

describe('X1 double elimination with a single grand final', () => {
  it.each(Array.from({ length: 31 }, (_, i) => i + 2))(
    'routes %i entrants with either side winning, including non-power-of-two brackets',
    (count) => {
      for (const side of [0, 1])
        play(createBracket(names(count), undefined, 'Brasa', 'double'), side);
    },
  );

  it.each([2, 3, 5, 10, 17])(
    'handles %i entrants in an oversized 32-slot bracket without phantom losses',
    (count) => {
      for (const side of [0, 1]) play(createBracket(names(count), 32, 'Brasa', 'double'), side);
    },
  );

  it('makes the upper loser continue in lower and the lower loser leave after the second defeat', () => {
    let bracket = createBracket(names(4), 4, 'Brasa', 'double');
    bracket = confirmWinner(bracket, 'r0-m0', 'p1', bracket.revision);
    expect(findMatch(bracket, 'l0-m0').players[0]?.id).toBe('p4');
    expect(findMatch(bracket, 'l0-m0').status).toBe('waiting');
    bracket = confirmWinner(bracket, 'r0-m1', 'p2', bracket.revision);
    expect(findMatch(bracket, 'l0-m0').players.map((p) => p?.id)).toEqual(['p4', 'p3']);
    bracket = confirmWinner(bracket, 'l0-m0', 'p4', bracket.revision);
    expect(
      matches(bracket)
        .flat()
        .filter((match) => match.players.some((p) => p?.id === 'p3'))
        .every((match) => match.status === 'finished'),
    ).toBe(true);
    expect(champion(bracket)).toBeNull();
  });

  it('ends immediately when the lower winner wins the grand final; there is no reset', () => {
    let bracket = createBracket(names(2), 2, 'Brasa', 'double');
    expect(stages(bracket).map((stage) => stage.lane)).toEqual(['upper', 'final']);
    bracket = confirmWinner(bracket, 'r0-m0', 'p1', bracket.revision);
    expect(champion(bracket)).toBeNull();
    expect(findMatch(bracket, 'gf-m0').players.map((p) => p?.id)).toEqual(['p1', 'p2']);
    bracket = confirmWinner(bracket, 'gf-m0', 'p2', bracket.revision, false, [1, 3]);
    expect(champion(bracket)?.id).toBe('p2');
    expect(Object.keys(bracket.results)).toHaveLength(2);
    expect(matches(bracket).flat()).toHaveLength(2);
  });

  it('reopens descendants of BOTH winner and loser, preserves independent matches and records history', () => {
    const complete = play(createBracket(names(8), 8, 'Brasa', 'double'));
    const affected = affectedResults(complete, 'r0-m0', 'p8');
    expect(affected).toEqual(
      expect.arrayContaining([
        'r1-m0',
        'r2-m0',
        'l0-m0',
        'l1-m0',
        'l1-m1',
        'l2-m0',
        'l3-m0',
        'gf-m0',
      ]),
    );
    expect(affected).not.toContain('l0-m1');
    expect(() => confirmWinner(complete, 'r0-m0', 'p8', complete.revision)).toThrow(
      'resultados seguintes',
    );
    const corrected = confirmWinner(complete, 'r0-m0', 'p8', complete.revision, true);
    for (const id of affected) expect(corrected.results[id]).toBeUndefined();
    for (const id of ['r0-m1', 'r0-m2', 'r0-m3', 'r1-m1', 'l0-m1'])
      expect(corrected.results[id]).toBe(complete.results[id]);
    expect(findMatch(corrected, 'l0-m0').players[0]?.id).toBe('p1');
    expect(champion(corrected)).toBeNull();
    expect(corrected.decisions).toHaveLength(complete.decisions.length + 1);
    expect(corrected.decisions.at(-1)).toBe(complete.decisions.at(-1));
    const same = confirmWinner(complete, 'r0-m0', 'p1', complete.revision, false, [1, 0]);
    expect(same.results['gf-m0']).toBe(complete.results['gf-m0']);
  });

  it('crosses the lower injection so upper semifinal losers do not immediately replay their own opponents', () => {
    let bracket = createBracket(names(16), 16, 'Brasa', 'double');
    const played = new Set<string>();
    while (true) {
      const match = matches(bracket)
        .flat()
        .find((item) => item.status === 'ready');
      if (!match) break;
      const pair = match.players
        .map((player) => player!.id)
        .sort()
        .join('/');
      if (match.lane === 'lower' && match.laneRound % 2 === 1 && match.laneRound < 5)
        expect(played.has(pair)).toBe(false);
      played.add(pair);
      bracket = confirmWinner(bracket, match.id, match.players[0]!.id, bracket.revision);
    }
  });

  it('locks formats along actual dependencies, without blocking an unrelated unplayed upper final', () => {
    let bracket = createBracket(names(4), 4, 'Brasa', 'double');
    bracket = confirmWinner(bracket, 'r0-m0', 'p1', bracket.revision);
    bracket = confirmWinner(bracket, 'r0-m1', 'p2', bracket.revision);
    bracket = confirmWinner(bracket, 'l0-m0', 'p4', bracket.revision);
    expect(isFormatLocked(bracket, 0)).toBe(true);
    expect(isFormatLocked(bracket, 1)).toBe(false);
    const changed = changeFormat(bracket, 1, 5);
    expect(findMatch(changed, 'r1-m0').format).toBe(5);
    expect(() => changeFormat(bracket, 2, 5)).toThrow('protegido');
    expect(() => confirmWinner(bracket, 'l0-m0', 'p1', bracket.revision)).toThrow(
      'dois participantes',
    );
    expect(() => confirmWinner(bracket, 'gf-m0', 'p1', bracket.revision)).toThrow(
      'confronto pronto',
    );
  });
});
