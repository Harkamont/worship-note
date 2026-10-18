"""Position-preserving OCR decoding. No score-specific words or reference input."""
from pathlib import Path
import json,re,unicodedata
from statistics import median

MAPPING=str.maketrans({'♯':'#','♭':'b','⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9','А':'A','В':'B','С':'C','Е':'E','Α':'A','Β':'B','Ε':'E','‡':'#','♮':''})
QUALITY=r'(?:(?:maj|add|sus|dim|aug|m|M)(?:2|4|5|6|7|9|11|13)?|(?:2|4|5|6|7|9|11|13))?'
CHORD=re.compile(r'[A-G][#b]?'+QUALITY+r'(?:\((?:add|sus|b|#)?(?:2|4|5|6|7|9|11|13)\))?(?:/[A-G][#b]?)?')
EXT=re.compile(r'(?:maj|add|sus|dim|aug|m|M)(?:2|4|5|6|7|9|11|13)?(?:/[A-G][#b]?)?$')

def union_box(boxes):
 x=min(b['x'] for b in boxes);y=min(b['y'] for b in boxes)
 return {'x':x,'y':y,'width':max(b['x']+b['width'] for b in boxes)-x,'height':max(b['y']+b['height'] for b in boxes)-y}
def sub_box(ob,start,end):
 chars=ob.get('characters',[])
 if len(chars)==len(ob['text']) and end<=len(chars):
  usable=[c['box'] for c in chars[start:end] if not c['text'].isspace() and c['box']['width']>0 and c['box']['height']>0]
  if usable:return union_box(usable)
 b=ob['box'];n=max(1,len(ob['text']))
 return {'x':b['x']+b['width']*start/n,'y':b['y'],'width':b['width']*(end-start)/n,'height':b['height']}
def chord_observations(observations):
 out=[]
 for ob in observations:
  raw=ob['text'];text=raw.translate(MAPPING)
  # These substitutions are one character each in the recognized text.
  if len(text)!=len(raw):continue
  chunks=[]
  for match in re.finditer(r'\S+',text):
   word=match.group();lo=match.start();hi=match.end()
   while word and word[0] in '[|.,:;_':word=word[1:];lo+=1
   while word and word[-1] in ']|.,:;_':word=word[:-1];hi-=1
   if word.startswith('(') and word.endswith(')'):
    word=word[1:-1];lo+=1;hi-=1
   if not word:continue
   if chunks and EXT.fullmatch(word) and re.fullmatch(r'[A-G][#b]?',chunks[-1][0]):
    prev,pl,ph=chunks.pop();chunks.append((prev+word,pl,hi))
   else:chunks.append((word,lo,hi))
  for word,lo,hi in chunks:
   parts=list(CHORD.finditer(word))
   if not parts or ''.join(m.group() for m in parts)!=word:continue
   for part in parts:
    # For one code with an internal OCR space, use its whole character box.
    if len(parts)==1:b=sub_box(ob,lo,hi)
    else:
     b=sub_box(ob,lo+part.start(),min(hi,lo+part.end()))
    out.append({'text':part.group(),'x':b['x']+b['width']/2,'y':b['y']+b['height']/2,'box':b,'confidence':ob.get('confidence',0)})
 return out

def lyric_rows(observations,crop):
 fragments=[]
 for ob in observations:
  for match in re.finditer(r'[가-힣ㄱ-ㅎㅏ-ㅣ]+',unicodedata.normalize('NFC',ob['text'])):
   if match.group() in ['ㅡ','ㄷ','ㅿ']:continue
   b=sub_box(ob,match.start(),match.end())
   center=b['y']+b['height']/2
   if not crop['y']<=center<=crop['y']+crop['height']:continue
   fragments.append({'text':match.group(),'x':b['x'],'y':center,'height':b['height']})
 rows=[]
 for fragment in sorted(fragments,key=lambda x:(x['y'],x['x'])):
  candidates=[r for r in rows if abs(median(f['y'] for f in r)-fragment['y'])<max(fragment['height'],median(f['height'] for f in r))*.6]
  if candidates:min(candidates,key=lambda r:abs(median(f['y'] for f in r)-fragment['y'])).append(fragment)
  else:rows.append([fragment])
 return [{'text':' '.join(f['text'] for f in sorted(row,key=lambda f:f['x'])),'y':median(f['y'] for f in row)} for row in sorted(rows,key=lambda row:median(f['y'] for f in row))]

