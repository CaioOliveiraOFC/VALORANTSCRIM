import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./useBroadcasts', () => ({ useBroadcasts: () => ({ broadcasts: [], error: '' }) }));
import { RoomStreams } from './PublicStreams';
let renderer: ReactTestRenderer | undefined;
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; });
it('keeps the room archive discoverable for viewers after the live player is hidden', () => {
  act(() => { renderer = create(createElement(RoomStreams, { roomId: 'publicroom', canEdit: false })); });
  expect(renderer!.root.findAllByType('a').map(link => link.props.href)).toEqual(['/gravacoes?roomId=publicroom']);
  expect(renderer!.root.findAllByType('iframe')).toHaveLength(0);
});
