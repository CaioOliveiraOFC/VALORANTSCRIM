import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import {
  PERMISSION_DEFINITIONS, PERMISSION_KEYS, parsePermissions, presetPermissions,
  type AdminAccount, type AdminAccountsPage, type AdminPermissions, type AdminPreset,
} from '../../shared/adminPermissions';
import type { RoomAccess, ScrimSummary } from '../../shared/protocol';
import { adminFetch } from '../authFetch';
import { ADMIN_AUTH_CHANGE, useAdminAuth } from '../hooks/useAdminAuth';
import { navigate } from '../router';
import { copyText, fmtDateTime } from '../util';
import './SuperAdminPanel.css';

const PAGE_SIZE = 25;
type Reply = Record<string, any>;
class ManagementError extends Error {
  constructor(message: string, readonly status: number, readonly pending = false, readonly samePasswordRequired = false, readonly updatedAccount?: AdminAccount, readonly recoveryToken?: string) { super(message); }
}
function internal(event: MouseEvent<HTMLAnchorElement>) {
  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); navigate(event.currentTarget.getAttribute('href') ?? '/admin');
}
async function request(url: string, init: RequestInit = {}): Promise<Reply> {
  const response = await adminFetch(url, { cache: 'no-store', ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) dispatchEvent(new Event(ADMIN_AUTH_CHANGE));
    throw new ManagementError(typeof body.error === 'string' ? body.error : 'Não foi possível concluir. Tente novamente.', response.status, body.pending === true, body.samePasswordRequired === true, body.account ? account(body.account) : undefined, typeof body.recoveryToken === 'string' && body.recoveryToken.length <= 2048 ? body.recoveryToken : undefined);
  }
  return body;
}
const mutation = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
function account(value: unknown): AdminAccount {
  if (!value || typeof value !== 'object') throw new Error('A lista de administradores está incompleta.');
  const item = value as AdminAccount;
  if (typeof item.id !== 'string' || !item.id || typeof item.email !== 'string' || typeof item.displayName !== 'string' ||
      typeof item.active !== 'boolean' || typeof item.isSuperAdmin !== 'boolean' || typeof item.provisioned !== 'boolean' ||
      !['organizer', 'full'].includes(item.preset) || !Number.isInteger(item.version) || item.version < (item.provisioned ? 1 : 0) ||
      (!item.provisioned && (item.version !== 0 || item.active)) || !Number.isFinite(item.createdAt) || !Number.isFinite(item.updatedAt)) throw new Error('A lista de administradores está incompleta.');
  return { ...item, permissions: parsePermissions(item.permissions) };
}
function accountsPage(value: Reply): AdminAccountsPage {
  if (!Array.isArray(value.accounts) || !Number.isInteger(value.total) || value.total < 0 ||
      !(value.nextOffset === null || (Number.isInteger(value.nextOffset) && value.nextOffset >= 0))) throw new Error('Não foi possível conferir a lista de administradores.');
  return { accounts: value.accounts.map(account), total: value.total, nextOffset: value.nextOffset };
}
function message(error: unknown) { return error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.'; }
function conflict(error: unknown) { return error instanceof ManagementError && error.status === 409; }

export function SuperAdminPanel() {
  const auth = useAdminAuth();
  useEffect(() => { if (auth.status === 'viewer') navigate('/admin?returnTo=%2Fadmin%2Fmanagement'); }, [auth.status]);
  if (auth.status === 'loading') return <main className="page super-admin"><p role="status" className="muted">Verificando seu acesso…</p></main>;
  if (auth.status === 'error') return <main className="page super-admin"><section className="card super-restricted"><h1>Não foi possível verificar o acesso</h1><p>Confira sua conexão e tente novamente.</p><button onClick={() => void auth.refresh()}>Verificar novamente</button></section></main>;
  if (auth.status !== 'admin' || !auth.isSuperAdmin) return <main className="page super-admin"><section className="card super-restricted"><h1>Acesso restrito ao super admin</h1><p>Esta área é reservada à gestão de administradores e de todas as salas.</p><a className="button" href="/admin" onClick={internal}>{auth.status === 'admin' ? 'Voltar para minhas salas' : 'Entrar como administrador'}</a></section></main>;
  return <ManagementWorkspace />;
}

function ManagementWorkspace() {
  const [tab, setTab] = useState<'accounts' | 'rooms'>('accounts');
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs = [{ key: 'accounts' as const, label: 'Administradores' }, { key: 'rooms' as const, label: 'Todas as salas' }];
  return <main className="page super-admin">
    <header className="super-heading"><div><h1>Administração</h1><p>Controle quem organiza e acompanhe as salas da comunidade.</p></div><span className="super-owner-badge">Super admin</span></header>
    <div className="super-tabs" role="tablist" aria-label="Áreas da administração">{tabs.map((item, index) => <button key={item.key} ref={element => { refs.current[index] = element; }} id={`super-tab-${item.key}`} type="button" role="tab" aria-selected={tab === item.key} aria-controls={`super-panel-${item.key}`} tabIndex={tab === item.key ? 0 : -1} onClick={() => setTab(item.key)} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
      setTab(tabs[next]!.key); refs.current[next]?.focus();
    }}>{item.label}</button>)}</div>
    <section id={`super-panel-${tab}`} role="tabpanel" aria-labelledby={`super-tab-${tab}`}>{tab === 'accounts' ? <AccountsTab /> : <RoomsTab />}</section>
  </main>;
}

