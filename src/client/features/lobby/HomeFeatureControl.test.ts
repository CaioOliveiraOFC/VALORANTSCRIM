import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../authFetch', () => ({
  adminFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));
import { HomeFeatureControl } from './HomeFeatureControl';
import type { ScrimSummary } from '../../../shared/protocol';
let renderer: ReactTestRenderer | undefined;
const room: ScrimSummary = {
  id: 'publicroom',
  title: 'Sala pública',
  phase: 'live',
  createdAt: 1,
  updatedAt: 1,
  teams: ['A', 'B'],
  score: [0, 0],
  maps: [],
  access: { isPublic: true, deletedAt: null, accessVersion: 1 },
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});
it('sends the selected public id and its expected version, then records the returned version', async () => {
  const calls: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, options) => {
      if (options.method === 'PUT') {
        calls.push(JSON.parse(options.body));
        return response({ roomId: 'publicroom', version: 5 });
      }
      return response({ roomId: null, version: 4 });
    }),
  );
  await act(async () => {
    renderer = create(
      createElement(HomeFeatureControl, {
        rooms: [room, { ...room, id: 'hiddenroom', access: { ...room.access!, isPublic: false } }],
      }),
    );
  });
  await flush();
  expect(renderer!.root.findAllByType('option').map((item) => item.props.value)).toEqual([
    '',
    'publicroom',
  ]);
  act(() =>
    renderer!.root.findByType('select').props.onChange({ target: { value: 'publicroom' } }),
  );
  await act(async () => {
    await renderer!.root.findAllByType('button')[0]!.props.onClick();
  });
  await flush();
  expect(calls).toEqual([{ roomId: 'publicroom', expectedVersion: 4 }]);
  expect(renderer!.root.findAllByType('button')[0]!.props.disabled).toBe(true);
});
it('refreshes a conflicting version without silently applying the old selection', async () => {
  let reads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, options) =>
      options.method === 'PUT'
        ? response({ error: 'O destaque mudou.' }, 409)
        : response({ roomId: null, version: ++reads }),
    ),
  );
  await act(async () => {
    renderer = create(createElement(HomeFeatureControl, { rooms: [room] }));
  });
  await flush();
  act(() =>
    renderer!.root.findByType('select').props.onChange({ target: { value: 'publicroom' } }),
  );
  await act(async () => {
    await renderer!.root.findAllByType('button')[0]!.props.onClick();
  });
  await flush();
  expect(reads).toBe(2);
  expect(renderer!.root.findByType('select').props.value).toBe('');
  expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(1);
});
