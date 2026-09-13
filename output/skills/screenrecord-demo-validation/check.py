from pathlib import Path
import json, subprocess, sys
root=Path.cwd()
folder=Path(__file__).resolve().parent
scripts=root/'skills/screenrecord-demo/scripts'
def run(args, good=True):
    p=subprocess.run([str(x) for x in args],capture_output=True,text=True)
    if (p.returncode==0)!=good:raise AssertionError(p.stdout+p.stderr)
    return p
run(['ffmpeg','-y','-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=4','-c:v','libx264',folder/'raw.mp4'])
data={'version':1,'width':640,'height':360,'fps':30,'clips':[{'name':'normal','source':'raw.mp4','start':0,'end':1,'duration':1},{'name':'fast','source':'raw.mp4','start':1,'end':4,'duration':1},{'name':'slow','source':'raw.mp4','start':1,'end':2,'duration':2}],'sound':{'music':True,'typing':[{'start':.1,'end':1.8,'spacing':.105}],'clicks':[2.2]}}
p=folder/'timeline.json';p.write_text(json.dumps(data))
run([sys.executable,scripts/'compose_audio.py',p,'--out',folder/'mix.wav','--overwrite'])
for name,extra in [('sound',['--audio',folder/'mix.wav']),('silent',[])]:
    result=run([sys.executable,scripts/'render_timeline.py',p,'--out',folder/f'{name}.mp4','--overwrite',*extra])
    print(result.stdout)
    report=json.loads((folder/f'{name}.verification.json').read_text())
    assert report['full_decode_passed']
    assert abs(float(report['format']['duration'])-4)<.05
    assert any(s['codec_type']=='audio' for s in report['streams'])==(name=='sound')
run([sys.executable,scripts/'render_timeline.py',p,'--out',folder/'sound.mp4'],good=False)
data['clips'][0]['end']=99;p.write_text(json.dumps(data))
assert 'exceeds source duration' in run([sys.executable,scripts/'render_timeline.py',p,'--out',folder/'bad.mp4'],good=False).stderr
data['clips'][0]['end']=1;data['clips'][0]['duration']=1.01;p.write_text(json.dumps(data))
assert 'frame grid' in run([sys.executable,scripts/'render_timeline.py',p,'--out',folder/'bad.mp4'],good=False).stderr
data['clips'][0]['duration']=1;data['sound']['clicks']=[99];p.write_text(json.dumps(data))
assert 'Click time' in run([sys.executable,scripts/'compose_audio.py',p,'--out',folder/'bad.wav'],good=False).stderr
data['sound']={'music':False,'typing':[],'clicks':[]};p.write_text(json.dumps(data))
run([sys.executable,scripts/'compose_audio.py',p,'--out',folder/'no-sounds.wav','--overwrite'])
print('PASS: accelerated/slowed clips, sound/silent exports, no-sound synthesis, overwrite refusal, source bounds, frame grid, event bounds')
