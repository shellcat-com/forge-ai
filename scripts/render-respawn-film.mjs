import { readFile, writeFile, readdir, stat, unlink } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'
const root='output/respawn';const film=root+'/film'
const story=JSON.parse(await readFile(film+'/storyboard-timed.json','utf8'))
const marks=JSON.parse(await readFile(root+'/interaction-timeline.json','utf8'));const t=name=>marks.find(m=>m.name===name).seconds
const gen=JSON.parse(await readFile(root+'/generation-timeline.json','utf8'));const g=name=>gen.find(m=>m.name===name).seconds
async function latest(dir){const files=await Promise.all((await readdir(dir)).filter(f=>f.endsWith('.webm')).map(async f=>({path:dir+'/'+f,time:(await stat(dir+'/'+f)).mtimeMs})));return files.sort((a,b)=>b.time-a.time)[0].path}
const footage=(await readFile(root+'/interaction-video-path.txt','utf8')).trim();
const footageDuration=Number(execFileSync('ffprobe',['-v','quiet','-show_entries','format=duration','-of','csv=p=0',footage]).toString().trim());
if(!Number.isFinite(footageDuration)||footageDuration<t('end'))throw new Error('Recording is incomplete; refuse to render.');const generation=await latest(root+'/raw')
const run=args=>execFileSync('ffmpeg',['-y','-v','error',...args],{stdio:['ignore','ignore','inherit']})
// Native video graphics use the actual generated asset files.
const artCanvas=Buffer.from(`<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg"><rect width="1920" height="1080" fill="#0c0c10"/><text x="108" y="158" font-family="Arial" font-size="55" font-weight="700" fill="#f4f2f7">One visual world. Five original assets.</text><text x="108" y="215" font-family="Arial" font-size="27" fill="#b1aabc">Generated with the GPT image tool. Optimized for the browser.</text><text x="110" y="864" font-family="Arial" font-size="24" fill="#b9a0ff">CINEMATIC HERO</text><text x="1100" y="864" font-family="Arial" font-size="24" fill="#b9a0ff">CONTROLLER / KEYBOARD / AUDIO / MOUSE</text></svg>`)
const artImages=[{input:await sharp('public/marketplace/hero.webp').resize(944,570,{fit:'cover'}).toBuffer(),left:108,top:265}]
for(const [i,name] of ['controller','keyboard','headset','mouse'].entries())artImages.push({input:await sharp(`public/marketplace/${name}.webp`).resize(265,265).toBuffer(),left:1112+(i%2)*288,top:265+Math.floor(i/2)*285})
await sharp(artCanvas).composite(artImages).png().toFile(film+'/art-board.png')
const responsiveCanvas=Buffer.from(`<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg"><rect width="1920" height="1080" fill="#0c0c10"/><text x="90" y="340" font-family="Arial" font-size="66" font-weight="700" fill="#f4f2f7">Made for</text><text x="90" y="420" font-family="Arial" font-size="66" font-weight="700" fill="#b9a0ff">every screen.</text><text x="92" y="488" font-family="Arial" font-size="27" fill="#ada7b8">390 · 768 · 1440 pixels</text><text x="92" y="538" font-family="Arial" font-size="27" fill="#ada7b8">Light and dark appearance</text><text x="92" y="588" font-family="Arial" font-size="27" fill="#ada7b8">Keyboard and reduced motion</text><text x="92" y="715" font-family="Arial" font-size="24" fill="#ff785b">REAL BROWSER CAPTURES</text></svg>`)
const mobileImages=[]
for(const [i,theme] of ['dark','light'].entries())mobileImages.push({input:await sharp(`${root}/qa/market-${theme}-390.png`).extract({left:0,top:0,width:390,height:900}).resize(351,810).toBuffer(),left:960+i*425,top:98})
await sharp(responsiveCanvas).composite(mobileImages).png().toFile(film+'/responsive-board.png')
const lightStart=t('signed-out');const lightDuration=t('collection')-lightStart;
run(['-ss',String(lightStart),'-t',String(lightDuration),'-i',footage,'-loop','1','-i',film+'/responsive-board.png','-filter_complex',`[0:v]setpts=${8/lightDuration}*(PTS-STARTPTS),scale=1568:980,pad=1920:1080:176:54:color=0x0c0c10,fps=24,setsar=1,trim=duration=8[a];[1:v]scale=1920:1080,fps=24,setsar=1,trim=duration=12,setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0[v]`,'-map','[v]','-an','-t','20','-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p',film+'/responsive-source.mp4']);
const sources={intro:[footage,0.2,4.6],forge:[generation,0.15,g('generation-start')+1.2],generation:[generation,g('generation-end')+.4,g('exported')+1.2-g('generation-end')],art:[film+'/art-board.png'],login:[footage,4.8,t('login-complete')-4.8],browse:[footage,t('login-complete'),t('sorted')-t('login-complete')],search:[footage,t('sorted'),t('wishlist')-t('sorted')],cart:[footage,t('wishlist'),t('quantities')-t('wishlist')],checkout:[footage,t('quantities'),t('checkout-complete')-t('quantities')+.3],responsive:[film+'/responsive-source.mp4',0,20],outro:[footage,t('end')-3.2,3]}
const paths=[]
for(const scene of story){
 const [file,start,dur]=sources[scene.id];const still=start===undefined;const args=still?['-loop','1','-i',file]:['-ss',String(start),'-t',String(dur),'-i',file]
 args.push('-loop','1','-i',`${film}/${scene.id}-overlay.png`,'-i',`${film}/${scene.id}.flac`)
 const scale=still||scene.id==='responsive'?'scale=1920:1080':`setpts=${scene.duration/dur}*(PTS-STARTPTS),scale=1568:980,pad=1920:1080:176:54:color=0x0c0c10`
 const filter=`[0:v]${scale},fps=24,setsar=1,tpad=stop_mode=clone:stop_duration=2[base];[base][1:v]overlay=0:0,fade=t=in:st=0:d=0.25,fade=t=out:st=${scene.duration-.25}:d=0.25[v]`
 const output=`${film}/part-${scene.id}.mp4`
 run([...args,'-filter_complex',filter,'-map','[v]','-map','2:a','-t',String(scene.duration),'-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-ar','48000','-movflags','+faststart',output]);paths.push(output);console.log('Rendered '+scene.id)
}
await writeFile(film+'/concat.txt',paths.map(p=>`file '${p.split('/').pop()}'`).join('\n'))
run(['-f','concat','-safe','0','-i',film+'/concat.txt','-c','copy','-movflags','+faststart',root+'/respawn-3-minute-walkthrough.mp4'])
run(['-ss','4','-i',root+'/respawn-3-minute-walkthrough.mp4','-frames:v','1',root+'/video-poster.jpg'])
const info=JSON.parse(execFileSync('ffprobe',['-v','quiet','-show_format','-show_streams','-of','json',root+'/respawn-3-minute-walkthrough.mp4']).toString())
await writeFile(root+'/video-info.json',JSON.stringify({format:info.format,streams:info.streams.map(s=>({codec:s.codec_name,type:s.codec_type,width:s.width,height:s.height,duration:s.duration,frameRate:s.avg_frame_rate}))},null,2))
for(const path of paths)await unlink(path)
console.log('Three-minute film ready: '+root+'/respawn-3-minute-walkthrough.mp4')
