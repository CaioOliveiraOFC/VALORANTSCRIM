import type { ScrimSummary } from '../../../shared/protocol';

const priority: Record<ScrimSummary['phase'], number> = { live: 0, veto: 1, setup: 2, finished: 3 };
export const phaseLabel: Record<ScrimSummary['phase'], string> = {
  live: 'Partida em andamento',
  veto: 'Escolhendo os mapas',
  setup: 'Montando os times',
  finished: 'VCT encerrado',
};
export function selectFeatured(
  rooms: ScrimSummary[],
  pinnedId: string | null,
): ScrimSummary | null {
  // Only a room present in the current public listing can be featured.
  return (
    rooms.find((room) => room.id === pinnedId) ??
    [...rooms].sort(
      (a, b) =>
        priority[a.phase] - priority[b.phase] ||
        b.updatedAt - a.updatedAt ||
        b.createdAt - a.createdAt ||
        a.id.localeCompare(b.id),
    )[0] ??
    null
  );
}
