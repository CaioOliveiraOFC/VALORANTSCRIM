import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import type { CreateScrimResponse, ScrimSummary, RoomAccess } from '../../shared/protocol';
import { FORMAT_LABEL, type SeriesFormat } from '../../shared/veto';
import { ADMIN_AUTH_CHANGE, useAdminAuth } from '../hooks/useAdminAuth';
import { navigate, safeAdminReturnTo } from '../router';
import { adminFetch } from '../authFetch';
import { fmtDateTime } from '../util';

function internal(event: MouseEvent<HTMLAnchorElement>) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); navigate(event.currentTarget.getAttribute('href') ?? '/');
}

export function AdminPortal({ returnToPath }: { returnToPath?: string } = {}) {
  const auth = useAdminAuth();
  const returnTo = safeAdminReturnTo(returnToPath ?? new URLSearchParams(location.search).get('returnTo'));
  if (auth.status === 'loading') return <main className="page admin-portal"><p className="muted" role="status">Verificando seu acesso…</p></main>;
  if (auth.status === 'error') return <main className="page admin-portal"><section className="card admin-access-error"><h1>Não foi possível verificar o acesso</h1><p className="muted">Confira sua conexão e tente novamente. As salas continuam disponíveis para acompanhar.</p><button type="button" onClick={() => void auth.refresh()}>Verificar novamente</button><a href="/" onClick={internal}>Acompanhar uma sala</a></section></main>;
  return auth.status === 'admin' ? <AdminDashboard returnTo={returnTo} /> : <AdminLogin returnTo={returnTo} />;
}

function AdminLogin({ returnTo }: { returnTo: string }) {
  const { login } = useAdminAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      await login(email, password); setPassword('');
      if (returnTo !== '/admin') navigate(returnTo);
    } catch (err) { setError((err as Error).message); }
    finally { locked.current = false; setBusy(false); }
  }
  return <main className="page admin-portal admin-login-page">
    <section className="admin-login-intro"><span className="admin-mode-label">Para quem organiza</span><h1>Entrar como administrador</h1><p className="muted">Um acesso para criar salas, montar os times e registrar os resultados.</p><a href="/" onClick={internal} className="admin-watch-link">Quero só acompanhar uma partida</a></section>
    <div className="admin-login-grid">
      <form className="card admin-login-form" onSubmit={submit}>
        <label>E-mail<input type="email" name="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} value={email} maxLength={254} onChange={event => setEmail(event.target.value)} required disabled={busy} /></label>
        <label>Senha<span className="admin-password-field"><input aria-label="Senha" type={visible ? 'text' : 'password'} name="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} /><button type="button" className="ghost" aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={visible} onClick={() => setVisible(value => !value)} disabled={busy}>{visible ? 'Ocultar' : 'Mostrar'}</button></span></label>
        {error && <p className="admin-form-error" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={busy || !email.trim() || !password}>{busy ? 'Entrando…' : 'Entrar'}</button>
        <p className="admin-field-help">Use o acesso fornecido pelo responsável. Se não conseguir entrar, peça que ele confira sua conta.</p>
      </form>
      <aside className="admin-help"><h2>Primeira vez organizando?</h2><ol><li>Entre com seu e-mail e senha.</li><li>Crie uma sala ou abra uma que já existe.</li><li>Compartilhe o link para a galera acompanhar.</li></ol><a className="button" href="/guia-admin.html">Abrir o guia do administrador</a><a className="admin-pdf-link" href="/guia-admin.pdf" download>Baixar o guia em PDF</a><p className="muted">Para assistir às scrims, basta abrir a sala. Não é preciso login.</p></aside>
    </div>
  </main>;
}

interface ManagedRoom extends ScrimSummary { access: RoomAccess; }
type AccessAction = 'show' | 'hide' | 'delete' | 'restore';
type RoomList = { key: 'active' | 'deleted'; rows: ManagedRoom[] };

