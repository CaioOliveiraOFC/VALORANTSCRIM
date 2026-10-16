import { useEffect, useState } from 'react';

/** Roteador mínimo baseado na History API: "/" e "/s/:id". */
export type Route = { name: 'home' } | { name: 'scrim'; id: string };

function parse(pathname: string): Route {
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
