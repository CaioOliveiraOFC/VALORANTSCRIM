import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { presetPermissions, type AdminAccount } from '../../shared/adminPermissions';
const mocks = vi.hoisted(() => ({ auth: {} as any, navigate: vi.fn() }));
vi.mock('../hooks/useAdminAuth', () => ({ ADMIN_AUTH_CHANGE: 'scrim-auth-change', useAdminAuth: () => mocks.auth }));
vi.mock('../router', () => ({ navigate: mocks.navigate }));
import { SuperAdminPanel } from './SuperAdminPanel';

const OWNER_ID = '11111111-1111-4111-8111-111111111111', ADMIN_ID = '22222222-2222-4222-8222-222222222222', OTHER_ID = '33333333-3333-4333-8333-333333333333';
const owner: AdminAccount = { id: OWNER_ID, email: 'owner@example.test', displayName: 'Caio', active: true, preset: 'full', permissions: presetPermissions('full'), version: 1, isSuperAdmin: true, provisioned: true, createdAt: 1, updatedAt: 1 };
const organizer: AdminAccount = { id: ADMIN_ID, email: 'admin1@example.test', displayName: 'Organizador 1', active: true, preset: 'organizer', permissions: presetPermissions('organizer'), version: 1, isSuperAdmin: false, provisioned: true, createdAt: 2, updatedAt: 2 };
let renderer: ReactTestRenderer | undefined;
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join('');
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const page = (accounts: AdminAccount[] = [owner, organizer], nextOffset: number | null = null, total = accounts.length) => ({ accounts, total, nextOffset });
const root = () => renderer!.root;
const button = (label: string, scope = root()) => scope.findAllByType('button').find(node => node.props['aria-label'] === label || text(node) === label)!;
const named = (name: string) => root().findByProps({ name });
const row = (name: string) => root().findAllByType('li').find(node => node.findAllByType('strong').some(child => text(child) === name))!;
const form = () => root().findAllByType('form').find(node => node.props.className === 'card super-account-form')!;
async function flush() { await act(async () => { for (let i = 0; i < 14; i++) await Promise.resolve(); }); }
async function mount() { await act(async () => { renderer = create(createElement(SuperAdminPanel)); }); await flush(); }
function input(label: string) { return root().findAllByType('input').find(node => node.props['aria-label'] === label)!; }
function fillCreate() {
  act(() => named('accountName').props.onChange({ target: { value: 'Amigo' } }));
  act(() => named('accountEmail').props.onChange({ target: { value: 'amigo@valorantscrim.test' } }));
  act(() => input('Senha inicial').props.onChange({ target: { value: 'private-password' } }));
}
beforeEach(() => {
  mocks.auth = { status: 'admin', isSuperAdmin: true, email: owner.email, refresh: vi.fn() }; mocks.navigate.mockReset();
  vi.stubGlobal('dispatchEvent', vi.fn());
  vi.stubGlobal('localStorage', { setItem: vi.fn(), getItem: vi.fn() });
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  vi.stubGlobal('fetch', vi.fn(async () => response(page())));
});
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it('does not request management data for an ordinary admin even with the owner email', async () => {
  mocks.auth.isSuperAdmin = false; mocks.auth.email = 'caio.oliveira2014@hotmail.com';
  await mount(); expect(text(root())).toContain('Acesso restrito ao super admin');
  expect(fetch).not.toHaveBeenCalled(); expect(button('Adicionar administrador')).toBeUndefined();
});

it('returns anonymous visitors to the login with a supported management destination', async () => {
  mocks.auth.status = 'viewer'; mocks.auth.isSuperAdmin = false;
  await mount(); expect(mocks.navigate).toHaveBeenCalledWith('/admin?returnTo=%2Fadmin%2Fmanagement'); expect(fetch).not.toHaveBeenCalled();
});

