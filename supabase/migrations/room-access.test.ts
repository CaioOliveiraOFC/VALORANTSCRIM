import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

let db: PGlite;
let migration: string;
const hash = 'c'.repeat(64);
const actor = '11111111-2222-4333-8444-555555555555';
const matchId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const createSql = 'select public.create_scrim_with_access($1,$2,$3,$4,1,$5)';
const manageSql = 'select * from public.manage_scrim_access($1,$2,$3,$4,$5)';
const appendSql = 'select public.append_scrim_event($1,$2,$3,$4,$5)';
const importSql = 'select public.import_match_result($1,$2,$3,$4,$5,$6)';

const first = (id: string) => ({ type: 'scrim.create', id, seq: 1, at: 1 });
const initial = (id: string) => ({ id, version: 1 });
async function create(id: string, visible = true) {
  await db.exec('set role service_role');
  await db.query(createSql, [id, hash, initial(id), first(id), visible]);
}
async function access(id: string, version: number, action: string, at = 10) {
  return (await db.query(manageSql, [id, version, action, at, actor])).rows;
}
function importParams(id: string, version = 1) {
  return [id, hash, version, { id, version: version + 1 }, {
    type: 'match.import', seq: version + 1, at: 2, mapIndex: 0, match: { id: matchId },
  }, { private: 'provider response' }];
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create publication supabase_realtime;');
  for (const file of ['20261016_scrims.sql', '20261017_match_imports.sql']) {
    await db.exec(await readFile(new URL(file, import.meta.url), 'utf8'));
  }
  // A pre-migration room exercises the upgrade path with real existing events.
  await db.query('select public.create_scrim($1,$2,$3,$4,1)', ['legacy1', hash, initial('legacy1'), first('legacy1')]);
  migration = await readFile(new URL('20261104_room_access.sql', import.meta.url), 'utf8');
  await db.exec(migration);
}, 30_000);
afterEach(async () => { await db.exec('reset role'); });
afterAll(async () => { await db.close(); });

