import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { readyScrim, sampleLinks, sampleMatch, rawMatch } from '../test/import-fixture.js';
import serve from '../../api/index.js';
import { ADMIN_ACCESS_COOKIE, ADMIN_REFRESH_COOKIE } from './adminAuth.js';
import { noPermissions, presetPermissions, type AdminPermissionKey, type AdminPermissions } from '../shared/adminPermissions.js';
import { applyEvent, initialState, type ScrimEvent, type ScrimState } from '../shared/scrim.js';

type Row = { id: string; admin_key_hash: string; state: ScrimState; version: number; events: ScrimEvent[]; is_public: boolean; deleted_at: number | null; access_version: number; owner_user_id: string; created_by_user_id: string | null };
const rows = new Map<string, Row>();
let port: number;
let server: http.Server;
let casConflict = false;
let lookupAllowed = true;
let providerCalls = 0;
const dbCalls: string[] = [];
const authCalls: string[] = [];
const policyCalls: Record<string, unknown>[] = [];
const appendMutations: Record<string, unknown>[] = [];
const ownerMutations: Record<string, unknown>[] = [];
const ADMIN_TOKEN = `stub.${Buffer.from(JSON.stringify({ exp: 4102444800 })).toString('base64url')}.verified-admin`;
const VIEWER_TOKEN = `stub.${Buffer.from(JSON.stringify({ exp: 4102444800 })).toString('base64url')}.verified-viewer`;
const SUPER_TOKEN = 'stub.verified-super-admin';
const OTHER_TOKEN = 'stub.verified-other-admin';
const SUPER_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ID = '44444444-4444-4444-8444-444444444444';
const ADMIN_EMAIL = 'organizador@example.com';
const TEST_PASSWORD = 'test-password-not-real';
const REFRESH_TOKEN = 'refresh-test-private';
let adminEnabled = true;
let adminCanDelete = false;
let adminPermissions: AdminPermissions = presetPermissions('full');
let missingPolicyRpc = false;
let revokeBeforeAppend = false;
let resetBeforeAppend = false;
let adminSessionVersion = 0;
let transferBeforeAppend = false;
let accessConflict = false;
let missingAccessColumns = false;
let missingAccessRpc = false;
let deleteBeforeAppend = false;
const accessMutations: Record<string, unknown>[] = [];
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