function generatedPassword(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
  return 'Aa1!' + Array.from(bytes, byte => alphabet[byte & 63]).join('');
}
function PasswordField({ value, onChange, label, busy }: { value: string; onChange: (value: string) => void; label: string; busy: boolean }) {
  const [show, setShow] = useState(false);
  return <div className="super-password-block"><label>{label}<span className="super-password-input"><input type={show ? 'text' : 'password'} aria-label={label} value={value} minLength={8} maxLength={256} required autoComplete="new-password" disabled={busy} onChange={event => onChange(event.target.value)} /><button type="button" className="ghost" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={show} disabled={busy} onClick={() => setShow(current => !current)}>{show ? 'Ocultar' : 'Mostrar'}</button></span></label><button type="button" className="ghost super-generate" disabled={busy} onClick={() => onChange(generatedPassword())}>Gerar senha</button></div>;
}
function PermissionFields({ preset, permissions, onPreset, onPermission, busy }: { preset: AdminPreset; permissions: AdminPermissions; onPreset: (value: AdminPreset) => void; onPermission: (key: keyof AdminPermissions, value: boolean) => void; busy: boolean }) {
  const groups = [...new Set(PERMISSION_DEFINITIONS.map(item => item.group ?? 'Permissões'))];
  return <>
    <label className="super-preset">Modelo de acesso<select aria-label="Modelo de acesso" value={preset} disabled={busy} onChange={event => onPreset(event.target.value as AdminPreset)}><option value="organizer">Organizador</option><option value="full">Completo</option></select><small>O modelo preenche as opções. Ajuste abaixo o que esta pessoa pode fazer nas próprias salas.</small></label>
    <div className="super-permissions">{groups.map(group => <fieldset key={group}><legend>{group}</legend>{PERMISSION_DEFINITIONS.filter(item => (item.group ?? 'Permissões') === group).map(item => <label key={item.key} className="super-permission"><input type="checkbox" name={`permission-${item.key}`} checked={permissions[item.key]} disabled={busy} onChange={event => onPermission(item.key, event.target.checked)} /><span><strong>{item.label}</strong><small>{item.description}</small></span></label>)}</fieldset>)}</div>
  </>;
}
type AccountEditor = { kind: 'create' } | { kind: 'edit' | 'password'; account: AdminAccount; recoveryToken?: string };
type Credential = { email: string; password: string; pending?: boolean };

function CredentialCard({ value, onClose }: { value: Credential; onClose: () => void }) {
  const [show, setShow] = useState(false), [notice, setNotice] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section className="card super-credentials" aria-labelledby="super-credential-title"><h2 id="super-credential-title" tabIndex={-1} ref={heading}>{value.pending ? 'Guarde o acesso antes de concluir o cadastro' : 'Acesso pronto para compartilhar'}</h2><p>Este acesso aparece apenas agora. Copie e envie pelo canal privado do organizador.</p><label>E-mail<input value={value.email} readOnly /></label><label>Senha<span className="super-password-input"><input aria-label="Senha para compartilhar" type={show ? 'text' : 'password'} value={value.password} autoComplete="off" readOnly /><button type="button" className="ghost" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={show} onClick={() => setShow(current => !current)}>{show ? 'Ocultar' : 'Mostrar'}</button></span></label>{value.pending && <p className="super-help">O acesso ainda está bloqueado. Use “Concluir cadastro” na lista para liberar a conta.</p>}<div className="super-form-actions"><button type="button" className="primary" onClick={async () => setNotice(await copyText(`E-mail: ${value.email}\nSenha: ${value.password}`) ? 'Acesso copiado.' : 'Não foi possível copiar. Mostre a senha e copie manualmente.')}>Copiar acesso</button><button type="button" onClick={onClose}>Concluído</button></div>{notice && <p role="status">{notice}</p>}</section>;
}

