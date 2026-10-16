import { useCallback, useEffect, useRef, useState } from 'react';
import { WS_PATH, type ClientMessage, type Role, type ServerMessage } from '../../shared/protocol';
import type { Command, ScrimEvent, ScrimState } from '../../shared/scrim';
import { newId } from '../util';

export type ConnectionStatus = 'connecting' | 'online' | 'offline' | 'not-found';

interface Pending {
  resolve: () => void;
  reject: (err: Error) => void;
}

/**
 * Conexão em tempo real com a sala. Reconecta sozinho com backoff exponencial
 * (útil quando alguém do Discord perde a conexão) e sempre recebe o estado
 * completo ao reentrar, então ninguém fica dessincronizado.
 */
export function useScrim(scrimId: string, adminKey: string | undefined) {
  const [state, setState] = useState<ScrimState | null>(null);
  const [events, setEvents] = useState<ScrimEvent[]>([]);
  const [role, setRole] = useState<Role>('viewer');
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [presence, setPresence] = useState({ viewers: 0, admins: 0 });
  const socketRef = useRef<WebSocket | null>(null);
  const pending = useRef(new Map<string, Pending>());

  useEffect(() => {
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const connect = () => {
      setStatus('connecting');
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}${WS_PATH}`);
      socketRef.current = ws;

      ws.onopen = () => {
        const join: ClientMessage = { type: 'join', scrimId, adminKey };
        ws.send(JSON.stringify(join));
      };

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as ServerMessage;
        switch (msg.type) {
          case 'welcome':
            attempt = 0;
            setStatus('online');
            setRole(msg.role);
            setState(msg.state);
            setEvents(msg.events);
            break;
          case 'event':
            setState(msg.state);
            setEvents((prev) => (prev.at(-1)?.seq === msg.event.seq ? prev : [...prev, msg.event]));
            break;
          case 'presence':
            setPresence({ viewers: msg.viewers, admins: msg.admins });
            break;
          case 'ack':
            pending.current.get(msg.requestId)?.resolve();
            pending.current.delete(msg.requestId);
            break;
          case 'error':
            if (msg.requestId && pending.current.has(msg.requestId)) {
              pending.current.get(msg.requestId)!.reject(new Error(msg.message));
              pending.current.delete(msg.requestId);
            }
            break;
        }
      };

      ws.onclose = (ev) => {
        for (const p of pending.current.values()) p.reject(new Error('Conexão perdida.'));
        pending.current.clear();
        if (disposed) return;
        if (ev.code === 4404) return setStatus('not-found');
        setStatus('offline');
        const delay = Math.min(30_000, 500 * 2 ** attempt++);
        timer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      socketRef.current?.close();
    };
  }, [scrimId, adminKey]);

  const send = useCallback((command: Command) => {
    return new Promise<void>((resolve, reject) => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error('Sem conexão com o servidor.'));
      const requestId = newId();
      pending.current.set(requestId, { resolve, reject });
      const msg: ClientMessage = { type: 'command', requestId, command };
      ws.send(JSON.stringify(msg));
    });
  }, []);

  return { state, events, role, status, presence, send };
}
