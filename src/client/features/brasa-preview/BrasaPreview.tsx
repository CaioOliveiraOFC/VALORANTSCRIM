import { useEffect, useRef, useState } from 'react';
import { Brand } from '../../ui/Brand';
import { DuelPanel } from './DuelPanel';
import { Suggestions } from './Suggestions';
import { WinnerModal, SetupModal, EditProposalModal } from './Dialogs';
import { Avatar, Icon } from '../../ui/Icons';
import { TournamentCanvas } from './TournamentCanvas';
import {
  acceptProposal,
  confirmWinner,
  demoBracket,
  demoProposals,
  matches,
  stageLabel,
  eliminationLabel,
  type Match,
  type Proposal,
} from './model';
import type { View, PendingWinner } from './types';
import './brasa-preview.css';

function initialView(): View {
  const value = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get(
    'tela',
  );
  return value === 'sugestoes' ? 'suggestions' : 'tournament';
}

export default function BrasaPreview() {
  const [bracket, setBracket] = useState(demoBracket);
  const [proposals, setProposals] = useState(() => demoProposals(bracket));
  const [view, setView] = useState<View>(initialView);
  const [organizer, setOrganizer] = useState(true);
  const [selected, setSelected] = useState('r1-m0');
  const [notice, setNotice] = useState('');
  const [pendingWinner, setPendingWinner] = useState<PendingWinner | null>(null);
  const [setup, setSetup] = useState(false);
  const [editProposal, setEditProposal] = useState<Proposal | null>(null);
  const content = useRef<HTMLElement>(null);
  const rounds = matches(bracket);
  const pendingCount = proposals.filter((item) => item.status === 'pending').length;
  const actor = bracket.entrants[0]!;

  useEffect(() => {
    const oldTitle = document.title;
    document.title = 'Brasa — prévia interativa';
    return () => {
      document.title = oldTitle;
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    function pop() {
      setView(initialView());
    }
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, []);
  function navigate(next: View) {
    if (next === 'home') {
      location.assign('/');
      return;
    }
    if (next === view) return;
    setView(next);
    const url = new URL(location.href);
    url.searchParams.set('tela', next === 'tournament' ? 'x1' : 'sugestoes');
    history.pushState(null, '', url.pathname + url.search);
    window.scrollTo({ top: 0, behavior: 'instant' });
    requestAnimationFrame(() => content.current?.focus({ preventScroll: true }));
  }
  function selectMatch(id: string) {
    setSelected(id);
    if (window.matchMedia('(max-width: 850px)').matches)
      requestAnimationFrame(() => {
        const panel = document.querySelector<HTMLElement>('.br-duel-panel');
        panel?.scrollIntoView({
          block: 'start',
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
        });
        panel?.focus({ preventScroll: true });
      });
  }
  function advance(match: Match, playerId: string) {
    setPendingWinner({ matchId: match.id, playerId, revision: bracket.revision });
  }
  function announce(message: string) {
    setNotice('');
    requestAnimationFrame(() => setNotice(message));
  }
  function accept(proposal: Proposal, adjusted?: string) {
    const next = acceptProposal(bracket, proposal, adjusted);
    setBracket(next);
    setProposals((old) =>
      old.map((item) =>
        item.id === proposal.id
          ? { ...item, value: adjusted ?? item.value, status: 'accepted' }
          : item,
      ),
    );
    announce(
      proposal.kind === 'title'
        ? 'Nome do campeonato atualizado nesta prévia.'
        : 'Apelido aprovado. A associação do participante foi preservada.',
    );
  }
  function reset() {
    const fresh = demoBracket();
    setBracket(fresh);
    setProposals(demoProposals(fresh));
    setSelected('r1-m0');
    announce('Exemplo reiniciado. Você pode testar de novo.');
  }
  return (
    <div className="br-preview">
      <div className="br-preview-bar">
        <div>
          <span className="br-preview-dot" />
          <strong>Prévia interativa</strong>
          <span className="br-preview-explanation">
            Dados de exemplo. As mudanças ficam nesta aba.
          </span>
        </div>
        <a href="/">
          Voltar ao site atual
          <Icon name="arrow" size={14} />
        </a>
      </div>
      <div className="br-shell">
        <a className="br-skip" href="#br-main">
          Ir para o conteúdo
        </a>
        <header className="br-header">
          <button
            type="button"
            className="br-brand-link"
            aria-label="Brasa, início"
            onClick={() => navigate('home')}
          >
            <Brand />
          </button>
          <nav aria-label="Navegação Brasa">
            <a href="/">Início</a>
            <a href="/vct">VCT</a>
            <button type="button" aria-current="page" onClick={() => navigate('tournament')}>
              X1
            </button>
            <a href="/historico">Histórico</a>
          </nav>
          <div className="br-profile">
            <Avatar name={organizer ? 'Caio' : actor.name} small />
            <span>
              {organizer ? 'Caio' : actor.name}
              <small>{organizer ? 'Organizador' : 'Participante'}</small>
            </span>
          </div>
        </header>
        <div className="br-demo-controls">
          <label>
            Testar como
            <select
              aria-label="Perfil de demonstração"
              value={organizer ? 'organizer' : 'participant'}
              onChange={(event) => setOrganizer(event.target.value === 'organizer')}
            >
              <option value="organizer">Organizador</option>
              <option value="participant">Participante</option>
            </select>
          </label>
          <button type="button" onClick={reset}>
            <Icon name="undo" size={14} />
            Reiniciar exemplo
          </button>
        </div>
        <main id="br-main" className="br-main" tabIndex={-1} ref={content}>
          {view === 'tournament' && (
            <>
              <div className="br-breadcrumb">
                <button type="button" onClick={() => navigate('home')}>
                  Ao vivo
                </button>
                <Icon name="chevron" size={12} />
                <span>Campeonato X1</span>
              </div>
              <header className="br-page-heading">
                <div>
                  <div className="br-event-status">
                    <span className="br-live-dot" />
                    Campeonato em andamento
                  </div>
                  <h1>{bracket.title}</h1>
                  <p>O próximo duelo está na chave. Encontre o seu.</p>
                </div>
                <div className="br-heading-actions">
                  <button
                    type="button"
                    className="br-button br-secondary"
                    onClick={() => navigate('suggestions')}
                  >
                    Sugestões
                    {pendingCount > 0 && organizer && (
                      <span className="br-count">{pendingCount}</span>
                    )}
                  </button>
                  {organizer ? (
                    <button
                      type="button"
                      className="br-button br-secondary"
                      onClick={() => setSetup(true)}
                    >
                      <Icon name="edit" size={16} />
                      Configurar exemplo
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="br-button br-primary"
                      onClick={() => {
                        const match =
                          rounds
                            .flat()
                            .find(
                              (item) =>
                                item.status === 'ready' &&
                                item.players.some((player) => player?.id === actor.id),
                            ) ??
                          rounds
                            .flat()
                            .find((item) => item.players.some((player) => player?.id === actor.id));
                        if (match) {
                          setSelected(match.id);
                          announce(`Seu confronto: ${stageLabel(bracket, match.round)}.`);
                          document.querySelector('.br-duel-panel')?.scrollIntoView({
                            block: 'center',
                            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                              ? 'auto'
                              : 'smooth',
                          });
                        }
                      }}
                    >
                      Minha partida
                      <Icon name="crosshair" size={16} />
                    </button>
                  )}
                </div>
              </header>
              <div className="br-tournament-meta">
                <span>
                  <Icon name="people" size={15} />
                  {bracket.entrants.length} participantes
                </span>
                <span>
                  <Icon name="crosshair" size={15} />
                  X1 · {eliminationLabel(bracket.elimination)}
                </span>
                <span>
                  <Icon name="cup" size={15} />
                  Final MD{bracket.formats.at(-1)}
                </span>
              </div>
              <p className="br-tournament-rule">
                {bracket.elimination === 'double'
                  ? bracket.size === 2
                    ? 'Dois jogadores: duelo inicial e grande final em série única, sem revanche.'
                    : 'Primeira derrota: lower. Segunda derrota: eliminado. Grande final em série única, sem revanche.'
                  : 'Perdeu, saiu. Os vencedores avançam até a final.'}
              </p>
              <div className="br-tournament-layout">
                <TournamentCanvas
                  bracket={bracket}
                  selected={selected}
                  organizer={organizer}
                  onSelect={selectMatch}
                  onAdvance={advance}
                />
                <DuelPanel
                  bracket={bracket}
                  selected={selected}
                  organizer={organizer}
                  advance={advance}
                  announce={announce}
                />
              </div>
              <div className="br-bottom-grid">
                <section className="br-activity">
                  <h2>O que aconteceu</h2>
                  {bracket.decisions.length ? (
                    <ol>
                      {bracket.decisions.slice(0, 4).map((item) => (
                        <li key={item.id}>
                          <span className="br-activity-dot" />
                          <p>{item.message}</p>
                          <span>Confirmado</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="br-muted">
                      A chave está pronta. As decisões da organização aparecerão aqui.
                    </p>
                  )}
                </section>
                <aside className="br-help-note">
                  <Icon name="spark" size={20} />
                  <div>
                    <h2>Seu nome, do seu jeito.</h2>
                    <p>
                      Peça um apelido ou sugira o nome do campeonato. A organização dá a palavra
                      final.
                    </p>
                    <button
                      type="button"
                      className="br-text-button"
                      onClick={() => navigate('suggestions')}
                    >
                      Enviar uma sugestão
                      <Icon name="arrow" size={15} />
                    </button>
                  </div>
                </aside>
              </div>
            </>
          )}
          {view === 'suggestions' && (
            <Suggestions
              bracket={bracket}
              proposals={proposals}
              organizer={organizer}
              actorId={actor.id}
              accept={accept}
              edit={setEditProposal}
              reject={(proposal) => {
                setProposals((old) =>
                  old.map((item) =>
                    item.id === proposal.id ? { ...item, status: 'rejected' } : item,
                  ),
                );
                announce('Sugestão recusada. O nome atual foi mantido.');
              }}
              send={(items) => {
                setProposals((old) => [...items, ...old]);
                announce('Sugestão enviada. Aguardando aprovação da organização.');
              }}
              changeRole={() => setOrganizer(!organizer)}
            />
          )}
        </main>
        <footer className="br-footer">
          <Brand compact />
          <p>O jogo é sério. A resenha também.</p>
          <span>Prévia de navegação e interações</span>
        </footer>
      </div>
      <div className="br-toast" role="status" aria-live="polite" aria-atomic="true">
        {notice && (
          <>
            <Icon name="check" size={18} />
            <span>{notice}</span>
          </>
        )}
      </div>
      {pendingWinner && (
        <WinnerModal
          bracket={bracket}
          pending={pendingWinner}
          close={() => setPendingWinner(null)}
          confirm={(invalidate, wins) => {
            const next = confirmWinner(
              bracket,
              pendingWinner.matchId,
              pendingWinner.playerId,
              pendingWinner.revision,
              invalidate,
              wins,
            );
            setBracket(next);
            setPendingWinner(null);
            announce('Vencedor confirmado na prévia. A chave foi atualizada.');
          }}
        />
      )}
      {setup && (
        <SetupModal
          bracket={bracket}
          close={() => setSetup(false)}
          save={(next) => {
            setBracket(next);
            setSelected('r0-m0');
            if (next.entrants !== bracket.entrants) setProposals([]);
            setSetup(false);
            announce('Exemplo configurado. Confira os confrontos.');
          }}
        />
      )}
      {editProposal && (
        <EditProposalModal
          bracket={bracket}
          proposal={editProposal}
          close={() => setEditProposal(null)}
          save={(proposal, value) => {
            accept(proposal, value);
            setEditProposal(null);
          }}
        />
      )}
    </div>
  );
}
