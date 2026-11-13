import { expect, it } from "vitest";
import { normalizeBroadcast, twitchChannel, twitchEmbeds } from "./streams.js";
it("accepts a channel or Twitch channel URL and persists a normalized channel, never an arbitrary URL", () => {
  for (const value of [
    "masterpfi",
    "MASTERPFI",
    "https://twitch.tv/masterpfi",
    "https://www.twitch.tv/masterpfi/?ref=share",
    "twitch.tv/masterpfi",
  ])
    expect(twitchChannel(value)).toBe("masterpfi");
  for (const value of [
    "https://evil.test/masterpfi",
    "https://twitch.tv.evil.test/masterpfi",
    "https://twitch.tv@evil.test/masterpfi",
    "//evil.test",
    "javascript:alert(1)",
    "https://twitch.tv/videos/1234",
    "https://twitch.tv/directory",
    "https://twitch.tv/masterpfi/clip/1234",
    "https://twitch.tv:4433/masterpfi",
    "<iframe>",
  ])
    expect(() => twitchChannel(value)).toThrow();
});
it("validates the number, uniqueness and display labels of channels", () => {
  const config = {
    title: " Noite Brasa ",
    channels: [{ channel: "https://twitch.tv/masterpfi", label: "" }],
    enabled: true,
    promoteHome: false,
  };
  expect(normalizeBroadcast(config)).toMatchObject({
    title: "Noite Brasa",
    channels: [{ channel: "masterpfi", label: "masterpfi" }],
  });
  expect(() => normalizeBroadcast({ ...config, channels: [] })).toThrow();
  expect(
    normalizeBroadcast({ ...config, enabled: false, channels: [] }).channels,
  ).toEqual([]);
  expect(() =>
    normalizeBroadcast({
      ...config,
      channels: [...config.channels, ...config.channels],
    }),
  ).toThrow();
  expect(() =>
    normalizeBroadcast({
      ...config,
      channels: [{ channel: "masterpfi", label: "a".repeat(41) }],
    }),
  ).toThrow();
});
it("uses the actual host as the Twitch parent for both embeds without hardcoding a deploy domain", () => {
  for (const host of [
    "valorantscrim.vercel.app",
    "preview-123.vercel.app",
    "localhost",
  ]) {
    const embeds = twitchEmbeds("masterpfi", host);
    const player = new URL(embeds.player),
      chat = new URL(embeds.chat);
    expect(player.origin).toBe("https://player.twitch.tv");
    expect(player.searchParams.get("parent")).toBe(host);
    expect(player.searchParams.get("autoplay")).toBe("false");
    expect(chat.origin).toBe("https://www.twitch.tv");
    expect(chat.searchParams.get("parent")).toBe(host);
    expect(chat.searchParams.has("darkpopout")).toBe(true);
  }
  expect(() => twitchEmbeds("masterpfi", "evil.test/?parent=other")).toThrow();
});
