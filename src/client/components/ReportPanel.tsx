import { useRef, useState, type FormEvent } from 'react';
import { buildMapReport, drawResultLabel, drawStatusLabel, kd, playerTotals } from '../../shared/report';
import { TEAM_IDS, seriesScore, seriesWinner } from '../../shared/scrim';
import { fmtDateTime } from '../util';
import { adminFetch } from '../authFetch';
import { StatsTable } from './MatchPanel';
import { useRoom } from './ScrimRoom';

export function ReportPanel({ scrimId }: { scrimId: string }) {
  const { state, can, act } = useRoom();
  const [note, setNote] = useState('');
  const [downloading, setDownloading] = useState<'md' | 'json' | null>(null);
  const [downloadError, setDownloadError] = useState('');
  const downloadLocked = useRef(false);
  const t = (id: 'A' | 'B') => state.teams[id].name;
  const series = seriesScore(state);
  const winner = seriesWinner(state);
  const totals = playerTotals(state);

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (await act({ type: 'note.add', text: note })) setNote('');
  }

  async function download(format: 'md' | 'json') {
    if (downloadLocked.current) return;
    downloadLocked.current = true; setDownloading(format); setDownloadError('');
    let objectUrl: string | undefined;
    let link: HTMLAnchorElement | undefined;
    try {
      const response = await adminFetch(`/api/scrims/${scrimId}${format === 'md' ? '/report.md' : ''}`, { cache: 'no-store' });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : '';
        setDownloadError(message || 'Não foi possível baixar o arquivo. Confira seu acesso e tente novamente.');
        return;
      }
      objectUrl = URL.createObjectURL(await response.blob());
      link = document.createElement('a');
      link.href = objectUrl; link.download = `scrim-${scrimId}.${format}`;
      document.body.appendChild(link); link.click();
    } catch {
      setDownloadError('Não foi possível baixar o arquivo. Confira sua conexão e tente novamente.');
    } finally {
      link?.remove();
      if (objectUrl) {
        const pendingUrl = objectUrl;
        // Give the browser time to start reading the file before releasing it.
        setTimeout(() => URL.revokeObjectURL(pendingUrl), 1000);
      }
      downloadLocked.current = false; setDownloading(null);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="row wrap">
          <h2 className="grow">
            {t('A')} {series.A} x {series.B} {t('B')} {winner ? `· vitória de ${t(winner)}` : '· em andamento'}
          </h2>
          <button type="button" disabled={downloading !== null} onClick={() => void download('md')}>
            Baixar relatório (.md)
          </button>
          <button type="button" disabled={downloading !== null} onClick={() => void download('json')}>
            Exportar dados (.json)
          </button>
        </div>
        {downloading && <p className="muted small" role="status">Preparando {downloading === 'md' ? 'relatório' : 'dados'} para baixar…</p>}
        {downloadError && <p role="alert">{downloadError}</p>}
        <p className="muted small">
          O JSON traz o log completo de eventos com horário: dá para reconstruir a scrim round a round ou cruzar com a
          gravação em vídeo.
        </p>
      </section>

      {state.maps.map((map, i) => {
        if (!map.rounds.length) return null;
        const r = buildMapReport(state, map, i);
        return (
          <div key={i} className="stack"><section className="card">
            <h2>
              Mapa {i + 1}: {r.mapName} <span className="muted">(pick {r.pickedBy})</span>
            </h2>
            <p className="big">
              {t('A')} <b>{r.score.A}</b> x <b>{r.score.B}</b> {t('B')}
              {r.overtime && <span className="badge">OT</span>}
              {!!r.durationMin && <span className="muted small"> · ~{r.durationMin} min</span>}
            </p>
            <table className="stats">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Lado inicial</th>
                  <th>Rounds ataque</th>
                  <th>Rounds defesa</th>
                </tr>
              </thead>
              <tbody>
                {TEAM_IDS.map((id) => (
                  <tr key={id} className={`team-${id}`}>
                    <td>{t(id)}</td>
                    <td>{(map.source?.actualStartingSide ?? map.startingSide)?.[id] === 'atk' ? 'Ataque' : 'Defesa'}</td>
                    <td>{r.bySide[id].atk}</td>
                    <td>{r.bySide[id].def}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="facts">
              {r.pistols.map((p) => (
                <li key={p.round}>
                  Pistol R{p.round}: <b>{t(p.winner)}</b>
                </li>
              ))}
              {r.longestStreak && (
                <li>
                  Maior sequência: <b>{t(r.longestStreak.team)}</b>, {r.longestStreak.length} rounds (desde o R{r.longestStreak.from})
                </li>
              )}
            </ul>
          </section>{map.source && <StatsTable map={map} index={i} />}</div>
        );
      })}

      {totals.length > 0 && (
        <section className="card">
          <h2>Totais por jogador</h2>
          <table className="stats">
            <thead>
              <tr>
                <th>Jogador</th>
                <th>Mapas</th>
                <th>K</th>
                <th>D</th>
                <th>A</th>
                <th>K/D</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((p) => (
                <tr key={p.playerId} className={`team-${p.team}`}>
                  <td>{p.name}</td>
                  <td>{p.maps}</td>
                  <td>{p.kills}</td>
                  <td>{p.deaths}</td>
                  <td>{p.assists}</td>
                  <td>{kd(p.kills, p.deaths)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!!state.draws?.length && <section className="card room-draw-history" aria-labelledby="report-draws-title">
        <h2 id="report-draws-title">Sorteios</h2>
        <ol className="notes">
          {state.draws.map(draw => <li key={draw.id}>
            <strong>{draw.kind === 'captains' ? 'Capitães' : 'Cara ou coroa'}: {draw.purpose}</strong>
            <div>{drawResultLabel(draw)}</div>
            <div className="muted small">{fmtDateTime(draw.startedAt)} — {drawStatusLabel(draw, Date.now())}</div>
          </li>)}
        </ol>
      </section>}

      <section className="card" data-room-focus="notes">
        <h2>Anotações para o report</h2>
        {state.notes.length === 0 && <p className="muted">Nenhuma anotação.</p>}
        <ul className="notes">
          {state.notes.map((n, i) => (
            <li key={i}>
              <span className="muted small">{fmtDateTime(n.at)}</span> {n.text}
            </li>
          ))}
        </ul>
        {can('manageNotes') && (
          <form className="row" onSubmit={addNote}>
            <input className="grow" value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} placeholder="Ex.: retake do B na Lotus precisa de mais utilitária" />
            <button disabled={!note.trim()}>Anotar</button>
          </form>
        )}
      </section>
    </div>
  );
}
