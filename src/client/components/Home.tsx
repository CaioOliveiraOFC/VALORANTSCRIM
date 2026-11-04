import { useEffect, useState, type MouseEvent } from 'react';
import type { ScrimSummary } from '../../shared/protocol';
import { useAdminAuth } from '../hooks/useAdminAuth';
import { navigate } from '../router';
import { fmtDateTime } from '../util';

const PHASE_LABEL: Record<ScrimSummary['phase'], string> = {
  setup: 'Montando times', veto: 'Veto', live: 'Ao vivo', finished: 'Encerrada',
};
function internal(event: MouseEvent<HTMLAnchorElement>) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); navigate(event.currentTarget.getAttribute('href') ?? '/');
}
export function Home() {
  const auth = useAdminAuth();
  const [history, setHistory] = useState<ScrimSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  useEffect(() => {
    const ctrl = new AbortController(); setError(false);
    fetch('/api/scrims', { signal: ctrl.signal, cache: 'no-store' })
      .then(async response => { if (!response.ok) throw new Error(); const body = await response.json(); if (!Array.isArray(body)) throw new Error(); return body as ScrimSummary[]; })
      .then(value => { if (!ctrl.signal.aborted) setHistory(value); })
      .catch(() => { if (!ctrl.signal.aborted) setError(true); });
    return () => ctrl.abort();
  }, [retry]);
  const visible = history?.filter(room => `${room.title} ${room.teams.join(' ')} ${room.maps.join(' ')}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  return <main className="page public-lobby">
    <header className="public-lobby-heading"><div><span className="admin-mode-label">Para acompanhar</span><h1>Acompanhar uma scrim</h1><p className="muted">Escolha uma sala para ver os times, o veto e os resultados. Não precisa de login.</p></div><a className="button" href="/admin" onClick={internal}>{auth.status === 'admin' ? 'Área do administrador' : 'Entrar como admin'}</a></header>
    <section className="card public-room-section"><div className="admin-room-heading"><h2>Salas e histórico</h2><label><span className="admin-sr-only">Buscar scrims</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar sala, time ou mapa" /></label></div>
      {error ? <div className="admin-list-error" role="alert"><p>Não foi possível carregar as salas.</p><button type="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div> : history === null ? <p className="muted" role="status">Carregando salas…</p> : !visible?.length ? <p className="muted">{history.length ? 'Nenhuma sala encontrada. Tente outro nome ou filtro.' : 'Ainda não há scrims para acompanhar.'}</p> : <ul className="history">{visible.map(room => <li key={room.id}><a href={`/s/${room.id}`} onClick={internal}><strong>{room.title}</strong><span className="muted">{fmtDateTime(room.createdAt)}</span><span>{room.teams[0]} <b>{room.score[0]}</b> x <b>{room.score[1]}</b> {room.teams[1]}</span><span className="muted">{room.maps.join(' · ')}</span><span className={`badge ${room.phase}`}>{PHASE_LABEL[room.phase]}</span></a></li>)}</ul>}
    </section>
  </main>;
}
