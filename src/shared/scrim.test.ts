import { describe, expect, it } from 'vitest';
import { toMarkdown } from './report.js';
import {
  DomainError,
  applyEvent,
  currentVetoStep,
  initialState,
  mapWinner,
  sideInRound,
  type Command,
  type ScrimEvent,
  type ScrimState,
  type SeriesMap,
  type TeamId,
} from './scrim.js';
import type { SeriesFormat } from './veto.js';

function scrim(format: SeriesFormat = 'bo3') {
  let state = applyEvent(initialState(), { seq: 1, at: 0, type: 'scrim.create', id: 'abc123', title: 'Teste', format });
  const run = (cmd: Command) => {
    state = applyEvent(state, { ...cmd, seq: state.version + 1, at: state.version * 1000 } as ScrimEvent);
    return state;
  };
  return { run, get: () => state };
}

const step = (s: ScrimState) => {
  const st = currentVetoStep(s);
  return st ? `${st.kind}:${st.team}` : null;
};

describe('veto MD3 (VCT ruleset)', () => {
  it('segue ban, ban, pick, lado, pick, lado, ban, ban, decider, lado', () => {
    const { run, get } = scrim('bo3');
    // Time B ganhou o sorteio e escolheu ser o Team A do rulebook.
    run({ type: 'veto.start', first: 'B' });
    const trace: (string | null)[] = [];
    const actions: Command[] = [
      { type: 'veto.ban', mapId: 'abyss' },
      { type: 'veto.ban', mapId: 'bind' },
      { type: 'veto.pick', mapId: 'haven' },
      { type: 'veto.side', side: 'def' },
      { type: 'veto.pick', mapId: 'lotus' },
      { type: 'veto.side', side: 'atk' },
      { type: 'veto.ban', mapId: 'corrode' },
      { type: 'veto.ban', mapId: 'summit' },
      { type: 'veto.side', side: 'atk' },
    ];
    for (const a of actions) {
      trace.push(step(get()));
      run(a);
    }
    expect(trace).toEqual(['ban:B', 'ban:A', 'pick:B', 'side:A', 'pick:A', 'side:B', 'ban:B', 'ban:A', 'side:B']);

    const s = get();
    expect(s.phase).toBe('live');
    expect(s.maps.map((m) => [m.mapId, m.pickedBy])).toEqual([
      ['haven', 'B'],
      ['lotus', 'A'],
      ['sunset', null],
    ]);
    // Quem não escolheu o mapa escolhe o lado.
    expect(s.maps[0]!.startingSide).toEqual({ A: 'def', B: 'atk' });
    expect(s.maps[1]!.startingSide).toEqual({ B: 'atk', A: 'def' });
    // Lado do decider é do Team A do rulebook (aqui, o time B).
    expect(s.maps[2]!.startingSide).toEqual({ B: 'atk', A: 'def' });
  });

  it('recusa ação fora de ordem e mapa já usado', () => {
    const { run } = scrim('bo3');
    run({ type: 'veto.start', first: 'A' });
    expect(() => run({ type: 'veto.pick', mapId: 'abyss' })).toThrow(DomainError);
    run({ type: 'veto.ban', mapId: 'abyss' });
    expect(() => run({ type: 'veto.ban', mapId: 'abyss' })).toThrow('Mapa indisponível');
  });

  it('desfaz a última ação, inclusive passando por cima do decider automático', () => {
    const { run, get } = scrim('bo3');
    run({ type: 'veto.start', first: 'A' });
    for (const m of ['abyss', 'bind'] as const) run({ type: 'veto.ban', mapId: m });
    run({ type: 'veto.pick', mapId: 'haven' });
    run({ type: 'veto.side', side: 'atk' });
    run({ type: 'veto.pick', mapId: 'lotus' });
    run({ type: 'veto.side', side: 'def' });
    run({ type: 'veto.ban', mapId: 'corrode' });
    run({ type: 'veto.ban', mapId: 'summit' });
    expect(get().veto.at(-1)!.kind).toBe('decider');
    run({ type: 'veto.undo' });
    expect(get().veto).toHaveLength(7);
    expect(step(get())).toBe('ban:B');
  });
});