function call(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}): Promise<{status: number; body: any; text: string; headers: http.IncomingHttpHeaders}> {
  return new Promise((resolve, reject) => {
    const req = http.request({hostname: '127.0.0.1', port, path, method, headers: {'content-type':'application/json', ...headers}}, (res) => {
      let text=''; res.on('data', (b) => text += b); res.on('end', () => {
        let parsed; try {parsed=JSON.parse(text);} catch {parsed=text;}
        resolve({status:res.statusCode!,body:parsed,text,headers:res.headers});
      });
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
/** Requests from an already signed-in Supabase administrator. No room key is used as authority. */
function adminCall(path: string, method = 'GET', body?: unknown) {
  return call(path, method, body, { cookie: `${ADMIN_ACCESS_COOKIE}=${encodeURIComponent(ADMIN_TOKEN)}` });
}
function superCall(path: string, method = 'GET', body?: unknown) {
  return call(path, method, body, { cookie: `${ADMIN_ACCESS_COOKIE}=${encodeURIComponent(SUPER_TOKEN)}` });
}
function otherCall(path: string, method = 'GET', body?: unknown) {
  return call(path, method, body, { cookie: `${ADMIN_ACCESS_COOKIE}=${encodeURIComponent(OTHER_TOKEN)}` });
}
function currentPermissions(): AdminPermissions { return { ...adminPermissions, deleteRooms: adminCanDelete }; }
function canActor(id: string, permission: AdminPermissionKey) {
  return id === SUPER_ID || id === OTHER_ID || (id === ADMIN_ID && adminEnabled && currentPermissions()[permission]);
}
const viewerCall = (path: string, method = 'GET', body?: unknown) => call(path, method, body);
beforeAll(async () => {
  server = http.createServer((req,res) => { void serve(req,res); });
  await new Promise<void>((resolve) => server.listen(0,'127.0.0.1',resolve));
  port=(server.address() as AddressInfo).port;
});
afterAll(async () => { await new Promise<void>((resolve,reject) => server.close((e) => e ? reject(e) : resolve())); });
beforeEach(() => {
  rows.clear(); policyCalls.length=0; appendMutations.length=0; ownerMutations.length=0; adminPermissions=presetPermissions('full'); missingPolicyRpc=false; revokeBeforeAppend=false; resetBeforeAppend=false; adminSessionVersion=0; transferBeforeAppend=false; dbCalls.length=0; authCalls.length=0; adminEnabled=true; adminCanDelete=false; accessConflict=false; missingAccessColumns=false; missingAccessRpc=false; deleteBeforeAppend=false; accessMutations.length=0; casConflict=false; lookupAllowed=true; providerCalls=0;
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
    expect(new Headers(options.headers).get('apikey')).toBe('server-test-key');
    if (u.pathname.startsWith('/auth/v1/')) {
      authCalls.push(u.pathname + u.search);
      const payload = options.body ? JSON.parse(String(options.body)) : {};
      const token = new Headers(options.headers).get('authorization')?.replace(/^Bearer /, '');
      const user = (isAdmin: boolean) => ({ id: isAdmin ? ADMIN_ID : '22222222-2222-4222-8222-222222222222', email: isAdmin ? ADMIN_EMAIL : 'espectador@example.com',
        email_confirmed_at: '2026-11-05T00:00:00Z', app_metadata: { scrim_admin: true, scrim_delete_rooms: true }, user_metadata: { scrim_admin: true, scrim_delete_rooms: true } });
      if (u.pathname.endsWith('/token')) {
        if (u.searchParams.get('grant_type') === 'password' && payload.password === TEST_PASSWORD && [ADMIN_EMAIL, 'espectador@example.com'].includes(payload.email)) {
          const isAdmin = payload.email === ADMIN_EMAIL;
          return new Response(JSON.stringify({ access_token: isAdmin ? ADMIN_TOKEN : VIEWER_TOKEN, refresh_token: REFRESH_TOKEN, expires_in: 3600, token_type: 'bearer', user: user(isAdmin) }));
        }
        if (u.searchParams.get('grant_type') === 'refresh_token' && payload.refresh_token === REFRESH_TOKEN) return new Response(JSON.stringify({ access_token: ADMIN_TOKEN, refresh_token: REFRESH_TOKEN, expires_in: 3600, token_type: 'bearer', user: user(true) }));
        return new Response(JSON.stringify({ message: 'Invalid login credentials' }), { status: 400 });
      }
      if (u.pathname.endsWith('/logout')) return new Response(null, { status: 204 });
      if (u.pathname.endsWith('/user')) {
        if (token === SUPER_TOKEN || token === OTHER_TOKEN) return new Response(JSON.stringify({ id: token === SUPER_TOKEN ? SUPER_ID : OTHER_ID, email: token === SUPER_TOKEN ? 'caio.oliveira2014@hotmail.com' : 'outro@example.com', email_confirmed_at: '2026-11-05T00:00:00Z' }));
        if (token === ADMIN_TOKEN || token === VIEWER_TOKEN) return new Response(JSON.stringify(user(token === ADMIN_TOKEN)));
        return new Response(JSON.stringify({ message: 'Invalid token' }), { status: 401 });
      }
      throw Error('Unexpected authentication request');
    }
    if (u.pathname.endsWith('/rpc/get_admin_access') || u.pathname.endsWith('/rpc/get_admin_login_policy')) {
      const payload = JSON.parse(String(options.body));
      policyCalls.push(payload);
      if (missingPolicyRpc) return new Response(JSON.stringify({code:'PGRST202',message:'RPC missing'}),{status:404});
      const userId = payload.p_user_id ?? (payload.p_email === ADMIN_EMAIL ? ADMIN_ID : payload.p_email === 'caio.oliveira2014@hotmail.com' ? SUPER_ID : null);
      if (![ADMIN_ID, SUPER_ID, OTHER_ID].includes(userId)) return new Response('null');
      return new Response(JSON.stringify({ user_id:userId, active:userId===ADMIN_ID ? adminEnabled : true,
        is_super_admin:userId===SUPER_ID, permissions:userId===ADMIN_ID ? currentPermissions() : presetPermissions('full'), version:1,session_version:userId===ADMIN_ID ? adminSessionVersion : 0, password_reset_pending:false }));
    }
    dbCalls.push(u.pathname+u.search);
    const payload=options.body ? JSON.parse(String(options.body)) : null;
    const ok=(body:unknown)=>new Response(body===null ? null : JSON.stringify(body),{status:body===null?204:200});
    if (u.pathname.endsWith('/scrims') && missingAccessColumns && u.searchParams.get('select')?.includes('is_public')) return new Response(JSON.stringify({ code: '42703', message: 'column is_public does not exist' }), { status: 400 });
    if (u.pathname.endsWith('/rpc/create_owned_scrim')) {
      if (missingAccessRpc) return new Response(JSON.stringify({ code: 'PGRST202', message: 'RPC missing' }), { status: 404 });
      rows.set(payload.p_id,{id:payload.p_id,admin_key_hash:payload.p_key_hash,state:payload.p_state,version:1,events:[payload.p_event],is_public:payload.p_is_public,deleted_at:null,access_version:1,owner_user_id:payload.p_actor_id,created_by_user_id:payload.p_actor_id});return ok(null);
    }
    if (u.pathname.endsWith('/rpc/manage_owned_scrim_access')) {
      if (missingAccessRpc) return new Response(JSON.stringify({ code: 'PGRST202', message: 'RPC missing' }), { status: 404 });
      accessMutations.push(payload);
      const row=rows.get(payload.p_id);
      const permission = ['delete','restore'].includes(payload.p_action) ? 'deleteRooms' : 'publishRooms';
      if (!canActor(payload.p_actor_id,permission) || (row && row.owner_user_id!==payload.p_actor_id && payload.p_actor_id!==SUPER_ID)) return new Response(JSON.stringify({ message:'ADMIN_FORBIDDEN' }), { status:403 });
      if (!row || accessConflict || row.access_version!==payload.p_expected_access_version ||
          (payload.p_action==='restore' ? row.deleted_at===null : row.deleted_at!==null)) return new Response(JSON.stringify({ message: 'STALE_OR_FORBIDDEN' }), { status: 400 });
      row.is_public=payload.p_action==='show';
      if (payload.p_action==='show') row.is_public=true;
      else if (payload.p_action==='hide') row.is_public=false;
      else if (payload.p_action==='delete') row.deleted_at=payload.p_at;
      else if (payload.p_action==='restore') row.deleted_at=null;
      else return new Response(JSON.stringify({ message: 'INVALID_ACCESS' }), { status: 400 });
      row.access_version++;
      return ok([{ is_public:row.is_public,deleted_at:row.deleted_at,access_version:row.access_version }]);
    }
    if (u.pathname.endsWith('/rpc/transfer_scrim_owner')) {
      if (missingAccessRpc) return new Response(JSON.stringify({code:'PGRST202',message:'RPC missing'}),{status:404});
      ownerMutations.push(payload);
      const row=rows.get(payload.p_id);
      if (payload.p_actor_id!==SUPER_ID) return new Response(JSON.stringify({message:'ADMIN_FORBIDDEN'}),{status:403});
      if (![ADMIN_ID,OTHER_ID,SUPER_ID].includes(payload.p_owner_id)) return new Response(JSON.stringify({message:'ADMIN_NOT_FOUND'}),{status:404});
      if (row?.deleted_at!==null) return new Response(JSON.stringify({message:'SCRIM_DELETED'}),{status:400});
      if (!row || accessConflict || row.access_version!==payload.p_expected_access_version) return new Response(JSON.stringify({message:'STALE_OR_FORBIDDEN'}),{status:400});
      row.owner_user_id=payload.p_owner_id;row.access_version++;
      return ok([{is_public:row.is_public,deleted_at:row.deleted_at,access_version:row.access_version}]);
    }
    if (u.pathname.endsWith('/rpc/list_admin_accounts')) return ok({accounts:[],total:0,nextOffset:null});
    if (u.pathname.endsWith('/rpc/claim_match_lookup')) return ok(lookupAllowed);
    if (u.pathname.endsWith('/rpc/append_owned_scrim_event') || u.pathname.endsWith('/rpc/import_owned_match')) {
      appendMutations.push(payload);
      const r=rows.get(payload.p_id)!;
      if(revokeBeforeAppend) adminEnabled=false;
      if(resetBeforeAppend) adminSessionVersion++;
      if(transferBeforeAppend) {r.owner_user_id=OTHER_ID;r.access_version++;}
      const required = u.pathname.endsWith('/import_owned_match') ? ['importMatches'] : payload.p_required_permissions;
      if (payload.p_actor_session_version !== (payload.p_actor_id===ADMIN_ID ? adminSessionVersion : 0)) return new Response(JSON.stringify({message:'ADMIN_FORBIDDEN'}),{status:403});
      if (!Array.isArray(required) || required.some((key:AdminPermissionKey)=>!canActor(payload.p_actor_id,key)) || (r.owner_user_id!==payload.p_actor_id && payload.p_actor_id!==SUPER_ID)) return new Response(JSON.stringify({message:'ADMIN_FORBIDDEN'}),{status:403});
      if(deleteBeforeAppend) r.deleted_at=Date.now();
      if(r.deleted_at!==null) return new Response(JSON.stringify({message:'SCRIM_DELETED'}),{status:400});
      if(casConflict || r.version!==payload.p_expected_version || r.access_version!==payload.p_expected_access_version) return new Response(JSON.stringify({message:'STALE_OR_FORBIDDEN'}),{status:400});
      r.state=payload.p_state;r.version++;r.events.push(payload.p_event);return ok(null);
    }
    const id=u.searchParams.get('id')?.slice(3) ?? u.searchParams.get('scrim_id')?.slice(3);
    if(u.pathname.endsWith('/scrims')) {
      let result = id ? (rows.has(id)?[rows.get(id)!]:[]) : [...rows.values()];
      if (u.searchParams.get('owner_user_id')) result=result.filter(row=>row.owner_user_id===u.searchParams.get('owner_user_id')!.slice(3));
      if (u.searchParams.get('is_public')==='eq.true') result=result.filter(row=>row.is_public);
      if (u.searchParams.get('deleted_at')==='is.null') result=result.filter(row=>row.deleted_at===null);
      if (u.searchParams.get('deleted_at')==='not.is.null') result=result.filter(row=>row.deleted_at!==null);
      return ok(result.slice(0,Number(u.searchParams.get('limit')??result.length)));
    }
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
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
async function create(isPublic = true) {
 const r=await adminCall('/api/scrims','POST',{title:'Cloud test',format:'bo3',isPublic});
 expect(r.status).toBe(201);expect(Object.keys(r.body)).toEqual(['id']);
 return { id: r.body.id as string };
}

function addPlayers(id: string, count = 10) {
  const row = rows.get(id)!;
  for (let i = 0; i < count; i++) {
    const event: ScrimEvent = { type: 'player.add', playerId: `player-${i}`, name: `Player ${i}`, seq: row.version + 1, at: Date.now() };
    row.state = applyEvent(row.state, event); row.version++; row.events.push(event);
  }
}

function controlledClock() {
  let now = 1800000000000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  return { advance: (ms: number) => { now += ms; }, now: () => now };
}

describe('serverless HTTP API (mock Supabase REST)',()=>{
  it('health checks database access and reports missing configuration',async()=>{
    expect((await adminCall('/api/health')).status).toBe(200);expect(dbCalls.length).toBe(1);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','');expect((await adminCall('/api/health')).status).toBe(503);
  });
  it('creates, lists, reads and exports without exposing admin hash/key',async()=>{
    const { id }=await create();const list=await adminCall('/api/scrims');expect(list.body[0].id).toBe(id);
    const detail=await adminCall(`/api/scrims/${id}`);expect(detail.body.events).toHaveLength(1);expect(detail.text).not.toContain(rows.get(id)!.admin_key_hash);
    const report=await adminCall(`/api/scrims/${id}/report.md`);expect(report.status).toBe(200);expect(report.text).toContain('Cloud test');
    expect((await adminCall('/api/index?route=scrims')).body[0].id).toBe(id);
  });
  it('verifies sessions and denies writes before calling RPC',async()=>{
    const { id }=await create();
    expect((await adminCall(`/api/scrims/${id}/session`,'POST',{})).body.role).toBe('admin');
    expect((await viewerCall(`/api/scrims/${id}/session`,'POST',{adminKey:'wrong'})).body.role).toBe('viewer');
    expect((await viewerCall(`/api/scrims/${id}/command`,'POST',{command:{type:'team.rename',team:'A',name:'Intruder'}})).status).toBe(403);
    expect(dbCalls.filter(c=>c.includes('append_owned_scrim_event'))).toHaveLength(0);
  });
  it('commits authorized commands and surfaces optimistic conflicts without overwriting',async()=>{
    const { id }=await create();const command={type:'team.rename',team:'A',name:'Team Cloud'};
    expect((await adminCall(`/api/scrims/${id}/command`,'POST',{command})).status).toBe(200);
    casConflict=true;expect((await adminCall(`/api/scrims/${id}/command`,'POST',{command:{...command,name:'Lost'}})).status).toBe(409);
    expect(rows.get(id)!.state.teams.A.name).toBe('Team Cloud');expect(rows.get(id)!.events).toHaveLength(2);
  });
  it('paginates complete ordered history despite database row caps',async()=>{
    const {id}=await create();const r=rows.get(id)!;
    for(let i=0;i<6;i++){const event:ScrimEvent={type:'note.add',text:`Note ${i}`,seq:r.version+1,at:i};r.state=applyEvent(r.state,event);r.version++;r.events.push(event);}
    const detail=await adminCall(`/api/scrims/${id}`);expect(detail.body.events.map((e:ScrimEvent)=>e.seq)).toEqual([1,2,3,4,5,6,7]);expect(detail.body.state.version).toBe(7);
  });
  it('rejects malformed commands, invalid bodies, missing rooms and wrong methods',async()=>{
    const { id }=await create();
    expect((await adminCall(`/api/scrims/${id}/command`,'POST',{command:{type:'scrim.create'}})).status).toBe(400);
    expect((await adminCall('/api/scrims','POST',[])).status).toBe(400);
    expect((await adminCall('/api/scrims/xxxxxx')).status).toBe(404);
    expect((await adminCall(`/api/scrims/${id}/command`,'GET')).status).toBe(405);
    expect((await adminCall('/api/scrims','POST',{title:'x'.repeat(17000),format:'bo3'})).status).toBe(413);
  });
  it('accepts Vercel pre-parsed request bodies',async()=>{
    const req=Object.assign({url:'/api/scrims',method:'POST',headers:{host:'127.0.0.1',cookie:`${ADMIN_ACCESS_COOKIE}=${encodeURIComponent(ADMIN_TOKEN)}`},body:{title:'Parsed',format:'bo1'}});
    let status=0, body='';
    const res={getHeader:()=>undefined,setHeader:()=>{},writeHead:(s:number)=>{status=s;},end:(b:string)=>{body=b;}};
    await serve(req as http.IncomingMessage,res as unknown as http.ServerResponse);
    expect(status).toBe(201);expect(Object.keys(JSON.parse(body))).toEqual(['id']);
  });
  it('protects import search and details before consulting the provider', async () => {
    const { id }=await create();
    expect((await viewerCall(`/api/scrims/${id}/imports`,'POST',{action:'search',region:'br',riotId:'Test#TAG'})).status).toBe(403);
    expect(providerCalls).toBe(0);
    const result=await adminCall(`/api/scrims/${id}/imports`,'POST',{action:'search',region:'br',riotId:'Test#TAG'});
    expect(result.status).toBe(200); expect(result.body.matches[0].id).toBe(sampleMatch().id);
    expect(result.text).not.toContain('provider-test-key');
    lookupAllowed=false;
    expect((await adminCall(`/api/scrims/${id}/imports`,'POST',{action:'detail',region:'br',matchId:sampleMatch().id})).status).toBe(429);
    expect(providerCalls).toBe(1);
  });
  it('refetches authoritative match data on confirm and commits one import event', async () => {
    const { id }=await create(); const row=rows.get(id)!; const ready=readyScrim().state;
    row.state={...ready,id};row.version=ready.version;
    const body={action:'confirm',region:'br',matchId:sampleMatch().id,mapIndex:0,redTeam:'A',links:sampleLinks(),expectedVersion:row.version,match:{score:{Red:99}}};
    const result=await adminCall(`/api/scrims/${id}/imports`,'POST',body);
    expect(result.status).toBe(200);expect(providerCalls).toBe(1);
    expect(result.body.state.maps[0].rounds).toHaveLength(15);
    expect(result.body.state.players[0].name).toBe('Apelido 0');
    expect(dbCalls.some(c=>c.includes('import_owned_match'))).toBe(true);
    expect((await adminCall(`/api/scrims/${id}/imports`,'POST',body)).status).toBe(409);
  });
  it('rejects forged import events through the generic command endpoint', async () => {
    const { id }=await create();
    expect((await adminCall(`/api/scrims/${id}/command`,'POST',{command:{type:'match.import',match:sampleMatch()}})).status).toBe(400);
    expect(providerCalls).toBe(0);
  });

});

describe('authenticated room attention and draws', () => {
  it('denies every tool to spectators before attempting a write', async () => {
    const { id } = await create();
    for (const body of [
      { action: 'focus', target: { tab: 'teams', area: 'players' } },
      { action: 'draw.start', kind: 'coin', purpose: 'Quem começa?', requestId: 'attempt-1' },
      { action: 'draw.accept', drawId: 'attempt-1' },
      { action: 'draw.reject', drawId: 'attempt-1' },
    ]) expect((await viewerCall(`/api/scrims/${id}/tools`, 'POST', body)).status).toBe(403);
    expect(dbCalls.filter(path => path.includes('append_owned_scrim_event'))).toHaveLength(0);
  });

  it('persists only known focus targets, server-generated identity and expiry', async () => {
    const clock = controlledClock();
    const { id } = await create();
    const result = await adminCall(`/api/index?route=scrims/${id}/tools`, 'POST', {
      action: 'focus', target: { tab: 'teams', area: 'team-A' },
    });
    expect(result.status).toBe(200);
    expect(result.body.event).toMatchObject({ type: 'room.focus', at: clock.now(), focus: {
      target: { tab: 'teams', area: 'team-A' }, requestedAt: clock.now(), expiresAt: clock.now() + 10000,
    } });
    expect(result.body.event.focus.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.body.serverNow).toBe(clock.now());
    expect((await adminCall(`/api/scrims/${id}`)).body.serverNow).toBe(clock.now());
    for (const target of [
      { tab: 'teams', area: 'input[name=adminKey]' },
      { tab: 'settings', area: 'overview' },
      { tab: 'teams', area: 'players', mapIndex: 0 },
      { tab: 'match', area: 'stats', mapIndex: 99 },
    ]) expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { action: 'focus', target })).status).toBe(400);
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { action: 'focus', target: { tab: 'teams', area: 'overview' }, expiresAt: Infinity })).status).toBe(400);
    expect(rows.get(id)!.events.filter(event => event.type === 'room.focus')).toHaveLength(1);
  });

  it('chooses two distinct captains from the general list and applies both only after acceptance', async () => {
    const clock = controlledClock();
    const { id } = await create(); addPlayers(id);
    const initial = structuredClone(rows.get(id)!.state);
    const result = await adminCall(`/api/scrims/${id}/tools`, 'POST', {
      action: 'draw.start', kind: 'captains', purpose: 'Capitães para montar os times', requestId: 'captains-1',
    });
    expect(result.status).toBe(200);
    const draw = result.body.state.draws[0];
    expect(draw.kind).toBe('captains');
    expect(draw.candidates).toEqual(initial.players.map(({ id, name }) => ({ id, name })));
    expect(draw.result.A).not.toBe(draw.result.B);
    expect(initial.players.some(player => player.id === draw.result.A)).toBe(true);
    expect(initial.players.some(player => player.id === draw.result.B)).toBe(true);
    expect(draw.startedAt).toBe(clock.now()); expect(draw.revealAt).toBe(clock.now() + 4000); expect(draw.expiresAt).toBe(clock.now() + 120000);
    expect(result.body.state.players).toEqual(initial.players);
    expect(result.body.state.teams).toEqual(initial.teams);
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { action: 'draw.accept', drawId: draw.id })).status).toBe(409);
    clock.advance(4000);
    const accepted = await adminCall(`/api/scrims/${id}/tools`, 'POST', { action: 'draw.accept', drawId: draw.id });
    expect(accepted.status).toBe(200);
    expect(accepted.body.state.teams.A.captainId).toBe(draw.result.A); expect(accepted.body.state.teams.B.captainId).toBe(draw.result.B);
    expect(accepted.body.state.players.filter((player: any) => player.team === 'A').map((player: any) => player.id)).toEqual([draw.result.A]);
    expect(accepted.body.state.players.filter((player: any) => player.team === 'B').map((player: any) => player.id)).toEqual([draw.result.B]);
    expect(accepted.body.state.players.filter((player: any) => player.team === null)).toHaveLength(8);
    expect(accepted.body.state.draws[0].status).toBe('accepted');
    expect(rows.get(id)!.events.at(-1)!.type).toBe('draw.accept');
  });

  it('requires a defined purpose and rejects browser-supplied outcomes or clocks', async () => {
    const { id } = await create(); addPlayers(id);
    const base = { action: 'draw.start', kind: 'coin', purpose: 'Quem escolhe o lado?', requestId: 'coin-1' };
    for (const extra of [{ result: 'heads' }, { candidates: [] }, { startedAt: 1 }, { revealAt: 2 }, { expectedVersion: 1 }]) {
      expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { ...base, ...extra })).status).toBe(400);
    }
    for (const purpose of ['', '   ', 'x'.repeat(161), 'a\u0000b']) {
      expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { ...base, purpose })).status).toBe(400);
    }
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { ...base, requestId: '../other' })).status).toBe(400);
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { ...base, kind: 'dice' })).status).toBe(400);
    expect(rows.get(id)!.state.draws).toBeUndefined();
    const started = await adminCall(`/api/scrims/${id}/tools`, 'POST', { ...base, purpose: '  Quem escolhe o lado?  ' });
    expect(started.status).toBe(200); expect(started.body.state.draws[0].purpose).toBe('Quem escolhe o lado?');
    expect(['heads', 'tails']).toContain(started.body.state.draws[0].result);
  });

  it('does not reroll a retried request, including after it is resolved', async () => {
    const clock = controlledClock();
    const { id } = await create();
    const body = { action: 'draw.start', kind: 'coin', purpose: 'Quem começa o veto?', requestId: 'retry-1' };
    const started = await adminCall(`/api/scrims/${id}/tools`, 'POST', body);
    const duplicate = await adminCall(`/api/scrims/${id}/tools`, 'POST', body);
    expect(started.status).toBe(200); expect(duplicate.status).toBe(200);
    expect(duplicate.body.draw).toEqual(started.body.state.draws[0]);
    expect(duplicate.body.event).toBeUndefined();
    expect(dbCalls.filter(path => path.includes('append_owned_scrim_event'))).toHaveLength(1);
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { ...body, purpose: 'Outra coisa' })).status).toBe(409);
    clock.advance(4000);
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { action: 'draw.accept', drawId: body.requestId })).status).toBe(200);
    const lateDuplicate = await adminCall(`/api/scrims/${id}/tools`, 'POST', body);
    expect(lateDuplicate.status).toBe(200); expect(lateDuplicate.body.draw.status).toBe('accepted');
    expect(rows.get(id)!.state.draws).toHaveLength(1);
    expect(dbCalls.filter(path => path.includes('append_owned_scrim_event'))).toHaveLength(2);
  });

  it('pauses edits, imports, focus and other draws until the active attempt is resolved', async () => {
    const { id } = await create();
    const body = { action: 'draw.start', kind: 'coin', purpose: 'Decidir quem começa', requestId: 'pause-1' };
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', body)).status).toBe(200);
    expect((await adminCall(`/api/scrims/${id}/command`, 'POST', { command: { type: 'team.rename', team: 'A', name: 'Blocked' } })).status).toBe(409);
    expect((await adminCall(`/api/scrims/${id}/imports`, 'POST', { action: 'confirm', region: 'br' })).status).toBe(409);
    expect(providerCalls).toBe(0);
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { action: 'focus', target: { tab: 'teams', area: 'players' } })).status).toBe(409);
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { ...body, requestId: 'pause-2' })).status).toBe(409);
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { action: 'draw.reject', drawId: body.requestId })).status).toBe(200);
    expect((await adminCall(`/api/scrims/${id}/command`, 'POST', { command: { type: 'team.rename', team: 'A', name: 'Allowed' } })).status).toBe(200);
  });

  it('records discarded attempts while preserving the existing lineup and captains', async () => {
    const { id } = await create(); addPlayers(id, 4);
    const row = rows.get(id)!;
    for (const command of [
      { type: 'player.assign', playerId: 'player-0', team: 'A' },
      { type: 'team.captain', playerId: 'player-0', team: 'A' },
    ] as const) {
      const event = { ...command, seq: row.version + 1, at: Date.now() };
      row.state = applyEvent(row.state, event); row.version++; row.events.push(event);
    }
    const before = structuredClone(row.state);
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { action: 'draw.start', kind: 'captains', purpose: 'Novos capitães', requestId: 'reject-1' })).status).toBe(200);
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { action: 'draw.reject', drawId: 'old-draw' })).status).toBe(409);
    const rejected = await adminCall(`/api/scrims/${id}/tools`, 'POST', { action: 'draw.reject', drawId: 'reject-1' });
    expect(rejected.status).toBe(200); expect(rejected.body.state.draws[0].status).toBe('rejected');
    expect(rejected.body.state.players).toEqual(before.players); expect(rejected.body.state.teams).toEqual(before.teams);
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { action: 'draw.reject', drawId: 'reject-1' })).status).toBe(409);
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { action: 'draw.start', kind: 'captains', purpose: 'Nova tentativa', requestId: 'reject-2' })).status).toBe(200);
    expect(row.state.draws).toHaveLength(2);
  });

  it('expires abandoned attempts without accepting them or keeping the room locked', async () => {
    const clock = controlledClock();
    const { id } = await create();
    const body = { action: 'draw.start', kind: 'coin', purpose: 'Quem começa?', requestId: 'expired-1' };
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', body)).status).toBe(200);
    clock.advance(120000);
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { action: 'draw.accept', drawId: body.requestId })).status).toBe(409);
    expect((await adminCall(`/api/scrims/${id}/command`, 'POST', { command: { type: 'note.add', text: 'Sala liberada' } })).status).toBe(200);
    expect(rows.get(id)!.state.draws![0]!.status).toBe('pending');
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { ...body, requestId: 'expired-2' })).status).toBe(200);
  });

  it('prevents forging server-owned events through generic commands', async () => {
    const { id } = await create();
    for (const type of ['room.focus', 'draw.start', 'draw.accept', 'draw.reject', 'draw.unknown']) {
      expect((await adminCall(`/api/scrims/${id}/command`, 'POST', { command: { type, draw: { result: 'heads' } } })).status).toBe(400);
    }
    expect(dbCalls.filter(path => path.includes('append_owned_scrim_event'))).toHaveLength(0);
  });

  it('keeps start and resolution atomic under CAS conflicts', async () => {
    const clock = controlledClock();
    const { id } = await create(); addPlayers(id, 4);
    const body = { action: 'draw.start', kind: 'captains', purpose: 'Capitães', requestId: 'conflict-1' };
    const version = rows.get(id)!.version;
    casConflict = true;
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', body)).status).toBe(409);
    expect(rows.get(id)!.version).toBe(version); expect(rows.get(id)!.state.draws).toBeUndefined();
    casConflict = false;
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', body)).status).toBe(200);
    clock.advance(4000); casConflict = true;
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { action: 'draw.accept', drawId: body.requestId })).status).toBe(409);
    expect(rows.get(id)!.state.teams.A.captainId).toBeNull(); expect(rows.get(id)!.state.teams.B.captainId).toBeNull();
    expect(rows.get(id)!.state.draws![0]!.status).toBe('pending');
  });

  it('allows only one of two simultaneous attempts to commit', async () => {
    const { id } = await create(); addPlayers(id);
    const results = await Promise.all(['simultaneous-A', 'simultaneous-B'].map(requestId => adminCall(`/api/scrims/${id}/tools`, 'POST', {
      action: 'draw.start', kind: 'captains', purpose: 'Capitães', requestId,
    })));
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect(rows.get(id)!.state.draws).toHaveLength(1);
    expect(rows.get(id)!.events.filter(event => event.type === 'draw.start')).toHaveLength(1);
  });

  it('rejects captain attempts without two players or after setup, but permits independent coin tosses', async () => {
    const { id } = await create(); addPlayers(id, 1);
    const body = { action: 'draw.start', kind: 'captains', purpose: 'Capitães', requestId: 'invalid-1' };
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', body)).status).toBe(400);
    const row = rows.get(id)!; row.state = { ...readyScrim().state, id }; row.version = row.state.version;
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', body)).status).toBe(400);
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { ...body, kind: 'coin' })).status).toBe(200);
    expect((await adminCall(`/api/scrims/${id}/tools`, 'GET')).status).toBe(405);
  });
});

