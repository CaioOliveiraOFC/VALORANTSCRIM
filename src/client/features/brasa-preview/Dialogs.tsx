import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Avatar, Icon } from '../../ui/Icons';
import {
  affectedResults,
  changeFormat,
  createBracket,
  findMatch,
  matches,
  roundCount,
  stageName,
  type BestOf,
  type Bracket,
  type Proposal,
} from './model';
import type { PendingWinner } from './types';

function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      className="br-modal"
      ref={ref}
      aria-labelledby="br-dialog-title"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const items = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
          ),
        ];
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            close();
        }
      }}
    >
      <header>
        <h2 id="br-dialog-title">{title}</h2>
        <button type="button" className="br-icon-button" aria-label="Fechar" onClick={close}>
          <Icon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}

export function WinnerModal({
  bracket,
  pending,
  close,
  confirm,
}: {
  bracket: Bracket;
  pending: PendingWinner;
  close: () => void;
  confirm: (invalidate: boolean, wins?: [number, number]) => void;
}) {
  const [error, setError] = useState('');
  const [score, setScore] = useState('none');
  const [consent, setConsent] = useState(false);
  const match = findMatch(bracket, pending.matchId);
  const winner = match.players.find((player) => player?.id === pending.playerId)!;
  const affected = affectedResults(bracket, match.id, winner.id);
  const needed = (match.format + 1) / 2;
  function submit(event: FormEvent) {
    event.preventDefault();
    const winnerIndex = match.players.findIndex((player) => player?.id === winner.id);
    const wins: [number, number] | undefined =
      score === 'none'
        ? undefined
        : winnerIndex === 0
          ? [needed, Number(score)]
          : [Number(score), needed];
    try {
      confirm(consent, wins);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Modal title="Confirmar vencedor" close={close}>
      <form onSubmit={submit}>
        <div className="br-confirm-player">
          <Avatar name={winner.name} />
          <div>
            <strong>{winner.name}</strong>
            <p>
              {match.round + 1 === roundCount(bracket)
                ? 'Vai ser o campeão deste exemplo.'
                : `Avança para ${stageName(match.round + 1, roundCount(bracket)).toLocaleLowerCase('pt-BR')}.`}
            </p>
          </div>
          <Icon name="cup" size={25} />
        </div>
        <label className="br-field">
          Placar da série <span className="br-optional">opcional</span>
          <select value={score} onChange={(event) => setScore(event.target.value)}>
            <option value="none">Registrar só o vencedor</option>
            {Array.from({ length: needed }, (_, loser) => (
              <option key={loser} value={loser}>
                {needed} a {loser} para {winner.name}
              </option>
            ))}
          </select>
        </label>
        {affected.length > 0 && (
          <div className="br-warning">
            <strong>Há resultados que dependem deste duelo.</strong>
            <p>
              A alteração reabre:{' '}
              {affected
                .map((id) => {
                  const item = findMatch(bracket, id);
                  return `${stageName(item.round, roundCount(bracket))}, confronto ${item.index + 1}`;
                })
                .join('; ')}
              .
            </p>
            <label className="br-checkbox">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              Entendi e quero reabrir esses resultados.
            </label>
          </div>
        )}
        <p className="br-form-note">Esta ação atualiza apenas os dados de exemplo desta aba.</p>
        {error && (
          <p role="alert" className="br-error">
            {error}
          </p>
        )}
        <div className="br-modal-actions">
          <button type="button" className="br-button br-secondary" onClick={close}>
            Voltar
          </button>
          <button
            type="submit"
            className="br-button br-primary"
            disabled={affected.length > 0 && !consent}
          >
            Confirmar vencedor
            <Icon name="check" size={17} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function SetupModal({
  bracket,
  close,
  save,
}: {
  bracket: Bracket;
  close: () => void;
  save: (bracket: Bracket) => void;
}) {
  const [names, setNames] = useState(bracket.entrants.map((player) => player.name).join('\n'));
  const [size, setSize] = useState(String(bracket.size));
  const [formats, setFormats] = useState(bracket.formats);
  const [error, setError] = useState('');
  const [resetConsent, setResetConsent] = useState(false);
  const parsedNames = names
    .split(/[\n,;]+/)
    .map((name) => name.trim())
    .filter(Boolean);
  const capacity =
    size === 'auto'
      ? Math.max(2, Math.min(32, 2 ** Math.ceil(Math.log2(parsedNames.length || 2))))
      : Number(size);
  const count = Math.log2(capacity);
  const requiresReset = names !== bracket.entrants.map((player) => player.name).join('\n') || capacity !== bracket.size;
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      if (requiresReset && !resetConsent)
        throw new Error('Confirme que deseja substituir a chave de exemplo.');
      let next = requiresReset ? createBracket(parsedNames, capacity, bracket.title) : bracket;
      for (let round = 0; round < next.formats.length; round++) {
        const format = formats[round] ?? (round === count - 1 ? 5 : 1);
        if (next.formats[round] !== format) next = changeFormat(next, round, format);
      }
      save(next);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Modal title="Configurar campeonato de exemplo" close={close}>
      <form onSubmit={submit}>
        <p className="br-modal-intro">
          Experimente outra quantidade de participantes ou um formato por fase.
        </p>
        <label className="br-field">
          Participantes
          <textarea
            rows={5}
            value={names}
            onChange={(event) => {
              const value = event.target.value;
              setNames(value);
              if (value.split(/[\n,;]+/).map(name => name.trim()).filter(Boolean).length > capacity) setSize('auto');
            }}
            maxLength={2000}
          />
          <span className="br-field-hint">
            Um por linha. De 2 a 32 jogadores, sem nomes repetidos.
          </span>
        </label>
        <label className="br-field">
          Fase inicial
          <select value={size} onChange={(event) => setSize(event.target.value)}>
            <option value="auto">Sugerir pela quantidade de jogadores</option>
            {[2, 4, 8, 16, 32].map((value) => (
              <option key={value} value={value}>
                {stageName(0, Math.log2(value))} · {value} posições
              </option>
            ))}
          </select>
        </label>
        {parsedNames.length <= capacity && parsedNames.length >= 2 && (
          <p className="br-form-note">
            {parsedNames.length} participantes · {capacity} posições
            {capacity > parsedNames.length
              ? ` · ${capacity - parsedNames.length} vagas livres`
              : ''}
            .
          </p>
        )}
        <fieldset className="br-formats">
          <legend>Formato por fase</legend>
          {Array.from({ length: count }, (_, round) => {
            const locked =
              !requiresReset &&
              matches(bracket)
                .slice(round)
                .flat()
                .some((match) => match.result);
            return (
              <label key={`${count}-${round}`}>
                <span>
                  {stageName(round, count)}
                  {locked && <small>Já tem resultado</small>}
                </span>
                <select
                  aria-label={`Formato de ${stageName(round, count)}`}
                  disabled={locked}
                  value={formats[round] ?? (round === count - 1 ? 5 : 1)}
                  onChange={(event) =>
                    setFormats((old) =>
                      Array.from({ length: count }, (_, index) =>
                        index === round
                          ? (Number(event.target.value) as BestOf)
                          : (old[index] ?? (index === count - 1 ? 5 : 1)),
                      ),
                    )
                  }
                >
                  {[1, 3, 5].map((value) => (
                    <option value={value} key={value}>
                      MD{value}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </fieldset>
        {requiresReset && (
          <label className="br-checkbox br-warning">
            <input
              type="checkbox"
              checked={resetConsent}
              onChange={(event) => setResetConsent(event.target.checked)}
            />
            Substituir a chave e zerar os resultados deste exemplo.
          </label>
        )}
        {error && (
          <p className="br-error" role="alert">
            {error}
          </p>
        )}
        <div className="br-modal-actions">
          <button type="button" className="br-button br-secondary" onClick={close}>
            Cancelar
          </button>
          <button type="submit" className="br-button br-primary">
            Aplicar no exemplo
            <Icon name="check" size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function EditProposalModal({
  bracket,
  proposal,
  close,
  save,
}: {
  bracket: Bracket;
  proposal: Proposal;
  close: () => void;
  save: (proposal: Proposal, value: string) => void;
}) {
  const [value, setValue] = useState(proposal.value);
  const [error, setError] = useState('');
  const current =
    proposal.kind === 'title'
      ? bracket.title
      : bracket.entrants.find((player) => player.id === proposal.authorId)!.name;
  return (
    <Modal title="Ajustar e aceitar sugestão" close={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            save({ ...proposal, previous: current }, value);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <p className="br-modal-intro">
          Nome atual: <strong>{current}</strong>. Revise o texto que vai aparecer para todos.
        </p>
        <label className="br-field">
          {proposal.kind === 'title' ? 'Nome do campeonato' : 'Apelido aprovado'}
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            maxLength={proposal.kind === 'title' ? 80 : 32}
            autoFocus
          />
        </label>
        {error && (
          <p className="br-error" role="alert">
            {error}
          </p>
        )}
        <div className="br-modal-actions">
          <button type="button" className="br-button br-secondary" onClick={close}>
            Cancelar
          </button>
          <button type="submit" className="br-button br-primary">
            Aceitar com ajuste
            <Icon name="check" size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
