import { createElement } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Broadcast } from "../../../shared/streams";
const mocks = vi.hoisted(() => ({ public: [] as any[] }));
vi.mock("./useBroadcasts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useBroadcasts")>();
  return {
    ...actual,
    useBroadcasts: () => ({ broadcasts: mocks.public, error: "" }),
  };
});
vi.mock("../../authFetch", () => ({
  adminFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));
import { EventMedia } from "./EventMedia";
let renderer: ReactTestRenderer | undefined;
let windowEvents: EventTarget;
const record = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  roomId: "room123",
  title: "Replay deste evento",
  source: {
    platform: "youtube",
    kind: "video",
    channel: "aqz-KE-bpKQ",
    label: "Master",
  },
  isPublic: true,
  version: 1,
  createdAt: 1,
};
const config: Broadcast = {
  roomId: "room123",
  title: "Nome antigo",
  channels: [{ channel: "masterpfi", label: "Master" }],
  enabled: true,
  promoteHome: false,
  version: 1,
};
const props = {
  roomId: "room123",
  roomTitle: "Churras da laje",
  phase: "live",
  canEdit: true,
  canPublish: true,
  isPublic: true,
};
const text = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === "string" ? child : text(child)))
    .join("");
const button = (label: string) =>
  renderer!.root.findAllByType("button").find((node) => text(node) === label)!;
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}
async function mount(overrides = {}) {
  await act(async () => {
    renderer = create(createElement(EventMedia, { ...props, ...overrides }));
  });
  await flush();
}
beforeEach(() => {
  mocks.public = [];
  vi.useFakeTimers();
  windowEvents = new EventTarget();
  const documentEvents = new EventTarget();
  vi.stubGlobal("location", { search: "", hostname: "club.example" });
  vi.stubGlobal(
    "addEventListener",
    windowEvents.addEventListener.bind(windowEvents),
  );
  vi.stubGlobal(
    "removeEventListener",
    windowEvents.removeEventListener.bind(windowEvents),
  );
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener:
      documentEvents.removeEventListener.bind(documentEvents),
  });
});
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function backend(initial: Broadcast[] = [], replayRecord = record) {
  const state = { records: initial, writes: [] as any[], conflict: false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options) => {
      if (options?.method === "PUT") {
        const body = JSON.parse(options.body);
        state.writes.push(body);
        if (state.conflict)
          return response({ error: "A live mudou em outra aba." }, 409);
        const saved = { ...body, version: body.expectedVersion + 1 };
        state.records = [saved];
        return response(saved);
      }
      if (String(url).startsWith("/api/admin/streams"))
        return response({ broadcasts: state.records });
      if (String(url).includes(`/api/streams/recordings/${record.id}`))
        return response(replayRecord);
      return response({ recordings: [replayRecord], total: 1, nextOffset: null });
    }),
  );
  return state;
}
it("adds the first live directly inside its event with no destination or container step", async () => {
  const state = backend();
  await mount();
  act(() => button("Adicionar link ao vivo").props.onClick());
  act(() =>
    renderer!.root
      .findByProps({ "aria-label": "Link ao vivo 1" })
      .props.onChange({ target: { value: "https://twitch.tv/masterpfi" } }),
  );
  act(() =>
    renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }),
  );
  await flush();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toMatchObject({
    roomId: "room123",
    title: "Churras da laje",
    enabled: true,
    expectedVersion: 0,
  });
  expect(renderer!.root.findAllByType("select")).toHaveLength(0);
  expect(renderer!.root.findAllByType("iframe")).toHaveLength(1); // Compact: chat starts closed.
  expect(text(renderer!.root)).toContain("Exibindo live neste evento");
});
it("revalidates another admin edit without overwriting the draft or attaching its new version to it", async () => {
  const state = backend([config]);
  await mount();
  act(() => button("Editar links da live").props.onClick());
  act(() =>
    renderer!.root
      .findByProps({ "aria-label": "Link ao vivo 1" })
      .props.onChange({ target: { value: "https://twitch.tv/unfinished" } }),
  );
  state.records = [
    {
      ...config,
      version: 3,
      enabled: false,
      channels: [{ channel: "riotgames", label: "Outro" }],
    },
  ];
  act(() => { windowEvents.dispatchEvent(new Event("focus")); });
  await flush();
  expect(text(renderer!.root)).toContain("Live oculta · links salvos");
  expect(
    renderer!.root.findByProps({ "aria-label": "Link ao vivo 1" }).props.value,
  ).toBe("https://twitch.tv/unfinished");
  state.conflict = true;
  act(() =>
    renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }),
  );
  await flush();
  expect(state.writes[0].expectedVersion).toBe(1);
  expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(1);
});
it("hides saved live links without publishing incomplete editor fields", async () => {
  const state = backend([config]);
  await mount();
  act(() => button("Editar links da live").props.onClick());
  act(() =>
    renderer!.root
      .findByProps({ "aria-label": "Link ao vivo 1" })
      .props.onChange({ target: { value: "invalid" } }),
  );
  act(() => button("Ocultar live").props.onClick());
  await flush();
  expect(state.writes[0]).toMatchObject({
    enabled: false,
    channels: config.channels,
    expectedVersion: 1,
  });
});
it("prefers recordings on technical pause, but respects an explicit live navigation", async () => {
  backend([config]);
  await mount({ phase: "paused", canEdit: false });
  expect(
    renderer!.root.findByProps({ id: "event-recordings-tab" }).props[
      "aria-selected"
    ],
  ).toBe(true);
  act(() => renderer!.unmount());
  renderer = undefined;
  vi.stubGlobal("location", {
    search: "?media=live",
    hostname: "club.example",
  });
  await mount({ phase: "paused", canEdit: false });
  expect(
    renderer!.root.findByProps({ id: "event-live-tab" }).props["aria-selected"],
  ).toBe(true);
});
it("plays a recording inline for viewers and offers no admin forms", async () => {
  backend();
  await mount({ phase: "finished", canEdit: false });
  const replayButton = renderer!.root
    .findAllByType("button")
    .find((node) => text(node).includes(record.title))!;
  act(() => replayButton.props.onClick());
  await flush();
  expect(renderer!.root.findAllByType("iframe")).toHaveLength(1);
  expect(renderer!.root.findAllByType("iframe")[0]!.props.src).toContain(
    "youtube-nocookie.com/embed/aqz-KE-bpKQ",
  );
  expect(renderer!.root.findAllByType("form")).toHaveLength(0);
});
it.each(["?media=live", "?live=1"])("opens the live player of a finished event from explicit links (%s)", async (search) => {
  backend([config]);
  mocks.public = [config];
  vi.stubGlobal("location", { search, hostname: "club.example" });
  await mount({ phase: "finished", canEdit: false });
  expect(renderer!.root.findByProps({ id: "event-live-tab" }).props["aria-selected"]).toBe(true);
  expect(renderer!.root.findAllByType("iframe")).toHaveLength(1);
});
it("lets an owner consult hidden live links and private recordings without editing", async () => {
  const state = backend([{ ...config, enabled: false }], { ...record, isPublic: false });
  await mount({ canView: true, canEdit: false });
  expect(text(renderer!.root)).toContain("Acesso de consulta.");
  expect(text(renderer!.root)).toContain("Live oculta · links salvos");
  expect(renderer!.root.findAllByType("a").some(node => node.props.href === "https://www.twitch.tv/masterpfi")).toBe(true);
  expect(button("Editar links da live")).toBeUndefined();
  expect(button("Exibir live")).toBeUndefined();
  act(() => renderer!.root.findByProps({ id: "event-recordings-tab" }).props.onClick());
  expect(text(renderer!.root)).toContain("Replay deste evento");
  expect(text(renderer!.root)).toContain("Oculta");
  act(() => renderer!.root.findAllByType("button").find(node => text(node).includes(record.title))!.props.onClick());
  await flush();
  expect(renderer!.root.findAllByType("iframe")).toHaveLength(1);
  expect(renderer!.root.findAllByType("form")).toHaveLength(0);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith("/api/admin/streams"))).toBe(true);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith("/api/admin/stream-recordings?"))).toBe(true);
  expect(state.writes).toHaveLength(0);
});
it("closes live edits on permission revocation while retaining owner consultation", async () => {
  const state = backend([config]);
  await mount({ canView: true });
  act(() => button("Editar links da live").props.onClick());
  const staleSubmit = renderer!.root.findByType("form").props.onSubmit;
  const staleToggle = button("Ocultar live").props.onClick;
  const staleBegin = button("Editar links da live").props.onClick;
  act(() => renderer!.update(createElement(EventMedia, { ...props, canView: true, canEdit: false })));
  act(() => {
    staleBegin();
    staleToggle();
    staleSubmit({ preventDefault() {} });
  });
  await flush();
  expect(text(renderer!.root)).toContain("Acesso de consulta.");
  expect(text(renderer!.root)).toContain("Exibindo live neste evento");
  expect(renderer!.root.findAllByType("form")).toHaveLength(0);
  expect(state.writes).toHaveLength(0);
});
