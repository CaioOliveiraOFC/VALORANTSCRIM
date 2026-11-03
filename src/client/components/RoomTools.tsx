import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ScrimState } from '../../shared/scrim';
import { activeDraw, type RoomDraw } from '../../shared/roomTools';
import './RoomTools.css';

type DrawKind = 'captains' | 'coin';
type Request = (input: Record<string, unknown>) => Promise<unknown>;

export interface RoomToolsProps {
  state: ScrimState;
  isAdmin: boolean;
  request: Request;
  /** Server-adjusted wall clock; the room owns the interval. */
  now: number;
  onFocusAll: () => Promise<void>;
  onBlockingChange?: (blocking: boolean) => void;
}

function Modal({ children, titleId, descriptionId, focusContext, returnFocus, dismiss }: {
  children: ReactNode;
  titleId: string;
  descriptionId: string;
  focusContext: string;
  returnFocus?: HTMLElement | null;
  dismiss?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const previous = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const dialog = ref.current;
    const candidates = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]',
    ) ?? []).filter(element => !element.hidden);
    (candidates()[0] ?? dialog)?.focus();
    const retainFocus = (event: FocusEvent) => {
      if (dialog && !dialog.contains(event.target as Node)) (candidates()[0] ?? dialog).focus();
    };
    document.addEventListener('focusin', retainFocus);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('focusin', retainFocus);
      document.body.style.overflow = previousOverflow;
      const restore = () => {
        if (previous?.isConnected && !document.querySelector('[aria-modal="true"]')) previous.focus();
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore);
      else queueMicrotask(restore);
    };
  }, []);
  useEffect(() => {
    const dialog = ref.current;
    const first = dialog?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]');
    (first ?? dialog)?.focus();
  }, [focusContext]);
  const content = <div className="room-tools-backdrop">
    <div className="room-tools-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}
      aria-describedby={descriptionId} tabIndex={-1} ref={ref}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss?.(); }
        if (event.key !== 'Tab') return;
        const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]',
        )).filter(element => !element.hidden);
        const first = focusable[0], last = focusable.at(-1);
        if (!first) { event.preventDefault(); event.currentTarget.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
      {children}
    </div>
  </div>;
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}

const coinName = (side: 'heads' | 'tails') => side === 'heads' ? 'Cara' : 'Coroa';
function candidateName(draw: Extract<RoomDraw, { kind: 'captains' }>, id: string) {
  return draw.candidates.find(candidate => candidate.id === id)?.name ?? 'Jogador';
}

function DrawStage({ draw, now, teamNames }: { draw: RoomDraw; now: number; teamNames: { A: string; B: string } }) {
  const revealed = now >= draw.revealAt;
  const initialNow = useRef(now);
  const frame = Math.floor(Math.max(0, now - draw.startedAt) / 120);
  const seconds = Math.max(1, Math.ceil((draw.revealAt - now) / 1000));
  if (draw.kind === 'coin') return <div className={`room-draw-stage room-coin-stage ${revealed ? 'is-revealed' : 'is-spinning'}`}>
    <div className="room-draw-coin" aria-hidden="true" style={revealed ? undefined : { animationDelay: `-${Math.max(0, initialNow.current - draw.startedAt)}ms`, animationDuration: `${draw.revealAt - draw.startedAt}ms` }}>
      <span>{revealed ? coinName(draw.result) : frame % 2 ? 'Cara' : 'Coroa'}</span>
    </div>
    <p className="room-draw-motion-alternative" aria-hidden="true">{revealed ? coinName(draw.result) : `Sorteando… ${seconds}`}</p>
    <p className="room-draw-result-label" role="status">{revealed ? `Resultado: ${coinName(draw.result)}` : 'Sorteando a moeda…'}</p>
  </div>;
  const count = draw.candidates.length;
  const rollingA = draw.candidates[frame % count]?.name ?? 'Jogador';
  const rollingB = draw.candidates[(frame + 1) % count]?.name ?? 'Jogador';
  return <div className={`room-draw-stage ${revealed ? 'is-revealed' : 'is-spinning'}`}>
    <div className="room-draw-captains">
      {(['A', 'B'] as const).map(team => <div key={team} className={`room-draw-slot room-draw-slot-${team}`}>
        <span className="room-draw-team-name">{teamNames[team]}</span>
        <span className="room-draw-slot-caption">Capitão</span>
        <strong className="room-draw-name" aria-hidden={!revealed}>{revealed ? candidateName(draw, draw.result[team]) : team === 'A' ? rollingA : rollingB}</strong>
        {!revealed && <span className="room-draw-motion-alternative">Sorteando… {seconds}</span>}
      </div>)}
    </div>
    <p className="room-draw-result-label" role="status">{revealed ? <><span aria-hidden="true">Os dois capitães foram sorteados.</span><span className="room-tools-sr-only">Capitães sorteados: {candidateName(draw, draw.result.A)} para {teamNames.A}; {candidateName(draw, draw.result.B)} para {teamNames.B}.</span></> : 'Sorteando os dois capitães…'}</p>
  </div>;
}

