import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  parseRecording,
  type RecordingsPage,
  type StreamRecording,
} from "../../../shared/recordings";
import {
  PLATFORM_NAMES,
  streamPlatform,
  streamUrl,
  type StreamChannel,
} from "../../../shared/streams";
import { listRecordings, recordingRequest } from "./recordingApi";
import { fmtDateTime } from "../../util";

export interface RecordingTarget {
  roomId: string | null;
  title: string;
  source?: StreamChannel;
}
export interface RecordingRoom {
  id: string;
  title: string;
  access?: { isPublic: boolean };
}
export function RecordingsAdmin({
  rooms,
  superAdmin,
  canPublish,
  canEdit = true,
  target,
  roomId,
  compact = false,
  onChange,
  onPlay,
}: {
  rooms: RecordingRoom[];
  superAdmin: boolean;
  canPublish: boolean;
  canEdit?: boolean;
  target: RecordingTarget | null;
  roomId?: string;
  compact?: boolean;
  onChange?: () => void;
  onPlay?: (recording: StreamRecording) => void;
}) {
  const [page, setPage] = useState<RecordingsPage | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [formOpen, setFormOpen] = useState(false),
    [destination, setDestination] = useState(""),
    [title, setTitle] = useState(""),
    [url, setUrl] = useState(""),
    [label, setLabel] = useState(""),
    [isPublic, setPublic] = useState(false);
  const [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const locked = useRef(false),
    formRef = useRef<HTMLFormElement>(null);
  const scopeRef = useRef(roomId);
  scopeRef.current = roomId;
  const editRef = useRef(canEdit);
  editRef.current = canEdit;
  const inScope = (item: StreamRecording) => !roomId || item.roomId === roomId;
  const scopePage = (value: RecordingsPage): RecordingsPage => ({
    ...value,
    recordings: value.recordings.filter(inScope),
  });
  const effectiveDestination = roomId ?? destination;
  const publicAllowed =
    effectiveDestination === "home"
      ? superAdmin
      : canPublish &&
        !!rooms.find((item) => item.id === effectiveDestination)?.access
          ?.isPublic;
  useEffect(() => {
    let disposed = false;
    setError("");
    setNotice("");
    setPage(null);
    setFormOpen(false);
    listRecordings(true, 0, roomId)
      .then((p) => {
        if (!disposed) setPage(scopePage(p));
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
    };
  }, [retry, roomId]);
  useEffect(() => {
    if (!canEdit) setFormOpen(false);
  }, [canEdit]);
  function begin(value?: RecordingTarget) {
    if (!editRef.current) return;
    const scopedTarget =
      !roomId || value?.roomId === roomId ? value : undefined;
    const destinationRoomId =
      roomId ??
      (scopedTarget
        ? scopedTarget.roomId
        : superAdmin
          ? null
          : (rooms[0]?.id ?? null));
    setDestination(destinationRoomId ?? "home");
    setTitle(
      scopedTarget?.title ??
        rooms.find((item) => item.id === roomId)?.title ??
        "Replay da Brasa",
    );
    setLabel(scopedTarget?.source?.label ?? "");
    setUrl(
      scopedTarget?.source &&
        (streamPlatform(scopedTarget.source) === "youtube" ||
          scopedTarget.source.kind === "video")
        ? streamUrl(scopedTarget.source)
        : "",
    );
    setPublic(
      destinationRoomId === null
        ? superAdmin
        : canPublish &&
            !!rooms.find((item) => item.id === destinationRoomId)?.access
              ?.isPublic,
    );
    setError("");
    setNotice("");
    setFormOpen(true);
  }
  useEffect(() => {
    if (target && canEdit) begin(target);
  }, [target, roomId, canEdit]);
  useEffect(() => {
    if (formOpen && formRef.current) {
      formRef.current.scrollIntoView({ block: "start", behavior: "auto" });
      formRef.current
        .querySelector<HTMLInputElement>("input")
        ?.focus({ preventScroll: true });
    }
  }, [formOpen, target]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (locked.current || !editRef.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const operationScope = roomId;
    try {
      const result = parseRecording(
        await recordingRequest("/api/admin/stream-recordings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            roomId: roomId ?? (destination === "home" ? null : destination),
            title,
            url,
            label,
            isPublic: publicAllowed && isPublic,
          }),
        }),
      );
      if (scopeRef.current !== operationScope) return;
      if (!inScope(result))
        throw new Error(
          "A gravação não corresponde a este evento. Atualize antes de tentar novamente.",
        );
      setPage((current) => ({
        recordings: [result, ...(current?.recordings ?? [])],
        total: (current?.total ?? 0) + 1,
        nextOffset: current?.nextOffset == null ? null : current.nextOffset + 1,
      }));
      setFormOpen(false);
      setNotice(
        `“${result.title}” foi adicionada ao histórico${result.isPublic ? " e aparece no acervo público" : " como gravação oculta"}.`,
      );
      onChange?.();
    } catch (err) {
      if (scopeRef.current !== operationScope) return;
      setError((err as Error).message);
      if ((err as { status?: number }).status === 409) setRetry((v) => v + 1);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function toggle(item: StreamRecording) {
    if (locked.current || !editRef.current || !inScope(item)) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const operationScope = roomId;
    try {
      const next = parseRecording(
        await recordingRequest(`/api/admin/stream-recordings/${item.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            isPublic: !item.isPublic,
            expectedVersion: item.version,
          }),
        }),
      );
      if (scopeRef.current !== operationScope) return;
      if (!inScope(next))
        throw new Error(
          "A gravação não corresponde a este evento. Atualize antes de tentar novamente.",
        );
      setPage((current) =>
        current
          ? {
              ...current,
              recordings: current.recordings.map((r) =>
                r.id === next.id ? next : r,
              ),
            }
          : null,
      );
      setNotice(
        next.isPublic
          ? "Replay publicado no acervo."
          : "Replay oculto. O registro continua no histórico.",
      );
      onChange?.();
    } catch (err) {
      if (scopeRef.current !== operationScope) return;
      setError((err as Error).message);
      if ((err as { status?: number }).status === 409) setRetry((v) => v + 1);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function more() {
    if (!page || page.nextOffset === null || locked.current) return;
    locked.current = true;
    setBusy(true);
    const operationScope = roomId;
    try {
      const next = scopePage(
        await listRecordings(true, page.nextOffset, roomId),
      );
      if (scopeRef.current !== operationScope) return;
      setPage({
        ...next,
        recordings: [
          ...page.recordings,
          ...next.recordings.filter(
            (r) => !page.recordings.some((old) => old.id === r.id),
          ),
        ],
      });
    } catch (err) {
      if (scopeRef.current !== operationScope) return;
      setError((err as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className={`recordings-admin${compact ? " is-compact" : ""}`}
      aria-labelledby={
        roomId ? `recordings-admin-title-${roomId}` : "recordings-admin-title"
      }
    >
      <div className="stream-overview-heading">
        <div>
          <h2
            id={
              roomId
                ? `recordings-admin-title-${roomId}`
                : "recordings-admin-title"
            }
          >
            {compact ? "Gravações do evento" : "Histórico de gravações"}
          </h2>
          <p>
            {!canEdit
              ? "Consulte as gravações e assista aos replays. Para alterar, peça ao super admin a permissão “Gerenciar lives e gravações”."
              : compact
              ? "Cole o link do vídeo salvo para a galera rever esta scrim."
              : "Guarde o link do replay, sem perder o registro quando trocar a live."}
          </p>
        </div>
        {canEdit && page && (superAdmin || rooms.length > 0) && (
          <button type="button" disabled={busy} onClick={() => begin()}>
            {compact ? "Adicionar gravação" : "Adicionar replay"}
          </button>
        )}
      </div>
      {error && (
        <div role="alert">
          <p>{error}</p>
          {!page && (
            <button type="button" onClick={() => setRetry((v) => v + 1)}>
              Tentar novamente
            </button>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="stream-notice">
          {notice}
        </p>
      )}
      {!page && !error && (
        <p role="status" className="muted">
          Carregando gravações…
        </p>
      )}
      {canEdit && formOpen && page && (
        <form
          ref={formRef}
          className="recording-form"
          onSubmit={(event) => void save(event)}
        >
          <h3>
            {compact ? "Adicionar gravação deste evento" : "Registrar gravação"}
          </h3>
          {roomId ? (
            <p className="muted small">
              Evento:{" "}
              {rooms.find((item) => item.id === roomId)?.title ?? roomId}
            </p>
          ) : (
            <label>
              Vincular a
              <select
                value={destination}
                disabled={busy}
                onChange={(event) => {
                  const key = event.target.value;
                  setDestination(key);
                  setPublic(
                    key === "home"
                      ? superAdmin
                      : canPublish &&
                          !!rooms.find((item) => item.id === key)?.access
                            ?.isPublic,
                  );
                }}
              >
                {superAdmin && <option value="home">Clube · sem evento</option>}
                {rooms.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                    {item.access?.isPublic ? "" : " (sala oculta)"}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Título da gravação
            <input
              name="recording-title"
              maxLength={100}
              required
              value={title}
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            Link do replay
            <input
              name="recording-url"
              type="url"
              placeholder="Link do vídeo salvo na Twitch, YouTube ou Kick"
              maxLength={300}
              required
              value={url}
              disabled={busy}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <p className="muted small">
            Use o vídeo específico. Um link de canal pode passar a mostrar outra
            live. Na Twitch, a opção de salvar transmissões anteriores precisa
            estar ativa.
          </p>
          <label>
            Nome da perspectiva (opcional)
            <input
              name="recording-label"
              maxLength={40}
              value={label}
              disabled={busy}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <label className="stream-checkbox">
            <input
              type="checkbox"
              name="recording-public"
              checked={isPublic && publicAllowed}
              disabled={busy || !publicAllowed}
              onChange={(event) => setPublic(event.target.checked)}
            />
            <span>
              <strong>
                {compact
                  ? "Mostrar gravação para espectadores"
                  : "Mostrar no acervo público"}
              </strong>
              <small>
                {publicAllowed
                  ? "A galera poderá rever pelo site."
                  : "Este destino fica restrito à administração."}
              </small>
            </span>
          </label>
          <div className="stream-save-actions">
            <button type="submit" className="primary" disabled={busy}>
              {busy
                ? "Salvando…"
                : compact
                  ? "Salvar gravação"
                  : "Salvar replay"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setFormOpen(false)}
            >
              {compact ? "Cancelar gravação" : "Cancelar replay"}
            </button>
          </div>
        </form>
      )}
      {page && !page.recordings.length && !formOpen && (
        <p className="muted">
          {canEdit
            ? "Nenhuma gravação registrada. Ao terminar a live, adicione o link do replay."
            : "Nenhuma gravação registrada neste acervo."}
        </p>
      )}
      {page && page.recordings.length > 0 && (
        <ul className="recording-admin-list">
          {page.recordings.filter(inScope).map((item) => {
            const canShow =
              item.roomId === null
                ? superAdmin
                : canPublish &&
                  !!rooms.find((room) => room.id === item.roomId)?.access
                    ?.isPublic;
            return (
              <li key={item.id}>
                <div>
                  <span className="recording-provider">
                    {PLATFORM_NAMES[streamPlatform(item.source)]}
                  </span>
                  <h3>{item.title}</h3>
                  <p>
                    {item.roomTitle || "Clube · sem evento"} ·{" "}
                    {item.isPublic
                      ? item.roomId === null ||
                        rooms.some(
                          (room) =>
                            room.id === item.roomId && room.access?.isPublic,
                        )
                        ? "No acervo público"
                        : "Oculta com a sala"
                      : "Oculta"}{" "}
                    · Adicionada em {fmtDateTime(item.createdAt)}
                  </p>
                </div>
                <div className="recording-actions">
                  {onPlay ? (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => onPlay(item)}
                    >
                      Assistir gravação
                    </button>
                  ) : (
                    <a href={`/gravacoes?replay=${item.id}`}>Assistir replay</a>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      disabled={busy || (!item.isPublic && !canShow)}
                      aria-label={`${item.isPublic ? "Ocultar" : "Exibir"} replay ${item.title}`}
                      onClick={() => void toggle(item)}
                    >
                      {item.isPublic ? "Ocultar replay" : "Exibir replay"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {page?.nextOffset !== null && page && (
        <button type="button" disabled={busy} onClick={() => void more()}>
          Ver mais gravações
        </button>
      )}
      {!compact && (
        <p className="stream-visibility-footnote">
          <a href="/gravacoes">Abrir acervo público</a>. O site guarda os links,
          sem copiar os arquivos de vídeo. Ocultar uma transmissão ao vivo não
          cria nem apaga replays.
        </p>
      )}
    </section>
  );
}
