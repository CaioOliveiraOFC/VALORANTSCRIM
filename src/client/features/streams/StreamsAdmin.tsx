import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ScrimSummary } from "../../../shared/protocol";
import {
  normalizeBroadcast,
  streamUrl,
  type Broadcast,
} from "../../../shared/streams";
import { AdminPortal } from "../../components/AdminPortal";
import { useAdminAuth } from "../../hooks/useAdminAuth";
import { adminFetch } from "../../authFetch";
import { navigate } from "../../router";
import { adminBroadcasts, saveBroadcast } from "./broadcastApi";
import { RecordingsAdmin } from "./RecordingsAdmin";
import "./streams.css";
import "./event-media.css";

export function StreamsAdmin() {
  const auth = useAdminAuth();
  const requestedRoom = new URLSearchParams(location.search).get("room");
  useEffect(() => {
    if (
      auth.status === "admin" &&
      requestedRoom &&
      /^[a-z0-9]{6,32}$/.test(requestedRoom)
    )
      navigate(`/s/${requestedRoom}?media=live#event-media`);
  }, [auth.status, requestedRoom]);
  if (auth.status !== "admin")
    return <AdminPortal returnToPath="/admin/lives" />;
  return (
    <main className="page streams-admin">
      <header className="stream-admin-heading">
        <div>
          <h1>Lives e gravações</h1>
          <p>
            Consulte as lives e gravações dos seus eventos. O player fica junto
            da scrim; as alterações dependem das suas permissões.
          </p>
        </div>
        <a className="button" href="/admin">
          Voltar para meus eventos
        </a>
      </header>
      {!auth.can("manageStreams") && (
        <p className="callout" role="status">
          Acesso de consulta. Peça ao super admin a permissão “Gerenciar lives e
          gravações” para alterar os links e replays.
        </p>
      )}
      <MediaOverview
        key={auth.email}
        superAdmin={auth.isSuperAdmin}
        canPublish={auth.can("publishRooms")}
        canEdit={auth.can("manageStreams")}
      />
    </main>
  );
}

