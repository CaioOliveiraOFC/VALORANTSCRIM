import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SetupModal } from './Dialogs';
import { createBracket, type Bracket } from './model';
let renderer: ReactTestRenderer | undefined;
beforeEach(() => { vi.stubGlobal('document', { activeElement: null }); vi.stubGlobal('HTMLElement', class {}); });
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
it('reopens a sparse bracket at its existing capacity and edits the actual semifinal without resetting it', () => {
  const bracket = createBracket(['Caio', 'Duda', 'JP'], 16);
  const save = vi.fn();
  act(() => { renderer = create(createElement(SetupModal, { bracket, save, close: vi.fn() })); });
  expect(renderer!.root.findAllByType('select')[0]!.props.value).toBe('16');
  expect(renderer!.root.findAllByType('select').slice(1).map(node => node.props['aria-label'])).toEqual([
    'Formato de Oitavas de final', 'Formato de Quartas de final', 'Formato de Semifinais', 'Formato de Final',
  ]);
  expect(renderer!.root.findAllByProps({ type: 'checkbox' })).toHaveLength(0);
  act(() => renderer!.root.findByProps({ 'aria-label': 'Formato de Semifinais' }).props.onChange({ target: { value: '5' } }));
  act(() => renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
  expect(save).toHaveBeenCalledOnce();
  const next = save.mock.calls[0]![0] as Bracket;
  expect(next.size).toBe(16); expect(next.formats).toEqual([1, 1, 5, 5]);
  expect(next.entrants).toBe(bracket.entrants); expect(next.results).toBe(bracket.results);
});
it('asks for a reset only when automatic sizing would really change the original capacity', () => {
  const bracket = createBracket(['Caio', 'Duda', 'JP'], 16);
  const save = vi.fn();
  act(() => { renderer = create(createElement(SetupModal, { bracket, save, close: vi.fn() })); });
  act(() => renderer!.root.findAllByType('select')[0]!.props.onChange({ target: { value: 'auto' } }));
  expect(renderer!.root.findAllByProps({ type: 'checkbox' })).toHaveLength(1);
  act(() => renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
  expect(save).not.toHaveBeenCalled();
  act(() => renderer!.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }));
  act(() => renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
  expect(save.mock.calls[0]![0].size).toBe(4);
});
it('expands an existing bracket when newly added players exceed its current capacity', () => {
  const bracket = createBracket(['Caio', 'Duda']);
  const save = vi.fn();
  act(() => { renderer = create(createElement(SetupModal, { bracket, save, close: vi.fn() })); });
  act(() => renderer!.root.findByType('textarea').props.onChange({ target: { value: 'Caio\nDuda\nJP' } }));
  expect(renderer!.root.findAllByType('select')[0]!.props.value).toBe('auto');
  act(() => renderer!.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }));
  act(() => renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
  expect(save.mock.calls[0]![0].size).toBe(4);
  expect(save.mock.calls[0]![0].entrants).toHaveLength(3);
});
