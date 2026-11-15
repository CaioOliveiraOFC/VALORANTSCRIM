import { useEffect, useRef, useState } from "react";
import {
  streamEmbeds,
  streamIdentity,
  streamPlatform,
  streamUrl,
  PLATFORM_NAMES,
  type Broadcast,
} from "../../../shared/streams";
import "./streams.css";

function ProviderVideo({
  channel,
  label,
  src,
  platform,
}: {
  channel: string;
  label: string;
  src: string;
  platform: string;
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
  const innerWidth = Math.max(width, platform === "twitch" ? 400 : 200),
    innerHeight = Math.max(
      (innerWidth * 9) / 16,
      platform === "twitch" ? 300 : 200,
    );
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

export function StreamPlayer({
  broadcast,
  compact = false,
}: {
  broadcast: Broadcast;
  compact?: boolean;
}) {
  const [selection, setSelection] = useState(() =>
    broadcast.channels[0] ? streamIdentity(broadcast.channels[0]) : "",
  );
  const [chatOpen, setChatOpen] = useState(!compact);
  const channels = broadcast.channels;
  const index = Math.max(
    0,
    channels.findIndex((item) => streamIdentity(item) === selection),
  );
  const current = channels[index];
  useEffect(() => {
    // Store both the initial channel and a replacement after removal. An empty
    // selection would otherwise follow the list order on the next poll.
    if (current && selection !== streamIdentity(current))
      setSelection(streamIdentity(current));
  }, [current ? streamIdentity(current) : null, selection]);
  if (!broadcast.enabled || !current) return null;
  const platform = streamPlatform(current),
    platformName = PLATFORM_NAMES[platform];
  const identity = streamIdentity(current);
  const embeds = streamEmbeds(current, location.hostname);
  const move = (offset: number) =>
    setSelection(
      streamIdentity(
        channels[(index + offset + channels.length) % channels.length]!,
      ),
    );
  return (
    <section
      className={`stream-theater${compact ? " is-compact" : ""}`}
      aria-label={broadcast.title}
    >
      <header className="stream-heading">
        <div>
          <h2>{broadcast.title}</h2>
          <p>
            {current.kind === "video"
              ? "Gravação da transmissão"
              : "Escolha de onde acompanhar a resenha."}
          </p>
        </div>
        {embeds.chat && (
          <button
            type="button"
            className="ghost"
            aria-expanded={chatOpen}
            onClick={() => setChatOpen((value) => !value)}
          >
            {chatOpen ? "Ocultar chat" : "Mostrar chat"}
          </button>
        )}
      </header>
      <div
        className={`stream-stage${chatOpen && embeds.chat ? " has-chat" : ""}`}
      >
        {embeds.player ? (
          <ProviderVideo
            key={identity}
            channel={identity}
            label={current.label}
            src={embeds.player}
            platform={platform}
          />
        ) : (
          <div className="stream-external-replay">
            <h3>Gravação na {platformName}</h3>
            <p>Assista a esta gravação no player da plataforma.</p>
            <a
              className="button primary"
              href={streamUrl(current)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Assistir na {platformName}
            </a>
          </div>
        )}
        {chatOpen && embeds.chat && (
          <iframe
            className="stream-chat"
            key={`chat-${identity}`}
            src={embeds.chat}
            title={`Chat ${platform === "youtube" ? "do YouTube" : "da Twitch"} de ${current.label}`}
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
          <span className="stream-platform-label">{platformName}</span>
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
        <a href={streamUrl(current)} target="_blank" rel="noopener noreferrer">
          Abrir {platform === "youtube" ? "no YouTube" : `na ${platformName}`}
        </a>
      </div>
      <p className="stream-help">
        {current.kind === "video"
          ? "Este link aponta para uma gravação específica. A disponibilidade do vídeo depende da plataforma."
          : "Aperte play para assistir. Se o canal estiver offline, escolha outro pelas setas."}
        {platform === "kick" && current.kind !== "video"
          ? " Para conversar no chat da Kick, use “Abrir na Kick”."
          : " A conversa da galera continua no Discord."}
      </p>
    </section>
  );
}
