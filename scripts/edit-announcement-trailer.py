#!/usr/bin/env python3
"""Small explicit edit recipe. Requires installed ffmpeg; no project dependency.
Usage: python scripts/edit-announcement-trailer.py CAPTURE_JSON MUSIC_MP3
All gameplay comes from the captured native viewport, never generated frames.
"""
import hashlib, json, pathlib, subprocess, sys

capture_path, music = map(pathlib.Path, sys.argv[1:3])
capture = json.loads(capture_path.read_text())
raw = pathlib.Path(capture['rawVideo'])
assert hashlib.sha256(raw.read_bytes()).hexdigest() == capture['rawVideoSha256']
assert hashlib.sha256(music.read_bytes()).hexdigest() == '264be9c44c32419b6de70f0ac24c92f81401419419c8fb111b8e19e62261331b'
out = pathlib.Path('.cache/trailer/edit'); out.mkdir(parents=True, exist_ok=True)
media = pathlib.Path('media'); trim = capture['trimStartSeconds']
# output duration, match-wallclock start, native source crop x/y/w/h, purpose.
# Capture remains real-time; hard cuts omit time, never alter simulation.
shots = [
 (3, 0.5, (60, 330, 800, 450), 'Immediate live map plus enlarged native rule4 free_planet → go'),
 (5, 2.5, (60, 470, 640, 360), 'Swarm reaches planet14; actual neutral→pink at5.32s'),
 (7, 8, (80, 340, 800, 450), 'Planet18 capture12.38s; growing pink swarms'),
 (5, 25, (0, 105, 1520, 855), 'Wider conquest and visible approaching blue opponent'),
 (3, 31, (400, 430, 800, 450), 'Battle plus enlarged native priority1 bigger_enemy_near → retreat'),
 (8, 33, (400, 430, 800, 450), 'Actual pink/blue confrontation and retreat behavior'),
 (2, 63, (350, 280, 800, 450), 'Pressure around the later selected swarm'),
 (13, 65, (400, 280, 800, 450), 'Native selection/order and visible217 long-distance travel'),
 (3, 78, (400, 280, 800, 450), 'Same swarm released with G; native control returns'),
 (4, 144, (650, 290, 400, 225), 'Later planet7 turns pink at146.22s; not instant manual conquest'),
 (7, 171, (0, 105, 1520, 855), 'Held invitation over continuing actual late-match gameplay'),
]
assert sum(s[0] for s in shots) == 60
captions = [
 (0, 3, 'Vos règles. Votre essaim.'),
 (3, 8, 'SI planète libre → conquérir'),
 (8, 15, 'Capturez des planètes.\nFaites grandir votre essaim.'),
 (15, 20, 'Objectif : le plus de particules\nà la fin du match.'),
 (20, 23, 'Définissez vos priorités.'),
 (23, 27, 'SI ennemi plus fort → repli'),
 (27, 31, 'Regardez vos règles agir.'),
 (31, 33, 'Mais la bataille change…'),
 (33, 41, 'Reprenez la main au bon moment.'),
 (41, 46, 'Un ordre. Un nouveau cap.'),
 (46, 49, 'G : retour aux gambits.'),
 (49, 53, 'Plus tard : la planète bascule.'),
 (53, 60, 'Découvrez Botters.'),
]

def run(args):
    print(' '.join(map(str,args)), flush=True)
    subprocess.run(list(map(str,args)), check=True)

parts=[]; timeline=[]; cursor=0
for i,(duration,start,crop,purpose) in enumerate(shots):
    part=out/f'part-{i:02}.mp4'; x,y,w,h=crop
    vf=f'crop={w}:{h}:{x}:{y},scale=1920:1080:flags=lanczos,setsar=1,fps=30'
    if i in (0,4):
        hx,hy,hw,hh=(1534,180,260,26) if i==0 else (1534,98,350,26)
        iw=1300 if i==0 else 1470
        vf=(f'split[game][rule];[game]{vf}[main];'
            f'[rule]crop={hw}:{hh}:{hx}:{hy},scale={iw}:130:flags=lanczos[inset];'
            f'[main][inset]overlay={(1920-iw)//2}:155')
    if i in (7,8):
        # Enlarge only the actual contemporaneous native control status. No
        # retyped/fabricated UI: source pixels from the same viewport interval.
        hx,hy,hw,hh=(322,50,206,20) if i==7 else (1532,410,228,20)
        delay=0.8 if i==7 else 1.4
        vf=(f'split[game][hud];[game]{vf}[main];'
            f'[hud]crop={hw}:{hh}:{hx}:{hy},scale=1026:100:flags=lanczos[inset];'
            f"[main][inset]overlay=447:155:enable='gte(t,{delay})'")
    if i==10: vf+=',eq=brightness=-0.13:saturation=0.65,drawbox=x=0:y=0:w=iw:h=ih:color=black@0.66:t=fill'
    run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss',trim+start,'-i',raw,'-t',duration,'-an','-vf',vf,'-c:v','libx264','-threads','4','-preset','fast','-crf','18',part])
    parts.append(part)
    timeline.append({'outputStart':cursor,'outputEnd':cursor+duration,'matchStart':start,'matchEnd':start+duration,'rawStart':round(trim+start,3),'crop':list(crop),'purpose':purpose,'speed':1})
    cursor+=duration
