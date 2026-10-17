import { applyEvent, initialState, type Command, type ScrimEvent } from '../shared/scrim.js';
import { MAPS } from '../shared/maps.js';
import type { ExternalMatch, PlayerLink } from '../shared/imports.js';
export function sampleMatch(): ExternalMatch {
  return { id: '11111111-2222-4333-8444-555555555555', region: 'br', mapId: 'lotus', startedAt: 1700000000000, durationMs: 1800000, redStartingSide: 'atk',
    score: { Red: 13, Blue: 2 }, rounds: [...Array(12).fill('Red'), 'Blue', 'Blue', 'Red'],
    players: Array.from({ length: 10 }, (_, i) => ({ puuid: `puuid-${i}`, name: `Riot ${i}`, tag: 'TEST', team: i < 5 ? 'Red' : 'Blue', agent: 'Fade', kills: i + 1, deaths: 5, assists: 3, score: 1500, damage: 1200, headshots: 5, bodyshots: 10, legshots: 0 })) };
}
export function sampleLinks(): PlayerLink[] { return Array.from({ length: 10 }, (_, i) => ({ playerId: `p${i}`, puuid: `puuid-${i}` })); }
export function readyScrim() {
  let state = applyEvent(initialState(), { type: 'scrim.create', seq: 1, at: 1, id: 'abc123', title: 'Fixture', format: 'bo1' });
  const events: ScrimEvent[] = [{ type: 'scrim.create', seq: 1, at: 1, id: 'abc123', title: 'Fixture', format: 'bo1' }];
  const run = (command: Command) => {
    const event = { ...command, seq: state.version + 1, at: state.version + 1 } as ScrimEvent;
    state = applyEvent(state, event); events.push(event);
  };
  for (let i = 0; i < 10; i++) { run({ type: 'player.add', playerId: `p${i}`, name: `Apelido ${i}` }); run({ type: 'player.assign', playerId: `p${i}`, team: i < 5 ? 'A' : 'B' }); }
  run({ type: 'note.add', text: 'Preservar anotação' });
  run({ type: 'veto.start', first: 'A' });
  for (const mapId of ['abyss', 'bind', 'corrode', 'haven', 'summit', 'sunset'] as const) run({ type: 'veto.ban', mapId });
  run({ type: 'veto.side', side: 'def' });
  return { state, events };
}
export function rawMatch(match = sampleMatch()) {
  return { metadata: { match_id: match.id, map: { id: MAPS[match.mapId].uuid }, queue: { name: 'Custom Game', mode_type: 'Standard' }, platform: 'pc', is_completed: true, started_at: new Date(match.startedAt).toISOString(), game_length_in_ms: match.durationMs },
    players: match.players.map(p => ({ ...p, team_id: p.team, agent: { name: p.agent }, stats: { ...p, damage: { dealt: p.damage } } })),
    teams: ['Red', 'Blue'].map(t => ({ team_id: t, rounds: { won: match.score[t as 'Red' | 'Blue'] } })),
    rounds: match.rounds.map((winning_team, id) => ({ id, winning_team, winning_team_role: id === 0 ? 'Attacker' : undefined })) };
}
