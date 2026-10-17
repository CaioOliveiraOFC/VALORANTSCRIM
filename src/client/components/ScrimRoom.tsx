import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Command, ScrimState } from '../../shared/scrim';
import { FORMAT_LABEL } from '../../shared/veto';
import { forgetAdminKey, readAdminKey } from '../adminKeys';
import { useScrim } from '../hooks/useScrim';
import { navigate } from '../router';
import { copyText } from '../util';
import { Icon, type IconName } from './Icon';
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

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'teams', label: 'Times', icon: 'users' },
  { id: 'veto', label: 'Veto', icon: 'shield' },
  { id: 'match', label: 'Partida', icon: 'crosshair' },
  { id: 'report', label: 'Relatório', icon: 'chart' },
  { id: 'timeline', label: 'Histórico', icon: 'history' },
];

const tabForPhase = (phase: ScrimState['phase']): Tab =>
  ({ setup: 'teams', veto: 'veto', live: 'match', finished: 'report' } as const)[phase];

export function ScrimRoom({ scrimId }: { scrimId: string }) {
  const [adminKey] = useState(() => readAdminKey(scrimId));
  const { state, events, role, status, presence, send, importRequest } = useScrim(scrimId, adminKey);
  const [tab, setTab] = useState<Tab | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const isAdmin = role === 'admin';

  // Espectadores seguem a fase automaticamente até escolherem uma aba.
  const phase = state?.phase;
  const [followPhase, setFollowPhase] = useState(true);
  useEffect(() => {
    if (phase && followPhase) setTab(tabForPhase(phase));
  }, [phase, followPhase]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const act = useCallback(
    async (command: Command) => {
      try {
        await send(command);
        return true;
      } catch (err) {
        setToast((err as Error).message);
        return false;
      }
    },
    [send],
  );

  const ctx = useMemo(() => (state ? { state, isAdmin, act, importRequest } : null), [state, isAdmin, act, importRequest]);

  if (status === 'not-found') {
    return (
      <main className="page" id="main-content" tabIndex={-1}>
        <div className="card">
          <h2>Scrim não encontrada</h2>
          <button onClick={() => navigate('/')}>Voltar</button>
        </div>
      </main>
    );
  }

  if (!ctx || !tab) {
    return (
      <main className="page" id="main-content" tabIndex={-1}>
        <p className="muted">Conectando…</p>
      </main>
    );
  }

  const spectatorLink = `${location.origin}/s/${scrimId}`;

  const phaseLabel = { setup: 'Preparação', veto: 'Veto em andamento', live: 'Partida em andamento', finished: 'Série encerrada' }[ctx.state.phase];
  const activeTab = TABS.find(t => t.id === tab)!;
  function chooseTab(id: Tab) {
    setTab(id); setFollowPhase(id === tabForPhase(ctx!.state.phase));
  }
  return <Ctx.Provider value={ctx}>
    <div className="room-layout">
      <aside className="room-sidebar">
        <a className="back" href="/" onClick={e => { e.preventDefault(); navigate('/'); }}><Icon name="back" />Todas as scrims</a>
        <p className="eyebrow sidebar-caption">CENTRAL DA SALA</p>
        <nav className="tabs room-nav" role="tablist" aria-label="Navegação da scrim" onKeyDown={e => {
          const index = TABS.findIndex(t => t.id === tab);
          let next = index;
          if (['ArrowRight','ArrowDown'].includes(e.key)) next = (index + 1) % TABS.length;
          else if (['ArrowLeft','ArrowUp'].includes(e.key)) next = (index + TABS.length - 1) % TABS.length;
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = TABS.length - 1;
          else return;
          e.preventDefault(); chooseTab(TABS[next]!.id);
          e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>
          {TABS.map((t,i) => <button key={t.id} id={`tab-${t.id}`} role="tab" aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1} className={tab === t.id ? 'on' : ''} onClick={() => chooseTab(t.id)}><Icon name={t.icon} /><span>{t.label}</span><small>0{i+1}</small></button>)}
        </nav>
        <div className="sidebar-note"><Icon name="link" /><strong>Melhor com o time junto.</strong><p>Compartilhe o link da sala para acompanhar cada escolha e resultado.</p></div>
      </aside>
      <main className="room-main" id="main-content" tabIndex={-1}>
        <header className="room-header">
          <div className="room-heading"><p className="eyebrow">{FORMAT_LABEL[ctx.state.format]}<span>/</span>{phaseLabel}</p><h1>{ctx.state.title}</h1><p className="room-opponents"><span className="team-A">{ctx.state.teams.A.name}</span><small>VS</small><span className="team-B">{ctx.state.teams.B.name}</span></p></div>
          <div className="room-header-actions">
            <div className="room-meta"><span className={`status ${status}`} title="Conexão em tempo real">{status === 'online' ? 'Conectado' : status === 'connecting' ? 'Conectando…' : 'Reconectando…'}</span><span className="viewer-count"><Icon name="eye" />{presence.viewers}<span className="sr-only"> espectadores</span></span><span className={`badge ${isAdmin ? 'admin' : ''}`}>{isAdmin ? 'Admin' : 'Espectador'}</span></div>
            <div className="row"><button className="primary share-button" onClick={async () => setToast((await copyText(spectatorLink)) ? 'Link de espectador copiado.' : spectatorLink)}><Icon name="link" />Convidar espectadores</button>
              {isAdmin && <details className="room-actions"><summary aria-label="Opções da sala">•••</summary><div>
                {adminKey && <button onClick={async () => { const link = `${spectatorLink}#admin=${encodeURIComponent(adminKey)}`; setToast((await copyText(link)) ? 'Link de ADMIN copiado. Não compartilhe.' : link); }}><Icon name="copy" />Copiar link de admin</button>}
                <button onClick={() => { if (confirm('Remover o acesso de admin deste navegador? Você precisará do link de admin para voltar.')) { forgetAdminKey(scrimId); location.reload(); } }}><Icon name="back" />Sair do admin</button>
              </div></details>}
            </div>
          </div>
        </header>
        {isAdmin && ctx.state.version <= 1 && <p className="callout"><Icon name="shield" />Você administra esta sala. Guarde seu link de admin em <strong>Opções da sala (•••)</strong>. Para os amigos, use <strong>Convidar espectadores</strong>.</p>}
        <div className="panel-heading"><span><Icon name={activeTab.icon} />{activeTab.label}</span><small>{isAdmin ? 'Você está no controle' : 'Acompanhando a sala'}</small></div>
        <div className="room-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'teams' && <TeamsPanel />}
          {tab === 'veto' && <VetoPanel />}
          {tab === 'match' && <MatchPanel />}
          {tab === 'report' && <ReportPanel scrimId={scrimId} />}
          {tab === 'timeline' && <Timeline events={events} />}
        </div>
      </main>
    </div>
    {toast && <div className="toast" role="status" onClick={() => setToast(null)}><Icon name="check" />{toast}</div>}
  </Ctx.Provider>;
}