concat=out/'concat.txt';concat.write_text(''.join(f"file '{p.resolve()}'\n" for p in parts))
joined=out/'picture.mp4'
run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',concat,'-c','copy',joined])

def stamp(t):
    return f'{int(t)//3600}:{int(t)%3600//60:02}:{int(t)%60:02}.{int(round(t%1*100)):02}'

def escape(s): return s.replace('\n',r'\N')
ass='''[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,76,&H00FFFFFF,&H00FFFFFF,&H00101015,&HCC050507,-1,0,0,0,100,100,0,0,3,14,0,2,70,70,400,1
Style: Label,DejaVu Sans,46,&H00C0E89F,&H00FFFFFF,&H00101015,&HCC050507,-1,0,0,0,100,100,2,0,3,10,0,8,40,40,30,1
Style: Title,DejaVu Sans,154,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,10,0,1,0,0,5,60,60,0,1
Style: Credit,DejaVu Sans,44,&H00DDDDDD,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,50,50,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
for start,end,text in captions:
    if start<53: ass+=f'Dialogue: 2,{stamp(start)},{stamp(end)},Caption,,0,0,0,,{escape(text)}\n'
labels=[(0,3,'UNE RÈGLE → UNE ACTION'),(3,15,'CONQUÉRIR → GRANDIR'),(15,20,'ROSE : VOUS · BLEU : L’ADVERSAIRE'),(20,31,'VOS PRIORITÉS GUIDENT L’ESSAIM'),(31,46,'ROSE : VOTRE ESSAIM · BLEU : L’ADVERSAIRE'),(46,49,'LE MÊME ESSAIM REPREND SES RÈGLES'),(49,53,'MÊME PARTIE · PLUS TARD')]
for start,end,text in labels:
    ass+=f'Dialogue: 1,{stamp(start)},{stamp(end)},Label,,0,0,0,,{text}\n'
# Exact author credit preserved verbatim across line breaks, plus source,
# license and notice of the actual adaptation. Seven-second held invitation.
end_text=[(230,'Title',r'{\c&H882EFF&}BOT{\c&HFF8C5B&}TERS'),(400,'Caption','Découvrez Botters.'),(505,'Credit',r'{\fs64}botters.vercel.app'),
 (640,'Credit',"'Resonance' by Scott Buckley - released under CC-BY 4.0."),
 (700,'Credit','www.scottbuckley.com.au'),(770,'Credit','Source: scottbuckley.com.au/library/resonance/'),
 (830,'Credit','Licence: creativecommons.org/licenses/by/4.0/'),
 (895,'Credit','Musique adaptée : extrait, fondus et niveau ajusté.'),
 (990,'Credit','Partie locale · ouverture choisie par un modèle · adversaire à règles fixes')]
for y,style,text in end_text:
    ass+=f'Dialogue: 3,0:00:53.00,0:01:00.00,{style},,0,0,0,,{{\\an5\\pos(960,{y})}}{text}\n'
assfile=out/'captions.ass';assfile.write_text(ass)
# A contiguous professional cue avoids unverified harmonic splices. Its own
# build at~160s lands15s into the cut; a brief gain breath precedes manual input.
audio="atrim=start=145:end=205,asetpts=PTS-STARTPTS,volume='if(lt(t,15),0.36,if(lt(t,31),0.48,if(lt(t,33),0.10,if(lt(t,49),0.48,0.58))))':eval=frame,afade=t=in:st=0:d=0.35,afade=t=out:st=56.5:d=3.5,alimiter=limit=0.84:level=false"
master=out/'botters-announcement-1080p.mp4'
run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',joined,'-i',music,'-vf',f'ass={assfile}','-af',audio,'-map','0:v:0','-map','1:a:0','-t','60','-c:v','libx264','-threads','4','-preset','fast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart',master])
run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',master,'-c:v','libvpx-vp9','-threads','4','-row-mt','1','-deadline','good','-cpu-used','4','-b:v','0','-crf','31','-c:a','libopus','-b:a','128k',media/'public-demo.webm'])
run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss','4.5','-i',media/'public-demo.webm','-frames:v','1','-q:v','3',media/'public-demo-poster.jpg'])
def vttstamp(t): return f'00:{int(t)//60:02}:{int(t)%60:02}.000'
(media/'public-demo.vtt').write_text('WEBVTT\n\n'+'\n\n'.join(f'{vttstamp(a)} --> {vttstamp(b)}\n{txt}' for a,b,txt in captions)+'\n')
manifest={'capture':str(capture_path),'rawVideoSha256':capture['rawVideoSha256'],'trimStartSeconds':trim,'outputSeconds':60,'dimensions':[1920,1080],'fps':30,'shots':timeline,'captions':[{'start':a,'end':b,'text':t} for a,b,t in captions],'burnedCaptions':True,'audio':{'track':'Resonance','author':'Scott Buckley','inputSha256':hashlib.sha256(music.read_bytes()).hexdigest(),'sourceStart':145,'sourceEnd':205,'filter':audio,'subjectiveListening':False},'media':{p.name:{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in [media/'public-demo.webm',media/'public-demo.vtt',media/'public-demo-poster.jpg']},'master':str(master),'masterSha256':hashlib.sha256(master.read_bytes()).hexdigest()}
pathlib.Path('docs/contributions/announcement-trailer-edit.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'master':str(master),'media':manifest['media']},indent=2))
