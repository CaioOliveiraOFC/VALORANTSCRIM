import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  normalizeBroadcast,
  streamUrl,
  type Broadcast,
} from "../../../shared/streams";
import type {
  RecordingsPage,
  StreamRecording,
} from "../../../shared/recordings";
import { adminBroadcasts, saveBroadcast } from "./broadcastApi";
import { listRecordings, getRecording } from "./recordingApi";
import { useBroadcasts } from "./useBroadcasts";
import { StreamPlayer } from "./StreamPlayer";
import { RecordingsAdmin } from "./RecordingsAdmin";
import { PLATFORM_NAMES, streamPlatform } from "../../../shared/streams";
import "./event-media.css";

interface Props {
  roomId: string;
  roomTitle: string;
  phase: string;
  canEdit: boolean;
  canPublish: boolean;
  isPublic: boolean;
}
type Tab = "live" | "recordings";

/** The event owns its live links and replays. There is no separate setup step. */
export function EventMedia({
  roomId,
  roomTitle,
  phase,
  canEdit,
  canPublish,
  isPublic,
}: Props) {
  const { broadcasts, error: publicError } = useBroadcasts(roomId);
  const requested = new URLSearchParams(location.search).get("media");
  const requestedTab: Tab | null =
    requested === "live" || requested === "recordings" ? requested : null;
  const [current, setCurrent] = useState<Broadcast | null>(null),
    [configLoaded, setConfigLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>(
    () =>
      requestedTab ??
      (phase === "finished" || phase === "paused" ? "recordings" : "live"),
  );
  const manuallySelected = useRef(requestedTab !== null),
    locked = useRef(false),
    currentRef = useRef<Broadcast | null>(null),
    paginated = useRef(false);
  currentRef.current = current;
  const [editing, setEditing] = useState(false),
    [links, setLinks] = useState([{ channel: "", label: "" }]);
  const [promote, setPromote] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [page, setPage] = useState<RecordingsPage | null>(null),
    [recordsError, setRecordsError] = useState(""),
    [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<StreamRecording | null>(null),
    [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [draftVersion, setDraftVersion] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const widgetRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (location.hash !== "#event-media") return;
    const frame = requestAnimationFrame(() => {
      widgetRef.current?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
      widgetRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [roomId]);

  useEffect(() => {
    if (
      !manuallySelected.current &&
      (phase === "finished" || phase === "paused")
    )
      setTab("recordings");
  }, [phase]);
  useEffect(() => {
    if (requestedTab) {
      manuallySelected.current = true;
      setTab(requestedTab);
    }
  }, [requestedTab]);
  useEffect(() => {
    if (!canEdit) {
      setCurrent(null);
      setConfigLoaded(false);
      setEditing(false);
      return;
    }
    let disposed = false,
      running = false;
    let ctrl: AbortController | null = null;
    setError("");
    setConfigLoaded(false);
    const refresh = async () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      ctrl = new AbortController();
      const startedVersion = currentRef.current?.version ?? 0;
      try {
        const all = await adminBroadcasts(ctrl.signal),
          next = all.find((item) => item.roomId === roomId) ?? null;
        if (!disposed) {
          setCurrent((previous) =>
            previous &&
            previous.version > startedVersion &&
            (!next || next.version < previous.version)
              ? previous
              : next,
          );
          setConfigLoaded(true);
        }
      } catch (err) {
        if (!disposed && !ctrl.signal.aborted) setError((err as Error).message);
      } finally {
        running = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    const visible = () => void refresh();
    addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      ctrl?.abort();
      clearInterval(timer);
      removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [roomId, canEdit]);
  useEffect(() => {
    let disposed = false,
      running = false;
    paginated.current = false;
    setPage(null);
    async function refresh() {
      if (running || paginated.current || document.visibilityState === "hidden")
        return;
      running = true;
      try {
        const next = await listRecordings(canEdit, 0, roomId);
        if (!disposed && !paginated.current) {
          setPage({
            ...next,
            recordings: next.recordings.filter(
              (item) => item.roomId === roomId,
            ),
          });
          setRecordsError("");
        }
      } catch (err) {
        if (!disposed) setRecordsError((err as Error).message);
      } finally {
        running = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    const visible = () => void refresh();
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [roomId, revision, canEdit]);
  useEffect(() => {
    if (!selectedId) return;
    let disposed = false,
      running = false;
    let ctrl: AbortController | null = null;
    async function refresh() {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      ctrl = new AbortController();
      try {
        const recording = await getRecording(selectedId!, ctrl.signal);
        if (!disposed) {
          if (recording.roomId !== roomId)
            throw new Error("Esta gravação pertence a outro evento.");
          setSelected(recording);
        }
      } catch (err) {
        if (!disposed && !ctrl.signal.aborted) {
          setSelected(null);
          setNotice((err as Error).message);
        }
      } finally {
        running = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => {
      disposed = true;
      ctrl?.abort();
      clearInterval(timer);
    };
  }, [selectedId, roomId, revision]);
  useEffect(() => {
    if (editing)
      formRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [editing]);

  const live =
    canEdit && configLoaded
      ? current?.enabled
        ? current
        : null
      : (broadcasts[0] ?? null);
  const canPromote = canPublish && isPublic;
  function begin() {
    const config = current ?? live;
    setDraftVersion(config?.version ?? 0);
    setLinks(
      config?.channels.length
        ? config.channels.map((item) => ({
            channel: streamUrl(item),
            label: item.label,
          }))
        : [{ channel: "", label: "" }],
    );
    setPromote(!!config?.promoteHome && canPromote);
    setError("");
    setNotice("");
    setEditing(true);
  }
  async function update(
    config: Pick<Broadcast, "title" | "channels" | "enabled" | "promoteHome">,
    expectedVersion = current?.version ?? 0,
  ) {
    if (locked.current || !configLoaded) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await saveBroadcast(roomId, expectedVersion, config);
      setCurrent(saved);
      setEditing(false);
      setNotice(
        saved.enabled
          ? "Links salvos e exibindo neste evento. Espectadores atualizam em até 10 segundos."
          : "Live oculta neste evento. Os links continuam salvos.",
      );
    } catch (err) {
      if ((err as { status?: number }).status === 409) {
        try {
          const all = await adminBroadcasts();
          const fresh = all.find((item) => item.roomId === roomId) ?? null;
          setCurrent(fresh);
          setEditing(false);
        } catch {
          setConfigLoaded(false);
        }
      }
      setError((err as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const config = normalizeBroadcast({
        title: roomTitle.slice(0, 100),
        channels: links.filter(
          (item) => item.channel.trim() || item.label.trim(),
        ),
        enabled: true,
        promoteHome: canPromote && promote,
      });
      if (config.channels.some((item) => item.kind === "video"))
        throw new Error(
          "Este é um link de gravação. Adicione-o na aba Gravações.",
        );
      await update(config, draftVersion);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  function toggle() {
    const config = current;
    if (config)
      void update({
        title: config.title,
        channels: config.channels,
        enabled: !config.enabled,
        promoteHome: config.promoteHome && canPromote,
      });
  }
  function play(recording: StreamRecording) {
    if (recording.roomId === roomId) {
      setSelected(recording);
      setSelectedId(recording.id);
      setNotice("");
    }
  }
  async function more() {
    if (!page || page.nextOffset === null || busy) return;
    setBusy(true);
    try {
      const next = await listRecordings(false, page.nextOffset, roomId);
      paginated.current = true;
      setPage({
        ...next,
        recordings: [
          ...page.recordings,
          ...next.recordings.filter(
            (item) =>
              item.roomId === roomId &&
              !page.recordings.some((old) => old.id === item.id),
          ),
        ],
      });
    } catch (err) {
      setRecordsError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      ref={widgetRef}
      tabIndex={-1}
      className={`event-media${expanded ? " is-expanded" : ""}`}
      id="event-media"
      aria-labelledby="event-media-title"
    >
      <header className="event-media-heading">
        <div>
          <h2 id="event-media-title">Acompanhe este evento</h2>
          <p>
            {live ? (
              <span className="event-media-status is-published">
                Exibindo live neste evento
              </span>
            ) : (
              <span className="event-media-status">
                {current?.channels.length
                  ? "Live oculta · links salvos"
                  : "Nenhuma live em exibição"}
              </span>
            )}
          </p>
        </div>
        {(live || selected) && (
          <button
            type="button"
            className="ghost"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Reduzir player" : "Ampliar player"}
          </button>
        )}
      </header>
      <div
        className="event-media-tabs"
        role="tablist"
        aria-label="Mídia do evento"
      >
        <button
          type="button"
          role="tab"
          id="event-live-tab"
          aria-controls="event-live-panel"
          aria-selected={tab === "live"}
          onClick={() => {
            manuallySelected.current = true;
            setTab("live");
          }}
        >
          Ao vivo
        </button>
        <button
          type="button"
          role="tab"
          id="event-recordings-tab"
          aria-controls="event-recordings-panel"
          aria-selected={tab === "recordings"}
          onClick={() => {
            manuallySelected.current = true;
            setTab("recordings");
          }}
        >
          Gravações{page?.total ? ` (${page.total})` : ""}
        </button>
      </div>
      {error && (
        <p role="alert" className="admin-form-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="stream-notice">
          {notice}
        </p>
      )}
      {tab === "live" ? (
        <div
          id="event-live-panel"
          role="tabpanel"
          aria-labelledby="event-live-tab"
          className="event-media-live"
        >
          {live && (
            <div className="event-mini-player">
              <StreamPlayer broadcast={live} compact={!expanded} />
            </div>
          )}
          <div className="event-media-controls">
            {!live && (
              <p className="muted">
                {canEdit
                  ? "Cole os links de quem vai transmitir. O player aparece aqui para todo mundo."
                  : "Quando a organização publicar uma live, você poderá assistir por aqui."}
              </p>
            )}
            {canEdit && (
              <div className="event-media-actions">
                <button
                  type="button"
                  className={!live ? "primary" : ""}
                  disabled={busy || !configLoaded}
                  onClick={begin}
                >
                  {current?.channels.length
                    ? "Editar links da live"
                    : "Adicionar link ao vivo"}
                </button>
                {current?.channels.length ? (
                  <button
                    type="button"
                    disabled={busy || !configLoaded}
                    onClick={toggle}
                  >
                    {busy
                      ? "Salvando…"
                      : current.enabled
                        ? "Ocultar live"
                        : "Exibir live"}
                  </button>
                ) : null}
              </div>
            )}
            {!canEdit && publicError && (
              <p role="status" className="muted small">
                {publicError}
              </p>
            )}
            {editing && canEdit && (
              <form
                ref={formRef}
                className="event-live-form"
                onSubmit={(event) => void submit(event)}
              >
                <h3>Links ao vivo deste evento</h3>
                <p>
                  Um link por perspectiva. O espectador troca pelas setas do
                  player.
                </p>
                {links.map((item, index) => (
                  <div className="event-live-link" key={index}>
                    <label>
                      Link {index + 1}
                      <input
                        aria-label={`Link ao vivo ${index + 1}`}
                        placeholder="Twitch, YouTube ou Kick"
                        maxLength={300}
                        value={item.channel}
                        disabled={busy}
                        onChange={(event) =>
                          setLinks((items) =>
                            items.map((entry, at) =>
                              at === index
                                ? { ...entry, channel: event.target.value }
                                : entry,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      Nome (opcional)
                      <input
                        aria-label={`Nome da live ${index + 1}`}
                        maxLength={40}
                        placeholder="Narrador, POV do Caio…"
                        value={item.label}
                        disabled={busy}
                        onChange={(event) =>
                          setLinks((items) =>
                            items.map((entry, at) =>
                              at === index
                                ? { ...entry, label: event.target.value }
                                : entry,
                            ),
                          )
                        }
                      />
                    </label>
                    {links.length > 1 && (
                      <button
                        type="button"
                        className="ghost"
                        aria-label={`Remover link ${index + 1}`}
                        disabled={busy}
                        onClick={() =>
                          setLinks((items) =>
                            items.filter((_, at) => at !== index),
                          )
                        }
                      >
                        Remover
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="ghost"
                  disabled={busy || links.length >= 6}
                  onClick={() =>
                    setLinks((items) => [...items, { channel: "", label: "" }])
                  }
                >
                  Adicionar outra perspectiva
                </button>
                {canPromote && (
                  <label className="event-media-checkbox">
                    <input
                      type="checkbox"
                      checked={promote}
                      disabled={busy}
                      onChange={(event) => setPromote(event.target.checked)}
                    />
                    <span>Destacar este evento na página inicial</span>
                  </label>
                )}
                <div className="event-media-actions">
                  <button type="submit" className="primary" disabled={busy}>
                    {busy ? "Salvando…" : "Salvar e exibir neste evento"}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={() => setEditing(false)}
                  >
                    Cancelar links
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : (
        <div
          id="event-recordings-panel"
          role="tabpanel"
          aria-labelledby="event-recordings-tab"
        >
          <p className="event-media-description">
            {phase === "paused"
              ? "Evento em empate técnico. Os vídeos já gravados podem ficar aqui enquanto aguardamos a retomada."
              : "Reveja os vídeos deste evento, sem misturar com outras salas."}
          </p>
          {selected && (
            <div className="event-mini-player">
              <StreamPlayer
                key={selected.id}
                compact={!expanded}
                broadcast={{
                  roomId,
                  title: selected.title,
                  channels: [selected.source],
                  enabled: true,
                  promoteHome: false,
                  version: selected.version,
                }}
              />
            </div>
          )}
          {canEdit ? (
            <RecordingsAdmin
              roomId={roomId}
              compact
              rooms={[{ id: roomId, title: roomTitle, access: { isPublic } }]}
              superAdmin={false}
              canPublish={canPublish}
              target={null}
              onChange={() => setRevision((value) => value + 1)}
              onPlay={play}
            />
          ) : (
            <>
              {recordsError && <p role="alert">{recordsError}</p>}
              {!page && !recordsError ? (
                <p role="status">Carregando gravações…</p>
              ) : page?.recordings.length ? (
                <ul className="event-replay-list">
                  {page.recordings.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => play(item)}
                        aria-pressed={selectedId === item.id}
                      >
                        <span>
                          <strong>{item.title}</strong>
                          <small>
                            {PLATFORM_NAMES[streamPlatform(item.source)]}
                          </small>
                        </span>
                        <span>Assistir</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  As gravações deste evento vão aparecer aqui quando forem
                  adicionadas.
                </p>
              )}
              {page?.nextOffset !== null && page && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void more()}
                >
                  Mais gravações deste evento
                </button>
              )}
              {paginated.current && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setRevision((value) => value + 1)}
                >
                  Atualizar gravações
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
