import { useEffect, useState } from 'react';

/** Roteador mínimo baseado na History API. */
export type Route = { name: 'home' } | { name: 'admin' } | { name: 'management' } | { name: 'scrim'; id: string } | { name: 'brasa-preview' };

function parse(pathname: string): Route {
  if (/^\/preview\/brasa\/?$/.test(pathname)) return { name: 'brasa-preview' };
  if (/^\/admin\/management\/?$/.test(pathname)) return { name: 'management' };
  if (/^\/admin\/?$/.test(pathname)) return { name: 'admin' };
  const m = /^\/s\/([a-z0-9]{6,32})\/?$/.exec(pathname);
  return m ? { name: 'scrim', id: m[1]! } : { name: 'home' };
}

export function navigate(to: string) {
  history.pushState(null, '', to);
  dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(parse(location.pathname));
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  return route;
}

/** Only destinations implemented by this app can receive a post-login return. */
export function safeAdminReturnTo(value: string | null): string {
  if (value === '/') return '/';
  if (value === '/admin/management') return value;
  if (value && value === value.trim() && /^\/s\/[a-z0-9]{6,32}\/?$/.test(value)) return value;
  return '/admin';
}
