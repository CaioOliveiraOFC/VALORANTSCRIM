import { expect, it } from 'vitest';
import {
  applyEvent, currentMapIndex, currentVetoStep, initialState, replay,
  seriesScore, seriesWinner, type Command, type ScrimEvent,
} from './scrim.js';
import { toMarkdown } from './report.js';
import { readyScrim, sampleLinks, sampleMatch } from '../test/import-fixture.js';

const AT = 1800000000000;
function bo3() {
  const events: ScrimEvent[] = [{ seq: 1, at: AT, type: 'scrim.create', id: 'technicaldraw', title: 'Churras da laje', format: 'bo3' }];
  let state = applyEvent(initialState(), events[0]!);
  const run = (command: Command | Omit<Extract<ScrimEvent, { type: 'match.import' }>, 'seq' | 'at'>) => {
    const event = { ...command, seq: state.version + 1, at: AT + state.version * 1000 } as ScrimEvent;
    state = applyEvent(state, event); events.push(event); return state;
  };
  const roster = readyScrim().state.players;
  for (const player of roster) { run({ type: 'player.add', playerId: player.id, name: player.name }); run({ type: 'player.assign', playerId: player.id, team: player.team }); }
  run({ type: 'team.captain', team: 'A', playerId: 'p0' });
  run({ type: 'team.captain', team: 'B', playerId: 'p5' });
  run({ type: 'note.add', text: 'Preservar a resenha' });
  return { run, events, get: () => state };
}
function startVeto(game: ReturnType<typeof bo3>) {
  game.run({ type: 'veto.start', first: 'A' });
  return game;
}
function readyBo3() {
  const game = startVeto(bo3());
  for (const action of [
    { type: 'veto.ban', mapId: 'abyss' }, { type: 'veto.ban', mapId: 'bind' },
    { type: 'veto.pick', mapId: 'haven' }, { type: 'veto.side', side: 'atk' },
    { type: 'veto.pick', mapId: 'lotus' }, { type: 'veto.side', side: 'def' },
    { type: 'veto.ban', mapId: 'corrode' }, { type: 'veto.ban', mapId: 'summit' },
    { type: 'veto.side', side: 'atk' },
  ] as const) game.run(action);
  return game;
}

it('records a resumable technical draw without inventing a tied score or changing imported history', () => {
  const game = readyBo3();
  game.run({ type: 'match.import', mapIndex: 0, redTeam: 'A', links: sampleLinks(), match: { ...sampleMatch(), mapId: 'haven' } });
  const before = game.get();
  expect(before.phase).toBe('live'); expect(seriesScore(before)).toEqual({ A: 1, B: 0 });
  const paused = game.run({ type: 'scrim.pause', reason: '  Um jogador não pôde continuar.  ' });
  expect(paused.phase).toBe('paused');
  expect(paused.technicalPause).toEqual({ reason: 'Um jogador não pôde continuar.', pausedAt: paused.updatedAt, resumePhase: 'live' });
  expect(paused.maps).toBe(before.maps); expect(paused.players).toBe(before.players);
  expect(paused.veto).toBe(before.veto); expect(paused.teams).toBe(before.teams); expect(paused.notes).toBe(before.notes);
  expect(seriesScore(paused)).toEqual({ A: 1, B: 0 }); expect(seriesWinner(paused)).toBe(null); expect(currentMapIndex(paused)).toBe(-1);
  const report = toMarkdown(paused);
  expect(report).toContain('empate técnico · pode retomar'); expect(report).toContain('Um jogador não pôde continuar.');
  expect(report).not.toContain('vitória de'); expect(report).not.toContain('(em andamento)');
  const resumed = game.run({ type: 'scrim.resume' });
  expect(resumed.phase).toBe('live'); expect(currentMapIndex(resumed)).toBe(1);
  expect(resumed.maps).toBe(before.maps); expect(resumed.players).toBe(before.players);
  expect('technicalPause' in resumed).toBe(false);
  expect(replay(game.events)).toEqual(resumed);
});

