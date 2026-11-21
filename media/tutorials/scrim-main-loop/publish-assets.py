"""Build review-player chapters and VTT from measured capture timings."""
from pathlib import Path
import json,math,sys,subprocess,shutil
root=Path(__file__).resolve().parent
out=root.parents[2]/'public/pilotos';out.mkdir(parents=True,exist_ok=True)
data=json.loads((root/'evidence.json').read_text());steps={s['id']:s for s in data['steps']}
choices=[('inicio','Entrar como administrador'),('criar','Criar e publicar a sala'),('compartilhar','Compartilhar com espectadores'),('jogadores','Cadastrar os dez jogadores'),('equipes','Formar times e escolher capitães'),('iniciar-veto','Concluir o veto MD3'),('pronta-admin','Conferir a scrim pronta')]
def clock(t):return f'{int(t)//60}:{int(t)%60:02d}'
def vtt(t):
 ms=round(t*1000);return f'{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d}.{ms%1000:03d}'
chapters=[{'title':title,'start':steps[id]['start'],'label':clock(steps[id]['start'])} for id,title in choices]
summary={'duration':data['duration'],'durationLabel':clock(data['duration']),'chapters':chapters}
(out/'criar-scrim.chapters.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
text='WEBVTT\n\n'
for i,c in enumerate(chapters):
 end=chapters[i+1]['start'] if i+1<len(chapters) else data['duration']
 text+=f"{i+1}\n{vtt(c['start'])} --> {vtt(end)}\n{c['title']}\n\n"
(out/'criar-scrim.vtt').write_text(text.rstrip()+'\n')
print(json.dumps(summary,ensure_ascii=False))

if '--video' in sys.argv:
 source=Path(sys.argv[sys.argv.index('--video')+1]).resolve()
 info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(source)]))
 video=next(stream for stream in info['streams'] if stream['codec_type']=='video')
 assert video['codec_name']=='h264' and video['width']==1920 and video['height']==1080
 assert abs(float(info['format']['duration'])-data['duration'])<.1
 target=out/'criar-scrim.mp4'
 if source!=target.resolve():
  temp=out/'.criar-scrim-copy.tmp';shutil.copyfile(source,temp);temp.replace(target)
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss','0.5','-i',str(target),'-frames:v','1','-c:v','libwebp','-quality','82',str(out/'criar-scrim.webp')],check=True)
 report={'duration':float(info['format']['duration']),'width':video['width'],'height':video['height'],'codec':video['codec_name'],'pixelFormat':video['pix_fmt'],'fps':video['avg_frame_rate'],'frames':video.get('nb_frames'),'bytes':target.stat().st_size,'audioTracks':sum(s['codec_type']=='audio' for s in info['streams'])}
 (root/'delivery.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
