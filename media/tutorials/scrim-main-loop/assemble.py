"""Align complete browser takes and author a deterministic Hyperframes composition."""
from pathlib import Path
import json, subprocess, math, html, shutil, sys
ROOT=Path(__file__).resolve().parent
record=json.loads((ROOT/'raw/take/capture-report.json').read_text())
project=ROOT/'project';assets=project/'assets';assets.mkdir(parents=True,exist_ok=True)
def probe(p):
    return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(p)]))
duration=math.floor(record['duration']*30)/30
periods=[]
for mark in record['perspectives']:
    if not periods or periods[-1]['role']!=mark['role']:periods.append(dict(mark))
for i,p in enumerate(periods):p['end']=periods[i+1]['time'] if i+1<len(periods) else duration
filters=[];offsets={}
for i,role in enumerate(['admin','viewer']):
    media=record['files'][role];length=float(probe(media)['format']['duration'])
    stop=record['timing'][role+'Stop'];offset=length-(stop-record['timing']['t0'])/1000;offsets[role]=offset
    trim=max(0,offset)
    filters.append(f'[{i}:v]trim=start={trim:.6f},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=1,fps=30,trim=duration={duration:.6f}[{role}]')
enable='+'.join(f'between(t,{p["time"]:.3f},{p["end"]:.3f})' for p in periods if p['role']=='viewer')
filters.append(f"[admin][viewer]overlay=0:0:enable='{enable}':shortest=1,format=yuv420p[out]")
command=['ffmpeg','-hide_banner','-loglevel','error','-y','-i',record['files']['admin'],'-i',record['files']['viewer'],'-filter_complex',';'.join(filters),'-map','[out]','-an','-c:v','libx264','-preset','fast','-crf','17','-movflags','+faststart','-t',str(duration),str(assets/'workflow.mp4')]
if '--reuse-media' not in sys.argv or not (assets/'workflow.mp4').exists(): subprocess.run(command,check=True)
assert abs(float(probe(assets/'workflow.mp4')['format']['duration'])-duration)<.1
for f in ['barlow-condensed-600.woff2','barlow-condensed-700.woff2','source-sans-3-400.woff2','barlowcondensed-OFL.txt','sourcesans3-OFL.txt']:
    (assets/'fonts').mkdir(exist_ok=True);shutil.copy2(ROOT.parents[2]/'public/brand/fonts'/f,assets/'fonts'/f)
# Per-take editorial timing must not leak into a freshly recorded workflow.
editorial=json.loads((ROOT/'editorial.json').read_text()) if (ROOT/'editorial.json').exists() else {}
if editorial.get('captureRoomId')==record['roomId']:
    for mark in record['marks']:mark.update(editorial.get('captionChanges',{}).get(mark['id'],{}))
steps=[]
for i,m in enumerate(record['marks']):
    start=round(m['time']*30)/30;end=round(record['marks'][i+1]['time']*30)/30 if i+1<len(record['marks']) else duration
    steps.append({**m,'start':start,'end':end,'duration':end-start})
roles='\n'.join(f'''<div id="role-{i}" class="clip role {p['role']}" data-start="{p['time']:.3f}" data-duration="{p['end']-p['time']:.3f}" data-track-index="2" data-track-kind="graphics" style="position:absolute;left:1240px;top:58px;width:560px;height:52px;z-index:4"><span>{'Visão do administrador' if p['role']=='admin' else 'Visão do telespectador'}</span></div>''' for i,p in enumerate(periods))
labels='\n'.join(f'''<div id="step-{i}" class="clip step" data-start="{s['start']:.6f}" data-duration="{s['duration']:.6f}" data-track-index="3" data-track-kind="captions" data-beat="{html.escape(s['id'])}" style="position:absolute;left:120px;top:980px;width:1680px;height:80px;z-index:5"><h2>{html.escape(s['title'])}</h2><p>{html.escape(s['description'])}</p></div>''' for i,s in enumerate(steps))
markup='''<!doctype html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=1920,height=1080"><title>Brasa · Criação completa de scrim</title><script src="assets/gsap.min.js"></script><style>
@font-face{font-family:'Barlow Condensed';font-weight:600;src:url('assets/fonts/barlow-condensed-600.woff2') format('woff2')}
@font-face{font-family:'Barlow Condensed';font-weight:700;src:url('assets/fonts/barlow-condensed-700.woff2') format('woff2')}
@font-face{font-family:'Source Sans 3';font-weight:400;src:url('assets/fonts/source-sans-3-400.woff2') format('woff2')}
*{box-sizing:border-box;margin:0}html,body{width:1920px;height:1080px;overflow:hidden;background:#100f0e;color:#f4ece0;font-family:'Source Sans 3',sans-serif}#root{position:relative;width:1920px;height:1080px;overflow:hidden}.top{position:absolute;left:120px;top:37px;width:1050px;height:85px}.top h1{font-family:'Barlow Condensed',sans-serif;font-size:44px;font-weight:600;line-height:1.05}.top p{font-size:28px;line-height:1.25;color:#c9bcae;margin-top:8px}.role{display:flex;justify-content:flex-end;align-items:center;font-size:32px;line-height:1.2}.role span{padding:6px 0 6px 20px;border-left:3px solid #ff7a18}.role.viewer span{border-left-color:#f1c67c;color:#f1c67c}.screen{position:absolute;left:120px;top:132px;width:1680px;height:840px;overflow:hidden;background:#1d1a17}.step h2{font-family:'Barlow Condensed',sans-serif;font-size:36px;line-height:1.1;font-weight:600}.step p{font-size:28px;line-height:1.2;margin-top:4px;color:#d0c3b5}.progress{position:absolute;left:120px;top:1070px;width:1680px;height:3px;background:#4b3d30}.progress div{height:3px;width:1680px;background:#ff7a18;transform-origin:left center}
</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="DURATION" data-width="1920" data-height="1080" data-fps="30">
<div class="top"><h1>Criar uma scrim do início ao fim</h1><p>Piloto com dados fictícios · gravação em velocidade normal</p></div>
ROLES
<div class="screen"><video id="workflow" class="clip" src="assets/workflow.mp4" data-start="0" data-duration="DURATION" data-track-index="0" muted playsinline style="position:absolute;left:0;top:0;width:1680px;height:840px;object-fit:contain;z-index:1"></video></div>
LABELS
<div class="progress" aria-hidden="true"><div id="progress-fill"></div></div>
</div><script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});tl.fromTo('#progress-fill',{scaleX:0},{scaleX:1,duration:DURATION,ease:'none'},0);window.__timelines.main=tl;</script></body></html>'''.replace('DURATION',str(duration)).replace('ROLES',roles).replace('LABELS',labels)
(project/'index.html').write_text(markup)
(project/'meta.json').write_text(json.dumps({'id':'brasa-scrim-main-loop','name':'Brasa · Criação completa de scrim','duration':duration},ensure_ascii=False,indent=2)+'\n')
summary={'duration':duration,'fps':30,'sourceCommit':record['sourceCommit'],'roomTitle':record['title'],'sourceOffsets':offsets,'perspectives':periods,'steps':steps,'verification':record['verification']}
(ROOT/'evidence.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'duration':duration,'perspectives':len(periods),'steps':len(steps),'workflowBytes':(assets/'workflow.mp4').stat().st_size}))
