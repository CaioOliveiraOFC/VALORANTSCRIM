import { describe, expect, it } from 'vitest';
import { applyEvent, initialState, replay, type Command, type ScrimEvent, type ScrimState } from './scrim.js';
import { activeDraw, DRAW_REVEAL_MS, DRAW_TTL_MS, ROOM_FOCUS_TTL_MS, ROOM_FOCUS_AREAS,
  validateFocusTarget, type RoomDraw, type RoomFocus, type RoomToolsEvent } from './roomTools.js';
import { readyScrim, sampleLinks, sampleMatch } from '../test/import-fixture.js';

const START = 10_000;
function fixture(count = 4) {
  const events: ScrimEvent[] = [];
  let state = initialState();
  const run = (command: Command | RoomToolsEvent, at = START) => {
    const event = { ...command, seq: state.version + 1, at } as ScrimEvent;
    state = applyEvent(state, event); events.push(event); return state;
  };
  const first: ScrimEvent = { type: 'scrim.create', id: 'abc123', title: 'Room tools', format: 'bo3', seq: 1, at: 0 };
  state = applyEvent(state, first); events.push(first);
  for (let i = 0; i < count; i++) run({ type: 'player.add', playerId: `p${i}`, name: `Player ${i}` }, i + 1);
  return { get: () => state, run, events };
}
function captainDraw(state: ScrimState, id = 'draw-captains', startedAt = START): RoomDraw {
  return { id, kind: 'captains', purpose: 'Capitães dos times', startedAt,
    revealAt: startedAt + DRAW_REVEAL_MS, expiresAt: startedAt + DRAW_TTL_MS, status: 'pending',
    candidates: state.players.map(({ id, name }) => ({ id, name })), result: { A: 'p0', B: 'p1' } };
}
function coinDraw(id = 'draw-coin', startedAt = START): RoomDraw {
  return { id, kind: 'coin', purpose: 'Quem começa banindo?', startedAt,
    revealAt: startedAt + DRAW_REVEAL_MS, expiresAt: startedAt + DRAW_TTL_MS, status: 'pending', result: 'heads' };
}
function focus(at = START): RoomFocus {
  return { id: 'focus-one', target: { tab: 'teams', area: 'players' }, requestedAt: at, expiresAt: at + ROOM_FOCUS_TTL_MS };
}
function apply(state: ScrimState, event: RoomToolsEvent, at = START) {
  return applyEvent(state, { ...event, seq: state.version + 1, at });
}

describe('room attention requests', () => {
  it('records a short-lived focus without changing lineups, game phase or results', () => {
    const room = fixture(); const before = room.get();
    const next = room.run({ type: 'room.focus', focus: focus() });
    expect(next.roomFocus).toEqual(focus());
    expect(next.players).toEqual(before.players); expect(next.teams).toEqual(before.teams);
    expect(next.maps).toEqual(before.maps); expect(next.phase).toBe('setup');
    expect(next.version).toBe(before.version + 1);
  });

  it('allows only known areas and existing map indices, never arbitrary selectors', () => {
    const state = readyScrim().state;
    for (const [tab, areas] of Object.entries(ROOM_FOCUS_AREAS)) {
      for (const area of areas) expect(validateFocusTarget({ tab, area }, state)).toEqual({ tab, area });
    }
    expect(validateFocusTarget({ tab: 'match', area: 'stats', mapIndex: 0 }, state)).toEqual({ tab: 'match', area: 'stats', mapIndex: 0 });
    for (const target of [null, [], { tab: '__proto__', area: 'anything' }, { tab: 'match', area: 'body input' },
      { tab: 'teams', area: 'players', mapIndex: 0 }, { tab: 'match', area: 'stats', mapIndex: -1 },
      { tab: 'match', area: 'stats', mapIndex: 1 }, { tab: 'match', area: 'stats', mapIndex: .5 }]) {
      expect(() => validateFocusTarget(target, state)).toThrow();
    }
  });

  it('rejects invalid request timing and rejects focus while everyone is in a draw', () => {
    const room = fixture();
    expect(() => room.run({ type: 'room.focus', focus: { ...focus(), expiresAt: START + 30_000 } })).toThrow('Prazo');
    room.run({ type: 'draw.start', draw: coinDraw() });
    expect(() => room.run({ type: 'room.focus', focus: focus() })).toThrow('sorteio');
  });
});