describe('veto MD5 e MD1', () => {
  it('MD5: 2 bans, 4 picks com lado, decider com lado do Team A', () => {
    const { run, get } = scrim('bo5');
    run({ type: 'veto.start', first: 'A' });
    run({ type: 'veto.ban', mapId: 'abyss' });
    run({ type: 'veto.ban', mapId: 'bind' });
    for (const m of ['haven', 'lotus', 'corrode', 'summit'] as const) {
      run({ type: 'veto.pick', mapId: m });
      run({ type: 'veto.side', side: 'atk' });
    }
    expect(step(get())).toBe('side:A');
    run({ type: 'veto.side', side: 'def' });
    expect(get().maps.map((m) => m.pickedBy)).toEqual(['A', 'B', 'A', 'B', null]);
  });

  it('MD1: seis bans alternados e lado com o Team B', () => {
    const { run, get } = scrim('bo1');
    run({ type: 'veto.start', first: 'A' });
    for (const m of ['abyss', 'bind', 'corrode', 'haven', 'lotus', 'summit'] as const) run({ type: 'veto.ban', mapId: m });
    expect(step(get())).toBe('side:B');
    run({ type: 'veto.side', side: 'def' });
    expect(get().maps).toHaveLength(1);
    expect(get().maps[0]!.mapId).toBe('sunset');
  });
});

describe('placar', () => {
  const map = (seq: string): SeriesMap => ({
    mapId: 'haven',
    pickedBy: 'A',
    startingSide: { A: 'atk', B: 'def' },
    rounds: [...seq].map((w, i) => ({ number: i + 1, winner: w as TeamId, at: i })),
    stats: {},
  });

  it('13 rounds fecham o mapa', () => {
    expect(mapWinner(map('A'.repeat(13)))).toBe('A');
    expect(mapWinner(map('A'.repeat(12) + 'B'.repeat(12)))).toBeNull();
  });

  it('prorrogação exige 2 de vantagem', () => {
    const tied = 'AB'.repeat(12);
    expect(mapWinner(map(tied + 'A'))).toBeNull();
    expect(mapWinner(map(tied + 'AB'))).toBeNull();
    expect(mapWinner(map(tied + 'ABBB'))).toBe('B');
  });

  it('lados trocam no 13 e alternam na prorrogação', () => {
    expect([1, 12, 13, 24, 25, 26, 27].map((r) => sideInRound('atk', r))).toEqual(['atk', 'atk', 'def', 'def', 'atk', 'def', 'atk']);
  });

  it('a série termina quando alguém fecha a maioria dos mapas', () => {
    const { run, get } = scrim('bo3');
    run({ type: 'veto.start', first: 'A' });
    for (const m of ['abyss', 'bind'] as const) run({ type: 'veto.ban', mapId: m });
    run({ type: 'veto.pick', mapId: 'haven' });
    run({ type: 'veto.side', side: 'atk' });
    run({ type: 'veto.pick', mapId: 'lotus' });
    run({ type: 'veto.side', side: 'def' });
    run({ type: 'veto.ban', mapId: 'corrode' });
    run({ type: 'veto.ban', mapId: 'summit' });
    run({ type: 'veto.side', side: 'atk' });
    for (let i = 0; i < 26; i++) run({ type: 'round.win', team: 'A' });
    expect(get().phase).toBe('finished');
    expect(() => run({ type: 'round.win', team: 'A' })).toThrow(DomainError);
    run({ type: 'round.undo' });
    expect(get().phase).toBe('live');
    expect(toMarkdown(get())).toContain('Mapa 1: Haven');
  });
});

describe('integridade do log', () => {
  it('rejeita eventos com seq fora de ordem', () => {
    const s = initialState();
    expect(() => applyEvent(s, { seq: 2, at: 0, type: 'note.add', text: 'x' })).toThrow('fora de ordem');
  });

  it('valida nomes e limite de jogadores', () => {
    const { run } = scrim();
    expect(() => run({ type: 'player.add', playerId: 'p1', name: '   ' })).toThrow(DomainError);
    run({ type: 'player.add', playerId: 'p1', name: 'Caio' });
    expect(() => run({ type: 'player.add', playerId: 'p2', name: 'caio' })).toThrow('Já existe');
  });
});
