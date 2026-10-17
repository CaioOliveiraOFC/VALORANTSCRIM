import { describe, expect, it } from 'vitest';
import { applyEvent, replay, seriesScore, type ScrimEvent } from './scrim.js';
import { applyMatchImport, extractMatchId, suggestLinks, validateMapping } from './imports.js';
import { readyScrim, sampleLinks, sampleMatch } from '../test/import-fixture.js';
import { toMarkdown, buildMapReport } from './report.js';
const input = () => ({ match: sampleMatch(), mapIndex: 0, redTeam: 'A' as const, links: sampleLinks() });
describe('custom match import and player identity', () => {
  it('preserves names, veto and notes, saves Riot identities and replays atomically', () => {
    const { state, events } = readyScrim();
    const event: ScrimEvent = { type: 'match.import', seq: state.version + 1, at: 1800000000000, ...input() };
    const next = applyEvent(state, event);
    expect(next.players.map(p => p.name)).toEqual(state.players.map(p => p.name));
    expect(next.players[0]!.riot?.puuid).toBe('puuid-0');
    expect(next.veto).toEqual(state.veto); expect(next.notes).toEqual(state.notes);
    expect(next.phase).toBe('finished'); expect(seriesScore(next)).toEqual({ A: 1, B: 0 });
    expect(replay([...events, event])).toEqual(next);
    expect(next.maps[0]!.stats.p0?.detail?.damage).toBe(1200);
    expect(buildMapReport(next, next.maps[0]!, 0).durationMin).toBe(30);
    expect(toMarkdown(next)).toContain('HenrikDev'); expect(toMarkdown(next)).toContain('80.0');
  });
  it('rejects duplicates, wrong teams, missing links and mismatched maps', () => {
    const { state } = readyScrim(); const data = input();
    expect(() => validateMapping(state, data.match, [...data.links.slice(0, 9), data.links[0]!], 'A')).toThrow('duas');
    expect(() => validateMapping(state, data.match, data.links.slice(0, 9), 'A')).toThrow('dez');
    expect(() => validateMapping(state, data.match, data.links, 'B')).toThrow('time');
    expect(() => applyMatchImport(state, { ...data, match: { ...data.match, mapId: 'bind' } }, 100)).toThrow('mapa');
    expect(() => applyMatchImport({ ...state, maps: [{ ...state.maps[0]!, stats: { p0: { kills: 1, deaths: 1, assists: 0 } } }] }, data, 100)).toThrow('já possui');
  });
  it('refuses incomplete scores and invalid stats without changing the source state', () => {
    const { state } = readyScrim(); const data = input();
    expect(() => applyMatchImport(state, { ...data, match: { ...data.match, rounds: ['Red'] } }, 100)).toThrow('incompleta');
    expect(() => applyMatchImport(state, { ...data, match: { ...data.match, score: { Red: 12, Blue: 2 } } }, 100)).toThrow('divergentes');
    data.match.players[0]!.kills = -1;
    expect(() => applyMatchImport(state, data, 100)).toThrow('Estatísticas'); expect(state.players[0]!.riot).toBeUndefined();
  });
  it('reuses PUUID links after an alias changes and leaves ambiguous suggestions unlinked', () => {
    const { state } = readyScrim(); const match = sampleMatch();
    state.players[0]!.name = 'Riot 0'; state.players[1]!.name = 'Riot 0';
    expect(suggestLinks(state, match, 'A')).toEqual([]);
    state.players[0]!.riot = { puuid: 'puuid-0', name: 'Old', tag: 'OLD' }; state.players[0]!.name = 'Outro apelido'; state.players[1]!.name = 'Manual';
    expect(suggestLinks(state, match, 'A')).toEqual([{ playerId: 'p0', puuid: 'puuid-0' }]);
  });
  it('supports reversing API teams without renaming players', () => {
    const { state } = readyScrim(); const data = input();
    const links = data.links.map((l, i) => ({ ...l, puuid: `puuid-${(i + 5) % 10}` }));
    const next = applyMatchImport(state, { ...data, redTeam: 'B', links }, 100);
    expect(seriesScore(next)).toEqual({ A: 0, B: 1 });
    expect(next.maps[0]!.source?.actualStartingSide).toEqual({ A: 'def', B: 'atk' });
  });
  it('keeps imported provenance when KDA is corrected and disallows removing imported rounds', () => {
    const { state } = readyScrim(); let next = applyEvent(state, { type: 'match.import', ...input(), seq: state.version + 1, at: 100 });
    expect(() => applyEvent(next, { type: 'round.undo', seq: next.version + 1, at: 101 })).toThrow('importados');
    next = applyEvent(next, { type: 'stats.set', mapIndex: 0, playerId: 'p0', line: { kills: 20, deaths: 2, assists: 1 }, seq: next.version + 1, at: 102 });
    expect(next.maps[0]!.stats.p0?.detail?.agent).toBe('Fade'); expect(next.maps[0]!.stats.p0?.manualCorrection).toBe(true);
  });
  it('accepts only UUIDs or Tracker match links, never arbitrary fetch URLs', () => {
    const id = sampleMatch().id;
    expect(extractMatchId(`https://tracker.gg/valorant/match/${id}`)).toBe(id);
    expect(extractMatchId('https://evil.test/'+id)).toBeNull();
    expect(extractMatchId('https://tracker.gg/valorant/profile/test')).toBeNull();
  });
});
