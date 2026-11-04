import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: { status: 'viewer', email: undefined as string | undefined, canDeleteRooms: false } }));
vi.mock('../hooks/useAdminAuth', () => ({ useAdminAuth: () => mocks.auth }));
import { Home } from './Home';
let renderer: ReactTestRenderer | undefined;
let windowEvents: EventTarget;
let documentEvents: EventTarget;
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join('');
const room = { id: 'abc123', title: 'Sala pública', createdAt: 1, updatedAt: 1, phase: 'setup', teams: ['Time A', 'Time B'], score: [0, 0], maps: [] };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
async function flush() { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); }); }
async function mount() { await act(async () => { renderer = create(createElement(Home)); }); await flush(); }
beforeEach(() => {
  vi.useFakeTimers(); mocks.auth = { status: 'viewer', email: undefined, canDeleteRooms: false };
  windowEvents = new EventTarget(); documentEvents = new EventTarget();
  vi.stubGlobal('addEventListener', windowEvents.addEventListener.bind(windowEvents));
  vi.stubGlobal('removeEventListener', windowEvents.removeEventListener.bind(windowEvents));
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: documentEvents.addEventListener.bind(documentEvents), removeEventListener: documentEvents.removeEventListener.bind(documentEvents) });
});
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

it('polls only the public listing without credentials and removes rooms no longer public', async () => {
  let visible = true;
  const fetcher = vi.fn(async () => response(visible ? [room] : [])); vi.stubGlobal('fetch', fetcher);
  await mount(); expect(text(renderer!.root)).toContain('Sala pública');
  visible = false; await act(async () => { vi.advanceTimersByTime(10000); }); await flush();
  expect(text(renderer!.root)).not.toContain('Sala pública');
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const [url, init] of vi.mocked(fetch).mock.calls) {
    expect(url).toBe('/api/scrims'); expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store' });
  }
});

it('revalidates on focus and visible return, and does not poll while hidden', async () => {
  const fetcher = vi.fn(async () => response([])); vi.stubGlobal('fetch', fetcher); await mount();
  act(() => { windowEvents.dispatchEvent(new Event('focus')); }); await flush(); expect(fetcher).toHaveBeenCalledTimes(2);
  (document as unknown as { visibilityState: string }).visibilityState = 'hidden';
  act(() => { documentEvents.dispatchEvent(new Event('visibilitychange')); });
  await act(async () => { vi.advanceTimersByTime(20000); }); await flush(); expect(fetcher).toHaveBeenCalledTimes(2);
  (document as unknown as { visibilityState: string }).visibilityState = 'visible';
  act(() => { documentEvents.dispatchEvent(new Event('visibilitychange')); }); await flush(); expect(fetcher).toHaveBeenCalledTimes(3);
});

it('ignores an old response when the auth context changes and clears the old list on an outage', async () => {
  let release!: (response: Response) => void;
  let reads = 0;
  const fetcher = vi.fn(async () => {
    reads++;
    if (reads === 1) return new Promise<Response>(resolve => { release = resolve; });
    return response([], reads === 2 ? 200 : 503);
  });
  vi.stubGlobal('fetch', fetcher); await mount();
  mocks.auth = { status: 'admin', email: 'admin@example.test', canDeleteRooms: false };
  act(() => renderer!.update(createElement(Home))); await flush();
  await act(async () => { release(response([room])); }); await flush();
  expect(text(renderer!.root)).not.toContain('Sala pública');
  await act(async () => { vi.advanceTimersByTime(10000); }); await flush();
  expect(text(renderer!.root.findByProps({ role: 'alert' }))).toContain('Não foi possível carregar');
  expect(renderer!.root.findAllByType('li')).toHaveLength(0);
});
