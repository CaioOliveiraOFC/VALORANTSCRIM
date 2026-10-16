import { useState, type FormEvent } from 'react';
import { ACTIVE_COMPETITIVE_POOL, ALL_MAP_IDS, MAPS, POOL_SIZE, type MapId } from '../../shared/maps';
import { MAX_PLAYERS, TEAM_IDS, type TeamId } from '../../shared/scrim';
import { FORMAT_LABEL, type SeriesFormat } from '../../shared/veto';
import { newId, shuffle } from '../util';
import { MapCard } from './MapCard';
import { useRoom } from './ScrimRoom';

export function TeamsPanel() {
  const { state, isAdmin, act } = useRoom();
  const editable = isAdmin && state.phase === 'setup';
  const [name, setName] = useState('');
  const bench = state.players.filter((p) => !p.team);

  async function addPlayer(e: FormEvent) {
    e.preventDefault();
    if (await act({ type: 'player.add', playerId: newId(), name })) setName('');
  }

  function randomize() {
    const ids = shuffle(state.players.map((p) => p.id));
    const half = Math.ceil(ids.length / 2);
    void act({ type: 'teams.set', A: ids.slice(0, half), B: ids.slice(half) });
  }

  return (
    <div className="stack">
      {editable && (
        <section className="card">
          <h2>Configuração</h2>
          <div className="row wrap">
            <label className="grow">
              Nome da scrim
              <input
                defaultValue={state.title}
                key={state.title}
                maxLength={60}
                onBlur={(e) => e.target.value.trim() !== state.title && act({ type: 'settings.update', title: e.target.value })}
              />
            </label>
            <fieldset className="segmented" aria-label="Formato">
              {(Object.keys(FORMAT_LABEL) as SeriesFormat[]).map((f) => (
                <label key={f} className={f === state.format ? 'on' : ''}>
                  <input type="radio" name="fmt" checked={f === state.format} onChange={() => act({ type: 'settings.update', format: f })} />
                  {FORMAT_LABEL[f]}
                </label>
              ))}
            </fieldset>
          </div>
          <PoolEditor />
        </section>
      )}

      <div className="teams">
        {TEAM_IDS.map((team) => (
          <TeamColumn key={team} team={team} editable={editable} />
        ))}
      </div>

      {(editable || bench.length > 0) && (
        <section className="card">
          <h2>
            Jogadores sem time <span className="muted">({state.players.length}/{MAX_PLAYERS})</span>
          </h2>
          {editable && (
            <form className="row" onSubmit={addPlayer}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nick do jogador" maxLength={32} />
              <button disabled={!name.trim()}>Adicionar</button>
              <button type="button" onClick={randomize} disabled={state.players.length < 2}>
                Sortear times
              </button>
            </form>
          )}
          <ul className="chips">
            {bench.map((p) => (
              <li key={p.id} className="chip">
                {p.name}
                {editable && (
                  <>
                    <button onClick={() => act({ type: 'player.assign', playerId: p.id, team: 'A' })}>→ {state.teams.A.name}</button>
                    <button onClick={() => act({ type: 'player.assign', playerId: p.id, team: 'B' })}>→ {state.teams.B.name}</button>
                    <button className="ghost" aria-label={`Remover ${p.name}`} onClick={() => act({ type: 'player.remove', playerId: p.id })}>
                      ✕
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {editable && <StartVeto />}
    </div>
  );
}

function TeamColumn({ team, editable }: { team: TeamId; editable: boolean }) {
  const { state, isAdmin, act } = useRoom();
  const info = state.teams[team];
  const roster = state.players.filter((p) => p.team === team);

  return (
    <section className={`card team team-${team}`}>
      {editable ? (
        <input
          className="team-name"
          defaultValue={info.name}
          key={info.name}
          maxLength={32}
          aria-label={`Nome do ${info.name}`}
          onBlur={(e) => e.target.value.trim() && e.target.value !== info.name && act({ type: 'team.rename', team, name: e.target.value })}
        />
      ) : (
        <h2>{info.name}</h2>
      )}
      <ul className="roster">
        {roster.map((p) => (
          <li key={p.id}>
            <span>
              {p.name} {info.captainId === p.id && <span className="badge">C</span>}
            </span>
            {editable && (
              <span className="row">
                <button className="ghost" onClick={() => act({ type: 'team.captain', team, playerId: info.captainId === p.id ? null : p.id })}>
                  {info.captainId === p.id ? 'Tirar capitão' : 'Capitão'}
                </button>
                <button className="ghost" onClick={() => act({ type: 'player.assign', playerId: p.id, team: null })}>
                  Banco
                </button>
              </span>
            )}
          </li>
        ))}
        {roster.length === 0 && <li className="muted">Ninguém ainda.</li>}
      </ul>
      {roster.length !== 5 && roster.length > 0 && <p className="muted small">{roster.length}/5 jogadores</p>}
    </section>
  );
}

function PoolEditor() {
  const { state, act } = useRoom();
  const [draft, setDraft] = useState<MapId[] | null>(null);
  const pool = draft ?? state.pool;

  const toggle = (id: MapId) =>
    setDraft(pool.includes(id) ? pool.filter((m) => m !== id) : pool.length < POOL_SIZE ? [...pool, id] : pool);

  async function save() {
    if (await act({ type: 'settings.update', pool })) setDraft(null);
  }

  return (
    <details className="pool-editor">
      <summary>
        Pool de mapas: {state.pool.map((m) => MAPS[m].name).join(', ')}
      </summary>
      <p className="muted small">
        Escolha {POOL_SIZE} mapas ({pool.length}/{POOL_SIZE}). Padrão: pool competitiva atual.
      </p>
      <div className="map-grid small">
        {ALL_MAP_IDS.map((id) => (
          <MapCard key={id} mapId={id} state={pool.includes(id) ? 'picked' : 'off'} onClick={() => toggle(id)} />
        ))}
      </div>
      <div className="row">
        <button className="primary" disabled={!draft || pool.length !== POOL_SIZE} onClick={save}>
          Salvar pool
        </button>
        <button onClick={() => setDraft([...ACTIVE_COMPETITIVE_POOL])}>Restaurar padrão</button>
        {draft && <button className="ghost" onClick={() => setDraft(null)}>Cancelar</button>}
      </div>
    </details>
  );
}

function StartVeto() {
  const { state, act } = useRoom();
  const [first, setFirst] = useState<TeamId>('A');
  const counts = TEAM_IDS.map((t) => state.players.filter((p) => p.team === t).length);
  const uneven = counts.some((c) => c !== 5);

  return (
    <section className="card">
      <h2>Iniciar veto</h2>
      <p className="muted small">
        Quem venceu o sorteio (ou o duelo 1v1) escolhe ser o <b>Team A</b> (começa banindo) ou o <b>Team B</b>.
      </p>
      <div className="row wrap">
        <fieldset className="segmented" aria-label="Quem começa o veto">
          {TEAM_IDS.map((t) => (
            <label key={t} className={t === first ? 'on' : ''}>
              <input type="radio" name="first" checked={t === first} onChange={() => setFirst(t)} />
              {state.teams[t].name} começa
            </label>
          ))}
        </fieldset>
        <button className="primary" disabled={uneven || state.players.length !== 10} onClick={() => act({ type: 'veto.start', first })}>
          Começar veto
        </button>
      </div>
      {uneven && <p className="warn small">Atenção: os times não estão 5x5 ({counts.join(' x ')}).</p>}
    </section>
  );
}