it('restores the exact unfinished veto step and the setup stage', () => {
  const setup = bo3(); const beforeSetup = setup.get();
  setup.run({ type: 'scrim.pause', reason: 'Aguardando o jogador' }); setup.run({ type: 'scrim.resume' });
  expect(setup.get().phase).toBe('setup'); expect(setup.get().players).toBe(beforeSetup.players);
  const game = startVeto(bo3()); game.run({ type: 'veto.ban', mapId: 'abyss' });
  const before = currentVetoStep(game.get());
  game.run({ type: 'scrim.pause', reason: 'Jogador desconectou' });
  expect(currentVetoStep(game.get())).toBe(null);
  game.run({ type: 'scrim.resume' });
  expect(game.get().phase).toBe('veto'); expect(currentVetoStep(game.get())).toEqual(before);
  game.run({ type: 'veto.ban', mapId: 'bind' });
  expect(game.get().veto.map(entry => entry.mapId)).toEqual(['abyss', 'bind']);
});

it('freezes game edits, imports and draws until resume, while retaining notes and valid room focus', () => {
  const game = readyBo3(); game.run({ type: 'scrim.pause', reason: 'Empate técnico' });
  const paused = game.get(); const eventTime = paused.updatedAt + 1000;
  const blocked = [
    { type: 'round.win', team: 'A' }, { type: 'round.undo' },
    { type: 'stats.set', mapIndex: 0, playerId: 'p0', line: { kills: 10, deaths: 2, assists: 1 } },
    { type: 'player.rename', playerId: 'p0', name: 'Novo nome' },
    { type: 'team.rename', team: 'A', name: 'Novo time' }, { type: 'veto.reset' },
    { type: 'settings.update', title: 'Outro título' },
    { type: 'match.import', mapIndex: 0, redTeam: 'A', links: sampleLinks(), match: { ...sampleMatch(), mapId: 'haven' } },
    { type: 'draw.start' }, { type: 'draw.accept', drawId: 'example-draw' },
    { type: 'scrim.pause', reason: 'Outra pausa' },
  ];
  for (const action of blocked) expect(() => applyEvent(paused, { ...action, seq: paused.version + 1, at: eventTime } as ScrimEvent)).toThrow('empate técnico');
  const noted = game.run({ type: 'note.add', text: 'Combinado retomar no próximo encontro.' });
  expect(noted.phase).toBe('paused'); expect(noted.technicalPause).toEqual(paused.technicalPause);
  const at = noted.updatedAt + 1000;
  const focused = applyEvent(noted, { type: 'room.focus', seq: noted.version + 1, at, focus: { id: 'focus-paused-room', target: { tab: 'report', area: 'overview' }, requestedAt: at, expiresAt: at + 10000 } });
  expect(focused.phase).toBe('paused'); expect(focused.roomFocus?.target.tab).toBe('report');
});

it('rejects empty or oversized reasons, invalid times, duplicate transitions and finished series', () => {
  const game = bo3(); const state = game.get();
  for (const reason of ['', '   ', 'x'.repeat(281), 'Falha\u0000interna']) expect(() => game.run({ type: 'scrim.pause', reason })).toThrow();
  expect(() => applyEvent(state, { type: 'scrim.pause', reason: 'Motivo', seq: state.version + 1, at: -1 })).toThrow('Horário');
  expect(() => game.run({ type: 'scrim.resume' })).toThrow();
  const paused = game.run({ type: 'scrim.pause', reason: 'Motivo' });
  expect(() => applyEvent(paused, { type: 'scrim.resume', seq: paused.version + 1, at: paused.updatedAt - 1 })).toThrow('Horário');
  expect(() => game.run({ type: 'scrim.pause', reason: 'Duplicada' })).toThrow('empate técnico');
  const finished = { ...state, phase: 'finished' as const };
  expect(() => applyEvent(finished, { type: 'scrim.pause', reason: 'Motivo', seq: finished.version + 1, at: AT + 100000 })).toThrow('só pode pausar');
});
