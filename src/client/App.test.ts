import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { status: 'viewer', isSuperAdmin: false, email: '', can: () => false, logout: async () => {} },
}));
vi.mock('./hooks/useAdminAuth', () => ({
  AdminAuthProvider: ({ children }: { children: ReactNode }) => children,
  useAdminAuth: () => mocks.auth,
}));
vi.mock('./router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./router')>();
  return { ...actual, useRoute: () => actual.parseRoute(location.pathname), navigate: vi.fn() };
});
vi.mock('./components/Home', () => ({ Home: () => 'Salas VCT' }));
vi.mock('./components/AdminPortal', () => ({ AdminPortal: () => 'Minha organização' }));
vi.mock('./components/SuperAdminPanel', () => ({ SuperAdminPanel: () => 'Administração' }));
vi.mock('./components/ScrimRoom', () => ({ ScrimRoom: () => 'Sala' }));
vi.mock('./features/streams/StreamsAdmin', () => ({ StreamsAdmin: () => 'Mídia dos eventos' }));
vi.mock('./features/streams/RecordingsPage', () => ({ RecordingsPage: () => 'Gravações' }));
vi.mock('./features/lobby/Landing', () => ({ Landing: () => createElement('main', { 'data-home': true }, 'Início da Brasa') }));
vi.mock('./ui/Brand', () => ({ Brand: () => 'Brasa' }));

import { App } from './App';
let renderer: ReactTestRenderer | undefined;
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join('');
beforeEach(() => {
  mocks.auth = { status: 'viewer', isSuperAdmin: false, email: '', can: () => false, logout: async () => {} };
  vi.stubGlobal('document', { title: '' });
  vi.stubGlobal('location', { pathname: '/', search: '' });
});
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});
function mount() { act(() => { renderer = create(createElement(App)); }); }

it('keeps the public navigation focused on the shipped experience without an X1 entry', () => {
  mount();
  const links = renderer!.root.findAllByType('a');
  expect(links.some(node => node.props.href === '/vct')).toBe(true);
  expect(links.some(node => node.props.href === '/x1' || node.props.href.startsWith('/preview/brasa'))).toBe(false);
  expect(links.some(node => node.props.href === '/admin/lives')).toBe(false);
  expect(text(renderer!.root)).not.toMatch(/X1|prévia/i);
});

it('lets an authenticated administrator find live and recording information without edit permission', () => {
  mocks.auth = { ...mocks.auth, status: 'admin', email: 'organizer@example.test' };
  mount();
  const link = renderer!.root.findAllByType('a').find(node => node.props.href === '/admin/lives');
  expect(link).toBeDefined();
  expect(text(link!)).toBe('Lives e gravações');
  expect(renderer!.root.findAllByType('a').some(node => node.props.href === '/admin/management')).toBe(false);
});

it.each([
  ['/x1', ''],
  ['/x1/', ''],
  ['/preview/brasa', '?tela=x1'],
  ['/preview/brasa', '?tela=sugestoes'],
])('renders the public home for a retired prototype URL %s%s', (pathname, search) => {
  vi.stubGlobal('location', { pathname, search });
  mount();
  expect(renderer!.root.findByProps({ 'data-home': true })).toBeDefined();
  expect(document.title).toBe('Brasa — Churras Club');
  expect(text(renderer!.root)).not.toMatch(/X1|prévia|campeonato/i);
});
