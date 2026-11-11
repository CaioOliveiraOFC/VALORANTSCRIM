import { Avatar, Icon } from './Icons';
import { matches, stageName, type Bracket } from './model';
import type { View } from './types';

export function Home({
  bracket,
  organizer,
  navigate,
  openMatch,
}: {
  bracket: Bracket;
  organizer: boolean;
  navigate: (view: View) => void;
  openMatch: (id: string) => void;
}) {
  const rounds = matches(bracket);
  const featured = [...rounds]
    .reverse()
    .flat()
    .find((item) => item.status === 'ready');
  const ready = rounds.flat().filter((item) => item.status === 'ready');
  const champion = rounds.at(-1)?.[0]?.winner;
  return (
    <>
      <header className="br-home-heading">
        <div>
          <h1>A casa da nossa resenha.</h1>
          <p>Entrou, achou sua partida, jogou. O resto fica com a Brasa.</p>
        </div>
        <span className="br-community-note">
          <span className="br-live-dot" />O clube está reunido
        </span>
      </header>
      <div className="br-home-feature-grid">
        <section className="br-featured-event">
          <div className="br-featured-top">
            <span className="br-pill">
              <Icon name="crosshair" size={14} />
              Campeonato X1
            </span>
            <span className="br-event-status">
              <span className="br-live-dot" />
              {champion ? 'Encerrado' : 'Em andamento'}
            </span>
          </div>
          <h2>{bracket.title}</h2>
          <p className="br-featured-description">
            {champion
              ? `${champion.name} levou o título. A chave completa conta a história.`
              : 'Um contra um. Sem desculpa. Quem fica com a brasa?'}
          </p>
          {featured ? (
            <div className="br-featured-duel">
              <div>
                <Avatar name={featured.players[0]!.name} />
                <strong>{featured.players[0]!.name}</strong>
              </div>
              <span className="br-vs">
                vs<span>MD{featured.format}</span>
              </span>
              <div>
                <Avatar name={featured.players[1]!.name} />
                <strong>{featured.players[1]!.name}</strong>
              </div>
              <span className="br-duel-stage">{stageName(featured.round, rounds.length)}</span>
            </div>
          ) : (
            <div className="br-featured-duel br-featured-champion">
              <Icon name="cup" size={52} />
              <strong>{champion?.name ?? 'A chave está pronta'}</strong>
            </div>
          )}
          <div className="br-featured-bottom">
            <span>
              <Icon name="people" size={16} />
              {bracket.entrants.length} participantes
            </span>
            <button
              type="button"
              className="br-button br-primary"
              onClick={() => (featured ? openMatch(featured.id) : navigate('tournament'))}
            >
              Acompanhar campeonato
              <Icon name="arrow" size={18} />
            </button>
          </div>
        </section>
        <aside className="br-home-side">
          <div className="br-club-emblem">
            <img src="/brand/brasa-symbol.svg" width="112" height="126" alt="Símbolo Brasa" />
            <strong>
              Entre amigos.
              <br />
              Dentro do jogo.
            </strong>
            <p>Churras Club</p>
          </div>
          <div className="br-quick-help">
            <h2>{organizer ? 'Tudo pronto para conduzir.' : 'Só precisa chegar e jogar.'}</h2>
            <p>
              {organizer
                ? 'Abra a chave, selecione o duelo e confirme quem avançou. Todo mundo acompanha.'
                : 'Encontre seu nome na chave. Enquanto espera, deixe uma sugestão para o campeonato.'}
            </p>
            <button
              type="button"
              className="br-text-button"
              onClick={() => navigate(organizer ? 'tournament' : 'suggestions')}
            >
              {organizer ? 'Ir para a chave' : 'Sugerir meu apelido'}
              <Icon name="arrow" size={16} />
            </button>
          </div>
        </aside>
      </div>
      <section className="br-up-next">
        <div className="br-section-heading">
          <div>
            <h2>{ready.length ? 'Os próximos da roda' : 'A rodada está completa'}</h2>
            <p>Os confrontos prontos para acontecer.</p>
          </div>
          <button type="button" className="br-text-button" onClick={() => navigate('tournament')}>
            Ver chave completa
            <Icon name="arrow" size={16} />
          </button>
        </div>
        <div className="br-up-next-list">
          {ready.slice(0, 3).map((match) => (
            <button type="button" key={match.id} onClick={() => openMatch(match.id)}>
              <span className="br-up-next-phase">
                {stageName(match.round, rounds.length)}
                <small>MD{match.format}</small>
              </span>
              <span className="br-up-next-players">
                <span>
                  <Avatar name={match.players[0]!.name} small />
                  {match.players[0]!.name}
                </span>
                <small>vs</small>
                <span>
                  <Avatar name={match.players[1]!.name} small />
                  {match.players[1]!.name}
                </span>
              </span>
              <span className="br-ready-label">
                Aguardando duelo
                <Icon name="chevron" size={16} />
              </span>
            </button>
          ))}
          {!ready.length && (
            <p className="br-empty">
              {champion
                ? `Parabéns, ${champion.name}. O campeonato está no histórico desta prévia.`
                : 'A organização está preparando os próximos confrontos.'}
            </p>
          )}
        </div>
      </section>
      <section className="br-vct-strip">
        <span className="br-vct-icon">
          <Icon name="people" size={24} />
        </span>
        <div>
          <h2>Hoje também tem 5v5?</h2>
          <p>Times, veto e resultados das scrims continuam no site atual.</p>
        </div>
        <a className="br-button br-secondary" href="/">
          Abrir salas VCT
          <Icon name="arrow" size={16} />
        </a>
      </section>
    </>
  );
}
