import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../authFetch", () => ({
  adminFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));
import { RecordingsPage } from "./RecordingsPage";
let renderer: ReactTestRenderer | undefined;
const recording = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  roomId: null,
  title: "Replay",
  source: {
    platform: "youtube",
    kind: "video",
    channel: "aqz-KE-bpKQ",
    label: "YouTube",
  },
  isPublic: true,
  version: 1,
  createdAt: 1000,
};
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("removes the currently playing replay when a visibility refresh no longer authorizes it", async () => {
  vi.useFakeTimers();
  let allowed = true;
  const events = new EventTarget();
  vi.stubGlobal("location", {
    search: `?replay=${recording.id}`,
    hostname: "club.example",
  });
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
  vi.stubGlobal("addEventListener", vi.fn());
  vi.stubGlobal("removeEventListener", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      String(url).includes(recording.id)
        ? response(
            allowed ? recording : { error: "Gravação não encontrada." },
            allowed ? 200 : 404,
          )
        : response({ recordings: [recording], total: 1, nextOffset: null }),
    ),
  );
  await act(async () => {
    renderer = create(createElement(RecordingsPage));
  });
  await flush();
  expect(renderer!.root.findAllByType("iframe")).toHaveLength(1);
  allowed = false;
  await act(async () => {
    vi.advanceTimersByTime(10000);
  });
  await flush();
  expect(renderer!.root.findAllByType("iframe")).toHaveLength(0);
  expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(1);
});
