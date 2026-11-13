import { useEffect, useRef, useState } from "react";
import { twitchEmbeds, type Broadcast } from "../../../shared/streams";
import "./streams.css";

function TwitchVideo({
  channel,
  label,
  src,
}: {
  channel: string;
  label: string;
  src: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const measure = () => setWidth(node.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  }, []);
  // Twitch requires a 400×300 viewport. Fit that viewport into small phones,
  // rather than sending the embed an unsupported 280×158 viewport.
  const innerWidth = Math.max(width, 400),
    innerHeight = Math.max((innerWidth * 9) / 16, 300);
  const scale = width > 0 ? width / innerWidth : 1;
  return (
    <div
      className="stream-video"
      ref={container}
      style={
        width ? { height: innerHeight * scale, aspectRatio: "auto" } : undefined
      }
    >
      <iframe
        key={channel}
        src={src}
        title={`Transmissão de ${label}`}
        style={{
          width: innerWidth,
          height: innerHeight,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}

export function StreamPlayer({ broadcast }: { broadcast: Broadcast }) {
  const [selection, setSelection] = useState(() => broadcast.channels[0]?.channel ?? "");
  const [chatOpen, setChatOpen] = useState(true);
  const channels = broadcast.channels;
  const index = Math.max(
    0,
    channels.findIndex((item) => item.channel === selection),
  );
  const current = channels[index];
  useEffect(() => {
    // Store both the initial channel and a replacement after removal. An empty
    // selection would otherwise follow the list order on the next poll.
    if (current && selection !== current.channel) setSelection(current.channel);
  }, [current?.channel, selection]);
  if (!broadcast.enabled || !current) return null;
  const embeds = twitchEmbeds(current.channel, location.hostname);
  const move = (offset: number) =>
    setSelection(
      channels[(index + offset + channels.length) % channels.length]!.channel,
    );
  return (
    <section className="stream-theater" aria-label={broadcast.title}>
      <header className="stream-heading">
        <div>
          <h2>{broadcast.title}</h2>
          <p>Escolha de onde acompanhar a resenha.</p>
        </div>
        <button
          type="button"
          className="ghost"
          aria-expanded={chatOpen}
          onClick={() => setChatOpen((value) => !value)}
        >
          {chatOpen ? "Ocultar chat" : "Mostrar chat"}
        </button>
      </header>
      <div className={`stream-stage${chatOpen ? " has-chat" : ""}`}>
        <TwitchVideo
          channel={current.channel}
          label={current.label}
          src={embeds.player}
        />
        {chatOpen && (
          <iframe
            className="stream-chat"
            key={`chat-${current.channel}`}
            src={embeds.chat}
            title={`Chat da Twitch de ${current.label}`}
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
      </div>
      <div className="stream-switcher">
        <button
          type="button"
          aria-label="Canal anterior"
          disabled={channels.length < 2}
          onClick={() => move(-1)}
        >
          ‹
        </button>
        <div className="stream-current" aria-live="polite">
          <strong>{current.label}</strong>
          <span>
            {index + 1} de {channels.length} canais
          </span>
        </div>
        <button
          type="button"
          aria-label="Próximo canal"
          disabled={channels.length < 2}
          onClick={() => move(1)}
        >
          ›
        </button>
        <a
          href={`https://www.twitch.tv/${current.channel}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Abrir na Twitch
        </a>
      </div>
      <p className="stream-help">
        Aperte play para assistir. Se o canal estiver offline, escolha outro
        pelas setas. A conversa da galera continua no Discord.
      </p>
    </section>
  );
}
