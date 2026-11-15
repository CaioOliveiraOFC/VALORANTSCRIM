import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../authFetch", () => ({
  adminFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));
import { RecordingsAdmin } from "./RecordingsAdmin";
let renderer: ReactTestRenderer | undefined;
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
async function flush() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});
it("creates a replay independently of the live channel configuration and keeps its title and source", async () => {
  const writes: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) => {
      if (options?.method === "POST") {
        const body = JSON.parse(options.body);
        writes.push(body);
        return response({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          roomId: null,
          title: body.title,
          source: {
            channel: "123456789",
            label: "Master",
            platform: "twitch",
            kind: "video",
          },
          isPublic: body.isPublic,
          version: 1,
          createdAt: 1000,
        });
      }
      return response({ recordings: [], total: 0, nextOffset: null });
    }),
  );
  await act(async () => {
    renderer = create(
      createElement(RecordingsAdmin, {
        rooms: [],
        superAdmin: true,
        canPublish: true,
        target: {
          roomId: null,
          title: "Resenha",
          source: { channel: "masterpfi", label: "Master" },
        },
      }),
    );
  });
  await flush();
  expect(
    renderer!.root.findByProps({ name: "recording-url" }).props.value,
  ).toBe("");
  act(() =>
    renderer!.root
      .findByProps({ name: "recording-url" })
      .props.onChange({
        target: { value: "https://twitch.tv/videos/123456789" },
      }),
  );
  act(() =>
    renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }),
  );
  await flush();
  expect(writes).toEqual([
    {
      roomId: null,
      title: "Resenha",
      url: "https://twitch.tv/videos/123456789",
      label: "Master",
      isPublic: true,
    },
  ]);
  expect(renderer!.root.findAllByType("form")).toHaveLength(0);
  expect(
    renderer!.root
      .findAllByType("a")
      .some(
        (a) =>
          a.props.href ===
          "/gravacoes?replay=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ),
  ).toBe(true);
});
it("uses a YouTube video ID as the replay link and keeps hidden-room recordings private", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response({ recordings: [], total: 0, nextOffset: null })),
  );
  await act(async () => {
    renderer = create(
      createElement(RecordingsAdmin, {
        rooms: [
          {
            id: "hiddenroom",
            title: "Hidden",
            access: { isPublic: false, accessVersion: 1, deletedAt: null },
          } as any,
        ],
        superAdmin: false,
        canPublish: true,
        target: {
          roomId: "hiddenroom",
          title: "YT",
          source: { channel: "aqz-KE-bpKQ", label: "YT", platform: "youtube" },
        },
      }),
    );
  });
  await flush();
  expect(
    renderer!.root.findByProps({ name: "recording-url" }).props.value,
  ).toBe("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
  expect(
    renderer!.root.findByProps({ name: "recording-public" }).props.disabled,
  ).toBe(true);
  expect(
    renderer!.root.findByProps({ name: "recording-public" }).props.checked,
  ).toBe(false);
});
