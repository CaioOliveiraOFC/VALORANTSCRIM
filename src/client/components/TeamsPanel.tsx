import { useRef, useState, type FormEvent } from "react";
import {
  ACTIVE_COMPETITIVE_POOL,
  ALL_MAP_IDS,
  POOL_SIZE,
  type MapId,
} from "../../shared/maps";
import {
  MAX_PLAYERS,
  TEAM_IDS,
  type Command,
  type TeamId,
} from "../../shared/scrim";
import { FORMAT_LABEL, type SeriesFormat } from "../../shared/veto";
import { newId, shuffle } from "../util";
import { Icon } from "./Icon";
import { MapCard } from "./MapCard";
import { useRoom } from "./ScrimRoom";
import "./TeamSetup.css";

type RunCommand = (command: Command) => Promise<boolean>;

export function TeamsPanel() {
  const { state, isAdmin, act } = useRoom();
  const editable = isAdmin && state.phase === "setup";
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pastedNames, setPastedNames] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [first, setFirst] = useState<TeamId>("A");
  const bench = state.players.filter((p) => !p.team);
  const counts = {
    A: state.players.filter((p) => p.team === "A").length,
    B: state.players.filter((p) => p.team === "B").length,
  };
  const ready = counts.A === 5 && counts.B === 5 && state.players.length === 10;

  async function operation(task: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  const run: RunCommand = async (command) => {
    if (locked.current) return false;
    let success = false;
    await operation(async () => {
      success = await act(command);
    });
    return success;
  };

  async function addNames(names: string[], target?: TeamId): Promise<boolean> {
    if (locked.current) return false;
    setNotice("");
    setError("");
    const clean = names.map((value) => value.trim()).filter(Boolean);
    if (!clean.length) return false;
    if (
      clean.some(
        (value) => value.length > 32 || /[\u0000-\u001f\u007f]/.test(value),
      )
    ) {
      setError("Use nomes de até 32 caracteres, sem caracteres de controle.");
      return false;
    }
    const existing = new Set(
      state.players.map((player) => player.name.toLowerCase()),
    );
    for (const value of clean) {
      const key = value.toLowerCase();
      if (existing.has(key)) {
        setError(
          `O nome “${value}” está repetido. Ajuste a lista antes de adicionar.`,
        );
        return false;
      }
      existing.add(key);
    }
    if (state.players.length + clean.length > MAX_PLAYERS) {
      setError(
        `Cabem mais ${MAX_PLAYERS - state.players.length} jogadores nesta sala. Nenhum nome foi adicionado.`,
      );
      return false;
    }
    if (target && counts[target] + clean.length > 5) {
      setError("Este time já tem cinco jogadores. Use uma vaga do outro time.");
      return false;
    }
    let completed = false;
    await operation(async () => {
      const filled = { ...counts };
      let added = 0;
      for (const value of clean) {
        const playerId = newId();
        if (!(await act({ type: "player.add", playerId, name: value }))) {
          setError(
            added
              ? `${added} nomes tiveram a inclusão confirmada. A operação parou em “${value}”; os anteriores continuam salvos. Confira os times antes de tentar novamente.`
              : `Não foi possível confirmar a inclusão de “${value}”. Confira os times e o aviso antes de tentar novamente.`,
          );
          setPastedNames(clean.slice(added).join("\n"));
          return;
        }
        added++;
        const team = target ?? (filled.A < 5 ? "A" : filled.B < 5 ? "B" : null);
        if (team && !(await act({ type: "player.assign", playerId, team }))) {
          setError(
            `“${value}” foi adicionado, mas ficou sem time. Associe-o abaixo. ${added > 1 ? `Os outros ${added - 1} nomes continuam salvos. ` : ""}A lista restante não foi adicionada.`,
          );
          setPastedNames(clean.slice(added).join("\n"));
          return;
        }
        if (team) filled[team]++;
      }
      completed = true;
      setNotice(
        clean.length === 1
          ? `${clean[0]} entrou no time.`
          : `${added} jogadores adicionados. Confira os dois times.`,
      );
    });
    return completed;
  }

  async function pastePlayers(e: FormEvent) {
    e.preventDefault();
    if (await addNames(pastedNames.split(/\r?\n/))) {
      setPastedNames("");
      setPasteOpen(false);
    }
  }

  function randomize() {
    const ids = shuffle(state.players.map((p) => p.id));
    const half = Math.ceil(ids.length / 2);
    void run({ type: "teams.set", A: ids.slice(0, half), B: ids.slice(half) });
  }

  return (
    <div className="team-setup" aria-busy={busy}>
      <header className="team-setup-intro">
        <div>
          <h2>{editable ? "Quem vai jogar?" : "Os times estão aqui."}</h2>
          <p>
            {editable
              ? "Monte os dois times. Depois, é só escolher os mapas."
              : "Dez jogadores, dois times. Acompanhe os próximos passos pela sala."}
          </p>
        </div>
        {editable && (
          <button
            className="team-setup-paste-toggle"
            aria-expanded={pasteOpen}
            aria-controls="team-setup-paste"
            disabled={busy || state.players.length >= MAX_PLAYERS}
            onClick={() => setPasteOpen((value) => !value)}
          >
            <Icon name="users" />
            Colar os 10 nomes
          </button>
        )}
      </header>

      {editable && pasteOpen && (
        <form
          id="team-setup-paste"
          className="team-setup-paste"
          onSubmit={pastePlayers}
        >
          <label htmlFor="team-setup-names">Um jogador por linha</label>
          <p>
            Os nomes preenchem as vagas de {state.teams.A.name} primeiro, depois
            de {state.teams.B.name}. Você pode ajustar os times em seguida.
          </p>
          <textarea
            id="team-setup-names"
            value={pastedNames}
            onChange={(e) => setPastedNames(e.target.value)}
            rows={5}
            placeholder={"Seu nick\nNick do amigo\nMais um jogador"}
            disabled={busy}
            autoFocus
          />
          <div className="team-setup-paste-actions">
            <span>
              {
                pastedNames.split(/\r?\n/).filter((value) => value.trim())
                  .length
              }{" "}
              nomes · {MAX_PLAYERS - state.players.length} vagas livres
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPasteOpen(false)}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="primary"
              disabled={busy || !pastedNames.trim()}
            >
              {busy ? "Adicionando…" : "Adicionar aos times"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="team-setup-feedback is-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="team-setup-feedback" role="status">
          <Icon name="check" />
          {notice}
        </p>
      )}

      <div className="team-setup-boards">
        {TEAM_IDS.map((team) => (
          <TeamColumn
            key={team}
            team={team}
            editable={editable}
            busy={busy}
            run={run}
            addPlayer={(name) => addNames([name], team)}
          />
        ))}
      </div>

      {bench.length > 0 && (
        <section
          className="team-setup-bench"
          aria-labelledby="team-setup-bench-title"
        >
          <div>
            <h3 id="team-setup-bench-title">Falta escolher o time</h3>
            <p>Coloque cada jogador em uma vaga livre.</p>
          </div>
          <ul>
            {bench.map((player) => (
              <li key={player.id}>
                <strong>{player.name}</strong>
                {editable && (
                  <div>
                    {TEAM_IDS.map((team) => (
                      <button
                        key={team}
                        disabled={busy || counts[team] >= 5}
                        onClick={() =>
                          void run({
                            type: "player.assign",
                            playerId: player.id,
                            team,
                          })
                        }
                      >
                        {state.teams[team].name}
                      </button>
                    ))}
                    <button
                      className="team-setup-icon-button"
                      disabled={busy}
                      aria-label={`Remover ${player.name}`}
                      onClick={() =>
                        void run({ type: "player.remove", playerId: player.id })
                      }
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {editable && (
        <>
          <div className="team-setup-tools">
            <button
              className="team-setup-text-button"
              disabled={busy || state.players.length < 2}
              onClick={randomize}
            >
              <Icon name="users" />
              Sortear os times
            </button>
            <RoomOptions busy={busy} run={run} />
          </div>
          <section
            className={`team-setup-start${ready ? " is-ready" : ""}`}
            aria-labelledby="team-setup-start-title"
          >
            <div>
              <h3 id="team-setup-start-title">
                {ready
                  ? "Times prontos. Vamos aos mapas?"
                  : "Complete os dois times para continuar."}
              </h3>
              <p>
                {ready
                  ? "Escolha quem faz o primeiro banimento."
                  : `${counts.A + counts.B} de 10 jogadores nos times. Cada lado precisa de cinco.`}
              </p>
            </div>
            <div className="team-setup-start-actions">
              <label htmlFor="team-setup-first">
                Primeiro banimento
                <select
                  id="team-setup-first"
                  value={first}
                  disabled={busy}
                  onChange={(e) => setFirst(e.target.value as TeamId)}
                >
                  {TEAM_IDS.map((team) => (
                    <option key={team} value={team}>
                      {state.teams[team].name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary"
                disabled={busy || !ready}
                onClick={() => void run({ type: "veto.start", first })}
              >
                Escolher mapas
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function TeamColumn({
  team,
  editable,
  busy,
  run,
  addPlayer,
}: {
  team: TeamId;
  editable: boolean;
  busy: boolean;
  run: RunCommand;
  addPlayer: (name: string) => Promise<boolean>;
}) {
  const { state } = useRoom();
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const info = state.teams[team];
  const roster = state.players.filter((player) => player.team === team);
  const other: TeamId = team === "A" ? "B" : "A";
  const otherFull =
    state.players.filter((player) => player.team === other).length >= 5;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await addPlayer(name)) {
      setName("");
      requestAnimationFrame(() => {
        if (roster.length < 4) inputRef.current?.focus();
        else
          (
            document.getElementById(`team-setup-add-${other}`) ??
            document.getElementById("team-setup-first")
          )?.focus();
      });
    } else requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <section
      className={`team-setup-board team-setup-board-${team}`}
      aria-label={info.name}
    >
      <header>
        <span className="team-setup-team-dot" aria-hidden="true" />
        <div>
          {editable ? (
            <input
              className="team-setup-team-name"
              defaultValue={info.name}
              key={info.name}
              maxLength={32}
              disabled={busy}
              aria-label={`Nome do time ${team}`}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value && value !== info.name)
                  void run({ type: "team.rename", team, name: value });
                else e.target.value = info.name;
              }}
            />
          ) : (
            <h3>{info.name}</h3>
          )}
          <span className="team-setup-team-subtitle">
            {roster.length === 5
              ? "Time completo"
              : `${5 - roster.length} ${5 - roster.length === 1 ? "vaga livre" : "vagas livres"}`}
          </span>
        </div>
        <span className="team-setup-team-count">
          {roster.length}
          <small>/5</small>
        </span>
      </header>
      <ul className="team-setup-roster">
        {roster.map((player) => (
          <li key={player.id} className="team-setup-player">
            <span className="team-setup-avatar" aria-hidden="true">
              {player.name.slice(0, 1).toLocaleUpperCase()}
            </span>
            <div>
              <strong>{player.name}</strong>
              {info.captainId === player.id && <small>Capitão</small>}
            </div>
            {editable && (
              <details className="team-setup-player-menu">
                <summary aria-label={`Opções de ${player.name}`}>•••</summary>
                <div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run({
                        type: "team.captain",
                        team,
                        playerId:
                          info.captainId === player.id ? null : player.id,
                      })
                    }
                  >
                    {info.captainId === player.id
                      ? "Remover capitão"
                      : "Tornar capitão"}
                  </button>
                  <button
                    disabled={busy || otherFull}
                    onClick={() =>
                      void run({
                        type: "player.assign",
                        playerId: player.id,
                        team: other,
                      })
                    }
                  >
                    Mover para {state.teams[other].name}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run({
                        type: "player.assign",
                        playerId: player.id,
                        team: null,
                      })
                    }
                  >
                    Deixar sem time
                  </button>
                  <button
                    disabled={busy}
                    className="team-setup-remove"
                    onClick={() =>
                      void run({ type: "player.remove", playerId: player.id })
                    }
                  >
                    Remover jogador
                  </button>
                </div>
              </details>
            )}
          </li>
        ))}
        {Array.from({ length: Math.max(0, 5 - roster.length) }, (_, index) => (
          <li key={`empty-${index}`} className="team-setup-empty">
            <span className="team-setup-avatar" aria-hidden="true">
              <Icon name="plus" />
            </span>
            <span>Vaga livre</span>
          </li>
        ))}
      </ul>
      {editable && roster.length < 5 && (
        <form className="team-setup-add" onSubmit={submit}>
          <input
            ref={inputRef}
            id={`team-setup-add-${team}`}
            aria-label={`Adicionar jogador a ${info.name}`}
            placeholder={
              roster.length >= 5 ? "Os cinco estão aqui." : "Nick do jogador"
            }
            maxLength={32}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={
              busy || roster.length >= 5 || state.players.length >= MAX_PLAYERS
            }
          />
          <button
            type="submit"
            aria-label={`Adicionar jogador a ${info.name}`}
            disabled={
              busy ||
              !name.trim() ||
              roster.length >= 5 ||
              state.players.length >= MAX_PLAYERS
            }
          >
            <Icon name="plus" />
          </button>
        </form>
      )}
    </section>
  );
}

function RoomOptions({ busy, run }: { busy: boolean; run: RunCommand }) {
  const { state } = useRoom();
  return (
    <details className="team-setup-options">
      <summary>Opções da sala</summary>
      <div className="team-setup-options-body">
        <label>
          Nome da scrim
          <input
            defaultValue={state.title}
            key={state.title}
            maxLength={60}
            disabled={busy}
            onBlur={(e) => {
              const value = e.target.value.trim();
              if (value && value !== state.title)
                void run({ type: "settings.update", title: value });
              else e.target.value = state.title;
            }}
          />
        </label>
        <label>
          Formato da série
          <select
            value={state.format}
            disabled={busy}
            onChange={(e) =>
              void run({
                type: "settings.update",
                format: e.target.value as SeriesFormat,
              })
            }
          >
            {(Object.keys(FORMAT_LABEL) as SeriesFormat[]).map((format) => (
              <option key={format} value={format}>
                {FORMAT_LABEL[format]}
              </option>
            ))}
          </select>
        </label>
        <PoolEditor busy={busy} run={run} />
      </div>
    </details>
  );
}

function PoolEditor({ busy, run }: { busy: boolean; run: RunCommand }) {
  const { state } = useRoom();
  const [draft, setDraft] = useState<MapId[] | null>(null);
  const pool = draft ?? state.pool;
  const toggle = (id: MapId) => {
    if (!busy)
      setDraft(
        pool.includes(id)
          ? pool.filter((map) => map !== id)
          : pool.length < POOL_SIZE
            ? [...pool, id]
            : pool,
      );
  };
  async function save() {
    if (await run({ type: "settings.update", pool })) setDraft(null);
  }

  return (
    <details className="team-setup-pool">
      <summary>
        Mapas disponíveis <span>{state.pool.length} mapas</span>
      </summary>
      <p>
        Escolha {POOL_SIZE} mapas para o veto. {pool.length} de {POOL_SIZE}{" "}
        selecionados.
      </p>
      <div className="team-setup-map-grid">
        {ALL_MAP_IDS.map((id) => (
          <MapCard
            key={id}
            mapId={id}
            state={pool.includes(id) ? "picked" : "off"}
            onClick={() => toggle(id)}
          />
        ))}
      </div>
      <div className="team-setup-pool-actions">
        <button
          className="primary"
          disabled={busy || !draft || pool.length !== POOL_SIZE}
          onClick={save}
        >
          Salvar mapas
        </button>
        <button
          disabled={busy}
          onClick={() => setDraft([...ACTIVE_COMPETITIVE_POOL])}
        >
          Usar padrão competitivo
        </button>
        {draft && (
          <button disabled={busy} onClick={() => setDraft(null)}>
            Cancelar
          </button>
        )}
      </div>
    </details>
  );
}
