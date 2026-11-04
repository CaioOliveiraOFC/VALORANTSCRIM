/** Keep cookie rotation and logout ordered, including tabs of the same browser. */
const LOCK_NAME = 'valorantscrim-admin-session';
let queue: Promise<void> = Promise.resolve();
const times = new WeakMap<Response, { sentAt: number; receivedAt: number }>();

export function adminFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const run = async () => {
    const sentAt = Date.now();
    const response = await fetch(input, { credentials: 'same-origin', ...init, signal: init.signal ?? AbortSignal.timeout(45_000) });
    times.set(response, { sentAt, receivedAt: Date.now() });
    return response;
  };
  // Web Locks serializes auth-capable requests across same-origin browser tabs.
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(LOCK_NAME, run);
  }
  // Older browsers still keep requests ordered within this tab.
  const pending = queue.then(run, run);
  queue = pending.then(() => undefined, () => undefined);
  return pending;
}

export function responseClockOffset(response: Response, serverNow: number, fallbackSentAt: number): number {
  const timing = times.get(response);
  return serverNow - ((timing?.sentAt ?? fallbackSentAt) + (timing?.receivedAt ?? Date.now())) / 2;
}
