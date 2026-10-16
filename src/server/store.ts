/**
 * Persistência em arquivos: cada scrim é um log append-only em JSON Lines
 * (`<id>.events.jsonl`) mais um `<id>.meta.json` com o hash da chave de admin.
 *
 * JSONL é fácil de inspecionar, de versionar e de importar em pandas/Excel
 * para análise. Para muitos usuários simultâneos, troque esta classe por uma
 * implementação em Postgres/SQLite mantendo a mesma interface.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ScrimEvent } from '../shared/scrim.js';

export interface ScrimMeta {
  id: string;
  adminKeyHash: string;
  createdAt: number;
}

const ID_RE = /^[a-z0-9]{6,32}$/;

export class FileEventStore {
  constructor(private readonly dir: string) {}

  async init() {
    await fs.mkdir(this.dir, { recursive: true });
  }

  private file(id: string, suffix: string) {
    if (!ID_RE.test(id)) throw new Error('ID de scrim inválido.');
    return path.join(this.dir, `${id}.${suffix}`);
  }

  async create(meta: ScrimMeta, first: ScrimEvent) {
    // flag "wx": falha se já existir, evitando sobrescrever uma scrim.
    await fs.writeFile(this.file(meta.id, 'meta.json'), JSON.stringify(meta), { flag: 'wx' });
    await this.append(meta.id, first);
  }

  async append(id: string, event: ScrimEvent) {
    await fs.appendFile(this.file(id, 'events.jsonl'), JSON.stringify(event) + '\n');
  }

  async meta(id: string): Promise<ScrimMeta | null> {
    try {
      return JSON.parse(await fs.readFile(this.file(id, 'meta.json'), 'utf8')) as ScrimMeta;
    } catch {
      return null;
    }
  }

  async events(id: string): Promise<ScrimEvent[]> {
    const raw = await fs.readFile(this.file(id, 'events.jsonl'), 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ScrimEvent);
  }

  async ids(): Promise<string[]> {
    const files = await fs.readdir(this.dir);
    return files.filter((f) => f.endsWith('.meta.json')).map((f) => f.slice(0, -'.meta.json'.length));
  }
}
