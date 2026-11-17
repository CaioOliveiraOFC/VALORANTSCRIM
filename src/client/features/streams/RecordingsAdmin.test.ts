import { createElement } from "react";
import {
  act,
  create,
  type ReactTestRenderer,
  type ReactTestInstance,
} from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../authFetch", () => ({
  adminFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));
import { RecordingsAdmin } from "./RecordingsAdmin";
import type { StreamRecording } from "../../../shared/recordings";
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
    renderer!.root.findByProps({ name: "recording-url" }).props.onChange({
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

const roomA = { id: "eventaaa", title: "Evento A", access: { isPublic: true } };
const roomB = { id: "eventbbb", title: "Evento B", access: { isPublic: true } };
const recording = (
  id: string,
  roomId: string,
  title: string,
): StreamRecording => ({
  id,
  roomId,
  title,
  source: {
    channel: "123456789",
    label: "Master",
    platform: "twitch",
    kind: "video",
  },
  isPublic: true,
  version: 1,
  createdAt: 1000,
});
const text = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === "string" ? child : text(child)))
    .join("");
it("filters initial and paginated requests to the event and never renders foreign recordings", async () => {
  const first = recording(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    roomA.id,
    "Primeira de A",
  );
  const second = recording(
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    roomA.id,
    "Segunda de A",
  );
  const foreign = recording(
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    roomB.id,
    "Privada de B",
  );
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      requests.push(String(url));
      const more =
        new URL(String(url), "http://localhost").searchParams.get("offset") ===
        "24";
      return response({
        recordings: more ? [second, foreign] : [first, foreign],
        total: 25,
        nextOffset: more ? null : 24,
      });
    }),
  );
  await act(async () => {
    renderer = create(
      createElement(RecordingsAdmin, {
        rooms: [roomA, roomB],
        superAdmin: true,
        canPublish: true,
        target: null,
        roomId: roomA.id,
        compact: true,
      }),
    );
  });
  await flush();
  expect(text(renderer!.root)).toContain("Primeira de A");
  expect(text(renderer!.root)).not.toContain("Privada de B");
  act(() =>
    renderer!.root
      .findAllByType("button")
      .find((button) => text(button) === "Ver mais gravações")!
      .props.onClick(),
  );
  await flush();
  expect(text(renderer!.root)).toContain("Segunda de A");
  expect(text(renderer!.root)).not.toContain("Privada de B");
  expect(requests).toEqual([
    "/api/admin/stream-recordings?offset=0&roomId=eventaaa",
    "/api/admin/stream-recordings?offset=24&roomId=eventaaa",
  ]);
});
it("fixes the destination to the event, ignores a foreign target and notifies inline playback and refresh", async () => {
  const saved = recording(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    roomA.id,
    "Evento A",
  );
  const writes: any[] = [],
    onChange = vi.fn(),
    onPlay = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) => {
      if (options?.method === "POST") {
        writes.push(JSON.parse(options.body));
        return response(saved);
      }
      if (options?.method === "PUT")
        return response({ ...saved, isPublic: false, version: 2 });
      return response({ recordings: [], total: 0, nextOffset: null });
    }),
  );
  await act(async () => {
    renderer = create(
      createElement(RecordingsAdmin, {
        rooms: [roomA, roomB],
        superAdmin: true,
        canPublish: true,
        roomId: roomA.id,
        compact: true,
        onChange,
        onPlay,
        target: {
          roomId: roomB.id,
          title: "Foreign title",
          source: {
            channel: "aqz-KE-bpKQ",
            label: "Foreign source",
            platform: "youtube",
          },
        },
      }),
    );
  });
  await flush();
  expect(renderer!.root.findAllByType("select")).toHaveLength(0);
  expect(
    renderer!.root.findByProps({ name: "recording-title" }).props.value,
  ).toBe("Evento A");
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
  expect(writes[0]).toMatchObject({
    roomId: roomA.id,
    title: "Evento A",
    isPublic: true,
  });
  expect(onChange).toHaveBeenCalledTimes(1);
  act(() =>
    renderer!.root
      .findAllByType("button")
      .find((button) => text(button) === "Assistir gravação")!
      .props.onClick(),
  );
  expect(onPlay).toHaveBeenCalledWith(saved);
  act(() =>
    renderer!.root
      .findByProps({ "aria-label": "Ocultar replay Evento A" })
      .props.onClick(),
  );
  await flush();
  expect(onChange).toHaveBeenCalledTimes(2);
});
it("does not apply an old event response after the room scope changes", async () => {
  const first = recording(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    roomA.id,
    "Privada antiga",
  );
  const next = recording(
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    roomB.id,
    "Evento atual",
  );
  let release!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      String(url).includes("roomId=eventaaa")
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : response({ recordings: [next], total: 1, nextOffset: null }),
    ),
  );
  const common = {
    rooms: [roomA, roomB],
    superAdmin: true,
    canPublish: true,
    target: null,
    compact: true,
  };
  await act(async () => {
    renderer = create(
      createElement(RecordingsAdmin, { ...common, roomId: roomA.id }),
    );
  });
  await flush();
  act(() =>
    renderer!.update(
      createElement(RecordingsAdmin, { ...common, roomId: roomB.id }),
    ),
  );
  await flush();
  await act(async () => {
    release(response({ recordings: [first], total: 1, nextOffset: null }));
  });
  await flush();
  expect(text(renderer!.root)).toContain("Evento atual");
  expect(text(renderer!.root)).not.toContain("Privada antiga");
});
it("keeps private replay playback and pagination available in read-only mode", async () => {
  const first = { ...recording("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", roomA.id, "Replay privado"), isPublic: false };
  const second = recording("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", roomA.id, "Segunda parte");
  const onPlay = vi.fn();
  const writes: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (options?.method) writes.push(options.method);
    const more = String(url).includes("offset=24");
    return response({ recordings: more ? [second] : [first], total: 25, nextOffset: more ? null : 24 });
  }));
  await act(async () => {
    renderer = create(createElement(RecordingsAdmin, {
      rooms: [roomA], superAdmin: false, canPublish: false, canEdit: false,
      target: null, roomId: roomA.id, compact: true, onPlay,
    }));
  });
  await flush();
  expect(text(renderer!.root)).toContain("Replay privado");
  expect(text(renderer!.root)).toContain("Oculta");
  expect(renderer!.root.findAllByType("form")).toHaveLength(0);
  const buttons = () => renderer!.root.findAllByType("button");
  expect(buttons().some(node => text(node).startsWith("Adicionar") || text(node).includes("Exibir replay"))).toBe(false);
  act(() => buttons().find(node => text(node) === "Assistir gravação")!.props.onClick());
  expect(onPlay).toHaveBeenCalledWith(first);
  act(() => buttons().find(node => text(node) === "Ver mais gravações")!.props.onClick());
  await flush();
  expect(text(renderer!.root)).toContain("Segunda parte");
  expect(writes).toHaveLength(0);
});
it("closes replay editing and blocks stale add, save and visibility callbacks after revocation", async () => {
  const first = recording("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", roomA.id, "Minha gravação");
  const writes: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    if (options?.method) writes.push(options.method);
    return response({ recordings: [first], total: 1, nextOffset: null });
  }));
  const common = { rooms: [roomA], superAdmin: false, canPublish: true, target: null, roomId: roomA.id, compact: true };
  await act(async () => { renderer = create(createElement(RecordingsAdmin, { ...common, canEdit: true })); });
  await flush();
  const staleBegin = renderer!.root.findAllByType("button").find(node => text(node) === "Adicionar gravação")!.props.onClick;
  act(() => staleBegin());
  const staleSave = renderer!.root.findByType("form").props.onSubmit;
  const staleToggle = renderer!.root.findByProps({ "aria-label": "Ocultar replay Minha gravação" }).props.onClick;
  act(() => renderer!.update(createElement(RecordingsAdmin, { ...common, canEdit: false })));
  act(() => {
    staleBegin();
    staleSave({ preventDefault() {} });
    staleToggle();
  });
  await flush();
  expect(text(renderer!.root)).toContain("Minha gravação");
  expect(renderer!.root.findAllByType("form")).toHaveLength(0);
  expect(renderer!.root.findAllByProps({ "aria-label": "Ocultar replay Minha gravação" })).toHaveLength(0);
  expect(writes).toHaveLength(0);
});
