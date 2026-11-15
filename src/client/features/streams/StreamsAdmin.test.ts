import { createElement } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
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
const text = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === "string" ? child : text(child)))
    .join("");
const button = (label: string) =>
  renderer!.root.findAllByType("button").find((node) => text(node) === label)!;
async function flush() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}
async function mount() {
  await act(async () => {
    renderer = create(createElement(StreamsAdmin));
  });
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
          return response({ error: "Falha ao salvar." }, state.fail);
        const saved = { ...body, version: body.expectedVersion + 1 };
        state.records = [
          ...state.records.filter((r) => r.roomId !== saved.roomId),
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
it("opens as an event directory instead of making another broadcast container", async () => {
  backend([{ ...home, roomId: room.id }]);
  await mount();
  expect(text(renderer!.root)).toContain("Live exibindo neste evento");
  expect(
    renderer!.root
      .findAllByType("a")
      .some(
        (node) => node.props.href === "/s/publicroom?media=live#event-media",
      ),
  ).toBe(true);
  expect(renderer!.root.findAllByType("form")).toHaveLength(0);
  expect(renderer!.root.findAllByType("select")).toHaveLength(0);
});
it("keeps the independent home live only for the super admin, with direct save and hide", async () => {
  const state = backend();
  await mount();
  act(() => button("Adicionar link na página inicial").props.onClick());
  act(() =>
    renderer!.root
      .findByProps({ "aria-label": "Canal 1" })
      .props.onChange({ target: { value: "https://twitch.tv/masterpfi" } }),
  );
  act(() =>
    renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }),
  );
  await flush();
  expect(state.writes[0]).toMatchObject({
    roomId: null,
    title: "Live do clube",
    enabled: true,
    expectedVersion: 0,
  });
  act(() => button("Ocultar da página inicial").props.onClick());
  await flush();
  expect(state.writes[1]).toMatchObject({
    roomId: null,
    enabled: false,
    expectedVersion: 1,
    channels: [{ channel: "masterpfi", label: "masterpfi" }],
  });
});
it("does not publish unfinished home edits when hiding a saved live", async () => {
  const state = backend([home]);
  await mount();
  act(() => button("Editar links da página inicial").props.onClick());
  act(() =>
    renderer!.root
      .findByProps({ "aria-label": "Canal 1" })
      .props.onChange({ target: { value: "invalid/not-saved" } }),
  );
  act(() => button("Ocultar da página inicial").props.onClick());
  await flush();
  expect(state.writes[0]).toMatchObject({
    enabled: false,
    title: home.title,
    channels: home.channels,
  });
});
it("does not offer home controls to ordinary organizers and removes the overview when edit permission is revoked", async () => {
  mocks.auth.isSuperAdmin = false;
  backend();
  await mount();
  expect(text(renderer!.root)).not.toContain("Divulgar uma live sem evento");
  expect(renderer!.root.findAllByType("form")).toHaveLength(0);
  mocks.auth.can = () => false;
  act(() => renderer!.update(createElement(StreamsAdmin)));
  expect(text(renderer!.root)).toContain(
    "Seu acesso não permite configurar lives.",
  );
  expect(
    renderer!.root
      .findAllByType("a")
      .some((node) => node.props.href.includes("/s/publicroom")),
  ).toBe(false);
});
it("keeps the confirmed home status when a direct hide request fails", async () => {
  const state = backend([home]);
  state.fail = 502;
  await mount();
  act(() => button("Ocultar da página inicial").props.onClick());
  await flush();
  expect(text(renderer!.root)).toContain("Exibindo na página inicial");
  expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(1);
});
