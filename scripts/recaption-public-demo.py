#!/usr/bin/env python3
"""Re-caption the original French trailer; requires ffmpeg/libass and Pillow.

Usage: python3 scripts/recaption-public-demo.py /path/to/original-public-demo.webm
The original is identified by hash to prevent accidentally re-captioning the result.
"""
import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile
from PIL import Image, ImageChops, ImageFont

root = pathlib.Path(__file__).resolve().parent.parent
source = pathlib.Path(sys.argv[1]).resolve()
assert hashlib.sha256(source.read_bytes()).hexdigest() == '46b35b8a24b91ecad90bcfb472ae46c7685f1238ce35fa2fba79e30d42a3c610', 'Expected original French trailer'
manifest_path = root / 'docs/contributions/announcement-trailer-edit.json'
manifest = json.loads(manifest_path.read_text())
old = [(c['start'], c['end'], c['text']) for c in manifest['captions']]
# The original captions are retained here so the recipe also works after the
# manifest is updated to describe the English output.
if manifest.get('captionLanguage') == 'en':
    old = [(0,3,'Vos règles. Votre essaim.'),(3,8,'SI planète libre → conquérir'),(8,15,'Capturez des planètes.\nFaites grandir votre essaim.'),(15,20,'Objectif : le plus de particules\nà la fin du match.'),(20,23,'Définissez vos priorités.'),(23,27,'SI ennemi plus fort → repli'),(27,31,'Regardez vos règles agir.'),(31,33,'Mais la bataille change…'),(33,41,'Reprenez la main au bon moment.'),(41,46,'Un ordre. Un nouveau cap.'),(46,49,'G : retour aux gambits.'),(49,53,'Plus tard : la planète bascule.'),(53,60,'Découvrez Botters.')]
