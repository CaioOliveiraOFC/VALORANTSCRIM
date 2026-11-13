import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ScrimSummary } from "../../../shared/protocol";
import {
  MAX_STREAM_CHANNELS,
  normalizeBroadcast,
  type Broadcast,
} from "../../../shared/streams";
import { adminFetch } from "../../authFetch";
import { AdminPortal } from "../../components/AdminPortal";
import { useAdminAuth } from "../../hooks/useAdminAuth";
import { StreamPlayer } from "./StreamPlayer";
import { parseBroadcasts } from "./useBroadcasts";
import "./streams.css";

async function request(path: string, options: RequestInit = {}) {
  const response = await adminFetch(path, { cache: "no-store", ...options });
  const body = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(body.error || "Não foi possível carregar as transmissões."),
      { status: response.status },
    );
  return body;
}
export function StreamsAdmin() {
  const auth = useAdminAuth();
  if (auth.status !== "admin")
    return <AdminPortal returnToPath="/admin/lives" />;
  return (
    <main className="page streams-admin">
      <header className="stream-admin-heading">
        <div>
          <h1>Transmissões</h1>
          <p>
            Junte a galera na mesma tela, mesmo com pontos de vista diferentes.
          </p>
        </div>
        <a href="/admin" className="button">
          Voltar para minhas salas
        </a>
      </header>
      {auth.can("editRoom") ? (
        <StreamsWorkspace
          key={auth.email}
          superAdmin={auth.isSuperAdmin}
          canPublish={auth.can("publishRooms")}
        />
      ) : (
        <section className="card">
          <h2>Seu acesso não permite configurar transmissões.</h2>
          <p>Peça ao super admin a permissão “Editar a sala”.</p>
        </section>
      )}
    </main>
  );
}
function StreamsWorkspace({
  superAdmin,
  canPublish,
}: {
  superAdmin: boolean;
  canPublish: boolean;
}) {
  const [rooms, setRooms] = useState<ScrimSummary[]>([]);
  const [configs, setConfigs] = useState<Broadcast[]>([]);
  const [selected, setSelected] = useState("");
  const [title, setTitle] = useState("Transmissão da Brasa");
  const [channels, setChannels] = useState([{ channel: "", label: "" }]);
  const [enabled, setEnabled] = useState(false),
    [promoteHome, setPromoteHome] = useState(false);
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0),
    [preview, setPreview] = useState<Broadcast | null>(null);
  const locked = useRef(false);
  function populate(key: string, available: Broadcast[]) {
    const existing = available.find((item) => (item.roomId ?? "home") === key);
    setSelected(key);
    setTitle(existing?.title ?? "Transmissão da Brasa");
    setEnabled(existing?.enabled ?? false);
    setPromoteHome(existing?.promoteHome ?? false);
    setVersion(existing?.version ?? 0);
    setPreview(null);
    setChannels(
      existing?.channels.length
        ? existing.channels.map((item) => ({
            ...item,
            channel: `https://www.twitch.tv/${item.channel}`,
          }))
        : [{ channel: "", label: "" }],
    );
    setError("");
    setNotice("");
  }
  useEffect(() => {
    const ctrl = new AbortController();
    setLoaded(false);
    setError("");
    (async () => {
      try {
        // Auth requests stay serialized by adminFetch, including cookie refresh.
        const configReply = await request("/api/admin/streams", {
          signal: ctrl.signal,
        });
        const roomReply = await request("/api/scrims?scope=admin", {
          signal: ctrl.signal,
        });
        const items = parseBroadcasts(configReply.broadcasts);
        if (!Array.isArray(roomReply))
          throw new Error("Lista de salas inválida.");
        if (ctrl.signal.aborted) return;
        setConfigs(items);
        setRooms(roomReply);
        const wanted = new URLSearchParams(location.search).get("room");
        const key = roomReply.some((item: ScrimSummary) => item.id === wanted)
          ? wanted!
          : superAdmin
            ? "home"
            : (roomReply[0]?.id ?? "");
        populate(key, items);
        setLoaded(true);
      } catch (err) {
        if (!ctrl.signal.aborted) setError((err as Error).message);
      }
    })();
    return () => ctrl.abort();
  }, [retry, superAdmin]);
  const room = rooms.find((item) => item.id === selected);
  const isHome = selected === "home";
  const canPromote = !isHome && !!room?.access?.isPublic && canPublish;
  function draft() {
    return normalizeBroadcast({
      title,
      channels: channels.filter(
        (item) => item.channel.trim() || item.label.trim(),
      ),
      enabled,
      promoteHome: !isHome && promoteHome,
    });
  }
  function move(index: number, offset: number) {
    setChannels((items) => {
      const next = [...items];
      [next[index], next[index + offset]] = [
        next[index + offset]!,
        next[index]!,
      ];
      return next;
    });
    setPreview(null);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!selected || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const config = draft();
      const result = await request("/api/admin/streams", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...config,
          roomId: isHome ? null : selected,
          expectedVersion: version,
        }),
      });
      const saved = parseBroadcasts([result])[0]!;
      const next = [
        ...configs.filter((item) => item.roomId !== saved.roomId),
        saved,
      ];
      setConfigs(next);
      setVersion(saved.version);
      setPreview(null);
      setNotice(
        saved.enabled
          ? "Transmissão publicada. Os espectadores recebem a atualização em até 10 segundos."
          : "Transmissão oculta. Os canais ficaram salvos para a próxima.",
      );
    } catch (err) {
      if ((err as { status?: number }).status === 409) {
        try {
          const result = await request("/api/admin/streams");
          const next = parseBroadcasts(result.broadcasts);
          setConfigs(next);
          populate(selected, next);
        } catch {
          setLoaded(false);
        }
      }
      setError((err as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  if (!loaded)
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
          <p role="status">Carregando suas transmissões…</p>
        )}
      </section>
    );
  if (!selected)
    return (
      <section className="card">
        <h2>Crie uma sala para transmitir.</h2>
        <p>Depois, volte aqui para adicionar os canais da Twitch.</p>
        <a href="/admin" className="button">
          Ir para minhas salas
        </a>
      </section>
    );
  return (
    <>
      <form
        className="stream-configuration"
        onSubmit={(event) => void save(event)}
      >
        <section className="stream-destination">
          <h2>Onde a galera vai assistir?</h2>
          <label>
            Local da transmissão
            <select
              name="stream-destination"
              disabled={busy}
              value={selected}
              onChange={(event) => populate(event.target.value, configs)}
            >
              {superAdmin && (
                <option value="home">Página inicial · sem evento</option>
              )}
              {rooms.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.title}
                  {item.access?.isPublic ? "" : " (sala oculta)"}
                </option>
              ))}
            </select>
          </label>
          <p>
            {isHome
              ? "O player e o chat aparecem direto na página inicial."
              : "O player e o chat ficam dentro desta sala, junto dos times, mapas e resultados."}
          </p>
          {!isHome && <a href={`/s/${selected}?live=1`}>Abrir a sala</a>}
        </section>
        <section className="stream-channel-editor">
          <h2>Quem vai transmitir?</h2>
          <label>
            Título
            <input
              name="stream-title"
              maxLength={100}
              required
              value={title}
              disabled={busy}
              onChange={(event) => {
                setTitle(event.target.value);
                setPreview(null);
              }}
            />
          </label>
          <ol className="stream-channel-list">
            {channels.map((item, index) => (
              <li key={index}>
                <div className="stream-channel-fields">
                  <label>
                    Canal da Twitch
                    <input
                      aria-label={`Canal ${index + 1}`}
                      placeholder="https://www.twitch.tv/seucanal"
                      value={item.channel}
                      maxLength={300}
                      disabled={busy}
                      onChange={(event) => {
                        setChannels((items) =>
                          items.map((entry, at) =>
                            at === index
                              ? { ...entry, channel: event.target.value }
                              : entry,
                          ),
                        );
                        setPreview(null);
                      }}
                    />
                  </label>
                  <label>
                    Nome de exibição <span className="muted">(opcional)</span>
                    <input
                      aria-label={`Nome do canal ${index + 1}`}
                      placeholder="Sua visão, narrador, POV…"
                      value={item.label}
                      maxLength={40}
                      disabled={busy}
                      onChange={(event) => {
                        setChannels((items) =>
                          items.map((entry, at) =>
                            at === index
                              ? { ...entry, label: event.target.value }
                              : entry,
                          ),
                        );
                        setPreview(null);
                      }}
                    />
                  </label>
                </div>
                <div className="stream-channel-actions">
                  <button
                    type="button"
                    aria-label={`Subir canal ${index + 1}`}
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Descer canal ${index + 1}`}
                    disabled={busy || index === channels.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    aria-label={`Remover canal ${index + 1}`}
                    onClick={() => {
                      setChannels((items) =>
                        items.filter((_, at) => at !== index),
                      );
                      setPreview(null);
                    }}
                  >
                    Remover
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="ghost"
            disabled={busy || channels.length >= MAX_STREAM_CHANNELS}
            onClick={() =>
              setChannels((items) => [...items, { channel: "", label: "" }])
            }
          >
            Adicionar canal
          </button>
          <p className="muted small">
            Até seis canais. A ordem acima será a ordem das setas. Cada
            espectador escolhe o seu.
          </p>
        </section>
        <section className="stream-publish">
          <h2>Pronto para a resenha?</h2>
          <label className="stream-checkbox">
            <input
              type="checkbox"
              name="stream-enabled"
              checked={enabled}
              disabled={busy}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>
              <strong>Exibir transmissão</strong>
              <small>
                Desative para tirar os players do site e manter os canais
                salvos.
              </small>
            </span>
          </label>
          {!isHome && (
            <label className="stream-checkbox">
              <input
                type="checkbox"
                name="stream-promote"
                checked={promoteHome}
                disabled={busy || (!canPromote && !promoteHome)}
                onChange={(event) => setPromoteHome(event.target.checked)}
              />
              <span>
                <strong>Divulgar também na página inicial</strong>
                <small>
                  {canPromote
                    ? "A galera vê um destaque na home e entra nesta sala para assistir."
                    : "Disponível para salas públicas e para quem pode publicar salas."}
                </small>
              </span>
            </label>
          )}
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
          <div className="stream-save-actions">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Salvando…" : "Salvar transmissão"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                try {
                  const value = draft();
                  if (!value.channels.length)
                    throw new Error("Adicione um canal para abrir a prévia.");
                  setPreview({
                    ...value,
                    enabled: true,
                    roomId: isHome ? null : selected,
                    version,
                  });
                  setError("");
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              Testar player e chat
            </button>
          </div>
          <p className="muted small">
            Não precisa de chave da Twitch. Basta iniciar a live no OBS ou no
            aplicativo que você já usa. Esta opção publica o player no site; ela
            não inicia uma live.
          </p>
        </section>
      </form>
      {preview && (
        <div className="stream-admin-preview">
          <div className="stream-preview-heading">
            <h2>Prévia só para você</h2>
            <button type="button" onClick={() => setPreview(null)}>
              Fechar prévia
            </button>
          </div>
          <StreamPlayer key={selected} broadcast={preview} />
        </div>
      )}
    </>
  );
}
