import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { applyEvent, initialState, type ScrimEvent, type ScrimState } from '../../shared/scrim';
import { readyScrim, sampleMatch, sampleLinks } from '../../test/import-fixture';
import type { RoomAccess } from '../../shared/protocol';
import type { useScrim as Hook } from './useScrim';

let useScrim: typeof Hook;
let snapshot: {state:ScrimState;events:ScrimEvent[];access:RoomAccess};
const publicAccess:RoomAccess={isPublic:true,deletedAt:null,accessVersion:1};
const renders: ReactTestRenderer[]=[];
class Socket {
 static OPEN=1;static instances:Socket[]=[];
 readyState=1;onopen?:()=>void;onmessage?:(m:{data:string})=>void;onclose?:()=>void;onerror?:()=>void;
 sent:any[]=[];
 constructor(readonly url:string){Socket.instances.push(this);}
 send(raw:string){this.sent.push(JSON.parse(raw));}
 close(){this.readyState=3;this.onclose?.();}
 message(event:string,payload:unknown,ref:string|null=null,topic='realtime:scrim-abc123'){this.onmessage?.({data:JSON.stringify({topic,event,payload,ref})});}
 open(){this.onopen?.();this.message('phx_reply',{status:'ok'},'1');}
}
async function flush(){await act(async()=>{for(let i=0;i<20;i++) await Promise.resolve();});}
async function mount(id='abc123'){
 let value:ReturnType<typeof Hook>;
 function Client(){value=useScrim(id);return null;}
 let renderer:ReactTestRenderer;
 await act(async()=>{renderer=create(createElement(Client));});renders.push(renderer!);await flush();
 return {get:()=>value!,renderer:renderer!};
}
beforeEach(async()=>{
 vi.resetModules();vi.useFakeTimers();
 vi.stubEnv('VITE_SUPABASE_URL','https://test.supabase.co');vi.stubEnv('VITE_SUPABASE_ANON_KEY','public-test-key');
 const event:ScrimEvent={seq:1,at:1,type:'scrim.create',id:'abc123',title:'Shared',format:'bo3'};
 snapshot={state:applyEvent(initialState(),event),events:[event],access:{...publicAccess}};Socket.instances=[];
 vi.stubGlobal('WebSocket',Socket);
 vi.stubGlobal('fetch',vi.fn(async(input:string)=>new Response(JSON.stringify(input.endsWith('/access')?{role:'viewer',access:snapshot.access}:snapshot),{status:200})));
 ({useScrim}=await import('./useScrim'));
});
afterEach(()=>{for(const r of renders) act(()=>r.unmount());renders.length=0;vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('reconciles two clients, ignores duplicates and catches up after a reconnect',async()=>{
 const a=await mount(),b=await mount();
 await act(async()=>{Socket.instances[0]!.open();Socket.instances[1]!.open();});await flush();
 expect(a.get().status).toBe('online');expect(b.get().status).toBe('online');
 const event:ScrimEvent={seq:2,at:2,type:'team.rename',team:'A',name:'Synchronized'};
 snapshot={state:applyEvent(snapshot.state,event),events:[...snapshot.events,event],access:snapshot.access};
 act(()=>{for(const s of Socket.instances){s.message('postgres_changes',{data:{record:{event}}});s.message('postgres_changes',{data:{record:{event}}});}});
 expect(a.get().state?.teams.A.name).toBe('Synchronized');expect(b.get().events).toHaveLength(2);
 act(()=>Socket.instances[1]!.close());expect(b.get().status).toBe('offline');
 const missed:ScrimEvent={seq:3,at:3,type:'note.add',text:'While disconnected'};
 snapshot={state:applyEvent(snapshot.state,missed),events:[...snapshot.events,missed],access:snapshot.access};
 await act(async()=>{vi.advanceTimersByTime(500);});
 await act(async()=>{Socket.instances[2]!.open();});await flush();
 expect(b.get().events).toEqual(snapshot.events);expect(b.get().status).toBe('online');
 expect(Socket.instances[2]!.sent[0].payload.config.postgres_changes[0].filter).toBe('scrim_id=eq.abc123');
});
it('refreshes when a notification reveals a sequence gap and polls missed notifications',async()=>{
 const client=await mount();await act(async()=>Socket.instances[0]!.open());await flush();
 for(let seq=2;seq<=3;seq++){const event:ScrimEvent={seq,at:seq,type:'note.add',text:`Note ${seq}`};snapshot={state:applyEvent(snapshot.state,event),events:[...snapshot.events,event],access:snapshot.access};}
 act(()=>Socket.instances[0]!.message('postgres_changes',{data:{record:{event:snapshot.events[2]}}}));await flush();expect(client.get().state?.version).toBe(3);
 const event:ScrimEvent={seq:4,at:4,type:'note.add',text:'Missed'};snapshot={state:applyEvent(snapshot.state,event),events:[...snapshot.events,event],access:snapshot.access};
 await act(async()=>{vi.advanceTimersByTime(20000);});await flush();expect(client.get().events).toHaveLength(4);
});
it('reconnects after a channel error and ignores callbacks after unmount',async()=>{
 const client=await mount();await act(async()=>Socket.instances[0]!.open());await flush();
 act(()=>Socket.instances[0]!.message('phx_error',{}));expect(client.get().status).toBe('offline');
 await act(async()=>{vi.advanceTimersByTime(500);});expect(Socket.instances).toHaveLength(2);
 act(()=>client.renderer.unmount());const count=Socket.instances.length;
 act(()=>Socket.instances[1]!.open());await act(async()=>{vi.advanceTimersByTime(100000);});expect(Socket.instances).toHaveLength(count);
});

it('broadcasts imported map data and saved identities to two clients', async () => {
 const ready=readyScrim();snapshot={state:ready.state,events:ready.events,access:{...publicAccess}};
 const a=await mount(),b=await mount();
 await act(async()=>{Socket.instances[0]!.open();Socket.instances[1]!.open();});await flush();
 const event:ScrimEvent={type:'match.import',seq:snapshot.state.version+1,at:1800000000000,match:sampleMatch(),links:sampleLinks(),mapIndex:0,redTeam:'A'};
 snapshot={state:applyEvent(snapshot.state,event),events:[...snapshot.events,event],access:snapshot.access};
 act(()=>{for(const socket of Socket.instances)socket.message('postgres_changes',{data:{record:{event}}});});
 expect(a.get().state?.maps[0]?.source?.matchId).toBe(sampleMatch().id);
 expect(b.get().state?.players[0]?.name).toBe('Apelido 0');
 expect(b.get().state?.players[0]?.riot?.puuid).toBe('puuid-0');
 expect(b.get().state?.maps[0]?.stats.p0?.detail?.agent).toBe('Fade');
});

it('synchronizes focus and draw timing across clients and recovers an in-progress draw after reconnect', async () => {
 const start=Date.now();
 const a=await mount(),b=await mount();
 await act(async()=>{Socket.instances[0]!.open();Socket.instances[1]!.open();});await flush();
 const focus:ScrimEvent={type:'room.focus',seq:2,at:start,focus:{id:'focus-shared',target:{tab:'veto',area:'maps'},requestedAt:start,expiresAt:start+10000}};
 snapshot={state:applyEvent(snapshot.state,focus),events:[...snapshot.events,focus],access:snapshot.access};
 act(()=>{for(const socket of Socket.instances)socket.message('postgres_changes',{data:{record:{event:focus}}});});
 expect(a.get().state?.roomFocus).toEqual(b.get().state?.roomFocus);
 expect(b.get().state?.roomFocus?.target).toEqual({tab:'veto',area:'maps'});
 const draw:ScrimEvent={type:'draw.start',seq:3,at:start,draw:{id:'draw-shared',kind:'coin',purpose:'Quem começa banindo?',startedAt:start,revealAt:start+4000,expiresAt:start+120000,status:'pending',result:'tails'}};
 snapshot={state:applyEvent(snapshot.state,draw),events:[...snapshot.events,draw],access:snapshot.access};
 act(()=>{for(const socket of Socket.instances)socket.message('postgres_changes',{data:{record:{event:draw}}});});
 expect(a.get().state?.draws?.[0]).toEqual(b.get().state?.draws?.[0]);
 act(()=>Socket.instances[1]!.close());
 await act(async()=>{vi.advanceTimersByTime(2000);});
 await act(async()=>{Socket.instances[2]!.open();});await flush();
 expect(b.get().state?.draws?.[0]?.revealAt).toBe(start+4000);
 expect(b.get().events).toHaveLength(3);
});

it('ignores public broadcast payloads pretending to be authoritative room tools', async () => {
 const client=await mount();await act(async()=>Socket.instances[0]!.open());await flush();
 act(()=>Socket.instances[0]!.message('broadcast',{event:'room.focus',payload:{id:'forged',target:{tab:'timeline',area:'overview'}}}));
 expect(client.get().state?.roomFocus).toBeUndefined();expect(client.get().state?.version).toBe(1);
});

it('aligns its clock and surfaces server denial without sending legacy credentials', async () => {
 const serverNow=Date.now()+45000;
 Object.assign(snapshot,{serverNow});
 const client=await mount();
 expect(client.get().serverOffset).toBe(45000);
 vi.mocked(fetch).mockImplementation(async (input:any)=>String(input).endsWith('/tools') ? new Response(JSON.stringify({error:'Entre como administrador.'}),{status:403}) : new Response(JSON.stringify(String(input).endsWith('/access')?{role:'viewer',access:snapshot.access}:snapshot),{status:200}));
 await act(async()=>{await expect(client.get().roomRequest({action:'draw.start',kind:'coin',purpose:'Teste',requestId:'request-one'})).rejects.toThrow('Entre como administrador');});
 const post=vi.mocked(fetch).mock.calls.find(([path])=>String(path).endsWith('/tools'));
 expect(post).toBeDefined();expect(JSON.parse(String(post?.[1]?.body))).not.toHaveProperty('adminKey');expect(client.get().role).toBe('viewer');
});

it('does not restore admin from an older role response after a newer logout check', async () => {
 let release!: (value: unknown) => void;let reads=0;
 const windowEvents=new EventTarget();const documentEvents=new EventTarget();
 vi.stubGlobal('window',windowEvents);
 vi.stubGlobal('document',Object.assign(documentEvents,{visibilityState:'visible'}));
 vi.mocked(fetch).mockImplementation(async(input:any)=>{
  if(String(input).endsWith('/access')){
   const response=new Response('{}',{status:200});
   if(reads++===0)response.json=()=>new Promise(resolve=>{release=resolve;});
   else response.json=async()=>({role:'viewer',access:snapshot.access});
   return response;
  }
  return new Response(JSON.stringify(snapshot),{status:200});
 });
 const client=await mount();
 act(()=>{windowEvents.dispatchEvent(new Event('scrim-auth-change'));});await flush();
 await act(async()=>{release({role:'admin',access:snapshot.access});});await flush();
 expect(client.get().role).toBe('viewer');
});

it('keeps a private admin room synchronized through authenticated polling without an anonymous socket', async () => {
 snapshot.access={isPublic:false,deletedAt:null,accessVersion:2};
 vi.mocked(fetch).mockImplementation(async(input:any)=>new Response(JSON.stringify(String(input).endsWith('/access')?{role:'admin',access:snapshot.access}:snapshot),{status:200}));
 const client=await mount();
 expect(client.get().role).toBe('admin');expect(client.get().access?.isPublic).toBe(false);
 expect(client.get().status).toBe('online');expect(Socket.instances).toHaveLength(0);
 const event:ScrimEvent={seq:2,at:2,type:'note.add',text:'Updated in another organizer tab'};
 snapshot={state:applyEvent(snapshot.state,event),events:[...snapshot.events,event],access:snapshot.access};
 await act(async()=>{vi.advanceTimersByTime(2000);});await flush();
 expect(client.get().events).toHaveLength(2);
 const getSnapshot=vi.mocked(fetch).mock.calls.find(([url])=>url==='/api/scrims/abc123');
 expect(getSnapshot?.[1]?.credentials).toBe('same-origin');
});

it('clears an open spectator room when access disappears and ignores its old HTTP and socket responses', async () => {
 const windowEvents=new EventTarget();const documentEvents=new EventTarget();
 vi.stubGlobal('window',windowEvents);vi.stubGlobal('document',Object.assign(documentEvents,{visibilityState:'visible'}));
 let blocked=false,delay=false;let release!: (value:unknown)=>void;
 vi.mocked(fetch).mockImplementation(async(input:any)=>{
  if(String(input).endsWith('/access'))return new Response(JSON.stringify(blocked?{error:'Scrim não encontrada.'}:{role:'viewer',access:snapshot.access}),{status:blocked?404:200});
  const response=new Response(JSON.stringify(snapshot),{status:200});
  if(delay)response.json=()=>new Promise(resolve=>{release=resolve;});
  return response;
 });
 const client=await mount();const socket=Socket.instances[0]!;
 await act(async()=>socket.open());await flush();expect(client.get().state?.title).toBe('Shared');
 delay=true;
 act(()=>socket.message('postgres_changes',{data:{record:{event:{seq:4,type:'note.add',text:'Gap'}}}}));await flush();
 blocked=true;
 act(()=>{windowEvents.dispatchEvent(new Event('focus'));});await flush();
 expect(client.get().status).toBe('not-found');expect(client.get().state).toBeNull();expect(client.get().events).toEqual([]);expect(client.get().presence).toEqual({viewers:0,admins:0});
 const event:ScrimEvent={seq:2,at:2,type:'team.rename',team:'A',name:'Should stay hidden'};
 act(()=>socket.message('postgres_changes',{data:{record:{event}}}));
 await act(async()=>release(snapshot));await flush();
 expect(client.get().state).toBeNull();expect(client.get().events).toEqual([]);expect(socket.readyState).toBe(3);
});

it('drops private content immediately on an auth change, even while a snapshot JSON body is pending', async () => {
 const windowEvents=new EventTarget();const documentEvents=new EventTarget();
 vi.stubGlobal('window',windowEvents);vi.stubGlobal('document',Object.assign(documentEvents,{visibilityState:'visible'}));
 snapshot.access={isPublic:false,deletedAt:null,accessVersion:2};
 let signedIn=true,delay=false;let release!: (value:unknown)=>void;
 vi.mocked(fetch).mockImplementation(async(input:any)=>{
  if(String(input).endsWith('/access'))return new Response(JSON.stringify(signedIn?{role:'admin',access:snapshot.access}:{error:'Scrim não encontrada.'}),{status:signedIn?200:404});
  const response=new Response(JSON.stringify(snapshot),{status:200});
  if(delay)response.json=()=>new Promise(resolve=>{release=resolve;});
  return response;
 });
 const client=await mount();expect(client.get().state).not.toBeNull();
 delay=true;await act(async()=>{vi.advanceTimersByTime(2000);});await flush();
 signedIn=false;
 act(()=>{windowEvents.dispatchEvent(new Event('scrim-auth-change'));});
 expect(client.get().state).toBeNull();expect(client.get().role).toBe('viewer');
 await flush();await act(async()=>release(snapshot));await flush();
 expect(client.get().state).toBeNull();expect(client.get().access).toBeNull();expect(client.get().status).toBe('not-found');
});

it('starts public Realtime again after a private room is shown and recovers after a restored room becomes accessible', async () => {
 snapshot.access={isPublic:false,deletedAt:null,accessVersion:2};let removed=false;
 vi.mocked(fetch).mockImplementation(async(input:any)=>new Response(JSON.stringify(String(input).endsWith('/access')?(removed?{error:'Scrim não encontrada.'}:{role:'admin',access:snapshot.access}):snapshot),{status:removed?404:200}));
 const client=await mount();expect(Socket.instances).toHaveLength(0);
 snapshot.access={isPublic:true,deletedAt:null,accessVersion:3};
 await act(async()=>{vi.advanceTimersByTime(3000);});await flush();expect(Socket.instances).toHaveLength(1);
 await act(async()=>Socket.instances[0]!.open());await flush();expect(client.get().status).toBe('online');
 removed=true;await act(async()=>{vi.advanceTimersByTime(3000);});await flush();expect(client.get().state).toBeNull();
 removed=false;snapshot.access={isPublic:false,deletedAt:null,accessVersion:5};
 await act(async()=>{vi.advanceTimersByTime(3000);});await flush();
 expect(client.get().state?.id).toBe('abc123');expect(client.get().access?.accessVersion).toBe(5);expect(client.get().status).toBe('online');
});
