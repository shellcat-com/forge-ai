import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'
const root='output/respawn';await mkdir(root+'/film',{recursive:true})
const storyboard=JSON.parse(await readFile(root+'/storyboard.json','utf8'))
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
let at=0;const srt=[]
for(const scene of storyboard) {
 await writeFile(`${root}/film/${scene.id}.txt`,scene.narration)
 execFileSync('say',['-v','Samantha','-r','165','-f',`${root}/film/${scene.id}.txt`,'-o',`${root}/film/${scene.id}.aiff`])
 const duration=Number(execFileSync('ffprobe',['-v','quiet','-show_entries','format=duration','-of','csv=p=0',`${root}/film/${scene.id}.aiff`]).toString().trim())
 const speed=Math.max(1,duration/(scene.duration-0.8))
 execFileSync('ffmpeg',['-y','-v','error','-i',`${root}/film/${scene.id}.aiff`,'-af',`atempo=${speed},apad,afade=t=in:d=0.08,afade=t=out:st=${scene.duration-.25}:d=0.25`,'-t',String(scene.duration),'-ar','48000','-ac','2',`${root}/film/${scene.id}.flac`])
 const svg=`<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="1920" height="54" fill="#0c0c10"/><circle cx="52" cy="27" r="8" fill="#ff785b"/><text x="76" y="35" font-family="Arial" font-size="23" font-weight="700" fill="#f5f3f7">${esc(scene.title)}</text><text x="1838" y="35" text-anchor="end" font-family="Arial" font-size="18" fill="#b9a0ff">FORGE / RESPAWN</text><rect x="110" y="932" width="1700" height="105" rx="18" fill="#111116" fill-opacity=".95" stroke="#393341"/><rect x="138" y="960" width="4" height="48" rx="2" fill="#b9a0ff"/><text x="167" y="996" font-family="Arial" font-size="31" font-weight="700" fill="#f4f2f7">${esc(scene.caption)}</text><rect x="0" y="1075" width="${Math.round((at+scene.duration)/180*1920)}" height="5" fill="#b9a0ff"/></svg>`
 await sharp(Buffer.from(svg)).png().toFile(`${root}/film/${scene.id}-overlay.png`)
 scene.at=at;scene.voiceSeconds=duration
 function time(t){return `${String(Math.floor(t/3600)).padStart(2,'0')}:${String(Math.floor(t/60)%60).padStart(2,'0')}:${String(Math.floor(t)%60).padStart(2,'0')},000`}
 const sentences=scene.narration.match(/[^.!?]+[.!?]+/g)||[scene.narration];let pos=at
 for(const sentence of sentences){const dur=scene.duration*sentence.length/scene.narration.length;srt.push(`${srt.length+1}\n${time(pos)} --> ${time(Math.min(at+scene.duration,pos+dur))}\n${sentence.trim()}\n`);pos+=dur}
 at+=scene.duration;console.log(`${scene.id}: voice ${duration.toFixed(1)}s / scene ${scene.duration}s`)
}
await writeFile(root+'/film/storyboard-timed.json',JSON.stringify(storyboard,null,2));await writeFile(root+'/respawn-captions.srt',srt.join('\n'))
