import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MAPS, mapImageUrl } from '../../shared/maps';
import {
  TEAM_IDS,
  currentMapIndex,
  mapScore,
  mapWinner,
  seriesScore,
  seriesWinner,
  type SeriesMap,
} from '../../shared/scrim';
import { ImportMatchPanel } from './ImportMatchPanel';
import { useRoom } from './ScrimRoom';
import './MatchPanel.css';

export function MatchPanel({ selectedMap, onSelectMap }: { selectedMap: number | null; onSelectMap: (index: number | null) => void }) {
  const { state } = useRoom();
  const live = currentMapIndex(state);

  if (state.maps.length === 0) return <p className="card muted">A partida começa quando o veto terminar.</p>;

  const fallback = live >= 0 ? live : Math.max(0, state.maps.findLastIndex(map => map.rounds.length > 0));
  const index = selectedMap !== null && selectedMap < state.maps.length ? selectedMap : fallback;
  const map = state.maps[index]!;
  const series = seriesScore(state);
  const champion = seriesWinner(state);

  return (
    <div className="stack">
      <section className="card series">
        <span className="team-A">{state.teams.A.name}</span>
        <span className="series-score">
          {series.A} <small>x</small> {series.B}
        </span>
        <span className="team-B">{state.teams.B.name}</span>
        {champion && <p className="champion">🏆 {state.teams[champion].name} venceu a série</p>}
      </section>

      <nav className="map-tabs">
        {state.maps.map((m, i) => {
          const s = mapScore(m);
          const played = m.rounds.length > 0;
          return (
            <button key={i} className={i === index ? 'on' : ''} onClick={() => onSelectMap(i === live ? null : i)}>
              <span>
                Mapa {i + 1} · {MAPS[m.mapId].name}
              </span>
              <small className="muted">
                {played ? `${s.A} x ${s.B}` : 'Aguardando importação'}
              </small>
            </button>
          );
        })}
      </nav>

      <ImportMatchPanel key={index} mapIndex={index} />
      <Scoreboard map={map} index={index} />
      <RoundStrip map={map} />
      <StatsTable map={map} index={index} />
    </div>
  );
}

function Scoreboard({ map, index }: { map: SeriesMap; index: number }) {
  const { state, can } = useRoom();
  const canImport = can('importMatches');
  const score = mapScore(map);
  const winner = mapWinner(map);
  const recorded = map.rounds.length > 0 || !!map.source;

  return (
    <section data-room-focus="scoreboard" className="card scoreboard" style={{ backgroundImage: `url(${mapImageUrl(map.mapId)})` }}>
      <div className="scoreboard-inner">
        <p className="muted small">
          Mapa {index + 1} · {MAPS[map.mapId].name} · pick {map.pickedBy ? state.teams[map.pickedBy].name : 'decider'}
        </p>
        {!recorded ? <div className="match-awaiting" role="status">
          <svg className="match-awaiting-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <h2>{canImport ? 'Aguardando importação da partida' : 'Aguardando importação da partida para você'}</h2>
          <p>{canImport ? 'Joguem a customizada. Quando terminar, busque pelo Nome#TAG de um jogador ou pelo link da partida para trazer o resultado.' : 'Quando o administrador importar a partida, o placar, os rounds e as estatísticas aparecerão aqui.'}</p>
        </div> : <div className="score-row">
          {TEAM_IDS.map((t) => (
            <div key={t} className={`score-team team-${t} ${winner === t ? 'won' : ''}`}>
              <span className="name">{state.teams[t].name}</span>
              <span className="points">{score[t]}</span>
            </div>
          ))}
        </div>}
        {winner && <p className="center"><b>{state.teams[winner].name}</b> venceu o mapa</p>}
        {recorded && !map.source && <p className="muted small center">Resultado preservado de uma partida registrada anteriormente.</p>}
      </div>
    </section>
  );
}