function AccountForm({ editor, busy, error, onSubmit, onCancel }: { editor: AccountEditor; busy: boolean; error: string; onSubmit: (value: Reply, credential?: Credential) => Promise<void>; onCancel: () => void }) {
  const existing = editor.kind === 'create' ? undefined : editor.account;
  const [name, setName] = useState(existing?.displayName ?? ''), [email, setEmail] = useState(existing?.email ?? ''), [password, setPassword] = useState('');
  const [preset, setPreset] = useState<AdminPreset>(existing?.preset ?? 'organizer');
  const [permissions, setPermissions] = useState<AdminPermissions>(() => existing ? { ...existing.permissions } : presetPermissions('organizer'));
  const title = editor.kind === 'create' ? 'Adicionar administrador' : editor.kind === 'password' ? `Redefinir senha de ${existing!.displayName}` : !existing!.provisioned ? `Concluir cadastro de ${existing!.displayName}` : `Permissões de ${existing!.displayName}`;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    if (editor.kind === 'password') await onSubmit({ password, expectedVersion: existing!.version, ...(editor.recoveryToken ? { recoveryToken: editor.recoveryToken } : {}) }, { email: existing!.email, password });
    else await onSubmit({ displayName: name.trim(), ...(editor.kind === 'create' ? { email: email.trim(), password } : { expectedVersion: existing!.version }), preset, permissions }, editor.kind === 'create' ? { email: email.trim(), password } : undefined);
  }
  return <form className="card super-account-form" aria-label={title} onSubmit={event => void submit(event)}>
    <div className="super-form-heading"><h2 tabIndex={-1} ref={heading}>{title}</h2>{existing && <p>{existing.email}</p>}</div>
    {editor.kind === 'password' ? <><p className="super-help">A senha anterior não pode ser consultada. Ao redefinir, as sessões desse administrador serão encerradas.</p><PasswordField label="Nova senha" value={password} onChange={setPassword} busy={busy} /></> : <>
      <div className="super-account-fields"><label>Nome do administrador<input name="accountName" value={name} maxLength={80} required disabled={busy} autoComplete="off" onChange={event => setName(event.target.value)} /></label>{editor.kind === 'create' && <label>E-mail de acesso<input name="accountEmail" type="email" value={email} maxLength={254} required autoCapitalize="none" spellCheck={false} autoComplete="off" disabled={busy} onChange={event => setEmail(event.target.value)} /></label>}</div>
      {editor.kind === 'create' && <><p className="super-help">Pode ser um e-mail fictício com formato válido. A conta entra diretamente com a senha, sem convite por e-mail.</p><PasswordField label="Senha inicial" value={password} onChange={setPassword} busy={busy} /></>}
      <PermissionFields preset={preset} permissions={permissions} onPreset={value => { setPreset(value); setPermissions(presetPermissions(value)); }} onPermission={(key, value) => setPermissions(current => ({ ...current, [key]: value }))} busy={busy} />
      <p className="super-help">Cada administrador gerencia somente as próprias salas. Gerenciar outras contas é exclusivo do super admin.</p>
    </>}
    {error && <p role="alert" className="super-error">{error}</p>}
    <div className="super-form-actions"><button className="primary" type="submit" disabled={busy}>{busy ? 'Salvando…' : editor.kind === 'create' ? 'Criar administrador' : editor.kind === 'password' ? 'Definir nova senha' : !existing!.provisioned ? 'Concluir cadastro' : 'Salvar permissões'}</button><button type="button" disabled={busy} onClick={onCancel}>Cancelar</button></div>
  </form>;
}

