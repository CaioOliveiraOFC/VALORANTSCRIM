import { useEffect, useRef, useState } from 'react';
import {
  matches,
  nextMatchId,
  stages,
  stageLabel,
  sourceLabel,
  champion as getChampion,
  type Bracket,
  type Match,
} from './model';
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
  const phaseList = stages(bracket);
  const double = bracket.elimination === 'double';
  const upperCount = Math.log2(bracket.size);
  const spacing = double ? 108 : 120;
  const upperHeight = Math.max(216, (bracket.size / 2) * spacing) + (double ? 68 : 40);
  const lowerHeight = upperCount > 1 ? Math.max(216, (bracket.size / 4) * spacing) + 68 : 0;
  const columns = double ? Math.max(upperCount, 2 * (upperCount - 1)) : upperCount;
  const width = (columns + (double ? 1 : 0)) * 264 + 32;
  const height = double ? upperHeight + lowerHeight : Math.max(360, upperHeight);
  useEffect(() => {
    setDrag(null);
  }, [organizer, bracket.revision]);
  const position = (match: Match) => {
    if (match.lane === 'final')
      return {
        x: columns * 264 + 16,
        y: lowerHeight ? upperHeight - 10 : 68 + (upperHeight - 68) / 2 - 49,
      };
    const stage = rounds[match.round]!;
    const base = match.lane === 'lower' ? upperHeight : 0;
    const area = match.lane === 'lower' ? lowerHeight - 68 : upperHeight - (double ? 68 : 40);
    return {
      x: match.laneRound * 264 + 16,
      y: base + (double ? 68 : 40) + (area / stage.length) * (match.index + 0.5) - 49,
    };
  };
  function fit() {
    const available = scroll.current?.clientWidth ?? width;
    setZoom(Math.max(0.15, Math.min(1.2, (available - 24) / width)));
  }
  function jumpLane(lane: Match['lane']) {
    const candidates = rounds.flat().filter((match) => match.lane === lane);
    const match = candidates.find((match) => match.status === 'ready') ?? candidates[0];
    if (!match || !scroll.current) return;
    const point = position(match);
    scroll.current.scrollTo({
      left: Math.max(0, point.x * zoom - 24),
      top: Math.max(0, (point.y - 80) * zoom),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
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
        style={positioned ? { left: position(match).x, top: position(match).y } : undefined}
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
          aria-label={`Ver confronto ${match.index + 1}, ${stageLabel(bracket, match.round)}`}
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
            title={!player && match.waiting[index] ? sourceLabel(bracket, match, index) : undefined}
            aria-label={`${player?.name ?? (match.waiting[index] ? sourceLabel(bracket, match, index) : 'Vaga livre')}${match.winner?.id === player?.id && player ? ', vencedor' : ''}. Ver confronto.`}
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
                  {match.waiting[index] ? sourceLabel(bracket, match, index) : 'Vaga livre'}
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
  const champion = getChampion(bracket);
  return (
    <section className={`br-bracket${double ? ' is-double' : ''}`} aria-label="Chave do campeonato">
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
      {double && view === 'canvas' && (
        <nav className="br-lane-navigation" aria-label="Ir para uma chave">
          <button type="button" onClick={() => jumpLane('upper')}>
            Upper <span>Sem derrota</span>
          </button>
          {upperCount > 1 && (
            <button type="button" onClick={() => jumpLane('lower')}>
              Lower <span>Última chance</span>
            </button>
          )}
          <button type="button" onClick={() => jumpLane('final')}>
            Grande final <span>Vale o título</span>
          </button>
        </nav>
      )}
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
                {rounds.flat().flatMap((match) => {
                  const from = position(match);
                  return (['winner', 'loser'] as const).flatMap((outcome) => {
                    const target = rounds
                      .flat()
                      .find((candidate) =>
                        candidate.sources.some(
                          (source) =>
                            'matchId' in source &&
                            source.matchId === match.id &&
                            source.outcome === outcome,
                        ),
                      );
                    if (!target || (outcome === 'loser' && selected !== match.id)) return [];
                    const to = position(target);
                    const x = from.x + 224,
                      y = from.y + 49,
                      endY = to.y + 49;
                    const path =
                      outcome === 'loser'
                        ? `M ${x - 112} ${from.y + 98} V ${to.y - 12} H ${to.x + 112} V ${to.y}`
                        : `M ${x} ${y} H ${x + 20} V ${endY} H ${to.x}`;
                    return (
                      <path
                        key={`${match.id}-${outcome}`}
                        d={path}
                        className={
                          outcome === 'loser'
                            ? 'br-path-lower'
                            : match.winner
                              ? 'br-path-complete'
                              : undefined
                        }
                      />
                    );
                  });
                })}
              </svg>
              {double && (
                <>
                  <div className="br-lane-heading" style={{ top: 0 }}>
                    <strong>Upper</strong>
                    <span>
                      {upperCount > 1
                        ? 'A primeira derrota leva à lower'
                        : 'Duelo inicial antes da grande final'}
                    </span>
                  </div>
                  {lowerHeight > 0 && (
                    <div className="br-lane-heading br-lane-lower" style={{ top: upperHeight }}>
                      <strong>Lower</strong>
                      <span>Outra chance. Quem perder está fora.</span>
                    </div>
                  )}
                </>
              )}
              {phaseList.map((stage, round) => (
                <div
                  key={stage.id}
                  className="br-stage-label"
                  style={{
                    left: stage.lane === 'final' ? columns * 264 + 16 : stage.laneRound * 264 + 16,
                    top:
                      stage.lane === 'lower'
                        ? upperHeight + 44
                        : stage.lane === 'final'
                          ? lowerHeight
                            ? upperHeight - 50
                            : 28 + (upperHeight - 68) / 2 - 49
                          : double
                            ? 44
                            : 4,
                  }}
                >
                  <h3>{stage.label}</h3>
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
                <h3>{stageLabel(bracket, round)}</h3>
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