describe('administrator account HTTP access', () => {
  it('keeps public spectating open but requires account login to create a room', async () => {
    const { id } = await create();
    const writes = dbCalls.filter(path => path.includes('/rpc/')).length;
    expect((await viewerCall('/api/scrims')).status).toBe(200);
    expect((await viewerCall(`/api/scrims/${id}`)).body.state.id).toBe(id);
    expect((await viewerCall(`/api/scrims/${id}/report.md`)).status).toBe(200);
    expect((await viewerCall('/api/scrims', 'POST', { title: 'Not allowed', format: 'bo3' })).status).toBe(403);
    expect(dbCalls.filter(path => path.includes('/rpc/'))).toHaveLength(writes);
    expect((await viewerCall('/api/admin/session')).body).toEqual({ authenticated: false, isSuperAdmin: false, permissions: { ...noPermissions(), canDeleteRooms: false } });
  });

  it('logs in through Supabase, returns no tokens and uses its HttpOnly session to create and edit rooms', async () => {
    const result = await viewerCall('/api/admin/login', 'POST', { email: ADMIN_EMAIL, password: TEST_PASSWORD });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ authenticated: true, user: { email: ADMIN_EMAIL }, isSuperAdmin: false, permissions: { ...currentPermissions(), canDeleteRooms: false } });
    for (const secret of [TEST_PASSWORD, ADMIN_TOKEN, REFRESH_TOKEN, 'server-test-key']) expect(result.text).not.toContain(secret);
    const cookies = result.headers['set-cookie'] ?? [];
    expect(cookies.some(cookie => cookie.startsWith(`${ADMIN_ACCESS_COOKIE}=`))).toBe(true);
    expect(cookies.some(cookie => cookie.startsWith(`${ADMIN_REFRESH_COOKIE}=`))).toBe(true);
    expect(cookies.every(cookie => /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie))).toBe(true);
    const cookie = cookies.map(value => value.split(';')[0]).join('; ');
    const session = await call('/api/admin/session', 'GET', undefined, { cookie });
    expect(session.body).toEqual({ authenticated: true, user: { email: ADMIN_EMAIL }, isSuperAdmin: false, permissions: { ...currentPermissions(), canDeleteRooms: false } });
    const created = await call('/api/scrims', 'POST', { title: 'Account room', format: 'bo1' }, { cookie });
    expect(created.status).toBe(201);expect(Object.keys(created.body)).toEqual(['id']);
    expect((await call(`/api/scrims/${created.body.id}/command`, 'POST', { command: { type: 'team.rename', team: 'A', name: 'Account admins' } }, { cookie })).status).toBe(200);
    expect(authCalls).toContain('/auth/v1/token?grant_type=password');
    expect(authCalls).toContain('/auth/v1/user');
    const logout = await call('/api/admin/logout', 'POST', undefined, { cookie });
    expect(logout.body).toEqual({ authenticated: false, isSuperAdmin: false, permissions: { ...noPermissions(), canDeleteRooms: false } });
    expect(logout.headers['set-cookie']?.every(value => /Max-Age=0/i.test(value))).toBe(true);
    expect(authCalls.some(path => path.startsWith('/auth/v1/logout'))).toBe(true);
  });

  it('denies incorrect credentials and accounts with only self-editable administrator metadata', async () => {
    const invalid = await viewerCall('/api/admin/login', 'POST', { email: ADMIN_EMAIL, password: 'wrong-password' });
    expect(invalid.status).toBe(401);expect(invalid.text).not.toContain('wrong-password');
    const viewer = await viewerCall('/api/admin/login', 'POST', { email: 'espectador@example.com', password: TEST_PASSWORD });
    expect(viewer.status).toBe(401);
    expect(viewer.text).not.toContain(VIEWER_TOKEN);
    expect(viewer.headers['set-cookie']?.every(cookie => /Max-Age=0/i.test(cookie)) ?? true).toBe(true);
    const forged = await call('/api/scrims', 'POST', { title: 'Forged', format: 'bo3' }, { cookie: `${ADMIN_ACCESS_COOKIE}=${VIEWER_TOKEN}` });
    expect(forged.status).toBe(403);expect(rows.size).toBe(0);
  });

  it('does not let a valid retired room key replace an administrator account', async () => {
    const { id } = await create();
    const adminKey = 'retired-private-room-key';
    rows.get(id)!.admin_key_hash = createHash('sha256').update(adminKey).digest('hex');
    expect((await viewerCall(`/api/scrims/${id}/session`, 'POST', { adminKey })).body.role).toBe('viewer');
    expect((await viewerCall(`/api/scrims/${id}/command`, 'POST', { adminKey, command: { type: 'note.add', text: 'No account' } })).status).toBe(403);
    expect((await viewerCall(`/api/scrims/${id}/tools`, 'POST', { adminKey, action: 'focus', target: { tab: 'teams', area: 'overview' } })).status).toBe(403);
    expect((await viewerCall(`/api/scrims/${id}/imports`, 'POST', { adminKey, action: 'search', region: 'br', riotId: 'Test#TAG' })).status).toBe(403);
    expect(providerCalls).toBe(0);
    expect((await adminCall(`/api/scrims/${id}/command`, 'POST', { command: { type: 'note.add', text: 'Account allowed' } })).status).toBe(200);
    expect(rows.get(id)!.state.notes.at(-1)?.text).toBe('Account allowed');
  });

  it('revokes editing on the next request when the canonical account is suspended despite legacy administrator metadata', async () => {
    const { id } = await create();
    expect((await adminCall(`/api/scrims/${id}/command`, 'POST', { command: { type: 'note.add', text: 'Before revoke' } })).status).toBe(200);
    const version = rows.get(id)!.version;
    adminEnabled = false;
    expect((await adminCall(`/api/scrims/${id}/command`, 'POST', { command: { type: 'note.add', text: 'After revoke' } })).status).toBe(403);
    expect((await adminCall('/api/admin/session')).body.authenticated).toBe(false);
    expect(rows.get(id)!.version).toBe(version);
  });

  it('rejects cross-origin login, logout and cookie-authorized edits', async () => {
    const { id } = await create();
    const headers = { cookie: `${ADMIN_ACCESS_COOKIE}=${ADMIN_TOKEN}`, origin: 'https://untrusted.example' };
    expect((await call('/api/admin/login', 'POST', { email: ADMIN_EMAIL, password: TEST_PASSWORD }, headers)).status).toBe(403);
    expect((await call('/api/admin/logout', 'POST', undefined, headers)).status).toBe(403);
    expect((await call(`/api/scrims/${id}/command`, 'POST', { command: { type: 'note.add', text: 'Cross origin' } }, headers)).status).toBe(403);
    expect(dbCalls.filter(path => path.includes('append_owned_scrim_event'))).toHaveLength(0);
  });

  it('handles admin route rewrites and rejects unrecognized login fields and methods', async () => {
    expect((await adminCall('/api/index?route=admin/session')).body.authenticated).toBe(true);
    expect((await viewerCall('/api/admin/login', 'GET')).status).toBe(405);
    expect((await viewerCall('/api/admin/session', 'POST')).status).toBe(405);
    expect((await viewerCall('/api/admin/logout', 'GET')).status).toBe(405);
    expect((await viewerCall('/api/admin/login', 'POST', { email: ADMIN_EMAIL, password: TEST_PASSWORD, role: 'admin' })).status).toBe(400);
  });
});