function AccountsTab() {
  const [page, setPage] = useState<AdminAccountsPage | null>(null), [offset, setOffset] = useState(0), [reload, setReload] = useState(0);
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('all');
  const [loadError, setLoadError] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<AccountEditor | null>(null), [credentials, setCredentials] = useState<Credential | null>(null), [confirming, setConfirming] = useState<AdminAccount | null>(null);
  const [busy, setBusy] = useState(false); const locked = useRef(false);
  useEffect(() => {
    const ctrl = new AbortController(); setPage(null); setLoadError('');
    const params = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE), status, q: query });
    request(`/api/admin/accounts?${params}`, { signal: ctrl.signal }).then(body => {
      const next = accountsPage(body); if (next.nextOffset !== null && next.nextOffset <= offset) throw new Error('A paginação dos administradores não avançou.');
      if (!ctrl.signal.aborted) setPage(next);
    }).catch(err => { if (!ctrl.signal.aborted) setLoadError(message(err)); });
    return () => ctrl.abort();
  }, [offset, query, status, reload]);
  const revalidate = () => setReload(current => current + 1);
  function begin(next: AccountEditor) { setEditor(next); setError(''); setNotice(''); setConfirming(null); }
  async function save(value: Reply, credential?: Credential) {
    if (locked.current || !editor) return;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const url = editor.kind === 'create' ? '/api/admin/accounts' : `/api/admin/accounts/${encodeURIComponent(editor.account.id)}${editor.kind === 'password' ? '/password' : ''}`;
      const body = await request(url, mutation(editor.kind === 'edit' ? 'PATCH' : 'POST', value)); account(body.account);
      setEditor(null); setCredentials(credential ?? null); setNotice(credential ? '' : 'Permissões salvas. Novas ações já usam esse acesso.'); revalidate();
    } catch (err) {
      if (editor.kind === 'password' && err instanceof ManagementError && err.samePasswordRequired) {
        // Preserve the typed/generated secret in this form for a same-value
        // retry. Changing the version prop must not remount PasswordField.
        setEditor({ kind: 'password', account: err.updatedAccount ?? editor.account, recoveryToken: err.recoveryToken });
        revalidate(); setError(message(err)); return;
      }
      if (editor.kind === 'password') { setEditor(null); revalidate(); }
      if (err instanceof ManagementError && err.pending) { setEditor(null); if (credential) setCredentials({ ...credential, pending: true }); revalidate(); }
      if (conflict(err)) { setEditor(null); setPage(null); revalidate(); setError('Esta conta mudou em outro navegador. A lista foi atualizada; abra as permissões novamente antes de salvar.'); }
      else setError(message(err));
    } finally { locked.current = false; setBusy(false); }
  }
  async function changeStatus() {
    if (locked.current || !confirming) return;
    const target = confirming; locked.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const body = await request(`/api/admin/accounts/${encodeURIComponent(target.id)}/status`, mutation('POST', { active: !target.active, expectedVersion: target.version })); account(body.account);
      setConfirming(null); setNotice(target.active ? 'Administrador suspenso. As salas e a publicação foram mantidas.' : 'Administrador reativado com as permissões anteriores.'); revalidate();
    } catch (err) { if (conflict(err)) { setConfirming(null); setPage(null); revalidate(); } setError(conflict(err) ? 'Esta conta mudou em outro navegador. Confira a lista atualizada antes de tentar novamente.' : message(err)); }
    finally { locked.current = false; setBusy(false); }
  }
  const editing = !!editor || !!credentials || !!confirming;
  return <div className="super-workspace">
    <div className="super-section-heading"><div><h2>Administradores</h2><p>Crie acessos, ajuste permissões e suspenda contas sem apagar suas salas.</p></div><button type="button" className="primary" disabled={busy || editing} onClick={() => begin({ kind: 'create' })}>Adicionar administrador</button></div>
    {error && !editor && <p role="alert" className="super-error">{error}</p>}{notice && <p role="status" className="super-notice">{notice}</p>}
    {credentials && <CredentialCard value={credentials} onClose={() => setCredentials(null)} />}
    {editor && <AccountForm key={editor.kind === 'create' ? 'create' : editor.kind === 'password' ? `password-${editor.account.id}` : `${editor.kind}-${editor.account.id}-${editor.account.version}`} editor={editor} busy={busy} error={error} onSubmit={save} onCancel={() => { setEditor(null); setError(''); }} />}
    {confirming && <section className="super-confirmation" aria-labelledby="super-status-title"><h3 id="super-status-title">{confirming.active ? 'Suspender' : 'Reativar'} {confirming.displayName}?</h3><p>{confirming.active ? 'O acesso será suspenso. As salas, o histórico e a publicação serão mantidos.' : 'A conta voltará a gerenciar suas salas com as permissões anteriores.'}</p><div className="super-form-actions"><button type="button" className={confirming.active ? 'super-danger' : 'primary'} disabled={busy} onClick={() => void changeStatus()}>{busy ? 'Salvando…' : confirming.active ? 'Confirmar suspensão' : 'Confirmar reativação'}</button><button type="button" disabled={busy} onClick={() => setConfirming(null)}>Cancelar</button></div></section>}
    <section className="card super-list-card">
      <form className="super-list-filters" aria-label="Buscar administradores" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setOffset(0); }}><label>Buscar administrador<input value={search} placeholder="Nome ou e-mail" maxLength={80} disabled={busy || editing} onChange={event => setSearch(event.target.value)} /></label><label>Status<select value={status} disabled={busy || editing} onChange={event => { setStatus(event.target.value); setOffset(0); }}><option value="all">Todas as contas</option><option value="active">Ativas</option><option value="suspended">Suspensas</option><option value="pending">Cadastros pendentes</option></select></label><button type="submit" disabled={busy || editing}>Buscar</button></form>
      {loadError ? <div role="alert" className="super-load-error"><p>{loadError}</p><button type="button" disabled={busy} onClick={revalidate}>Tentar novamente</button></div> : !page ? <p role="status" className="muted">Carregando administradores…</p> : !page.accounts.length ? <p className="muted">Nenhum administrador encontrado com esses filtros.</p> : <ul className="super-account-list">{page.accounts.map(item => <li key={item.id}><div className="super-person"><strong>{item.displayName}</strong><span>{item.email}</span><div className="super-person-tags"><span className={`super-status ${!item.provisioned ? 'is-pending' : item.active ? 'is-active' : 'is-suspended'}`}>{item.isSuperAdmin ? 'Super admin' : !item.provisioned ? 'Cadastro pendente' : item.active ? 'Ativo' : 'Suspenso'}</span>{item.passwordResetPending && <span className="super-status is-pending">Redefinição pendente</span>}{!item.isSuperAdmin && <span>{item.preset === 'organizer' ? 'Organizador' : 'Completo'}{PERMISSION_KEYS.some(key => item.permissions[key] !== presetPermissions(item.preset)[key]) ? ' · ajustado' : ''}</span>}</div></div><div className="super-row-actions">{item.isSuperAdmin ? <small>Sua conta é protegida.</small> : !item.provisioned ? <button type="button" disabled={busy || editing} onClick={() => begin({ kind: 'edit', account: item })}>Concluir cadastro</button> : <><button type="button" disabled={busy || editing} onClick={() => begin({ kind: 'edit', account: item })}>Editar permissões</button><button type="button" className="ghost" disabled={busy || editing} onClick={() => begin({ kind: 'password', account: item })}>Redefinir senha</button><button type="button" className={item.active ? 'ghost super-danger-text' : 'ghost'} disabled={busy || editing} onClick={() => { setConfirming(item); setError(''); setNotice(''); }}>{item.active ? 'Suspender' : 'Reativar'}</button></>}</div></li>)}</ul>}
      {page && <div className="super-pagination"><span>{page.total} {page.total === 1 ? 'conta' : 'contas'}{page.accounts.length ? ` · ${offset + 1}–${offset + page.accounts.length}` : ''}</span><div><button type="button" disabled={busy || editing || offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Anteriores</button><button type="button" disabled={busy || editing || page.nextOffset === null} onClick={() => page.nextOffset !== null && setOffset(page.nextOffset)}>Próximos</button></div></div>}
    </section>
  </div>;
}