def inside(c,crop):return crop['x']<=c['x']<=crop['x']+crop['width'] and crop['y']<=c['y']<=crop['y']+crop['height']
def extract_pages(layout,raw,mode='cropped',chord_raw=None):
 lookup={x['id']:x for x in raw};clookup={x['id']:x for x in chord_raw or []}
 pages=[]
 for page in layout:
  ident=page['id'];systems=[];elapsed=page.get('layoutMs',0)
  if mode=='full':elapsed+=lookup[ident]['elapsedMs']
  for staff in page['staves']:
   n=staff['index'];prefix=f'{ident}-s{n}'
   if mode=='full':co=lo=lookup[ident]['observations']
   else:
    co=lookup[prefix+'-chord']['observations'];lo=lookup[prefix+'-lyric']['observations']
    elapsed+=lookup[prefix+'-chord']['elapsedMs']+lookup[prefix+'-lyric']['elapsedMs']
   chords=[c for c in chord_observations(co) if inside(c,staff['chordCrop'])]
   if chord_raw:
    extra=chord_observations(clookup[prefix+'-chord']['observations'])
    elapsed+=clookup[prefix+'-chord']['elapsedMs']
    # Add only missing independently read symbols on an already-detected code row.
    anchors=chords[:]
    for c in extra:
     d=staff['spacing']
     if c['confidence']<.5 or c['box']['height']>d*3 or not inside(c,staff['chordCrop']):continue
     if not any(abs(c['y']-a['y'])<d*1.2 for a in anchors):continue
     if any(abs(c['x']-a['x'])<d*2.2 and abs(c['y']-a['y'])<d*1.3 for a in chords):continue
     chords.append(c)
   # Sort physical rows then x. Preserve alternate chord rows separately.
   chord_rows=[]
   for c in sorted(chords,key=lambda c:(c['y'],c['x'])):
    candidate=[r for r in chord_rows if abs(median(a['y'] for a in r)-c['y'])<staff['spacing']*1.25]
    if candidate:min(candidate,key=lambda r:abs(median(a['y'] for a in r)-c['y'])).append(c)
    else:chord_rows.append([c])
   ordered=[]
   for row_idx,row in enumerate(sorted(chord_rows,key=lambda r:median(a['y'] for a in r)),1):
    for c in sorted(row,key=lambda c:c['x']):ordered.append({'text':c['text'],'x':c['x'],'y':c['y']})
   systems.append({'index':n,'top':staff['top'],'bottom':staff['bottom'],'lyrics':lyric_rows(lo,staff['lyricCrop']),'chords':ordered})
  pages.append({'id':ident,'elapsedMs':elapsed,'systems':systems,'image':{'width':page['width'],'height':page['height']}})
 return pages

def choose_lyrics(staff, full1, full3, band, tess=None):
 """Choose a physical lyric row from multiple reads, without stored song text."""
 crop=staff['lyricCrop'];d=staff['spacing']
 if staff.get('grandstaff') and tess and tess.get('observations'):
  return lyric_rows(tess['observations'],crop)
 choices=[]
 # Prefer a larger full-page view for equal-length alternatives.
 for priority,raw in [(0,full1),(1,band),(2,full3)]:
  for row in lyric_rows(raw['observations'],crop):choices.append(dict(row,priority=priority))
 groups=[]
 for row in sorted(choices,key=lambda r:r['y']):
  fits=[g for g in groups if abs(median(r['y'] for r in g)-row['y'])<=max(2,d*.85)]
  if fits:min(fits,key=lambda g:abs(median(r['y'] for r in g)-row['y'])).append(row)
  else:groups.append([row])
 out=[]
 for group in groups:
  selected=max(group,key=lambda r:(len(re.sub(r'\s+','',r['text'])),r['priority']))
  out.append({'text':selected['text'],'y':selected['y']})
 return out

