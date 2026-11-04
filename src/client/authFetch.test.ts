import { afterEach, expect, it, vi } from 'vitest';
import { adminFetch, responseClockOffset } from './authFetch';
afterEach(() => vi.unstubAllGlobals());

it('finishes pending cookie rotation before sending logout', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(new Response('{}'));
  vi.stubGlobal('fetch', fetcher);
  const refresh = adminFetch('/api/admin/session');
  const logout = adminFetch('/api/admin/logout', { method: 'POST' });
  await Promise.resolve(); expect(fetcher).toHaveBeenCalledTimes(1);
  finish(new Response('{}')); await Promise.all([refresh, logout]);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/admin/session', '/api/admin/logout']);
  expect(fetcher.mock.calls[1]![1].credentials).toBe('same-origin');
});
it('uses the browser-wide lock and keeps actual request times for the draw clock', async () => {
  const request = vi.fn(async (_name: string, work: () => Promise<Response>) => work());
  vi.stubGlobal('navigator', { locks: { request } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  const before = Date.now(); const response = await adminFetch('/api/scrims/abc123/tools');
  const after = Date.now();
  expect(request.mock.calls[0]![0]).toBe('valorantscrim-admin-session');
  expect(responseClockOffset(response, after + 1000, before - 10000)).toBeGreaterThanOrEqual(1000);
  expect(responseClockOffset(response, after + 1000, before - 10000)).toBeLessThanOrEqual(1000 + after - before);
});
it('does not leave the queue blocked when a request fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response('{}')));
  await expect(adminFetch('/api/admin/session')).rejects.toThrow('offline');
  await expect(adminFetch('/api/admin/logout', { method: 'POST' })).resolves.toBeInstanceOf(Response);
});
