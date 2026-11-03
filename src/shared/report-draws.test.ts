import { describe, expect, it } from 'vitest';
import { drawResultLabel, drawStatusLabel, toMarkdown } from './report.js';
import type { RoomDraw } from './roomTools.js';
import { applyEvent, initialState } from './scrim.js';
import { readyScrim, sampleLinks, sampleMatch } from '../test/import-fixture.js';

const startedAt = Date.UTC(2026, 10, 3, 21, 0);
const captains = (status: RoomDraw['status'] = 'accepted'): RoomDraw => ({
  id: `captains-${status}`,
  kind: 'captains',
  purpose: 'Escolher os dois capitães',
  startedAt,
  revealAt: startedAt + 4_000,
  expiresAt: startedAt + 120_000,
  status,
  ...(status !== 'pending' ? { resolvedAt: startedAt + 5_000 } : {}),
  candidates: [{ id: 'p0', name: 'Sova da época' }, { id: 'p1', name: 'Kal da época' }],
  result: { A: 'p0', B: 'p1' },
});
const coin = (status: RoomDraw['status'] = 'rejected'): RoomDraw => ({
  id: `coin-${status}`,
  kind: 'coin',
  purpose: 'Quem começa banindo?',
  startedAt,
  revealAt: startedAt + 4_000,
  expiresAt: startedAt + 120_000,
  status,
  ...(status !== 'pending' ? { resolvedAt: startedAt + 5_000 } : {}),
  result: 'tails',
});

const room = () => applyEvent(initialState(), {
  type: 'scrim.create', id: 'abc123', title: 'Sala de teste', format: 'bo3', seq: 1, at: startedAt,
});

describe('draw audit in reports', () => {
  it('keeps accepted and discarded attempts and their original candidate names', () => {
    const state = room();
    state.players = [{ id: 'p0', name: 'Nome novo', team: 'A' }, { id: 'p1', name: 'Outro nome novo', team: 'B' }];
    state.draws = [captains(), coin()];
    const report = toMarkdown(state);
    expect(report).toContain('### 1. Capitães');
    expect(report).toContain('**Resultado:** Time A: Sova da época; Time B: Kal da época');
    expect(report).toContain('**Decisão:** Aceito pelo admin');
    expect(report).toContain('### 2. Cara ou coroa');
    expect(report).toContain('**Resultado:** Coroa');
    expect(report).toContain('**Decisão:** Descartado pelo admin');
    expect(drawResultLabel(captains())).not.toContain('Nome novo');
  });

  it('never treats an expired pending result as accepted', () => {
    const pending = coin('pending');
    expect(drawStatusLabel(pending, pending.revealAt)).toBe('Sem confirmação');
    expect(drawStatusLabel(pending, pending.expiresAt)).toBe('Expirado sem confirmação');
    expect(drawStatusLabel(coin('accepted'), pending.expiresAt + 1)).toBe('Aceito pelo admin');
    expect(drawStatusLabel(coin('rejected'), pending.expiresAt + 1)).toBe('Descartado pelo admin');
    const report = toMarkdown({ ...room(), draws: [pending] });
    expect(report).toContain('**Decisão:** Sem confirmação; prazo até');
    expect(report).not.toContain('Aceito pelo admin');
  });

  it('quotes draw text in Markdown rather than letting it inject report structure', () => {
    const draw = { ...coin(), purpose: 'Veto\n# Resultado [falso](https://example.com)' };
    const report = toMarkdown({ ...room(), draws: [draw] });
    expect(report).toContain('**Motivo:** Veto \\# Resultado \\[falso\\]\\(https://example.com\\)');
    expect(report).not.toContain('\n# Resultado');
  });

  it('preserves legacy imported match reports when no draws exist', () => {
    const ready = readyScrim().state;
    const imported = applyEvent(ready, { type: 'match.import', seq: ready.version + 1, at: startedAt,
      mapIndex: 0, redTeam: 'A', match: sampleMatch(), links: sampleLinks() });
    const oldReport = toMarkdown(imported);
    expect(toMarkdown({ ...imported, draws: [] })).toBe(oldReport);
    expect(oldReport).toContain('Fonte: HenrikDev');
    expect(oldReport).toContain('Time A 13 x 2 Time B');
    expect(oldReport).not.toContain('## Sorteios');
  });
});
