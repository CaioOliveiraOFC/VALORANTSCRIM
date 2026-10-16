import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
let db: PGlite;
beforeAll(async()=>{
  db=new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create publication supabase_realtime;');
  await db.exec(await readFile(new URL('./20261016_scrims.sql',import.meta.url),'utf8'));
},30000);
afterAll(async()=>{await db.close();});
const state={id:'abc123',version:1};
const first={seq:1,at:1,type:'scrim.create',id:'abc123'};
const hash='a'.repeat(64);
describe('Postgres migration, roles and transactional RPCs (PGlite)',()=>{
  it('denies public metadata, writes and RPC execution while allowing event SELECT',async()=>{
    for(const role of ['anon','authenticated']){
      await db.exec(`set role ${role}`);
      await expect(db.query('select * from public.scrims')).rejects.toThrow(/permission denied/);
      await expect(db.query('insert into public.scrim_events values ($1,1,1,$2)',['abc123',first])).rejects.toThrow(/permission denied/);
      await expect(db.query('update public.scrim_events set at=2')).rejects.toThrow(/permission denied/);
      await expect(db.query('delete from public.scrim_events')).rejects.toThrow(/permission denied/);
      await expect(db.query('select public.create_scrim($1,$2,$3,$4,1)',['abc123',hash,state,first])).rejects.toThrow(/permission denied/);
      await expect(db.query('select public.append_scrim_event($1,$2,1,$3,$4)',['abc123',hash,state,first])).rejects.toThrow(/permission denied/);
      await expect(db.query('select public.import_scrim($1,$2,$3,$4)',['abc123',hash,state,[first]])).rejects.toThrow(/permission denied/);
      expect((await db.query('select * from public.scrim_events')).rows).toEqual([]);
      await db.exec('reset role');
    }
  });
  it('creates atomically and permits exactly one writer with the expected version',async()=>{
    await db.exec('set role service_role');
    await db.query('select public.create_scrim($1,$2,$3,$4,1)',['abc123',hash,state,first]);
    const event={seq:2,at:2,type:'note.add',text:'test'};
    const params=['abc123',hash,{id:'abc123',version:2},event];
    const attempts=await Promise.allSettled([db.query('select public.append_scrim_event($1,$2,1,$3,$4)',params),db.query('select public.append_scrim_event($1,$2,1,$3,$4)',params)]);
    expect(attempts.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(attempts.filter(x=>x.status==='rejected')).toHaveLength(1);
    await expect(db.query('select public.append_scrim_event($1,$2,2,$3,$4)',['abc123','wrong',{version:3},{...event,seq:3}])).rejects.toThrow('STALE_OR_FORBIDDEN');
    expect((await db.query('select version from public.scrims')).rows).toEqual([{version:2}]);
    expect((await db.query('select seq from public.scrim_events order by seq')).rows).toEqual([{seq:1},{seq:2}]);
    await db.exec('reset role; set role anon');
    expect((await db.query('select seq from public.scrim_events order by seq')).rows).toHaveLength(2);
    await db.exec('reset role');
  });
  it('rolls back state when an event insert fails',async()=>{
    await db.exec(`create function public.reject_event() returns trigger language plpgsql as $$ begin raise exception 'event failure'; end $$; create trigger reject_event before insert on public.scrim_events for each row execute function public.reject_event(); set role service_role;`);
    await expect(db.query('select public.append_scrim_event($1,$2,2,$3,$4)',['abc123',hash,{version:3},{seq:3,at:3}])).rejects.toThrow('event failure');
    expect((await db.query('select version from public.scrims')).rows).toEqual([{version:2}]);
    await db.exec('reset role; drop trigger reject_event on public.scrim_events;');
  });
  it('imports exact logs and hash atomically, rejecting overwrite and non-contiguous history',async()=>{
    await db.exec('set role service_role');
    const id='legacy1';const events=[{...first,id},{seq:2,at:2,type:'note.add',text:'Original'}];
    const args=[id,hash,{id,version:2},events];
    await db.query('select public.import_scrim($1,$2,$3,$4)',args);
    expect((await db.query('select event from public.scrim_events where scrim_id=$1 order by seq',[id])).rows.map(r=>r.event)).toEqual(events);
    expect((await db.query('select admin_key_hash from public.scrims where id=$1',[id])).rows).toEqual([{admin_key_hash:hash}]);
    await expect(db.query('select public.import_scrim($1,$2,$3,$4)',args)).rejects.toThrow(/duplicate key/);
    await expect(db.query('select public.import_scrim($1,$2,$3,$4)',['broken1',hash,{id:'broken1',version:2},[{...first,id:'broken1'},{seq:3,at:2}]])).rejects.toThrow('INVALID_IMPORT_SEQUENCE');
    expect((await db.query('select id from public.scrims where id=$1',['broken1'])).rows).toEqual([]);
    await db.exec('reset role');
  });
});