type ManagedRoom = ScrimSummary & { ownerId?: string; access: RoomAccess };
function roomAccess(value: unknown): value is RoomAccess {
  if (!value || typeof value !== 'object') return false;
  const access = value as RoomAccess;
  return typeof access.isPublic === 'boolean' && Number.isInteger(access.accessVersion) && access.accessVersion > 0 && (access.deletedAt === null || Number.isFinite(access.deletedAt));
}
function roomList(value: unknown): ManagedRoom[] {
  if (!Array.isArray(value) || value.some(item => !item || typeof item.id !== 'string' || typeof item.title !== 'string' || !roomAccess(item.access))) throw new Error('Não foi possível conferir as salas.');
  return value as ManagedRoom[];
}
function Eye({ shown }: { shown: boolean }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{!shown && <path d="m3 3 18 18" />}</svg>;
}
function RoomsTab() {
  const [rooms, setRooms] = useState<ManagedRoom[] | null>(null), [owners, setOwners] = useState<AdminAccount[] | null>(null);
  const [deleted, setDeleted] = useState(false), [query, setQuery] = useState(''), [reload, setReload] = useState(0);
  const [loadError, setLoadError] = useState(''), [ownerError, setOwnerError] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [transfer, setTransfer] = useState<ManagedRoom | null>(null), [target, setTarget] = useState(''), [confirming, setConfirming] = useState<ManagedRoom | null>(null), [busy, setBusy] = useState(false);
  const locked = useRef(false);
  useEffect(() => {
    const ctrl = new AbortController(); setRooms(null); setLoadError('');
    request(`/api/scrims?scope=admin${deleted ? '&deleted=true' : ''}`, { signal: ctrl.signal }).then(body => { const list = roomList(body); if (!ctrl.signal.aborted) setRooms(list); }).catch(err => { if (!ctrl.signal.aborted) setLoadError(message(err)); });
    return () => ctrl.abort();
  }, [deleted, reload]);
  useEffect(() => {
    const ctrl = new AbortController(); setOwners(null); setOwnerError('');
    void (async () => {
      try {
        const collected: AdminAccount[] = []; let offset = 0;
        while (!ctrl.signal.aborted) {
          const page = accountsPage(await request(`/api/admin/accounts?offset=${offset}&limit=100&status=all`, { signal: ctrl.signal }));
          collected.push(...page.accounts);
          if (page.nextOffset === null) break;
          if (page.nextOffset <= offset) throw new Error('A lista de responsáveis não avançou.');
          offset = page.nextOffset;
        }
        if (!ctrl.signal.aborted) setOwners(collected);
      } catch (err) { if (!ctrl.signal.aborted) setOwnerError(message(err)); }
    })();
    return () => ctrl.abort();
  }, [reload]);
  async function change(room: ManagedRoom, action: 'show' | 'hide' | 'delete' | 'restore' | 'transfer') {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const body = await request(`/api/scrims/${encodeURIComponent(room.id)}/${action === 'transfer' ? 'owner' : 'access'}`, mutation('POST', action === 'transfer' ? { ownerId: target, expectedAccessVersion: room.access.accessVersion } : { action, expectedAccessVersion: room.access.accessVersion }));
      if (!roomAccess(body.access)) throw new Error('A sala respondeu sem o estado atualizado. Confira a lista antes de tentar novamente.');
      setTransfer(null); setConfirming(null);
      setNotice(action === 'transfer' ? 'Sala transferida. A publicação e o histórico foram mantidos.' : action === 'delete' ? 'Sala excluída da lista. O histórico foi guardado.' : action === 'restore' ? 'Sala restaurada como oculta.' : action === 'show' ? 'Sala publicada para os espectadores.' : 'Sala oculta para os espectadores.');
      setReload(current => current + 1);
    } catch (err) {
      if (conflict(err)) { setTransfer(null); setConfirming(null); setRooms(null); setReload(current => current + 1); }
      setError(conflict(err) ? 'A sala mudou em outro navegador. Confira a lista atualizada antes de tentar novamente.' : message(err));
    } finally { locked.current = false; setBusy(false); }
  }
  const shown = rooms?.filter(room => `${room.title} ${owners?.find(owner => owner.id === room.ownerId)?.displayName ?? ''} ${owners?.find(owner => owner.id === room.ownerId)?.email ?? ''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  const editing = !!transfer || !!confirming;
  return <div className="super-workspace"><div className="super-section-heading"><div><h2>Todas as salas</h2><p>Você pode administrar, publicar, transferir e restaurar salas de qualquer organizador.</p></div><a href="/admin" className="button" onClick={internal}>Criar uma sala</a></div>
    {error && <p role="alert" className="super-error">{error}</p>}{notice && <p role="status" className="super-notice">{notice}</p>}
    <section className="card super-list-card"><div className="super-room-controls"><div role="group" aria-label="Filtrar todas as salas"><button type="button" aria-pressed={!deleted} disabled={busy || editing} onClick={() => { setDeleted(false); setError(''); setNotice(''); }}>Ativas</button><button type="button" aria-pressed={deleted} disabled={busy || editing} onClick={() => { setDeleted(true); setError(''); setNotice(''); }}>Excluídas</button></div><label>Buscar sala ou responsável<input value={query} maxLength={100} placeholder="Nome da sala ou do administrador" disabled={busy} onChange={event => setQuery(event.target.value)} /></label></div>
      {ownerError && <div role="alert" className="super-load-error"><p>Não foi possível carregar os responsáveis. {ownerError}</p><button type="button" disabled={busy} onClick={() => setReload(current => current + 1)}>Recarregar responsáveis</button></div>}
      {loadError ? <div role="alert" className="super-load-error"><p>{loadError}</p><button type="button" disabled={busy} onClick={() => setReload(current => current + 1)}>Tentar novamente</button></div> : !shown ? <p role="status" className="muted">Carregando salas…</p> : !shown.length ? <p className="muted">{deleted ? 'Nenhuma sala excluída com esse filtro.' : 'Nenhuma sala encontrada com esse filtro.'}</p> : <ul className="super-room-list">{shown.map(room => {
        const owner = owners?.find(item => item.id === room.ownerId);
        return <li key={room.id}><div className="super-room-row"><div className="super-room-info"><strong>{room.title}</strong><span>{room.teams[0]} vs {room.teams[1]}</span><span className="super-room-owner">Responsável: {owner ? `${owner.displayName}${!owner.active ? ' (suspenso)' : ''}` : owners ? 'Indisponível' : 'Carregando…'}</span><small>{fmtDateTime(room.createdAt)}</small><span className={`super-status ${room.access.deletedAt !== null ? 'is-suspended' : room.access.isPublic ? 'is-active' : ''}`}>{room.access.deletedAt !== null ? 'Excluída' : room.access.isPublic ? 'Pública' : 'Oculta'}</span></div><div className="super-row-actions">{room.access.deletedAt !== null ? <button type="button" disabled={busy || editing} onClick={() => void change(room, 'restore')}>Restaurar</button> : <><a className={`button${busy || editing ? ' super-link-disabled' : ''}`} href={`/s/${room.id}`} onClick={event => { if (busy || editing) event.preventDefault(); else internal(event); }} aria-disabled={busy || editing}>Editar</a><button type="button" disabled={busy || editing || !owners || !!ownerError} onClick={() => { setTransfer(room); setTarget(''); setError(''); setNotice(''); }}>Transferir sala</button><button type="button" className="super-eye" aria-label={room.access.isPublic ? 'Ocultar sala dos espectadores' : 'Mostrar sala para espectadores'} aria-pressed={room.access.isPublic} disabled={busy || editing} onClick={() => void change(room, room.access.isPublic ? 'hide' : 'show')}><Eye shown={room.access.isPublic} /></button><button type="button" className="ghost super-danger-text" disabled={busy || editing} onClick={() => { setConfirming(room); setError(''); }}>Excluir sala</button></>}</div></div>
          {transfer?.id === room.id && <form className="super-transfer" aria-label={`Transferir ${room.title}`} onSubmit={event => { event.preventDefault(); if (target) void change(room, 'transfer'); }}><h3>Transferir {room.title}</h3><p>O novo responsável poderá gerenciar a sala conforme suas permissões. Publicação e histórico serão mantidos.</p><label>Novo administrador<select value={target} required disabled={busy || !owners} onChange={event => setTarget(event.target.value)}><option value="">Escolha um administrador</option>{owners?.filter(item => item.active && item.provisioned && item.id !== room.ownerId).map(item => <option key={item.id} value={item.id}>{item.displayName} — {item.email}</option>)}</select></label><div className="super-form-actions"><button type="submit" className="primary" disabled={busy || !target}>{busy ? 'Transferindo…' : 'Confirmar transferência'}</button><button type="button" disabled={busy} onClick={() => setTransfer(null)}>Cancelar</button></div></form>}
          {confirming?.id === room.id && <div className="super-confirmation" role="group" aria-label={`Excluir ${room.title}`}><h3>Excluir “{room.title}”?</h3><p>A sala sai das listas. O histórico fica guardado e pode ser restaurado.</p><div className="super-form-actions"><button type="button" className="super-danger" disabled={busy} onClick={() => void change(room, 'delete')}>{busy ? 'Excluindo…' : 'Confirmar exclusão'}</button><button type="button" disabled={busy} onClick={() => setConfirming(null)}>Cancelar</button></div></div>}
        </li>;
      })}</ul>}
    </section>
  </div>;
}
