import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PILOT_PLAYWRIGHT_MODULE || '/workspace/.onboarding/browser/node_modules/playwright-core/index.mjs');
const base=process.env.PILOT_PLAYER_BASE || 'http://127.0.0.1:4320';
const root=path.dirname(fileURLToPath(import.meta.url));
const browser=await chromium.launch({executablePath:process.env.PILOT_CHROME || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1050}});
const p=await context.newPage(),errors=[],failed=[],api=[];p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.status()>=400)failed.push({status:r.status(),url:r.url()});});p.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))api.push(r.url());});
try{
 const response=await p.goto(base+'/pilotos/criar-scrim.html',{waitUntil:'networkidle'});assert.equal(response.status(),200);
 await p.getByRole('button',{name:/Concluir o veto MD3/}).waitFor();assert.equal(await p.locator('.chapters button').count(),7);
 const video=p.locator('video');await p.waitForFunction(()=>document.querySelector('video').readyState>=1);
 const metadata=await video.evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight,controls:v.controls,paused:v.paused}));assert(Math.abs(metadata.duration-202.066667)<.1);assert.equal(metadata.width,1920);assert.equal(metadata.height,1080);assert(!metadata.controls&&metadata.paused);assert(await p.locator('#pilot-controls').isVisible());
 await p.getByRole('button',{name:/Concluir o veto MD3/}).click();await p.waitForFunction(()=>{const v=document.querySelector('video');return v.currentTime>=147.5&&v.readyState>=2&&!v.paused;});await p.waitForFunction(()=>document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames>0);
 assert.equal(await p.getByRole('button',{name:/Concluir o veto MD3/}).getAttribute('aria-current'),'true');await video.evaluate(v=>v.pause());
 await p.getByRole('button',{name:/Conferir a scrim pronta/}).click();await p.waitForFunction(()=>{const v=document.querySelector('video');return v.currentTime>=186&&!v.seeking&&v.readyState>=2;});await p.waitForTimeout(250);await p.getByRole('button',{name:'Pausar',exact:true}).click();
 await p.screenshot({path:path.join(root,'raw','player-desktop.png'),fullPage:true});
 for(const width of [390,320]){await p.setViewportSize({width,height:844});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await p.getByText('Prefere o passo a passo em texto?',{exact:true}).click();assert(await p.locator('details').evaluate(n=>n.open));assert.equal(await p.locator('details li').count(),7);
 await p.screenshot({path:path.join(root,'raw','player-mobile.png'),fullPage:true});assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert.deepEqual(api,[]);
 const report={base,metadata,customControls:true,chapters:7,chapterSeek:true,playback:true,pause:true,mobileWidths:[390,320],textAlternative:true,errors,failed,api};await writeFile(path.join(root,'player-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){await p.screenshot({path:path.join(root,'raw','player-failure.png'),fullPage:true});throw error;}
finally{await browser.close();}
