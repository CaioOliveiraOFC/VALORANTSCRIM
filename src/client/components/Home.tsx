import { useEffect, useState, type FormEvent } from "react";
import type { CreateScrimResponse, ScrimSummary } from "../../shared/protocol";
import { FORMAT_LABEL, type SeriesFormat } from "../../shared/veto";
import { navigate } from "../router";
import { Icon } from "./Icon";
import { fmtDateTime } from "../util";

const PHASE_LABEL: Record<ScrimSummary["phase"], string> = {
  setup: "Montando times",
  veto: "Veto",
  live: "Ao vivo",
  finished: "Encerrada",
};

export function Home() {
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<SeriesFormat>("bo3");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "live" | "finished">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [history, setHistory] = useState<ScrimSummary[] | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/scrims", { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setHistory)
      .catch(() => {
        if (!ctrl.signal.aborted) {
          setHistoryError(true);
          setHistory([]);
        }
      });
    return () => ctrl.abort();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/scrims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title:
            title.trim() || `Scrim ${new Date().toLocaleDateString("pt-BR")}`,
          format,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Falha ao criar a scrim.");
      const { id, adminKey } = body as CreateScrimResponse;
      navigate(`/s/${id}#admin=${encodeURIComponent(adminKey)}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const visible = history?.filter(
    (h) =>
      (filter === "all" ||
        (filter === "live"
          ? h.phase === "live" || h.phase === "veto"
          : h.phase === "finished")) &&
      `${h.title} ${h.teams.join(" ")} ${h.maps.join(" ")}`
        .toLocaleLowerCase("pt-BR")
        .includes(search.toLocaleLowerCase("pt-BR")),
  );

  return (
    <main className="page home-page" id="main-content" tabIndex={-1}>
      <section className="create-lobby">
        <div className="lobby-art" aria-hidden="true">
          <img src="/assets/lotus-banner.png" alt="" />
          <div className="lobby-art-copy">
            <Icon name="crosshair" />
            <span>
              Dez amigos.
              <br />
              Uma boa partida.
            </span>
          </div>
          <span className="lobby-map-name">Lotus</span>
        </div>
        <form className="create-form" onSubmit={create}>
          <h1>Vamos jogar?</h1>
          <p className="muted">
            Crie a sala. Monte os times. Escolham os mapas.
          </p>
          <label>
            Nome da sala <span className="muted label-optional">opcional</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Scrim de sexta"
              maxLength={60}
            />
          </label>
          <fieldset className="format-picker">
            <legend>Quantos mapas?</legend>
            <div>
              {(Object.keys(FORMAT_LABEL) as SeriesFormat[]).map((f) => (
                <label key={f} className={f === format ? "on" : ""}>
                  <input
                    type="radio"
                    name="format"
                    value={f}
                    checked={f === format}
                    onChange={() => setFormat(f)}
                  />
                  <strong>{FORMAT_LABEL[f]}</strong>
                  <span>
                    {f === "bo1"
                      ? "Uma partida"
                      : f === "bo3"
                        ? "Melhor de 3"
                        : "Melhor de 5"}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <button className="primary create-submit" disabled={busy}>
            {busy ? "Criando sala…" : "Criar sala"}
          </button>
          <small className="muted">
            Sem cadastro. Você recebe o controle da sala.
          </small>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      </section>
      <section className="history-section">
        <div className="section-heading">
          <h2>Voltar a uma sala</h2>
          <label className="search-field">
            <Icon name="search" />
            <input
              aria-label="Buscar scrims"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar sala ou time"
            />
          </label>
        </div>
        <div className="filter-tabs" role="group" aria-label="Filtrar scrims">
          {(
            [
              ["all", "Todas"],
              ["live", "Em jogo"],
              ["finished", "Encerradas"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? "on" : ""}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {historyError ? (
          <p className="card error" role="alert">
            Não foi possível carregar as salas. Recarregue a página para tentar
            novamente.
          </p>
        ) : history === null ? (
          <p className="muted">Carregando salas…</p>
        ) : !visible?.length ? (
          <p className="history-empty muted">
            {history.length
              ? "Nenhuma sala encontrada. Tente outro nome ou filtro."
              : "Sua primeira sala vai aparecer aqui."}
          </p>
        ) : (
          <ul className="history">
            {visible.map((h) => (
              <li key={h.id}>
                <a
                  href={`/s/${h.id}`}
                  onClick={(e) => {
                    if (!e.metaKey && !e.ctrlKey) {
                      e.preventDefault();
                      navigate(`/s/${h.id}`);
                    }
                  }}
                >
                  <div className="history-info">
                    <strong>{h.title}</strong>
                    <span>
                      {h.teams[0]} <span className="muted">vs</span>{" "}
                      {h.teams[1]}
                    </span>
                    <small className="muted">{fmtDateTime(h.createdAt)}</small>
                  </div>
                  <span className={`badge ${h.phase}`}>
                    {PHASE_LABEL[h.phase]}
                  </span>
                  <span className="history-score">
                    {h.score[0]}
                    <span>:</span>
                    {h.score[1]}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
