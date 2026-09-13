"""Re-edit actual Forge capture; compose original music and designed UI foley."""
from pathlib import Path
import json, subprocess, wave
import numpy as np

ROOT = Path(__file__).resolve().parent
SRC = ROOT.parent / 'silent-process'
RATE = 48000
CLIPS = [
    ('opening', .7, 14.62, 14),
    ('prompt-timelapse', 14.62, 120.751, 18),
    ('design-and-create', 120.751, 131.119, 9),
    ('open-brief', 131.119, 133, 1.8),
    ('refine-timelapse', 133, 142.2, 3.2),
    ('save-and-generate', 142.2, 149.841, 6.5),
    ('generation-timelapse', 149.841, 280.245, 6.5),
    ('preview-and-export', 280.245, 289.329, 9),
    ('website-tour', .25, 11.934, 13),
]
DURATION = sum(c[3] for c in CLIPS)
rng = np.random.default_rng(20260911)
music = np.zeros((round(DURATION * RATE), 2), np.float32)
foley = np.zeros_like(music)
events = []

def add(track, signal, at, gain=1, pan=0):
    start = round(at * RATE)
    if start < 0 or start >= len(track): return
    signal = signal[:len(track)-start]
    stereo = np.array([np.sqrt((1-pan)/2), np.sqrt((1+pan)/2)])
    track[start:start+len(signal)] += (signal[:, None] * stereo * gain).astype(np.float32)

def time(d): return np.arange(round(d*RATE)) / RATE
def freq(midi): return 440 * 2 ** ((midi-69)/12)
def smooth(x, n): return np.convolve(x, np.ones(n)/n, mode='same')

def rhodes(note, dur, velocity=1):
    t = time(dur); f = freq(note)
    wobble = .0008*np.sin(2*np.pi*.7*t)
    phase = 2*np.pi*f*t + wobble*f
    tone = np.sin(phase + .8*np.exp(-t*3)*np.sin(phase*2))
    tone += .12*np.sin(phase*3)*np.exp(-t*4)
    env = (1-np.exp(-t*180))*np.exp(-t/1.25)*np.minimum(1, (dur-t)*6)
    return tone*env*velocity

