import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { currentMapIndex, type Command, type ScrimState } from '../../shared/scrim';
import { activeDraw, type FocusTarget } from '../../shared/roomTools';
import { FORMAT_LABEL } from '../../shared/veto';
import { forgetAdminKey, readAdminKey } from '../adminKeys';
import { useScrim } from '../hooks/useScrim';
import { navigate } from '../router';
import { copyText } from '../util';
import { RoomTools } from './RoomTools';
import './RoomFocus.css';
import { MatchPanel } from './MatchPanel';
import { ReportPanel } from './ReportPanel';
import { TeamsPanel } from './TeamsPanel';
import { Timeline } from './Timeline';
import { VetoPanel } from './VetoPanel';

interface RoomCtx {
  importRequest: ReturnType<typeof useScrim>['importRequest'];
  state: ScrimState;
  isAdmin: boolean;
  /** Envia um comando; erros viram aviso na tela. */
  act: (command: Command) => Promise<boolean>;
}

const Ctx = createContext<RoomCtx | null>(null);

export function useRoom(): RoomCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRoom fora de ScrimRoom');
  return ctx;
}

type Tab = 'teams' | 'veto' | 'match' | 'report' | 'timeline';

const TABS: { id: Tab; label: string }[] = [
  { id: 'teams', label: 'Times' },
  { id: 'veto', label: 'Veto' },
  { id: 'match', label: 'Partida' },
  { id: 'report', label: 'Relatório' },
  { id: 'timeline', label: 'Linha do tempo' },
];

const tabForPhase = (phase: ScrimState['phase']): Tab =>
  ({ setup: 'teams', veto: 'veto', live: 'match', finished: 'report' } as const)[phase];