export function RoomTools({ state, isAdmin, request, now, onFocusAll, onBlockingChange }: RoomToolsProps) {
  const [setup, setSetup] = useState<DrawKind | null>(null);
  const [purpose, setPurpose] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'focus' | 'start' | 'accept' | 'reject' | null>(null);
  const [localNotice, setLocalNotice] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const locked = useRef(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const requestId = useRef<string | null>(null);
  const latest = state.draws?.at(-1);
  const current = activeDraw(state, now);
  const expired = latest?.status === 'pending' && now >= latest.expiresAt;
  const modalOpen = !!current || (isAdmin && !!setup);
  const titleId = useId(), descriptionId = useId();
  useEffect(() => {
    onBlockingChange?.(modalOpen);
    return () => onBlockingChange?.(false);
  }, [modalOpen, onBlockingChange]);
  useEffect(() => {
    if (current) { setSetup(null); setMenuOpen(false); setLocalNotice(''); }
    setError('');
  }, [current?.id]);

  async function operation(kind: NonNullable<typeof busy>, task: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(kind); setError(''); setLocalNotice('');
    try { await task(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível concluir. Tente novamente.'); }
    finally { locked.current = false; setBusy(null); }
  }
  function openSetup(kind: DrawKind) {
    requestId.current = null; setSetup(kind); setMenuOpen(false); setError(''); setLocalNotice('');
    setPurpose(kind === 'captains' ? 'Definir os capitães dos times' : '');
  }
  async function start() {
    if (!setup || !purpose.trim() || locked.current) return;
    await operation('start', async () => {
      requestId.current ??= crypto.randomUUID();
      await request({ action: 'draw.start', kind: setup, purpose: purpose.replace(/\s+/g, ' ').trim(), requestId: requestId.current });
      setSetup(null);
    });
  }
  async function resolve(action: 'accept' | 'reject') {
    if (!current || locked.current || (action === 'accept' && now < current.revealAt)) return;
    await operation(action, async () => { await request({ action: `draw.${action}`, drawId: current.id }); });
  }
  let notice = localNotice;
  if (expired) notice = 'O sorteio expirou sem confirmação. Nenhum resultado foi aplicado.';
  else if (latest?.status === 'rejected') notice = 'O admin descartou o sorteio. Nenhuma alteração foi aplicada.';
  else if (latest?.status === 'accepted') notice = latest.kind === 'coin'
    ? `Resultado aceito: ${coinName(latest.result)}. ${latest.purpose}`
    : `Capitães confirmados: ${candidateName(latest, latest.result.A)} e ${candidateName(latest, latest.result.B)}.`;

  if (!isAdmin && !current && !notice && !error) return null;
  return <div className="room-tools">
    {isAdmin && <div className="room-tools-toolbar">
      <button type="button" className="room-tools-focus" disabled={!!busy || !!current} onClick={() => void operation('focus', async () => { await onFocusAll(); setLocalNotice('Chamada enviada para a sala.'); })}>
        <span aria-hidden="true">◎</span>{busy === 'focus' ? 'Chamando…' : 'Chamar todos para cá'}
      </button>
      <div className="room-tools-menu" onKeyDown={event => { if (event.key === 'Escape' && menuOpen) { event.preventDefault(); setMenuOpen(false); menuButton.current?.focus(); } }}>
        <button ref={menuButton} type="button" aria-expanded={menuOpen} aria-controls="room-tools-menu" disabled={!!busy || !!current} onClick={() => setMenuOpen(value => !value)}>Sorteios <span aria-hidden="true">⌄</span></button>
        {menuOpen && <div id="room-tools-menu" className="room-tools-menu-items">
          <button type="button" onClick={() => openSetup('captains')} disabled={state.phase !== 'setup' || state.players.length < 2}>Capitães<small>Dois jogadores da lista geral</small></button>
          <button type="button" onClick={() => openSetup('coin')}>Cara ou coroa<small>Decida algo com a sala</small></button>
          {(state.phase !== 'setup' || state.players.length < 2) && <p>{state.phase !== 'setup' ? 'Capitães são sorteados durante a preparação.' : 'Adicione pelo menos dois jogadores para sortear os capitães.'}</p>}
        </div>}
      </div>
    </div>}
    {notice && !current && <p className="room-tools-notice" role="status">{notice}</p>}
    {error && !modalOpen && <p className="room-tools-error" role="alert">{error}</p>}
    {modalOpen && <Modal titleId={titleId} descriptionId={descriptionId} focusContext={current?.id ?? `setup-${setup}`} returnFocus={menuButton.current} dismiss={!current && !busy ? () => setSetup(null) : undefined}>
      {current ? <>
        <div className="room-draw-dialog-header"><span className="room-draw-room-name">{state.title}</span><h2 id={titleId}>{current.kind === 'captains' ? 'Sorteio dos capitães' : 'Cara ou coroa'}</h2><p id={descriptionId} className="room-draw-purpose">{current.purpose}</p></div>
        <DrawStage key={current.id} draw={current} now={now} teamNames={{ A: state.teams.A.name, B: state.teams.B.name }} />
        <div className="room-draw-status"><span className={`room-draw-status-dot ${now >= current.revealAt ? 'ready' : ''}`} aria-hidden="true" /><p>{now >= current.revealAt ? isAdmin ? 'Confira o resultado antes de aceitar.' : 'Aguardando o admin confirmar.' : 'O sorteio está aparecendo para toda a sala.'}</p></div>
        {current.kind === 'captains' && <p className="room-draw-effect">Ao aceitar, os capitães iniciam os times. Os outros jogadores ficam na lista para montar as equipes.</p>}
        {error && <p className="room-tools-error" role="alert">{error}</p>}
        {isAdmin && <div className="room-draw-actions"><button type="button" className="ghost" disabled={!!busy} onClick={() => void resolve('reject')}>{busy === 'reject' ? 'Descartando…' : 'Descartar'}</button><button type="button" className="primary" disabled={!!busy || now < current.revealAt} onClick={() => void resolve('accept')}>{busy === 'accept' ? 'Aceitando…' : 'Aceitar resultado'}</button></div>}
      </> : setup && <form className="room-draw-setup" onSubmit={event => { event.preventDefault(); void start(); }}>
        <h2 id={titleId}>{setup === 'captains' ? 'Sortear os capitães' : 'Cara ou coroa'}</h2>
        <p id={descriptionId} className="room-draw-setup-description">{setup === 'captains' ? 'Dois jogadores diferentes serão sorteados entre todos os inscritos, um para cada time.' : 'Conte à sala o que vai ser decidido. O motivo aparece junto da moeda e do resultado.'}</p>
        {setup === 'captains' && <>
          <div className="room-draw-candidates" aria-label="Participantes do sorteio">{state.players.map(player => <span key={player.id}>{player.name}</span>)}</div>
          <p className="room-draw-effect">Aceitar reinicia a montagem dos times com os dois capitães. Os demais jogadores voltam para a lista sem time.</p>
        </>}
        <label>O que estamos decidindo?<textarea value={purpose} rows={3} maxLength={160} required disabled={!!busy} placeholder="Quem começa banindo? Cara = Tartarugas, coroa = Lebres." onChange={event => { setPurpose(event.target.value); requestId.current = null; }} /></label>
        <p className="room-draw-setup-hint">Ao sortear, a animação abre para todos. O resultado só vale depois que você aceitar.</p>
        {error && <p className="room-tools-error" role="alert">{error}</p>}
        <div className="room-draw-actions"><button type="button" className="ghost" disabled={!!busy} onClick={() => setSetup(null)}>Cancelar</button><button type="submit" className="primary" disabled={!!busy || !purpose.trim() || (setup === 'captains' && (state.phase !== 'setup' || state.players.length < 2))}>{busy === 'start' ? 'Abrindo para a sala…' : 'Sortear para todos'}</button></div>
      </form>}
    </Modal>}
  </div>;
}