# Original 78 BPM, swung instrumental: warm electric piano, bass and brushed drums.
beat = 60/78
chords = [[53,57,60,64,67], [52,55,59,62,66], [50,53,57,60,64], [43,53,57,59,64]]
basses = [29,28,26,31]
melody = [[76,None,72,71], [74,None,71,67], [69,72,None,76], [74,71,69,None]]
for bar in range(int(DURATION/(4*beat))+1):
    base = bar*4*beat; harmony = chords[bar%4]
    for j,n in enumerate(harmony):
        add(music, rhodes(n, 3.2), base+j*.013, .105, (j-2)*.22)
        add(music, rhodes(n, 1.35), base+2.65*beat+j*.009, .031, (2-j)*.18)
    for off, strength in [(0,.16),(1.65,.085),(2.5,.12)]:
        t=time(1.12); f=freq(basses[bar%4]); tone=np.sin(2*np.pi*f*t)+.17*np.sin(4*np.pi*f*t)
        env=(1-np.exp(-t*95))*np.exp(-t*2.9)*np.minimum(1,(1.12-t)*15)
        add(music,tone*env,base+off*beat,strength)
    if bar>=2:
        for j,n in enumerate(melody[(bar//2)%4]):
            if n is not None:
                at=base+(j*.75+.4)*beat
                line=rhodes(n,1.9)
                add(music,line,at,.046,-.22)
                add(music,line,at+.38,.013,.35)
    for off,g in [(0,.26),(1.75,.11),(2.5,.18)]:
        t=time(.4); phase=2*np.pi*(48*t+60*.022*(1-np.exp(-t/.022)))
        kick=np.sin(phase)*np.exp(-t*13)*(1-np.exp(-t*600))
        add(music,kick,base+off*beat,g)
    for off in [1,3]:
        t=time(.22); noise=smooth(rng.normal(size=len(t)),9)
        snare=noise*np.exp(-t*24)+.10*np.sin(2*np.pi*175*t)*np.exp(-t*36)
        add(music,snare,base+off*beat+.009,.15,-.08)
    for eighth in range(8):
        t=time(.075); noise=rng.normal(size=len(t)); hat=noise-smooth(noise,15)
        hat=smooth(hat,3)*np.exp(-t*75)
        swing=.067 if eighth%2 else 0
        add(music,hat,base+eighth*beat/2+swing,.021 if eighth%2 else .029,.3)

# Soft room reflections. Effects are added only during visible interactions.
for delay,gain in [(.079,.09),(.143,.06),(.227,.04)]:
    offset=round(delay*RATE)
    music[offset:] += music[:-offset,::-1].copy()*gain
music *= .067 / np.sqrt(np.mean(music**2))

def key(at, heavy=False):
    t=time(.085); noise=rng.normal(size=len(t))
    thock=np.sin(2*np.pi*rng.uniform(190,280)*t)*np.exp(-t*65)
    top=(noise-smooth(noise,18))*np.exp(-t*310)
    body=smooth(noise,9)*np.exp(-t*90)
    sound=.62*thock+.23*top+.3*body
    gain=rng.uniform(.065,.092)*(1.22 if heavy else 1)
    add(foley,sound,at,gain,rng.uniform(-.22,.22))
    add(foley,sound,at+.033,gain*.24,.12)
    events.append({'type':'key','at':round(at,3)})

def mouse(at):
    t=time(.05); noise=rng.normal(size=len(t))
    sound=.38*np.sin(2*np.pi*1250*t)*np.exp(-t*420)+.35*noise*np.exp(-t*610)
    add(foley,sound,at,.10,.12)
    add(foley,sound,at+.073,.055,.1)
    events.append({'type':'mouse','at':round(at,3)})

def mapped(raw):
    total=0
    for name,start,end,dur in CLIPS[:-1]:
        if start<=raw<=end: return total+(raw-start)/(end-start)*dur
        total+=dur
    raise ValueError(raw)

# Foley follows action windows, with human-sized bursts instead of every accelerated key.
for start,end,spacing in [(13.1,14,.105),(14,31.65,.105),(42.3,45.7,.10)]:
    at=start; count=0
    while at<end:
        key(at, count%16==15)
        at+=rng.uniform(spacing*.65,spacing*1.3)
        count+=1
        if count%rng.integers(12,23)==0: at+=rng.uniform(.13,.23)
for raw in [3.645,6.593,9.126,10.69,12.493,16.8,122.4,123.95,125.9,127.45,129.0,131.12,142.25,143.55,145.25,146.75,149.4,284.10,285.87,287.1]:
    mouse(mapped(raw))
for at in [71.75,73.0,73.2,74.1,76.0,77.0]: mouse(at)

# Small music duck during typing; smooth transitions and a natural tail.
duck=np.ones(len(music),np.float32)
for start,end in [(13.1,31.7),(42.3,45.7)]:
    a,b=round(start*RATE),round(end*RATE)
    ramp=round(.16*RATE)
    duck[a:b]=.78
    duck[a:a+ramp]=np.linspace(1,.78,ramp)
    duck[b-ramp:b]=np.linspace(.78,1,ramp)
music*=duck[:,None]
mix=music+foley
fade=np.ones(len(mix),np.float32)
fade[:RATE]=np.linspace(0,1,RATE)
fade[-int(2.5*RATE):]=np.linspace(1,0,int(2.5*RATE))**1.3
mix*=fade[:,None]
assert np.max(np.abs(mix))<.95, 'Audio clipping risk'
def wav(path, samples):
    with wave.open(str(path),'wb') as f:
        f.setnchannels(2);f.setsampwidth(2);f.setframerate(RATE)
        f.writeframes((np.clip(samples,-1,1)*32767).astype('<i2').tobytes())
wav(ROOT/'original-lofi-and-foley.wav',mix)
(ROOT/'sound-events.json').write_text(json.dumps(events,indent=2))
print('Original soundtrack composed',flush=True)

def run(args): subprocess.run(args,check=True)
for name,start,end,dur in CLIPS:
    source=SRC/('raw-website-tour.webm' if name=='website-tour' else 'raw-forge-process.webm')
    run(['ffmpeg','-y','-v','error','-ss',str(start),'-t',str(end-start),'-i',str(source),
         '-vf',f'setpts={dur/(end-start)}*(PTS-STARTPTS),fps=30,scale=1920:1080:flags=lanczos,setsar=1,tpad=stop_mode=clone:stop_duration=0.1',
         '-t',str(dur),'-an','-c:v','libx264','-preset','veryfast','-threads','2','-crf','19','-pix_fmt','yuv420p',str(ROOT/(name+'.mp4'))])
    print(name+' rendered',flush=True)
(ROOT/'concat.txt').write_text('\n'.join("file '"+c[0]+".mp4'" for c in CLIPS))
run(['ffmpeg','-y','-v','error','-f','concat','-safe','0','-i',str(ROOT/'concat.txt'),'-i',str(ROOT/'original-lofi-and-foley.wav'),
     '-map','0:v:0','-map','1:a:0','-c:v','copy','-af','loudnorm=I=-19:TP=-2:LRA=8','-c:a','aac','-b:a','192k','-ar','48000',
     '-t',str(DURATION),'-movflags','+faststart',str(ROOT/'forge-social-cut.mp4')])
(ROOT/'edit-notes.json').write_text(json.dumps({'duration':DURATION,'clips':[dict(name=n,sourceFrom=s,sourceTo=e,duration=d) for n,s,e,d in CLIPS],
    'audio':'Original procedurally composed instrumental and synthesized mechanical keyboard/mouse foley; no external samples, voice, or recorded live sound.',
    'video':'Existing actual Forge viewport capture, re-timed. No fabricated generation or new workflow steps.'},indent=2))
print('Social cut complete',flush=True)