it('creates an organizer with explicit permission overrides and shares the form password only once', async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => response(init?.method === 'POST' ? { account: { ...organizer, displayName: 'Amigo' } } : page()));
  vi.stubGlobal('fetch', fetcher); await mount();
  act(() => button('Adicionar administrador').props.onClick()); fillCreate();
  expect(named('permission-correctStats').props.checked).toBe(false); expect(named('permission-deleteRooms').props.checked).toBe(false);
  act(() => named('permission-correctStats').props.onChange({ target: { checked: true } }));
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  await act(async () => { await form().props.onSubmit({ preventDefault() {} }); }); await flush();
  const write = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(write[0]).toBe('/api/admin/accounts');
  expect(JSON.parse(write[1]!.body as string)).toMatchObject({ displayName: 'Amigo', email: 'amigo@valorantscrim.test', password: 'private-password', preset: 'organizer', permissions: { correctStats: true, deleteRooms: false } });
  expect(input('Senha para compartilhar').props.value).toBe('private-password'); expect(localStorage.setItem).not.toHaveBeenCalled();
  await act(async () => { await button('Copiar acesso').props.onClick(); });
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('E-mail: amigo@valorantscrim.test\nSenha: private-password');
  act(() => button('Concluído').props.onClick());
  expect(root().findAllByType('input').some(node => node.props.value === 'private-password')).toBe(false);
});

it('protects the owner row and saves adjusted presets with the displayed account version', async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => response(init?.method === 'PATCH' ? { account: { ...organizer, version: 2 } } : page()));
  vi.stubGlobal('fetch', fetcher); await mount();
  expect(row('Caio').findAllByType('button')).toHaveLength(0);
  act(() => button('Editar permissões', row('Organizador 1')).props.onClick());
  act(() => root().findByProps({ 'aria-label': 'Modelo de acesso' }).props.onChange({ target: { value: 'full' } }));
  expect(named('permission-deleteRooms').props.checked).toBe(true);
  act(() => named('permission-publishRooms').props.onChange({ target: { checked: false } }));
  await act(async () => { await form().props.onSubmit({ preventDefault() {} }); }); await flush();
  const write = fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
  expect(write[0]).toBe('/api/admin/accounts/' + ADMIN_ID);
  expect(JSON.parse(write[1]!.body as string)).toMatchObject({ expectedVersion: 1, preset: 'full', permissions: { deleteRooms: true, publishRooms: false } });
});

it('drops a stale permissions form on conflict and fetches the current version', async () => {
  let updated = false;
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') { updated = true; return response({ error: 'Version conflict' }, 409); }
    return response(page([owner, { ...organizer, version: updated ? 5 : 1 }]));
  });
  vi.stubGlobal('fetch', fetcher); await mount();
  act(() => button('Editar permissões', row('Organizador 1')).props.onClick());
  await act(async () => { await form().props.onSubmit({ preventDefault() {} }); }); await flush();
  expect(form()).toBeUndefined(); expect(text(root())).toContain('Esta conta mudou em outro navegador');
  act(() => button('Editar permissões', row('Organizador 1')).props.onClick());
  await act(async () => { await form().props.onSubmit({ preventDefault() {} }); }); await flush();
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH');
  expect(writes.map(([, init]) => JSON.parse(init!.body as string).expectedVersion)).toEqual([1, 5]);
});

it('confirms suspension and reactivation without changing room publication or account capabilities', async () => {
  let current = organizer;
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { const body = JSON.parse(init.body as string); current = { ...current, active: body.active, version: current.version + 1 }; return response({ account: current }); }
    return response(page([owner, current]));
  });
  vi.stubGlobal('fetch', fetcher); await mount();
  act(() => button('Suspender', row('Organizador 1')).props.onClick());
  expect(text(root())).toContain('As salas, o histórico e a publicação serão mantidos');
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  await act(async () => { await button('Confirmar suspensão').props.onClick(); }); await flush();
  expect(current.active).toBe(false); expect(current.permissions).toEqual(presetPermissions('organizer'));
  act(() => button('Reativar', row('Organizador 1')).props.onClick());
  await act(async () => { await button('Confirmar reativação').props.onClick(); }); await flush();
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(writes.map(([url, init]) => ({ url, body: JSON.parse(init!.body as string) }))).toEqual([
    { url: `/api/admin/accounts/${ADMIN_ID}/status`, body: { active: false, expectedVersion: 1 } },
    { url: `/api/admin/accounts/${ADMIN_ID}/status`, body: { active: true, expectedVersion: 2 } },
  ]);
});

