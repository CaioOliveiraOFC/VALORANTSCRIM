import { expect, it } from 'vitest';
import { selectFeatured } from './featured';
import type { ScrimSummary } from '../../../shared/protocol';
const room = (id: string, phase: ScrimSummary['phase'], updatedAt = 1): ScrimSummary => ({
  id,
  phase,
  updatedAt,
  createdAt: 1,
  title: id,
  teams: ['A', 'B'],
  score: [0, 0],
  maps: [],
});
it('prioritizes a live VCT over veto, setup and more recently finished rooms', () => {
  const rooms = [
    room('finish', 'finished', 100),
    room('setup1', 'setup', 99),
    room('veto11', 'veto', 98),
    room('live11', 'live', 3),
  ];
  expect(selectFeatured(rooms, null)?.id).toBe('live11');
  expect(rooms[0]?.id).toBe('finish');
});
it('uses veto before setup and uses last updated room for equal phases', () => {
  expect(
    selectFeatured(
      [room('setup1', 'setup', 50), room('veto11', 'veto', 1), room('veto22', 'veto', 2)],
      null,
    )?.id,
  ).toBe('veto22');
});
it('falls back to the latest completed VCT only when no active room is available', () => {
  expect(
    selectFeatured([room('older1', 'finished', 2), room('newer1', 'finished', 3)], null)?.id,
  ).toBe('newer1');
});
it('honors a pin only when the target is still present in the public list', () => {
  const rows = [room('pinned', 'setup'), room('live11', 'live')];
  expect(selectFeatured(rows, 'pinned')?.id).toBe('pinned');
  expect(selectFeatured(rows, 'hidden')?.id).toBe('live11');
  expect(selectFeatured([], 'hidden')).toBeNull();
});
