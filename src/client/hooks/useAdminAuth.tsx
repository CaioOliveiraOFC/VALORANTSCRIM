import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { adminFetch } from '../authFetch';
import { noPermissions, PERMISSION_KEYS, presetPermissions, type AdminPermissionKey, type AdminPermissions } from '../../shared/adminPermissions';

export type AdminAuthStatus = 'loading' | 'admin' | 'viewer' | 'error';
interface AuthState { status: AdminAuthStatus; email?: string; isSuperAdmin: boolean; permissions: AdminPermissions; canDeleteRooms: boolean; }
interface AuthContext extends AuthState {
  can: (permission: AdminPermissionKey) => boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}
const Context = createContext<AuthContext | null>(null);
export const ADMIN_AUTH_CHANGE = 'scrim-auth-change';

type AuthReply = { authenticated?: boolean; user?: { email?: string }; isSuperAdmin?: unknown; permissions?: Partial<Record<AdminPermissionKey | 'canDeleteRooms', unknown>>; error?: string };
const emptyState = (status: AdminAuthStatus): AuthState => ({ status, isSuperAdmin: false, permissions: noPermissions(), canDeleteRooms: false });
function authenticatedState(body: AuthReply, fallbackEmail?: string): AuthState {
  if (body.authenticated !== true) return emptyState('viewer');
  const isSuperAdmin = body.isSuperAdmin === true;
  const permissions = isSuperAdmin ? presetPermissions('full') : noPermissions();
  if (!isSuperAdmin) for (const key of PERMISSION_KEYS) permissions[key] = body.permissions?.[key] === true;
  return { status: 'admin', email: body.user?.email ?? fallbackEmail, isSuperAdmin, permissions, canDeleteRooms: permissions.deleteRooms };
}
async function reply(response: Response): Promise<AuthReply> {
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : 'Não foi possível verificar o acesso. Tente novamente.');
  return value;
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => emptyState('loading'));
  const revision = useRef(0);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try {
      const body = await reply(await adminFetch('/api/admin/session', { cache: 'no-store', credentials: 'same-origin' }));
      if (mounted.current && request === revision.current) {
        setState(authenticatedState(body));
      }
    } catch {
      if (mounted.current && request === revision.current) setState(emptyState('error'));
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const request = ++revision.current;
    const body = await reply(await adminFetch('/api/admin/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
    }));
    if (body.authenticated !== true) throw new Error('Este acesso de administrador não está liberado. Fale com o responsável pela sala.');
    if (mounted.current && request === revision.current) setState(authenticatedState(body, email.trim()));
    dispatchEvent(new Event(ADMIN_AUTH_CHANGE));
  }, []);

  const logout = useCallback(async () => {
    const request = ++revision.current;
    await reply(await adminFetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' }));
    if (mounted.current && request === revision.current) setState(emptyState('viewer'));
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

  const can = useCallback((permission: AdminPermissionKey) => state.status === 'admin' && (state.isSuperAdmin || state.permissions[permission] === true), [state]);
  const value = useMemo(() => ({ ...state, can, refresh, login, logout }), [state, can, refresh, login, logout]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAdminAuth(): AuthContext {
  const value = useContext(Context);
  if (!value) throw new Error('useAdminAuth fora de AdminAuthProvider');
  return value;
}
