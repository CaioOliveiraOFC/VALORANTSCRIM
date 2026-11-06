import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { ScrimState } from '../../shared/scrim';
import { DRAW_REVEAL_MS, DRAW_TTL_MS, type RoomDraw } from '../../shared/roomTools';
import { readyScrim } from '../../test/import-fixture';
import { RoomTools, type RoomToolsProps } from './RoomTools';

let renderer: ReactTestRenderer | undefined;
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; });
const startedAt = 10_000;
function state(): ScrimState { return { ...readyScrim().state, phase: 'setup' }; }
function captains(): RoomDraw {
  return { id: 'captains-test', kind: 'captains', purpose: 'Escolher quem monta os times', startedAt,
    revealAt: startedAt + DRAW_REVEAL_MS, expiresAt: startedAt + DRAW_TTL_MS, status: 'pending',
    candidates: state().players.map(p => ({ id: p.id, name: p.name })), result: { A: 'p3', B: 'p8' } };
}
function coin(): RoomDraw {
  return { id: 'coin-test', kind: 'coin', purpose: 'Quem começa? Cara = Time A; coroa = Time B.', startedAt,
    revealAt: startedAt + DRAW_REVEAL_MS, expiresAt: startedAt + DRAW_TTL_MS, status: 'pending', result: 'tails' };
}
function text(node: ReactTestInstance): string { return node.children.map(child => typeof child === 'string' ? child : text(child)).join(''); }
function button(label: string) {
  const found = renderer!.root.findAllByType('button').find(node => text(node) === label);
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}
function mount(overrides: Partial<RoomToolsProps> = {}) {
  const props: RoomToolsProps = { state: state(), isAdmin: true, canFocus: true, canDraw: true, canManageTeams: true, now: startedAt, request: vi.fn().mockResolvedValue({}), onFocusAll: vi.fn().mockResolvedValue(undefined), ...overrides };
  act(() => { renderer = create(createElement(RoomTools, props)); });
  return props;
}
function open(kind: 'Capitães' | 'Cara ou coroa') {
  act(() => button('Sorteios ⌄').props.onClick());
  act(() => renderer!.root.findAllByType('button').find(b => text(b).startsWith(kind))!.props.onClick());
}
async function submit() {
  await act(async () => { renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); await Promise.resolve(); });
}

it('only exposes focus and draw controls to admins', async () => {
  const props = mount();
  await act(async () => { await button('◎Chamar todos para cá').props.onClick(); });
  expect(props.onFocusAll).toHaveBeenCalledOnce();
  act(() => renderer!.update(createElement(RoomTools, { ...props, isAdmin: false })));
  expect(renderer!.root.findAllByType('button')).toHaveLength(0);
});

it('starts captains from the full general list without choosing a winner on the client', async () => {
  const request = vi.fn().mockResolvedValue({}); mount({ request }); open('Capitães');
  expect(renderer!.root.findByProps({ 'aria-label': 'Participantes do sorteio' }).findAllByType('span')).toHaveLength(10);
  expect(text(renderer!.root)).toContain('Os demais jogadores voltam para a lista sem time.');
  await submit();
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0]![0]).toMatchObject({ action: 'draw.start', kind: 'captains', purpose: 'Definir os capitães dos times' });
  expect(Object.keys(request.mock.calls[0]![0]).sort()).toEqual(['action', 'kind', 'purpose', 'requestId']);
});

it('requires a coin purpose and preserves request identity when retrying a failed start', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('Conexão interrompida')).mockResolvedValue({});
  mount({ request }); open('Cara ou coroa');
  expect(button('Sortear para todos').props.disabled).toBe(true);
  act(() => renderer!.root.findByType('textarea').props.onChange({ target: { value: '  Quem começa banindo?  ' } }));
  await submit(); expect(text(renderer!.root)).toContain('Conexão interrompida');
  await submit();
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[0]![0].requestId).toBe(request.mock.calls[1]![0].requestId);
  expect(request.mock.calls[0]![0].purpose).toBe('Quem começa banindo?');
});

it('shows a shared blocking draw to spectators without decision controls or dismissal', () => {
  const draw = captains(), blocking = vi.fn(); mount({ state: { ...state(), draws: [draw] }, isAdmin: false, onBlockingChange: blocking });
  expect(renderer!.root.findByProps({ role: 'dialog' }).props['aria-modal']).toBe('true');
  expect(renderer!.root.findAllByType('button')).toHaveLength(0);
  expect(text(renderer!.root)).toContain(draw.purpose);
  expect(blocking).toHaveBeenLastCalledWith(true);
  const preventDefault = vi.fn();
  act(() => renderer!.root.findByProps({ role: 'dialog' }).props.onKeyDown({ key: 'Escape', preventDefault, stopPropagation() {} }));
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(1);
});

