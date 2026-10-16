/** Import unchanged JSONL logs and hashed admin keys; dry-run is the default. */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { applyEvent, initialState, type ScrimEvent } from '../src/shared/scrim.js';

const args = process.argv.slice(2);
const directory = args.find((arg) => !arg.startsWith('--'));
if (!directory || args.some((arg) => arg.startsWith('--') && arg !== '--apply')) {
  throw new Error('Usage: npm run import:legacy -- /absolute/path/to/data [--apply]');
}
const apply = args.includes('--apply');
const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (apply && (!url || !/^https:\/\/[\w.-]+$/.test(url) || !key)) throw new Error('Configure server-side Supabase variables before --apply.');
const files = await readdir(directory);
const ids = [...new Set(files.filter((f) => /\.(meta\.json|events\.jsonl)$/.test(f)).map((f) => f.replace(/\.(meta\.json|events\.jsonl)$/, '')))];
// Validate ALL logs before writing anything. Never modify the originals.
const imports = await Promise.all(ids.map(async (id) => {
  if (!/^[a-z0-9]{6,32}$/.test(id)) throw new Error('Invalid legacy filename.');
  const meta = JSON.parse(await readFile(path.join(directory, `${id}.meta.json`), 'utf8'));
  const events = (await readFile(path.join(directory, `${id}.events.jsonl`), 'utf8')).split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as ScrimEvent);
  if (meta.id !== id || !/^[a-f0-9]{64}$/.test(meta.adminKeyHash) || !events.length || events[0]?.type !== 'scrim.create' || events[0].id !== id || events.some((e) => !Number.isSafeInteger(e.at))) throw new Error(`Invalid legacy data: ${id}`);
  const state = events.reduce((s, e) => applyEvent(s, e, true), initialState());
  return { p_id: id, p_key_hash: meta.adminKeyHash, p_state: state, p_events: events };
}));
for (const payload of imports) {
  if (apply) {
    const response = await fetch(`${url}/rest/v1/rpc/import_scrim`, {
      method: 'POST', headers: { apikey: key!, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(60000),
    });
    // Never print server responses which could contain private import material.
    if (!response.ok) throw new Error(`Import failed for ${payload.p_id}: HTTP ${response.status}. Existing IDs are not overwritten. Check earlier successful imports before retrying.`);
  }
  console.log(`${apply ? 'Imported' : 'Validated'} ${payload.p_id}: ${payload.p_events.length} unchanged events`);
}
console.log(`${imports.length} scrims. ${apply ? 'Verify remote history before retiring the old server; keep backups.' : 'Dry-run only. Back up the source and use --apply after configuring Supabase.'}`);
