import { useEffect, useState } from "react";
import {
  type RecordingsPage as Page,
  type StreamRecording,
} from "../../../shared/recordings";
import {
  PLATFORM_NAMES,
  streamPlatform,
  streamUrl,
} from "../../../shared/streams";
import { navigate } from "../../router";
import { fmtDateTime } from "../../util";
import { StreamPlayer } from "./StreamPlayer";
import { getRecording, listRecordings } from "./recordingApi";
import "./streams.css";

export function RecordingsPage() {
  const query = new URLSearchParams(location.search),
    selectedId = query.get("replay"),
    roomId = query.get("roomId") ?? undefined;
  const [page, setPage] = useState<Page | null>(null),
    [selected, setSelected] = useState<StreamRecording | null>(null);
  const [error, setError] = useState(""),
    [playerError, setPlayerError] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false;
    setPage(null);
    setError("");
    listRecordings(false, 0, roomId)
      .then((next) => {
        if (!disposed) setPage(next);
      })
      .catch((err) => {
        if (!disposed) setError(err.message);
      });
    return () => {
      disposed = true;
    };
  }, [roomId, retry]);
  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      setPlayerError("");
      return;
    }
    let disposed = false,
      running = false;
    let pending: AbortController | undefined;
    setSelected(null);
    setPlayerError("");
    const refresh = async () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      pending = new AbortController();
      try {
        const value = await getRecording(selectedId, pending.signal);
        if (!disposed) {
          setSelected(value);
          setPlayerError("");
        }
      } catch (err) {
        if (!disposed && !pending.signal.aborted) {
          setSelected(null);
          setPlayerError((err as Error).message);
        }
      } finally {
        running = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    const visible = () => void refresh();
    document.addEventListener("visibilitychange", visible);
    addEventListener("focus", visible);
    return () => {
      disposed = true;
      pending?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      removeEventListener("focus", visible);
    };
  }, [selectedId, retry]);
  async function more() {
    if (page?.nextOffset === null || !page || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await listRecordings(false, page.nextOffset, roomId);
      setPage({
        ...next,
        recordings: [
          ...page.recordings,
          ...next.recordings.filter(
            (item) => !page.recordings.some((old) => old.id === item.id),
          ),
        ],
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page recordings-page">
      <header className="stream-admin-heading">
        <div>
          <h1>Gravações da Brasa</h1>
          <p>As partidas ficam na memória. Os replays ficam por aqui.</p>
        </div>
        <a className="button" href="/vct">
          Ver salas VCT
        </a>
      </header>
      {selectedId && (
        <section className="recording-selected" aria-label="Replay selecionado">
          {selected ? (
            <StreamPlayer
              key={selected.id}
              broadcast={{
                roomId: selected.roomId,
                title: selected.title,
                channels: [selected.source],
                enabled: true,
                promoteHome: false,
                version: selected.version,
              }}
            />
          ) : (
            <p role={playerError ? "alert" : "status"}>
              {playerError || "Abrindo a gravação…"}
            </p>
          )}
          {selected && (
            <p className="stream-help">
              {selected.roomTitle || "Transmissão do clube"} · Adicionado em{" "}
              {fmtDateTime(selected.createdAt)}.{" "}
              {selected.roomId && (
                <a href={`/s/${selected.roomId}`}>Abrir evento</a>
              )}
            </p>
          )}
        </section>
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setRetry((v) => v + 1)}>
            Tentar novamente
          </button>
        </div>
      )}
      {!page && !error ? (
        <p role="status">Carregando gravações…</p>
      ) : page?.recordings.length ? (
        <ul className="recording-cards">
          {page.recordings.map((item) => (
            <li key={item.id}>
              <article>
                <span className="recording-provider">
                  {PLATFORM_NAMES[streamPlatform(item.source)]}
                </span>
                <h2>{item.title}</h2>
                <p>{item.roomTitle || "Transmissão do clube"}</p>
                <small>Adicionado em {fmtDateTime(item.createdAt)}</small>
                <div>
                  <a
                    className="button primary"
                    href={`/gravacoes?replay=${item.id}`}
                    onClick={(event) => {
                      if (
                        event.button !== 0 ||
                        event.ctrlKey ||
                        event.metaKey ||
                        event.shiftKey ||
                        event.altKey
                      )
                        return;
                      event.preventDefault();
                      navigate(`/gravacoes?replay=${item.id}`);
                    }}
                  >
                    Assistir replay
                  </a>
                  <a
                    href={streamUrl(item.source)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir na plataforma
                  </a>
                </div>
              </article>
            </li>
          ))}
        </ul>
      ) : (
        page && (
          <section className="stream-visibility-empty">
            <p>
              <strong>Os próximos replays vão aparecer aqui.</strong>
              <span>
                Quando a organização registrar uma gravação, você poderá rever a
                partida.
              </span>
            </p>
          </section>
        )
      )}
      {page?.nextOffset !== null && page && (
        <button type="button" disabled={busy} onClick={() => void more()}>
          {busy ? "Carregando…" : "Ver mais gravações"}
        </button>
      )}
      <p className="stream-visibility-footnote">
        O acervo guarda os links das gravações. A disponibilidade de cada vídeo
        depende da plataforma e do canal que o publicou.
      </p>
    </main>
  );
}
