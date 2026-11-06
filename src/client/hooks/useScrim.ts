/**
 * Public rooms receive persisted Supabase Realtime events. Private rooms stay on
 * authenticated HTTP polling: Auth bearer tokens never enter browser JavaScript.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyEvent, type Command, type ScrimEvent, type ScrimState } from '../../shared/scrim';
import type { Role, RoomAccess } from '../../shared/protocol';
import type { ExternalMatch } from '../../shared/imports';
import { noPermissions, PERMISSION_KEYS, type AdminPermissionKey, type AdminPermissions } from '../../shared/adminPermissions';
import { adminFetch, responseClockOffset } from '../authFetch';
import { newId } from '../util';

export type ConnectionStatus = 'connecting' | 'online' | 'offline' | 'not-found';
interface Snapshot { state: ScrimState; events: ScrimEvent[]; serverNow?: number; access: RoomAccess; }
interface EventReply { state: ScrimState; event: ScrimEvent; }
interface AccessReply { role: Role; access: RoomAccess; serverNow?: number; permissions?: Partial<AdminPermissions>; isSuperAdmin?: boolean; }
type PhoenixMessage = { topic?: string; event?: string; ref?: string | null; payload?: Record<string, any>; };
const realtimeUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body as T;
}
function validAccess(value: RoomAccess | undefined): value is RoomAccess {
  return !!value && typeof value.isPublic === 'boolean' && Number.isInteger(value.accessVersion) && value.accessVersion > 0 &&
    (value.deletedAt === null || typeof value.deletedAt === 'number');
}
function visible() { return typeof document === 'undefined' || document.visibilityState !== 'hidden'; }

export function useScrim(scrimId: string) {
  const [state, setState] = useState<ScrimState | null>(null);
  const [events, setEvents] = useState<ScrimEvent[]>([]);
  const [access, setAccess] = useState<RoomAccess | null>(null);
  const [serverOffset, setServerOffset] = useState(0);
  const [role, setRole] = useState<Role>('viewer');
  const [permissions, setPermissions] = useState<AdminPermissions>(noPermissions);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [presence, setPresence] = useState({ viewers: 0, admins: 0 });
  const stateRef = useRef<ScrimState | null>(null);
  const accessRef = useRef<RoomAccess | null>(null);
  const allowedRef = useRef(false);
  const epochRef = useRef(0);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);

  const acceptEvent = useCallback((event: ScrimEvent) => {
    if (!allowedRef.current) return;
    const prev = stateRef.current;
    if (!prev || event.seq > prev.version + 1) { void refreshRef.current(); return; }
    if (event.seq <= prev.version) return;
    try {
      const next = applyEvent(prev, event);
      stateRef.current = next;
      setState(next);
      setEvents(old => old.at(-1)?.seq === event.seq ? old : [...old, event]);
    } catch { void refreshRef.current(); }
  }, []);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let attempts = 0;
    let joined = false;
    let heartbeatPending = false;
    let checkRevision = 0;
    let snapshotRevision = 0;
    let checkPending = false;
    let snapshotPending = false;
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

    function stopSocket() {
      if (retryTimer) clearTimeout(retryTimer);
      if (heartbeat) clearInterval(heartbeat);
      retryTimer = undefined; heartbeat = undefined;
      const previous = socket;
      socket = null; joined = false;
      previous?.close();
      presenceData = {};
      setPresence({ viewers: 0, admins: 0 });
    }
    function clearRoom(nextStatus: ConnectionStatus) {
      epochRef.current++;
      checkRevision++; snapshotRevision++;
      checkPending = false; snapshotPending = false;
      allowedRef.current = false; stateRef.current = null; accessRef.current = null;
      verifiedRole = 'viewer';
      setState(null); setEvents([]); setAccess(null); setRole('viewer');
      setPermissions(noPermissions()); setIsSuperAdmin(false);
      setStatus(nextStatus);
      stopSocket();
    }
    clearRoom('connecting');
    setServerOffset(0);

    function alignClock(response: Response, serverNow: number | undefined, sentAt: number) {
      if (typeof serverNow === 'number' && Number.isFinite(serverNow)) setServerOffset(responseClockOffset(response, serverNow, sentAt));
    }
    function setRoomAccess(next: RoomAccess) {
      accessRef.current = next;
      setAccess(next);
      if (!next.isPublic) {
        stopSocket();
        if (stateRef.current) setStatus('online');
      } else connect();
    }

    async function refresh() {
      if (disposed || !allowedRef.current || snapshotPending) return;
      const epoch = epochRef.current;
      const revision = ++snapshotRevision;
      snapshotPending = true;
      try {
        const sentAt = Date.now();
        const response = await adminFetch(`/api/scrims/${scrimId}`, { cache: 'no-store' });
        if (disposed || epoch !== epochRef.current || revision !== snapshotRevision) return;
        if ([401, 403, 404].includes(response.status)) { clearRoom('not-found'); return; }
        const snapshot = await responseJson<Snapshot>(response);
        if (disposed || epoch !== epochRef.current || revision !== snapshotRevision || !allowedRef.current) return;
        if (!validAccess(snapshot.access)) throw new Error('Acesso da sala indisponível.');
        if (snapshot.access.deletedAt !== null || (!snapshot.access.isPublic && verifiedRole !== 'admin')) { clearRoom('not-found'); return; }
        if (accessRef.current && snapshot.access.accessVersion < accessRef.current.accessVersion) return;
        alignClock(response, snapshot.serverNow, sentAt);
        setRoomAccess(snapshot.access);
        if (!stateRef.current || snapshot.state.version >= stateRef.current.version) {
          stateRef.current = snapshot.state;
          setState(snapshot.state); setEvents(snapshot.events);
        }
        if (!snapshot.access.isPublic || joined) setStatus('online');
        else if (!realtimeUrl || !anonKey) setStatus('offline');
      } catch { if (!disposed && epoch === epochRef.current) setStatus('offline'); }
      finally { if (epoch === epochRef.current && revision === snapshotRevision) snapshotPending = false; }
    }
    refreshRef.current = refresh;

    async function checkAccess(refreshAfter = false) {
      if (disposed || checkPending) return;
      const epoch = epochRef.current;
      const revision = ++checkRevision;
      checkPending = true;
      try {
        const sentAt = Date.now();
        const response = await adminFetch(`/api/scrims/${scrimId}/access`, { cache: 'no-store' });
        if (disposed || epoch !== epochRef.current || revision !== checkRevision) return;
        if ([401, 403, 404].includes(response.status)) { clearRoom('not-found'); return; }
        const result = await responseJson<AccessReply>(response);
        if (disposed || epoch !== epochRef.current || revision !== checkRevision) return;
        if (!validAccess(result.access) || !['admin', 'viewer'].includes(result.role)) throw new Error('Acesso da sala indisponível.');
        if (result.access.deletedAt !== null || (!result.access.isPublic && result.role !== 'admin')) { clearRoom('not-found'); return; }
        if (accessRef.current && result.access.accessVersion < accessRef.current.accessVersion) return;
        const needsSnapshot = !allowedRef.current || !stateRef.current || refreshAfter;
        allowedRef.current = true;
        verifiedRole = result.role; setRole(result.role);
        const scopedPermissions = noPermissions();
        if (result.role === 'admin') for (const key of PERMISSION_KEYS) scopedPermissions[key] = result.permissions?.[key] === true;
        setPermissions(scopedPermissions);
        setIsSuperAdmin(result.role === 'admin' && result.isSuperAdmin === true);
        alignClock(response, result.serverNow, sentAt);
        setRoomAccess(result.access);
        if (joined) sendWs('presence', { type: 'presence', event: 'track', payload: { role: verifiedRole } });
        if (needsSnapshot) void refresh();
      } catch {
        if (!disposed && epoch === epochRef.current) {
          // On a failed verification, private content must not remain on screen.
          if (accessRef.current?.isPublic === false) clearRoom('offline');
          else { verifiedRole = 'viewer'; setRole('viewer'); setPermissions(noPermissions()); setIsSuperAdmin(false); setStatus('offline'); }
        }
      } finally { if (epoch === epochRef.current && revision === checkRevision) checkPending = false; }
    }

    function sendWs(event: string, payload: Record<string, unknown>, ref: string | null = nextRef(), sendTopic = topic) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ topic: sendTopic, event, payload, ref, join_ref: sendTopic === 'phoenix' ? null : joinRef }));
      }
    }
    function countPresence() {
      const members = Object.values(presenceData).flatMap(memberList);
      setPresence({ viewers: members.filter(m => m.role !== 'admin').length, admins: members.filter(m => m.role === 'admin').length });
    }
    function connect() {
      if (disposed || !allowedRef.current || !accessRef.current?.isPublic || !realtimeUrl || !anonKey || socket) return;
      const epoch = epochRef.current;
      setStatus('connecting'); joined = false;
      const wsUrl = `${realtimeUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/realtime/v1/websocket?apikey=${encodeURIComponent(anonKey)}&vsn=1.0.0`;
      socket = new WebSocket(wsUrl);
      const currentSocket = socket;
      const active = () => !disposed && socket === currentSocket && epoch === epochRef.current && allowedRef.current && !!accessRef.current?.isPublic;
      socket.onopen = () => {
        if (!active()) return;
        heartbeatPending = false;
        sendWs('phx_join', { config: {
          private: false, broadcast: { ack: false, self: false }, presence: { enabled: true, key: presenceKey },
          postgres_changes: [{ event: 'INSERT', schema: 'public', table: 'scrim_events', filter: `scrim_id=eq.${scrimId}` }],
        } }, joinRef);
        heartbeat = setInterval(() => {
          if (heartbeatPending) { currentSocket.close(); return; }
          heartbeatPending = true; sendWs('heartbeat', {}, nextRef(), 'phoenix');
        }, 25000);
      };
      socket.onmessage = message => {
        if (!active()) return;
        let data: PhoenixMessage;
        try { data = JSON.parse(message.data as string) as PhoenixMessage; } catch { return; }
        if (data.topic === 'phoenix' && data.event === 'phx_reply') heartbeatPending = false;
        if (data.event === 'phx_error' || data.event === 'phx_close' || (data.event === 'system' && data.payload?.status === 'error')) { currentSocket.close(); return; }
        if (data.event === 'phx_reply' && data.ref === joinRef) {
          if (data.payload?.status === 'ok') {
            joined = true; attempts = 0; setStatus('online');
            sendWs('presence', { type: 'presence', event: 'track', payload: { role: verifiedRole } });
            void refresh();
          } else { setStatus('offline'); currentSocket.close(); }
        }
        if (data.event === 'postgres_changes' && data.payload?.data?.record) {
          const event = data.payload.data.record.event as ScrimEvent | undefined;
          if (event) acceptEvent(event);
        }
        if (data.event === 'presence_state') { presenceData = data.payload || {}; countPresence(); }
        if (data.event === 'presence_diff') {
          for (const [key, entry] of Object.entries((data.payload?.joins || {}) as typeof presenceData)) presenceData[key] = entry;
          for (const [key, entry] of Object.entries((data.payload?.leaves || {}) as typeof presenceData)) {
            const leaves = new Set(memberList(entry).map(m => m.phx_ref));
            const remaining = (presenceData[key] ? memberList(presenceData[key]) : []).filter(m => !leaves.has(m.phx_ref));
            if (remaining.length) presenceData[key] = { metas: remaining }; else delete presenceData[key];
          }
          countPresence();
        }
      };
      socket.onerror = () => { if (active()) setStatus('offline'); };
      socket.onclose = () => {
        if (!active()) return;
        if (heartbeat) clearInterval(heartbeat);
        socket = null; joined = false; setStatus('offline'); setPresence({ viewers: 0, admins: 0 });
        const backoff = Math.min(30000, 500 * 2 ** Math.min(attempts++, 6));
        retryTimer = setTimeout(connect, backoff);
      };
    }

    const authChanged = () => { clearRoom('connecting'); void checkAccess(true); };
    const returned = () => { if (visible()) void checkAccess(true); };
    if (typeof window !== 'undefined') {
      window.addEventListener('scrim-auth-change', authChanged);
      window.addEventListener('focus', returned);
      document.addEventListener('visibilitychange', returned);
    }
    void checkAccess(true);
    const accessTimer = setInterval(() => { if (visible()) void checkAccess(); }, 3000);
    const privateTimer = setInterval(() => { if (visible() && accessRef.current?.isPublic === false) void refresh(); }, 2000);
    const publicTimer = setInterval(() => { if (visible() && accessRef.current?.isPublic) void refresh(); }, 20000);
    return () => {
      disposed = true; epochRef.current++;
      allowedRef.current = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('scrim-auth-change', authChanged);
        window.removeEventListener('focus', returned);
        document.removeEventListener('visibilitychange', returned);
      }
      clearInterval(accessTimer); clearInterval(privateTimer); clearInterval(publicTimer);
      stopSocket();
    };
  }, [scrimId, acceptEvent]);

  const denied = useCallback((response: Response) => {
    if ([401, 403, 404].includes(response.status)) {
      setRole('viewer');
      setPermissions(noPermissions()); setIsSuperAdmin(false);
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('scrim-auth-change'));
    }
  }, []);
  const send = useCallback(async (command: Command) => {
    const epoch = epochRef.current;
    const response = await adminFetch(`/api/scrims/${scrimId}/command`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command }) });
    denied(response);
    if (response.status === 409) void refreshRef.current();
    const result = await responseJson<EventReply>(response);
    if (epoch === epochRef.current) acceptEvent(result.event);
  }, [scrimId, acceptEvent, denied]);
  const importRequest = useCallback(async (input: Record<string, unknown>) => {
    const epoch = epochRef.current;
    const response = await adminFetch(`/api/scrims/${scrimId}/imports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    denied(response);
    if (response.status === 409) void refreshRef.current();
    const result = await responseJson<{ matches?: ExternalMatch[]; match?: ExternalMatch; event?: ScrimEvent }>(response);
    if (epoch === epochRef.current && result.event && stateRef.current?.id === scrimId) acceptEvent(result.event);
    return result;
  }, [scrimId, acceptEvent, denied]);
  const roomRequest = useCallback(async (input: Record<string, unknown>) => {
    const epoch = epochRef.current;
    const sentAt = Date.now();
    try {
      const response = await adminFetch(`/api/scrims/${scrimId}/tools`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      denied(response);
      const result = await responseJson<{ state?: ScrimState; event?: ScrimEvent; serverNow?: number }>(response);
      if (epoch === epochRef.current && allowedRef.current) {
        if (typeof result.serverNow === 'number' && Number.isFinite(result.serverNow)) setServerOffset(responseClockOffset(response, result.serverNow, sentAt));
        if (result.event && stateRef.current?.id === scrimId) acceptEvent(result.event); else void refreshRef.current();
      }
      return result;
    } catch (error) { if (epoch === epochRef.current) void refreshRef.current(); throw error; }
  }, [scrimId, acceptEvent, denied]);

  const can = useCallback((key: AdminPermissionKey) => role === 'admin' && (isSuperAdmin || permissions[key]), [role, isSuperAdmin, permissions]);
  return { state, events, access, role, permissions, isSuperAdmin, can, status, presence, send, importRequest, roomRequest, serverOffset };
}