def fuse_chords(staff, broad, tight, tess_broad, tess_tight):
 """Fuse independently read chord labels by geometry and engine agreement."""
 d=staff['spacing'];candidates=[]
 anchors=chord_observations(broad['observations'])
 for engine,kind,raw in [('vision','broad',broad),('vision','tight',tight),('tesseract','tight',tess_tight),('tesseract','broad',tess_broad)]:
  for c in chord_observations(raw['observations']):
   if not inside(c,staff['chordCrop']):continue
   if engine=='tesseract':
    threshold=.35 if re.fullmatch(r'[A-G][#b]?',c['text']) else .5
    if c['confidence']<threshold or not d*.35<=c['box']['height']<=d*3:continue
    if c['y']<staff['top']-4.5*d and not any(abs(c['y']-a['y'])<d*1.2 for a in anchors):continue
   candidates.append(dict(c,engine=engine,kind=kind))
 groups=[]
 for c in candidates:
  fits=[g for g in groups if abs(median(a['x'] for a in g)-c['x'])<d*1.5 and abs(median(a['y'] for a in g)-c['y'])<d*1.3]
  if fits:min(fits,key=lambda g:abs(median(a['x'] for a in g)-c['x'])+abs(median(a['y'] for a in g)-c['y'])).append(c)
  else:groups.append([c])
 merged=[]
 for group in groups:
  labels={}
  for c in group:labels.setdefault(c['text'],[]).append(c)
  def rank(pair):
   label,items=pair;engines={x['engine'] for x in items}
   return (len(engines),'vision' in engines,max(x['confidence'] for x in items))
  label,items=max(labels.items(),key=rank)
  best=max(items,key=lambda c:(c['engine']=='vision',c['confidence']))
  merged.append({'text':label,'x':best['x'],'y':best['y']})
 rows=[]
 for c in sorted(merged,key=lambda c:(c['y'],c['x'])):
  fits=[g for g in rows if abs(median(a['y'] for a in g)-c['y'])<d*1.3]
  if fits:min(fits,key=lambda g:abs(median(a['y'] for a in g)-c['y'])).append(c)
  else:rows.append([c])
 return [c for row in sorted(rows,key=lambda row:median(c['y'] for c in row)) for c in sorted(row,key=lambda c:c['x'])]

def process(layout, raw_full1, raw_full3, raw_bands, raw_tight, tess_broad, tess_tight, tess_lyrics):
 bands={x['id']:x for x in raw_bands};tight={x['id']:x for x in raw_tight}
 tb={x['id']:x for x in tess_broad};tt={x['id']:x for x in tess_tight};tl={x['id']:x for x in tess_lyrics}
 systems=[]
 for staff in layout['staves']:
  n=staff['index'];key=f"{layout['id']}-s{n}"
  chords=fuse_chords(staff,bands[key+'-chord'],tight[key+'-chord'],tb[key+'-chord'],tt[key+'-chord'])
  lyrics=choose_lyrics(staff,raw_full1,raw_full3,bands[key+'-lyric'],tl.get(key+'-lyric'))
  def bounded(value,maximum):return max(0,min(float(value),maximum))
  systems.append({'index':n,'top':bounded(staff['top'],layout['height']),'bottom':bounded(staff['bottom'],layout['height']),'lyrics':[{'text':l['text'],'y':bounded(l['y'],layout['height'])} for l in lyrics],'chords':[{'text':c['text'],'x':bounded(c['x'],layout['width']),'y':bounded(c['y'],layout['height'])} for c in chords]})
 return systems

def review_warnings(layout,raw_full1,raw_full3,raw_bands):
 warnings=['음표·마디·박과 연결하기 전의 텍스트 초안입니다. 원본을 보며 가사와 코드의 누락·오독을 확인해 주세요.','가사 띄어쓰기와 반복 순서는 인쇄된 모양을 따르며 송폼을 자동으로 해석하지 않습니다.']
 bands={x['id']:x for x in raw_bands}
 for staff in layout['staves']:
  key=f"{layout['id']}-s{staff['index']}-lyric";crop=staff['lyricCrop']
  views=[lyric_rows(raw['observations'],crop)for raw in [raw_full1,raw_full3,bands[key]]]
  normalized=[''.join(re.sub(r'\s+','',r['text'])for r in rows)for rows in views]
  if len(set(normalized))>1:warnings.append(f"{staff['index']}번째 보표의 가사를 보기 조건에 따라 다르게 읽었습니다. 해당 줄을 원본과 대조해 주세요.")
  if staff.get('grandstaff'):warnings.append(f"{staff['index']}번째 보표에 여러 성부가 있습니다. 텍스트를 추출했으며 다성부 음표를 편집 악보로 변환하지 않았습니다.")
 return warnings
