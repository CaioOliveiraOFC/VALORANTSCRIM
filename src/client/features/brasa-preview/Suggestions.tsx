import { useState, type FormEvent } from 'react';
import { Avatar, Icon } from './Icons';
import { cleanName, type Bracket, type Proposal } from './model';

export function Suggestions({
  bracket,
  proposals,
  organizer,
  actorId,
  accept,
  reject,
  edit,
  send,
  changeRole,
}: {
  bracket: Bracket;
  proposals: Proposal[];
  organizer: boolean;
  actorId: string;
  accept: (proposal: Proposal) => void;
  reject: (proposal: Proposal) => void;
  edit: (proposal: Proposal) => void;
  send: (proposals: Proposal[]) => void;
  changeRole: () => void;
}) {
  const actor = bracket.entrants.find((player) => player.id === actorId)!;
  const [nickname, setNickname] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'nickname' | 'title'>('all');
  const pending = proposals.filter(
    (item) => item.status === 'pending' && (filter === 'all' || item.kind === filter),
  );
  const mine = proposals.filter((item) => item.authorId === actorId);
  function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      if (!nickname.trim() && !title.trim())
        throw new Error('Preencha um apelido ou uma sugestão de título.');
      const items: Proposal[] = [];
      if (nickname.trim())
        items.push({
          id: crypto.randomUUID(),
          authorId: actorId,
          kind: 'nickname',
          previous: actor.name,
          value: cleanName(nickname),
          status: 'pending',
        });
      if (title.trim())
        items.push({
          id: crypto.randomUUID(),
          authorId: actorId,
          kind: 'title',
          previous: bracket.title,
          value: cleanName(title, 80),
          status: 'pending',
        });
      if (
        items.some((item) =>
          proposals.some(
            (old) => old.status === 'pending' && old.authorId === actorId && old.kind === item.kind,
          ),
        )
      )
        throw new Error('Você já tem uma sugestão desse tipo aguardando revisão.');
      send(items);
      setNickname('');
      setTitle('');
    } catch (err) {
      setError((err as Error).message);
    }
  }
  function approve(proposal: Proposal) {
    setError('');
    try {
      accept(proposal);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <>
      <div className="br-breadcrumb">
        <span>{bracket.title}</span>
        <Icon name="chevron" size={12} />
        <span>Sugestões</span>
      </div>
      <header className="br-page-heading">
        <div>
          <h1>{organizer ? 'A resenha também escolhe.' : 'Seu nome. Sua resenha.'}</h1>
          <p>
            {organizer
              ? 'Aprove os apelidos e escolha o nome que vai para a chave.'
              : 'Deixe o apelido do seu jeito e sugira um nome para o campeonato.'}
          </p>
        </div>
        <span className="br-approval-tag">
          <Icon name={organizer ? 'people' : 'clock'} size={17} />
          {organizer
            ? `${proposals.filter((item) => item.status === 'pending').length} aguardando revisão`
            : 'A organização aprova antes de publicar'}
        </span>
      </header>
      {organizer ? (
        <div className="br-moderation-layout">
          <section className="br-moderation">
            <div className="br-filter-tabs" aria-label="Filtrar sugestões">
              {(['all', 'nickname', 'title'] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {value === 'all'
                    ? 'Todas'
                    : value === 'nickname'
                      ? 'Apelidos'
                      : 'Nome do campeonato'}
                  <span>
                    {
                      proposals.filter(
                        (item) =>
                          item.status === 'pending' && (value === 'all' || item.kind === value),
                      ).length
                    }
                  </span>
                </button>
              ))}
            </div>
            {error && (
              <p className="br-error" role="alert">
                {error}
              </p>
            )}
            <div className="br-proposal-list">
              {pending.map((proposal) => {
                const author = bracket.entrants.find((player) => player.id === proposal.authorId)!;
                return (
                  <article className="br-proposal" key={proposal.id}>
                    <div className="br-proposal-author">
                      <Avatar name={author.name} small />
                      <strong>{author.name}</strong>
                      <span>
                        {proposal.kind === 'nickname'
                          ? 'Quer um novo apelido'
                          : 'Sugeriu um título'}
                      </span>
                    </div>
                    <div className="br-name-change">
                      <div>
                        <span>
                          {proposal.kind === 'nickname' ? 'Nome atual' : 'Campeonato atual'}
                        </span>
                        <p>{proposal.kind === 'nickname' ? author.name : bracket.title}</p>
                      </div>
                      <Icon name="arrow" size={19} />
                      <div>
                        <span>Sugestão</span>
                        <strong>{proposal.value}</strong>
                      </div>
                    </div>
                    <div className="br-proposal-actions">
                      <button
                        type="button"
                        className="br-button br-primary"
                        onClick={() => approve(proposal)}
                      >
                        <Icon name="check" size={15} />
                        Aceitar
                      </button>
                      <button
                        type="button"
                        className="br-button br-secondary"
                        onClick={() => edit(proposal)}
                      >
                        <Icon name="edit" size={14} />
                        Ajustar e aceitar
                      </button>
                      <button type="button" className="br-decline" onClick={() => reject(proposal)}>
                        Recusar
                      </button>
                    </div>
                  </article>
                );
              })}
              {!pending.length && (
                <div className="br-empty br-inbox-clear">
                  <Icon name="check" size={30} />
                  <h2>Tudo revisado por aqui.</h2>
                  <p>Os nomes aprovados já aparecem na chave desta prévia.</p>
                </div>
              )}
            </div>
          </section>
          <aside className="br-suggestion-aside">
            <img src="/brand/brasa-symbol.svg" width="57" height="64" alt="" />
            <h2>
              A cara do campeonato
              <br />
              vem de quem joga.
            </h2>
            <p>
              Um apelido diferente muda só a forma de aparecer. O jogador continua sendo o mesmo na
              chave.
            </p>
            <div>
              <Icon name="eye" size={18} />
              <p>Quem acompanha só vê os nomes que você aprovar.</p>
            </div>
            <button type="button" className="br-button br-secondary" onClick={changeRole}>
              Testar envio como jogador
              <Icon name="arrow" size={16} />
            </button>
          </aside>
        </div>
      ) : (
        <div className="br-participation-layout">
          <section className="br-suggestion-form">
            <div className="br-form-person">
              <Avatar name={actor.name} />
              <div>
                <span>Você nesta prévia</span>
                <strong>{actor.name}</strong>
              </div>
              <span className="br-pill">Participante</span>
            </div>
            <form onSubmit={submit}>
              <label className="br-field">
                Como seu nome deve aparecer?
                <input
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder={`Hoje você aparece como ${actor.name}`}
                  maxLength={32}
                  autoComplete="off"
                />
                <span className="br-field-hint">Seu apelido vale só para este campeonato.</span>
              </label>
              <label className="br-field">
                Uma ideia de nome para o campeonato?
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Ex.: A última brasa"
                  maxLength={80}
                  autoComplete="off"
                />
                <span className="br-field-hint">Pode preencher só um dos campos.</span>
              </label>
              <div className="br-form-explainer">
                <Icon name="clock" size={19} />
                <p>
                  A organização revisa sua sugestão. Até lá, os nomes atuais continuam na chave.
                </p>
              </div>
              {error && (
                <p className="br-error" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="br-button br-primary">
                Enviar sugestão
                <Icon name="arrow" size={17} />
              </button>
            </form>
          </section>
          <aside className="br-my-suggestions">
            <h2>O que você sugeriu</h2>
            {mine.length ? (
              <ul>
                {mine.map((item) => (
                  <li key={item.id}>
                    <span>{item.kind === 'nickname' ? 'Seu apelido' : 'Nome do campeonato'}</span>
                    <strong>{item.value}</strong>
                    <span className={`br-proposal-state is-${item.status}`}>
                      <Icon
                        name={
                          item.status === 'accepted'
                            ? 'check'
                            : item.status === 'rejected'
                              ? 'close'
                              : 'clock'
                        }
                        size={13}
                      />
                      {item.status === 'accepted'
                        ? 'Aprovada'
                        : item.status === 'rejected'
                          ? 'Não escolhida'
                          : 'Aguardando revisão'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="br-muted">
                Suas sugestões e a resposta da organização vão aparecer aqui.
              </p>
            )}
            <button type="button" className="br-text-button" onClick={changeRole}>
              Testar revisão como organizador
              <Icon name="arrow" size={15} />
            </button>
          </aside>
        </div>
      )}
    </>
  );
}
