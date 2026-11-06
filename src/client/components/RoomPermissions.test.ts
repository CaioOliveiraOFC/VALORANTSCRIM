import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { noPermissions } from '../../shared/adminPermissions';
import { readyScrim } from '../../test/import-fixture';
const mocks = vi.hoisted(() => ({ room: {} as any }));
vi.mock('./ScrimRoom', () => ({ useRoom: () => mocks.room }));
import { TeamsPanel } from './TeamsPanel';
import { VetoPanel } from './VetoPanel';
let renderer: ReactTestRenderer | undefined;
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join('');
beforeEach(() => {
  mocks.room = { state: { ...readyScrim().state, phase: 'setup' }, isAdmin: true, permissions: noPermissions(),
    can: (key: string) => mocks.room.isAdmin && mocks.room.permissions[key] === true, act: vi.fn() };
});
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; });

it('lets a veto operator start the veto without exposing configuration or team editing', () => {
  mocks.room.permissions.manageVeto = true;
  act(() => { renderer = create(createElement(TeamsPanel)); });
  expect(renderer!.root.findAllByType('input').every(node => node.props.name === 'first')).toBe(true);
  expect(renderer!.root.findAllByType('button').map(node => text(node))).toEqual(['Começar veto']);
  expect(text(renderer!.root)).toContain('Configuração da sala');
  expect(mocks.room.act).not.toHaveBeenCalled();
});

it('lets a team manager edit rosters without changing room settings or starting the veto', () => {
  mocks.room.permissions.manageTeams = true;
  act(() => { renderer = create(createElement(TeamsPanel)); });
  expect(renderer!.root.findAllByType('input').some(node => node.props.placeholder === 'Nick do jogador')).toBe(true);
  expect(renderer!.root.findAllByType('input').some(node => node.props.defaultValue === mocks.room.state.title)).toBe(false);
  expect(renderer!.root.findAllByType('button').some(node => text(node) === 'Começar veto')).toBe(false);
  expect(text(renderer!.root)).toContain('Configuração da sala');
});

it('does not expose veto actions to a room owner lacking the veto capability', () => {
  mocks.room.state = readyScrim().state;
  act(() => { renderer = create(createElement(VetoPanel)); });
  expect(renderer!.root.findAllByType('button')).toHaveLength(0);
  expect(text(renderer!.root)).toContain('Veto concluído');
  expect(mocks.room.act).not.toHaveBeenCalled();
});
