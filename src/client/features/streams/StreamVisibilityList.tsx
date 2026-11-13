import type { Broadcast } from "../../../shared/streams";
import type { ScrimSummary } from "../../../shared/protocol";

export function VisibilityIcon({ hidden = false }: { hidden?: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {hidden && <path d="m3 3 18 18" />}
    </svg>
  );
}

export function StreamVisibilityList({
  broadcasts,
  rooms,
  busy,
  toggling,
  canAdd,
  onAdd,
  onEdit,
  onToggle,
}: {
  broadcasts: Broadcast[];
  rooms: ScrimSummary[];
  busy: boolean;
  toggling: string | null;
  canAdd: boolean;
  onAdd: () => void;
  onEdit: (key: string) => void;
  onToggle: (broadcast: Broadcast) => void;
}) {
  const visible = broadcasts.filter((item) => item.enabled);
  const hidden = broadcasts.filter((item) => !item.enabled);
  const card = (item: Broadcast) => {
    const key = item.roomId ?? "home";
    const room = rooms.find((entry) => entry.id === item.roomId);
    const privateRoom = item.roomId !== null && !room?.access?.isPublic;
    const changing = toggling === key;
    const destination =
      item.roomId === null
        ? "Página inicial"
        : room?.title || item.roomTitle || "Sala VCT";
    return (
      <li key={key}>
        <article
          className={`stream-visibility-card${item.enabled ? " is-showing" : ""}`}
          aria-label={item.title}
          aria-busy={changing}
        >
          <div className="stream-visibility-info">
            <p className="stream-visibility-destination">
              {destination}
              {item.promoteHome && !privateRoom && item.roomId !== null
                ? " · destaque na página inicial"
                : ""}
            </p>
            <h3>{item.title}</h3>
            <p className="stream-visibility-channels">
              {item.channels.length
                ? item.channels.map((channel) => channel.label).join(" · ")
                : "Adicione um canal para poder exibir."}
            </p>
          </div>
          <div className="stream-visibility-state">
            <span
              className={`stream-display-status ${item.enabled ? "is-showing" : ""}`}
            >
              <span aria-hidden="true" />
              {item.enabled ? "Em exibição" : "Oculta do site"}
            </span>
            {privateRoom && <small>Sala oculta · só administração</small>}
          </div>
          <div className="stream-visibility-actions">
            <button
              type="button"
              data-stream-action={key}
              className={item.enabled ? "stream-hide-action" : "primary"}
              disabled={busy || (!item.enabled && !item.channels.length)}
              aria-label={`${item.enabled ? "Ocultar" : "Exibir"} ${item.title}`}
              onClick={() => onToggle(item)}
            >
              <VisibilityIcon hidden={item.enabled} />
              {changing
                ? item.enabled
                  ? "Ocultando…"
                  : "Exibindo…"
                : item.enabled
                  ? "Ocultar do site"
                  : "Exibir no site"}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => onEdit(key)}
              aria-label={`Editar canais de ${item.title}`}
            >
              Editar canais
            </button>
            {item.enabled && (
              <a href={item.roomId ? `/s/${item.roomId}?live=1` : "/"}>
                Ver onde aparece
              </a>
            )}
          </div>
        </article>
      </li>
    );
  };
  return (
    <section
      className="stream-visibility-overview"
      aria-labelledby="stream-overview-title"
    >
      <div className="stream-overview-heading">
        <div>
          <h2 id="stream-overview-title">O que aparece no site</h2>
          <p>Exiba ou oculte com um clique. Os canais ficam salvos.</p>
        </div>
        {canAdd && (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={onAdd}
          >
            Adicionar transmissão
          </button>
        )}
      </div>
      <section
        className="stream-visibility-group"
        aria-label="Transmissões em exibição"
      >
        <h3 className="stream-group-title">
          Em exibição <span>{visible.length}</span>
        </h3>
        {visible.length ? (
          <ul>{visible.map(card)}</ul>
        ) : (
          <div className="stream-visibility-empty">
            <VisibilityIcon hidden />
            <p>
              <strong>Nenhuma transmissão em exibição.</strong>
              <span>
                {hidden.length
                  ? "Use “Exibir no site” em uma transmissão abaixo."
                  : "Adicione um canal da Twitch para começar."}
              </span>
            </p>
          </div>
        )}
      </section>
      {hidden.length > 0 && (
        <section
          className="stream-visibility-group"
          aria-label="Transmissões ocultas"
        >
          <h3 className="stream-group-title">
            Guardadas para depois <span>{hidden.length}</span>
          </h3>
          <ul>{hidden.map(card)}</ul>
        </section>
      )}
      <p className="stream-visibility-footnote">
        Ocultar retira o player e o chat do site em até 10 segundos. Sua live na
        Twitch continua normalmente.
      </p>
    </section>
  );
}
