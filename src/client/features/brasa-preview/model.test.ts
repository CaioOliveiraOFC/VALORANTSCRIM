import { describe, expect, it } from 'vitest';
import {
  acceptProposal,
  affectedResults,
  changeFormat,
  confirmWinner,
  createBracket,
  demoBracket,
  findMatch,
  matches,
  roundCount,
  type Bracket,
  type Proposal,
} from './model';

const names = (count: number) =>
  Array.from({ length: count }, (_, index) => `Jogador ${index + 1}`);
function finish(bracket: Bracket): Bracket {
  for (let round = 0; round < roundCount(bracket); round++) {
    for (const match of matches(bracket)[round]!) {
      if (match.status === 'ready')
        bracket = confirmWinner(bracket, match.id, match.players[0]!.id, bracket.revision);
    }
  }
  return bracket;
}

describe('prototype bracket rules', () => {
  it.each([2, 3, 4, 5, 7, 8, 10, 16, 17, 31, 32])(
    'finishes a %i-player bracket with exactly N-1 played decisions',
    (count) => {
      const initial = createBracket(names(count));
      const complete = finish(initial);
      expect(matches(complete).at(-1)?.[0]?.winner?.id).toBe('p1');
      expect(Object.keys(complete.results)).toHaveLength(count - 1);
      expect(complete.entrants).toEqual(initial.entrants);
      expect(Object.keys(initial.results)).toHaveLength(0);
    },
  );

  it('gives ten entrants six free first-round advances without inventing scores', () => {
    const bracket = createBracket(names(10));
    const rounds = matches(bracket);
    expect(bracket.size).toBe(16);
    expect(rounds[0]!.filter((match) => match.status === 'bye')).toHaveLength(6);
    expect(rounds[0]!.filter((match) => match.status === 'ready')).toHaveLength(2);
    expect(rounds.flat().filter((match) => match.result)).toHaveLength(0);
    expect(rounds.at(-1)?.[0]?.winner).toBeNull();
    expect(() =>
      confirmWinner(bracket, rounds[0]!.find((match) => match.status === 'bye')!.id, 'p1', 0),
    ).toThrow('confronto pronto');
  });

  it('supports a larger sparse bracket without prematurely advancing past a waiting game', () => {
    const bracket = createBracket(names(3), 16);
    expect(matches(bracket).at(-1)?.[0]?.winner).toBeNull();
    expect(Object.keys(finish(bracket).results)).toHaveLength(2);
  });

  it.each([0, 1, 33])('rejects unsupported entrant count %i', (count) => {
    expect(() => createBracket(names(count))).toThrow('entre 2 e 32');
  });

  it('rejects duplicate names, an undersized bracket and unsupported capacity', () => {
    expect(() => createBracket(['Caio', ' caio '])).toThrow('mesmo nome');
    expect(() => createBracket(names(10), 8)).toThrow('comporte');
    expect(() => createBracket(names(4), 6)).toThrow('comporte');
    expect(() => createBracket(['Caio\0', 'Duda'])).toThrow('caracteres');
  });

  it('rejects stale decisions, other participants and unresolved games', () => {
    const bracket = createBracket(names(4));
    expect(() => confirmWinner(bracket, 'r0-m0', 'p1', 1)).toThrow('A chave mudou');
    expect(() => confirmWinner(bracket, 'r0-m0', 'p2', 0)).toThrow('dois participantes');
    expect(() => confirmWinner(bracket, 'r1-m0', 'p1', 0)).toThrow('confronto pronto');
    expect(() => findMatch(bracket, 'r9-m9')).toThrow('não existe');
  });

  it('keeps downstream history and requires consent before reopening dependent results', () => {
    const complete = finish(createBracket(names(4)));
    expect(affectedResults(complete, 'r0-m0', 'p4')).toEqual(['r1-m0']);
    expect(() => confirmWinner(complete, 'r0-m0', 'p4', complete.revision)).toThrow(
      'resultados seguintes',
    );
    const corrected = confirmWinner(complete, 'r0-m0', 'p4', complete.revision, true);
    expect(corrected.results['r1-m0']).toBeUndefined();
    expect(corrected.results['r0-m1']).toEqual(complete.results['r0-m1']);
    expect(findMatch(corrected, 'r1-m0').players.map((player) => player?.id)).toEqual(['p4', 'p2']);
    expect(corrected.decisions).toHaveLength(complete.decisions.length + 1);
    expect(corrected.decisions[0]?.message).toContain('reaberto');
    expect(findMatch(complete, 'r1-m0').winner?.id).toBe('p1');
  });

  it('does not invalidate the final when confirming the same preceding winner', () => {
    const complete = finish(createBracket(names(4)));
    const next = confirmWinner(complete, 'r0-m0', 'p1', complete.revision);
    expect(next.results['r1-m0']).toEqual(complete.results['r1-m0']);
  });

  it('validates MD formats against the declared series winner', () => {
    const bracket = createBracket(names(2));
    expect(bracket.formats).toEqual([5]);
    expect(() => confirmWinner(bracket, 'r0-m0', 'p1', 0, false, [2, 1])).toThrow('formato');
    expect(() => confirmWinner(bracket, 'r0-m0', 'p1', 0, false, [3, 3])).toThrow('formato');
    expect(() => confirmWinner(bracket, 'r0-m0', 'p1', 0, false, [1, 3])).toThrow('formato');
    expect(confirmWinner(bracket, 'r0-m0', 'p2', 0, false, [2, 3]).results['r0-m0']?.wins).toEqual([
      2, 3,
    ]);
    const noScore = confirmWinner(bracket, 'r0-m0', 'p1', 0);
    expect(noScore.results['r0-m0']?.wins).toBeUndefined();
  });

  it('allows future-phase format changes but protects phases with decisions', () => {
    const bracket = demoBracket('single');
    expect(changeFormat(bracket, 1, 5).formats).toEqual([1, 5, 5]);
    expect(() => changeFormat(bracket, 0, 3)).toThrow('protegido');
    expect(() => changeFormat(bracket, -1, 1)).toThrow('inválido');
  });
});

