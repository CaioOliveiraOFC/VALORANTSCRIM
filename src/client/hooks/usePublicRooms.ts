import { useEffect, useState } from 'react';
import type { ScrimSummary } from '../../shared/protocol';
import { useAdminAuth } from './useAdminAuth';

/** Public-only listing: deployment cookies travel, hidden administrative rows do not. */
export function usePublicRooms() {
  const auth = useAdminAuth();
  const [rooms, setRooms] = useState<ScrimSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false,
      revision = 0;
    let current: AbortController | null = null;
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    async function reload(clear = false, replace = false) {
      if (current && !replace) return;
      current?.abort();
      const ctrl = new AbortController();
      current = ctrl;
      const request = ++revision;
      if (clear) setRooms(null);
      setError(false);
      try {
        const response = await fetch('/api/scrims', {
          signal: ctrl.signal,
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!response.ok) throw new Error();
        const body = await response.json();
        if (!Array.isArray(body)) throw new Error();
        if (!disposed && !ctrl.signal.aborted && request === revision)
          setRooms(body as ScrimSummary[]);
      } catch {
        if (!disposed && !ctrl.signal.aborted && request === revision) {
          setRooms(null);
          setError(true);
        }
      } finally {
        if (request === revision) current = null;
      }
    }
    const active = () => {
      if (visible()) void reload(true, true);
    };
    void reload(true, true);
    if (typeof addEventListener === 'function') addEventListener('focus', active);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', active);
    const timer = setInterval(() => {
      if (visible()) void reload();
    }, 10_000);
    return () => {
      disposed = true;
      revision++;
      current?.abort();
      clearInterval(timer);
      if (typeof removeEventListener === 'function') removeEventListener('focus', active);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', active);
    };
  }, [retry, auth.status, auth.email, auth.canDeleteRooms]);
  return { rooms, error, retry: () => setRetry((value) => value + 1) };
}
