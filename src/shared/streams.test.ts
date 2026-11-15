import { expect, it } from "vitest";
import { normalizeBroadcast, twitchChannel, twitchEmbeds } from "./streams.js";
import {
  parseStreamLink,
  streamEmbeds,
  streamIdentity,
  replaySource,
  streamUrl,
} from "./streams.js";
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

it("detects Twitch, Kick and YouTube links without requiring a manual provider choice", () => {
  expect(parseStreamLink("https://kick.com/MASTERPFI")).toEqual({
    platform: "kick",
    channel: "masterpfi",
  });
  for (const url of [
    "https://www.youtube.com/watch?v=aqz-KE-bpKQ&feature=share",
    "https://youtu.be/aqz-KE-bpKQ",
    "https://youtube.com/live/aqz-KE-bpKQ?si=example",
  ])
    expect(parseStreamLink(url)).toEqual({
      platform: "youtube",
      channel: "aqz-KE-bpKQ",
    });
  const config = normalizeBroadcast({
    title: "Três visões",
    enabled: true,
    promoteHome: false,
    channels: [
      { channel: "masterpfi", label: "Twitch" },
      { channel: "https://kick.com/masterpfi", label: "Kick" },
      { channel: "https://youtube.com/live/aqz-KE-bpKQ", label: "YouTube" },
    ],
  });
  expect(new Set(config.channels.map(streamIdentity)).size).toBe(3);
  expect(config.channels[0]).toEqual({ channel: "masterpfi", label: "Twitch" });
});
it("rejects spoofed providers, channel pages, arbitrary embeds and duplicate aliases", () => {
  for (const url of [
    "https://youtube.com.evil.test/watch?v=aqz-KE-bpKQ",
    "https://youtube.com/@someone/live",
    "https://youtu.be/aqz-KE-bpKQ/extra",
    "https://kick.com/directory",
    "http://kick.com/masterpfi",
    "https://evil@kick.com/masterpfi",
    "https://youtube.com:8443/watch?v=aqz-KE-bpKQ",
    '<iframe src="https://youtube.com"></iframe>',
  ])
    expect(() => parseStreamLink(url)).toThrow();
  expect(() =>
    normalizeBroadcast({
      title: "Duplicate",
      enabled: true,
      promoteHome: false,
      channels: [
        { channel: "https://youtu.be/aqz-KE-bpKQ", label: "" },
        { channel: "https://youtube.com/live/aqz-KE-bpKQ", label: "" },
      ],
    }),
  ).toThrow();
});
it("builds trusted provider embeds, keeps replay IDs fixed, and never uses live chat on recordings", () => {
  const yt = replaySource("https://youtu.be/aqz-KE-bpKQ");
  const tw = replaySource("https://twitch.tv/videos/123456789");
  expect(tw).toMatchObject({
    platform: "twitch",
    kind: "video",
    channel: "123456789",
  });
  expect(streamEmbeds(tw, "club.example")).toMatchObject({ chat: null });
  expect(
    new URL(streamEmbeds(tw, "club.example").player!).searchParams.get("video"),
  ).toBe("v123456789");
  expect(streamEmbeds(yt, "club.example").player).toContain(
    "youtube-nocookie.com/embed/aqz-KE-bpKQ",
  );
  expect(streamEmbeds(yt, "club.example").chat).toBe(null);
  expect(streamUrl(tw)).toBe("https://www.twitch.tv/videos/123456789");
  const kick = {
    channel: "masterpfi",
    platform: "kick" as const,
    label: "Kick",
  };
  expect(streamEmbeds(kick, "club.example")).toEqual({
    player: "https://player.kick.com/masterpfi?autoplay=false&muted=false",
    chat: null,
  });
  for (const mutable of [
    "https://twitch.tv/masterpfi",
    "https://kick.com/masterpfi",
  ])
    expect(() => replaySource(mutable)).toThrow();
  const vod = replaySource(
    "https://kick.com/masterpfi/videos/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  expect(streamEmbeds(vod, "club.example").player).toBe(null);
  expect(streamUrl(vod)).toBe(
    "https://kick.com/masterpfi/videos/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
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