describe('moderated display names', () => {
  const nickname: Proposal = {
    id: 'a',
    authorId: 'p1',
    kind: 'nickname',
    previous: 'Caio',
    value: 'Caio do churras',
    status: 'pending',
  };

  it('changes display text without changing identity, winners or old decision text', () => {
    const bracket = demoBracket();
    const next = acceptProposal(bracket, nickname);
    expect(next.entrants[0]).toEqual({ id: 'p1', name: 'Caio do churras' });
    expect(next.results).toBe(bracket.results);
    expect(next.decisions.at(-1)?.message).toBe(bracket.decisions.at(-1)?.message);
    expect(findMatch(next, 'r1-m0').players[0]?.name).toBe('Caio do churras');
    expect(bracket.entrants[0]?.name).toBe('Caio');
  });

  it('checks nickname collisions, stale names and repeated approvals', () => {
    const bracket = demoBracket();
    expect(() => acceptProposal(bracket, nickname, 'duda')).toThrow('já está em uso');
    expect(() => acceptProposal(bracket, { ...nickname, previous: 'Outro nome' })).toThrow('mudou');
    expect(() => acceptProposal(bracket, { ...nickname, status: 'accepted' })).toThrow(
      'já foi revisada',
    );
  });

  it('approves a title separately and prevents overwriting a newer title', () => {
    const bracket = demoBracket();
    const proposal: Proposal = {
      ...nickname,
      kind: 'title',
      previous: bracket.title,
      value: 'A última brasa',
    };
    const next = acceptProposal(bracket, proposal);
    expect(next.title).toBe('A última brasa');
    expect(next.entrants).toBe(bracket.entrants);
    expect(() => acceptProposal(next, proposal)).toThrow('título mudou');
    expect(() => acceptProposal(bracket, { ...proposal, value: ' ' })).toThrow('caracteres');
  });
});
