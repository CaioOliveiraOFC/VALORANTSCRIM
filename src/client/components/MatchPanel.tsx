import { useState } from "react";
import { MAPS, mapImageUrl } from "../../shared/maps";
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
} from "../../shared/scrim";
import { Icon } from "./Icon";
import { ImportMatchPanel } from "./ImportMatchPanel";
import { useRoom } from "./ScrimRoom";

const SIDE_LABEL = { atk: "Ataque", def: "Defesa" } as const;

export function MatchPanel() {
  const { state, isAdmin } = useRoom();
  const live = currentMapIndex(state);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  if (state.maps.length === 0)
    return (
      <div className="card empty-state">
        <Icon name="crosshair" />
        <h2>Escolham os mapas primeiro</h2>
        <p>
          Com os mapas definidos, vocês já podem jogar e trazer o resultado para
          cá.
        </p>
      </div>
    );

  const defaultIndex =
    live >= 0
      ? live
      : Math.max(
          0,
          state.maps.findLastIndex((m) => m.rounds.length > 0),
        );
  const index =
    selected !== null && selected < state.maps.length ? selected : defaultIndex;
  const map = state.maps[index]!;
  const series = seriesScore(state);
  const champion = seriesWinner(state);
  const hasStats = Object.keys(map.stats).length > 0;

  return (
    <div
      className={`stack match-overview${importing ? " import-focused" : ""}`}
    >
      {!importing && (
        <>
          <section className="series-summary" aria-label="Placar da série">
            <p>
              <span className="team-A">{state.teams.A.name}</span>
              <b>
                {series.A} <span>:</span> {series.B}
              </b>
              <span className="team-B">{state.teams.B.name}</span>
            </p>
            <span className="muted small">
              {champion
                ? `${state.teams[champion].name} venceu a série`
                : `Melhor de ${state.format === "bo1" ? "1" : state.format === "bo3" ? "3" : "5"}`}
            </span>
          </section>

          <nav className="map-tabs" aria-label="Mapas da série">
            {state.maps.map((m, i) => {
              const score = mapScore(m);
              const played = m.rounds.length > 0;
              return (
                <button
                  key={i}
                  className={i === index ? "on" : ""}
                  aria-pressed={i === index}
                  onClick={() => setSelected(i === live ? null : i)}
                >
                  <span>{MAPS[m.mapId].name}</span>
                  <small>
                    {played
                      ? `${score.A} : ${score.B}`
                      : champion
                        ? "Não necessário"
                        : i === live
                          ? "Jogar agora"
                          : "A seguir"}
                  </small>
                </button>
              );
            })}
          </nav>
          <Scoreboard map={map} index={index} isLive={index === live} />
        </>
      )}

      <ImportMatchPanel
        key={index}
        mapIndex={index}
        onOpenChange={setImporting}
      />
      {!importing && (
        <>
          {isAdmin && <ManualRounds map={map} isLive={index === live} />}
          {map.source || (!isAdmin && hasStats) ? (
            <StatsTable map={map} index={index} />
          ) : (
            isAdmin && (
              <details className="card manual-entry manual-stats">
                <summary>Preencher K/D/A manualmente</summary>
                <StatsTable map={map} index={index} />
              </details>
            )
          )}
          <RoundStrip map={map} />
        </>
      )}
    </div>
  );
}

