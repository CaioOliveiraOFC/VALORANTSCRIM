import { Avatar, Icon } from './Icons';
import { findMatch, roundCount, stageName, type Bracket, type Match } from './model';

export function DuelPanel({
  bracket,
  selected,
  organizer,
  advance,
  announce,
}: {
  bracket: Bracket;
  selected: string;
  organizer: boolean;
  advance: (match: Match, id: string) => void;
  announce: (message: string) => void;
}) {
  const match = findMatch(bracket, selected);
  const actionable = ['ready', 'finished'].includes(match.status);
  return (
    <aside className="br-duel-panel" aria-label="Detalhes do confronto" tabIndex={-1}>
      <div className="br-duel-panel-heading">
        <span>
          <Icon name="crosshair" size={18} />O duelo
        </span>
        <span className="br-pill">MD{match.format}</span>
      </div>
      <h2>{stageName(match.round, roundCount(bracket))}</h2>
      <p className="br-muted">Confronto {match.index + 1}</p>
      <div className="br-duel-contestants">
        {match.players.map((player, index) => (
          <div key={index} className={player && match.winner?.id === player.id ? 'is-winner' : ''}>
            {player ? (
              <>
                <Avatar name={player.name} />
                <strong>{player.name}</strong>
                {match.winner?.id === player.id && (
                  <span>
                    <Icon name="check" size={13} />
                    Vencedor
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="br-unknown-player">?</span>
                <strong>{match.waiting[index] ? 'A definir' : 'Vaga livre'}</strong>
              </>
            )}
            {index === 0 && <span className="br-duel-vs">vs</span>}
          </div>
        ))}
      </div>
      <div className="br-duel-description">
        <Icon name="clock" size={16} />
        <p>
          {match.status === 'finished'
            ? 'Resultado confirmado pela organização.'
            : match.status === 'bye'
              ? 'Sem adversário nesta fase. Avanço automático.'
              : match.status === 'ready'
                ? `Melhor de ${match.format}. Aguardando a confirmação do resultado.`
                : 'Os vencedores da fase anterior entram aqui.'}
        </p>
      </div>
      {organizer && actionable ? (
        <div className="br-winner-actions">
          <h3>{match.status === 'finished' ? 'Corrigir vencedor' : 'Quem venceu?'}</h3>
          {match.players.map(
            (player) =>
              player && (
                <button
                  type="button"
                  key={player.id}
                  className="br-button br-secondary"
                  onClick={() => advance(match, player.id)}
                >
                  <span>{player.name}</span>
                  <Icon name="chevron" size={15} />
                </button>
              ),
          )}
          <p>Você revisa antes de confirmar.</p>
        </div>
      ) : (
        <div className="br-spectator-note">
          <Icon name="eye" size={17} />
          <p>
            {organizer
              ? 'O resultado fica disponível quando os dois participantes estiverem definidos.'
              : 'Pode deixar esta tela aberta. Na versão ao vivo, as decisões aparecem aqui.'}
          </p>
        </div>
      )}
      {organizer && (
        <button
          type="button"
          className="br-focus-button"
          onClick={() =>
            announce('Foco demonstrado neste duelo. Esta prévia não está conectada a espectadores.')
          }
        >
          <Icon name="crosshair" size={17} />
          Testar chamada de foco
        </button>
      )}
    </aside>
  );
}
