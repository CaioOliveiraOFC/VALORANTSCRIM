import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../hooks/usePublicRooms', () => ({ usePublicRooms: () => ({ rooms: [], error: '', retry: vi.fn() }) }));
vi.mock('../streams/PublicStreams', () => ({ HomeStreams: () => null }));
import { Landing } from './Landing';
let renderer: ReactTestRenderer | undefined;
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join('');
beforeEach(() => {
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('addEventListener', vi.fn());
  vi.stubGlobal('removeEventListener', vi.fn());
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ roomId: null }))));
});
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});
it('shows the VCT invitation without advertising the X1 concept', async () => {
  await act(async () => { renderer = create(createElement(Landing)); });
  expect(text(renderer!.root)).toContain('O nosso 5v5 começa aqui.');
  expect(text(renderer!.root)).not.toMatch(/X1|outros desafios|prévia/i);
  const links = renderer!.root.findAllByType('a');
  expect(links.some(node => node.props.href === '/vct')).toBe(true);
  expect(links.some(node => /^\/(?:x1|preview\/brasa)/.test(node.props.href))).toBe(false);
});