it('uses the server reveal time before accepting and sends only the draw id for decisions', async () => {
  const draw = captains(), request = vi.fn().mockResolvedValue({});
  const props = mount({ state: { ...state(), draws: [draw] }, request });
  expect(button('Aceitar resultado').props.disabled).toBe(true);
  await act(async () => { await button('Aceitar resultado').props.onClick(); });
  expect(request).not.toHaveBeenCalled();
  expect(button('Descartar').props.disabled).toBe(false);
  act(() => renderer!.update(createElement(RoomTools, { ...props, now: draw.revealAt })));
  expect(button('Aceitar resultado').props.disabled).toBe(false);
  expect(text(renderer!.root)).toContain('Apelido 3'); expect(text(renderer!.root)).toContain('Apelido 8');
  await act(async () => { await button('Aceitar resultado').props.onClick(); });
  expect(request).toHaveBeenCalledWith({ action: 'draw.accept', drawId: draw.id });
});

it('discards during the animation without accepting or applying the result', async () => {
  const draw = coin(), request = vi.fn().mockResolvedValue({}); mount({ state: { ...state(), draws: [draw] }, request });
  await act(async () => { await button('Descartar').props.onClick(); });
  expect(request).toHaveBeenCalledWith({ action: 'draw.reject', drawId: draw.id });
  expect(request).toHaveBeenCalledOnce();
});

it('expires a pending draw without any request and releases the room', () => {
  const draw = coin(), request = vi.fn(), blocking = vi.fn();
  const props = mount({ state: { ...state(), draws: [draw] }, request, onBlockingChange: blocking });
  act(() => renderer!.update(createElement(RoomTools, { ...props, now: draw.expiresAt })));
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
  expect(text(renderer!.root)).toContain('expirou sem confirmação'); expect(request).not.toHaveBeenCalled();
  expect(blocking).toHaveBeenLastCalledWith(false);
});

it('announces the accepted coin result and keeps rejected draws out of the modal', () => {
  const draw = coin(); const props = mount({ state: { ...state(), draws: [{ ...draw, status: 'accepted', resolvedAt: draw.revealAt }] } });
  expect(text(renderer!.root)).toContain('Resultado aceito: Coroa.'); expect(text(renderer!.root)).toContain(draw.purpose);
  act(() => renderer!.update(createElement(RoomTools, { ...props, state: { ...state(), draws: [{ ...draw, status: 'rejected', resolvedAt: draw.revealAt }] } })));
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
  expect(text(renderer!.root)).toContain('descartou o sorteio');
});

it('normalizes a multiline purpose before sending the draw intent', async () => {
  const request = vi.fn().mockResolvedValue({});
  const props = { state: state(), isAdmin: true, canFocus: true, canDraw: true, canManageTeams: true, request, now: 1, onFocusAll: vi.fn().mockResolvedValue(undefined) };
  act(() => { renderer = create(createElement(RoomTools, props)); });
  const byText = (label: string) => renderer!.root.findAllByType('button').find(node => text(node) === label)!;
  act(() => byText('Sorteios ⌄').props.onClick());
  act(() => renderer!.root.findAllByType('button').find(node => text(node).startsWith('Cara ou coroa'))!.props.onClick());
  act(() => renderer!.root.findByType('textarea').props.onChange({ target: { value: 'Quem começa?\nCara = A; coroa = B.' } }));
  await act(async () => { await renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'Quem começa? Cara = A; coroa = B.' }));
});

it('separates focus from draws and requires team management for captain assignment', async () => {
  const request = vi.fn().mockResolvedValue({});
  mount({ canFocus: false, canDraw: true, canManageTeams: false, request });
  expect(renderer!.root.findAllByType('button').some(node => text(node).includes('Chamar todos'))).toBe(false);
  act(() => button('Sorteios ⌄').props.onClick());
  const captainsButton = renderer!.root.findAllByType('button').find(node => text(node).startsWith('Capitães'))!;
  expect(captainsButton.props.disabled).toBe(true);
  act(() => captainsButton.props.onClick());
  expect(renderer!.root.findAllByType('form')).toHaveLength(0);
  expect(request).not.toHaveBeenCalled();
  const draw = captains();
  act(() => renderer!.update(createElement(RoomTools, { state: { ...state(), draws: [draw] }, isAdmin: true, canDraw: true, canManageTeams: false, now: draw.revealAt, request, onFocusAll: vi.fn() })));
  expect(renderer!.root.findAllByType('button').some(node => text(node) === 'Aceitar resultado')).toBe(false);
  await act(async () => { await button('Descartar').props.onClick(); });
  expect(request).toHaveBeenCalledWith({ action: 'draw.reject', drawId: draw.id });
});

it('closes a local setup and removes decision controls when draw permission is revoked', () => {
  const props = mount(); open('Cara ou coroa');
  expect(renderer!.root.findAllByType('form')).toHaveLength(1);
  act(() => renderer!.update(createElement(RoomTools, { ...props, canDraw: false, canFocus: false })));
  expect(renderer!.root.findAllByType('form')).toHaveLength(0);
  expect(renderer!.root.findAllByType('button')).toHaveLength(0);
  const draw = coin();
  act(() => renderer!.update(createElement(RoomTools, { ...props, state: { ...state(), draws: [draw] }, canDraw: false, canFocus: false, now: draw.revealAt })));
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(1);
  expect(renderer!.root.findAllByType('button')).toHaveLength(0);
});
