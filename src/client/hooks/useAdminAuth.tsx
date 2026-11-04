import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { adminFetch } from '../authFetch';

export type AdminAuthStatus = 'loading' | 'admin' | 'viewer' | 'error';
interface AuthState { status: AdminAuthStatus; email?: string; canDeleteRooms: boolean; }
interface AuthContext extends AuthState {
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}
const Context = createContext<AuthContext | null>(null);
export const ADMIN_AUTH_CHANGE = 'scrim-auth-change';

async function reply(response: Response): Promise<{ authenticated?: boolean; user?: { email?: string }; permissions?: { canDeleteRooms?: boolean }; error?: string }> {
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : 'Não foi possível verificar o acesso. Tente novamente.');
  return value;
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', canDeleteRooms: false });
  const revision = useRef(0);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try {
      const body = await reply(await adminFetch('/api/admin/session', { cache: 'no-store', credentials: 'same-origin' }));
      if (mounted.current && request === revision.current) {
        setState(body.authenticated === true ? { status: 'admin', email: body.user?.email, canDeleteRooms: body.permissions?.canDeleteRooms === true } : { status: 'viewer', canDeleteRooms: false });
      }
    } catch {
      if (mounted.current && request === revision.current) setState({ status: 'error', canDeleteRooms: false });
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const request = ++revision.current;
    const body = await reply(await adminFetch('/api/admin/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
    }));
    if (body.authenticated !== true) throw new Error('Este acesso de administrador não está liberado. Fale com o responsável pela sala.');
    if (mounted.current && request === revision.current) setState({ status: 'admin', email: body.user?.email ?? email.trim(), canDeleteRooms: body.permissions?.canDeleteRooms === true });
    dispatchEvent(new Event(ADMIN_AUTH_CHANGE));
  }, []);

  const logout = useCallback(async () => {
    const request = ++revision.current;
    await reply(await adminFetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' }));
    if (mounted.current && request === revision.current) setState({ status: 'viewer', canDeleteRooms: false });
    dispatchEvent(new Event(ADMIN_AUTH_CHANGE));
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const changed = () => void refresh();
    addEventListener('focus', changed);
    addEventListener(ADMIN_AUTH_CHANGE, changed);
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted.current = false;
      revision.current++;
      removeEventListener('focus', changed);
      removeEventListener(ADMIN_AUTH_CHANGE, changed);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);
  useEffect(() => {
    if (state.status !== 'admin') return;
    const timer = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(timer);
  }, [state.status, refresh]);

  const value = useMemo(() => ({ ...state, refresh, login, logout }), [state, refresh, login, logout]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAdminAuth(): AuthContext {
  const value = useContext(Context);
  if (!value) throw new Error('useAdminAuth fora de AdminAuthProvider');
  return value;
}