it('resets a password once and never attempts to recover the old password', async () => {
  let release!: (response: Response) => void;
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? new Promise<Response>(resolve => { release = resolve; }) : response(page()));
  vi.stubGlobal('fetch', fetcher); await mount();
  act(() => button('Redefinir senha', row('Organizador 1')).props.onClick());
  act(() => input('Nova senha').props.onChange({ target: { value: 'another-password' } }));
  const submit = form().props.onSubmit;
  act(() => { void submit({ preventDefault() {} }); void submit({ preventDefault() {} }); }); await flush();
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  await act(async () => { release(response({ account: { ...organizer, version: 2 } })); }); await flush();
  expect(input('Senha para compartilhar').props.value).toBe('another-password');
  const write = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(write[0]).toBe(`/api/admin/accounts/${ADMIN_ID}/password`); expect(JSON.parse(write[1]!.body as string)).toEqual({ password: 'another-password', expectedVersion: 1 });
  expect(localStorage.setItem).not.toHaveBeenCalled();
});

it('preserves the generated or typed password and the new version when an uncertain reset must be resumed', async () => {
  let version = 1;
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      version = 2;
      return response({ error: 'Conclua com esta mesma senha.', samePasswordRequired: true, account: { ...organizer, version, passwordResetPending: true } }, 503);
    }
    return response(page([owner, { ...organizer, version }]));
  });
  vi.stubGlobal('fetch', fetcher); await mount();
  act(() => button('Redefinir senha', row('Organizador 1')).props.onClick());
  act(() => input('Nova senha').props.onChange({ target: { value: 'retained-retry-password' } }));
  await act(async () => { await form().props.onSubmit({ preventDefault() {} }); }); await flush();
  expect(input('Nova senha').props.value).toBe('retained-retry-password');
  expect(text(root())).toContain('Conclua com esta mesma senha.');
  await act(async () => { await form().props.onSubmit({ preventDefault() {} }); }); await flush();
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(writes.map(([, init]) => JSON.parse(init!.body as string))).toEqual([
    { password: 'retained-retry-password', expectedVersion: 1 },
    { password: 'retained-retry-password', expectedVersion: 2 },
  ]);
  expect(localStorage.setItem).not.toHaveBeenCalled();
});

it('retains an opaque finalization receipt only in the pending form and sends it on the explicit retry', async () => {
  let writes = 0;
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      writes++;
      return writes === 1 ? response({ error: 'Conclua com a mesma senha.', samePasswordRequired: true, recoveryToken: 'opaque-recovery-proof', account: { ...organizer, version: 2, passwordResetPending: true } }, 503) : response({ account: { ...organizer, version: 2, passwordResetPending: false } });
    }
    return response(page());
  });
  vi.stubGlobal('fetch', fetcher); await mount();
  act(() => button('Redefinir senha', row('Organizador 1')).props.onClick());
  act(() => input('Nova senha').props.onChange({ target: { value: 'retry-same-password' } }));
  await act(async () => { await form().props.onSubmit({ preventDefault() {} }); }); await flush();
  expect(input('Nova senha').props.value).toBe('retry-same-password');
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  await act(async () => { await form().props.onSubmit({ preventDefault() {} }); }); await flush();
  const submitted = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(JSON.parse(submitted[1]![1]!.body as string)).toEqual({ password: 'retry-same-password', expectedVersion: 2, recoveryToken: 'opaque-recovery-proof' });
  expect(localStorage.setItem).not.toHaveBeenCalled();
  expect(input('Senha para compartilhar').props.value).toBe('retry-same-password');
});

it('refreshes the version after a password provider failure and requires an explicit new attempt', async () => {
  let attempted = false;
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { attempted = true; return response({ error: 'Sessões encerradas, mas a senha não foi alterada.', account: { ...organizer, version: 2 } }, 503); }
    return response(page([owner, { ...organizer, version: attempted ? 2 : 1 }]));
  });
  vi.stubGlobal('fetch', fetcher); await mount(); act(() => button('Redefinir senha', row('Organizador 1')).props.onClick());
  act(() => input('Nova senha').props.onChange({ target: { value: 'new-password' } }));
  await act(async () => { await form().props.onSubmit({ preventDefault() {} }); }); await flush();
  expect(form()).toBeUndefined(); expect(input('Senha para compartilhar')).toBeUndefined();
  expect(text(root())).toContain('a senha não foi alterada'); expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  act(() => button('Redefinir senha', row('Organizador 1')).props.onClick());
  act(() => input('Nova senha').props.onChange({ target: { value: 'explicit-retry' } }));
  await act(async () => { await form().props.onSubmit({ preventDefault() {} }); }); await flush();
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(JSON.parse(writes[1]![1]!.body as string).expectedVersion).toBe(2);
});