describe('synchronized captain draws', () => {
  it('draws from the whole general list and changes neither teams nor captains before acceptance', () => {
    const room = fixture();
    room.run({ type: 'player.assign', playerId: 'p2', team: 'A' }, 100);
    room.run({ type: 'team.captain', playerId: 'p2', team: 'A' }, 101);
    const before = room.get(); const draw = captainDraw(before);
    const pending = room.run({ type: 'draw.start', draw });
    expect(activeDraw(pending, START)?.id).toBe(draw.id);
    expect(pending.players).toEqual(before.players); expect(pending.teams).toEqual(before.teams);
    expect(pending.draws?.[0]).toEqual(draw);
  });

  it('requires two distinct candidates, the complete current roster and the setup phase', () => {
    const room = fixture(); const draw = captainDraw(room.get());
    if (draw.kind !== 'captains') throw Error('Fixture');
    const invalid: RoomDraw[] = [
      { ...draw, result: { A: 'p0', B: 'p0' } }, { ...draw, result: { A: 'p0', B: 'unknown' } },
      { ...draw, candidates: draw.candidates.slice(1) },
      { ...draw, candidates: [...draw.candidates.slice(0, 3), draw.candidates[0]!] },
      { ...draw, candidates: draw.candidates.map((p, i) => i ? p : { ...p, name: 'Wrong name' }) },
    ];
    for (const candidate of invalid) expect(() => room.run({ type: 'draw.start', draw: candidate })).toThrow();
    expect(() => fixture(1).run({ type: 'draw.start', draw: captainDraw(fixture(1).get()) })).toThrow('pelo menos dois');
    const live = readyScrim().state;
    expect(() => apply(live, { type: 'draw.start', draw: captainDraw(live) })).toThrow('antes de começar o veto');
  });

  it('accepts only after reveal, assigns both distinct captains atomically and returns everyone else to the list', () => {
    const room = fixture();
    room.run({ type: 'player.assign', playerId: 'p2', team: 'A' }, 100);
    room.run({ type: 'player.assign', playerId: 'p3', team: 'B' }, 101);
    const draw = captainDraw(room.get()); room.run({ type: 'draw.start', draw });
    expect(() => room.run({ type: 'draw.accept', drawId: draw.id }, draw.revealAt - 1)).toThrow('Aguarde');
    const next = room.run({ type: 'draw.accept', drawId: draw.id }, draw.revealAt);
    expect(next.teams.A.captainId).toBe('p0'); expect(next.teams.B.captainId).toBe('p1');
    expect(next.players.map(p => [p.id, p.team])).toEqual([['p0', 'A'], ['p1', 'B'], ['p2', null], ['p3', null]]);
    expect(next.draws?.[0]).toMatchObject({ status: 'accepted', resolvedAt: draw.revealAt });
    expect(activeDraw(next, draw.revealAt)).toBeUndefined();
    expect(() => room.run({ type: 'draw.accept', drawId: draw.id }, draw.revealAt + 1)).toThrow('terminou');
  });

  it('rejects without changing an existing lineup and preserves the rejected attempt before another draw', () => {
    const room = fixture();
    room.run({ type: 'player.assign', playerId: 'p2', team: 'A' }, 100);
    room.run({ type: 'team.captain', playerId: 'p2', team: 'A' }, 101);
    const before = room.get(); const draw = captainDraw(before);
    room.run({ type: 'draw.start', draw });
    const rejected = room.run({ type: 'draw.reject', drawId: draw.id }, START + 1);
    expect(rejected.players).toEqual(before.players); expect(rejected.teams).toEqual(before.teams);
    expect(rejected.draws?.[0]).toMatchObject({ status: 'rejected', resolvedAt: START + 1 });
    const again = captainDraw(rejected, 'draw-second', START + 2);
    room.run({ type: 'draw.start', draw: again }, START + 2);
    expect(room.get().draws?.map(d => [d.id, d.status])).toEqual([[draw.id, 'rejected'], [again.id, 'pending']]);
    expect(() => room.run({ type: 'draw.accept', drawId: draw.id }, again.revealAt)).toThrow('substituído');
  });
});

