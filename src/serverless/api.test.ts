import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { readyScrim, sampleLinks, sampleMatch, rawMatch } from '../test/import-fixture.js';
import serve from '../../api/index.js';
import { ADMIN_ACCESS_COOKIE, ADMIN_REFRESH_COOKIE } from './adminAuth.js';
import { applyEvent, initialState, type ScrimEvent, type ScrimState } from '../shared/scrim.js';

type Row = { id: string; admin_key_hash: string; state: ScrimState; version: number; events: ScrimEvent[] };
const rows = new Map<string, Row>();
let port: number;
let server: http.Server;
let casConflict = false;
let lookupAllowed = true;
let providerCalls = 0;
const dbCalls: string[] = [];
const authCalls: string[] = [];
const ADMIN_TOKEN = `stub.${Buffer.from(JSON.stringify({ exp: 4102444800 })).toString('base64url')}.verified-admin`;
const VIEWER_TOKEN = `stub.${Buffer.from(JSON.stringify({ exp: 4102444800 })).toString('base64url')}.verified-viewer`;
const ADMIN_EMAIL = 'organizador@example.com';
const TEST_PASSWORD = 'test-password-not-real';
const REFRESH_TOKEN = 'refresh-test-private';
let adminEnabled = true;

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
const viewerCall = (path: string, method = 'GET', body?: unknown) => call(path, method, body);
beforeAll(async () => {
  server = http.createServer((req,res) => { void serve(req,res); });
  await new Promise<void>((resolve) => server.listen(0,'127.0.0.1',resolve));
  port=(server.address() as AddressInfo).port;
});
afterAll(async () => { await new Promise<void>((resolve,reject) => server.close((e) => e ? reject(e) : resolve())); });
beforeEach(() => {
  rows.clear(); dbCalls.length=0; authCalls.length=0; adminEnabled=true; casConflict=false; lookupAllowed=true; providerCalls=0;
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
      const user = (isAdmin: boolean) => ({ id: isAdmin ? 'admin-user' : 'viewer-user', email: isAdmin ? ADMIN_EMAIL : 'espectador@example.com',
        app_metadata: { scrim_admin: isAdmin && adminEnabled }, user_metadata: { scrim_admin: true } });
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
        if (token === ADMIN_TOKEN || token === VIEWER_TOKEN) return new Response(JSON.stringify(user(token === ADMIN_TOKEN)));
        return new Response(JSON.stringify({ message: 'Invalid token' }), { status: 401 });
      }
      throw Error('Unexpected authentication request');
    }
    dbCalls.push(u.pathname+u.search);
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
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
async function create() {
 const r=await adminCall('/api/scrims','POST',{title:'Cloud test',format:'bo3'});
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
    expect(dbCalls.filter(c=>c.includes('append_scrim_event'))).toHaveLength(0);
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
    const res={writeHead:(s:number)=>{status=s;},end:(b:string)=>{body=b;}};
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
    expect(dbCalls.some(c=>c.includes('import_match_result'))).toBe(true);
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
    expect(dbCalls.filter(path => path.includes('append_scrim_event'))).toHaveLength(0);
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
    expect(dbCalls.filter(path => path.includes('append_scrim_event'))).toHaveLength(1);
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { ...body, purpose: 'Outra coisa' })).status).toBe(409);
    clock.advance(4000);
    expect((await adminCall(`/api/scrims/${id}/tools`, 'POST', { action: 'draw.accept', drawId: body.requestId })).status).toBe(200);
    const lateDuplicate = await adminCall(`/api/scrims/${id}/tools`, 'POST', body);
    expect(lateDuplicate.status).toBe(200); expect(lateDuplicate.body.draw.status).toBe('accepted');
    expect(rows.get(id)!.state.draws).toHaveLength(1);
    expect(dbCalls.filter(path => path.includes('append_scrim_event'))).toHaveLength(2);
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
    expect(dbCalls.filter(path => path.includes('append_scrim_event'))).toHaveLength(0);
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
    expect((await viewerCall('/api/admin/session')).body).toEqual({ authenticated: false });
  });

  it('logs in through Supabase, returns no tokens and uses its HttpOnly session to create and edit rooms', async () => {
    const result = await viewerCall('/api/admin/login', 'POST', { email: ADMIN_EMAIL, password: TEST_PASSWORD });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ authenticated: true, user: { email: ADMIN_EMAIL } });
    for (const secret of [TEST_PASSWORD, ADMIN_TOKEN, REFRESH_TOKEN, 'server-test-key']) expect(result.text).not.toContain(secret);
    const cookies = result.headers['set-cookie'] ?? [];
    expect(cookies.some(cookie => cookie.startsWith(`${ADMIN_ACCESS_COOKIE}=`))).toBe(true);
    expect(cookies.some(cookie => cookie.startsWith(`${ADMIN_REFRESH_COOKIE}=`))).toBe(true);
    expect(cookies.every(cookie => /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie))).toBe(true);
    const cookie = cookies.map(value => value.split(';')[0]).join('; ');
    const session = await call('/api/admin/session', 'GET', undefined, { cookie });
    expect(session.body).toEqual({ authenticated: true, user: { email: ADMIN_EMAIL } });
    const created = await call('/api/scrims', 'POST', { title: 'Account room', format: 'bo1' }, { cookie });
    expect(created.status).toBe(201);expect(Object.keys(created.body)).toEqual(['id']);
    expect((await call(`/api/scrims/${created.body.id}/command`, 'POST', { command: { type: 'team.rename', team: 'A', name: 'Account admins' } }, { cookie })).status).toBe(200);
    expect(authCalls).toContain('/auth/v1/token?grant_type=password');
    expect(authCalls).toContain('/auth/v1/user');
    const logout = await call('/api/admin/logout', 'POST', undefined, { cookie });
    expect(logout.body).toEqual({ authenticated: false });
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

  it('revokes editing as soon as verified app metadata stops granting the administrator role', async () => {
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
    expect(dbCalls.filter(path => path.includes('append_scrim_event'))).toHaveLength(0);
  });

  it('handles admin route rewrites and rejects unrecognized login fields and methods', async () => {
    expect((await adminCall('/api/index?route=admin/session')).body.authenticated).toBe(true);
    expect((await viewerCall('/api/admin/login', 'GET')).status).toBe(405);
    expect((await viewerCall('/api/admin/session', 'POST')).status).toBe(405);
    expect((await viewerCall('/api/admin/logout', 'GET')).status).toBe(405);
    expect((await viewerCall('/api/admin/login', 'POST', { email: ADMIN_EMAIL, password: TEST_PASSWORD, role: 'admin' })).status).toBe(400);
  });
});
