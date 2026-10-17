export type IconName = 'grid' | 'users' | 'shield' | 'crosshair' | 'chart' | 'history' | 'arrow' | 'back' | 'copy' | 'check' | 'search' | 'close' | 'download' | 'eye' | 'plus' | 'drag' | 'link';
const paths: Record<IconName, string> = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  shield: 'M12 22s9-4 9-11V5l-9-3-9 3v6c0 7 9 11 9 11z M8 12l3 3 5-6',
  crosshair: 'M12 2v4 M12 18v4 M2 12h4 M18 12h4 M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14z',
  chart: 'M4 20h16 M7 16v-5 M12 16V4 M17 16V8',
  history: 'M3 12a9 9 0 1 0 2.6-6.4 M3 3v6h6 M12 7v5l3 2',
  arrow: 'M5 12h14 M13 6l6 6-6 6', back: 'M19 12H5 M11 6l-6 6 6 6',
  copy: 'M9 9h12v12H9z M15 5V3H3v12h2', check: 'M5 12l4 4L19 6',
  search: 'M21 21l-5-5 M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', close: 'M6 6l12 12 M18 6L6 18',
  download: 'M12 3v12 M7 10l5 5 5-5 M5 16v5h14v-5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  plus: 'M12 5v14 M5 12h14', drag: 'M9 5h.01 M15 5h.01 M9 12h.01 M15 12h.01 M9 19h.01 M15 19h.01',
  link: 'M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2',
};
export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