describe('room visibility and reversible removal', () => {
  it('creates hidden rooms by default and validates explicit initial visibility atomically', async () => {
    const created = await adminCall('/api/scrims', 'POST', { title: 'Internal room', format: 'bo3' });
    expect(created.status).toBe(201);
    const row = rows.get(created.body.id)!;
    expect(row.is_public).toBe(false);expect(row.deleted_at).toBeNull();expect(row.access_version).toBe(1);
    expect(row.state).not.toHaveProperty('isPublic');expect(row.events).toHaveLength(1);
    expect(dbCalls.some(path => path.endsWith('/rpc/create_owned_scrim'))).toBe(true);
    expect((await viewerCall('/api/scrims')).body).toEqual([]);
    for (const isPublic of ['true', 1, null]) expect((await adminCall('/api/scrims', 'POST', { title: 'Invalid', format: 'bo3', isPublic })).status).toBe(400);
    expect(rows.size).toBe(1);
    const publicRoom = await create(true);
    expect((await viewerCall('/api/scrims')).body.map((room: any) => room.id)).toEqual([publicRoom.id]);
  });

  it('filters public rooms in SQL before the limit without consulting account credentials', async () => {
    const { id } = await create(true);
    const source = rows.get(id)!;
    for (let index = 0; index < 510; index++) rows.set(`hidden${index}`, { ...source, id: `hidden${index}`, is_public: false, state: { ...source.state, id: `hidden${index}` } });
    rows.set('deletedroom', { ...source, id: 'deletedroom', deleted_at: Date.now(), state: { ...source.state, id: 'deletedroom' } });
    authCalls.length = 0;
    const result = await adminCall('/api/scrims?deleted=true');
    expect(result.body.map((room: any) => room.id)).toEqual([id]);
    expect(authCalls).toHaveLength(0);
    expect(result.headers['set-cookie']).toBeUndefined();
    const expired = await call('/api/scrims', 'GET', undefined, {
      cookie: `_vercel_jwt=synthetic-preview-access; ${ADMIN_ACCESS_COOKIE}=expired; ${ADMIN_REFRESH_COOKIE}=${REFRESH_TOKEN}`,
    });
    expect(expired.status).toBe(200);
    expect(expired.body.map((room: any) => room.id)).toEqual([id]);
    expect(authCalls).toHaveLength(0);
    expect(expired.headers['set-cookie']).toBeUndefined();
    const query = new URL(dbCalls.at(-1)!, 'https://test.supabase.co');
    expect(query.searchParams.get('is_public')).toBe('eq.true');expect(query.searchParams.get('deleted_at')).toBe('is.null');expect(query.searchParams.get('limit')).toBe('500');
    expect(result.body[0]).not.toHaveProperty('access');
  });

  it('lets administrators list active hidden rooms while protecting the administrative and deleted scopes', async () => {
    const visible = await create(true), hidden = await create(false);
    expect((await viewerCall('/api/scrims?scope=admin')).status).toBe(403);
    const list = await adminCall('/api/scrims?scope=admin');
    expect(list.status).toBe(200);
    expect(list.body.find((room: any) => room.id === hidden.id).access).toEqual({ isPublic: false, deletedAt: null, accessVersion: 1 });
    expect(list.body.find((room: any) => room.id === visible.id).access.isPublic).toBe(true);
    expect((await adminCall('/api/scrims?scope=admin&deleted=true')).status).toBe(403);
    adminCanDelete = true;
    expect((await adminCall('/api/scrims?scope=admin&deleted=true')).body).toEqual([]);
  });

  it('does not expose private titles or history through any public room-read route', async () => {
    const { id } = await create(false);
    rows.get(id)!.state.title = 'Confidential title';
    for (const [path, method] of [
      [`/api/scrims/${id}`, 'GET'], [`/api/scrims/${id}/report.md`, 'GET'],
      [`/api/scrims/${id}/access`, 'GET'], [`/api/scrims/${id}/session`, 'POST'],
    ]) {
      const result = await viewerCall(path!, method!);
      expect(result.status).toBe(404);expect(result.body).toEqual({ error: 'Scrim não encontrada.' });expect(result.text).not.toContain('Confidential');
    }
    const snapshot = await adminCall(`/api/scrims/${id}`);
    expect(snapshot.body.access).toEqual({ isPublic: false, deletedAt: null, accessVersion: 1 });expect(snapshot.body.events).toHaveLength(1);
    expect((await adminCall(`/api/scrims/${id}/report.md`)).status).toBe(200);
    expect((await adminCall(`/api/scrims/${id}/session`, 'POST')).body).toMatchObject({ role: 'admin', access: snapshot.body.access });
  });

  it('serves lightweight access polling without state, history or duplicate authentication', async () => {
    const { id } = await create(true);
    dbCalls.length = 0;authCalls.length = 0;
    const result = await adminCall(`/api/index?route=scrims/${id}/access`);
    expect(result.status).toBe(200);expect(result.body).toMatchObject({ role: 'admin', access: { isPublic: true, deletedAt: null, accessVersion: 1 } });
    expect(result.body.serverNow).toEqual(expect.any(Number));expect(result.body).not.toHaveProperty('state');expect(result.body).not.toHaveProperty('events');
    expect(dbCalls).toHaveLength(1);
    expect(new URL(dbCalls[0]!, 'https://test.supabase.co').searchParams.get('select')).toBe('id,is_public,deleted_at,access_version,owner_user_id,created_by_user_id');
    expect(authCalls.filter(path => path === '/auth/v1/user')).toHaveLength(1);
    authCalls.length = 0;
    expect((await adminCall(`/api/scrims/${id}/command`, 'POST', { command: { type: 'note.add', text: 'One authorization' } })).status).toBe(200);
    expect(authCalls.filter(path => path === '/auth/v1/user')).toHaveLength(1);
  });

  it('changes visibility with an independent CAS version and no gameplay events', async () => {
    const { id } = await create(true);const row = rows.get(id)!;
    const history = structuredClone(row.events), version = row.version;
    const hidden = await adminCall(`/api/scrims/${id}/access`, 'POST', { action: 'hide', expectedAccessVersion: 1 });
    expect(hidden.body).toEqual({ access: { isPublic: false, deletedAt: null, accessVersion: 2 } });
    expect((await viewerCall(`/api/scrims/${id}/access`)).status).toBe(404);
    const shown = await adminCall(`/api/scrims/${id}/access`, 'POST', { action: 'show', expectedAccessVersion: 2 });
    expect(shown.body.access).toEqual({ isPublic: true, deletedAt: null, accessVersion: 3 });
    expect((await viewerCall(`/api/scrims/${id}`)).status).toBe(200);
    expect(row.version).toBe(version);expect(row.events).toEqual(history);
    expect(accessMutations[0]).toMatchObject({ p_id: id, p_expected_access_version: 1, p_action: 'hide', p_actor_id: ADMIN_ID });
    expect(accessMutations[0]!.p_at).toEqual(expect.any(Number));
    expect((await adminCall(`/api/scrims/${id}/access`, 'POST', { action: 'show', expectedAccessVersion: 1 })).status).toBe(409);
    expect(row.access_version).toBe(3);
  });

  it('requires a verified removal capability and restores removed rooms as hidden', async () => {
    const { id } = await create(true);const row = rows.get(id)!;
    expect((await adminCall('/api/admin/session')).body.permissions).toEqual({ ...currentPermissions(), canDeleteRooms: false });
    expect((await adminCall(`/api/scrims/${id}/access`, 'POST', { action: 'delete', expectedAccessVersion: 1 })).status).toBe(403);
    expect((await adminCall(`/api/scrims/${id}/access`, 'POST', { action: 'delete', expectedAccessVersion: 1, canDeleteRooms: true })).status).toBe(400);
    expect(accessMutations).toHaveLength(0);expect(row.deleted_at).toBeNull();
    adminCanDelete = true;
    expect((await adminCall('/api/admin/session')).body.permissions).toEqual({ ...currentPermissions(), canDeleteRooms: true });
    const removed = await adminCall(`/api/scrims/${id}/access`, 'POST', { action: 'delete', expectedAccessVersion: 1 });
    expect(removed.status).toBe(200);expect(removed.body.access.deletedAt).toEqual(expect.any(Number));expect(removed.body.access.accessVersion).toBe(2);
    for (const [path, method, body] of [
      [`/api/scrims/${id}`, 'GET', undefined], [`/api/scrims/${id}/report.md`, 'GET', undefined],
      [`/api/scrims/${id}/access`, 'GET', undefined], [`/api/scrims/${id}/session`, 'POST', {}],
      [`/api/scrims/${id}/command`, 'POST', { command: { type: 'note.add', text: 'Removed' } }],
      [`/api/scrims/${id}/imports`, 'POST', { action: 'search', region: 'br', riotId: 'Test#TAG' }],
      [`/api/scrims/${id}/tools`, 'POST', { action: 'focus', target: { tab: 'teams', area: 'overview' } }],
    ] as const) expect((await adminCall(path, method, body)).status).toBe(404);
    expect(providerCalls).toBe(0);
    expect((await adminCall('/api/scrims?scope=admin')).body).toEqual([]);expect((await viewerCall('/api/scrims')).body).toEqual([]);
    const trash = await adminCall('/api/scrims?scope=admin&deleted=true');expect(trash.body[0].id).toBe(id);expect(trash.body[0].access.deletedAt).toBe(row.deleted_at);
    adminCanDelete = false;
    expect((await adminCall(`/api/scrims/${id}/access`, 'POST', { action: 'restore', expectedAccessVersion: 2 })).status).toBe(403);
    adminCanDelete = true;
    const restored = await adminCall(`/api/scrims/${id}/access`, 'POST', { action: 'restore', expectedAccessVersion: 2 });
    expect(restored.body.access).toEqual({ isPublic: false, deletedAt: null, accessVersion: 3 });
    expect((await viewerCall(`/api/scrims/${id}`)).status).toBe(404);expect((await adminCall(`/api/scrims/${id}`)).status).toBe(200);
    expect(row.events).toHaveLength(1);expect(row.version).toBe(1);
  });

  it('protects metadata writes from spectators, CSRF, forged fields and concurrent changes', async () => {
    const { id } = await create(true);const row = rows.get(id)!;
    expect((await viewerCall(`/api/scrims/${id}/access`, 'POST', { action: 'hide', expectedAccessVersion: 1 })).status).toBe(403);
    expect((await call(`/api/scrims/${id}/access`, 'POST', { action: 'hide', expectedAccessVersion: 1 }, { cookie: `${ADMIN_ACCESS_COOKIE}=${ADMIN_TOKEN}`, origin: 'https://untrusted.example' })).status).toBe(403);
    for (const body of [{ action: 'hide', expectedAccessVersion: '1' }, { action: 'hide', expectedAccessVersion: Number.MAX_SAFE_INTEGER }, { action: 'hide', expectedAccessVersion: 1, p_actor_id: ADMIN_ID }, { action: 'unknown', expectedAccessVersion: 1 }]) expect((await adminCall(`/api/scrims/${id}/access`, 'POST', body)).status).toBe(400);
    expect(accessMutations).toHaveLength(0);
    accessConflict = true;
    expect((await adminCall(`/api/scrims/${id}/access`, 'POST', { action: 'hide', expectedAccessVersion: 1 })).status).toBe(409);
    expect(row.is_public).toBe(true);expect(row.access_version).toBe(1);
    accessConflict = false;
    const simultaneous = await Promise.all(['hide', 'show'].map(action => adminCall(`/api/scrims/${id}/access`, 'POST', { action, expectedAccessVersion: 1 })));
    expect(simultaneous.map(result => result.status).sort()).toEqual([200, 409]);expect(row.access_version).toBe(2);
  });

  it('fails closed with an actionable response when access columns or RPCs are missing', async () => {
    const { id } = await create(true);const row = rows.get(id)!;
    missingAccessColumns = true;
    for (const path of ['/api/health', '/api/scrims', `/api/scrims/${id}`, `/api/scrims/${id}/access`, `/api/scrims/${id}/report.md`]) {
      const result = await adminCall(path);expect(result.status).toBe(503);expect(result.text).toContain('20261105_super_admin.sql');expect(result.body).not.toHaveProperty('state');
    }
    missingAccessColumns = false;missingAccessRpc = true;
    expect((await adminCall('/api/scrims', 'POST', { title: 'Unavailable', format: 'bo3' })).status).toBe(503);
    expect(rows.size).toBe(1);
    expect((await adminCall(`/api/scrims/${id}/access`, 'POST', { action: 'hide', expectedAccessVersion: 1 })).status).toBe(503);
    expect(row.is_public).toBe(true);expect(row.access_version).toBe(1);
  });

  it('rejects manual rounds and pre-import statistics while allowing explicit corrections after API import', async () => {
    const { id } = await create(true);const row = rows.get(id)!;const ready = readyScrim();
    row.state = { ...ready.state, id };row.version = ready.state.version;row.events = ready.events.map(event => event.type === 'scrim.create' ? { ...event, id } : event);
    const version = row.version;
    for (const command of [
      { type: 'round.win', team: 'A' }, { type: 'round.undo' },
      { type: 'stats.set', mapIndex: 0, playerId: 'p0', line: { kills: 4, deaths: 1, assists: 3 } },
    ]) expect((await adminCall(`/api/scrims/${id}/command`, 'POST', { command })).status).toBe(400);
    expect(row.version).toBe(version);
    const imported = await adminCall(`/api/scrims/${id}/imports`, 'POST', { action: 'confirm', region: 'br', matchId: sampleMatch().id, mapIndex: 0, redTeam: 'A', links: sampleLinks(), expectedVersion: version });
    expect(imported.status).toBe(200);
    const source = structuredClone(row.state.maps[0]!.source), rounds = structuredClone(row.state.maps[0]!.rounds);
    const corrected = await adminCall(`/api/scrims/${id}/command`, 'POST', { command: { type: 'stats.set', mapIndex: 0, playerId: 'p0', line: { kills: 20, deaths: 2, assists: 1 } } });
    expect(corrected.status).toBe(200);expect(row.state.maps[0]!.stats.p0).toMatchObject({ kills: 20, deaths: 2, assists: 1, manualCorrection: true });
    expect(row.state.maps[0]!.source).toEqual(source);expect(row.state.maps[0]!.rounds).toEqual(rounds);
    for (const command of [{ type: 'round.win', team: 'B' }, { type: 'round.undo' }, { type: 'stats.set', mapIndex: '0', playerId: 'p0', line: { kills: 1, deaths: 1, assists: 1 } }]) expect((await adminCall(`/api/scrims/${id}/command`, 'POST', { command })).status).toBe(400);
  });

  it('does not append a gameplay event if removal wins the database race', async () => {
    const { id } = await create(true);const row = rows.get(id)!;const version = row.version;
    deleteBeforeAppend = true;
    expect((await adminCall(`/api/scrims/${id}/command`, 'POST', { command: { type: 'note.add', text: 'Too late' } })).status).toBe(404);
    expect(row.deleted_at).not.toBeNull();expect(row.version).toBe(version);expect(row.events).toHaveLength(1);
  });
});


