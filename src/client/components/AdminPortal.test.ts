import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: {} as any, navigate: vi.fn() }));
vi.mock('../hooks/useAdminAuth', () => ({ useAdminAuth: () => mocks.auth, ADMIN_AUTH_CHANGE: 'scrim-auth-change' }));
vi.mock('../router', async () => ({ ...await vi.importActual('../router'), navigate: mocks.navigate }));
import { AdminPortal } from './AdminPortal';
import { Home } from './Home';
let renderer: ReactTestRenderer | undefined;
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join('');
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
async function flush() { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); }
beforeEach(() => {
  mocks.navigate.mockReset(); mocks.auth = { status: 'viewer', canDeleteRooms: false, login: vi.fn().mockResolvedValue(undefined), logout: vi.fn(), refresh: vi.fn() };
  vi.stubGlobal('location', { search: '' }); vi.stubGlobal('dispatchEvent', vi.fn());
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply([])));
});
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it('keeps public home read-only and directs organizers to login', async () => {
  await act(async () => { renderer = create(createElement(Home)); }); await flush();
  expect(renderer!.root.findAllByType('form')).toHaveLength(0);
  expect(text(renderer!.root)).toContain('Acompanhar uma scrim');
  expect(renderer!.root.findAllByType('a').some(node => node.props.href === '/admin' && text(node) === 'Entrar como admin')).toBe(true);
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init || init.method === undefined)).toBe(true);
});

it('logs in and returns to the room while showing login failures in the form', async () => {
  location.search = '?returnTo=%2Fs%2Fabc123';
  act(() => { renderer = create(createElement(AdminPortal)); });
  const inputs = renderer!.root.findAllByType('input');
  act(() => inputs.find(node => node.props.name === 'email')!.props.onChange({ target: { value: 'admin@example.test' } }));
  act(() => inputs.find(node => node.props.name === 'password')!.props.onChange({ target: { value: 'private-password' } }));
  expect(renderer!.root.findByProps({ name: 'password' }).props['aria-label']).toBe('Senha');
  mocks.auth.login.mockRejectedValueOnce(new Error('Confira o e-mail e a senha.'));
  await act(async () => { await renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  expect(text(renderer!.root.findByProps({ role: 'alert' }))).toContain('Confira o e-mail'); expect(mocks.navigate).not.toHaveBeenCalled();
  await act(async () => { await renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  expect(mocks.auth.login).toHaveBeenCalledWith('admin@example.test', 'private-password'); expect(mocks.navigate).toHaveBeenCalledWith('/s/abc123');
});

it('creates an authenticated room and opens its public path without an admin key', async () => {
  mocks.auth.status = 'admin';
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => reply(init?.method === 'POST' ? { id: 'new123' } : []));
  vi.stubGlobal('fetch', fetcher);
  await act(async () => { renderer = create(createElement(AdminPortal)); }); await flush();
  const name = renderer!.root.findAllByType('input').find(node => node.props.placeholder === 'Scrim de sexta')!;
  act(() => name.props.onChange({ target: { value: 'Sala da galera' } }));
  await act(async () => { await renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(post[1]).toMatchObject({ credentials: 'same-origin' });
  expect(JSON.parse(post[1]!.body as string)).toEqual({ title: 'Sala da galera', format: 'bo3', isPublic: false });
  expect(mocks.navigate).toHaveBeenCalledWith('/s/new123');
});

it('asks for session revalidation when creation is denied rather than opening a room', async () => {
  mocks.auth.status = 'admin';
  vi.stubGlobal('fetch', vi.fn(async (_path: string, init?: RequestInit) => reply(init?.method === 'POST' ? { error: 'Entre como administrador.' } : [], init?.method === 'POST' ? 403 : 200)));
  await act(async () => { renderer = create(createElement(AdminPortal)); }); await flush();
  await act(async () => { await renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  expect(text(renderer!.root.findByProps({ role: 'alert' }))).toContain('Entre como administrador');
  expect(dispatchEvent).toHaveBeenCalled(); expect(mocks.navigate).not.toHaveBeenCalled();
});

const managedRoom = (overrides: Record<string, unknown> = {}) => ({
  id: 'abc123', title: 'Sala de teste', createdAt: 1, updatedAt: 1, phase: 'setup', teams: ['Time A', 'Time B'], score: [0, 0], maps: [],
  access: { isPublic: false, deletedAt: null as number | null, accessVersion: 1 }, ...overrides,
});
const button = (label: string) => renderer!.root.findAllByType('button').find(node => node.props['aria-label'] === label || text(node) === label)!;
async function dashboard(canDelete = false) {
  mocks.auth.status = 'admin'; mocks.auth.canDeleteRooms = canDelete;
  await act(async () => { renderer = create(createElement(AdminPortal)); }); await flush();
}

it('creates hidden rooms by default and lets the organizer explicitly publish on creation', async () => {
  const fetcher = vi.fn(async (_path: string, init?: RequestInit) => reply(init?.method === 'POST' ? { id: 'new123' } : []));
  vi.stubGlobal('fetch', fetcher); await dashboard();
  const visibility = renderer!.root.findByProps({ name: 'isPublic' }); expect(visibility.props.checked).toBe(false);
  act(() => visibility.props.onChange({ target: { checked: true } }));
  await act(async () => { await renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(JSON.parse(post[1]!.body as string)).toMatchObject({ isPublic: true });
});

it('loads hidden rooms through the authenticated scope and waits for the server before changing the eye', async () => {
  let room = managedRoom(); let finish!: () => void;
  const fetcher = vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method !== 'POST') return reply([room]);
    return new Promise<Response>(resolve => { finish = () => { room = { ...room, access: { isPublic: true, deletedAt: null, accessVersion: 2 } }; resolve(reply({ access: room.access })); }; });
  });
  vi.stubGlobal('fetch', fetcher); await dashboard();
  expect(fetcher.mock.calls[0]![0]).toBe('/api/scrims?scope=admin');
  expect(fetcher.mock.calls[0]![1]).toMatchObject({ credentials: 'same-origin' });
  expect(button('Mostrar sala para espectadores').props['aria-pressed']).toBe(false);
  act(() => button('Mostrar sala para espectadores').props.onClick()); await flush();
  expect(button('Mostrar sala para espectadores').props['aria-pressed']).toBe(false);
  expect(button('Criar scrim').props.disabled).toBe(true);
  await act(async () => { finish(); }); await flush();
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(JSON.parse(post[1]!.body as string)).toEqual({ action: 'show', expectedAccessVersion: 1 });
  expect(button('Ocultar sala dos espectadores').props['aria-pressed']).toBe(true);
  expect(text(renderer!.root)).toContain('Pública');
});

it('shows deletion and the deleted filter only when the server grants the permission', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply([managedRoom()])));
  mocks.auth.email = 'owner@example.test'; await dashboard(false);
  expect(button('Excluir sala')).toBeUndefined(); expect(button('Excluídas')).toBeUndefined();
  mocks.auth.canDeleteRooms = true; mocks.auth.email = 'different@example.test';
  act(() => renderer!.update(createElement(AdminPortal))); await flush();
  expect(button('Excluir sala')).toBeDefined(); expect(button('Excluídas')).toBeDefined();
});

it('confirms soft deletion and restores a deleted room as hidden', async () => {
  let room = managedRoom();
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const { action } = JSON.parse(init.body as string);
      room = { ...room, access: { isPublic: false, deletedAt: action === 'delete' ? 1000 : null, accessVersion: room.access.accessVersion + 1 } };
      return reply({ access: room.access });
    }
    return reply(path.includes('deleted=true') ? room.access.deletedAt === null ? [] : [room] : room.access.deletedAt === null ? [room] : []);
  });
  vi.stubGlobal('fetch', fetcher); await dashboard(true);
  act(() => button('Excluir sala').props.onClick());
  expect(text(renderer!.root)).toContain('Excluir “Sala de teste”?');
  expect(text(renderer!.root)).toContain('Sai das listas. O histórico fica guardado e pode ser restaurado.');
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  act(() => button('Excluir sala').props.onClick()); await flush();
  expect(room.access.deletedAt).toBe(1000);
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Administrar Sala de teste' })).toHaveLength(0);
  act(() => button('Excluídas').props.onClick()); await flush();
  expect(fetcher.mock.calls.some(([path]) => path === '/api/scrims?scope=admin&deleted=true')).toBe(true);
  expect(button('Restaurar')).toBeDefined();
  act(() => button('Restaurar').props.onClick()); await flush();
  expect(room.access.deletedAt).toBeNull(); expect(room.access.isPublic).toBe(false);
  expect(text(renderer!.root)).toContain('restaurada como oculta');
  const actions = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init!.body as string));
  expect(actions).toEqual([{ action: 'delete', expectedAccessVersion: 1 }, { action: 'restore', expectedAccessVersion: 2 }]);
});

