import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StreamPlayer } from "./StreamPlayer";
import type { Broadcast } from "../../../shared/streams";
let renderer: ReactTestRenderer | undefined;
const broadcast: Broadcast = {
  roomId: null,
  title: "Brasa",
  enabled: true,
  promoteHome: false,
  version: 1,
  channels: [
    { channel: "masterpfi", label: "Master" },
    { channel: "riotgames", label: "Outra visão" },
  ],
};
beforeEach(() =>
  vi.stubGlobal("location", { hostname: "valorantscrim.vercel.app" }),
);
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});
const sources = () =>
  renderer!.root.findAllByType("iframe").map((node) => node.props.src);
it("switches one video and its chat together, wraps both directions, and keeps only the current embeds mounted", () => {
  act(() => {
    renderer = create(createElement(StreamPlayer, { broadcast }));
  });
  expect(sources()).toHaveLength(2);
  expect(sources().every((src) => src.includes("masterpfi"))).toBe(true);
  act(() =>
    renderer!.root
      .findByProps({ "aria-label": "Próximo canal" })
      .props.onClick(),
  );
  expect(sources()).toHaveLength(2);
  expect(sources().every((src) => src.includes("riotgames"))).toBe(true);
  act(() =>
    renderer!.root
      .findByProps({ "aria-label": "Próximo canal" })
      .props.onClick(),
  );
  expect(sources().every((src) => src.includes("masterpfi"))).toBe(true);
  act(() =>
    renderer!.root
      .findByProps({ "aria-label": "Canal anterior" })
      .props.onClick(),
  );
  expect(sources().every((src) => src.includes("riotgames"))).toBe(true);
});
it("preserves the viewer selection across config refreshes and falls back only when that channel is removed", () => {
  act(() => {
    renderer = create(createElement(StreamPlayer, { broadcast }));
  });
  act(() =>
    renderer!.root
      .findByProps({ "aria-label": "Próximo canal" })
      .props.onClick(),
  );
  act(() =>
    renderer!.update(
      createElement(StreamPlayer, {
        broadcast: {
          ...broadcast,
          version: 2,
          channels: [...broadcast.channels].reverse(),
        },
      }),
    ),
  );
  expect(sources().every((src) => src.includes("riotgames"))).toBe(true);
  act(() =>
    renderer!.update(
      createElement(StreamPlayer, {
        broadcast: {
          ...broadcast,
          version: 3,
          channels: [broadcast.channels[0]!],
        },
      }),
    ),
  );
  expect(sources().every((src) => src.includes("masterpfi"))).toBe(true);
});
it("can hide chat without replacing the video and removes all embeds when disabled", () => {
  act(() => {
    renderer = create(createElement(StreamPlayer, { broadcast }));
  });
  const video = renderer!.root.findAllByType("iframe")[0];
  act(() =>
    renderer!.root.findByProps({ "aria-expanded": true }).props.onClick(),
  );
  expect(sources()).toHaveLength(1);
  expect(renderer!.root.findAllByType("iframe")[0]).toBe(video);
  act(() =>
    renderer!.update(
      createElement(StreamPlayer, {
        broadcast: { ...broadcast, enabled: false },
      }),
    ),
  );
  expect(sources()).toHaveLength(0);
});

it('keeps the initially watched channel across reordering, including after falling back from a removal', () => {
  act(() => { renderer = create(createElement(StreamPlayer, { broadcast })); });
  act(() => renderer!.update(createElement(StreamPlayer, { broadcast: { ...broadcast, channels: [...broadcast.channels].reverse() } })));
  expect(sources().every(src => src.includes('masterpfi'))).toBe(true);
  act(() => renderer!.update(createElement(StreamPlayer, { broadcast: { ...broadcast, channels: [broadcast.channels[1]!] } })));
  expect(sources().every(src => src.includes('riotgames'))).toBe(true);
  act(() => renderer!.update(createElement(StreamPlayer, { broadcast })));
  expect(sources().every(src => src.includes('riotgames'))).toBe(true);
});
