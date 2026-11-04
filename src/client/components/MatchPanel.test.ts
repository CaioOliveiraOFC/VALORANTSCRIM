import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { applyEvent, type ScrimState } from '../../shared/scrim';
import { readyScrim, sampleLinks, sampleMatch } from '../../test/import-fixture';

const mocks = vi.hoisted(() => ({ room: {} as any }));
vi.mock('./ScrimRoom', () => ({ useRoom: () => mocks.room }));
import { MatchPanel } from './MatchPanel';

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  mocks.room = { state: readyScrim().state, isAdmin: true, act: vi.fn().mockResolvedValue(true), importRequest: vi.fn() };
});
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; });
function text(node: ReactTestInstance): string { return node.children.map(child => typeof child === 'string' ? child : text(child)).join(''); }
function mount(state: ScrimState = mocks.room.state, isAdmin = true) {
  mocks.room.state = state; mocks.room.isAdmin = isAdmin;
  act(() => { renderer = create(createElement(MatchPanel, { selectedMap: null, onSelectMap: vi.fn() })); });
  return renderer!.root;
}
function imported() {
  const state = readyScrim().state;
  return applyEvent(state, { type: 'match.import', seq: state.version + 1, at: 200,
    match: sampleMatch(), mapIndex: 0, redTeam: 'A', links: sampleLinks() });
}

it('lets an admin import while preventing manual rounds and empty KDA entry', () => {
  const root = mount();
  expect(text(root)).toContain('Aguardando importação da partida');
  expect(text(root)).toContain('Nome#TAG');
  expect(root.findAllByType('button').some(button => text(button) === 'Buscar customizada')).toBe(true);
  expect(root.findAllByType('input').filter(input => input.props.type === 'number')).toHaveLength(0);
  expect(text(root)).not.toContain('+ Round');
  expect(text(root)).not.toContain('Desfazer último round');
  expect(root.findAllByType('table')).toHaveLength(0);
  expect(root.findByProps({ 'data-room-focus': 'scoreboard' })).toBeTruthy();
  expect(mocks.room.act).not.toHaveBeenCalled();
});

it('tells spectators they are waiting for imported results without showing edit controls', () => {
  const root = mount(readyScrim().state, false);
  expect(text(root)).toContain('Aguardando importação da partida para você');
  expect(text(root)).toContain('o placar, os rounds e as estatísticas aparecerão aqui');
  expect(text(root)).not.toContain('Buscar customizada');
  expect(root.findAllByType('input')).toHaveLength(0);
});

it('shows imported scores, rounds, identities and provider stats in read-only form', () => {
  const state = imported(), root = mount(state);
  expect(text(root)).not.toContain('Aguardando importação');
  expect(root.findAllByProps({ className: 'points' }).map(node => text(node))).toEqual(['13', '2']);
  expect(root.findByProps({ className: 'round-strip' }).findAllByType('li')).toHaveLength(15);
  const row = root.findAllByType('tr')[1]!;
  expect(row.findAllByType('td').slice(1, 4).map(node => text(node))).toEqual(['1', '5', '3']);
  expect(text(row)).toContain('Apelido 0');
  expect(text(row)).toContain('Riot 0#TEST');
  expect(text(row)).toContain('Fade');
  expect(root.findAllByType('a').find(node => text(node) === 'Ver partida')?.props.href).toContain(sampleMatch().id);
  expect(root.findAllByType('input')).toHaveLength(0);
  expect(root.findAllByType('button').filter(node => String(node.props['aria-label']).startsWith('Corrigir estatística de '))).toHaveLength(10);
  expect(mocks.room.act).not.toHaveBeenCalled();
});

it('preserves existing manual history as read-only data instead of replacing it with waiting', () => {
  let state = readyScrim().state;
  state = applyEvent(state, { type: 'round.win', team: 'A', note: 'Registro antigo', seq: state.version + 1, at: 201 });
  state = applyEvent(state, { type: 'stats.set', mapIndex: 0, playerId: 'p0', line: { kills: 12, deaths: 4, assists: 3 }, seq: state.version + 1, at: 202 });
  const root = mount(state);
  expect(text(root)).toContain('Registro antigo');
  expect(text(root)).toContain('Resultado preservado de uma partida registrada anteriormente');
  expect(text(root)).toContain('Estatísticas preservadas de uma partida registrada anteriormente');
  expect(root.findAllByProps({ className: 'points' }).map(node => text(node))).toEqual(['1', '0']);
  expect(root.findAllByType('input')).toHaveLength(0);
  expect(root.findAllByType('button').filter(node => String(node.props['aria-label']).startsWith('Corrigir estatística de '))).toHaveLength(0);
});

it('requires an explicit correction action after import and saves only KDA for the chosen player', async () => {
  const root = mount(imported());
  const correct = root.findByProps({ 'aria-label': 'Corrigir estatística de Apelido 0' });
  act(() => correct.props.onClick());
  expect(root.findAllByType('input').map(node => node.props.name)).toEqual(['kills', 'deaths', 'assists']);
  act(() => root.findAllByType('input').find(node => node.props.name === 'kills')!.props.onChange({ target: { value: '18' } }));
  await act(async () => { root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  expect(mocks.room.act).toHaveBeenCalledOnce();
  expect(mocks.room.act).toHaveBeenCalledWith({ type: 'stats.set', mapIndex: 0, playerId: 'p0', line: { kills: 18, deaths: 5, assists: 3 } });
  expect(root.findAllByType('input')).toHaveLength(0);
});

it('cancels or rejects invalid corrections without recording an action', async () => {
  const root = mount(imported());
  act(() => root.findByProps({ 'aria-label': 'Corrigir estatística de Apelido 0' }).props.onClick());
  act(() => root.findAllByType('input')[0]!.props.onChange({ target: { value: '' } }));
  await act(async () => { root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  expect(text(root)).toContain('Preencha K/D/A com números inteiros');
  expect(mocks.room.act).not.toHaveBeenCalled();
  act(() => root.findAllByType('button').find(node => text(node) === 'Cancelar')!.props.onClick());
  expect(root.findAllByType('input')).toHaveLength(0);
  expect(mocks.room.act).not.toHaveBeenCalled();
});

it('keeps imported statistics read-only for spectators, including correction controls', () => {
  const root = mount(imported(), false);
  expect(root.findAllByType('button').filter(node => String(node.props['aria-label']).startsWith('Corrigir estatística de '))).toHaveLength(0);
  expect(root.findAllByType('input')).toHaveLength(0);
  expect(root.findAllByType('tr')).toHaveLength(11);
});