it('refetches on a version conflict and uses the new version on the next action', async () => {
  let room = managedRoom({ access: { isPublic: true, deletedAt: null, accessVersion: 1 } }); let conflicted = false;
  const fetcher = vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      if (!conflicted) { conflicted = true; room = managedRoom({ access: { isPublic: false, deletedAt: null, accessVersion: 5 } }); return reply({ error: 'Conflict' }, 409); }
      room = managedRoom({ access: { isPublic: true, deletedAt: null, accessVersion: 6 } }); return reply({ access: room.access });
    }
    return reply([room]);
  });
  vi.stubGlobal('fetch', fetcher); await dashboard();
  act(() => button('Ocultar sala dos espectadores').props.onClick()); await flush();
  expect(text(renderer!.root.findByProps({ role: 'alert' }))).toContain('A sala mudou em outro navegador');
  expect(button('Mostrar sala para espectadores').props['aria-pressed']).toBe(false);
  act(() => button('Mostrar sala para espectadores').props.onClick()); await flush();
  const actions = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init!.body as string));
  expect(actions).toEqual([{ action: 'hide', expectedAccessVersion: 1 }, { action: 'show', expectedAccessVersion: 5 }]);
});

it('removes the old deleted list immediately when the delete permission is revoked', async () => {
  const deleted = managedRoom({ title: 'Histórico excluído', access: { isPublic: false, deletedAt: 1000, accessVersion: 2 } });
  let holdActive = false; let releaseActive!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.includes('deleted=true')) return reply([deleted]);
    if (holdActive) return new Promise<Response>(resolve => { releaseActive = resolve; });
    return reply([]);
  }));
  await dashboard(true); act(() => button('Excluídas').props.onClick()); await flush();
  expect(text(renderer!.root)).toContain('Histórico excluído');
  holdActive = true; mocks.auth.canDeleteRooms = false;
  act(() => renderer!.update(createElement(AdminPortal))); await flush();
  expect(text(renderer!.root)).not.toContain('Histórico excluído'); expect(button('Excluídas')).toBeUndefined(); expect(button('Restaurar')).toBeUndefined();
  await act(async () => { releaseActive(reply([])); }); await flush();
});

it('does not expose room controls when access metadata has an invalid version', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply([managedRoom({ access: { isPublic: true, deletedAt: null, accessVersion: 0 } })])));
  await dashboard(true);
  expect(text(renderer!.root.findByProps({ role: 'alert' }))).toContain('Não foi possível carregar as salas');
  expect(button('Ocultar sala dos espectadores')).toBeUndefined(); expect(button('Excluir sala')).toBeUndefined();
});
