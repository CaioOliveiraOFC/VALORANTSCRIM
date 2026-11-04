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
  mocks.navigate.mockReset(); mocks.auth = { status: 'viewer', login: vi.fn().mockResolvedValue(undefined), logout: vi.fn(), refresh: vi.fn() };
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
  expect(JSON.parse(post[1]!.body as string)).toEqual({ title: 'Sala da galera', format: 'bo3' });
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
