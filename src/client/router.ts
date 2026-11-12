import { useEffect, useState } from 'react';

/** Roteador mínimo baseado na History API. */
export type Route =
  | { name: 'home' }
  | { name: 'admin' }
  | { name: 'management' }
  | { name: 'scrim'; id: string }
  | { name: 'brasa-preview' }
  | { name: 'vct' }
  | { name: 'history' }
  | { name: 'x1' };

export function parseRoute(pathname: string): Route {
  if (/^\/vct\/?$/.test(pathname)) return { name: 'vct' };
  if (/^\/historico\/?$/.test(pathname)) return { name: 'history' };
  if (/^\/x1\/?$/.test(pathname)) return { name: 'x1' };
  if (/^\/preview\/brasa\/?$/.test(pathname)) return { name: 'brasa-preview' };
  if (/^\/admin\/management\/?$/.test(pathname)) return { name: 'management' };
  if (/^\/admin\/?$/.test(pathname)) return { name: 'admin' };
  const m = /^\/s\/([a-z0-9]{6,32})\/?$/.exec(pathname);
  return m ? { name: 'scrim', id: m[1]! } : { name: 'home' };
}

export function navigate(to: string) {
  history.pushState(null, '', to);
  dispatchEvent(new PopStateEvent('popstate'));
  if (typeof window !== 'undefined') window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  if (typeof requestAnimationFrame === 'function')
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('#page-content')?.focus({ preventScroll: true }),
    );
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname));
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  return route;
}

/** Only destinations implemented by this app can receive a post-login return. */
export function safeAdminReturnTo(value: string | null): string {
  if (value && ['/', '/vct', '/historico', '/x1'].includes(value)) return value;
  if (value === '/admin/management') return value;
  if (value && value === value.trim() && /^\/s\/[a-z0-9]{6,32}\/?$/.test(value)) return value;
  return '/admin';
}