function Scoreboard({
  map,
  index,
  isLive,
}: {
  map: SeriesMap;
  index: number;
  isLive: boolean;
}) {
  const { state } = useRoom();
  const score = mapScore(map);
  const winner = mapWinner(map);
  const nextRound = map.rounds.length + 1;
  const startingSide = map.source?.actualStartingSide ?? map.startingSide;

  return (
    <section
      className="card scoreboard map-result"
      aria-label={`Placar de ${MAPS[map.mapId].name}`}
    >
      <div
        className="match-map-banner"
        style={{ backgroundImage: `url(${mapImageUrl(map.mapId)})` }}
      >
        <h2>{MAPS[map.mapId].name}</h2>
        <span>
          Mapa {index + 1}
          {map.pickedBy
            ? ` escolhido por ${state.teams[map.pickedBy].name}`
            : " de desempate"}
        </span>
      </div>
      <div className="scoreboard-inner">
        <div className="score-row">
          {TEAM_IDS.map((team) => (
            <div
              key={team}
              className={`score-team team-${team} ${winner === team ? "won" : ""}`}
            >
              <span className="name">{state.teams[team].name}</span>
              <span className="points">{score[team]}</span>
              {startingSide && !winner && isLive && (
                <span
                  className={`side side-${sideInRound(startingSide[team], nextRound)}`}
                >
                  {SIDE_LABEL[sideInRound(startingSide[team], nextRound)]}
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="map-result-status">
          {winner
            ? `${state.teams[winner].name} venceu o mapa`
            : isLive
              ? map.rounds.length
                ? `Próximo: round ${nextRound}${nextRound > 24 ? " na prorrogação" : ""}`
                : "Tudo pronto. Boa partida!"
              : "Aguardando a partida"}
        </p>
      </div>
    </section>
  );
}

function ManualRounds({ map, isLive }: { map: SeriesMap; isLive: boolean }) {
  const { state, act } = useRoom();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const lastPlayed = state.maps.findLast((m) => m.rounds.length > 0);
  const canUndo =
    (state.phase === "live" || state.phase === "finished") &&
    lastPlayed === map &&
    !lastPlayed.source;
  if ((!isLive || map.source) && !canUndo) return null;

  async function win(team: TeamId) {
    if (busy) return;
    setBusy(true);
    try {
      if (
        await act({
          type: "round.win",
          team,
          ...(note.trim() ? { note: note.trim() } : {}),
        })
      )
        setNote("");
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (busy) return;
    setBusy(true);
    try {
      await act({ type: "round.undo" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="card manual-entry">
      <summary>Registrar rounds manualmente</summary>
      <div className="manual-entry-content">
        {isLive && !map.source && (
          <>
            <p className="muted">
              Quem venceu o round {map.rounds.length + 1}?
            </p>
            <div className="manual-round-actions">
              {TEAM_IDS.map((team) => (
                <button
                  key={team}
                  className={`team-${team}`}
                  disabled={busy}
                  onClick={() => void win(team)}
                >
                  {state.teams[team].name} venceu
                </button>
              ))}
            </div>
            <label>
              Nota do round <span className="muted">(opcional)</span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Ex.: clutch 1v3"
                maxLength={280}
                disabled={busy}
              />
            </label>
          </>
        )}
        {canUndo && (
          <button className="ghost" disabled={busy} onClick={() => void undo()}>
            Desfazer último round
          </button>
        )}
      </div>
    </details>
  );
}

function RoundStrip({ map }: { map: SeriesMap }) {
  const { state } = useRoom();
  if (!map.rounds.length) return null;
  return (
    <details className="card round-details">
      <summary>Ver os {map.rounds.length} rounds</summary>
      <ol className="round-strip">
        {map.rounds.map((r) => (
          <li
            key={r.number}
            className={`round team-${r.winner} ${r.number === 13 || (r.number > 24 && r.number % 2 === 1) ? "half" : ""}`}
            title={`R${r.number}: ${state.teams[r.winner].name}${r.note ? ` — ${r.note}` : ""}`}
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
    </details>
  );
}

export function StatsTable({ map, index }: { map: SeriesMap; index: number }) {
  const { state, isAdmin, act } = useRoom();
  const players = state.players.filter((p) => p.team);
  if (!players.length || (!isAdmin && Object.keys(map.stats).length === 0))
    return null;

  const save = (
    playerId: string,
    field: "kills" | "deaths" | "assists",
    raw: string,
  ) => {
    const current = map.stats[playerId] ?? { kills: 0, deaths: 0, assists: 0 };
    const value = Math.max(0, Math.min(200, Math.trunc(Number(raw) || 0)));
    if (current[field] === value && map.stats[playerId]) return;
    void act({
      type: "stats.set",
      mapIndex: index,
      playerId,
      line: { ...current, [field]: value },
    });
  };

  return (
    <section className="card">
      <h2>Estatísticas do mapa</h2>
      {isAdmin && (
        <p className="muted small">
          {map.source
            ? "Resultado importado. Alterações no K/D/A ficam salvas no histórico."
            : "Preencha os números do placar final da partida."}
        </p>
      )}
      {map.source && (
        <p className="muted small">
          HenrikDev:{" "}
          <a
            href={`https://tracker.gg/valorant/match/${map.source.matchId}`}
            target="_blank"
            rel="noreferrer"
          >
            Ver partida no Tracker
          </a>{" "}
          — {new Date(map.source.startedAt).toLocaleString("pt-BR")} ·{" "}
          {Math.round(map.source.durationMs / 60000)} min
        </p>
      )}
      <div className="table-scroll">
        <table className="stats">
          <thead>
            <tr>
              <th>Jogador</th>
              <th>K</th>
              <th>D</th>
              <th>A</th>
              {map.source && (
                <>
                  <th>Agente</th>
                  <th>Dano</th>
                  <th>ADR</th>
                  <th>ACS</th>
                  <th>HS%</th>
                </>
              )}
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
                      <td>
                        {p.name}
                        {p.riot && (
                          <small className="riot-id">
                            {p.riot.name}#{p.riot.tag}
                          </small>
                        )}
                        {line?.manualCorrection && (
                          <small> K/D/A corrigido</small>
                        )}
                      </td>
                      {(["kills", "deaths", "assists"] as const).map((f) => (
                        <td key={f}>
                          {isAdmin ? (
                            <input
                              type="number"
                              min={0}
                              max={200}
                              inputMode="numeric"
                              aria-label={`${f} de ${p.name}`}
                              key={`${p.id}-${f}-${line?.[f] ?? ""}`}
                              defaultValue={line?.[f] ?? ""}
                              onBlur={(e) =>
                                e.target.value !== "" &&
                                save(p.id, f, e.target.value)
                              }
                            />
                          ) : (
                            (line?.[f] ?? "—")
                          )}
                        </td>
                      ))}
                      {map.source && (
                        <>
                          <td>{line?.detail?.agent ?? "—"}</td>
                          <td>{line?.detail?.damage ?? "—"}</td>
                          <td>
                            {line?.detail && map.rounds.length
                              ? (
                                  line.detail.damage / map.rounds.length
                                ).toFixed(1)
                              : "—"}
                          </td>
                          <td>
                            {line?.detail && map.rounds.length
                              ? (line.detail.score / map.rounds.length).toFixed(
                                  1,
                                )
                              : "—"}
                          </td>
                          <td>
                            {line?.detail
                              ? line.detail.headshots +
                                line.detail.bodyshots +
                                line.detail.legshots
                                ? (
                                    (100 * line.detail.headshots) /
                                    (line.detail.headshots +
                                      line.detail.bodyshots +
                                      line.detail.legshots)
                                  ).toFixed(1) + "%"
                                : "—"
                              : "—"}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                }),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
