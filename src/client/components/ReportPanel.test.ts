import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readyScrim } from '../../test/import-fixture';

const mocks = vi.hoisted(() => ({ room: {} as any, request: vi.fn() }));
vi.mock('./ScrimRoom', () => ({ useRoom: () => mocks.room }));
vi.mock('../authFetch', () => ({ adminFetch: mocks.request }));
import { ReportPanel } from './ReportPanel';

let renderer: ReactTestRenderer | undefined;
let link: { href: string; download: string; click: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join('');
function button(label: string) { return renderer!.root.findAllByType('button').find(node => text(node) === label)!; }
function mount() { act(() => { renderer = create(createElement(ReportPanel, { scrimId: 'abc123' })); }); }
async function click(label: string) { await act(async () => { button(label).props.onClick(); }); }

beforeEach(() => {
  vi.useFakeTimers(); mocks.request.mockReset();
  mocks.room = { state: readyScrim().state, isAdmin: false, act: vi.fn() };
  link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
  vi.stubGlobal('document', { createElement: vi.fn(() => link), body: { appendChild: vi.fn() } });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:report-test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => {
  if (renderer) act(() => renderer!.unmount()); renderer = undefined;
  vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it.each([
  ['Baixar relatório (.md)', '/api/scrims/abc123/report.md', 'scrim-abc123.md', '# Relatório'],
  ['Exportar dados (.json)', '/api/scrims/abc123', 'scrim-abc123.json', '{"state":{}}'],
])('downloads %s through the ordered request wrapper with the correct filename', async (label, path, filename, data) => {
  mocks.request.mockResolvedValue(new Response(data)); mount();
  await click(label);
  expect(mocks.request).toHaveBeenCalledOnce();
  expect(mocks.request).toHaveBeenCalledWith(path, { cache: 'no-store' });
  expect(link.download).toBe(filename); expect(link.href).toBe('blob:report-test');
  expect(document.body.appendChild).toHaveBeenCalledWith(link);
  expect(link.click).toHaveBeenCalledOnce(); expect(link.remove).toHaveBeenCalledOnce();
  const blob = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob;
  expect(await blob.text()).toBe(data);
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:report-test');
});

it.each([401, 403, 404])('shows a %s denial accessibly without downloading an error response', async status => {
  mocks.request.mockResolvedValue(new Response(JSON.stringify({ error: 'Sala indisponível para este acesso.' }), { status })); mount();
  await click('Exportar dados (.json)');
  expect(text(renderer!.root.findByProps({ role: 'alert' }))).toBe('Sala indisponível para este acesso.');
  expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(link.click).not.toHaveBeenCalled();
  expect(button('Baixar relatório (.md)').props.disabled).toBe(false);
});

it('blocks duplicate or concurrent exports while a response is pending, then permits retry', async () => {
  let resolve!: (response: Response) => void;
  mocks.request.mockReturnValue(new Promise<Response>(done => { resolve = done; })); mount();
  act(() => { button('Baixar relatório (.md)').props.onClick(); button('Exportar dados (.json)').props.onClick(); });
  expect(mocks.request).toHaveBeenCalledOnce();
  expect(button('Baixar relatório (.md)').props.disabled).toBe(true);
  expect(button('Exportar dados (.json)').props.disabled).toBe(true);
  expect(text(renderer!.root.findByProps({ role: 'status' }))).toContain('Preparando relatório');
  await act(async () => { resolve(new Response('missing', { status: 404 })); });
  expect(link.click).not.toHaveBeenCalled();
  expect(button('Exportar dados (.json)').props.disabled).toBe(false);
  mocks.request.mockResolvedValue(new Response('{}'));
  await click('Exportar dados (.json)');
  expect(link.click).toHaveBeenCalledOnce();
  expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
});

it('turns network failures into a safe message while preserving the report and notes', async () => {
  mocks.request.mockRejectedValue(new Error('private provider details')); mount();
  await click('Baixar relatório (.md)');
  expect(text(renderer!.root.findByProps({ role: 'alert' }))).toContain('Confira sua conexão');
  expect(text(renderer!.root)).not.toContain('private provider details');
  expect(text(renderer!.root)).toContain('Preservar anotação');
  expect(link.click).not.toHaveBeenCalled();
});