function MediaOverview({
  superAdmin,
  canPublish,
  canEdit,
}: {
  superAdmin: boolean;
  canPublish: boolean;
  canEdit: boolean;
}) {
  const [rooms, setRooms] = useState<ScrimSummary[] | null>(null),
    [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [retry, setRetry] = useState(0),
    [busy, setBusy] = useState(false);
  const [homeOpen, setHomeOpen] = useState(false),
    [archiveOpen, setArchiveOpen] = useState(false);
  const [title, setTitle] = useState("Live do clube"),
    [links, setLinks] = useState([{ channel: "", label: "" }]);
  const locked = useRef(false);
  const editRef = useRef(canEdit && superAdmin);
  editRef.current = canEdit && superAdmin;
  const home = broadcasts.find((item) => item.roomId === null);
  useEffect(() => {
    const ctrl = new AbortController();
    setError("");
    setRooms(null);
    (async () => {
      try {
        const configs = await adminBroadcasts(ctrl.signal);
        const response = await adminFetch("/api/scrims?scope=admin", {
          cache: "no-store",
          signal: ctrl.signal,
        });
        const rows = await response.json();
        if (!response.ok || !Array.isArray(rows))
          throw new Error(
            rows?.error || "Não foi possível carregar os eventos.",
          );
        if (!ctrl.signal.aborted) {
          setRooms(rows);
          setBroadcasts(configs);
        }
      } catch (err) {
        if (!ctrl.signal.aborted) setError((err as Error).message);
      }
    })();
    return () => ctrl.abort();
  }, [retry]);
  useEffect(() => {
    if (!canEdit || !superAdmin) setHomeOpen(false);
  }, [canEdit, superAdmin]);
  function editHome() {
    if (!editRef.current) return;
    setTitle(home?.title ?? "Live do clube");
    setLinks(
      home?.channels.length
        ? home.channels.map((item) => ({
            channel: streamUrl(item),
            label: item.label,
          }))
        : [{ channel: "", label: "" }],
    );
    setHomeOpen(true);
    setError("");
    setNotice("");
  }
  async function write(
    config: Pick<Broadcast, "title" | "channels" | "enabled" | "promoteHome">,
  ) {
    if (locked.current || !editRef.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await saveBroadcast(null, home?.version ?? 0, config);
      setBroadcasts((items) => [
        ...items.filter((item) => item.roomId !== null),
        result,
      ]);
      setHomeOpen(false);
      setNotice(
        result.enabled
          ? "Live exibindo na página inicial."
          : "Live oculta da página inicial. Os links ficaram salvos.",
      );
    } catch (err) {
      setError((err as Error).message);
      if ((err as { status?: number }).status === 409) {
        setRetry((value) => value + 1);
        setHomeOpen(false);
      }
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await write(
        normalizeBroadcast({
          title,
          channels: links.filter(
            (item) => item.channel.trim() || item.label.trim(),
          ),
          enabled: true,
          promoteHome: false,
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }
  if (!rooms)
    return (
      <section className="card">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Tentar novamente
            </button>
          </>
        ) : (
          <p role="status">Carregando eventos…</p>
        )}
      </section>
    );
  return (
    <>
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
      <section
        className="event-media-directory"
        aria-labelledby="media-directory-title"
      >
        <h2 id="media-directory-title">Mídia dos eventos</h2>
        <p className="muted">
          Os links ao vivo e os vídeos gravados são configurados dentro de cada
          evento.
        </p>
        {rooms.length ? (
          <ul>
            {rooms.map((room) => {
              const config = broadcasts.find((item) => item.roomId === room.id);
              return (
                <li key={room.id}>
                  <div>
                    <h3>{room.title}</h3>
                    <p>
                      {config?.enabled
                        ? "Live exibindo neste evento"
                        : config?.channels.length
                          ? "Live oculta · links salvos"
                          : "Sem live cadastrada"}
                      {!room.access?.isPublic ? " · evento oculto" : ""}
                    </p>
                  </div>
                  <a
                    className="button"
                    href={`/s/${room.id}?media=live#event-media`}
                  >
                    Abrir lives e gravações
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="stream-visibility-empty">
            <p>
              <strong>Nenhum evento sob sua responsabilidade.</strong>
              <span>As lives e gravações dos seus eventos aparecerão aqui.</span>
            </p>
            <a href="/admin" className="button">
              Ver meus eventos
            </a>
          </div>
        )}
      </section>
      {superAdmin && (
        <section className="event-home-promotion">
          <div className="stream-overview-heading">
            <div>
              <h2>Divulgar uma live sem evento</h2>
              <p>
                Aparece direto na página inicial. Use esta opção só para
                divulgação do clube.
              </p>
              <strong className="event-media-status">
                {home?.enabled
                  ? "Exibindo na página inicial"
                  : home?.channels.length
                    ? "Oculta · links salvos"
                    : "Nenhuma live independente"}
              </strong>
            </div>
            {canEdit && (
              <div className="event-media-actions">
                <button type="button" disabled={busy} onClick={editHome}>
                  {home?.channels.length
                    ? "Editar links da página inicial"
                    : "Adicionar link na página inicial"}
                </button>
                {home?.channels.length ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void write({
                        title: home.title,
                        channels: home.channels,
                        enabled: !home.enabled,
                        promoteHome: false,
                      })
                    }
                  >
                    {busy
                      ? "Salvando…"
                      : home.enabled
                        ? "Ocultar da página inicial"
                        : "Exibir na página inicial"}
                  </button>
                ) : null}
              </div>
            )}
          </div>
          {canEdit && homeOpen && (
            <form
              className="event-live-form"
              onSubmit={(event) => void submit(event)}
            >
              <label>
                Título na página inicial
                <input
                  name="stream-title"
                  maxLength={100}
                  required
                  value={title}
                  disabled={busy}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              {links.map((item, index) => (
                <div className="event-live-link" key={index}>
                  <label>
                    Link {index + 1}
                    <input
                      aria-label={`Canal ${index + 1}`}
                      maxLength={300}
                      placeholder="Twitch, YouTube ou Kick"
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
                      aria-label={`Nome do canal ${index + 1}`}
                      maxLength={40}
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
                      disabled={busy}
                      onClick={() =>
                        setLinks((items) =>
                          items.filter((_, at) => at !== index),
                        )
                      }
                    >
                      Remover link {index + 1}
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                disabled={busy || links.length >= 6}
                onClick={() =>
                  setLinks((items) => [...items, { channel: "", label: "" }])
                }
              >
                Adicionar outra perspectiva
              </button>
              <div className="event-media-actions">
                <button className="primary" type="submit" disabled={busy}>
                  {busy ? "Salvando…" : "Salvar e exibir na página inicial"}
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => setHomeOpen(false)}
                >
                  Cancelar links
                </button>
              </div>
            </form>
          )}
        </section>
      )}
      <details
        className="event-general-archive"
        open={archiveOpen}
        onToggle={(event) => setArchiveOpen(event.currentTarget.open)}
      >
        <summary>Acervo geral de gravações</summary>
        <p className="muted">
          Para adicionar gravações de uma scrim, prefira o próprio evento. Este
          acervo reúne os registros que você pode administrar.
        </p>
        {archiveOpen && (
          <RecordingsAdmin
            rooms={rooms}
            superAdmin={superAdmin}
            canPublish={canPublish}
            canEdit={canEdit}
            target={null}
          />
        )}
      </details>
    </>
  );
}