export function ScrimRoom({ scrimId }: { scrimId: string }) {
  const [adminKey] = useState(() => readAdminKey(scrimId));
  const { state, events, role, status, presence, send, importRequest, roomRequest, serverOffset } = useScrim(scrimId, adminKey);
  const [tab, setTab] = useState<Tab | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const isAdmin = role === 'admin';
  // Espectadores seguem a fase automaticamente até escolherem uma aba.
  const phase = state?.phase;
  const [followPhase, setFollowPhase] = useState(true);
  useEffect(() => {
    if (phase && followPhase) setTab(tabForPhase(phase));
  }, [phase, followPhase]);

  const [selectedMap, setSelectedMap] = useState<number | null>(null);
  const [, setClock] = useState(() => Date.now());
  const [toolsBlocking, setToolsBlocking] = useState(false);
  const backgroundRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastArea = useRef<{ tab: Tab; area: string } | null>(null);
  const seenFocus = useRef<string | null>(null);
  const pendingAction = useRef<Promise<boolean>>(Promise.resolve(true));
  const [focusTarget, setFocusTarget] = useState<{ id: string; target: FocusTarget } | null>(null);
  const now = Date.now() + serverOffset;
  const blocking = toolsBlocking || !!(state && activeDraw(state, now));
  const lastDraw = state?.draws?.at(-1);

  useEffect(() => {
    const deadline = Math.max(state?.roomFocus?.expiresAt ?? 0,
      lastDraw?.status === 'pending' ? lastDraw.expiresAt : 0);
    setClock(Date.now());
    if (deadline <= Date.now() + serverOffset) return;
    const timer = setInterval(() => {
      const localNow = Date.now();
      setClock(localNow);
      if (localNow + serverOffset >= deadline) clearInterval(timer);
    }, 200);
    return () => clearInterval(timer);
  }, [state?.roomFocus?.id, lastDraw?.id, lastDraw?.status, serverOffset]);

  useEffect(() => {
    if (backgroundRef.current) backgroundRef.current.inert = blocking;
  }, [blocking]);

  useEffect(() => {
    const focus = state?.roomFocus;
    if (!focus || focus.id === seenFocus.current || blocking) return;
    seenFocus.current = focus.id;
    if (focus.expiresAt <= now) return;
    setTab(focus.target.tab);
    setFollowPhase(false);
    if (focus.target.tab === 'match' && focus.target.mapIndex !== undefined) setSelectedMap(focus.target.mapIndex);
    setFocusTarget({ id: focus.id, target: focus.target });
  }, [state?.roomFocus?.id, blocking, now]);

  useEffect(() => {
    if (!focusTarget || !tab || tab !== focusTarget.target.tab) return;
    let target: HTMLElement | undefined;
    let removeTimer: ReturnType<typeof setTimeout> | undefined;
    let priorTabIndex: string | null = null;
    const frame = requestAnimationFrame(() => {
      const content = contentRef.current;
      if (!content) return;
      target = Array.from(content.querySelectorAll<HTMLElement>('[data-room-focus]'))
        .find(node => node.dataset.roomFocus === focusTarget.target.area) ?? content;
      for (let parent: HTMLElement | null = target; parent && parent !== content; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
      priorTabIndex = target.getAttribute('tabindex');
      target.setAttribute('tabindex', '-1');
      target.classList.add('room-focus-highlight');
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
      target.focus({ preventScroll: true });
      const label = TABS.find(item => item.id === tab)?.label;
      setToast(`O admin chamou todos para ${label}.`);
      removeTimer = setTimeout(() => target?.classList.remove('room-focus-highlight'), 5000);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (removeTimer) clearTimeout(removeTimer);
      if (target) {
        target.classList.remove('room-focus-highlight');
        if (priorTabIndex === null) target.removeAttribute('tabindex'); else target.setAttribute('tabindex', priorTabIndex);
      }
    };
  }, [focusTarget, tab]);


  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const act = useCallback(
    (command: Command) => {
      const action = (async () => {
        try {
          await send(command);
          return true;
        } catch (err) {
          setToast((err as Error).message);
          return false;
        }
      })();
      pendingAction.current = action;
      return action;
    },
    [send],
  );

  const ctx = useMemo(() => (state ? { state, isAdmin, act, importRequest } : null), [state, isAdmin, act, importRequest]);

  if (status === 'not-found') {
    return (
      <main className="page">
        <div className="card">
          <h2>Scrim não encontrada</h2>
          <button onClick={() => navigate('/')}>Voltar</button>
        </div>
      </main>
    );
  }

  if (!ctx || !tab) {
    return (
      <main className="page">
        <p className="muted">Conectando…</p>
      </main>
    );
  }

  function rememberArea(event: React.SyntheticEvent) {
    const node = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-room-focus]') : null;
    if (node && tab) lastArea.current = { tab, area: node.dataset.roomFocus ?? 'overview' };
  }

  async function focusEveryone() {
    if (!tab) return;
    // The input blur may save a field before the toolbar click. Let that commit first.
    if (!await pendingAction.current) throw new Error('A alteração não foi salva. Revise o aviso antes de chamar a sala.');
    const liveMap = currentMapIndex(ctx!.state);
    const mapIndex = selectedMap ?? (liveMap >= 0 ? liveMap : Math.max(0, ctx!.state.maps.findLastIndex(map => map.rounds.length > 0)));
    const target: FocusTarget = { tab, area: lastArea.current?.tab === tab ? lastArea.current.area : 'overview',
      ...(tab === 'match' && ctx!.state.maps.length ? { mapIndex } : {}) };
    await roomRequest({ action: 'focus', target });
  }

  const spectatorLink = `${location.origin}/s/${scrimId}`;

  return (
    <Ctx.Provider value={ctx}>
      <main className="page">
        <div ref={backgroundRef}>
        <header className="room-header">
          <div>
            <a
              href="/"
              className="muted back"
              onClick={(e) => {
                e.preventDefault();
                navigate('/');
              }}
            >
              ← Scrims
            </a>
            <h1>{ctx.state.title}</h1>
            <p className="muted">
              {FORMAT_LABEL[ctx.state.format]} · {ctx.state.teams.A.name} vs {ctx.state.teams.B.name}
            </p>
          </div>
          <div className="room-meta">
            <span className={`status ${status}`} title="Conexão em tempo real">
              {status === 'online' ? 'Ao vivo' : status === 'connecting' ? 'Conectando…' : 'Reconectando…'}
            </span>
            <span className="muted">
              👁 {presence.viewers} {presence.viewers === 1 ? 'espectador' : 'espectadores'}
            </span>
            <span className={`badge ${isAdmin ? 'admin' : ''}`}>{isAdmin ? 'Admin' : 'Espectador'}</span>
            <button
              onClick={async () => setToast((await copyText(spectatorLink)) ? 'Link de espectador copiado.' : spectatorLink)}
            >
              Copiar link p/ Discord
            </button>
            {isAdmin && adminKey && (
              <button
                className="ghost"
                title="Para abrir como admin em outro dispositivo. Não mande no Discord."
                onClick={async () => {
                  const link = `${spectatorLink}#admin=${encodeURIComponent(adminKey)}`;
                  setToast((await copyText(link)) ? 'Link de ADMIN copiado. Não compartilhe.' : link);
                }}
              >
                Copiar link de admin
              </button>
            )}
            {isAdmin && (
              <button
                className="ghost"
                title="Este navegador deixa de ser admin desta scrim"
                onClick={() => {
                  if (confirm('Remover o acesso de admin deste navegador? Você precisará do link de admin para voltar.')) {
                    forgetAdminKey(scrimId);
                    location.reload();
                  }
                }}
              >
                Sair do admin
              </button>
            )}
          </div>
        </header>

        {isAdmin && ctx.state.version <= 1 && (
          <p className="callout">
            Este navegador ficou salvo como admin. Use <b>Copiar link de admin</b> e guarde-o se for editar de outro
            dispositivo. Para os amigos, use <b>Copiar link p/ Discord</b>: quem abre por ele só assiste.
          </p>
        )}

        <RoomTools state={ctx.state} isAdmin={isAdmin} request={roomRequest} now={now} onFocusAll={focusEveryone} onBlockingChange={setToolsBlocking} />

        <nav className="tabs" role="tablist" aria-label="Navegação da scrim">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`tab-${t.id}`}
              aria-controls="room-content"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'on' : ''}
              onClick={() => {
                setTab(t.id);
                setFollowPhase(t.id === tabForPhase(ctx.state.phase));
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div ref={contentRef} id="room-content" role="tabpanel" aria-labelledby={`tab-${tab}`} data-room-focus="overview" onFocusCapture={rememberArea} onPointerDownCapture={rememberArea}>
        {tab === 'teams' && <TeamsPanel />}
        {tab === 'veto' && <VetoPanel />}
        {tab === 'match' && <MatchPanel selectedMap={selectedMap} onSelectMap={setSelectedMap} />}
        {tab === 'report' && <ReportPanel scrimId={scrimId} />}
        {tab === 'timeline' && <Timeline events={events} />}
        </div>
        </div>

        {toast && (
          <div className="toast" role="status" onClick={() => setToast(null)}>
            {toast}
          </div>
        )}
      </main>
    </Ctx.Provider>
  );
}