describe('room access migration, RLS and reversible removal', () => {
  it('keeps existing rooms public, preserves events and retains the legacy create RPC', async () => {
    expect((await db.query('select is_public, deleted_at, access_version, access_updated_by from public.scrims where id=$1', ['legacy1'])).rows)
      .toEqual([{ is_public: true, deleted_at: null, access_version: 1, access_updated_by: null }]);
    expect((await db.query('select event from public.scrim_events where scrim_id=$1', ['legacy1'])).rows).toEqual([{ event: first('legacy1') }]);
    await db.exec('set role service_role');
    await db.query('select public.create_scrim($1,$2,$3,$4,1)', ['legacy2', hash, initial('legacy2'), first('legacy2')]);
    expect((await db.query('select is_public from public.scrims where id=$1', ['legacy2'])).rows).toEqual([{ is_public: true }]);
  });

  it('creates a hidden room atomically and rejects missing visibility without writing', async () => {
    await create('hidden1', false);
    expect((await db.query('select is_public, version from public.scrims where id=$1', ['hidden1'])).rows).toEqual([{ is_public: false, version: 1 }]);
    expect((await db.query('select event from public.scrim_events where scrim_id=$1', ['hidden1'])).rows).toEqual([{ event: first('hidden1') }]);
    await expect(db.query(createSql, ['invalid1', hash, initial('invalid1'), first('invalid1'), null])).rejects.toThrow('INVALID_ACCESS');
    expect((await db.query('select id from public.scrims where id=$1', ['invalid1'])).rows).toEqual([]);
    await expect(db.query(createSql, ['rollback1', hash, initial('rollback1'), null, false])).rejects.toThrow('null value');
    expect((await db.query('select id from public.scrims where id=$1', ['rollback1'])).rows).toEqual([]);
  });

  it('restricts anon and authenticated reads to public events while hiding metadata and raw imports', async () => {
    await create('public1');
    await db.query(importSql, importParams('public1'));
    await create('private1', false);
    await db.query(importSql, importParams('private1'));
    await create('deleted1');
    await access('deleted1', 1, 'delete');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      expect((await db.query('select seq from public.scrim_events where scrim_id=$1 order by seq', ['public1'])).rows).toEqual([{ seq: 1 }, { seq: 2 }]);
      for (const id of ['private1', 'hidden1', 'deleted1', 'absent1']) {
        expect((await db.query('select * from public.scrim_events where scrim_id=$1', [id])).rows).toEqual([]);
        expect((await db.query('select public.scrim_is_public($1) as visible', [id])).rows).toEqual([{ visible: false }]);
      }
      const visibleIds = (await db.query('select distinct scrim_id from public.scrim_events')).rows.map(row => row.scrim_id);
      expect(visibleIds).not.toContain('private1');
      expect(visibleIds).not.toContain('deleted1');
      for (const table of ['scrims', 'scrim_match_imports', 'scrim_import_limits']) {
        await expect(db.query(`select * from public.${table}`)).rejects.toThrow('permission denied');
      }
      await db.exec('reset role');
    }
  });

  it('denies every new mutation RPC and event write to public roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await expect(db.query(createSql, ['denied1', hash, initial('denied1'), first('denied1'), true])).rejects.toThrow('permission denied');
      await expect(db.query(manageSql, ['public1', 1, 'hide', 10, actor])).rejects.toThrow('permission denied');
      await expect(db.query(appendSql, ['public1', hash, 2, { version: 3 }, { seq: 3, at: 3 }])).rejects.toThrow('permission denied');
      await expect(db.query('select public.claim_match_lookup($1,$2)', ['public1', hash])).rejects.toThrow('permission denied');
      await expect(db.query('insert into public.scrim_events values ($1,3,3,$2)', ['public1', { seq: 3 }])).rejects.toThrow('permission denied');
      await expect(db.query('update public.scrim_events set at=3')).rejects.toThrow('permission denied');
      await expect(db.query('delete from public.scrim_events')).rejects.toThrow('permission denied');
      await db.exec('reset role');
    }
  });

  it('uses a separate compare-and-swap for access and records the actor without altering the domain', async () => {
    await create('casroom');
    const attempts = await Promise.allSettled([access('casroom', 1, 'hide', 10), access('casroom', 1, 'show', 11)]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await db.query('select state, version, access_version, access_updated_by from public.scrims where id=$1', ['casroom'])).rows)
      .toEqual([{ state: initial('casroom'), version: 1, access_version: 2, access_updated_by: actor }]);
    expect((await db.query('select count(*)::integer as n from public.scrim_events where scrim_id=$1', ['casroom'])).rows).toEqual([{ n: 1 }]);
    await expect(access('casroom', 1, 'delete')).rejects.toThrow('STALE_OR_FORBIDDEN');
    await expect(access('missing1', 1, 'delete')).rejects.toThrow('STALE_OR_FORBIDDEN');
  });

  it('deletes and restores privately without losing state, events or the raw import', async () => {
    await create('recover1');
    await db.query(importSql, importParams('recover1'));
    const before = (await db.query('select state, version from public.scrims where id=$1', ['recover1'])).rows;
    const events = (await db.query('select event from public.scrim_events where scrim_id=$1 order by seq', ['recover1'])).rows;
    expect(await access('recover1', 1, 'delete', 100)).toEqual([{ is_public: false, deleted_at: 100, access_version: 2 }]);
    expect((await db.query('select access_updated_at, access_updated_by from public.scrims where id=$1', ['recover1'])).rows)
      .toEqual([{ access_updated_at: 100, access_updated_by: actor }]);
    for (const action of ['show', 'hide', 'delete']) await expect(access('recover1', 2, action)).rejects.toThrow('STALE_OR_FORBIDDEN');
    expect(await access('recover1', 2, 'restore', 101)).toEqual([{ is_public: false, deleted_at: null, access_version: 3 }]);
    await expect(access('recover1', 3, 'restore')).rejects.toThrow('STALE_OR_FORBIDDEN');
    expect((await db.query('select state, version from public.scrims where id=$1', ['recover1'])).rows).toEqual(before);
    expect((await db.query('select event from public.scrim_events where scrim_id=$1 order by seq', ['recover1'])).rows).toEqual(events);
    expect((await db.query('select raw from public.scrim_match_imports where scrim_id=$1', ['recover1'])).rows).toEqual([{ raw: { private: 'provider response' } }]);
    expect(await access('recover1', 3, 'show', 102)).toEqual([{ is_public: true, deleted_at: null, access_version: 4 }]);
  });

  it('blocks commands, match imports and provider lookups after deletion', async () => {
    await create('closed1');
    await access('closed1', 1, 'delete');
    await expect(db.query(appendSql, ['closed1', hash, 1, { id: 'closed1', version: 2 }, { seq: 2, at: 2, type: 'note.add', text: 'late' }])).rejects.toThrow('STALE_OR_FORBIDDEN');
    await expect(db.query(importSql, importParams('closed1'))).rejects.toThrow('STALE_OR_FORBIDDEN');
    await expect(db.query('select public.claim_match_lookup($1,$2)', ['closed1', hash])).rejects.toThrow('STALE_OR_FORBIDDEN');
    expect((await db.query('select state, version from public.scrims where id=$1', ['closed1'])).rows).toEqual([{ state: initial('closed1'), version: 1 }]);
    expect((await db.query('select seq from public.scrim_events where scrim_id=$1', ['closed1'])).rows).toEqual([{ seq: 1 }]);
    expect((await db.query('select * from public.scrim_match_imports where scrim_id=$1', ['closed1'])).rows).toEqual([]);
    expect((await db.query('select * from public.scrim_import_limits where bucket=$1', ['room:closed1'])).rows).toEqual([]);
  });

  it('allows writes to hidden active rooms while RLS keeps their new events private', async () => {
    await create('active1', false);
    await db.query(appendSql, ['active1', hash, 1, { id: 'active1', version: 2 }, { seq: 2, at: 2, type: 'note.add', text: 'private' }]);
    expect((await db.query('select public.claim_match_lookup($1,$2) as allowed', ['active1', hash])).rows).toEqual([{ allowed: true }]);
    await db.exec('set role anon');
    expect((await db.query('select * from public.scrim_events where scrim_id=$1', ['active1'])).rows).toEqual([]);
  });

  it('rolls back an access update and its audit fields when the transaction fails', async () => {
    await create('rollback2');
    await db.exec('begin');
    await access('rollback2', 1, 'delete', 999);
    await expect(db.query('select 1 / 0')).rejects.toThrow('division by zero');
    await db.exec('rollback');
    expect((await db.query('select is_public, deleted_at, access_version, access_updated_at, access_updated_by from public.scrims where id=$1', ['rollback2'])).rows)
      .toEqual([{ is_public: true, deleted_at: null, access_version: 1, access_updated_at: null, access_updated_by: null }]);
  });

  it('rejects malformed transitions without changing access metadata', async () => {
    await create('invalid2');
    for (const args of [
      ['invalid2', 1, 'purge', 10, actor], ['invalid2', null, 'hide', 10, actor],
      ['invalid2', 0, 'hide', 10, actor], ['invalid2', 1, null, 10, actor],
      ['invalid2', 1, 'hide', -1, actor], ['invalid2', 1, 'hide', null, actor],
      ['invalid2', 1, 'hide', 10, null],
    ]) await expect(db.query(manageSql, args)).rejects.toThrow('INVALID_ACCESS');
    expect((await db.query('select is_public, access_version from public.scrims where id=$1', ['invalid2'])).rows).toEqual([{ is_public: true, access_version: 1 }]);
  });

  it('can be reapplied without making hidden/deleted rooms public or resetting audit/history', async () => {
    await create('repeat1', false);
    await access('repeat1', 1, 'delete', 123);
    const before = (await db.query('select * from public.scrims where id=$1', ['repeat1'])).rows;
    const events = (await db.query('select * from public.scrim_events where scrim_id=$1', ['repeat1'])).rows;
    await db.exec('reset role');
    await db.exec(migration);
    expect((await db.query('select * from public.scrims where id=$1', ['repeat1'])).rows).toEqual(before);
    expect((await db.query('select * from public.scrim_events where scrim_id=$1', ['repeat1'])).rows).toEqual(events);
    const definition = (await db.query("select prosecdef, proconfig from pg_proc where oid='public.scrim_is_public(text)'::regprocedure")).rows[0];
    expect(definition?.prosecdef).toBe(true);
    expect(definition?.proconfig).toContain('search_path=""');
    await db.exec('set role anon');
    expect((await db.query('select * from public.scrim_events where scrim_id=$1', ['repeat1'])).rows).toEqual([]);
  });
});
