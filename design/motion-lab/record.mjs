// Deterministic 30fps video export. Render all frames first; slow GPUs cannot drop frames.
// Uses project Playwright + its cached FFmpeg, or FFMPEG_PATH. No installed app/daemon needed.
import { chromium } from 'playwright';
import { mkdir, writeFile, appendFile, readdir, access, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const out=fileURLToPath(new URL('./evidence/',import.meta.url));
const scratch=fileURLToPath(new URL('../../output/nibbi-motion-lab/',import.meta.url));
await mkdir(out,{recursive:true});await mkdir(scratch,{recursive:true});
const raw=path.join(scratch,'reel.mjpeg');await writeFile(raw,'');
let ffmpeg=process.env.FFMPEG_PATH;
if(!ffmpeg){
 const cache=platform()==='darwin'?path.join(homedir(),'Library/Caches/ms-playwright'):path.join(homedir(),'.cache/ms-playwright');
 for(const name of (await readdir(cache).catch(()=>[])).filter(s=>s.startsWith('ffmpeg-')).sort().reverse()){
  const candidate=path.join(cache,name,platform()==='darwin'?'ffmpeg-mac':'ffmpeg-linux');
  try{await access(candidate);ffmpeg=candidate;break;}catch{}
 }
}
ffmpeg ||= 'ffmpeg';
const b=await chromium.launch({channel:process.env.CI?undefined:'chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
let meta;
try{
 const page=await b.newPage({viewport:{width:1440,height:1180},deviceScaleFactor:1});
 await page.goto(process.env.NIBBI_MOTION_URL || 'http://127.0.0.1:4536/design/motion-lab/');await page.waitForFunction(()=>window.motionLab?.ready);await page.evaluate(()=>document.fonts.ready);
 meta=await page.evaluate(()=>{
  motionLab.pause(true);
  const output=document.createElement('canvas');output.width=1200;output.height=540;const g=output.getContext('2d');
  const names=['01 / POCKET SPRING','02 / LIVING INK','03 / LITTLE ODDBALL'];
  const actions=['hop','morph','hello','success'];
  const durations=actions.map(action=>Math.max(...['elastic','liquid','mischief'].map(s=>motionLab.durationFor(s,action)))+.4);
  const total=durations.reduce((a,b)=>a+b,0);
  window.drawMotionReel=elapsed=>{
   let local=elapsed,index=0;while(index<actions.length-1&&local>=durations[index]){local-=durations[index];index++;}
   const action=actions[index],snapshot=motionLab.atTime(action,local,{time:elapsed,intensity:1,reduced:false,texture:'flow'});
   g.fillStyle='#f5f2ec';g.fillRect(0,0,1200,540);g.fillStyle='#252820';g.font='38px Geist';g.fillText('Nibbi. A little more life.',32,59);
   g.font='12px GeistMono';g.fillStyle='#727468';g.fillText('THREE MOTION STUDIES / SAME INK, DIFFERENT CHARACTER',34,87);
   g.fillStyle='#3d5641';g.font='16px Geist';g.fillText({hop:'A proper little jump.',morph:'Let the ink change its mind.',hello:'Oh. Hello, you.',success:'A tiny moment of triumph.'}[action],34,125);
   for(let i=0;i<3;i++){
    const src=document.querySelectorAll('.stage canvas')[i];g.drawImage(src,i*400+18,173,364,246);
    g.font='12px GeistMono';g.fillStyle='#3d5641';g.fillText(names[i],i*400+32,169);
    g.font='11px GeistMono';g.fillStyle='#727468';g.fillText(snapshot.styles[i].pose.phase.toUpperCase(),i*400+32,444);
    if(i<2){g.strokeStyle='#d8d9cf';g.beginPath();g.moveTo((i+1)*400,150);g.lineTo((i+1)*400,460);g.stroke();}
   }
   g.fillStyle='#d8d9cf';g.fillRect(32,486,1136,2);g.fillStyle='#3d5641';g.fillRect(32,486,1136*Math.min(1,elapsed/total),2);
   g.font='10px Geist';g.fillStyle='#727468';g.fillText('Actual prototype poses · deterministic 30fps export, not a performance benchmark · app unchanged',32,519);
   return output.toDataURL('image/jpeg',.94).split(',')[1];
  };
  return {frames:Math.ceil(total*30),seconds:total,fps:30,method:'Offline deterministic frame rendering, then FFmpeg encoding; not real-time performance evidence',size:[1200,540]};
 });
 for(let frame=0;frame<meta.frames;frame++){
  const data=await page.evaluate(t=>drawMotionReel(t),frame/meta.fps);
  await appendFile(raw,Buffer.from(data,'base64'));
  if(frame%90===0)console.log(`Rendered ${frame}/${meta.frames}`);
 }
}finally{await b.close()}
await new Promise((resolve,reject)=>{
 const args=['-hide_banner','-loglevel','warning','-f','image2pipe','-r','30','-c:v','mjpeg','-i',raw,'-an','-c:v','libvpx','-pix_fmt','yuv420p','-b:v','1400k','-deadline','good','-cpu-used','4','-y',out+'comparison.webm'];
 const proc=spawn(ffmpeg,args,{stdio:'inherit'});proc.on('error',reject);proc.on('close',code=>code===0?resolve():reject(new Error(`FFmpeg exited ${code}; set FFMPEG_PATH to an encoder with MJPEG + VP8`)));
});
await writeFile(out+'recording.json',JSON.stringify(meta,null,2));await unlink(raw);console.log(JSON.stringify(meta));
