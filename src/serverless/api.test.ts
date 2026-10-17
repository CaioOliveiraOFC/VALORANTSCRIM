import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { readyScrim, sampleLinks, sampleMatch, rawMatch } from '../test/import-fixture.js';
import serve from '../../api/index.js';
import { applyEvent, initialState, type ScrimEvent, type ScrimState } from '../shared/scrim.js';

type Row = { id: string; admin_key_hash: string; state: ScrimState; version: number; events: ScrimEvent[] };
const rows = new Map<string, Row>();
let port: number;
let server: http.Server;
let casConflict = false;
let lookupAllowed = true;
let providerCalls = 0;
const dbCalls: string[] = [];
function call(path: string, method = 'GET', body?: unknown): Promise<{status: number; body: any; text: string}> {
  return new Promise((resolve, reject) => {
    const req = http.request({hostname: '127.0.0.1', port, path, method, headers: {'content-type':'application/json'}}, (res) => {
      let text=''; res.on('data', (b) => text += b); res.on('end', () => {
        let parsed; try {parsed=JSON.parse(text);} catch {parsed=text;}
        resolve({status:res.statusCode!,body:parsed,text});
      });
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
beforeAll(async () => {
  server = http.createServer((req,res) => { void serve(req,res); });
  await new Promise<void>((resolve) => server.listen(0,'127.0.0.1',resolve));
  port=(server.address() as AddressInfo).port;
});
afterAll(async () => { await new Promise<void>((resolve,reject) => server.close((e) => e ? reject(e) : resolve())); });
beforeEach(() => {
  rows.clear(); dbCalls.length=0; casConflict=false; lookupAllowed=true; providerCalls=0;
  vi.stubEnv('HENRIK_API_KEY','provider-test-key');
  vi.stubEnv('SUPABASE_URL','https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','server-test-key');
  vi.stubGlobal('fetch',vi.fn(async (input: string, options: RequestInit) => {
    const u=new URL(input);
    if (u.hostname === 'api.henrikdev.xyz') {
      providerCalls++;
      expect(new Headers(options.headers).get('Authorization')).toBe('provider-test-key');
      return new Response(JSON.stringify({data:u.pathname.includes('/matches/') ? [rawMatch()] : rawMatch()}));
    }
    dbCalls.push(u.pathname+u.search);
    expect(new Headers(options.headers).get('apikey')).toBe('server-test-key');
    const payload=options.body ? JSON.parse(String(options.body)) : null;
    const ok=(body:unknown)=>new Response(body===null ? null : JSON.stringify(body),{status:body===null?204:200});
    if (u.pathname.endsWith('/rpc/create_scrim')) {
      rows.set(payload.p_id,{id:payload.p_id,admin_key_hash:payload.p_key_hash,state:payload.p_state,version:1,events:[payload.p_event]});return ok(null);
    }
    if (u.pathname.endsWith('/rpc/claim_match_lookup')) return ok(lookupAllowed);
    if (u.pathname.endsWith('/rpc/append_scrim_event') || u.pathname.endsWith('/rpc/import_match_result')) {
      const r=rows.get(payload.p_id)!;
      if(casConflict || r.version!==payload.p_expected_version || r.admin_key_hash!==payload.p_key_hash) return new Response(JSON.stringify({message:'STALE_OR_FORBIDDEN'}),{status:400});
      r.state=payload.p_state;r.version++;r.events.push(payload.p_event);return ok(null);
    }
    const id=u.searchParams.get('id')?.slice(3) ?? u.searchParams.get('scrim_id')?.slice(3);
    if(u.pathname.endsWith('/scrims')) return ok(id ? (rows.has(id)?[rows.get(id)]:[]) : [...rows.values()]);
    if(u.pathname.endsWith('/scrim_events')) {
      const conditions=u.searchParams.getAll('seq');
      const after=Number(conditions.find(x=>x.startsWith('gt.'))?.slice(3)??0);
      const until=Number(conditions.find(x=>x.startsWith('lte.'))?.slice(4)??Infinity);
      // Simulate a PostgREST cap smaller than the requested page size.
      return ok(rows.get(id!)!.events.filter(e=>e.seq>after && e.seq<=until).slice(0,2).map(event=>({event})));
    }
    throw Error('Unexpected database request');
  }));
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
async function create() {const r=await call('/api/scrims','POST',{title:'Cloud test',format:'bo3'});expect(r.status).toBe(201);return r.body as {id:string;adminKey:string};}

describe('serverless HTTP API (mock Supabase REST)',()=>{
  it('health checks database access and reports missing configuration',async()=>{
    expect((await call('/api/health')).status).toBe(200);expect(dbCalls.length).toBe(1);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','');expect((await call('/api/health')).status).toBe(503);
  });
  it('creates, lists, reads and exports without exposing admin hash/key',async()=>{
    const {id,adminKey}=await create();const list=await call('/api/scrims');expect(list.body[0].id).toBe(id);
    const detail=await call(`/api/scrims/${id}`);expect(detail.body.events).toHaveLength(1);expect(detail.text).not.toContain(adminKey);expect(detail.text).not.toContain(createHash('sha256').update(adminKey).digest('hex'));
    const report=await call(`/api/scrims/${id}/report.md`);expect(report.status).toBe(200);expect(report.text).toContain('Cloud test');
    expect((await call('/api/index?route=scrims')).body[0].id).toBe(id);
  });
  it('verifies sessions and denies writes before calling RPC',async()=>{
    const {id,adminKey}=await create();
    expect((await call(`/api/scrims/${id}/session`,'POST',{adminKey})).body.role).toBe('admin');
    expect((await call(`/api/scrims/${id}/session`,'POST',{adminKey:'wrong'})).body.role).toBe('viewer');
    expect((await call(`/api/scrims/${id}/command`,'POST',{command:{type:'team.rename',team:'A',name:'Intruder'}})).status).toBe(403);
    expect(dbCalls.filter(c=>c.includes('append_scrim_event'))).toHaveLength(0);
  });
  it('commits authorized commands and surfaces optimistic conflicts without overwriting',async()=>{
    const {id,adminKey}=await create();const command={type:'team.rename',team:'A',name:'Team Cloud'};
    expect((await call(`/api/scrims/${id}/command`,'POST',{adminKey,command})).status).toBe(200);
    casConflict=true;expect((await call(`/api/scrims/${id}/command`,'POST',{adminKey,command:{...command,name:'Lost'}})).status).toBe(409);
    expect(rows.get(id)!.state.teams.A.name).toBe('Team Cloud');expect(rows.get(id)!.events).toHaveLength(2);
  });
  it('paginates complete ordered history despite database row caps',async()=>{
    const {id}=await create();const r=rows.get(id)!;
    for(let i=0;i<6;i++){const event:ScrimEvent={type:'note.add',text:`Note ${i}`,seq:r.version+1,at:i};r.state=applyEvent(r.state,event);r.version++;r.events.push(event);}
    const detail=await call(`/api/scrims/${id}`);expect(detail.body.events.map((e:ScrimEvent)=>e.seq)).toEqual([1,2,3,4,5,6,7]);expect(detail.body.state.version).toBe(7);
  });
  it('rejects malformed commands, invalid bodies, missing rooms and wrong methods',async()=>{
    const {id,adminKey}=await create();
    expect((await call(`/api/scrims/${id}/command`,'POST',{adminKey,command:{type:'scrim.create'}})).status).toBe(400);
    expect((await call('/api/scrims','POST',[])).status).toBe(400);
    expect((await call('/api/scrims/xxxxxx')).status).toBe(404);
    expect((await call(`/api/scrims/${id}/command`,'GET')).status).toBe(405);
    expect((await call('/api/scrims','POST',{title:'x'.repeat(17000),format:'bo3'})).status).toBe(413);
  });
  it('accepts Vercel pre-parsed request bodies',async()=>{
    const req=Object.assign({url:'/api/scrims',method:'POST',body:{title:'Parsed',format:'bo1'}});
    let status=0, body='';
    const res={writeHead:(s:number)=>{status=s;},end:(b:string)=>{body=b;}};
    await serve(req as http.IncomingMessage,res as unknown as http.ServerResponse);
    expect(status).toBe(201);expect(JSON.parse(body).adminKey).toBeTruthy();
  });
  it('protects import search and details before consulting the provider', async () => {
    const {id,adminKey}=await create();
    expect((await call(`/api/scrims/${id}/imports`,'POST',{action:'search',region:'br',riotId:'Test#TAG'})).status).toBe(403);
    expect(providerCalls).toBe(0);
    const result=await call(`/api/scrims/${id}/imports`,'POST',{adminKey,action:'search',region:'br',riotId:'Test#TAG'});
    expect(result.status).toBe(200); expect(result.body.matches[0].id).toBe(sampleMatch().id);
    expect(result.text).not.toContain('provider-test-key');
    lookupAllowed=false;
    expect((await call(`/api/scrims/${id}/imports`,'POST',{adminKey,action:'detail',region:'br',matchId:sampleMatch().id})).status).toBe(429);
    expect(providerCalls).toBe(1);
  });
  it('refetches authoritative match data on confirm and commits one import event', async () => {
    const {id,adminKey}=await create(); const row=rows.get(id)!; const ready=readyScrim().state;
    row.state={...ready,id};row.version=ready.version;
    const body={adminKey,action:'confirm',region:'br',matchId:sampleMatch().id,mapIndex:0,redTeam:'A',links:sampleLinks(),expectedVersion:row.version,match:{score:{Red:99}}};
    const result=await call(`/api/scrims/${id}/imports`,'POST',body);
    expect(result.status).toBe(200);expect(providerCalls).toBe(1);
    expect(result.body.state.maps[0].rounds).toHaveLength(15);
    expect(result.body.state.players[0].name).toBe('Apelido 0');
    expect(dbCalls.some(c=>c.includes('import_match_result'))).toBe(true);
    expect((await call(`/api/scrims/${id}/imports`,'POST',body)).status).toBe(409);
  });
  it('rejects forged import events through the generic command endpoint', async () => {
    const {id,adminKey}=await create();
    expect((await call(`/api/scrims/${id}/command`,'POST',{adminKey,command:{type:'match.import',match:sampleMatch()}})).status).toBe(400);
    expect(providerCalls).toBe(0);
  });

});
