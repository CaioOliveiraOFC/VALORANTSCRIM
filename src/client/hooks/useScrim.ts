/**
 * Sala em tempo real usando o protocolo público Supabase Realtime (Phoenix 1.0).
 * Não exige SDK ou dependência adicional. Eventos permanecem persistidos em Postgres.
 * Comandos passam exclusivamente pela API serverless; não há escrita anônima no banco.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyEvent, type Command, type ScrimEvent, type ScrimState } from '../../shared/scrim';
import type { Role } from '../../shared/protocol';
import type { ExternalMatch } from '../../shared/imports';
import { adminFetch, responseClockOffset } from '../authFetch';
import { newId } from '../util';

export type ConnectionStatus = 'connecting' | 'online' | 'offline' | 'not-found';
interface Snapshot { state: ScrimState; events: ScrimEvent[]; serverNow?: number; }
interface EventReply { state: ScrimState; event: ScrimEvent; }

type PhoenixMessage = {
  topic?: string;
  event?: string;
  ref?: string | null;
  payload?: Record<string, any>;
};

const realtimeUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body as T;
}

export function useScrim(scrimId: string) {
  const [state, setState] = useState<ScrimState | null>(null);
  const [events, setEvents] = useState<ScrimEvent[]>([]);
  const [serverOffset, setServerOffset] = useState(0);
  const [role, setRole] = useState<Role>('viewer');
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [presence, setPresence] = useState({ viewers: 0, admins: 0 });
  const stateRef = useRef<ScrimState | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);

  /** Não permite que uma resposta HTTP atrasada reverta uma versão mais nova. */
  const acceptSnapshot = useCallback((snapshot: Snapshot) => {
    if (stateRef.current && snapshot.state.version < stateRef.current.version) return;
    stateRef.current = snapshot.state;
    setState(snapshot.state);
    setEvents(snapshot.events);
  }, []);

  const acceptEvent = useCallback((event: ScrimEvent) => {
    const prev = stateRef.current;
    if (!prev || event.seq > prev.version + 1) {
      void refreshRef.current();
      return;
    }
    if (event.seq <= prev.version) return;
    try {
      const next = applyEvent(prev, event);
      stateRef.current = next;
      setState(next);
      setEvents((old) => old.at(-1)?.seq === event.seq ? old : [...old, event]);
    } catch {
      void refreshRef.current();
    }
  }, []);

  useEffect(() => {
    stateRef.current = null;
    setState(null);
    setEvents([]);
    setRole('viewer');
    setPresence({ viewers: 0, admins: 0 });
    setStatus('connecting');
    setServerOffset(0);
    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let refreshTimer: ReturnType<typeof setInterval> | undefined;
    let attempts = 0;
    let joined = false;
    let heartbeatPending = false;
    let missing = false;
    let roleRevision = 0;
    let verifiedRole: Role = 'viewer';
    type PresenceMember = { role?: Role; phx_ref?: string };
    type PresenceEntry = { metas?: PresenceMember[] } | PresenceMember[];
    let presenceData: Record<string, PresenceEntry> = {};
    const memberList = (entry: PresenceEntry) => Array.isArray(entry) ? entry : (entry.metas || []);
    const topic = `realtime:scrim-${scrimId}`;
    const joinRef = '1';
    let counter = 2;
    const nextRef = () => String(counter++);
    const presenceKey = newId();

    async function refresh() {
      try {
        const sentAt = Date.now();
        const response = await fetch(`/api/scrims/${scrimId}`, { cache: 'no-store' });
        if (response.status === 404) {
          missing = true;
          if (!disposed) setStatus('not-found');
          socket?.close();
          return;
        }
        const snapshot = await responseJson<Snapshot>(response);
        if (disposed) return;
        if (typeof snapshot.serverNow === 'number' && Number.isFinite(snapshot.serverNow)) {
          setServerOffset(responseClockOffset(response, snapshot.serverNow, sentAt));
        }
        acceptSnapshot(snapshot);
        if (!realtimeUrl || !anonKey) setStatus('offline');
      } catch {
        if (!disposed) setStatus('offline');
      }
    }
    refreshRef.current = refresh;

    async function verifyRole() {
      const revision = ++roleRevision;
      try {
        const res = await adminFetch(`/api/scrims/${scrimId}/session`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
        const r = await responseJson<{ role: Role }>(res);
        if (!disposed && revision === roleRevision) {
          verifiedRole = r.role;
          setRole(r.role);
          if (joined) sendWs('presence', { type: 'presence', event: 'track', payload: { role: verifiedRole } });
        }
      } catch { if (!disposed && revision === roleRevision) { verifiedRole = 'viewer'; setRole('viewer'); } }
    }

    function sendWs(event: string, payload: Record<string, unknown>, ref: string | null = nextRef(), sendTopic = topic) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ topic: sendTopic, event, payload, ref, join_ref: sendTopic === 'phoenix' ? null : joinRef }));
      }
    }

    function countPresence() {
      const members = Object.values(presenceData).flatMap(memberList);
      setPresence({ viewers: members.filter((m) => m.role !== 'admin').length,
        admins: members.filter((m) => m.role === 'admin').length });
    }

    function connect() {
      if (disposed || missing || !realtimeUrl || !anonKey) return;
      setStatus('connecting');
      joined = false;
      const wsUrl = `${realtimeUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/realtime/v1/websocket?apikey=${encodeURIComponent(anonKey)}&vsn=1.0.0`;
      socket = new WebSocket(wsUrl);
      const currentSocket = socket;
      const active = () => !disposed && socket === currentSocket;
      socket.onopen = () => {
        if (!active()) return;
        heartbeatPending = false;
        sendWs('phx_join', {
          config: {
            private: false,
            broadcast: { ack: false, self: false },
            presence: { enabled: true, key: presenceKey },
            postgres_changes: [{ event: 'INSERT', schema: 'public', table: 'scrim_events', filter: `scrim_id=eq.${scrimId}` }],
          },
        }, joinRef);
        heartbeat = setInterval(() => {
          if (heartbeatPending) { currentSocket.close(); return; }
          heartbeatPending = true;
          sendWs('heartbeat', {}, nextRef(), 'phoenix');
        }, 25000);
      };
      socket.onmessage = (message) => {
        if (!active()) return;
        let data: PhoenixMessage;
        try { data = JSON.parse(message.data as string) as PhoenixMessage; } catch { return; }
        if (data.topic === 'phoenix' && data.event === 'phx_reply') heartbeatPending = false;
        if (data.event === 'phx_error' || data.event === 'phx_close' || (data.event === 'system' && data.payload?.status === 'error')) {
          currentSocket.close();
          return;
        }
        if (data.event === 'phx_reply' && data.ref === joinRef) {
          if (data.payload?.status === 'ok') {
            joined = true;
            attempts = 0;
            if (!disposed && !missing) setStatus('online');
            sendWs('presence', { type: 'presence', event: 'track', payload: { role: verifiedRole } });
            void refresh(); // fecha a lacuna entre leitura inicial e assinatura.
          } else { setStatus('offline'); currentSocket.close(); }
        }
        if (data.event === 'postgres_changes' && data.payload?.data?.record) {
          const event = data.payload.data.record.event as ScrimEvent | undefined;
          if (event) acceptEvent(event);
        }
        if (data.event === 'presence_state') {
          presenceData = data.payload || {};
          countPresence();
        }
        if (data.event === 'presence_diff') {
          for (const [key, entry] of Object.entries((data.payload?.joins || {}) as typeof presenceData)) {
            presenceData[key] = entry;
          }
          for (const [key, entry] of Object.entries((data.payload?.leaves || {}) as typeof presenceData)) {
            const leaves = new Set(memberList(entry).map((m) => m.phx_ref));
            const remaining = (presenceData[key] ? memberList(presenceData[key]) : []).filter((m) => !leaves.has(m.phx_ref));
            if (remaining.length) presenceData[key] = { metas: remaining };
            else delete presenceData[key];
          }
          countPresence();
        }
      };
      socket.onerror = () => { if (!disposed) setStatus('offline'); };
      socket.onclose = () => {
        if (!active()) return;
        if (heartbeat) clearInterval(heartbeat);
        if (disposed || missing) return;
        setStatus('offline');
        setPresence({ viewers: 0, admins: 0 });
        const backoff = Math.min(30000, 500 * 2 ** Math.min(attempts++, 6));
        retryTimer = setTimeout(connect, backoff);
      };
    }

    const authChanged = () => { void verifyRole(); };
    const visibilityChanged = () => { if (document.visibilityState === 'visible') void verifyRole(); };
    if (typeof window !== 'undefined') {
      window.addEventListener('scrim-auth-change', authChanged);
      window.addEventListener('focus', authChanged);
      document.addEventListener('visibilitychange', visibilityChanged);
    }
    void refresh();
    void verifyRole();
    connect();
    // Mesmo após perda temporária de uma notificação, o cliente se reconcilia com o banco.
    refreshTimer = setInterval(() => { void refresh(); if (verifiedRole === 'admin') void verifyRole(); }, 20000);
    return () => {
      disposed = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('scrim-auth-change', authChanged);
        window.removeEventListener('focus', authChanged);
        document.removeEventListener('visibilitychange', visibilityChanged);
      }
      if (heartbeat) clearInterval(heartbeat);
      if (retryTimer) clearTimeout(retryTimer);
      if (refreshTimer) clearInterval(refreshTimer);
      socket?.close();
    };
  }, [scrimId, acceptSnapshot, acceptEvent]);

  const send = useCallback(async (command: Command) => {
    const response = await adminFetch(`/api/scrims/${scrimId}/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    if (response.status === 401 || response.status === 403) {
      setRole('viewer');
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('scrim-auth-change'));
    }
    if (response.status === 409) void refreshRef.current();
    const result = await responseJson<EventReply>(response);
    acceptEvent(result.event);
  }, [scrimId, acceptEvent]);

  const importRequest = useCallback(async (input: Record<string, unknown>) => {
    const response = await adminFetch(`/api/scrims/${scrimId}/imports`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (response.status === 401 || response.status === 403) {
      setRole('viewer');
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('scrim-auth-change'));
    }
    if (response.status === 409) void refreshRef.current();
    const result = await responseJson<{ matches?: ExternalMatch[]; match?: ExternalMatch; event?: ScrimEvent }>(response);
    if (result.event && stateRef.current?.id === scrimId) acceptEvent(result.event);
    return result;
  }, [scrimId, acceptEvent]);

  const roomRequest = useCallback(async (input: Record<string, unknown>) => {
    const sentAt = Date.now();
    try {
      const response = await adminFetch(`/api/scrims/${scrimId}/tools`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (response.status === 401 || response.status === 403) {
        setRole('viewer');
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('scrim-auth-change'));
      }
      const result = await responseJson<{ state?: ScrimState; event?: ScrimEvent; serverNow?: number }>(response);
      if (typeof result.serverNow === 'number' && Number.isFinite(result.serverNow)) {
        setServerOffset(responseClockOffset(response, result.serverNow, sentAt));
      }
      if (result.event && stateRef.current?.id === scrimId) acceptEvent(result.event);
      else void refreshRef.current();
      return result;
    } catch (error) {
      // A response may be lost after the server committed. Reconcile before retrying.
      void refreshRef.current();
      throw error;
    }
  }, [scrimId, acceptEvent]);

  return { state, events, role, status, presence, send, importRequest, roomRequest, serverOffset };
}