english = ['Your rules. Your swarm.','IF free planet → conquer','Capture planets.\nGrow your swarm.','Goal: the most particles\nat the end of the match.','Set your priorities.','IF stronger enemy → retreat','Watch your rules in action.','But the battle changes…','Take control at the right moment.','One order. A new course.','G: back to gambits.','Later: the planet changes hands.','Discover Botters.']
labels = [(0,3,'UNE RÈGLE → UNE ACTION','ONE RULE → ONE ACTION'),(3,15,'CONQUÉRIR → GRANDIR','CONQUER → GROW'),(15,20,'ROSE : VOUS · BLEU : L’ADVERSAIRE','PINK: YOU · BLUE: OPPONENT'),(20,31,'VOS PRIORITÉS GUIDENT L’ESSAIM','YOUR PRIORITIES GUIDE THE SWARM'),(31,46,'ROSE : VOTRE ESSAIM · BLEU : L’ADVERSAIRE','PINK: YOUR SWARM · BLUE: OPPONENT'),(46,49,'LE MÊME ESSAIM REPREND SES RÈGLES','THE SAME SWARM RETURNS TO ITS RULES'),(49,53,'MÊME PARTIE · PLUS TARD','SAME MATCH · LATER')]
header = '''[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,76,&H00FFFFFF,&H00FFFFFF,&H00101015,&HCC050507,-1,0,0,0,100,100,0,0,3,14,0,2,70,70,400,1
Style: Label,DejaVu Sans,46,&H00C0E89F,&H00FFFFFF,&H00101015,&HCC050507,-1,0,0,0,100,100,2,0,3,10,0,8,40,40,30,1
Style: Credit,DejaVu Sans,44,&H00DDDDDD,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,50,50,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
def stamp(t):
    return f'{int(t)//3600}:{int(t)%3600//60:02}:{int(t)%60:02}.00'
def event(start, end, style, text):
    return f'Dialogue: 0,{stamp(start)},{stamp(end)},{style},,0,0,0,,{text.replace(chr(10), chr(92)+"N")}\n'
def run(*args):
    subprocess.run(args, check=True)
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

# Render each original text overlay alone on green. Its pixel bounds provide a
# mask, rather than painting a broad strip over unrelated gameplay. The final
# invitation and two French footer lines are measured in their original place.
with tempfile.TemporaryDirectory(prefix='botters-recaption-') as tmp:
    tmp = pathlib.Path(tmp)
    items = [(a,b,'Caption',txt,new, '' if a < 53 else r'{\an5\pos(960,400)}') for (a,b,txt),new in zip(old,english)]
    items += [(a,b,'Label',fr,en,'') for a,b,fr,en in labels]
    items += [(53,60,'Credit','Musique adaptée : extrait, fondus et niveau ajusté.','Music adapted: excerpt, fades and level adjusted.',r'{\an5\pos(960,895)}'),(53,60,'Credit','Partie locale · ouverture choisie par un modèle · adversaire à règles fixes','Local match · opening chosen by a model · fixed-rule opponent',r'{\an5\pos(960,990)}')]
    masks, new_ass = [], header
    for n,(start,end,style,fr,en,pos) in enumerate(items):
        ass = tmp / 'probe.ass'
        ass.write_text(header + event(0,1,style,pos+fr))
        image = tmp / 'probe.png'
        run('ffmpeg','-v','error','-y','-f','lavfi','-i','color=c=0x00ff00:s=1920x1080:r=1:d=1','-vf',f'ass={ass}', '-frames:v','1','-threads','1',str(image))
        frame = Image.open(image).convert('RGB')
        bg = Image.new('RGB',frame.size,frame.getpixel((0,0)))
        box = ImageChops.difference(frame,bg).getbbox()
        if not box:
            raise ValueError(f'No rendered bounds for {fr}')
        x1,y1,x2,y2 = box
        # Align to chroma boundaries; include two pixels for anti-aliasing.
        x1=max(0,(x1-2)//2*2); y1=max(0,(y1-2)//2*2)
        x2=min(1920,(x2+3)//2*2); y2=min(1080,(y2+3)//2*2)
        masks.append(f"drawbox=x={x1}:y={y1}:w={x2-x1}:h={y2-y1}:color=black:t=fill:enable='gte(t,{start})*lt(t,{end})'")
        # Fit the translated text inside the old rectangle, keeping all new
        # caption pixels within its mask. libass handles the actual rendering.
        fontfile = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if style != 'Credit' else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
        size = 76 if style == 'Caption' else 46 if style == 'Label' else 44
        font = ImageFont.truetype(fontfile,size)
        width=max(font.getlength(line) for line in en.split('\n')) + (2*len(en) if style=='Label' else 0)
        scale=min(1,(x2-x1-16)/width, (y2-y1-8)/(size*1.25*len(en.split('\n'))))
        # Use centred plain text: original boxed styling is supplied by mask.
        tags = r'{\an5\pos(%d,%d)\bord0\shad0\fs%.1f}' % ((x1+x2)//2,(y1+y2)//2,size*scale)
        new_ass += event(start,end,style,tags+en)
    ass = root / 'scripts/public-demo-en.ass'
    ass.write_text(new_ass)
    filters = ','.join(masks)+f',ass={ass}'
    filter_file = tmp/'filters.txt'; filter_file.write_text(filters)
    result = tmp/'result.webm'
    run('ffmpeg','-v','error','-y','-i',str(source),'-filter_script:v',str(filter_file),'-map','0:v:0','-map','0:a:0','-c:v','libvpx-vp9','-threads','4','-row-mt','1','-deadline','good','-cpu-used','4','-b:v','0','-crf','20','-pix_fmt','yuv420p','-c:a','copy',str(result))
    target = root/'media/public-demo.webm'; target.write_bytes(result.read_bytes())
    run('ffmpeg','-v','error','-y','-ss','4.5','-i',str(target),'-frames:v','1','-q:v','3',str(root/'media/public-demo-poster.jpg'))
    def vttstamp(t): return f'{int(t)//3600:02}:{int(t)%3600//60:02}:{int(t)%60:02}.000'
    vtt = 'WEBVTT\n\n'+'\n\n'.join(f'{vttstamp(a)} --> {vttstamp(b)}\n{text}' for (a,b,_),text in zip(old,english))+'\n'
    (root/'media/public-demo.vtt').write_text(vtt)
    manifest['captions'] = [{'start':a,'end':b,'text':text} for (a,b,_),text in zip(old,english)]
    manifest['captionLanguage'] = 'en'
    manifest['recaption'] = {'sourceFile': 'previous media/public-demo.webm', 'sourceSha256': sha(source), 'method': 'French text overlays masked, English ASS burned in; video re-encoded, original Opus audio stream copied', 'ass': 'scripts/public-demo-en.ass', 'script': 'scripts/recaption-public-demo.py'}
    for filename in manifest['media']:
        path=root/'media'/filename
        manifest['media'][filename]={'sha256':sha(path),'bytes':path.stat().st_size}
    manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
