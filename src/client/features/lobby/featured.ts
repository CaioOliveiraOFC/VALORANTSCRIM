import type { ScrimSummary } from '../../../shared/protocol';

const priority: Record<ScrimSummary['phase'], number> = { live: 0, veto: 1, setup: 2, finished: 3, paused: 4 };
export const phaseLabel: Record<ScrimSummary['phase'], string> = {
  live: 'Partida em andamento',
  veto: 'Escolhendo os mapas',
  setup: 'Montando os times',
  finished: 'VCT encerrado',
  paused: 'Empate técnico · pode retomar',
};
export function selectFeatured(
  rooms: ScrimSummary[],
  pinnedId: string | null,
): ScrimSummary | null {
  // A technical draw remains available through history, never as the next game.
  // A pinned paused room must yield its place until its organizer resumes it.
  const eligible = rooms.filter(room => room.phase !== 'paused');
  return (
    eligible.find((room) => room.id === pinnedId) ??
    [...eligible].sort(
      (a, b) =>
        priority[a.phase] - priority[b.phase] ||
        b.updatedAt - a.updatedAt ||
        b.createdAt - a.createdAt ||
        a.id.localeCompare(b.id),
    )[0] ??
    null
  );
}