describe('coin draws and room pause', () => {
  it('supports a named independent coin draw in every phase without changing game choices on acceptance', () => {
    for (const phase of ['setup', 'veto', 'live', 'finished'] as const) {
      const before = { ...fixture().get(), phase }; const draw = coinDraw();
      const pending = apply(before, { type: 'draw.start', draw });
      const accepted = apply(pending, { type: 'draw.accept', drawId: draw.id }, draw.revealAt);
      expect(accepted.phase).toBe(phase); expect(accepted.players).toEqual(before.players);
      expect(accepted.teams).toEqual(before.teams); expect(accepted.vetoFirst).toBe(before.vetoFirst);
      expect(accepted.draws?.[0]?.status).toBe('accepted');
    }
  });

  it('validates purpose, result, start state and synchronized deadlines', () => {
    const room = fixture(); const draw = coinDraw();
    const invalid: RoomDraw[] = [
      { ...draw, purpose: '   ' }, { ...draw, purpose: 'x'.repeat(161) },
      { ...draw, revealAt: draw.revealAt + 1 }, { ...draw, expiresAt: draw.expiresAt + 1 },
      { ...draw, status: 'accepted' }, { ...draw, resolvedAt: START },
      { ...draw, id: '' }, { ...draw, result: 'neither' } as unknown as RoomDraw,
    ];
    for (const candidate of invalid) expect(() => room.run({ type: 'draw.start', draw: candidate })).toThrow();
    room.run({ type: 'draw.start', draw: { ...draw, purpose: '  Quem começa?  ' } });
    expect(room.get().draws?.[0]?.purpose).toBe('Quem começa?');
  });

  it('blocks edits, concurrent draw starts and imported results until the pending draw resolves', () => {
    const room = fixture(); const draw = coinDraw(); room.run({ type: 'draw.start', draw });
    expect(() => room.run({ type: 'note.add', text: 'Blocked' }, START + 1)).toThrow('Conclua');
    expect(() => room.run({ type: 'draw.start', draw: coinDraw('another-draw', START + 1) }, START + 1)).toThrow('Conclua');
    expect(() => room.run({ type: 'draw.accept', drawId: 'wrong-draw' }, draw.revealAt)).toThrow('substituído');
    const live = readyScrim().state; const paused = apply(live, { type: 'draw.start', draw });
    const imported: ScrimEvent = { type: 'match.import', seq: paused.version + 1, at: START + 1,
      mapIndex: 0, redTeam: 'A', links: sampleLinks(), match: sampleMatch() };
    expect(() => applyEvent(paused, imported)).toThrow('Conclua');
    room.run({ type: 'draw.reject', drawId: draw.id }, START + 2);
    expect(room.run({ type: 'note.add', text: 'Allowed again' }, START + 3).notes.at(-1)?.text).toBe('Allowed again');
  });

  it('expires without accepting, releases the room and never accepts an expired attempt', () => {
    const room = fixture(); const draw = coinDraw(); room.run({ type: 'draw.start', draw });
    expect(activeDraw(room.get(), draw.expiresAt - 1)?.id).toBe(draw.id);
    expect(activeDraw(room.get(), draw.expiresAt)).toBeUndefined();
    expect(() => room.run({ type: 'draw.accept', drawId: draw.id }, draw.expiresAt)).toThrow('expirou');
    const resumed = room.run({ type: 'note.add', text: 'After timeout' }, draw.expiresAt);
    expect(resumed.draws?.[0]?.status).toBe('pending'); expect(resumed.notes.at(-1)?.text).toBe('After timeout');
    const next = coinDraw('next-draw', draw.expiresAt + 1);
    room.run({ type: 'draw.start', draw: next }, next.startedAt);
    expect(activeDraw(room.get(), next.startedAt)?.id).toBe(next.id);
  });

  it('does not reuse an already resolved draw ID and reconstructs old and new event histories deterministically', () => {
    const room = fixture(); const original = structuredClone(room.get());
    expect(replay(room.events)).toEqual(original);
    expect(original.draws).toBeUndefined(); expect(original.roomFocus).toBeUndefined();
    room.run({ type: 'room.focus', focus: focus() });
    const draw = coinDraw(); room.run({ type: 'draw.start', draw });
    room.run({ type: 'draw.accept', drawId: draw.id }, draw.revealAt);
    expect(() => room.run({ type: 'draw.start', draw: coinDraw(draw.id, START + 5_000) }, START + 5_000)).toThrow('já foi registrado');
    expect(replay(room.events)).toEqual(room.get());
  });
});

