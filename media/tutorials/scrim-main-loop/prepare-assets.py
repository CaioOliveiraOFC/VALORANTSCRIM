"""Cache actual site map media and the scaffold's GSAP locally before recording."""
from pathlib import Path
import concurrent.futures,json,re,urllib.request
ROOT=Path(__file__).resolve().parent
site=ROOT.parents[2];target=ROOT/'raw/maps';target.mkdir(parents=True,exist_ok=True)
text=(site/'src/shared/maps.ts').read_text()
maps=dict(re.findall(r"(\w+): \{ id: '[^']+', name: '[^']+', uuid: '([^']+)'",text))
items=[(name,maps[name],file) for name in ['abyss','bind','corrode','haven','lotus','summit','sunset'] for file in (['listviewicon.png','splash.png'] if name=='haven' else ['listviewicon.png'])]
def download(item):
 name,uid,file=item;url=f'https://media.valorant-api.com/maps/{uid}/{file}';dest=target/(uid+'-'+file)
 if not dest.exists():dest.write_bytes(urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=30).read())
 return {'name':name,'url':url,'file':dest.name,'bytes':dest.stat().st_size}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(download,items))
(target/'sources.json').write_text(json.dumps(results,indent=2)+'\n')
gsap=ROOT/'project/assets/gsap.min.js';gsap.parent.mkdir(parents=True,exist_ok=True)
if not gsap.exists():gsap.write_bytes(urllib.request.urlopen('https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js',timeout=30).read())
print(json.dumps({'mapAssets':len(results),'gsapBytes':gsap.stat().st_size}))
