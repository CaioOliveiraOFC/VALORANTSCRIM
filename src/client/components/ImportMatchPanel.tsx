import { useEffect, useRef, useState } from 'react';
import { MAPS } from '../../shared/maps';
import { extractMatchId, suggestLinks, validateMapping, type ExternalMatch, type PlayerLink } from '../../shared/imports';
import { currentMapIndex, type ScrimState, type TeamId } from '../../shared/scrim';
import { Icon } from './Icon';
import { useRoom } from './ScrimRoom';

const date = (ms: number) => new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const riotId = (p: ExternalMatch['players'][number]) => `${p.name}#${p.tag}`;

export function PlayerMatcher({ state, match, redTeam, links, onChange, disabled = false }: {
  state: ScrimState; match: ExternalMatch; redTeam: TeamId; links: PlayerLink[];
  onChange: (links: PlayerLink[]) => void; disabled?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [activeTeam, setActiveTeam] = useState<TeamId>('A');
  const [showCards, setShowCards] = useState(false);
  const remoteTeam = activeTeam === redTeam ? 'Red' : 'Blue';
  const roster = state.players.filter(p => p.team === activeTeam);
  const candidates = match.players.filter(p => p.team === remoteTeam);
  const count = (team: TeamId) => links.filter(l => state.players.some(p => p.id === l.playerId && p.team === team)).length;
  function assign(playerId: string, puuid: string) {
    if (disabled) return;
    if (!puuid) { onChange(links.filter(l => l.playerId !== playerId)); setNotice('Associação removida.'); return; }
    const manual = state.players.find(p => p.id === playerId);
    const remote = match.players.find(p => p.puuid === puuid);
    if (!manual || !remote) return;
    const team = remote.team === 'Red' ? redTeam : redTeam === 'A' ? 'B' : 'A';
    if (manual.team !== team) { setNotice('Este jogador pertence ao outro time. Confira a correspondência Red/Blue.'); return; }
    onChange([...links.filter(l => l.playerId !== playerId && l.puuid !== puuid), { playerId, puuid }]);
    setSelected(null); setNotice(`${manual.name} associado a ${riotId(remote)}.`);
  }
  return <div className="player-matcher">
    <div className="matcher-progress"><div><strong>{links.length}<span>/10</span></strong><span>jogadores associados</span></div><progress value={links.length} max={10} aria-label="Jogadores associados" /><span className={links.length === 10 ? 'success-text' : 'muted'}>{links.length === 10 ? 'Tudo conectado' : `${10-links.length} pendentes`}</span></div>
    <div className="matcher-team-tabs" role="group" aria-label="Time para associar">
      {(['A','B'] as const).map(t => <button key={t} type="button" className={`team-${t} ${activeTeam === t ? 'on' : ''}`} aria-pressed={activeTeam === t} onClick={() => { setActiveTeam(t); setSelected(null); }}><span className="team-letter">{t}</span><span>{state.teams[t].name}</span><small>{count(t) === 5 && <Icon name="check" />}{count(t)}/5</small></button>)}
    </div>
    <div className="matcher-tip"><Icon name="drag" /><p id="mapping-instructions" className="desktop-mapping-hint">Arraste entre os cartões ou escolha o jogador diretamente na lista de cada nome. Seus apelidos continuam iguais.</p><p className="mobile-mapping-hint">Escolha o jogador na lista ao lado de cada apelido.</p><button type="button" className="ghost mobile-card-toggle" onClick={() => setShowCards(!showCards)}>{showCards ? 'Ocultar cartões' : 'Ver cartões'}</button></div>
    <div className={`mapping-columns ${showCards ? 'show-cards' : ''}`} aria-describedby="mapping-instructions">
      <section className="manual-roster"><div className="mapping-column-title"><span>NOMES DA SUA SCRIM</span><small>{roster.length} jogadores</small></div>
        {roster.map((p,i) => {
          const link = links.find(l => l.playerId === p.id);
          return <div key={p.id} className={`mapping-target team-${activeTeam} ${link ? 'linked' : 'pending'} ${selected ? 'can-drop' : ''}`}
            onDragOver={e => { if (!disabled) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
            onDrop={e => { e.preventDefault(); assign(p.id, e.dataTransfer.getData('text/plain')); }}>
            <button type="button" className="manual-name" disabled={disabled} aria-label={`Associar a ${p.name}`} onClick={() => { if (selected) assign(p.id, selected); else document.getElementById(`link-${p.id}`)?.focus(); }}
              draggable={!disabled} onDragStart={e => { e.dataTransfer.setData('application/x-scrim-player',p.id); e.dataTransfer.setData('text/plain',`player:${p.id}`); e.dataTransfer.effectAllowed = 'move'; }}>
              <span className="player-avatar">{p.name.slice(0,2).toLocaleUpperCase('pt-BR')}</span><span><strong>{p.name}</strong><small>Jogador {i+1}</small></span><Icon name={link ? 'check' : 'drag'} />
            </button>
            <div className="mapping-select-row"><select id={`link-${p.id}`} aria-label={`Jogador do VALORANT para ${p.name}`} value={link?.puuid ?? ''} disabled={disabled} onChange={e => assign(p.id,e.target.value)}>
              <option value="">Escolher jogador…</option>{candidates.map(remote => {
                const owner = links.find(l => l.puuid === remote.puuid && l.playerId !== p.id);
                return <option key={remote.puuid} value={remote.puuid}>{riotId(remote)}{owner ? ` · associado a ${state.players.find(x => x.id === owner.playerId)?.name}` : ''}</option>;
              })}
            </select>{link && <button type="button" className="icon-button ghost" disabled={disabled} aria-label={`Remover associação de ${p.name}`} title="Remover associação" onClick={() => assign(p.id,'')}><Icon name="close" /></button>}</div>
          </div>;
        })}
      </section>
      <section className="api-roster"><div className="mapping-column-title"><span>JOGADORES DA PARTIDA</span><small>{remoteTeam}</small></div>
        {candidates.map(p => {
          const owner = links.find(l => l.puuid === p.puuid);
          return <button type="button" key={p.puuid} className={`mapping-player ${selected === p.puuid ? 'on' : ''} ${owner ? 'linked' : ''}`}
            draggable={!disabled} disabled={disabled} aria-pressed={selected === p.puuid} aria-label={`Selecionar ${riotId(p)}`}
            onClick={() => setSelected(selected === p.puuid ? null : p.puuid)}
            onDragStart={e => { e.dataTransfer.setData('text/plain',p.puuid); e.dataTransfer.effectAllowed='move'; setSelected(p.puuid); }}
            onDragOver={e => { if (!disabled) e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); const id=e.dataTransfer.getData('application/x-scrim-player') || e.dataTransfer.getData('text/plain').replace(/^player:/,''); assign(id,p.puuid); }}>
            <span className="agent-avatar">{p.agent.slice(0,2).toUpperCase()}</span><span className="api-player-info"><strong>{p.name}<span>#{p.tag}</span></strong><small>{p.agent} · {p.kills}/{p.deaths}/{p.assists}</small><small className={owner ? 'linked-label' : ''}>{owner ? `↔ ${state.players.find(x => x.id === owner.playerId)?.name}` : 'Disponível para associar'}</small></span><Icon name={owner ? 'check' : 'drag'} />
          </button>;
        })}
      </section>
    </div>
    <div className="matcher-bottom"><p role="status" aria-live="polite">{notice || 'As sugestões só serão salvas após sua confirmação.'}</p>{count(activeTeam) === 5 && count(activeTeam === 'A' ? 'B' : 'A') < 5 && <button type="button" className="secondary" onClick={() => { setActiveTeam(activeTeam === 'A' ? 'B' : 'A'); setSelected(null); }}>Associar {state.teams[activeTeam === 'A' ? 'B' : 'A'].name}<Icon name="arrow" /></button>}</div>
  </div>;
}

export function ImportMatchPanel({ mapIndex, onOpenChange }: { mapIndex: number; onOpenChange?: (open: boolean) => void }) {
  const { state, isAdmin, importRequest } = useRoom();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1|2|3>(1);
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
  const workspace = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) workspace.current?.scrollIntoView({ block: 'start', behavior: 'auto' }); },[open,step]);
  useEffect(() => { onOpenChange?.(open); return () => onOpenChange?.(false); },[open,onOpenChange]);
  if (!isAdmin) return null;
  const eligible = state.phase === 'live' && currentMapIndex(state) === mapIndex && !target.rounds.length && !Object.keys(target.stats).length;
  function select(next: ExternalMatch) {
    const a=suggestLinks(state,next,'A'), b=suggestLinks(state,next,'B');
    const t=a.length===b.length ? redTeam : a.length>b.length ? 'A' : 'B';
    setRedTeam(t); setMatch(next); setLinks(t==='A'?a:b); setReviewed(false); setVersion(state.version); setError(''); setStep(2);
  }
  async function search() {
    setBusy(true); setError(''); setMatch(null); setMatches([]); setSuccess(false);
    try {
      const id=extractMatchId(query);
      const result=await importRequest(id ? {action:'detail',region,matchId:id} : {action:'search',region,riotId:query});
      if (result.match) select(result.match);
      else { setMatches(result.matches??[]); if (!result.matches?.length) setError('Nenhuma customizada 5v5 completa encontrada entre as partidas recentes.'); }
    } catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  let mappingError='';
  if(match) { try { validateMapping(state,match,links,redTeam); } catch(e) { mappingError=(e as Error).message; } }
  const differentMap=match && match.mapId!==target.mapId;
  const changed=version!==state.version;
  async function confirmImport() {
    if(!match || !reviewed || mappingError || differentMap || changed || !eligible || busy) return;
    setBusy(true); setError('');
    try {
      await importRequest({action:'confirm',region:match.region,matchId:match.id,mapIndex,redTeam,links,expectedVersion:version});
      setMatch(null); setMatches([]); setSuccess(true); setOpen(false); setStep(1);
    } catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className={`card import-panel ${open?'wizard-open':''}`} onKeyDown={e => { if(e.key==='Escape'&&!busy) setOpen(false); }}>
    <header className="import-header"><span className="import-symbol"><Icon name="download" /></span><div className="grow"><h2>Importar resultado</h2><p>Seu placar completo, sem preencher round a round.</p></div>
      <button type="button" className={open?'icon-button ghost':'primary'} aria-label={open?'Fechar importação':undefined} disabled={(!open&&!eligible)||busy} onClick={() => { if(!open) setStep(match?2:1); setOpen(!open); }}>{open?<Icon name="close" />:<>Buscar customizada<Icon name="arrow" /></>}</button>
    </header>
    {!eligible && <p className="muted small import-unavailable">Disponível no próximo mapa sem placar ou estatísticas preenchidos.</p>}
    {success && <p className="success-notice" role="status"><Icon name="check" />Partida importada. Nomes preservados e associações salvas.</p>}
    {error && <p className="import-error" role="alert">{error}</p>}
    {open && <div className="import-wizard" ref={workspace} aria-busy={busy}>
      <ol className="import-steps" aria-label="Etapas da importação">{([['Partida',1],['Jogadores',2],['Revisão',3]] as const).map(([label,n])=><li key={n} className={step===n?'current':step>n?'done':''}><button type="button" aria-current={step===n?'step':undefined} disabled={busy||(n>1&&!match)||(n===3&&(!!mappingError||!!differentMap))} onClick={()=>setStep(n)}><span>{step>n?<Icon name="check" />:`0${n}`}</span>{label}</button></li>)}</ol>
      {step===1 && <div className="wizard-body">
        <div className="wizard-title"><p className="eyebrow">01 / ENCONTRE O RESULTADO</p><h3>Qual partida vamos importar?</h3><p>Busque pelo Riot ID de um jogador ou cole o link da partida no Tracker.</p></div>
        <form className="import-search" onSubmit={e=>{e.preventDefault();void search();}}>
          <label className="grow">Riot ID ou link da partida<span className="input-with-icon"><Icon name="search" /><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nome#TAG ou link do Tracker" maxLength={250} required disabled={busy} /></span></label>
          <label>Região<select value={region} onChange={e=>setRegion(e.target.value)} disabled={busy}>{[['br','Brasil'],['latam','América Latina'],['na','América do Norte'],['eu','Europa'],['ap','Ásia/Pacífico'],['kr','Coreia']].map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>
          <button className="primary" disabled={busy||!query.trim()}>{busy?'Consultando…':'Buscar partidas'}<Icon name="arrow" /></button>
        </form>
        {matches.length>0 ? <div className="import-results"><div className="section-heading"><h4>Customizadas recentes</h4><small>{matches.length} encontradas</small></div>{matches.map(m=><button type="button" key={m.id} disabled={busy} className={match?.id===m.id?'on':''} onClick={()=>select(m)}><span className="result-map-label">{MAPS[m.mapId].name.slice(0,2).toUpperCase()}</span><span className="grow"><strong>{MAPS[m.mapId].name}</strong><small>{date(m.startedAt)} · {m.players.length} jogadores · {Math.round(m.durationMs/60000)} min</small></span><span className="result-score"><small>RED / BLUE</small><strong>{m.score.Red}<span>:</span>{m.score.Blue}</strong></span><Icon name="arrow" /></button>)}</div> : !busy && <div className="import-search-hint"><Icon name="crosshair" /><p>Apenas customizadas 5v5 encerradas.<br /><span>Você confere tudo antes de salvar.</span></p></div>}
      </div>}
      {match && step>1 && <>
        <div className="selected-match"><span className="badge">{MAPS[match.mapId].name}</span><strong>Red {match.score.Red}<span>:</span>{match.score.Blue} Blue</strong><small>{date(match.startedAt)}</small><button type="button" className="ghost" disabled={busy} onClick={()=>setStep(1)}>Trocar partida</button></div>
        {differentMap && <p role="alert" className="import-error">Este resultado é de {MAPS[match.mapId].name}. O mapa selecionado na scrim é {MAPS[target.mapId].name}. Volte e escolha a partida correspondente.</p>}
        {step===2 && <div className="wizard-body">
          <div className="wizard-title"><p className="eyebrow">02 / CONECTE OS JOGADORES</p><h3>Cada jogador no lugar certo.</h3><p>Associe os nomes da sua scrim aos jogadores da partida. Um time por vez.</p></div>
          <div className="team-orientation"><span><Icon name="users" />O time <b>Red</b> da partida é</span><select aria-label="Time da scrim correspondente ao Red" value={redTeam} disabled={busy} onChange={e=>{const t=e.target.value as TeamId;setRedTeam(t);setLinks(suggestLinks(state,match,t));setReviewed(false);}}><option value="A">{state.teams.A.name}</option><option value="B">{state.teams.B.name}</option></select><small>Blue será {state.teams[redTeam==='A'?'B':'A'].name}</small></div>
          <PlayerMatcher key={`${match.id}-${redTeam}`} state={state} match={match} redTeam={redTeam} links={links} disabled={busy} onChange={next=>{setLinks(next);setReviewed(false);}} />
          <button type="button" className="ghost suggestions-button" disabled={busy} onClick={()=>{setLinks(suggestLinks(state,match,redTeam));setReviewed(false);}}><Icon name="link" />Usar sugestões de nomes e vínculos salvos</button>
          <div className="wizard-actions"><p>{mappingError||'Dez jogadores associados. Tudo pronto para revisar.'}</p><button type="button" className="primary" disabled={busy||!!mappingError||!!differentMap} onClick={()=>setStep(3)}>Revisar importação<Icon name="arrow" /></button></div>
        </div>}
        {step===3 && <div className="wizard-body">
          <div className="wizard-title"><p className="eyebrow">03 / ÚLTIMA CONFERÊNCIA</p><h3>Tudo certo para salvar?</h3><p>O resultado será adicionado ao mapa {mapIndex+1} da série. Seus nomes, veto e anotações continuam preservados.</p></div>
          <div className="import-review-score"><span>{state.teams[redTeam].name}</span><strong>{match.score.Red}<small>:</small>{match.score.Blue}</strong><span>{state.teams[redTeam==='A'?'B':'A'].name}</span><small>{MAPS[match.mapId].name} · {match.rounds.length} rounds · {Math.round(match.durationMs/60000)} min</small></div>
          {match.startedAt<state.createdAt && <p className="callout">Esta partida aconteceu antes da criação da scrim. Confira se escolheu o histórico correto.</p>}
          <div className="review-rosters">{(['A','B'] as const).map(t=><section key={t} className={`team-${t}`}><h4><span className="team-letter">{t}</span>{state.teams[t].name}<small>5 jogadores</small></h4>{state.players.filter(p=>p.team===t).map(p=>{const remote=match.players.find(x=>x.puuid===links.find(l=>l.playerId===p.id)?.puuid);return <div key={p.id}><strong>{p.name}</strong><Icon name="link" /><span>{remote?riotId(remote):'Não associado'}</span></div>;})}</section>)}</div>
          {changed && <p className="import-error" role="alert">A sala mudou desde sua seleção. <button type="button" className="ghost" disabled={busy} onClick={()=>{setVersion(state.version);setReviewed(false);}}>Revisar versão atual</button></p>}
          <label className="mapping-review"><input type="checkbox" checked={reviewed} disabled={busy||!!mappingError} onChange={e=>setReviewed(e.target.checked)} /><span><strong>Conferi os jogadores e o resultado.</strong><small>Confirmo as dez associações, os times e o mapa selecionado.</small></span></label>
          <div className="wizard-actions"><button type="button" className="ghost" disabled={busy} onClick={()=>{setStep(2);setReviewed(false);}}><Icon name="back" />Ajustar jogadores</button><button type="button" className="primary" disabled={busy||!eligible||!reviewed||!!mappingError||!!differentMap||changed} onClick={()=>void confirmImport()}>{busy?'Importando…':'Confirmar importação'}<Icon name="check" /></button></div>
        </div>}
      </>}
    </div>}
  </section>;
}