describe('team randomization after captain acceptance', () => {
  function acceptedRoom() {
    const room = fixture(10), draw = captainDraw(room.get());
    room.run({ type: 'draw.start', draw });
    room.run({ type: 'draw.accept', drawId: draw.id }, draw.revealAt);
    return room;
  }
  const A = ['p0', 'p2', 'p3', 'p4', 'p5'];
  const B = ['p1', 'p6', 'p7', 'p8', 'p9'];

  it('keeps accepted captains while completing two teams of five and replays the command exactly', () => {
    const room = acceptedRoom();
    const state = room.run({ type: 'teams.set', A, B, preserveCaptains: true }, START + 5_000);
    expect(state.teams.A.captainId).toBe('p0'); expect(state.teams.B.captainId).toBe('p1');
    expect(state.players.filter(player => player.team === 'A').map(player => player.id)).toEqual(A);
    expect(state.players.filter(player => player.team === 'B').map(player => player.id)).toEqual(B);
    expect(new Set(state.players.map(player => player.id)).size).toBe(10);
    expect(replay(room.events)).toEqual(state);
  });

  it('preserves historical teams.set behavior without the new flag, even if captains stay in the same teams', () => {
    const room = acceptedRoom();
    const state = room.run({ type: 'teams.set', A, B }, START + 5_000);
    expect(state.teams.A.captainId).toBeNull(); expect(state.teams.B.captainId).toBeNull();
    expect(replay(room.events)).toEqual(state);
  });

  it('rejects moving a declared preserved captain, duplicate players and oversized teams without partial changes', () => {
    const room = acceptedRoom(), before = room.get();
    expect(() => room.run({ type: 'teams.set', A: B, B: A, preserveCaptains: true }, START + 5_000)).toThrow('manter cada capitão');
    expect(() => room.run({ type: 'teams.set', A, B: [...B.slice(0, 4), 'p0'], preserveCaptains: true }, START + 5_000)).toThrow('dois times');
    expect(() => room.run({ type: 'teams.set', A: [...A, 'p6'], B: B.filter(id => id !== 'p6'), preserveCaptains: true }, START + 5_000)).toThrow('cinco');
    expect(() => room.run({ type: 'teams.set', A, B, preserveCaptains: 'yes' } as unknown as Command, START + 5_000)).toThrow('Opção de capitães');
    expect(room.get()).toBe(before);
  });

  it('also supports preserving one existing captain without inventing a captain for the other team', () => {
    const room = fixture();
    room.run({ type: 'player.assign', playerId: 'p0', team: 'A' }, 100);
    room.run({ type: 'team.captain', playerId: 'p0', team: 'A' }, 101);
    const state = room.run({ type: 'teams.set', A: ['p0', 'p1'], B: ['p2', 'p3'], preserveCaptains: true });
    expect(state.teams.A.captainId).toBe('p0'); expect(state.teams.B.captainId).toBeNull();
    expect(replay(room.events)).toEqual(state);
  });
});
