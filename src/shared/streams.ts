/** Only validated provider identifiers are persisted; arbitrary embed HTML is never accepted. */
export type StreamPlatform = "twitch" | "youtube" | "kick";
export interface StreamChannel {
  channel: string;
  label: string;
  /** Absent on existing Twitch records, retained for backward compatibility. */
  platform?: StreamPlatform;
  kind?: "video";
}
export const PLATFORM_NAMES: Record<StreamPlatform, string> = {
  twitch: "Twitch",
  youtube: "YouTube",
  kick: "Kick",
};
export interface Broadcast {
  roomId: string | null;
  roomTitle?: string;
  title: string;
  channels: StreamChannel[];
  enabled: boolean;
  promoteHome: boolean;
  version: number;
}
export const MAX_STREAM_CHANNELS = 6;
const CHANNEL = /^[a-z0-9_]{1,25}$/;
const FORBIDDEN_CHANNELS = new Set([
  "videos",
  "directory",
  "downloads",
  "settings",
  "subscriptions",
  "inventory",
  "search",
  "login",
  "signup",
  "embed",
  "moderator",
  "payments",
  "wallet",
  "turbo",
  "jobs",
  "p",
]);
export function twitchChannel(value: unknown): string {
  if (typeof value !== "string" || value.length > 300)
    throw new Error("Cole o link de um canal da Twitch ou digite o nome dele.");
  let channel = value.trim();
  if (/^(?:https:\/\/)?(?:www\.|m\.)?twitch\.tv\//i.test(channel)) {
    const url = new URL(
      channel.startsWith("https://") ? channel : `https://${channel}`,
    );
    if (
      !["twitch.tv", "www.twitch.tv", "m.twitch.tv"].includes(url.hostname) ||
      url.port ||
      url.username ||
      url.password
    )
      throw new Error("Use apenas um canal de twitch.tv.");
    channel = url.pathname.replace(/^\//, "").replace(/\/$/, "");
  }
  channel = channel.toLowerCase();
  if (!CHANNEL.test(channel) || FORBIDDEN_CHANNELS.has(channel))
    throw new Error(
      "Use o canal da Twitch, sem links de clipes, vídeos ou outras páginas.",
    );
  return channel;
}

export function streamPlatform(source: StreamChannel): StreamPlatform {
  return source.platform ?? "twitch";
}
export function streamIdentity(source: StreamChannel): string {
  return `${streamPlatform(source)}:${streamPlatform(source) === "youtube" ? "video" : (source.kind ?? "live")}:${source.channel}`;
}
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const KICK_CHANNEL = /^[a-z0-9_][a-z0-9_-]{0,24}$/;
const KICK_VIDEO =
  /^[a-z0-9_][a-z0-9_-]{0,24}\/videos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function canonicalSource(
  channel: string,
  platform: StreamPlatform,
  video = false,
): Omit<StreamChannel, "label"> {
  const valid =
    platform === "youtube"
      ? YOUTUBE_ID.test(channel)
      : platform === "kick"
        ? video
          ? KICK_VIDEO.test(channel)
          : KICK_CHANNEL.test(channel) && !FORBIDDEN_CHANNELS.has(channel)
        : video
          ? /^[1-9][0-9]{0,19}$/.test(channel)
          : CHANNEL.test(channel) && !FORBIDDEN_CHANNELS.has(channel);
  if (!valid)
    throw new Error("O link não identifica uma live ou gravação válida.");
  return {
    channel,
    ...(platform !== "twitch" || video ? { platform } : {}),
    ...(video ? { kind: "video" as const } : {}),
  };
}
/** Live YouTube links use a video ID too; no provider API/account is needed. */
export function parseStreamLink(value: unknown): Omit<StreamChannel, "label"> {
  if (
    typeof value !== "string" ||
    value.length > 300 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error("Cole um link da Twitch, YouTube ou Kick.");
  const input = value.trim();
  if (
    CHANNEL.test(input.toLowerCase()) &&
    !FORBIDDEN_CHANNELS.has(input.toLowerCase())
  )
    return canonicalSource(input.toLowerCase(), "twitch");
  let url: URL;
  try {
    url = new URL(/^https:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new Error("Cole um link válido da Twitch, YouTube ou Kick.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new Error(
      "Use um link HTTPS da plataforma, sem portas ou credenciais.",
    );
  const host = url.hostname.toLowerCase(),
    path = url.pathname.replace(/\/$/, "");
  if (["twitch.tv", "www.twitch.tv", "m.twitch.tv"].includes(host)) {
    const video = /^\/videos\/([1-9][0-9]{0,19})$/.exec(path);
    if (video) return canonicalSource(video[1]!, "twitch", true);
    return canonicalSource(path.slice(1).toLowerCase(), "twitch");
  }
  if (["kick.com", "www.kick.com"].includes(host))
    return canonicalSource(
      path.slice(1).toLowerCase(),
      "kick",
      path.includes("/videos/"),
    );
  if (
    [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "youtu.be",
      "www.youtu.be",
      "www.youtube-nocookie.com",
    ].includes(host)
  ) {
    const id = host.endsWith("youtu.be")
      ? /^\/([A-Za-z0-9_-]{11})$/.exec(path)?.[1]
      : path === "/watch"
        ? url.searchParams.get("v")
        : /^\/(?:live|embed|shorts)\/([A-Za-z0-9_-]{11})$/.exec(path)?.[1];
    if (!id)
      throw new Error(
        "No YouTube, cole o link da live ou do vídeo, não o link do canal.",
      );
    return canonicalSource(id, "youtube");
  }
  throw new Error("Use links da Twitch, YouTube ou Kick.");
}
export function normalizeStreamSource(item: unknown): StreamChannel {
  if (!item || typeof item !== "object" || Array.isArray(item))
    throw new Error("Canal inválido.");
  const input = item as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !["channel", "label", "platform", "kind"].includes(key),
    ) ||
    typeof input.channel !== "string" ||
    typeof input.label !== "string" ||
    input.label.trim().length > 40 ||
    /[\u0000-\u001f\u007f]/.test(input.label)
  )
    throw new Error("O nome de exibição deve ter até 40 caracteres.");
  if (input.kind !== undefined && input.kind !== "video")
    throw new Error("Tipo de transmissão inválido.");
  let source: Omit<StreamChannel, "label">;
  if (input.platform !== undefined) {
    if (!["twitch", "youtube", "kick"].includes(String(input.platform)))
      throw new Error("Plataforma inválida.");
    source = canonicalSource(
      input.channel,
      input.platform as StreamPlatform,
      input.kind === "video",
    );
  } else {
    if (input.kind !== undefined)
      throw new Error("Informe a plataforma da gravação.");
    source = parseStreamLink(input.channel);
  }
  const platform = source.platform ?? "twitch";
  return {
    ...source,
    label:
      input.label.trim() ||
      (platform === "youtube"
        ? "YouTube"
        : source.kind === "video"
          ? `Gravação na ${PLATFORM_NAMES[platform]}`
          : source.channel),
  };
}
export function streamUrl(source: StreamChannel): string {
  const platform = streamPlatform(source);
  canonicalSource(source.channel, platform, source.kind === "video");
  if (platform === "youtube")
    return `https://www.youtube.com/watch?v=${source.channel}`;
  if (platform === "kick") return `https://kick.com/${source.channel}`;
  return `https://www.twitch.tv/${source.kind === "video" ? "videos/" : ""}${source.channel}`;
}
/** A replay must identify a specific video, never a mutable live channel URL. */
export function replaySource(value: unknown, label = ""): StreamChannel {
  const source = normalizeStreamSource({ channel: value, label });
  if (streamPlatform(source) !== "youtube" && source.kind !== "video")
    throw new Error(
      "Cole o link da gravação específica; o link do canal pode mostrar outra live depois.",
    );
  return { ...source, platform: streamPlatform(source), kind: "video" };
}
export function normalizeBroadcast(
  value: Record<string, unknown>,
): Pick<Broadcast, "title" | "channels" | "enabled" | "promoteHome"> {
  if (
    typeof value.title !== "string" ||
    !value.title.trim() ||
    value.title.trim().length > 100 ||
    /[\u0000-\u001f\u007f]/.test(value.title)
  )
    throw new Error("Dê um título de até 100 caracteres à transmissão.");
  if (
    typeof value.enabled !== "boolean" ||
    typeof value.promoteHome !== "boolean" ||
    !Array.isArray(value.channels) ||
    value.channels.length > MAX_STREAM_CHANNELS
  )
    throw new Error("Revise a publicação e os canais da transmissão.");
  const channels = value.channels.map(normalizeStreamSource);
  if (new Set(channels.map(streamIdentity)).size !== channels.length)
    throw new Error("Cada canal deve aparecer uma única vez.");
  if (value.enabled && !channels.length)
    throw new Error(
      "Adicione pelo menos um canal antes de exibir a transmissão.",
    );
  return {
    title: value.title.trim(),
    channels,
    enabled: value.enabled,
    promoteHome: value.promoteHome,
  };
}
export function twitchEmbeds(channel: string, hostname: string) {
  if (twitchChannel(channel) !== channel || !/^[a-z0-9.-]+$/i.test(hostname))
    throw new Error("Endereço de transmissão inválido.");
  const player = new URL("https://player.twitch.tv/");
  player.search = new URLSearchParams({
    channel,
    parent: hostname,
    autoplay: "false",
    muted: "false",
  }).toString();
  const chat = new URL(`https://www.twitch.tv/embed/${channel}/chat`);
  chat.search = new URLSearchParams({
    parent: hostname,
    darkpopout: "",
  }).toString();
  return { player: player.href, chat: chat.href };
}

export function streamEmbeds(
  source: StreamChannel,
  hostname: string,
): { player: string | null; chat: string | null } {
  if (!/^[a-z0-9.-]+$/i.test(hostname)) throw new Error("Hostname inválido.");
  const platform = streamPlatform(source);
  canonicalSource(source.channel, platform, source.kind === "video");
  if (platform === "youtube")
    return {
      player: `https://www.youtube-nocookie.com/embed/${source.channel}?autoplay=0&playsinline=1&rel=0`,
      chat:
        source.kind === "video"
          ? null
          : `https://www.youtube.com/live_chat?${new URLSearchParams({ v: source.channel, embed_domain: hostname, dark_theme: "1" })}`,
    };
  if (platform === "kick")
    return {
      player:
        source.kind === "video"
          ? null
          : `https://player.kick.com/${source.channel}?autoplay=false&muted=false`,
      chat: null,
    };
  if (source.kind === "video")
    return {
      player: `https://player.twitch.tv/?${new URLSearchParams({ video: `v${source.channel}`, parent: hostname, autoplay: "false", muted: "false" })}`,
      chat: null,
    };
  return twitchEmbeds(source.channel, hostname);
}
