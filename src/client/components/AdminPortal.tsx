import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import type { CreateScrimResponse, ScrimSummary } from '../../shared/protocol';
import { FORMAT_LABEL, type SeriesFormat } from '../../shared/veto';
import { ADMIN_AUTH_CHANGE, useAdminAuth } from '../hooks/useAdminAuth';
import { navigate, safeAdminReturnTo } from '../router';
import { adminFetch } from '../authFetch';
import { fmtDateTime } from '../util';

function internal(event: MouseEvent<HTMLAnchorElement>) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); navigate(event.currentTarget.getAttribute('href') ?? '/');
}

export function AdminPortal() {
  const auth = useAdminAuth();
  const returnTo = safeAdminReturnTo(new URLSearchParams(location.search).get('returnTo'));
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

function AdminDashboard({ returnTo }: { returnTo: string }) {
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<SeriesFormat>('bo3');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rooms, setRooms] = useState<ScrimSummary[] | null>(null);
  const [roomsError, setRoomsError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  const locked = useRef(false);
  useEffect(() => {
    const ctrl = new AbortController(); setRoomsError(false);
    fetch('/api/scrims', { signal: ctrl.signal, credentials: 'same-origin', cache: 'no-store' })
      .then(async response => { if (!response.ok) throw new Error(); const body = await response.json(); if (!Array.isArray(body)) throw new Error(); return body as ScrimSummary[]; })
      .then(value => { if (!ctrl.signal.aborted) setRooms(value); })
      .catch(() => { if (!ctrl.signal.aborted) setRoomsError(true); });
    return () => ctrl.abort();
  }, [retry]);
  async function create(event: FormEvent) {
    event.preventDefault(); if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const response = await adminFetch('/api/scrims', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title.trim() || `Scrim ${new Date().toLocaleDateString('pt-BR')}`, format }) });
      const body = await response.json();
      if (!response.ok) { if (response.status === 401 || response.status === 403) dispatchEvent(new Event(ADMIN_AUTH_CHANGE)); throw new Error(body.error ?? 'Não foi possível criar a sala. Tente novamente.'); }
      const { id } = body as CreateScrimResponse;
      if (typeof id !== 'string' || !/^[a-z0-9]{6,32}$/.test(id)) throw new Error('A sala foi criada, mas não foi possível abrir o link. Confira a lista antes de tentar novamente.');
      navigate(`/s/${id}`);
    } catch (err) { setError((err as Error).message); }
    finally { locked.current = false; setBusy(false); }
  }
  const visible = rooms?.filter(room => `${room.title} ${room.teams.join(' ')}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  return <main className="page admin-portal">
    <header className="admin-dashboard-heading"><div><span className="admin-mode-label">Administrador</span><h1>Área do administrador</h1><p className="muted">Crie a próxima scrim ou continue uma sala existente.</p></div><a href="/guia-admin.html" className="button">Guia do administrador</a></header>
    {returnTo !== '/admin' && <p className="admin-return"><a href={returnTo} onClick={internal}>Voltar para a sala que você estava acompanhando</a></p>}
    <div className="admin-dashboard-grid">
      <form className="card admin-create-form" onSubmit={create}><h2>Nova scrim</h2><p className="muted small">Depois de criar, você já entra com os controles de admin.</p><label>Nome da sala <span className="admin-optional">opcional</span><input value={title} onChange={event => setTitle(event.target.value)} placeholder="Scrim de sexta" maxLength={60} disabled={busy} /></label><fieldset className="segmented" aria-label="Formato">{(Object.keys(FORMAT_LABEL) as SeriesFormat[]).map(value => <label key={value} className={format === value ? 'on' : ''}><input type="radio" name="admin-format" value={value} checked={format === value} onChange={() => setFormat(value)} disabled={busy} />{FORMAT_LABEL[value]}</label>)}</fieldset>{error && <p className="admin-form-error" role="alert">{error}</p>}<button className="primary" type="submit" disabled={busy}>{busy ? 'Criando…' : 'Criar scrim'}</button><p className="admin-field-help">O link da sala é para os espectadores. E-mail e senha ficam só com os organizadores.</p></form>
      <section className="card admin-room-section"><div className="admin-room-heading"><h2>Continuar uma sala</h2><label><span className="admin-sr-only">Buscar salas para administrar</span><input placeholder="Buscar por sala ou time" value={search} onChange={event => setSearch(event.target.value)} /></label></div>{roomsError ? <div className="admin-list-error" role="alert"><p>Não foi possível carregar as salas.</p><button type="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div> : rooms === null ? <p className="muted" role="status">Carregando salas…</p> : !visible?.length ? <p className="muted">{rooms.length ? 'Nenhuma sala com esse nome. Tente outro nome ou time.' : 'Sua primeira sala vai aparecer aqui.'}</p> : <ul className="admin-room-list">{visible.map(room => <li key={room.id}><a href={`/s/${room.id}`} onClick={internal} aria-label={`Administrar ${room.title}`}><div><strong>{room.title}</strong><span>{room.teams[0]} vs {room.teams[1]}</span><small>{fmtDateTime(room.createdAt)}</small></div><span className="admin-room-action">Administrar</span></a></li>)}</ul>}</section>
    </div>
  </main>;
}
