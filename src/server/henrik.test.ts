import { afterEach, expect, it, vi } from 'vitest';
import { fetchMatch, findMatches, normalizeMatch } from './henrik.js';
import { rawMatch, sampleMatch } from '../test/import-fixture.js';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('normalizes a completed custom, whitelisting the imported data', () => {
  const raw = rawMatch(); expect(normalizeMatch(raw, 'br')).toEqual(sampleMatch());
  raw.metadata.queue.name = 'Competitive'; expect(() => normalizeMatch(raw, 'br')).toThrow('customizada');
});
it('fails on missing rounds instead of importing a misleading score', () => {
  const raw = rawMatch(); raw.rounds.pop(); expect(() => normalizeMatch(raw, 'br')).toThrow('divergentes');
});
it('sends the key only to the fixed provider host and safely reports rate errors', async () => {
  vi.stubEnv('HENRIK_API_KEY', 'test-private-key');
  const mock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: rawMatch() }))).mockResolvedValueOnce(new Response('{}', { status: 429 }));
  vi.stubGlobal('fetch', mock); expect((await fetchMatch('br', sampleMatch().id)).match.id).toBe(sampleMatch().id);
  expect(mock.mock.calls[0]![0]).toBe(`https://api.henrikdev.xyz/valorant/v4/match/br/${sampleMatch().id}`);
  expect(mock.mock.calls[0]![1].headers.Authorization).toBe('test-private-key');
  await expect(fetchMatch('br', sampleMatch().id)).rejects.toThrow('Limite');
});
it('searches custom PC history with encoded Riot ID and reports missing configuration', async () => {
  vi.stubEnv('HENRIK_API_KEY', 'test-private-key');
  const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [rawMatch()] })));
  vi.stubGlobal('fetch', mock); expect(await findMatches('br', 'Riot Name#TAG')).toHaveLength(1);
  expect(mock.mock.calls[0]![0]).toContain('/br/pc/Riot%20Name/TAG?mode=custom&size=10');
  vi.stubEnv('HENRIK_API_KEY', ''); await expect(fetchMatch('br', sampleMatch().id)).rejects.toThrow('HENRIK_API_KEY');
});
