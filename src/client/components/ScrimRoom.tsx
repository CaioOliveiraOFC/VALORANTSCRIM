import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Command, ScrimState } from '../../shared/scrim';
import { FORMAT_LABEL } from '../../shared/veto';
import { forgetAdminKey, readAdminKey } from '../adminKeys';
import { useScrim } from '../hooks/useScrim';
import { navigate } from '../router';
import { copyText } from '../util';
import { MatchPanel } from './MatchPanel';
import { ReportPanel } from './ReportPanel';
import { TeamsPanel } from './TeamsPanel';
import { Timeline } from './Timeline';
import { VetoPanel } from './VetoPanel';

interface RoomCtx {
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
  const { state, events, role, status, presence, send } = useScrim(scrimId, adminKey);
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

  const ctx = useMemo(() => (state ? { state, isAdmin, act } : null), [state, isAdmin, act]);

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

  const spectatorLink = `${location.origin}/s/${scrimId}`;

  return (
    <Ctx.Provider value={ctx}>
      <main className="page">
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

        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
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

        {tab === 'teams' && <TeamsPanel />}
        {tab === 'veto' && <VetoPanel />}
        {tab === 'match' && <MatchPanel />}
        {tab === 'report' && <ReportPanel scrimId={scrimId} />}
        {tab === 'timeline' && <Timeline events={events} />}

        {toast && (
          <div className="toast" role="status" onClick={() => setToast(null)}>
            {toast}
          </div>
        )}
      </main>
    </Ctx.Provider>
  );
}
