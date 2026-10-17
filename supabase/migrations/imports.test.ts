import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
let db: PGlite;
const hash = 'b'.repeat(64), matchId = '11111111-2222-4333-8444-555555555555';
beforeAll(async () => {
  db=new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create publication supabase_realtime;');
  for (const file of ['20261016_scrims.sql','20261017_match_imports.sql']) await db.exec(await readFile(new URL(file,import.meta.url),'utf8'));
},30000);
afterAll(async () => { await db.close(); });
async function room(id: string) {
  await db.exec('set role service_role');
  await db.query('select public.create_scrim($1,$2,$3,$4,1)',[id,hash,{id,version:1},{type:'scrim.create',seq:1,at:1}]);
}
function params(id: string, version = 1) { return [id,hash,version,{id,version:version+1},{type:'match.import',seq:version+1,at:10,mapIndex:0,match:{id:matchId}},{private:'raw provider data'}]; }
it('denies raw import data, limiter and RPCs to both public roles',async () => {
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    for (const table of ['scrim_match_imports','scrim_import_limits']) await expect(db.query(`select * from public.${table}`)).rejects.toThrow('permission denied');
    await expect(db.query('select public.import_match_result($1,$2,$3,$4,$5,$6)',params('abc123'))).rejects.toThrow('permission denied');
    await expect(db.query('select public.claim_match_lookup($1,$2)',['abc123',hash])).rejects.toThrow('permission denied');
    await db.exec('reset role');
  }
});
it('saves state, event and raw audit together and rolls back duplicate imports',async () => {
  const id='room01';await room(id);
  await db.query('select public.import_match_result($1,$2,$3,$4,$5,$6)',params(id));
  expect((await db.query('select version from public.scrims where id=$1',[id])).rows).toEqual([{version:2}]);
  expect((await db.query('select confirmed_by,raw from public.scrim_match_imports where scrim_id=$1',[id])).rows).toEqual([{confirmed_by:'scrim-admin',raw:{private:'raw provider data'}}]);
  await expect(db.query('select public.import_match_result($1,$2,$3,$4,$5,$6)',params(id,2))).rejects.toThrow('duplicate key');
  expect((await db.query('select version from public.scrims where id=$1',[id])).rows).toEqual([{version:2}]);
  expect((await db.query('select seq from public.scrim_events where scrim_id=$1 order by seq',[id])).rows).toEqual([{seq:1},{seq:2}]);
  await db.exec('reset role');
});
it('allows exactly one import at a given version and rejects an incorrect admin hash',async () => {
  const id='room02';await room(id);
  const bad=params(id);bad[1]='wrong';await expect(db.query('select public.import_match_result($1,$2,$3,$4,$5,$6)',bad)).rejects.toThrow('STALE_OR_FORBIDDEN');
  const attempts=await Promise.allSettled([db.query('select public.import_match_result($1,$2,$3,$4,$5,$6)',params(id)),db.query('select public.import_match_result($1,$2,$3,$4,$5,$6)',params(id))]);
  expect(attempts.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  expect((await db.query('select * from public.scrim_match_imports where scrim_id=$1',[id])).rows).toHaveLength(1);
  await db.exec('reset role');
});
it('enforces a shared persistent room rate limit across calls',async () => {
  const id='room03';await room(id);
  await expect(db.query('select public.claim_match_lookup($1,$2) as allowed',[id,'wrong'])).rejects.toThrow('STALE_OR_FORBIDDEN');
  for(let i=0;i<12;i++) expect((await db.query('select public.claim_match_lookup($1,$2) as allowed',[id,hash])).rows).toEqual([{allowed:true}]);
  expect((await db.query('select public.claim_match_lookup($1,$2) as allowed',[id,hash])).rows).toEqual([{allowed:false}]);
  await db.exec('reset role');
});
