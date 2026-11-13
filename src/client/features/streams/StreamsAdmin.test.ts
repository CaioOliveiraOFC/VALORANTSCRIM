import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Broadcast } from "../../../shared/streams";
const mocks = vi.hoisted(() => ({
  auth: {
    status: "admin",
    email: "owner@example.test",
    isSuperAdmin: true,
    can: (_key: string): boolean => true,
  },
}));
vi.mock("../../hooks/useAdminAuth", () => ({ useAdminAuth: () => mocks.auth }));
vi.mock("../../authFetch", () => ({
  adminFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));
import { StreamsAdmin } from "./StreamsAdmin";
let renderer: ReactTestRenderer | undefined;
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const room = {
  id: "publicroom",
  title: "Minha sala",
  access: { isPublic: true, deletedAt: null, accessVersion: 1 },
};
const home: Broadcast = {
  roomId: null,
  title: "Resenha do Master",
  channels: [{ channel: "masterpfi", label: "Master" }],
  enabled: true,
  promoteHome: false,
  version: 1,
};
async function flush() {
  await act(async () => {
    for (let index = 0; index < 15; index++) await Promise.resolve();
  });
}
async function mount() {
  await act(async () => {
    renderer = create(createElement(StreamsAdmin));
  });
  await flush();
}
const named = (name: string) =>
  renderer!.root.findByProps({ "aria-label": name });
async function click(name: string) {
  act(() => named(name).props.onClick());
  await flush();
}
beforeEach(() => {
  mocks.auth = {
    status: "admin",
    email: "owner@example.test",
    isSuperAdmin: true,
    can: () => true,
  };
  vi.stubGlobal("location", { search: "", hostname: "localhost" });
});
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});
function backend(initial: Broadcast[] = []) {
  const state = { records: initial, writes: [] as any[], fail: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options) => {
      if (options?.method === "PUT") {
        const body = JSON.parse(options.body);
        state.writes.push(body);
        if (state.fail)
          return response(
            {
              error:
                state.fail === 409
                  ? "A transmissão mudou em outra aba."
                  : "Falha ao salvar.",
            },
            state.fail,
          );
        const saved = { ...body, version: body.expectedVersion + 1 };
        state.records = [
          ...state.records.filter((item) => item.roomId !== saved.roomId),
          saved,
        ];
        return response(saved);
      }
      return response(
        String(url).includes("/api/scrims")
          ? [room]
          : { broadcasts: state.records },
      );
    }),
  );
  return state;
}
it("adds and shows in one action, then hides and shows from the overview without a second save", async () => {
  const state = backend();
  await mount();
  act(() =>
    named("Canal 1").props.onChange({
      target: { value: "https://twitch.tv/masterpfi" },
    }),
  );
  act(() =>
    renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }),
  );
  await flush();
  expect(state.writes[0]).toMatchObject({
    roomId: null,
    enabled: true,
    expectedVersion: 0,
    channels: [{ channel: "masterpfi", label: "masterpfi" }],
  });
  expect(renderer!.root.findAllByType("form")).toHaveLength(0);
  await click("Ocultar Transmissão da Brasa");
  expect(state.writes[1]).toMatchObject({ enabled: false, expectedVersion: 1 });
  await click("Exibir Transmissão da Brasa");
  expect(state.writes[2]).toMatchObject({ enabled: true, expectedVersion: 2 });
  expect(renderer!.root.findAllByType("form")).toHaveLength(0);
});
it("hides saved content even with invalid unfinished editor fields, and keeps those edits separate", async () => {
  const state = backend([home]);
  await mount();
  await click(`Editar canais de ${home.title}`);
  expect(
    renderer!.root.findByProps({ name: "stream-destination" }).props.disabled,
  ).toBe(true);
  act(() =>
    named("Canal 1").props.onChange({ target: { value: "invalid/not-saved" } }),
  );
  act(() =>
    renderer!.root
      .findByProps({ name: "stream-title" })
      .props.onChange({ target: { value: "Título não salvo" } }),
  );
  await click(`Ocultar ${home.title}`);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toMatchObject({
    enabled: false,
    title: home.title,
    channels: home.channels,
    expectedVersion: 1,
  });
  expect(named("Canal 1").props.value).toBe("invalid/not-saved");
  expect(renderer!.root.findByProps({ name: "stream-title" }).props.value).toBe(
    "Título não salvo",
  );
  act(() =>
    named("Canal 1").props.onChange({ target: { value: "masterpfi" } }),
  );
  act(() =>
    renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }),
  );
  await flush();
  expect(state.writes[1]).toMatchObject({
    expectedVersion: 2,
    title: "Título não salvo",
    enabled: true,
  });
});
it("does not change the displayed state or retry automatically when a visibility save fails", async () => {
  const state = backend([home]);
  state.fail = 502;
  await mount();
  await click(`Ocultar ${home.title}`);
  expect(state.writes).toHaveLength(1);
  expect(named(`Ocultar ${home.title}`).props.disabled).toBe(false);
  expect(
    renderer!.root.findAllByProps({ "aria-label": `Exibir ${home.title}` }),
  ).toHaveLength(0);
  expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(1);
});
it("reloads a conflict without attaching a fresh version to an old channels draft", async () => {
  const state = backend([home]);
  await mount();
  await click(`Editar canais de ${home.title}`);
  act(() =>
    named("Canal 1").props.onChange({ target: { value: "old-draft" } }),
  );
  state.records = [
    {
      ...home,
      version: 3,
      enabled: false,
      channels: [{ channel: "riotgames", label: "Outra visão" }],
    },
  ];
  state.fail = 409;
  await click(`Ocultar ${home.title}`);
  expect(state.writes).toHaveLength(1);
  expect(named("Canal 1").props.value).toContain("riotgames");
  expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(1);
  state.fail = 0;
  act(() =>
    renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }),
  );
  await flush();
  expect(state.writes[1]).toMatchObject({
    expectedVersion: 3,
    channels: [{ channel: "riotgames", label: "Outra visão" }],
  });
});
it("can hide a promoted event after publication permission was removed", async () => {
  mocks.auth.can = (key) => key !== "publishRooms";
  const event = { ...home, roomId: "publicroom", promoteHome: true };
  const state = backend([event]);
  await mount();
  await click(`Ocultar ${home.title}`);
  expect(state.writes[0]).toMatchObject({
    roomId: "publicroom",
    enabled: false,
    promoteHome: false,
  });
});
it("offers only owned event destinations to organizers and removes controls when editing permission is revoked", async () => {
  mocks.auth.isSuperAdmin = false;
  backend();
  await mount();
  expect(
    renderer!.root.findAllByType("option").map((node) => node.props.value),
  ).toEqual(["publicroom"]);
  mocks.auth.can = () => false;
  act(() => renderer!.update(createElement(StreamsAdmin)));
  expect(renderer!.root.findAllByType("form")).toHaveLength(0);
  expect(
    renderer!.root.findAllByProps({ "aria-label": "Transmissões em exibição" }),
  ).toHaveLength(0);
});