function validAccess(value: unknown): value is RoomAccess {
  if (!value || typeof value !== 'object') return false;
  const access = value as RoomAccess;
  return typeof access.isPublic === 'boolean' && Number.isSafeInteger(access.accessVersion) && access.accessVersion >= 1 &&
    (access.deletedAt === null || typeof access.deletedAt === 'number' && Number.isFinite(access.deletedAt));
}
function parseRooms(value: unknown): ManagedRoom[] {
  if (!Array.isArray(value) || value.some(room => !room || typeof room !== 'object' || !validAccess(room.access))) throw new Error('Lista de salas inválida.');
  return value as ManagedRoom[];
}
function EyeIcon({ visible }: { visible: boolean }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{!visible && <path d="m3 3 18 18" />}</svg>;
}

function AdminDashboard({ returnTo }: { returnTo: string }) {
  const auth = useAdminAuth();
  const canCreateRooms = auth.can('createRooms');
  const canPublishRooms = auth.can('publishRooms');
  const canDeleteRooms = auth.can('deleteRooms');
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<SeriesFormat>('bo3');
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [roomError, setRoomError] = useState('');
  const [notice, setNotice] = useState('');
  const [list, setList] = useState<RoomList | null>(null);
  const [roomsError, setRoomsError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [filter, setFilter] = useState<'active' | 'deleted'>('active');
  const [search, setSearch] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const locked = useRef(false);
  const listRevision = useRef(0);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const listKey = canDeleteRooms && filter === 'deleted' ? 'deleted' : 'active';
  const rooms = list?.key === listKey ? list.rows : null;

  useEffect(() => { if (!canPublishRooms) setIsPublic(false); }, [canPublishRooms]);
  useEffect(() => {
    if (!canDeleteRooms) { setFilter('active'); setConfirmingDelete(null); }
  }, [canDeleteRooms]);
  useEffect(() => {
    setConfirmingDelete(null); setRoomError(''); setNotice('');
  }, [listKey]);
  useEffect(() => {
    if (confirmingDelete) confirmationRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [confirmingDelete]);
  useEffect(() => {
    const ctrl = new AbortController(); const revision = ++listRevision.current; setRoomsError(false);
    const url = `/api/scrims?scope=admin${listKey === 'deleted' ? '&deleted=true' : ''}`;
    adminFetch(url, { signal: ctrl.signal, credentials: 'same-origin', cache: 'no-store' })
      .then(async response => {
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) dispatchEvent(new Event(ADMIN_AUTH_CHANGE));
          throw new Error();
        }
        return parseRooms(await response.json());
      })
      .then(rows => { if (!ctrl.signal.aborted && revision === listRevision.current) setList({ key: listKey, rows }); })
      .catch(() => {
        if (!ctrl.signal.aborted && revision === listRevision.current) { setList(null); setRoomsError(true); }
      });
    return () => { ctrl.abort(); listRevision.current++; };
  }, [listKey, retry]);

  async function create(event: FormEvent) {
    event.preventDefault(); if (locked.current || !canCreateRooms) return;
    locked.current = true; setBusy('create'); setError('');
    try {
      const response = await adminFetch('/api/scrims', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title.trim() || `Scrim ${new Date().toLocaleDateString('pt-BR')}`, format, isPublic: canPublishRooms && isPublic }) });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) dispatchEvent(new Event(ADMIN_AUTH_CHANGE));
        throw new Error(body.error ?? 'Não foi possível criar a sala. Tente novamente.');
      }
      const { id } = body as CreateScrimResponse;
      if (typeof id !== 'string' || !/^[a-z0-9]{6,32}$/.test(id)) throw new Error('A sala foi criada, mas não foi possível abrir o link. Confira a lista antes de tentar novamente.');
      navigate(`/s/${id}`);
    } catch (err) { setError((err as Error).message); }
    finally { locked.current = false; setBusy(null); }
  }

  async function changeAccess(room: ManagedRoom, action: AccessAction) {
    if (locked.current || ((action === 'delete' || action === 'restore') ? !canDeleteRooms : !canPublishRooms)) return;
    locked.current = true; setBusy(`${action}:${room.id}`); setRoomError(''); setNotice('');
    try {
      const response = await adminFetch(`/api/scrims/${room.id}/access`, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, expectedAccessVersion: room.access.accessVersion }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409) {
        listRevision.current++; setList(null); setConfirmingDelete(null); setRetry(value => value + 1);
        throw new Error('A sala mudou em outro navegador. A lista foi recarregada; confira o estado antes de tentar novamente.');
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) dispatchEvent(new Event(ADMIN_AUTH_CHANGE));
        throw new Error(typeof body.error === 'string' ? body.error : 'Não foi possível alterar a sala. Tente novamente.');
      }
      if (!validAccess(body.access)) {
        listRevision.current++; setList(null); setRetry(value => value + 1);
        throw new Error('A sala respondeu sem o estado atualizado. Recarregamos a lista para conferir.');
      }
      const access: RoomAccess = body.access;
      listRevision.current++;
      setList(previous => previous?.key === listKey ? { key: listKey, rows: previous.rows
        .map(item => item.id === room.id ? { ...item, access } : item)
        .filter(item => listKey === 'deleted' ? item.access.deletedAt !== null : item.access.deletedAt === null) } : previous);
      setConfirmingDelete(null);
      const message: Record<AccessAction, string> = {
        show: `“${room.title}” está visível para os espectadores.`,
        hide: `“${room.title}” ficou oculta para os espectadores.`,
        delete: `“${room.title}” foi excluída da lista. O histórico foi guardado.`,
        restore: `“${room.title}” foi restaurada como oculta.`,
      };
      setNotice(message[action]); setRetry(value => value + 1);
    } catch (err) { setRoomError(err instanceof Error ? err.message : 'Não foi possível alterar a sala.'); }
    finally { locked.current = false; setBusy(null); }
  }

  const visible = rooms?.filter(room => `${room.title} ${room.teams.join(' ')}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  return <main className="page admin-portal">
    <header className="admin-dashboard-heading"><div><span className="admin-mode-label">Administrador</span><h1>Área do administrador</h1><p className="muted">{auth.isSuperAdmin ? 'Crie a próxima scrim ou administre as salas da comunidade.' : 'Crie a próxima scrim ou continue uma das suas salas.'}</p></div><a href="/guia-admin.html" className="button">Guia do administrador</a></header>
    {auth.can('editRoom') && <aside className="stream-admin-shortcut"><div><strong>Vai ter transmissão?</strong><p>Adicione os canais da Twitch e escolha onde a galera vai assistir.</p></div><a className="button" href="/admin/lives" onClick={internal}>Configurar transmissões</a></aside>}
    {returnTo !== '/admin' && <p className="admin-return"><a href={returnTo} onClick={internal}>Voltar para a sala que você estava acompanhando</a></p>}
    <div className={`admin-dashboard-grid${canCreateRooms ? '' : ' is-list-only'}`}>
      {canCreateRooms && <form className="card admin-create-form" onSubmit={create}>
        <h2>Nova scrim</h2><p className="muted small">Depois de criar, você já entra com os controles de admin.</p>
        <label>Nome da sala <span className="admin-optional">opcional</span><input value={title} onChange={event => setTitle(event.target.value)} placeholder="Scrim de sexta" maxLength={60} disabled={!!busy} /></label>
        <fieldset className="segmented" aria-label="Formato">{(Object.keys(FORMAT_LABEL) as SeriesFormat[]).map(value => <label key={value} className={format === value ? 'on' : ''}><input type="radio" name="admin-format" value={value} checked={format === value} onChange={() => setFormat(value)} disabled={!!busy} />{FORMAT_LABEL[value]}</label>)}</fieldset>
        <label className="admin-visibility-option"><input type="checkbox" name="isPublic" checked={isPublic} onChange={event => setIsPublic(event.target.checked)} disabled={!!busy || !canPublishRooms} /><span><strong>Mostrar para espectadores</strong><small>{isPublic ? 'A sala aparece na lista pública e pode ser acompanhada pelo link.' : 'Você e o super admin podem acessar a sala oculta.'}</small></span></label>
        {error && <p className="admin-form-error" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={!!busy}>{busy === 'create' ? 'Criando…' : 'Criar scrim'}</button>
        <p className="admin-field-help">{canPublishRooms ? 'Você pode mostrar ou ocultar a sala depois, pelo botão de olho na lista.' : 'Sua conta cria salas ocultas. O super admin pode publicá-las depois.'}</p>
      </form>}
      <section className="card admin-room-section">
        <div className="admin-room-heading"><h2>{listKey === 'deleted' ? 'Salas excluídas' : auth.isSuperAdmin ? 'Salas da comunidade' : 'Minhas salas'}</h2><label><span className="admin-sr-only">Buscar salas para administrar</span><input placeholder="Buscar por sala ou time" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
        {canDeleteRooms && <div className="admin-room-filters" role="group" aria-label="Filtrar salas administrativas"><button type="button" aria-pressed={listKey === 'active'} disabled={!!busy} onClick={() => setFilter('active')}>Salas</button><button type="button" aria-pressed={listKey === 'deleted'} disabled={!!busy} onClick={() => setFilter('deleted')}>Excluídas</button></div>}
        {listKey === 'deleted' && <p className="admin-room-filter-help">O histórico continua guardado. Restaurar devolve a sala ao painel como oculta.</p>}
        {roomError && <p className="admin-form-error admin-room-feedback" role="alert">{roomError}</p>}
        {notice && <p className="admin-room-notice" role="status">{notice}</p>}
        {roomsError ? <div className="admin-list-error" role="alert"><p>Não foi possível carregar as salas.</p><button type="button" disabled={!!busy} onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div> : rooms === null ? <p className="muted" role="status">Carregando salas…</p> : !visible?.length ? <p className="muted">{rooms.length ? 'Nenhuma sala com esse nome. Tente outro nome ou time.' : listKey === 'deleted' ? 'Nenhuma sala excluída.' : 'Sua primeira sala vai aparecer aqui.'}</p> :
          <ul className="admin-room-list admin-managed-rooms">{visible.map(room => <li key={room.id}>
            <div className="admin-managed-room-row">
              <div className="admin-managed-room-info"><strong>{room.title}</strong><span>{room.teams[0]} vs {room.teams[1]}</span><small>{fmtDateTime(room.createdAt)}</small><span className={`admin-room-visibility ${room.access.deletedAt !== null ? 'is-deleted' : room.access.isPublic ? 'is-public' : 'is-hidden'}`}>{room.access.deletedAt !== null ? 'Excluída' : room.access.isPublic ? 'Pública' : 'Oculta'}</span></div>
              <div className="admin-managed-room-actions">
                {listKey === 'deleted' ? <button type="button" className="admin-room-restore" disabled={!!busy} onClick={() => void changeAccess(room, 'restore')}>{busy === `restore:${room.id}` ? 'Restaurando…' : 'Restaurar'}</button> : <>
                  <a href={`/s/${room.id}`} onClick={internal} className="admin-room-manage-link" aria-label={`Administrar ${room.title}`}>Administrar</a>
                  {canPublishRooms && <button type="button" className={`admin-room-eye ${room.access.isPublic ? 'is-visible' : ''}`} aria-label={room.access.isPublic ? 'Ocultar sala dos espectadores' : 'Mostrar sala para espectadores'} aria-pressed={room.access.isPublic} title={`${room.access.isPublic ? 'Ocultar' : 'Mostrar'} ${room.title}`} disabled={!!busy} onClick={() => void changeAccess(room, room.access.isPublic ? 'hide' : 'show')}><EyeIcon visible={room.access.isPublic} /></button>}
                  {canDeleteRooms && confirmingDelete !== room.id && <button type="button" className="admin-room-delete" aria-label="Excluir sala" title={`Excluir ${room.title}`} disabled={!!busy} onClick={() => setConfirmingDelete(room.id)}>Excluir sala</button>}
                </>}
              </div>
            </div>
            {canDeleteRooms && confirmingDelete === room.id && <div className="admin-delete-confirmation" ref={confirmationRef} role="group" aria-labelledby={`delete-title-${room.id}`}><h3 id={`delete-title-${room.id}`}>Excluir “{room.title}”?</h3><p>Sai das listas. O histórico fica guardado e pode ser restaurado.</p><div><button type="button" disabled={!!busy} onClick={() => setConfirmingDelete(null)}>Cancelar</button><button type="button" className="admin-room-delete-confirm" disabled={!!busy} onClick={() => void changeAccess(room, 'delete')}>{busy === `delete:${room.id}` ? 'Excluindo…' : 'Excluir sala'}</button></div></div>}
          </li>)}</ul>}
      </section>
    </div>
  </main>;
}