it('recovers an Auth account pending policy registration without creating it again', async () => {
  let pending = false;
  const draft: AdminAccount = { ...organizer, displayName: 'Amigo', email: 'amigo@valorantscrim.test', active: false, provisioned: false, version: 0 };
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { pending = true; return response({ error: 'Conclua o cadastro na lista.', pending: true, accountId: ADMIN_ID }, 503); }
    if (init?.method === 'PATCH') return response({ account: { ...draft, active: true, provisioned: true, version: 1 } });
    return response(page(pending ? [owner, draft] : [owner]));
  });
  vi.stubGlobal('fetch', fetcher); await mount(); act(() => button('Adicionar administrador').props.onClick()); fillCreate();
  await act(async () => { await form().props.onSubmit({ preventDefault() {} }); }); await flush();
  expect(text(root())).toContain('Guarde o acesso antes de concluir o cadastro');
  act(() => button('Concluído').props.onClick()); act(() => button('Concluir cadastro', row('Amigo')).props.onClick());
  await act(async () => { await form().props.onSubmit({ preventDefault() {} }); }); await flush();
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  const patch = fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
  expect(JSON.parse(patch[1]!.body as string)).toMatchObject({ expectedVersion: 0, displayName: 'Amigo', preset: 'organizer' });
});

it('pages through administrators rather than hiding accounts after the first page', async () => {
  const last = { ...organizer, id: OTHER_ID, displayName: 'Último administrador' };
  const fetcher = vi.fn(async (url: string) => response(url.includes('offset=25') ? page([last], null, 26) : page([owner, organizer], 25, 26)));
  vi.stubGlobal('fetch', fetcher); await mount(); act(() => button('Próximos').props.onClick()); await flush();
  expect(text(root())).toContain('Último administrador'); expect(button('Próximos').props.disabled).toBe(true);
  expect(fetcher.mock.calls.some(([url]) => url.includes('offset=25'))).toBe(true);
  act(() => button('Anteriores').props.onClick()); await flush(); expect(text(root())).toContain('Organizador 1');
});

it('loads every owner page and transfers a room only after confirmation with the metadata version', async () => {
  const target = { ...organizer, id: OTHER_ID, displayName: 'Outro organizador' };
  const suspended = { ...organizer, id: '44444444-4444-4444-8444-444444444444', displayName: 'Suspenso', active: false };
  let transferred = false;
  const room = () => ({ id: 'abc123', title: 'Scrim de teste', ownerId: transferred ? OTHER_ID : OWNER_ID, teams: ['Time A', 'Time B'], score: [0, 0], maps: [], phase: 'setup', createdAt: 1, updatedAt: 1, access: { isPublic: true, deletedAt: null, accessVersion: transferred ? 2 : 1 } });
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { transferred = true; return response({ access: room().access, ownerId: OTHER_ID }); }
    if (url.startsWith('/api/scrims')) return response([room()]);
    if (url.includes('offset=100')) return response(page([target], null, 101));
    return response(url.includes('limit=100') ? page([owner, suspended], 100, 101) : page());
  });
  vi.stubGlobal('fetch', fetcher); await mount(); act(() => button('Todas as salas').props.onClick()); await flush();
  expect(fetcher.mock.calls.some(([url]) => url.includes('offset=100'))).toBe(true);
  act(() => button('Transferir sala').props.onClick());
  const select = root().findAllByType('select').find(node => node.findAllByType('option').some(option => text(option).includes('Outro organizador')))!;
  expect(select.findAllByType('option').some(node => text(node).includes('Suspenso'))).toBe(false);
  act(() => select.props.onChange({ target: { value: OTHER_ID } }));
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  await act(async () => { await root().findByProps({ 'aria-label': 'Transferir Scrim de teste' }).props.onSubmit({ preventDefault() {} }); }); await flush();
  const write = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(write[0]).toBe('/api/scrims/abc123/owner'); expect(JSON.parse(write[1]!.body as string)).toEqual({ ownerId: OTHER_ID, expectedAccessVersion: 1 });
  expect(text(root())).toContain('Responsável: Outro organizador'); expect(text(root())).toContain('A publicação e o histórico foram mantidos');
});

it('clears private management content when the super admin capability is lost', async () => {
  await mount(); expect(text(root())).toContain('Organizador 1');
  mocks.auth = { ...mocks.auth, isSuperAdmin: false };
  act(() => renderer!.update(createElement(SuperAdminPanel))); await flush();
  expect(text(root())).not.toContain('Organizador 1'); expect(text(root())).toContain('Acesso restrito ao super admin');
});
