import { useEffect, useState, type FormEvent } from 'react';
import type { CreateScrimResponse, ScrimSummary } from '../../shared/protocol';
import { FORMAT_LABEL, type SeriesFormat } from '../../shared/veto';
import { navigate } from '../router';
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ScrimSummary[] | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/scrims', { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then(setHistory)
      .catch(() => setHistory([]));
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

  return (
    <main className="page">
      <header className="hero">
        <h1>
          Scrims <span className="accent">VALORANT</span>
        </h1>
        <p className="muted">Um admin organiza; todo mundo acompanha veto e placar em tempo real pelo link.</p>
      </header>

      <form className="card create" onSubmit={create}>
        <h2>Nova scrim</h2>
        <label>
          Nome
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Scrim de sexta" maxLength={60} />
        </label>
        <fieldset className="segmented" aria-label="Formato">
          {(Object.keys(FORMAT_LABEL) as SeriesFormat[]).map((f) => (
            <label key={f} className={f === format ? 'on' : ''}>
              <input type="radio" name="format" value={f} checked={f === format} onChange={() => setFormat(f)} />
              {FORMAT_LABEL[f]}
            </label>
          ))}
        </fieldset>
        <button className="primary" disabled={busy}>
          {busy ? 'Criando…' : 'Criar e virar admin'}
        </button>
        {error && <p className="error">{error}</p>}
      </form>

      <section className="card">
        <h2>Histórico</h2>
        {history === null ? (
          <p className="muted">Carregando…</p>
        ) : history.length === 0 ? (
          <p className="muted">Nenhuma scrim gravada ainda.</p>
        ) : (
          <ul className="history">
            {history.map((h) => (
              <li key={h.id}>
                <a
                  href={`/s/${h.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(`/s/${h.id}`);
                  }}
                >
                  <strong>{h.title}</strong>
                  <span className="muted">{fmtDateTime(h.createdAt)}</span>
                  <span>
                    {h.teams[0]} <b>{h.score[0]}</b> x <b>{h.score[1]}</b> {h.teams[1]}
                  </span>
                  <span className="muted">{h.maps.join(' · ')}</span>
                  <span className={`badge ${h.phase}`}>{PHASE_LABEL[h.phase]}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
