import { useState } from 'react';
import { MAPS } from '../../shared/maps';
import { extractMatchId, suggestLinks, validateMapping, type ExternalMatch, type PlayerLink } from '../../shared/imports';
import { currentMapIndex, type ScrimState, type TeamId } from '../../shared/scrim';
import { useRoom } from './ScrimRoom';

const date = (ms: number) => new Date(ms).toLocaleString('pt-BR');
const riotId = (p: ExternalMatch['players'][number]) => `${p.name}#${p.tag}`;

export function PlayerMatcher({ state, match, redTeam, links, onChange, disabled = false }: {
  state: ScrimState; match: ExternalMatch; redTeam: TeamId; links: PlayerLink[];
  onChange: (links: PlayerLink[]) => void; disabled?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  function assign(playerId: string, puuid: string) {
    if (disabled) return;
    const manual = state.players.find(p => p.id === playerId);
    const remote = match.players.find(p => p.puuid === puuid);
    if (!manual || !remote) return;
    const team = remote.team === 'Red' ? redTeam : redTeam === 'A' ? 'B' : 'A';
    if (manual.team !== team) { setNotice('Este jogador pertence ao outro time. Confira a correspondência Red/Blue.'); return; }
    onChange([...links.filter(l => l.playerId !== playerId && l.puuid !== puuid), { playerId, puuid }]);
    setSelected(null); setNotice(`Associação feita: ${manual.name} ↔ ${riotId(remote)}.`);
  }
  return <div className="player-matcher">
    <p id="mapping-instructions" className="muted small">Arraste um jogador da API para um nome da scrim. Ou toque no jogador da API e depois no nome correspondente. Os apelidos da scrim serão mantidos.</p>
    <p role="status" aria-live="polite">{links.length} de 10 jogadores associados. {notice}</p>
    <div className="mapping-columns" aria-describedby="mapping-instructions">
      <section><h3>Jogadores da API</h3>
        {(['Red', 'Blue'] as const).map(t => <div key={t} className="mapping-team">
          <h4>{t} → {state.teams[t === 'Red' ? redTeam : redTeam === 'A' ? 'B' : 'A'].name}</h4>
          {match.players.filter(p => p.team === t).map(p => {
            const owner = links.find(l => l.puuid === p.puuid);
            return <button type="button" key={p.puuid} className={`mapping-player ${selected === p.puuid ? 'on' : ''} ${owner ? 'linked' : ''}`}
              draggable={!disabled} disabled={disabled} aria-pressed={selected === p.puuid}
              aria-label={`Selecionar ${riotId(p)}`} onClick={() => setSelected(selected === p.puuid ? null : p.puuid)}
              onDragStart={e => { e.dataTransfer.setData('text/plain', p.puuid); e.dataTransfer.effectAllowed = 'move'; setSelected(p.puuid); }}>
              <strong>{riotId(p)}</strong><small>{p.agent} · {p.kills}/{p.deaths}/{p.assists}</small>
              {owner && <small>↔ {state.players.find(x => x.id === owner.playerId)?.name}</small>}
            </button>;
          })}
        </div>)}
      </section>
      <section><h3>Nomes da scrim</h3>
        {(['A', 'B'] as const).map(t => <div key={t} className="mapping-team">
          <h4>{state.teams[t].name}</h4>
          {state.players.filter(p => p.team === t).map(p => {
            const link = links.find(l => l.playerId === p.id);
            const remote = match.players.find(x => x.puuid === link?.puuid);
            return <div key={p.id} className={`mapping-target ${link ? 'linked' : 'pending'}`}
              onDragOver={e => { if (!disabled) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
              onDrop={e => { e.preventDefault(); assign(p.id, e.dataTransfer.getData('text/plain')); }}>
              <button type="button" disabled={disabled || !selected} aria-label={`Associar a ${p.name}`} onClick={() => selected && assign(p.id, selected)}>
                <strong>{p.name}</strong><small>{remote ? `↔ ${riotId(remote)}` : 'Solte aqui ou selecione um jogador'}</small>
              </button>
              {link && <button type="button" className="ghost" disabled={disabled} aria-label={`Remover associação de ${p.name}`}
                onClick={() => { onChange(links.filter(l => l.playerId !== p.id)); setNotice(`Associação de ${p.name} removida.`); }}>Remover</button>}
            </div>;
          })}
        </div>)}
      </section>
    </div>
  </div>;
}

export function ImportMatchPanel({ mapIndex }: { mapIndex: number }) {
  const { state, isAdmin, importRequest } = useRoom();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('br');
  const [matches, setMatches] = useState<ExternalMatch[]>([]);
  const [match, setMatch] = useState<ExternalMatch | null>(null);
  const [redTeam, setRedTeam] = useState<TeamId>('A');
  const [links, setLinks] = useState<PlayerLink[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [version, setVersion] = useState(state.version);
  const target = state.maps[mapIndex]!;
  if (!isAdmin) return null;
  const eligible = state.phase === 'live' && currentMapIndex(state) === mapIndex && !target.rounds.length && !Object.keys(target.stats).length;
  function select(next: ExternalMatch) {
    const a = suggestLinks(state, next, 'A'), b = suggestLinks(state, next, 'B');
    const suggestedTeam = a.length === b.length ? redTeam : a.length > b.length ? 'A' : 'B';
    setRedTeam(suggestedTeam); setMatch(next); setLinks(suggestedTeam === 'A' ? a : b);
    setReviewed(false); setVersion(state.version); setError('');
  }
  async function search() {
    setBusy(true); setError(''); setMatch(null); setMatches([]); setSuccess(false);
    try {
      const id = extractMatchId(query);
      const result = await importRequest(id ? { action: 'detail', region, matchId: id } : { action: 'search', region, riotId: query });
      if (result.match) select(result.match);
      else { setMatches(result.matches ?? []); if (!result.matches?.length) setError('Nenhuma customizada 5v5 completa encontrada entre as partidas recentes.'); }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  let mappingError = '';
  if (match) { try { validateMapping(state, match, links, redTeam); } catch (e) { mappingError = (e as Error).message; } }
  async function confirmImport() {
    if (!match || !reviewed || mappingError) return;
    setBusy(true); setError('');
    try {
      await importRequest({ action: 'confirm', region: match.region, matchId: match.id, mapIndex, redTeam, links, expectedVersion: version });
      setMatch(null); setMatches([]); setSuccess(true); setOpen(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="card import-panel">
    <div className="row wrap"><h2 className="grow">Importar partida</h2>
      <button type="button" disabled={!eligible || busy} onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Fechar importação' : 'Buscar customizada'}</button>
    </div>
    {!eligible && <p className="muted small">Disponível no próximo mapa da série, sem placar ou estatísticas preenchidos. Resultados existentes são preservados.</p>}
    {success && <p role="status">Partida importada. Nomes preservados e associações salvas para os próximos mapas.</p>}
    {error && <p className="import-error" role="alert">{error}</p>}
    {open && <div className="stack" aria-busy={busy}>
      <p className="muted small">Importe uma partida já encerrada. Confira mapa, horário e jogadores antes de confirmar.</p>
      <form className="row wrap" onSubmit={e => { e.preventDefault(); void search(); }}>
        <label className="grow">Riot ID ou link da partida<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nome#TAG ou link do Tracker" maxLength={250} required disabled={busy} /></label>
        <label>Região<select value={region} onChange={e => setRegion(e.target.value)} disabled={busy}>
          {[['br','Brasil'],['latam','América Latina'],['na','América do Norte'],['eu','Europa'],['ap','Ásia/Pacífico'],['kr','Coreia']].map(([v,label]) => <option key={v} value={v}>{label}</option>)}
        </select></label><button disabled={busy || !query.trim()}>{busy ? 'Consultando…' : 'Buscar partidas'}</button>
      </form>
      {matches.length > 0 && <div className="import-results"><h3>Customizadas recentes</h3>{matches.map(m => <button type="button" key={m.id} disabled={busy} className={match?.id === m.id ? 'on' : ''} onClick={() => select(m)}>
        <strong>{MAPS[m.mapId].name} · Red {m.score.Red} × {m.score.Blue} Blue</strong><small>{date(m.startedAt)} · {m.players.map(p => p.name).join(', ')}</small>
      </button>)}</div>}
      {match && <>
        <div className="callout"><strong>{MAPS[match.mapId].name} · {match.score.Red} × {match.score.Blue}</strong> · {date(match.startedAt)} · {Math.round(match.durationMs / 60000)} min
          <p>Destino: mapa {mapIndex + 1}, {MAPS[target.mapId].name}. Os nomes manuais, o veto e as anotações serão mantidos.</p>
          {match.startedAt < state.createdAt && <p>Esta partida aconteceu antes da criação da scrim. Confirme se escolheu o histórico correto.</p>}
        </div>
        {match.mapId !== target.mapId && <p role="alert" className="import-error">Mapa diferente. Escolha uma partida de {MAPS[target.mapId].name}.</p>}
        <label>O time Red da API corresponde a<select value={redTeam} disabled={busy} onChange={e => {
          const t = e.target.value as TeamId; setRedTeam(t); setLinks(suggestLinks(state, match, t)); setReviewed(false);
        }}><option value="A">{state.teams.A.name}</option><option value="B">{state.teams.B.name}</option></select></label>
        <PlayerMatcher key={`${match.id}-${redTeam}`} state={state} match={match} redTeam={redTeam} links={links} disabled={busy} onChange={next => { setLinks(next); setReviewed(false); }} />
        <button type="button" className="ghost" disabled={busy} onClick={() => { setLinks(suggestLinks(state, match, redTeam)); setReviewed(false); }}>Sugerir por nome e vínculos salvos</button>
        {mappingError && <p className="muted small">{mappingError}</p>}
        {version !== state.version && <p role="alert">A sala mudou desde a seleção. <button type="button" disabled={busy} onClick={() => { setVersion(state.version); setReviewed(false); }}>Revisar versão atual</button></p>}
        <label className="mapping-review"><input type="checkbox" checked={reviewed} disabled={busy || !!mappingError} onChange={e => setReviewed(e.target.checked)} />Conferi as dez associações, os times, o mapa e o resultado. Confirmar associações.</label>
        <button type="button" className="primary" disabled={busy || !eligible || !reviewed || !!mappingError || match.mapId !== target.mapId || version !== state.version} onClick={() => void confirmImport()}>{busy ? 'Importando…' : 'Importar placar, rounds e estatísticas'}</button>
      </>}
    </div>}
  </section>;
}
