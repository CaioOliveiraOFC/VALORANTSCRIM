import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ADMIN_AUTH_CHANGE, AdminAuthProvider, useAdminAuth } from './useAdminAuth';

let renderer: ReactTestRenderer | undefined;
let auth: ReturnType<typeof useAdminAuth>;
let windowEvents: EventTarget;
let documentEvents: EventTarget;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
async function flush() { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); }
async function mount() {
  function Observer() { auth = useAdminAuth(); return null; }
  await act(async () => { renderer = create(createElement(AdminAuthProvider, null, createElement(Observer))); });
  await flush();
}
beforeEach(() => {
  vi.useFakeTimers(); windowEvents = new EventTarget(); documentEvents = new EventTarget();
  vi.stubGlobal('addEventListener', windowEvents.addEventListener.bind(windowEvents));
  vi.stubGlobal('removeEventListener', windowEvents.removeEventListener.bind(windowEvents));
  vi.stubGlobal('dispatchEvent', windowEvents.dispatchEvent.bind(windowEvents));
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: documentEvents.addEventListener.bind(documentEvents), removeEventListener: documentEvents.removeEventListener.bind(documentEvents) });
  vi.stubGlobal('localStorage', { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() });
});
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

it('uses a cookie session, logs in without persisting secrets and clears identity on logout', async () => {
  let logged = false;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/login')) logged = true;
    if (url.endsWith('/logout')) logged = false;
    return response(logged ? { authenticated: true, user: { email: 'admin@example.test' }, access_token: 'must-not-store' } : { authenticated: false });
  });
  vi.stubGlobal('fetch', fetcher); await mount(); expect(auth.status).toBe('viewer');
  await act(async () => { await auth.login(' admin@example.test ', 'private-password'); }); await flush();
  expect(auth.status).toBe('admin'); expect(auth.email).toBe('admin@example.test');
  const login = fetcher.mock.calls.find(([url]) => url.endsWith('/login'))!;
  expect(login[1]).toMatchObject({ credentials: 'same-origin', method: 'POST' });
  expect(JSON.parse(login[1]!.body as string)).toEqual({ email: 'admin@example.test', password: 'private-password' });
  expect(localStorage.setItem).not.toHaveBeenCalled(); expect(auth).not.toHaveProperty('access_token');
  await act(async () => { await auth.logout(); }); await flush();
  expect(auth.status).toBe('viewer'); expect(auth.email).toBeUndefined();
});

it('does not let an older unauthenticated refresh overwrite a successful login', async () => {
  let release!: (value: unknown) => void;
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.endsWith('/session') && reads++ === 0) {
      const old = response({});
      old.json = () => new Promise(resolve => { release = resolve; });
      return Promise.resolve(old);
    }
    return Promise.resolve(response({ authenticated: true, user: { email: 'admin@example.test' } }));
  }));
  await mount(); expect(auth.status).toBe('loading');
  await act(async () => { await auth.login('admin@example.test', 'password'); }); await flush();
  await act(async () => { release({ authenticated: false }); }); await flush();
  expect(auth.status).toBe('admin'); expect(auth.email).toBe('admin@example.test');
});

it('revalidates account permission on focus, visible return and the logged-in refresh interval', async () => {
  let granted = true;
  const fetcher = vi.fn(async () => response(granted ? { authenticated: true, user: { email: 'admin@example.test' } } : { authenticated: false }));
  vi.stubGlobal('fetch', fetcher); await mount(); expect(fetcher).toHaveBeenCalledTimes(1);
  act(() => { windowEvents.dispatchEvent(new Event('focus')); }); await flush(); expect(fetcher).toHaveBeenCalledTimes(2);
  (document as unknown as { visibilityState: string }).visibilityState = 'hidden';
  act(() => { documentEvents.dispatchEvent(new Event('visibilitychange')); }); await flush(); expect(fetcher).toHaveBeenCalledTimes(2);
  (document as unknown as { visibilityState: string }).visibilityState = 'visible';
  act(() => { documentEvents.dispatchEvent(new Event('visibilitychange')); }); await flush(); expect(fetcher).toHaveBeenCalledTimes(3);
  await act(async () => { vi.advanceTimersByTime(60000); }); await flush(); expect(fetcher).toHaveBeenCalledTimes(4);
  granted = false; act(() => { windowEvents.dispatchEvent(new Event(ADMIN_AUTH_CHANGE)); }); await flush(); expect(auth.status).toBe('viewer');
  const calls = fetcher.mock.calls.length; await act(async () => { vi.advanceTimersByTime(60000); }); await flush(); expect(fetcher).toHaveBeenCalledTimes(calls);
});

