// Actual input screenshots, isolated backend, no direct animation/event calls.
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {testBackend} from './test-backend.mjs';
import * as qa from './pocket-app-qa-helpers.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),out=path.resolve(root,'output/pocket-interactions/gesture-shots');mkdirSync(out,{recursive:true});
const report={sources:qa.sources(root),script:qa.digest(fileURLToPath(import.meta.url)),startedAt:new Date().toISOString(),records:[]};
let browser,fixture;
try{fixture=await testBackend();browser=await chromium.launch({channel:process.env.CI?undefined:'chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
for(const mobile of [false,true]){const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},deviceScaleFactor:mobile?2:1,isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});const page=await context.newPage();const network=await qa.instrument(page,fixture);await qa.boot(page,fixture.base,'?nosw=1');await page.evaluate(()=>{window.__qaMotion=[];for(const type of ['pointerdown','pointermove','pointerup'])document.addEventListener(type,e=>__qaMotion.push({type,eventTime:e.timeStamp,handledAt:performance.now(),x:e.clientX,y:e.clientY,pointerType:e.pointerType}),true);});await qa.settle(page);const p=await qa.point(page);let cdp;
if(mobile){cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y}]});}else{await page.mouse.move(p.x,p.y);await page.mouse.down();}
await page.waitForTimeout(900);await qa.action(page,'pancake');const held=await qa.state(page);const name=mobile?'mobile':'desktop';await page.screenshot({path:path.join(out,`${name}-held-pancake.png`),fullPage:true});
if(mobile){await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}else await page.mouse.up();
await page.waitForTimeout(230);await qa.action(page,'boing');const released=await qa.state(page);await page.screenshot({path:path.join(out,`${name}-release-boing-230ms.png`),fullPage:true});
let flick=null;if(mobile){await qa.settle(page);await page.evaluate(()=>__qaMotion=[]);flick=await qa.drag(page,0,-.95,{touch:true});flick.trace=await page.evaluate(()=>__qaMotion);await qa.action(page,'boing');}assert.deepEqual(network.mutations,[]);report.records.push({mobile,p,held,releaseOffsetMs:230,released,flick,network,...await qa.evidence(page)});await context.close();}
qa.pin(root,report.sources);report.pass=true;
}catch(e){report.pass=false;report.error=e.stack;console.error(e.stack);process.exitCode=1;}
finally{await browser?.close();await fixture?.close();report.finishedAt=new Date().toISOString();writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,pass:report.pass}));}
