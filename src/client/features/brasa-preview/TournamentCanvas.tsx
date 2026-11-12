import { useEffect, useRef, useState } from 'react';
import { matches, nextMatchId, roundCount, stageName, type Bracket, type Match } from './model';
import { Avatar, Icon } from '../../ui/Icons';

interface Props {
  bracket: Bracket;
  selected: string;
  organizer: boolean;
  onSelect: (id: string) => void;
  onAdvance: (match: Match, winnerId: string) => void;
}
export function TournamentCanvas({ bracket, selected, organizer, onSelect, onAdvance }: Props) {
  const [view, setView] = useState<'canvas' | 'list'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 700 ? 'list' : 'canvas',
  );
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ matchId: string; playerId: string } | null>(null);
  const [dropError, setDropError] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const rounds = matches(bracket);
  const width = roundCount(bracket) * 264 + 32;
  const height = Math.max(360, (bracket.size / 2) * 120 + 40);
  useEffect(() => {
    setDrag(null);
  }, [organizer, bracket.revision]);
  const cardTop = (round: number, index: number) => 2 ** round * (index + 0.5) * 120;
  function fit() {
    const available = scroll.current?.clientWidth ?? width;
    setZoom(Math.max(0.15, Math.min(1.2, (available - 24) / width)));
  }
  function drop(event: React.DragEvent, destination: string | null) {
    event.preventDefault();
    const source = drag;
    setDrag(null);
    if (!source || !organizer) return;
    const match = rounds.flat().find((item) => item.id === source.matchId);
    if (!match || nextMatchId(bracket, match) !== destination) {
      setDropError('Solte o participante apenas no confronto seguinte da própria chave.');
      return;
    }
    setDropError('');
    onAdvance(match, source.playerId);
  }
  function matchCard(match: Match, positioned: boolean) {
    const eligible = organizer && ['ready', 'finished'].includes(match.status);
    const target = drag && rounds.flat().find((item) => item.id === drag.matchId);
    const droppable = target && nextMatchId(bracket, target) === match.id;
    return (
      <article
        key={match.id}
        data-match-id={match.id}
        className={`br-match${selected === match.id ? ' is-selected' : ''}${match.status === 'finished' ? ' is-finished' : ''}${droppable ? ' is-drop-target' : ''}`}
        style={
          positioned
            ? { left: match.round * 264 + 16, top: cardTop(match.round, match.index) }
            : undefined
        }
        onDragOver={(event) => {
          if (droppable) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }
        }}
        onDrop={(event) => drop(event, match.id)}
      >
        <button
          type="button"
          className="br-match-label"
          onClick={() => onSelect(match.id)}
          aria-label={`Ver confronto ${match.index + 1}, ${stageName(match.round, rounds.length)}`}
          aria-pressed={selected === match.id}
        >
          <span>
            {match.status === 'bye' ? 'Avanço automático' : `Confronto ${match.index + 1}`}
          </span>
          <span>MD{match.format}</span>
        </button>
        {match.players.map((player, index) => (
          <button
            type="button"
            key={index}
            data-player-id={player?.id}
            className={`br-match-player${player && match.winner?.id === player.id ? ' is-winner' : ''}${match.winner && player && match.winner.id !== player.id ? ' is-loser' : ''}`}
            draggable={!!player && eligible}
            onDragStart={(event) => {
              if (!player || !eligible) {
                event.preventDefault();
                return;
              }
              const source = { matchId: match.id, playerId: player.id };
              event.dataTransfer.setData('text/plain', JSON.stringify(source));
              event.dataTransfer.effectAllowed = 'move';
              setDrag(source);
            }}
            onDragEnd={() => setDrag(null)}
            onClick={() => onSelect(match.id)}
            aria-label={`${player?.name ?? (match.waiting[index] ? 'Aguardando vencedor' : 'Vaga livre')}${match.winner?.id === player?.id && player ? ', vencedor' : ''}. Ver confronto.`}
          >
            {player ? (
              <>
                <Avatar name={player.name} small />
                <span className="br-player-name">{player.name}</span>
              </>
            ) : (
              <>
                <span className="br-player-placeholder" aria-hidden="true">
                  {match.waiting[index] ? '?' : '—'}
                </span>
                <span className="br-player-name br-muted">
                  {match.waiting[index] ? 'Aguardando vencedor' : 'Vaga livre'}
                </span>
              </>
            )}
            <span className="br-match-score">
              {match.result?.wins ? (
                match.result.wins[index]
              ) : match.winner?.id === player?.id && player ? (
                <Icon name="check" size={15} />
              ) : (
                '—'
              )}
            </span>
            {eligible && player && (
              <span className="br-drag-handle">
                <Icon name="drag" size={13} />
              </span>
            )}
          </button>
        ))}
      </article>
    );
  }
  const champion = rounds.at(-1)?.[0]?.winner;
  return (
    <section className="br-bracket" aria-label="Chave do campeonato">
      <div className="br-board-toolbar">
        <div className="br-view-toggle" aria-label="Visualização da chave">
          <button type="button" aria-pressed={view === 'canvas'} onClick={() => setView('canvas')}>
            <Icon name="grid" size={16} />
            Chave
          </button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
            <Icon name="list" size={16} />
            Por fase
          </button>
        </div>
        {view === 'canvas' && (
          <div className="br-zoom-controls">
            <button
              type="button"
              aria-label="Diminuir chave"
              disabled={zoom <= 0.15}
              onClick={() => setZoom((value) => Math.max(0.15, value - 0.1))}
            >
              <Icon name="minus" size={16} />
            </button>
            <span aria-live="polite">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              aria-label="Ampliar chave"
              disabled={zoom >= 1.4}
              onClick={() => setZoom((value) => Math.min(1.4, value + 0.1))}
            >
              <Icon name="plus" size={16} />
            </button>
            <button type="button" aria-label="Encaixar chave" onClick={fit}>
              <Icon name="expand" size={16} />
              <span>Encaixar</span>
            </button>
          </div>
        )}
      </div>
      <div className="br-board-hint">
        <Icon name={organizer ? 'drag' : 'eye'} size={16} />
        <p>
          {organizer
            ? 'Arraste o vencedor para o próximo confronto ou selecione um duelo para decidir.'
            : 'Selecione um confronto para ver os participantes e acompanhar o resultado.'}
        </p>
      </div>
      {dropError && (
        <p className="br-error" role="alert">
          {dropError}
        </p>
      )}
      {view === 'canvas' ? (
        <div
          className="br-board-scroll"
          ref={scroll}
          tabIndex={0}
          aria-label="Chave ampliável. Arraste o fundo, use a barra de rolagem ou o gesto de dois dedos para navegar."
          onPointerDown={(event) => {
            if (
              event.pointerType !== 'mouse' ||
              event.button !== 0 ||
              (event.target as Element).closest('button')
            )
              return;
            const node = event.currentTarget;
            pan.current = {
              x: event.clientX,
              y: event.clientY,
              left: node.scrollLeft,
              top: node.scrollTop,
            };
            node.setPointerCapture(event.pointerId);
            node.dataset.panning = 'true';
          }}
          onPointerMove={(event) => {
            if (!pan.current) return;
            event.currentTarget.scrollLeft = pan.current.left + pan.current.x - event.clientX;
            event.currentTarget.scrollTop = pan.current.top + pan.current.y - event.clientY;
          }}
          onPointerUp={(event) => {
            pan.current = null;
            delete event.currentTarget.dataset.panning;
          }}
          onLostPointerCapture={(event) => {
            pan.current = null;
            delete event.currentTarget.dataset.panning;
          }}
        >
          <div style={{ width: width * zoom, height: height * zoom }} className="br-board-space">
            <div className="br-board-canvas" style={{ width, height, transform: `scale(${zoom})` }}>
              <svg className="br-connections" width={width} height={height} aria-hidden="true">
                {rounds.slice(0, -1).flatMap((stage) =>
                  stage.map((match) => {
                    const x = match.round * 264 + 240;
                    const y = cardTop(match.round, match.index) + 49;
                    const nextY = cardTop(match.round + 1, Math.floor(match.index / 2)) + 49;
                    return (
                      <path
                        key={match.id}
                        d={`M ${x} ${y} H ${x + 20} V ${nextY} H ${x + 40}`}
                        className={match.winner ? 'br-path-complete' : undefined}
                      />
                    );
                  }),
                )}
              </svg>
              {rounds.map((stage, round) => (
                <div key={round} className="br-stage-label" style={{ left: round * 264 + 16 }}>
                  <h3>{stageName(round, rounds.length)}</h3>
                  <span>MD{bracket.formats[round]}</span>
                </div>
              ))}
              {rounds.flatMap((stage) => stage.map((match) => matchCard(match, true)))}
            </div>
          </div>
        </div>
      ) : (
        <div className="br-stage-list">
          {rounds.map((stage, round) => (
            <section key={round}>
              <div className="br-stage-list-heading">
                <h3>{stageName(round, rounds.length)}</h3>
                <span>Melhor de {bracket.formats[round]}</span>
              </div>
              <div>{stage.map((match) => matchCard(match, false))}</div>
            </section>
          ))}
        </div>
      )}
      <div
        className={`br-champion${champion ? ' has-champion' : ''}`}
        onDragOver={(event) => {
          const source = rounds.at(-1)?.[0];
          if (drag?.matchId === source?.id) event.preventDefault();
        }}
        onDrop={(event) => drop(event, null)}
      >
        <span className="br-champion-icon">
          <Icon name="cup" size={22} />
        </span>
        <div>
          <span>{champion ? 'Campeão da Brasa' : 'O lugar do campeão'}</span>
          <strong>{champion?.name ?? 'A história ainda está sendo escrita.'}</strong>
        </div>
        {champion && <Icon name="check" size={20} />}
      </div>
    </section>
  );
}
