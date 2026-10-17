import { createElement, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readyScrim, sampleLinks, sampleMatch } from '../../test/import-fixture';
import type { PlayerLink } from '../../shared/imports';
const mocks=vi.hoisted(()=>({room:{} as any}));
vi.mock('./ScrimRoom',()=>({useRoom:()=>mocks.room}));
import { ImportMatchPanel, PlayerMatcher } from './ImportMatchPanel';
let renderer:ReactTestRenderer;
afterEach(()=>{if(renderer)act(()=>renderer.unmount());});
beforeEach(()=>{mocks.room={state:readyScrim().state,isAdmin:true,importRequest:vi.fn()};});
const button=(label:string)=>renderer.root.findAllByType('button').find(b=>b.props['aria-label']===label)!;
it('associates by click or drop, moves unique bindings, blocks the wrong team and removes links',()=>{
 const state=readyScrim().state,match=sampleMatch();let last:PlayerLink[]=[];
 function Harness(){const [links,setLinks]=useState<PlayerLink[]>([]);last=links;return createElement(PlayerMatcher,{state,match,redTeam:'A',links,onChange:setLinks});}
 act(()=>{renderer=create(createElement(Harness));});
 act(()=>button('Selecionar Riot 0#TEST').props.onClick());act(()=>button('Associar a Apelido 0').props.onClick());
 expect(last).toEqual([{playerId:'p0',puuid:'puuid-0'}]);
 const drop=(player:string,puuid:string)=>renderer.root.findAll(n=>n.props.className?.includes('mapping-target')).find(n=>n.findAllByType('strong').some(x=>x.children.includes(player)))!.props.onDrop({preventDefault(){},dataTransfer:{getData:()=>puuid}});
 act(()=>drop('Apelido 1','puuid-0'));expect(last).toEqual([{playerId:'p1',puuid:'puuid-0'}]);
 act(()=>renderer.root.findAllByType('button').find(n=>n.props.className?.includes('team-B') && n.props['aria-pressed']!==undefined)!.props.onClick());
 act(()=>drop('Apelido 5','puuid-0'));expect(last).toEqual([{playerId:'p1',puuid:'puuid-0'}]);
 act(()=>renderer.root.findAllByType('button').find(n=>n.props.className?.includes('team-A') && n.props['aria-pressed']!==undefined)!.props.onClick());
 act(()=>button('Remover associação de Apelido 1').props.onClick());expect(last).toEqual([]);
});
it('requires all links and explicit review before sending a confirmed import',async()=>{
 const match=sampleMatch();const request=vi.fn().mockResolvedValueOnce({matches:[match]}).mockResolvedValueOnce({});mocks.room.importRequest=request;
 await act(async()=>{renderer=create(createElement(ImportMatchPanel,{mapIndex:0}));});
 const find=(text:string)=>renderer.root.findAllByType('button').find(b=>b.children.includes(text))!;
 act(()=>find('Buscar customizada').props.onClick());
 act(()=>renderer.root.findAllByType('input').find(n=>n.props.placeholder)?.props.onChange({target:{value:'Sova#TEST'}}));
 await act(async()=>{await renderer.root.findByType('form').props.onSubmit({preventDefault(){}});});
 await act(async()=>{await Promise.resolve();});
 act(()=>renderer.root.findAllByType('button').find(n=>n.findAllByType('strong').some(s=>String(s.children).includes('Lotus')))?.props.onClick());
 expect(find('Revisar importação').props.disabled).toBe(true);
 act(()=>renderer.root.findByType(PlayerMatcher).props.onChange(sampleLinks()));
 act(()=>find('Revisar importação').props.onClick());
 const review=renderer.root.findAllByType('input').find(n=>n.props.type==='checkbox')!;
 expect(request).toHaveBeenCalledTimes(1);
 expect(find('Confirmar importação').props.disabled).toBe(true);
 expect(review.props.disabled).toBe(false);act(()=>review.props.onChange({target:{checked:true}}));
 expect(find('Confirmar importação').props.disabled).toBe(false);
 await act(async()=>{await find('Confirmar importação').props.onClick();});
 expect(request.mock.calls[1]![0]).toMatchObject({action:'confirm',mapIndex:0,redTeam:'A',links:sampleLinks(),expectedVersion:mocks.room.state.version});
});
it('renders no import controls for spectators',()=>{
 mocks.room.isAdmin=false;act(()=>{renderer=create(createElement(ImportMatchPanel,{mapIndex:0}));});expect(renderer.toJSON()).toBeNull();
});
it('suggests the reversed API team orientation from saved player identities',async()=>{
 const match=sampleMatch();
 for (const p of match.players) p.team=p.team==='Red'?'Blue':'Red';
 mocks.room.state.players=mocks.room.state.players.map((p:any,i:number)=>({...p,riot:{puuid:`puuid-${i}`,name:`Old ${i}`,tag:'OLD'}}));
 mocks.room.importRequest=vi.fn().mockResolvedValue({match});
 await act(async()=>{renderer=create(createElement(ImportMatchPanel,{mapIndex:0}));});
 act(()=>renderer.root.findAllByType('button').find(n=>n.children.includes('Buscar customizada'))!.props.onClick());
 act(()=>renderer.root.findAllByType('input').find(n=>n.props.placeholder)!.props.onChange({target:{value:match.id}}));
 await act(async()=>{renderer.root.findByType('form').props.onSubmit({preventDefault(){}});await Promise.resolve();});
 expect(renderer.root.findByType(PlayerMatcher).props.redTeam).toBe('B');
 expect(renderer.root.findByType(PlayerMatcher).props.links).toHaveLength(10);
});

it('associates by direct selection and supports dragging a manual name onto a match player',()=>{
 const state=readyScrim().state,match=sampleMatch();let last:PlayerLink[]=[];
 function Harness(){const [links,setLinks]=useState<PlayerLink[]>([]);last=links;return createElement(PlayerMatcher,{state,match,redTeam:'A',links,onChange:setLinks});}
 act(()=>{renderer=create(createElement(Harness));});
 act(()=>renderer.root.findByProps({'aria-label':'Jogador do VALORANT para Apelido 0'}).props.onChange({target:{value:'puuid-0'}}));
 expect(last).toEqual([{playerId:'p0',puuid:'puuid-0'}]);
 act(()=>button('Selecionar Riot 1#TEST').props.onDrop({preventDefault(){},dataTransfer:{getData:(type:string)=>type==='application/x-scrim-player'?'p1':''}}));
 expect(last).toContainEqual({playerId:'p1',puuid:'puuid-1'});
});
