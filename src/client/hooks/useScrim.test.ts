import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { applyEvent, initialState, type ScrimEvent, type ScrimState } from '../../shared/scrim';
import { readyScrim, sampleMatch, sampleLinks } from '../../test/import-fixture';
import type { useScrim as Hook } from './useScrim';

let useScrim: typeof Hook;
let snapshot: {state:ScrimState;events:ScrimEvent[]};
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
async function flush(){await act(async()=>{for(let i=0;i<8;i++) await Promise.resolve();});}
async function mount(id='abc123'){
 let value:ReturnType<typeof Hook>;
 function Client(){value=useScrim(id,undefined);return null;}
 let renderer:ReactTestRenderer;
 await act(async()=>{renderer=create(createElement(Client));});renders.push(renderer!);await flush();
 return {get:()=>value!,renderer:renderer!};
}
beforeEach(async()=>{
 vi.resetModules();vi.useFakeTimers();
 vi.stubEnv('VITE_SUPABASE_URL','https://test.supabase.co');vi.stubEnv('VITE_SUPABASE_ANON_KEY','public-test-key');
 const event:ScrimEvent={seq:1,at:1,type:'scrim.create',id:'abc123',title:'Shared',format:'bo3'};
 snapshot={state:applyEvent(initialState(),event),events:[event]};Socket.instances=[];
 vi.stubGlobal('WebSocket',Socket);
 vi.stubGlobal('fetch',vi.fn(async(input:string)=>new Response(JSON.stringify(input.endsWith('/session')?{role:'viewer'}:snapshot),{status:200})));
 ({useScrim}=await import('./useScrim'));
});
afterEach(()=>{for(const r of renders) act(()=>r.unmount());renders.length=0;vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('reconciles two clients, ignores duplicates and catches up after a reconnect',async()=>{
 const a=await mount(),b=await mount();
 await act(async()=>{Socket.instances[0]!.open();Socket.instances[1]!.open();});await flush();
 expect(a.get().status).toBe('online');expect(b.get().status).toBe('online');
 const event:ScrimEvent={seq:2,at:2,type:'team.rename',team:'A',name:'Synchronized'};
 snapshot={state:applyEvent(snapshot.state,event),events:[...snapshot.events,event]};
 act(()=>{for(const s of Socket.instances){s.message('postgres_changes',{data:{record:{event}}});s.message('postgres_changes',{data:{record:{event}}});}});
 expect(a.get().state?.teams.A.name).toBe('Synchronized');expect(b.get().events).toHaveLength(2);
 act(()=>Socket.instances[1]!.close());expect(b.get().status).toBe('offline');
 const missed:ScrimEvent={seq:3,at:3,type:'note.add',text:'While disconnected'};
 snapshot={state:applyEvent(snapshot.state,missed),events:[...snapshot.events,missed]};
 await act(async()=>{vi.advanceTimersByTime(500);});
 await act(async()=>{Socket.instances[2]!.open();});await flush();
 expect(b.get().events).toEqual(snapshot.events);expect(b.get().status).toBe('online');
 expect(Socket.instances[2]!.sent[0].payload.config.postgres_changes[0].filter).toBe('scrim_id=eq.abc123');
});
it('refreshes when a notification reveals a sequence gap and polls missed notifications',async()=>{
 const client=await mount();await act(async()=>Socket.instances[0]!.open());await flush();
 for(let seq=2;seq<=3;seq++){const event:ScrimEvent={seq,at:seq,type:'note.add',text:`Note ${seq}`};snapshot={state:applyEvent(snapshot.state,event),events:[...snapshot.events,event]};}
 act(()=>Socket.instances[0]!.message('postgres_changes',{data:{record:{event:snapshot.events[2]}}}));await flush();expect(client.get().state?.version).toBe(3);
 const event:ScrimEvent={seq:4,at:4,type:'note.add',text:'Missed'};snapshot={state:applyEvent(snapshot.state,event),events:[...snapshot.events,event]};
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
 const ready=readyScrim();snapshot={state:ready.state,events:ready.events};
 const a=await mount(),b=await mount();
 await act(async()=>{Socket.instances[0]!.open();Socket.instances[1]!.open();});await flush();
 const event:ScrimEvent={type:'match.import',seq:snapshot.state.version+1,at:1800000000000,match:sampleMatch(),links:sampleLinks(),mapIndex:0,redTeam:'A'};
 snapshot={state:applyEvent(snapshot.state,event),events:[...snapshot.events,event]};
 act(()=>{for(const socket of Socket.instances)socket.message('postgres_changes',{data:{record:{event}}});});
 expect(a.get().state?.maps[0]?.source?.matchId).toBe(sampleMatch().id);
 expect(b.get().state?.players[0]?.name).toBe('Apelido 0');
 expect(b.get().state?.players[0]?.riot?.puuid).toBe('puuid-0');
 expect(b.get().state?.maps[0]?.stats.p0?.detail?.agent).toBe('Fade');
});
