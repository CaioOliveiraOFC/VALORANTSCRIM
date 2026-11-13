/** Only Twitch channel names are persisted; arbitrary embed URLs are never accepted. */
export interface StreamChannel {
  channel: string;
  label: string;
}
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
  const channels = value.channels.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("Canal inválido.");
    const input = item as Record<string, unknown>;
    if (
      Object.keys(input).some((key) => !["channel", "label"].includes(key)) ||
      typeof input.label !== "string" ||
      input.label.trim().length > 40 ||
      /[\u0000-\u001f\u007f]/.test(input.label)
    )
      throw new Error("O nome de exibição deve ter até 40 caracteres.");
    const channel = twitchChannel(input.channel);
    return { channel, label: input.label.trim() || channel };
  });
  if (new Set(channels.map((item) => item.channel)).size !== channels.length)
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
