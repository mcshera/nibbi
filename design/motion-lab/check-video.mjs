import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const url='http://127.0.0.1:4536/design/motion-lab/';
const b=await chromium.launch({channel:'chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const p=await b.newPage({viewport:{width:1200,height:650}});await p.goto(url);await p.waitForFunction(()=>window.motionLab?.ready);
 await p.evaluate(()=>motionLab.destroy());
 const metadata=await p.evaluate(async url=>{
  const v=document.createElement('video');v.controls=true;v.style.width='100%';v.style.maxWidth='1200px';document.body.replaceChildren(v);
  const ready=new Promise((r,j)=>{v.onloadedmetadata=r;v.onerror=()=>j(new Error('Video load error '+v.error?.message));});
  v.src=url+'evidence/comparison.webm';await ready;
  const result={duration:v.duration,width:v.videoWidth,height:v.videoHeight};
  const shown = new Promise(resolve => {
    const onFrame = (_, metadata) => metadata.mediaTime > 4 ? resolve(metadata.mediaTime) : v.requestVideoFrameCallback(onFrame);
    v.requestVideoFrameCallback(onFrame);
  });
  v.currentTime=4.35; result.decodedFrameTime=await Promise.race([shown,new Promise((_,reject)=>setTimeout(()=>reject(new Error('No decoded frame after seek')),10000))]); v.controls=false;
  const frame=document.createElement('canvas');frame.width=v.videoWidth;frame.height=v.videoHeight;frame.getContext('2d').drawImage(v,0,0);
  result.frame=frame.toDataURL('image/png');
  return result;
 },url);
 assert(Math.abs(metadata.duration-13.7)<.1);assert.equal(metadata.width,1200);assert.equal(metadata.height,540);
 await writeFile('design/motion-lab/evidence/video-frame.png',Buffer.from(metadata.frame.split(',')[1],'base64')); delete metadata.frame;
 assert(metadata.decodedFrameTime > 4);
 await writeFile('design/motion-lab/evidence/video-check.json',JSON.stringify({ok:true,...metadata},null,2));console.log(JSON.stringify(metadata));
}finally{await b.close()}
