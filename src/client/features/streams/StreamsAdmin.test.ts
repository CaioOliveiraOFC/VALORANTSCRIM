import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
async function flush() {
  await act(async () => {
    for (let index = 0; index < 15; index++) await Promise.resolve();
  });
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
it("publishes normalized channel names, then uses the returned version for the next save", async () => {
  const writes: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options) => {
      if (options?.method === "PUT") {
        const body = JSON.parse(options.body);
        writes.push(body);
        return response({ ...body, version: writes.length });
      }
      return response(
        String(url).includes("/api/scrims") ? [room] : { broadcasts: [] },
      );
    }),
  );
  await act(async () => {
    renderer = create(createElement(StreamsAdmin));
  });
  await flush();
  act(() =>
    renderer!.root
      .findByProps({ "aria-label": "Canal 1" })
      .props.onChange({ target: { value: "https://twitch.tv/masterpfi" } }),
  );
  act(() =>
    renderer!.root
      .findByProps({ name: "stream-enabled" })
      .props.onChange({ target: { checked: true } }),
  );
  for (let index = 0; index < 2; index++) {
    act(() =>
      renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }),
    );
    await flush();
  }
  expect(writes).toHaveLength(2);
  expect(writes[0]).toMatchObject({
    roomId: null,
    enabled: true,
    expectedVersion: 0,
    channels: [{ channel: "masterpfi", label: "masterpfi" }],
  });
  expect(writes[1].expectedVersion).toBe(1);
});
it("limits an ordinary organizer to event destinations and hides configuration without edit permission", async () => {
  mocks.auth.isSuperAdmin = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      response(
        String(url).includes("/api/scrims") ? [room] : { broadcasts: [] },
      ),
    ),
  );
  await act(async () => {
    renderer = create(createElement(StreamsAdmin));
  });
  await flush();
  expect(
    renderer!.root.findAllByType("option").map((node) => node.props.value),
  ).toEqual(["publicroom"]);
  mocks.auth.can = () => false;
  act(() => renderer!.update(createElement(StreamsAdmin)));
  expect(renderer!.root.findAllByType("form")).toHaveLength(0);
});