function RoundStrip({ map }: { map: SeriesMap }) {
  const { state } = useRoom();
  if (!map.rounds.length) return null;
  return (
    <section data-room-focus="rounds" className="card">
      <h2>Rounds</h2>
      <ol className="round-strip">
        {map.rounds.map((r) => (
          <li
            key={r.number}
            className={`round team-${r.winner} ${r.number === 13 || (r.number > 24 && r.number % 2 === 1) ? 'half' : ''}`}
            title={`R${r.number}: ${state.teams[r.winner].name}${r.note ? ` — ${r.note}` : ''}`}
          >
            {r.number}
            {r.note && <span className="dot" aria-hidden />}
          </li>
        ))}
      </ol>
      {map.rounds.some((r) => r.note) && (
        <ul className="notes">
          {map.rounds
            .filter((r) => r.note)
            .map((r) => (
              <li key={r.number}>
                <b>R{r.number}</b> ({state.teams[r.winner].name}): {r.note}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

const STAT_FIELDS = ['kills', 'deaths', 'assists'] as const;
const STAT_LABEL = { kills: 'Abates (K)', deaths: 'Mortes (D)', assists: 'Assistências (A)' } as const;

export function StatsTable({ map, index }: { map: SeriesMap; index: number }) {
  const { state, can, act } = useRoom();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ kills: '', deaths: '', assists: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  useEffect(() => { setEditing(null); setError(''); }, [index, map.source?.matchId, can('correctStats')]);
  const players = state.players.filter((p) => p.team);
  if (!players.length || Object.keys(map.stats).length === 0) return null;
  const canCorrect = can('correctStats') && !!map.source;
  const selected = canCorrect ? players.find(p => p.id === editing) : undefined;

  function openCorrection(playerId: string) {
    const line = map.stats[playerId];
    if (!canCorrect || !line || locked.current) return;
    setDraft({ kills: String(line.kills), deaths: String(line.deaths), assists: String(line.assists) });
    setEditing(playerId); setError('');
  }
  async function saveCorrection(event: FormEvent) {
    event.preventDefault();
    if (!selected || !canCorrect || locked.current) return;
    const line = { kills: Number(draft.kills), deaths: Number(draft.deaths), assists: Number(draft.assists) };
    if (STAT_FIELDS.some(field => !draft[field].trim() || !Number.isInteger(line[field]) || line[field] < 0 || line[field] > 200)) {
      setError('Preencha K/D/A com números inteiros entre 0 e 200.'); return;
    }
    locked.current = true; setSaving(true); setError('');
    try {
      if (await act({ type: 'stats.set', mapIndex: index, playerId: selected.id, line })) setEditing(null);
      else setError('Não foi possível salvar a correção. Tente novamente.');
    } finally { locked.current = false; setSaving(false); }
  }

  return (
    <section data-room-focus="stats" className="card">
      <h2>Estatísticas do mapa</h2>
      {!map.source && <p className="muted small">Estatísticas preservadas de uma partida registrada anteriormente.</p>}
      {canCorrect && <p className="muted small">K/D/A vem da importação. Se precisar ajustar um dado, use “Corrigir estatística”. A correção fica registrada no histórico.</p>}
      {map.source && <p className="muted small">Fonte: HenrikDev · <a href={`https://tracker.gg/valorant/match/${map.source.matchId}`} target="_blank" rel="noreferrer">Ver partida</a> · {new Date(map.source.startedAt).toLocaleString('pt-BR')} · {Math.round(map.source.durationMs / 60000)} min</p>}
      <div className="table-scroll">
      <table className="stats">
        <thead>
          <tr>
            <th>Jogador</th>
            <th>K</th>
            <th>D</th>
            <th>A</th>
            {map.source && <><th>Agente</th><th>Dano</th><th>ADR</th><th>ACS</th><th>HS%</th></>}
            {canCorrect && <th><span className="match-stat-action-heading">Correção</span></th>}
          </tr>
        </thead>
        <tbody>
          {TEAM_IDS.flatMap((t) =>
            players
              .filter((p) => p.team === t)
              .map((p) => {
                const line = map.stats[p.id];
                return (
                  <tr key={p.id} className={`team-${t}`}>
                    <td>{p.name}{p.riot && <small className="riot-id">{p.riot.name}#{p.riot.tag}</small>}{line?.manualCorrection && <small> K/D/A corrigido</small>}</td>
                    {STAT_FIELDS.map((f) => (
                      <td key={f}>
                        {line?.[f] ?? '—'}
                      </td>
                    ))}
                    {map.source && <>
                      <td>{line?.detail?.agent ?? '—'}</td><td>{line?.detail?.damage ?? '—'}</td>
                      <td>{line?.detail && map.rounds.length ? (line.detail.damage / map.rounds.length).toFixed(1) : '—'}</td>
                      <td>{line?.detail && map.rounds.length ? (line.detail.score / map.rounds.length).toFixed(1) : '—'}</td>
                      <td>{line?.detail ? ((line.detail.headshots + line.detail.bodyshots + line.detail.legshots) ? (100 * line.detail.headshots / (line.detail.headshots + line.detail.bodyshots + line.detail.legshots)).toFixed(1) + '%' : '—') : '—'}</td>
                    </>}
                    {canCorrect && <td><button type="button" className="ghost match-stat-correct" aria-label={`Corrigir estatística de ${p.name}`} disabled={saving || !line} onClick={() => openCorrection(p.id)}>Corrigir estatística</button></td>}
                  </tr>
                );
              }),
          )}
        </tbody>
      </table></div>
      {selected && <form className="match-stat-correction" aria-label={`Correção de estatística de ${selected.name}`} onSubmit={event => void saveCorrection(event)}>
        <div><h3>Corrigir estatística de {selected.name}</h3><p className="muted small">Apenas K/D/A será alterado. Os outros dados da API serão mantidos.</p></div>
        <div className="match-stat-fields">{STAT_FIELDS.map(field => <label key={field}>{STAT_LABEL[field]}<input type="number" name={field} min="0" max="200" step="1" inputMode="numeric" required autoFocus={field === 'kills'} disabled={saving} value={draft[field]} onChange={event => setDraft(value => ({ ...value, [field]: event.target.value }))} /></label>)}</div>
        {error && <p role="alert" className="match-stat-error">{error}</p>}
        <div className="row wrap"><button type="submit" className="primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar correção'}</button><button type="button" className="ghost" disabled={saving} onClick={() => { setEditing(null); setError(''); }}>Cancelar</button></div>
      </form>}
    </section>
  );
}
