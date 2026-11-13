import { useEffect, useState, type MouseEvent } from 'react';
import { usePublicRooms } from '../../hooks/usePublicRooms';
import { navigate } from '../../router';
import { Icon } from '../../ui/Icons';
import { fmtDateTime } from '../../util';
import { phaseLabel, selectFeatured } from './featured';
import { HomeStreams } from '../streams/PublicStreams';

export function internal(event: MouseEvent<HTMLAnchorElement>) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  navigate(event.currentTarget.getAttribute('href') ?? '/');
}
function usePinnedRoom() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let current: AbortController | null = null;
    async function refresh() {
      current?.abort();
      const ctrl = new AbortController();
      current = ctrl;
      try {
        const response = await fetch('/api/home/featured', {
          signal: ctrl.signal,
          credentials: 'same-origin',
          cache: 'no-store',
        });
        const body = response.ok ? await response.json() : null;
        if (!disposed && !ctrl.signal.aborted)
          setId(typeof body?.roomId === 'string' ? body.roomId : null);
      } catch {
        if (!disposed && !ctrl.signal.aborted) setId(null);
      }
    }
    const active = () => {
      if (document.visibilityState !== 'hidden') void refresh();
    };
    void refresh();
    addEventListener('focus', active);
    document.addEventListener('visibilitychange', active);
    const timer = setInterval(active, 10_000);
    return () => {
      disposed = true;
      current?.abort();
      clearInterval(timer);
      removeEventListener('focus', active);
      document.removeEventListener('visibilitychange', active);
    };
  }, []);
  return id;
}
export function Landing() {
  const { rooms, error, retry } = usePublicRooms();
  const pinned = usePinnedRoom();
  const featured = rooms ? selectFeatured(rooms, pinned) : null;
  const active =
    rooms?.filter((room) => room.phase !== 'finished' && room.id !== featured?.id) ?? [];
  const recent =
    rooms
      ?.filter((room) => room.phase === 'finished' && room.id !== featured?.id)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 3) ?? [];
  return (
    <main className="page brasa-landing">
      <section className="club-hero" aria-label="Brasa e VCT em destaque">
        <div className="club-introduction">
          <div className="club-signature">
            <img src="/brand/brasa-symbol.svg" width="48" height="54" alt="" />
            <span>Churras Club</span>
          </div>
          <h1>
            O nosso jogo.
            <br />A nossa resenha.
          </h1>
          <p>
            Dez amigos, dois times e a vontade de ganhar.
            <br className="club-desktop-break" /> O nosso 5v5 começa aqui.
          </p>
          <div className="club-identity">
            <span>Brasa</span>
            <span>VALORANT entre amigos</span>
          </div>
        </div>
        <section className="club-featured" aria-labelledby="club-feature-title">
          <div className="club-feature-top">
            <span className="club-mode">
              <Icon name="people" size={15} />
              VCT · 5v5
            </span>
            {featured && (
              <span className={`club-phase ${featured.phase}`}>
                <i />
                {phaseLabel[featured.phase]}
              </span>
            )}
          </div>
          {error ? (
            <div className="club-feature-empty" role="alert">
              <h2 id="club-feature-title">As salas não carregaram.</h2>
              <p>Tente novamente para encontrar o VCT da galera.</p>
              <button type="button" onClick={retry}>
                Tentar novamente
              </button>
            </div>
          ) : rooms === null ? (
            <div className="club-feature-empty" role="status">
              <h2 id="club-feature-title">Encontrando a próxima partida…</h2>
              <p>Preparando as salas da Brasa.</p>
            </div>
          ) : featured ? (
            <>
              <p className="club-feature-context">
                {featured.phase === 'finished'
                  ? featured.id === pinned
                    ? 'VCT encerrado em destaque'
                    : 'Último encontro encerrado'
                  : featured.id === pinned
                    ? 'O encontro em destaque'
                    : 'A galera está por aqui'}
              </p>
              <h2 id="club-feature-title">{featured.title}</h2>
              <div className="club-versus">
                <div>
                  <span className="club-team-symbol team-A">A</span>
                  <strong>{featured.teams[0]}</strong>
                </div>
                <span className="club-versus-middle">
                  {featured.phase === 'finished' || featured.score.some((score) => score > 0) ? (
                    <b aria-label={`Placar da série: ${featured.score[0]} a ${featured.score[1]}`}>
                      {featured.score[0]} <small>:</small> {featured.score[1]}
                    </b>
                  ) : (
                    <span>vs</span>
                  )}
                </span>
                <div>
                  <span className="club-team-symbol team-B">B</span>
                  <strong>{featured.teams[1]}</strong>
                </div>
              </div>
              <p className="club-map-line">
                {featured.maps.length
                  ? featured.maps.join(' · ')
                  : featured.phase === 'setup'
                    ? 'Os times estão se formando. Chega junto.'
                    : 'Acompanhe os times e a escolha dos mapas.'}
              </p>
              <a
                className="button primary club-feature-action"
                href={`/s/${featured.id}`}
                onClick={internal}
              >
                {featured.phase === 'finished' ? 'Ver resultado do VCT' : 'Acompanhar VCT'}
                <Icon name="arrow" size={18} />
              </a>
              <div className="club-feature-footer">
                <span>Sem login para acompanhar</span>
                <a href="/vct" onClick={internal}>
                  Ver todas as salas
                </a>
              </div>
            </>
          ) : (
            <div className="club-feature-empty">
              <Icon name="people" size={32} />
              <h2 id="club-feature-title">O próximo 5v5 começa com a gente.</h2>
              <p>
                Ainda não há salas públicas. Quando a organização abrir um VCT, ele aparece aqui.
              </p>
              <a className="button" href="/vct" onClick={internal}>
                Ver salas VCT
              </a>
            </div>
          )}
        </section>
      </section>
      <HomeStreams />
      {active.length > 0 && (
        <section className="club-event-section">
          <div className="club-section-heading">
            <div>
              <h2>Mais gente na roda</h2>
              <p>Outras salas VCT abertas para acompanhar.</p>
            </div>
            <a href="/vct" onClick={internal}>
              Ver todas
              <Icon name="arrow" size={15} />
            </a>
          </div>
          <ul className="club-event-list">
            {active.slice(0, 3).map((room) => (
              <li key={room.id}>
                <a href={`/s/${room.id}`} onClick={internal}>
                  <div>
                    <span className={`club-phase ${room.phase}`}>
                      <i />
                      {phaseLabel[room.phase]}
                    </span>
                    <h3>{room.title}</h3>
                    <p>
                      {room.teams[0]} <span>vs</span> {room.teams[1]}
                    </p>
                  </div>
                  <Icon name="chevron" size={18} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="club-about">
        <div>
          <span className="club-about-icon">
            <Icon name="crosshair" size={25} />
          </span>
          <h2>
            Competir faz parte.
            <br />
            Voltar pra resenha também.
          </h2>
        </div>
        <p>
          A Brasa é o nosso ponto de encontro. Da montagem dos times ao último mapa, todo mundo
          acompanha o mesmo jogo, no mesmo lugar.
        </p>
        <a className="button" href="/vct" onClick={internal}>
          Encontrar meu VCT
          <Icon name="arrow" size={17} />
        </a>
      </section>
      {recent.length > 0 && (
        <section className="club-event-section">
          <div className="club-section-heading">
            <div>
              <h2>Ficou na história</h2>
              <p>Os últimos encontros da Brasa.</p>
            </div>
            <a href="/historico" onClick={internal}>
              Ver histórico
              <Icon name="arrow" size={15} />
            </a>
          </div>
          <ul className="club-results">
            {recent.map((room) => (
              <li key={room.id}>
                <a href={`/s/${room.id}`} onClick={internal}>
                  <div>
                    <strong>{room.title}</strong>
                    <span>{fmtDateTime(room.updatedAt)}</span>
                  </div>
                  <span>
                    {room.teams[0]}{' '}
                    <b>
                      {room.score[0]} × {room.score[1]}
                    </b>{' '}
                    {room.teams[1]}
                  </span>
                  <Icon name="chevron" size={17} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <aside className="club-x1-note">
        <Icon name="cup" size={23} />
        <div>
          <h2>Uma resenha, outros desafios.</h2>
          <p>O X1 também vai ter seu lugar na Brasa.</p>
        </div>
        <a href="/x1" onClick={internal}>
          Conhecer o X1
          <Icon name="arrow" size={16} />
        </a>
      </aside>
    </main>
  );
}

export function X1Page() {
  return (
    <main className="page club-x1-page">
      <span className="club-mode">
        <Icon name="crosshair" size={17} />
        X1 na Brasa
      </span>
      <h1>
        Um contra um.
        <br />A resenha continua.
      </h1>
      <p>
        Estamos preparando os campeonatos X1. Experimente a chave com eliminação simples ou com
        upper e lower, em dupla eliminação.
      </p>
      <div className="callout">
        <strong>Prévia com dados de exemplo</strong>
        <p>
          Os resultados ficam nesta aba e reiniciam ao recarregar. Os campeonatos ao vivo chegam em
          uma próxima entrega.
        </p>
      </div>
      <a className="button primary" href="/preview/brasa?tela=x1">
        Explorar a chave de exemplo
        <Icon name="arrow" size={17} />
      </a>
      <a className="club-back-link" href="/vct" onClick={internal}>
        Ir para as salas VCT
      </a>
    </main>
  );
}
