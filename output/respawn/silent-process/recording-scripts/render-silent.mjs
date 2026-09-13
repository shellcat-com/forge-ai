/* global console */
import {readFile,writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
const root='/Volumes/ForgeRecordingTemp/process'
const marks=JSON.parse(await readFile(root+'/timeline.json','utf8'))
const at=n=>marks.find(x=>x.name===n).seconds
const source=(await readFile(root+'/video-path.txt','utf8')).trim()
const tour=(await readFile(root+'/tour-video-path.txt','utf8')).trim()
const tourEnd=JSON.parse(await readFile(root+'/tour-timing.json','utf8')).seconds
const probe=p=>JSON.parse(execFileSync('ffprobe',['-v','quiet','-show_format','-show_streams','-of','json',p]).toString())
if(Number(probe(source).format.duration)<at('end')-.5)throw Error('Process recording is incomplete')
if(Number(probe(tour).format.duration)<tourEnd-.5)throw Error('Tour recording is incomplete')
const clips=[
 {name:'01-process',file:source,from:.7,to:at('generation-start')+.6,duration:150},
 {name:'02-generation',file:source,from:at('generation-start')+.6,to:at('generation-end'),duration:7},
 {name:'03-preview-export',file:source,from:at('generation-end'),to:at('end'),duration:10},
 {name:'04-website',file:tour,from:.25,to:tourEnd,duration:13},
]
for(const c of clips){execFileSync('ffmpeg',['-y','-v','error','-ss',String(c.from),'-t',String(c.to-c.from),'-i',c.file,'-vf',`setpts=${c.duration/(c.to-c.from)}*(PTS-STARTPTS),fps=30,scale=1920:1080:flags=lanczos,setsar=1,tpad=stop_mode=clone:stop_duration=2`,'-t',String(c.duration),'-an','-c:v','libx264','-preset','veryfast','-threads','2','-crf','21','-pix_fmt','yuv420p',root+'/'+c.name+'.mp4'],{stdio:['ignore','ignore','inherit']});console.log(c.name+' rendered')}
await writeFile(root+'/concat.txt',clips.map(c=>`file '${c.name}.mp4'`).join('\n'))
execFileSync('ffmpeg',['-y','-v','error','-f','concat','-safe','0','-i',root+'/concat.txt','-c','copy','-an','-movflags','+faststart',root+'/forge-silent-process.mp4'])
const info=probe(root+'/forge-silent-process.mp4');if(info.streams.some(s=>s.codec_type==='audio'))throw Error('Unexpected audio');if(Math.abs(Number(info.format.duration)-180)>.05)throw Error('Unexpected duration')
await writeFile(root+'/video-info.json',JSON.stringify({duration:info.format.duration,bytes:info.format.size,streams:info.streams.map(s=>({type:s.codec_type,codec:s.codec_name,width:s.width,height:s.height})),edit:clips.map(({name,from,to,duration})=>({name,sourceFrom:from,sourceTo:to,duration})),provenance:'Fresh actual Forge UI capture and direct DeepSeek response. No mocked provider or simulated completion. No audio, title cards, captions, or generated showcase graphics. Login screen is the existing preview; final delivery is local HTML export, not public publishing.'},null,2))
execFileSync('ffmpeg',['-y','-v','error','-ss','70','-i',root+'/forge-silent-process.mp4','-frames:v','1',root+'/poster.jpg'])
execFileSync('ffmpeg',['-v','error','-i',root+'/forge-silent-process.mp4','-f','null','-'],{stdio:['ignore','ignore','inherit']})
console.log('Silent 180-second screen recording verified')
