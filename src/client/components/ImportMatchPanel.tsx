import { useEffect, useRef, useState } from "react";
import { MAPS, mapImageUrl } from "../../shared/maps";
import {
  extractMatchId,
  suggestLinks,
  validateMapping,
  type ExternalMatch,
  type PlayerLink,
} from "../../shared/imports";
import {
  currentMapIndex,
  type ScrimState,
  type TeamId,
} from "../../shared/scrim";
import { Icon } from "./Icon";
import { useRoom } from "./ScrimRoom";

const date = (ms: number) =>
  new Date(ms).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
const riotId = (p: ExternalMatch["players"][number]) => `${p.name}#${p.tag}`;

export function PlayerMatcher({
  state,
  match,
  redTeam,
  links,
  onChange,
  disabled = false,
}: {
  state: ScrimState;
  match: ExternalMatch;
  redTeam: TeamId;
  links: PlayerLink[];
  onChange: (links: PlayerLink[]) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  function assign(playerId: string, puuid: string) {
    if (disabled) return;
    if (!puuid) {
      onChange(links.filter((l) => l.playerId !== playerId));
      setNotice("Associação removida. Escolha outro jogador.");
      return;
    }
    const manual = state.players.find((p) => p.id === playerId);
    const remote = match.players.find((p) => p.puuid === puuid);
    if (!manual || !remote) return;
    const team = remote.team === "Red" ? redTeam : redTeam === "A" ? "B" : "A";
    if (manual.team !== team) {
      setNotice(
        "Esse jogador está no outro time. Confira a opção Red abaixo do placar.",
      );
      return;
    }
    const next = [
      ...links.filter((l) => l.playerId !== playerId && l.puuid !== puuid),
      { playerId, puuid },
    ];
    onChange(next);
    setEditing(null);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() =>
        document.getElementById(`pair-${playerId}`)?.focus(),
      );
    }
    setNotice(`${manual.name} associado a ${riotId(remote)}.`);
  }
  return (
    <div className="player-matcher">
      <div className="matcher-heading">
        <div>
          <h3>
            {links.length === 10
              ? "Os dez jogadores estão associados"
              : "Quem é quem na partida?"}
          </h3>
          <p className="muted">
            {links.length === 10
              ? "Confira os pares. Use Trocar se precisar corrigir."
              : "Toque em Escolher ou arraste um jogador para o apelido."}
          </p>
        </div>
        <span
          className={`mapping-count ${links.length === 10 ? "complete" : ""}`}
        >
          {links.length === 10 && <Icon name="check" />}
          {links.length}/10
        </span>
      </div>
      <div className="paired-teams">
        {(["A", "B"] as const).map((t) => {
          const candidates = match.players.filter(
            (p) => p.team === (t === redTeam ? "Red" : "Blue"),
          );
          const roster = state.players.filter((p) => p.team === t);
          return (
            <section className={`paired-team team-${t}`} key={t}>
              <h4>
                <span className="team-letter">{t}</span>
                {state.teams[t].name}
              </h4>
              <div className="pair-column-labels">
                <span>Na sala</span>
                <span>Na partida</span>
              </div>
              {roster.map((p) => {
                const remote = match.players.find(
                  (r) =>
                    r.puuid === links.find((l) => l.playerId === p.id)?.puuid,
                );
                const expanded = editing === p.id;
                return (
                  <div
                    className={`mapping-target ${remote ? "linked" : "pending"} ${expanded ? "editing" : ""}`}
                    key={p.id}
                    onDragOver={(e) => {
                      if (!disabled) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      assign(p.id, e.dataTransfer.getData("text/plain"));
                    }}
                  >
                    <div className="mapping-pair">
                      <span
                        className="manual-name"
                        draggable={!disabled}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(
                            "application/x-scrim-player",
                            p.id,
                          );
                          e.dataTransfer.setData(
                            "text/plain",
                            `player:${p.id}`,
                          );
                          e.dataTransfer.effectAllowed = "move";
                        }}
                      >
                        <strong>{p.name}</strong>
                      </span>
                      <Icon name="link" className="pair-link" />
                      <button
                        className="paired-player"
                        id={`pair-${p.id}`}
                        type="button"
                        disabled={disabled}
                        aria-label={`${remote ? "Trocar" : "Escolher"} jogador para ${p.name}`}
                        aria-expanded={expanded}
                        aria-controls={`choices-${p.id}`}
                        onClick={() => setEditing(expanded ? null : p.id)}
                      >
                        <span>
                          {remote ? (
                            <>
                              <strong>
                                {remote.name}
                                <span>#{remote.tag}</span>
                              </strong>
                              <small>{remote.agent}</small>
                            </>
                          ) : (
                            <strong className="pending-label">
                              Escolher jogador
                            </strong>
                          )}
                        </span>
                        <span className="pair-action">
                          {remote ? "Trocar" : <Icon name="plus" />}
                        </span>
                      </button>
                    </div>
                    {expanded && (
                      <div className="player-choices" id={`choices-${p.id}`}>
                        <p>
                          Qual destes jogadores é <strong>{p.name}</strong>?
                        </p>
                        {candidates.map((r) => {
                          const owner = links.find((l) => l.puuid === r.puuid);
                          return (
                            <button
                              key={r.puuid}
                              type="button"
                              className="mapping-player"
                              aria-label={`Selecionar ${riotId(r)}`}
                              disabled={disabled}
                              draggable={!disabled}
                              onClick={() => assign(p.id, r.puuid)}
                              onDragStart={(e) => {
                                e.dataTransfer.setData("text/plain", r.puuid);
                                e.dataTransfer.effectAllowed = "move";
                              }}
                              onDragOver={(e) => {
                                if (!disabled) e.preventDefault();
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                assign(
                                  e.dataTransfer.getData(
                                    "application/x-scrim-player",
                                  ) ||
                                    e.dataTransfer
                                      .getData("text/plain")
                                      .replace(/^player:/, ""),
                                  r.puuid,
                                );
                              }}
                            >
                              <span className="agent-avatar">
                                {r.agent.slice(0, 2)}
                              </span>
                              <span>
                                <strong>
                                  {r.name}
                                  <span>#{r.tag}</span>
                                </strong>
                                <small>
                                  {r.agent}
                                  {owner
                                    ? ` • ${state.players.find((x) => x.id === owner.playerId)?.name}`
                                    : " • disponível"}
                                </small>
                              </span>
                              {owner && <Icon name="check" />}
                            </button>
                          );
                        })}
                        <div className="choice-actions">
                          {remote && (
                            <button
                              type="button"
                              className="ghost"
                              aria-label={`Remover associação de ${p.name}`}
                              disabled={disabled}
                              onClick={() => assign(p.id, "")}
                            >
                              Remover associação
                            </button>
                          )}
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => setEditing(null)}
                          >
                            Fechar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      <p
        className="matcher-notice muted small"
        role="status"
        aria-live="polite"
      >
        {notice ||
          "Seus apelidos continuam iguais. Os vínculos serão lembrados na próxima partida."}
      </p>
    </div>
  );
}

export function ImportMatchPanel({
  mapIndex,
  onOpenChange,
}: {
  mapIndex: number;
  onOpenChange?: (open: boolean) => void;
}) {
  const { state, isAdmin, importRequest } = useRoom();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("br");
  const [matches, setMatches] = useState<ExternalMatch[]>([]);
  const [match, setMatch] = useState<ExternalMatch | null>(null);
  const [redTeam, setRedTeam] = useState<TeamId>("A");
  const [links, setLinks] = useState<PlayerLink[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [version, setVersion] = useState(state.version);
  const target = state.maps[mapIndex]!;
  const workspace = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open)
      workspace.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [open]);
  useEffect(() => {
    onOpenChange?.(open);
    return () => onOpenChange?.(false);
  }, [open, onOpenChange]);
  if (!isAdmin) return null;
  const eligible =
    state.phase === "live" &&
    currentMapIndex(state) === mapIndex &&
    !target.rounds.length &&
    !Object.keys(target.stats).length;
  function select(next: ExternalMatch) {
    const a = suggestLinks(state, next, "A"),
      b = suggestLinks(state, next, "B");
    const t = a.length === b.length ? redTeam : a.length > b.length ? "A" : "B";
    setRedTeam(t);
    setMatch(next);
    setLinks(t === "A" ? a : b);
    setReviewed(false);
    setVersion(state.version);
    setError("");
  }
  async function search() {
    setBusy(true);
    setError("");
    setMatch(null);
    setMatches([]);
    setSuccess(false);
    try {
      const id = extractMatchId(query);
      const result = await importRequest(
        id
          ? { action: "detail", region, matchId: id }
          : { action: "search", region, riotId: query },
      );
      if (result.match) select(result.match);
      else {
        setMatches(result.matches ?? []);
        if (!result.matches?.length)
          setError(
            "Nenhuma customizada 5v5 completa encontrada entre as partidas recentes.",
          );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  let mappingError = "";
  if (match) {
    try {
      validateMapping(state, match, links, redTeam);
    } catch (e) {
      mappingError = (e as Error).message;
    }
  }
  const differentMap = match && match.mapId !== target.mapId;
  const changed = version !== state.version;
  async function confirmImport() {
    if (
      !match ||
      !reviewed ||
      mappingError ||
      differentMap ||
      changed ||
      !eligible ||
      busy
    )
      return;
    setBusy(true);
    setError("");
    try {
      await importRequest({
        action: "confirm",
        region: match.region,
        matchId: match.id,
        mapIndex,
        redTeam,
        links,
        expectedVersion: version,
      });
      setMatch(null);
      setMatches([]);
      setSuccess(true);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!open && !eligible && !success) return null;
  return (
    <section
      ref={workspace}
      className={`import-panel ${open ? "import-open" : ""}`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) setOpen(false);
      }}
    >
      <header className="import-header">
        <div>
          <h2>{open ? "Importar partida" : "Terminou de jogar?"}</h2>
          {!open && (
            <p className="muted">
              Traga placar, rounds e estatísticas de uma vez.
            </p>
          )}
        </div>
        <button
          type="button"
          className={open ? "ghost" : "primary"}
          aria-label={open ? "Fechar importação" : undefined}
          disabled={(!open && !eligible) || busy}
          onClick={() => setOpen(!open)}
        >
          {open ? (
            "Fechar"
          ) : (
            <>
              <Icon name="download" />
              Importar partida
            </>
          )}
        </button>
      </header>
      {success && (
        <p className="success-notice" role="status">
          <Icon name="check" />
          Partida importada. Os vínculos estão salvos para a próxima.
        </p>
      )}
      {error && (
        <p className="import-error" role="alert">
          {error}
        </p>
      )}
      {open && (
        <div className="import-workspace" aria-busy={busy}>
          {!match ? (
            <>
              <p className="muted">
                Use o Riot ID de quem jogou ou o link da partida no Tracker.
              </p>
              <form
                className="import-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  void search();
                }}
              >
                <label className="grow">
                  Riot ID ou link da partida
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Nome#TAG ou link do Tracker"
                    maxLength={250}
                    required
                    disabled={busy}
                  />
                </label>
                <label>
                  Região
                  <select
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    disabled={busy}
                  >
                    {[
                      ["br", "Brasil"],
                      ["latam", "América Latina"],
                      ["na", "América do Norte"],
                      ["eu", "Europa"],
                      ["ap", "Ásia/Pacífico"],
                      ["kr", "Coreia"],
                    ].map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="primary" disabled={busy || !query.trim()}>
                  {busy ? "Buscando…" : "Buscar partidas"}
                </button>
              </form>
              {matches.length > 0 && (
                <div className="import-results">
                  <h3>Escolha a customizada</h3>
                  {matches.map((m) => (
                    <button
                      type="button"
                      key={m.id}
                      disabled={busy}
                      onClick={() => select(m)}
                    >
                      <span
                        className="result-map-label"
                        style={{
                          backgroundImage: `url(${mapImageUrl(m.mapId)})`,
                        }}
                      />
                      <span className="grow">
                        <strong>{MAPS[m.mapId].name}</strong>
                        <small>
                          {date(m.startedAt)} /{" "}
                          {Math.round(m.durationMs / 60000)} min
                        </small>
                      </span>
                      <span className="result-score">
                        <strong>
                          {m.score.Red}
                          <span>:</span>
                          {m.score.Blue}
                        </strong>
                        <small>Red / Blue</small>
                      </span>
                      <span className="result-select">Escolher</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div
                className="selected-match"
                style={{
                  backgroundImage: `linear-gradient(90deg,rgba(20,37,56,.98),rgba(20,37,56,.7)),url(${mapImageUrl(match.mapId)})`,
                }}
              >
                <div>
                  <h3>{MAPS[match.mapId].name}</h3>
                  <span>{date(match.startedAt)}</span>
                </div>
                <div className="selected-score">
                  <span>{state.teams[redTeam].name}</span>
                  <strong>
                    {match.score.Red}
                    <small>:</small>
                    {match.score.Blue}
                  </strong>
                  <span>{state.teams[redTeam === "A" ? "B" : "A"].name}</span>
                </div>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => {
                    setMatch(null);
                    setReviewed(false);
                  }}
                >
                  Trocar partida
                </button>
              </div>
              {differentMap && (
                <p role="alert" className="import-error">
                  O resultado é de {MAPS[match.mapId].name}, mas este mapa da
                  scrim é {MAPS[target.mapId].name}. Escolha a partida
                  correspondente.
                </p>
              )}
              <div className="team-orientation">
                <label>
                  Na partida, o time Red era
                  <select
                    aria-label="Time da scrim correspondente ao Red"
                    value={redTeam}
                    disabled={busy}
                    onChange={(e) => {
                      const t = e.target.value as TeamId;
                      setRedTeam(t);
                      setLinks(suggestLinks(state, match, t));
                      setReviewed(false);
                    }}
                  >
                    <option value="A">{state.teams.A.name}</option>
                    <option value="B">{state.teams.B.name}</option>
                  </select>
                </label>
              </div>
              <PlayerMatcher
                key={`${match.id}-${redTeam}`}
                state={state}
                match={match}
                redTeam={redTeam}
                links={links}
                disabled={busy}
                onChange={(next) => {
                  setLinks(next);
                  setReviewed(false);
                }}
              />
              <button
                type="button"
                className="ghost suggestions-button"
                disabled={busy}
                onClick={() => {
                  setLinks(suggestLinks(state, match, redTeam));
                  setReviewed(false);
                }}
              >
                <Icon name="link" />
                Restaurar sugestões
              </button>
              {match.startedAt < state.createdAt && (
                <p className="callout">
                  Esta partida é anterior à criação da sala. Confira a data
                  antes de importar.
                </p>
              )}
              {changed && (
                <p className="import-error" role="alert">
                  A sala mudou enquanto você conferia.{" "}
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={() => {
                      setVersion(state.version);
                      setReviewed(false);
                    }}
                  >
                    Revisar versão atual
                  </button>
                </p>
              )}
              <div
                className={`import-confirm${links.length === 10 ? " is-ready" : ""}`}
              >
                <label className="mapping-review">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    disabled={
                      busy || !!mappingError || !!differentMap || changed
                    }
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  <span>Conferi os jogadores e o placar.</span>
                </label>
                <button
                  type="button"
                  className="primary"
                  disabled={
                    busy ||
                    !eligible ||
                    !reviewed ||
                    !!mappingError ||
                    !!differentMap ||
                    changed
                  }
                  onClick={() => void confirmImport()}
                >
                  {busy
                    ? "Importando…"
                    : `Importar ${MAPS[match.mapId].name} — ${match.score.Red}:${match.score.Blue}`}
                </button>
                {mappingError && <p className="muted small">{mappingError}</p>}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