it('leaves a denied login as a spectator and lets a failed session check be retried', async () => {
  let unavailable = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/login')) return response({ error: 'Acesso não liberado.' }, 401);
    if (unavailable) throw new Error('network');
    return response({ authenticated: false });
  }));
  await mount(); expect(auth.status).toBe('error');
  unavailable = false; await act(async () => { await auth.refresh(); }); expect(auth.status).toBe('viewer');
  await expect(auth.login('viewer@example.test', 'wrong')).rejects.toThrow('Acesso não liberado');
  expect(auth.status).toBe('viewer'); expect(localStorage.setItem).not.toHaveBeenCalled();
});

it('takes deletion permission only from the server and resets it when the session changes', async () => {
  let permission: unknown = undefined;
  let authenticated = true;
  vi.stubGlobal('fetch', vi.fn(async () => response({ authenticated, user: { email: 'owner@example.test' }, permissions: { deleteRooms: permission } })));
  await mount(); expect(auth.canDeleteRooms).toBe(false);
  permission = true; await act(async () => { await auth.refresh(); }); expect(auth.canDeleteRooms).toBe(true);
  permission = 'true'; await act(async () => { await auth.refresh(); }); expect(auth.canDeleteRooms).toBe(false);
  permission = true; await act(async () => { await auth.refresh(); }); expect(auth.canDeleteRooms).toBe(true);
  authenticated = false; await act(async () => { await auth.refresh(); }); expect(auth.canDeleteRooms).toBe(false); expect(auth.status).toBe('viewer');
});

it('uses scoped capability booleans and never infers super admin from an email or a text flag', async () => {
  let isSuperAdmin: unknown = false;
  let authenticated = true;
  vi.stubGlobal('fetch', vi.fn(async () => response({ authenticated, user: { email: 'caio.oliveira2014@hotmail.com' }, isSuperAdmin, permissions: { createRooms: true, correctStats: false, canDeleteRooms: true } })));
  await mount();
  expect(auth.isSuperAdmin).toBe(false); expect(auth.can('createRooms')).toBe(true);
  expect(auth.can('correctStats')).toBe(false); expect(auth.canDeleteRooms).toBe(false);
  isSuperAdmin = 'true'; await act(async () => { await auth.refresh(); }); expect(auth.isSuperAdmin).toBe(false);
  isSuperAdmin = true; await act(async () => { await auth.refresh(); });
  expect(auth.isSuperAdmin).toBe(true); expect(auth.can('correctStats')).toBe(true); expect(auth.canDeleteRooms).toBe(true);
  authenticated = false; await act(async () => { await auth.refresh(); });
  expect(auth.isSuperAdmin).toBe(false); expect(auth.can('createRooms')).toBe(false); expect(auth.canDeleteRooms).toBe(false);
});

it('clears administrative capabilities if checking the session fails', async () => {
  let unavailable = false;
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (unavailable) throw new Error('network');
    return response({ authenticated: true, permissions: { createRooms: true } });
  }));
  await mount(); expect(auth.can('createRooms')).toBe(true);
  unavailable = true; await act(async () => { await auth.refresh(); });
  expect(auth.status).toBe('error'); expect(auth.can('createRooms')).toBe(false); expect(auth.isSuperAdmin).toBe(false);
});
