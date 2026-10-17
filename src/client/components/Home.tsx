import { useEffect, useState, type FormEvent } from 'react';
import type { CreateScrimResponse, ScrimSummary } from '../../shared/protocol';
import { FORMAT_LABEL, type SeriesFormat } from '../../shared/veto';
import { navigate } from '../router';
import { Icon } from './Icon';
import { MAPS, ALL_MAP_IDS, mapImageUrl } from '../../shared/maps';
import { fmtDateTime } from '../util';

const PHASE_LABEL: Record<ScrimSummary['phase'], string> = {
  setup: 'Montando times',
  veto: 'Veto',
  live: 'Ao vivo',
  finished: 'Encerrada',
};

export function Home() {
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<SeriesFormat>('bo3');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'live' | 'finished'>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [history, setHistory] = useState<ScrimSummary[] | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/scrims', { signal: ctrl.signal })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setHistory)
      .catch(() => { if (!ctrl.signal.aborted) { setHistoryError(true); setHistory([]); } });
    return () => ctrl.abort();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/scrims', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim() || `Scrim ${new Date().toLocaleDateString('pt-BR')}`, format }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Falha ao criar a scrim.');
      const { id, adminKey } = body as CreateScrimResponse;
      navigate(`/s/${id}#admin=${encodeURIComponent(adminKey)}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }


  const liveCount = history?.filter(h => h.phase === 'live' || h.phase === 'veto').length ?? 0;
  const finishedCount = history?.filter(h => h.phase === 'finished').length ?? 0;
  const visible = history?.filter(h => (filter === 'all' || (filter === 'live' ? h.phase === 'live' || h.phase === 'veto' : h.phase === 'finished')) &&
    `${h.title} ${h.teams.join(' ')} ${h.maps.join(' ')}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));

  return <main className="page home-page" id="main-content" tabIndex={-1}>
    <header className="home-intro">
      <div><p className="eyebrow">SEU PONTO DE ENCONTRO</p><h1>Boas partidas.<br /><span>Grandes histórias.</span></h1>
        <p className="home-description">Do primeiro veto ao último round. Organize os times e acompanhe cada resultado com a galera.</p><a className="button primary home-create-shortcut" href="#new-scrim"><Icon name="plus" />Nova scrim</a></div>
      <div className="hero-emblem" aria-hidden="true"><Icon name="crosshair" /><span>PRONTO PARA<br />O PRÓXIMO ROUND?</span></div>
    </header>
    <div className="dashboard-stats" aria-label="Resumo das scrims">
      <div><span className="stat-icon"><Icon name="grid" /></span><div><strong>{history === null ? '—' : history.length}</strong><span>Scrims criadas</span></div></div>
      <div><span className="stat-icon live"><Icon name="crosshair" /></span><div><strong>{history === null ? '—' : liveCount}</strong><span>Em jogo ou veto</span></div></div>
      <div><span className="stat-icon done"><Icon name="check" /></span><div><strong>{history === null ? '—' : finishedCount}</strong><span>Finalizadas</span></div></div>
    </div>
    <div className="home-grid">
      <section className="history-section">
        <div className="section-heading"><div><p className="eyebrow">SUAS PARTIDAS</p><h2>Central de scrims</h2></div><span className="count-label">{history?.length ?? '—'} salas</span></div>
        <div className="history-toolbar">
          <div className="filter-tabs" role="group" aria-label="Filtrar scrims">
            {([['all','Todas'],['live','Em jogo'],['finished','Finalizadas']] as const).map(([value,label]) => <button key={value} className={filter === value ? 'on' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
          </div>
          <label className="search-field"><Icon name="search" /><input aria-label="Buscar scrims" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar uma scrim…" /></label>
        </div>
        {historyError ? <p className="card error" role="alert">Não foi possível carregar o histórico. Recarregue a página para tentar novamente.</p> : history === null ? <p className="card muted">Carregando suas scrims…</p> : !visible?.length ?
          <div className="card empty-state"><Icon name="crosshair" /><h3>{history.length ? 'Nenhuma scrim encontrada' : 'A primeira scrim é com você'}</h3><p>{history.length ? 'Tente outro nome ou filtro.' : 'Crie uma sala, chame o time e comece o veto.'}</p></div> :
          <ul className="history">{visible.map(h => {
            const mapId = ALL_MAP_IDS.find(id => MAPS[id].name === h.maps[0]);
            return <li key={h.id}><a href={`/s/${h.id}`} onClick={e => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); navigate(`/s/${h.id}`); } }}>
              <div className="history-map" style={mapId ? { backgroundImage: `linear-gradient(0deg,rgba(9,14,20,.9),rgba(9,14,20,.05)),url(${mapImageUrl(mapId)})` } : undefined}><Icon name="crosshair" /><span>{h.maps[0] ?? 'AGUARDANDO VETO'}</span></div>
              <div className="history-info"><div className="history-title"><strong>{h.title}</strong><span className={`badge ${h.phase}`}>{PHASE_LABEL[h.phase]}</span></div><span className="history-teams">{h.teams[0]} <span className="muted">vs</span> {h.teams[1]}</span><small className="muted">{fmtDateTime(h.createdAt)}{h.maps.length > 0 && ` · ${h.maps.length} mapas`}</small></div>
              <div className="history-result"><strong>{h.score[0]}<span>:</span>{h.score[1]}</strong><span>PLACAR DA SÉRIE</span></div><Icon name="arrow" className="history-arrow" />
            </a></li>;
          })}</ul>}
      </section>
      <aside className="create-sidebar"><form className="card create" id="new-scrim" tabIndex={-1} onSubmit={create}>
        <div className="create-icon"><Icon name="plus" /></div><p className="eyebrow">CHAME O TIME</p><h2>Nova scrim</h2><p className="muted small">Uma sala para organizar tudo. Um link para todos acompanharem.</p>
        <label>Nome da sala<input value={title} onChange={e => setTitle(e.target.value)} placeholder="Scrim de sexta" maxLength={60} /></label>
        <label>Formato da série</label><fieldset className="segmented" aria-label="Formato">{(Object.keys(FORMAT_LABEL) as SeriesFormat[]).map(f => <label key={f} className={f === format ? 'on' : ''}><input type="radio" name="format" value={f} checked={f === format} onChange={() => setFormat(f)} />{FORMAT_LABEL[f]}</label>)}</fieldset>
        <button className="primary" disabled={busy}>{busy ? 'Criando sala…' : 'Criar scrim'}<Icon name="arrow" /></button>
        <p className="create-footnote"><Icon name="shield" />Você será o admin desta sala.</p>
        {error && <p className="error" role="alert">{error}</p>}
      </form></aside>
    </div>
  </main>;
}
