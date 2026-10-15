"""Convert upstream CC0 MakeHuman assets to compact local geometry. No image edits."""
from pathlib import Path
import json,array,hashlib
root=Path('assets/human');src=root/'source';out=root/'model';out.mkdir(exist_ok=True)
def obj(path):
 vertices=[];uv=[];faces=[];group='body'
 for line in path.read_text().splitlines():
  p=line.split()
  if not p:continue
  if p[0]=='v':vertices.append(list(map(float,p[1:4])))
  elif p[0]=='vt':uv.append(list(map(float,p[1:3])))
  elif p[0]=='g':group=p[1]
  elif p[0]=='f':
   pairs=[tuple(int(v)-1 for v in item.split('/')[:2]) for item in p[1:]]
   for i in range(1,len(pairs)-1):faces.append((group,[pairs[0],pairs[i],pairs[i+1]]))
 return vertices,uv,faces
base,uv,faces=obj(src/'base.obj')
def target(name):
 result={}
 for line in (src/name).read_text().splitlines():
  p=line.split()
  if p and not p[0].startswith('#') and len(p)==4:result[int(p[0])]=list(map(float,p[1:]))
 return result
def shaped(sex,shape):
 points=[v[:] for v in base]
 for name in [f'caucasian-{sex}-young.target',f'universal-{sex}-young-{shape}.target']:
  for i,d in target(name).items():
   for k in range(3):points[i][k]+=d[k]
 # Relax the default A-pose with a gradual shoulder skinning weight.
 # The head/torso are unchanged; hands remain anatomical and fully modeled.
 import math
 for point in points:
  x,y,z=point;side=1 if x>0 else -1
  weight=max(0,min(1,(abs(x)-1.35)/.9))*max(0,min(1,max((y-1.5)/1.4,(abs(x)-1.8)/.8))) if y>-2 and (y>1.5 or abs(x)>2.6) else 0
  if weight:
   pivotx=side*1.15;pivoty=4.6;angle=-side*.42*weight
   dx=x-pivotx;dy=y-pivoty
   point[0]=pivotx+dx*math.cos(angle)-dy*math.sin(angle)
   point[1]=pivoty+dx*math.sin(angle)+dy*math.cos(angle)
 return points
body=[i for group,face in faces if group=='body' for i,_ in face]
hair=[i for group,face in faces if group=='helper-hair' for i,_ in face]
eyev,eyeuv,eyefaces=obj(src/'low-poly.obj');lines=(src/'low-poly.mhclo').read_text().split('verts 0\n')[1].splitlines();refs=[]
for line in lines:
 p=line.strip()
 if p and not p.startswith('#'):
  try:refs.append(int(p))
  except ValueError:break
assert len(refs)==len(eyev)
eyepairs=[pair for _,face in eyefaces for pair in face]
meta={'vertices':len(base),'body':body,'hair':hair,'eyes':{'references':refs,'triangles':[i for i,_ in eyepairs],'uv':eyeuv,'pairs':eyepairs},'source':'MakeHuman hm08 / CC0 1.0','shapes':['minmuscle-averageweight','minmuscle-maxweight','maxmuscle-averageweight']}
for sex in ['male','female']:
 values=[]
 for shape in meta['shapes']:
  values.extend(c for vertex in shaped(sex,shape) for c in vertex)
 binary=array.array('f',values);binary.tofile(open(out/f'{sex}.bin','wb'))
(out/'mesh.json').write_text(json.dumps(meta,separators=(',',':')))
(root/'SOURCE.md').write_text('''# Anatomical model provenance\n\nMakeHuman Community hm08 base mesh, adult male/female macro targets, low-poly eyes and brown eye texture. Assets are CC0 1.0 (see source/LICENSE.ASSETS.md and asset headers). Downloaded from https://github.com/makehumancommunity/makehuman on 2026-10-15. Upstream code is not included.\n\n`source` retains original files. `scripts/prepare-human.py` builds local binary geometry. Only `model`, brown_eye.png, SOURCE.md and the asset license are deployed. The runtime adapts body shape for game levels and profile choices; it is an approximation, not a scan or medical assessment.\n''')
manifest={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in src.iterdir() if p.is_file()}
(root/'source-sha256.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Prepared anatomical male/female geometry, eyes and source checksums.')
