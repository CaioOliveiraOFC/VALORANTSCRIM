import { useBroadcasts } from "./useBroadcasts";
import { StreamPlayer } from "./StreamPlayer";
import { navigate } from "../../router";
import type { MouseEvent } from "react";

function internal(event: MouseEvent<HTMLAnchorElement>) {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  event.preventDefault();
  navigate(event.currentTarget.getAttribute("href") ?? "/");
}

export function HomeStreams() {
  const { broadcasts } = useBroadcasts();
  const home = broadcasts.find((item) => item.roomId === null);
  const events = broadcasts.filter((item) => item.roomId !== null);
  if (!home && !events.length) return null;
  return (
    <section className="stream-home" aria-label="Transmissões da Brasa">
      {home && <StreamPlayer key="home" broadcast={home} />}
      {events.length > 0 && (
        <div className="stream-events">
          <h2>Acompanhe com a galera</h2>
          <ul>
            {events.map((item) => (
              <li key={item.roomId}>
                <a href={`/s/${item.roomId}?live=1`} onClick={internal}>
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.roomTitle || "Sala VCT"} · {item.channels.length}{" "}
                      {item.channels.length === 1 ? "canal" : "canais"}
                    </small>
                  </span>
                  <span className="stream-watch-link">
                    Assistir ao VCT <span aria-hidden="true">↗</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
export function RoomStreams({
  roomId,
  canEdit,
}: {
  roomId: string;
  canEdit: boolean;
}) {
  const { broadcasts, error } = useBroadcasts(roomId);
  const broadcast = broadcasts[0];
  if (!broadcast && !canEdit && !error) return null;
  return (
    <div className="stream-room" id="transmissao">
      {broadcast && <StreamPlayer broadcast={broadcast} />}
      {error && (
        <p className="muted small" role="status">
          {error}
        </p>
      )}
      {canEdit && (
        <a
          className="stream-manage-link"
          href={`/admin/lives?room=${roomId}`}
          onClick={internal}
        >
          {broadcast
            ? "Configurar transmissão desta sala"
            : "Adicionar transmissão da Twitch"}
        </a>
      )}
    </div>
  );
}