describe('scoped administrator permissions and ownership', () => {
  it('derives room ownership from the authenticated creator and never publishes it to spectators', async () => {
    const { id } = await create();
    const row = rows.get(id)!;
    expect(row.owner_user_id).toBe(ADMIN_ID);expect(row.created_by_user_id).toBe(ADMIN_ID);
    expect(row.state).not.toHaveProperty('ownerId');expect(JSON.stringify(row.events)).not.toContain(ADMIN_ID);
    const publicList = await viewerCall('/api/scrims');
    expect(publicList.body[0]).not.toHaveProperty('ownerId');expect(publicList.text).not.toContain(ADMIN_ID);
    const publicDetail = await viewerCall(`/api/scrims/${id}`);
    expect(publicDetail.text).not.toContain(ADMIN_ID);expect(publicDetail.body).not.toHaveProperty('ownerId');
    const privateList = await adminCall('/api/scrims?scope=admin');
    expect(privateList.body[0].ownerId).toBe(ADMIN_ID);
    expect(privateList.text).not.toContain(ADMIN_EMAIL);
    expect((await adminCall('/api/scrims', 'POST', {title:'Spoof',format:'bo1',ownerId:OTHER_ID})).status).toBe(400);
  });

  it('filters ownership in SQL before the administrative limit while leaving public spectating available', async () => {
    const { id } = await create();const own = rows.get(id)!;
    const strangers = Array.from({length:510},(_,index)=>({...own,id:`other${index}`,owner_user_id:OTHER_ID,state:{...own.state,id:`other${index}`}}));
    rows.clear();for(const row of strangers) rows.set(row.id,row);rows.set(id,own);
    const list = await adminCall('/api/scrims?scope=admin&ownerId=spoofed');
    expect(list.status).toBe(200);expect(list.body.map((room:any)=>room.id)).toEqual([id]);
    const query = new URL(dbCalls.at(-1)!,'https://test.supabase.co');
    expect(query.searchParams.get('owner_user_id')).toBe(`eq.${ADMIN_ID}`);expect(query.searchParams.get('limit')).toBe('500');
    const all = await superCall('/api/scrims?scope=admin');
    expect(all.body).toHaveLength(500);
    expect(new URL(dbCalls.at(-1)!,'https://test.supabase.co').searchParams.has('owner_user_id')).toBe(false);
  });

  it('treats another administrator as a spectator on public rooms and conceals hidden rooms on every route', async () => {
    const visible = await create(true), hidden = await create(false);
    for(const id of [visible.id,hidden.id]) rows.get(id)!.owner_user_id=OTHER_ID;
    for(const route of [`/api/scrims/${visible.id}/access`,`/api/scrims/${visible.id}/session`]) {
      const result = await adminCall(route,route.endsWith('/session')?'POST':'GET',route.endsWith('/session')?{}:undefined);
      expect(result.status).toBe(200);expect(result.body.role).toBe('viewer');expect(result.body.isSuperAdmin).toBe(false);
      expect(result.body.permissions).toEqual({...noPermissions(),canDeleteRooms:false});
    }
    expect((await adminCall(`/api/scrims/${visible.id}`)).status).toBe(200);
    const mutations = [
      ['command',{command:{type:'note.add',text:'Not mine'}}],
      ['imports',{action:'search',region:'br',riotId:'Test#TAG'}],
      ['tools',{action:'focus',target:{tab:'teams',area:'overview'}}],
      ['access',{action:'hide',expectedAccessVersion:1}],
    ] as const;
    for(const [suffix,body] of mutations) expect((await adminCall(`/api/scrims/${visible.id}/${suffix}`,'POST',body)).status).toBe(403);
    for(const [suffix,method] of [['','GET'],['/report.md','GET'],['/access','GET'],['/session','POST'],['/command','POST'],['/imports','POST'],['/tools','POST']] as const) {
      const result=await adminCall(`/api/scrims/${hidden.id}${suffix}`,method,method==='GET'?undefined:{command:{type:'note.add',text:'Not mine'}});
      expect(result.status).toBe(404);expect(result.body).toEqual({error:'Scrim não encontrada.'});
    }
    expect(providerCalls).toBe(0);expect(appendMutations).toHaveLength(0);expect(accessMutations).toHaveLength(0);
    expect((await otherCall(`/api/scrims/${hidden.id}/session`,'POST',{})).body.role).toBe('admin');
  });

  it.each([
    ['editRoom','command',{command:{type:'settings.update',title:'Changed'}}],
    ['manageTeams','command',{command:{type:'team.rename',team:'A',name:'Changed'}}],
    ['manageVeto','command',{command:{type:'veto.reset'}}],
    ['correctStats','command',{command:{type:'stats.set',mapIndex:0,playerId:'p0',line:{kills:9,deaths:1,assists:2}}}],
    ['manageNotes','command',{command:{type:'note.add',text:'Changed'}}],
    ['manageFocus','tools',{action:'focus',target:{tab:'teams',area:'overview'}}],
    ['manageDraws','tools',{action:'draw.start',kind:'coin',purpose:'Quem começa?',requestId:'permission-coin'}],
    ['importMatches','imports',{action:'search',region:'br',riotId:'Test#TAG'}],
    ['publishRooms','access',{action:'hide',expectedAccessVersion:1}],
    ['deleteRooms','access',{action:'delete',expectedAccessVersion:1}],
  ] as const)('enforces %s on its room route before side effects', async (permission,suffix,body) => {
    const {id}=await create();const row=rows.get(id)!;const previous=structuredClone(row);
    adminPermissions[permission]=false;adminCanDelete=false;
    const result=await adminCall(`/api/scrims/${id}/${suffix}`,'POST',body);
    expect(result.status).toBe(403);expect(rows.get(id)).toEqual(previous);
    expect(providerCalls).toBe(0);expect(appendMutations).toHaveLength(0);expect(accessMutations).toHaveLength(0);
  });

  it('requires create permission and an additional publish permission only for public creation', async () => {
    adminPermissions.createRooms=false;
    expect((await adminCall('/api/scrims','POST',{title:'Denied',format:'bo1'})).status).toBe(403);
    expect(rows.size).toBe(0);
    adminPermissions.createRooms=true;adminPermissions.publishRooms=false;
    expect((await adminCall('/api/scrims','POST',{title:'Private',format:'bo1'})).status).toBe(201);
    expect((await adminCall('/api/scrims','POST',{title:'Public',format:'bo1',isPublic:true})).status).toBe(403);
    expect(rows.size).toBe(1);expect([...rows.values()][0]!.is_public).toBe(false);
  });

  it('checks captain selection side effects independently from the permission to run a coin draw', async () => {
    const clock=controlledClock();const {id}=await create();addPlayers(id);
    adminPermissions.manageTeams=false;
    const captains={action:'draw.start',kind:'captains',purpose:'Capitães',requestId:'captain-policy'};
    expect((await adminCall(`/api/scrims/${id}/tools`,'POST',captains)).status).toBe(403);
    const coin=await adminCall(`/api/scrims/${id}/tools`,'POST',{...captains,kind:'coin',requestId:'coin-policy'});
    expect(coin.status).toBe(200);expect(appendMutations.at(-1)!.p_required_permissions).toEqual(['manageDraws']);
    expect((await adminCall(`/api/scrims/${id}/tools`,'POST',{action:'draw.reject',drawId:'coin-policy'})).status).toBe(200);
    adminPermissions.manageTeams=true;
    const started=await adminCall(`/api/scrims/${id}/tools`,'POST',captains);expect(started.status).toBe(200);
    expect(appendMutations.at(-1)!.p_required_permissions).toEqual(['manageDraws','manageTeams']);
    clock.advance(4000);adminPermissions.manageTeams=false;
    expect((await adminCall(`/api/scrims/${id}/tools`,'POST',{action:'draw.accept',drawId:'captain-policy'})).status).toBe(403);
    expect(rows.get(id)!.state.teams.A.captainId).toBeNull();
    expect((await adminCall(`/api/scrims/${id}/tools`,'POST',{action:'draw.reject',drawId:'captain-policy'})).status).toBe(200);
  });

  it('returns changed room permissions during polling and checks canonical policy once per request', async () => {
    const {id}=await create();policyCalls.length=0;authCalls.length=0;
    let response=await adminCall(`/api/scrims/${id}/access`);
    expect(response.body.permissions.manageFocus).toBe(true);expect(policyCalls).toEqual([{p_user_id:ADMIN_ID}]);
    adminPermissions.manageFocus=false;policyCalls.length=0;
    response=await adminCall(`/api/scrims/${id}/access`);
    expect(response.body.permissions.manageFocus).toBe(false);expect(policyCalls).toHaveLength(1);
    policyCalls.length=0;
    expect((await adminCall(`/api/scrims/${id}/command`,'POST',{command:{type:'note.add',text:'One check'}})).status).toBe(200);
    expect(policyCalls).toHaveLength(1);expect(appendMutations.at(-1)).toMatchObject({p_actor_id:ADMIN_ID,p_actor_session_version:0,p_expected_access_version:1,p_required_permissions:['manageNotes']});
    expect(appendMutations.at(-1)).not.toHaveProperty('p_key_hash');
  });

  it('denies suspended account actions without changing its public room history or visibility', async () => {
    const {id}=await create(true);const before=structuredClone(rows.get(id)!);adminEnabled=false;
    expect((await adminCall(`/api/scrims/${id}/command`,'POST',{command:{type:'note.add',text:'Suspended'}})).status).toBe(403);
    expect((await adminCall(`/api/scrims/${id}/session`,'POST',{})).body.role).toBe('viewer');
    expect((await adminCall('/api/scrims?scope=admin')).status).toBe(403);
    expect((await viewerCall('/api/scrims')).body.map((room:any)=>room.id)).toEqual([id]);
    expect(rows.get(id)).toEqual(before);
  });

  it('keeps another owner rooms out of an administrator trash listing even with removal permission', async () => {
    const mine=await create(),theirs=await create();adminCanDelete=true;
    rows.get(mine.id)!.deleted_at=1;rows.get(theirs.id)!.deleted_at=1;rows.get(theirs.id)!.owner_user_id=OTHER_ID;
    const trash=await adminCall('/api/scrims?scope=admin&deleted=true');expect(trash.body.map((room:any)=>room.id)).toEqual([mine.id]);
    expect((await adminCall(`/api/scrims/${theirs.id}/access`,'POST',{action:'restore',expectedAccessVersion:1})).status).toBe(404);
    expect((await superCall('/api/scrims?scope=admin&deleted=true')).body).toHaveLength(2);
  });

  it('reserves transfer for the pinned super administrator and preserves room history through CAS', async () => {
    const {id}=await create(false);const row=rows.get(id)!;const before=structuredClone(row);
    const body={ownerId:OTHER_ID,expectedAccessVersion:1};
    expect((await adminCall(`/api/scrims/${id}/owner`,'POST',body)).status).toBe(403);
    expect((await viewerCall(`/api/scrims/${id}/owner`,'POST',body)).status).toBe(403);
    expect((await superCall(`/api/scrims/${id}/owner`,'POST',{...body,ownerId:'invalid'})).status).toBe(400);
    expect((await superCall(`/api/scrims/${id}/owner`,'POST',{...body,unexpected:true})).status).toBe(400);
    const transferred=await superCall(`/api/index?route=scrims/${id}/owner`,'POST',body);
    expect(transferred.status).toBe(200);expect(transferred.body).toEqual({ownerId:OTHER_ID,access:{isPublic:false,deletedAt:null,accessVersion:2}});
    expect(row.owner_user_id).toBe(OTHER_ID);expect(row.created_by_user_id).toBe(ADMIN_ID);
    expect(row.state).toEqual(before.state);expect(row.events).toEqual(before.events);expect(row.version).toBe(before.version);
    expect((await adminCall(`/api/scrims/${id}`)).status).toBe(404);
    expect((await otherCall(`/api/scrims/${id}/session`,'POST',{})).body.role).toBe('admin');
    expect((await superCall(`/api/scrims/${id}/owner`,'POST',{ownerId:SUPER_ID,expectedAccessVersion:1})).status).toBe(409);
    expect((await superCall(`/api/scrims/${id}/owner`,'POST',{ownerId:SUPER_ID,expectedAccessVersion:2})).status).toBe(200);
    expect(ownerMutations[0]).toEqual({p_id:id,p_actor_id:SUPER_ID,p_actor_session_version:0,p_expected_access_version:1,p_owner_id:OTHER_ID});
  });

  it('allows the super administrator to act globally without delegating that power to other administrators', async () => {
    const {id}=await create(false);
    const session=await superCall('/api/admin/session');expect(session.body.isSuperAdmin).toBe(true);expect(session.body.permissions).toMatchObject(presetPermissions('full'));
    expect((await superCall(`/api/scrims/${id}/session`,'POST',{})).body.role).toBe('admin');
    expect((await superCall(`/api/scrims/${id}/command`,'POST',{command:{type:'note.add',text:'Supervised'}})).status).toBe(200);
    expect(appendMutations.at(-1)!.p_actor_id).toBe(SUPER_ID);
    const createResult=await superCall('/api/scrims','POST',{title:'Owner room',format:'bo1',isPublic:true});
    expect(createResult.status).toBe(201);expect(rows.get(createResult.body.id)!.owner_user_id).toBe(SUPER_ID);
    expect((await adminCall('/api/admin/session')).body.isSuperAdmin).toBe(false);
  });

  it('blocks management routes for ordinary administrators and rejects foreign-origin privileged changes', async () => {
    for (const [path,method] of [['/api/admin/accounts','GET'],['/api/admin/accounts','POST'],[`/api/admin/accounts/${OTHER_ID}`,'PATCH'],[`/api/admin/accounts/${OTHER_ID}/status`,'POST'],[`/api/admin/accounts/${OTHER_ID}/password`,'POST']] as const) {
      expect((await adminCall(path,method,method==='GET'?undefined:{})).status).toBe(403);expect((await viewerCall(path,method,method==='GET'?undefined:{})).status).toBe(403);
    }
    const {id}=await create();
    const headers={cookie:`${ADMIN_ACCESS_COOKIE}=${SUPER_TOKEN}`,origin:'https://untrusted.example'};
    expect((await call('/api/admin/accounts','POST',{},headers)).status).toBe(403);
    expect((await call(`/api/admin/accounts/${OTHER_ID}/password`,'POST',{},headers)).status).toBe(403);
    expect((await call(`/api/scrims/${id}/owner`,'POST',{ownerId:OTHER_ID,expectedAccessVersion:1},headers)).status).toBe(403);
    expect(ownerMutations).toHaveLength(0);
  });

  it('dispatches the super-administrator listing through its rewrite with bounded pagination', async () => {
    const page=await superCall('/api/index?route=admin/accounts&offset=25&limit=10&q=organizador');
    expect(page.status).toBe(200);expect(page.body).toEqual({accounts:[],total:0,nextOffset:null});
    expect(dbCalls.at(-1)).toBe('/rest/v1/rpc/list_admin_accounts');
    expect((await superCall('/api/admin/accounts?limit=101')).status).toBe(400);
    for(const secret of [SUPER_TOKEN,'server-test-key',TEST_PASSWORD]) expect(page.text).not.toContain(secret);
  });

  it('fails closed when canonical account policy is unavailable instead of trusting legacy metadata', async () => {
    const {id}=await create();missingPolicyRpc=true;
    const result=await adminCall('/api/admin/session');expect(result.status).toBe(503);expect(result.text).toContain('20261105_super_admin.sql');
    expect((await adminCall(`/api/scrims/${id}/command`,'POST',{command:{type:'note.add',text:'No fallback'}})).status).toBe(503);
    expect(appendMutations).toHaveLength(0);expect((await viewerCall(`/api/scrims/${id}`)).status).toBe(200);
  });

  it.each(['suspension','transfer','password reset'] as const)('rechecks %s in the transactional write after an initially authorized request', async change => {
    const {id}=await create();const row=rows.get(id)!;const previousVersion=row.version;
    revokeBeforeAppend=change==='suspension';transferBeforeAppend=change==='transfer';resetBeforeAppend=change==='password reset';
    const result=await adminCall(`/api/scrims/${id}/command`,'POST',{command:{type:'note.add',text:'Must not commit'}});
    expect(result.status).toBe(403);expect(row.version).toBe(previousVersion);expect(row.events).toHaveLength(1);
  });
});
