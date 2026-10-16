import { MAPS, type MapId } from '../../shared/maps';
import { availableMaps, currentVetoStep, describeVetoEntry, roleToTeam, type Side } from '../../shared/scrim';
import { VETO_SEQUENCES, type VetoStepDef } from '../../shared/veto';
import { MapCard, type MapCardState } from './MapCard';
import { useRoom } from './ScrimRoom';

const KIND_LABEL: Record<VetoStepDef['kind'], string> = { ban: 'Ban', pick: 'Pick', side: 'Lado', decider: 'Decider' };

export function VetoPanel() {
  const { state, isAdmin, act } = useRoom();

  if (state.phase === 'setup') {
    return <p className="card muted">O veto começa quando o admin fechar os times.</p>;
  }

  const sequence = VETO_SEQUENCES[state.format];
  const step = currentVetoStep(state);
  const free = new Set(availableMaps(state));
  const lastFor = new Map(state.veto.filter((v) => v.kind !== 'side').map((v) => [v.mapId, v]));
  const canChooseMap = isAdmin && step && (step.kind === 'ban' || step.kind === 'pick');

  const cardState = (id: MapId): MapCardState => {
    const v = lastFor.get(id);
    if (!v) return 'available';
    return v.kind === 'ban' ? 'banned' : v.kind === 'decider' ? 'decider' : 'picked';
  };
  const caption = (id: MapId) => {
    const v = lastFor.get(id);
    if (!v) return undefined;
    if (v.kind === 'decider') return 'Decider';
    return `${v.kind === 'ban' ? 'Ban' : 'Pick'} · ${state.teams[v.team!].name}`;
  };

  const sideMap = step?.kind === 'side' ? [...state.veto].reverse().find((v) => v.kind === 'pick' || v.kind === 'decider') : null;

  return (
    <div className="stack">
      <section className="card veto-now" aria-live="polite">
        {step ? (
          <>
            <span className={`turn team-${step.team}`}>{state.teams[step.team].name}</span>
            <strong>
              {step.kind === 'ban' && 'bane um mapa'}
              {step.kind === 'pick' && 'escolhe um mapa'}
              {step.kind === 'side' && sideMap && `escolhe o lado inicial em ${MAPS[sideMap.mapId].name}`}
            </strong>
          </>
        ) : (
          <strong>Veto concluído</strong>
        )}
        {isAdmin && (
          <span className="row push">
            <button onClick={() => act({ type: 'veto.undo' })} disabled={state.veto.length === 0}>
              Desfazer
            </button>
            <button className="ghost" onClick={() => confirm('Reiniciar o veto do zero?') && act({ type: 'veto.reset' })}>
              Reiniciar
            </button>
          </span>
        )}
      </section>

      {isAdmin && step?.kind === 'side' && (
        <div className="row side-choice">
          {(['atk', 'def'] as Side[]).map((side) => (
            <button key={side} className={`primary btn-${side}`} onClick={() => act({ type: 'veto.side', side })}>
              {state.teams[step.team].name} começa {side === 'atk' ? 'no ATAQUE' : 'na DEFESA'}
            </button>
          ))}
        </div>
      )}

      <div className="map-grid">
        {state.pool.map((id) => (
          <MapCard
            key={id}
            mapId={id}
            state={cardState(id)}
            caption={caption(id)}
            onClick={canChooseMap && free.has(id) ? () => act({ type: step.kind === 'ban' ? 'veto.ban' : 'veto.pick', mapId: id }) : undefined}
          />
        ))}
      </div>

      <section className="card">
        <h2>Ordem do veto</h2>
        <ol className="veto-order">
          {sequence.map((def, i) => {
            const done = state.veto[i];
            const team = def.role ? state.teams[roleToTeam(state, def.role)].name : '—';
            return (
              <li key={i} className={done ? 'done' : step?.index === i ? 'current' : ''}>
                <span className={`kind ${def.kind}`}>{KIND_LABEL[def.kind]}</span>
                <span>{done ? describeVetoEntry(state, done) : def.kind === 'decider' ? 'Mapa que sobrar' : team}</span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
