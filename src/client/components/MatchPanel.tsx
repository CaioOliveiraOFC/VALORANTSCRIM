import { useState } from 'react';
import { MAPS, mapImageUrl } from '../../shared/maps';
import {
  TEAM_IDS,
  currentMapIndex,
  mapScore,
  mapWinner,
  seriesScore,
  seriesWinner,
  sideInRound,
  type SeriesMap,
  type TeamId,
} from '../../shared/scrim';
import { ImportMatchPanel } from './ImportMatchPanel';
import { useRoom } from './ScrimRoom';

const SIDE_LABEL = { atk: 'Ataque', def: 'Defesa' } as const;

export function MatchPanel() {
  const { state } = useRoom();
  const live = currentMapIndex(state);
  const [selected, setSelected] = useState<number | null>(null);

  if (state.maps.length === 0) return <p className="card muted">A partida começa quando o veto terminar.</p>;

  const index = selected ?? (live >= 0 ? live : state.maps.length - 1);
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
            <button key={i} className={i === index ? 'on' : ''} onClick={() => setSelected(i === live ? null : i)}>
              <span>
                Mapa {i + 1} · {MAPS[m.mapId].name}
              </span>
              <small className="muted">
                {played ? `${s.A} x ${s.B}` : i === live ? 'próximo' : '—'}
                {i === live && played && ' · ao vivo'}
              </small>
            </button>
          );
        })}
      </nav>

      <ImportMatchPanel key={index} mapIndex={index} />
      <Scoreboard map={map} index={index} isLive={index === live} />
      <RoundStrip map={map} />
      <StatsTable map={map} index={index} />
    </div>
  );
}

function Scoreboard({ map, index, isLive }: { map: SeriesMap; index: number; isLive: boolean }) {
  const { state, isAdmin, act } = useRoom();
  const [note, setNote] = useState('');
  const score = mapScore(map);
  const winner = mapWinner(map);
  const nextRound = map.rounds.length + 1;

  async function win(team: TeamId) {
    if (await act({ type: 'round.win', team, ...(note.trim() ? { note } : {}) })) setNote('');
  }

  return (
    <section className="card scoreboard" style={{ backgroundImage: `url(${mapImageUrl(map.mapId)})` }}>
      <div className="scoreboard-inner">
        <p className="muted small">
          Mapa {index + 1} · {MAPS[map.mapId].name} · pick {map.pickedBy ? state.teams[map.pickedBy].name : 'decider'}
        </p>
        <div className="score-row">
          {TEAM_IDS.map((t) => (
            <div key={t} className={`score-team team-${t} ${winner === t ? 'won' : ''}`}>
              <span className="name">{state.teams[t].name}</span>
              <span className="points">{score[t]}</span>
              {map.startingSide && !winner && (
                <span className={`side side-${sideInRound(map.startingSide[t], nextRound)}`}>
                  {SIDE_LABEL[sideInRound(map.startingSide[t], nextRound)]}
                </span>
              )}
              {isAdmin && isLive && (
                <button className="primary" onClick={() => win(t)}>
                  + Round
                </button>
              )}
            </div>
          ))}
        </div>
        {!winner && map.rounds.length > 0 && (
          <p className="muted small center">
            Round {nextRound}
            {nextRound > 24 ? ' · prorrogação' : nextRound === 13 ? ' · pistol do 2º tempo' : ''}
          </p>
        )}
        {winner && <p className="center"><b>{state.teams[winner].name}</b> venceu o mapa</p>}
        {isAdmin && isLive && (
          <div className="row">
            <input
              className="grow"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Nota opcional do round (ex.: clutch 1v3, eco forçado)"
              maxLength={280}
            />
          </div>
        )}
        {isAdmin && (state.phase === 'live' || state.phase === 'finished') && (
          <div className="row push">
            <button className="ghost" onClick={() => act({ type: 'round.undo' })}>
              Desfazer último round
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function RoundStrip({ map }: { map: SeriesMap }) {
  const { state } = useRoom();
  if (!map.rounds.length) return null;
  return (
    <section className="card">
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

export function StatsTable({ map, index }: { map: SeriesMap; index: number }) {
  const { state, isAdmin, act } = useRoom();
  const players = state.players.filter((p) => p.team);
  if (!players.length || (!isAdmin && Object.keys(map.stats).length === 0)) return null;

  const save = (playerId: string, field: 'kills' | 'deaths' | 'assists', raw: string) => {
    const current = map.stats[playerId] ?? { kills: 0, deaths: 0, assists: 0 };
    const value = Math.max(0, Math.min(200, Math.trunc(Number(raw) || 0)));
    if (current[field] === value && map.stats[playerId]) return;
    void act({ type: 'stats.set', mapIndex: index, playerId, line: { ...current, [field]: value } });
  };

  return (
    <section className="card">
      <h2>Estatísticas do mapa</h2>
      {isAdmin && <p className="muted small">{map.source ? 'Dados importados da HenrikDev. Correções manuais de K/D/A ficam registradas no histórico.' : 'Importe uma customizada acima ou preencha o placar final (TAB) manualmente.'}</p>}
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
                    {(['kills', 'deaths', 'assists'] as const).map((f) => (
                      <td key={f}>
                        {isAdmin ? (
                          <input
                            type="number"
                            min={0}
                            max={200}
                            inputMode="numeric"
                            aria-label={`${f} de ${p.name}`}
                            key={`${p.id}-${f}-${line?.[f] ?? ''}`}
                            defaultValue={line?.[f] ?? ''}
                            onBlur={(e) => e.target.value !== '' && save(p.id, f, e.target.value)}
                          />
                        ) : (
                          (line?.[f] ?? '—')
                        )}
                      </td>
                    ))}
                    {map.source && <>
                      <td>{line?.detail?.agent ?? '—'}</td><td>{line?.detail?.damage ?? '—'}</td>
                      <td>{line?.detail && map.rounds.length ? (line.detail.damage / map.rounds.length).toFixed(1) : '—'}</td>
                      <td>{line?.detail && map.rounds.length ? (line.detail.score / map.rounds.length).toFixed(1) : '—'}</td>
                      <td>{line?.detail ? ((line.detail.headshots + line.detail.bodyshots + line.detail.legshots) ? (100 * line.detail.headshots / (line.detail.headshots + line.detail.bodyshots + line.detail.legshots)).toFixed(1) + '%' : '—') : '—'}</td>
                    </>}
                  </tr>
                );
              }),
          )}
        </tbody>
      </table></div>
    </section>
  );
}
