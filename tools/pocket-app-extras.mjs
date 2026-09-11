// Real built-app semantic paths and preferences. Never calls the semantic event API.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chromium} from 'playwright';
import {testBackend} from './test-backend.mjs';
import * as qa from './pocket-app-qa-helpers.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.resolve(root,process.env.NIBBI_POCKET_QA_OUT||'output/pocket-interactions/extras');mkdirSync(out,{recursive:true});
const results={startedAt:new Date().toISOString(),checks:[],pageErrors:[],screenshots:[],sources:qa.sources(root),limitations:['Installed Chrome, not Safari/Tauri certification.','Sleep timer uses Playwright clock; wake uses real pointer movement.','Image paste and visibility changes use DOM events, not OS clipboard/window hiding.','All turns use the scripted demo brain. No provider or agent/account mutation is allowed.']};
const runId=results.startedAt.replace(/[:.]/g,'-');let browser,fixture;
function flush(){results.finishedAt=new Date().toISOString();results.passed=results.checks.filter(c=>c.pass).length;results.failed=results.checks.filter(c=>!c.pass).length;const json=JSON.stringify(results,null,2);writeFileSync(path.join(out,'results.json'),json);writeFileSync(path.join(out,`results-${runId}.json`),json);}
async function check(name,fn){try{const detail=await fn();results.checks.push({name,pass:true,detail});console.log('PASS',name);}catch(e){results.checks.push({name,pass:false,error:e.message,stack:e.stack});console.error('FAIL',name,e.stack);}flush();}
async function shot(page,name){await page.screenshot({path:path.join(out,name),fullPage:true});results.screenshots.push(name);}
async function menu(page){await page.locator('#status').click();await page.locator('#st-motion').waitFor({state:'visible'});}
async function newPage(options={}){const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',...options});const page=await context.newPage();page.on('pageerror',e=>results.pageErrors.push(e.message));const network=await qa.instrument(page,fixture);await qa.boot(page,fixture.base);return {context,page,network};}
try{
  fixture=await testBackend();browser=await chromium.launch({channel:process.env.NIBBI_QA_CHANNEL||(process.env.CI?undefined:'chrome'),args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});results.browser=browser.version();
  const {context,page,network}=await newPage();
  await check('built assets contain no shelf or animation chooser',async()=>{
    await qa.noPanel(page);for(const [file] of Object.entries(results.sources).filter(([f])=>f.startsWith('dist/ui/')&&/\.(js|html|css)$/.test(f))){const src=readFileSync(path.join(root,file),'utf8');assert.doesNotMatch(src,/pocket-tricks|st-tricks|data-pocket-action|pocket-energy|pocket-stop/,file);}
    return {files:Object.keys(results.sources).filter(f=>f.startsWith('dist/ui/'))};
  });
  await check('general calm preference persists; OS OR local always wins',async()=>{
    await menu(page);await page.locator('#st-motion').click();await page.waitForFunction(()=>nibbi.state().motion.reduced);assert.equal(await page.locator('#st-motion').getAttribute('aria-pressed'),'true');
    await page.emulateMedia({reducedMotion:'reduce'});await page.emulateMedia({reducedMotion:'no-preference'});assert.equal(await page.evaluate(()=>nibbi.state().motion.reduced),true,'local true survives OS clearing');
    await page.reload();await page.waitForFunction(()=>nibbiApp?.interactions);assert.equal(await page.evaluate(()=>nibbi.state().motion.reduced),true,'saved calm survives reload');
    await menu(page);await page.locator('#st-motion').click();await page.waitForFunction(()=>!nibbi.state().motion.reduced);
    await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>nibbi.state().motion.reduced);assert.equal(await page.locator('#st-motion').getAttribute('aria-pressed'),'true');await shot(page,'app-calm-preference.png');
    await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForFunction(()=>!nibbi.state().motion.reduced);return qa.state(page);
  });
  // Reset page UI/preference independently after failures.
  await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>localStorage.removeItem('nibbi.pocketCalm'));await page.reload();await page.waitForFunction(()=>nibbiApp?.interactions);
  await check('composer focus/type are organic small cues; ordinary UI is not a body tap',async()=>{
    await page.locator('#ask').click();const focus=await qa.semantic(page,'focus');assert.equal(focus.interaction.lastAction,'listen');
    await page.keyboard.type('hello');const typing=await qa.semantic(page,'typing');assert.equal(typing.interaction.lastAction,'think');
    const before=typing.interaction.actionSequence;await page.keyboard.type(' nibbi');const later=await qa.state(page);assert.equal(later.interaction.actionSequence,before,'typing cues coalesce under 5 seconds');assert.equal(later.turns,0);return {focus,typing,later};
  });
  await check('real send, busy body nod and demo terminal success',async()=>{
    await page.locator('#send').click();const send=await qa.semantic(page,'send');assert.equal(send.interaction.lastAction,'nod');assert.equal(send.busy,true);
    await page.waitForTimeout(1100);const mood=await page.evaluate(()=>nibbi.mood());await qa.tap(page);const busy=await qa.action(page,'nod');assert.equal(busy.busy,true);assert.equal(busy.mood,mood,'busy gesture does not change work mood');assert.ok(busy.renderer.motion.pose.lift<.25,'busy feedback has no large leap');
    await page.waitForFunction(()=>!nibbiApp.state().busy,null,{timeout:20000});const afterBusy=await qa.semantic(page,'success');assert.equal(await page.locator('.turn .you').count(),1);
    // The stronger direct nod may intentionally suppress a lower-priority celebration.
    // Verify an eligible terminal celebration in a fresh real demo turn, without that input.
    const eligible=await newPage();try{
      await qa.settle(eligible.page);await eligible.page.evaluate(()=>{window.__qaAdmissions=[];const original=nibbi.animate;nibbi.animate=function(id,options){const before=nibbi.state().motion;const prior={action:before.action,priority:before.priority};const admitted=original.call(this,id,options);__qaAdmissions.push({id,options,prior,admitted,at:performance.now()});return admitted;};});await eligible.page.locator('#ask').fill('hello');await eligible.page.locator('#send').click();await eligible.page.waitForFunction(()=>nibbiApp.state().busy);await eligible.page.waitForFunction(()=>!nibbiApp.state().busy,null,{timeout:20000});
      const success=await qa.semantic(eligible.page,'success');assert.equal(success.busy,false);assert.equal(success.mood,'happy');assert.equal(await eligible.page.evaluate(()=>nibbiApp.state().turns.at(-1).done),true);const admissions=await eligible.page.evaluate(()=>__qaAdmissions);const positive=admissions.findLast(a=>['proud','ta-da','star'].includes(a.id)&&a.options?.priority===60);assert.ok(positive,'real terminal completion attempts a positive priority60 cue');if(positive.admitted){assert.equal(success.interaction.lastAction,positive.id);assert.equal(success.renderer.motion.action,positive.id);}else{assert.ok(positive.prior.action===positive.id||(positive.prior.action==='nod'&&positive.prior.priority>positive.options.priority),'rejection must have exact same-action coalescing or a higher-priority active nod: '+JSON.stringify(positive));}assert.deepEqual(eligible.network.mutations,[]);await shot(eligible.page,'app-demo-success.png');return {send,busy,afterBusy,eligibleSuccess:success,admissions,successOutcome:positive.admitted?'accepted':'coalesced by verified priority/same-action policy',eligibleNetwork:eligible.network};
    }finally{await eligible.context.close();}
  });
  await check('double/triple real body taps do not tidy an existing conversation',async()=>{
    await page.waitForFunction(()=>!nibbiApp.state().busy,null,{timeout:20000});await qa.settle(page);for(let i=0;i<3;i++)await qa.tap(page);await qa.action(page,'triple-hop');assert.equal((await qa.state(page)).turns,1);return qa.state(page);
  });
  await check('real conversation tidy menu emits bow',async()=>{
    await qa.settle(page);await page.locator('#status').click();await page.locator('#st-clear').click();const tidy=await qa.semantic(page,'tidy');assert.equal(tidy.interaction.lastAction,'bow');assert.equal(tidy.turns,0);return tidy;
  });
  await check('accepted image paste gives attach cue; rejected file does not',async()=>{
    await qa.settle(page);await page.locator('#ask').click();
    const paste=async(type)=>page.evaluate(type=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0))],'fixture.'+(type==='image/png'?'png':'txt'),{type}));document.querySelector('#ask').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));},type);
    await paste('text/plain');assert.equal(await page.locator('#attach img').count(),0);await paste('image/png');await page.locator('#attach img').waitFor();const accepted=await qa.semantic(page,'attach');assert.equal(accepted.interaction.lastAction,'curious');await shot(page,'app-image-accepted.png');await page.locator('#attach button').click();return accepted;
  });
  await check('demo error never announces success',async()=>{
    await qa.settle(page);await page.locator('#ask').fill('error');await page.locator('#send').click();const start=(await qa.state(page)).interaction.actionSequence;await page.waitForFunction(()=>!nibbiApp.state().busy,null,{timeout:15000});const error=await qa.state(page);assert.equal(error.mood,'error');assert.notEqual(error.interaction.lastEvent,'success');assert.ok(!error.interaction.history.filter(h=>h.sequence>start).some(h=>['proud','ta-da','star'].includes(h.action)));await shot(page,'app-demo-error.png');return error;
  });
  await check('stop watching a demo turn never announces success',async()=>{
    // Fresh context excludes the unrelated 25-second demo fleet completion. The build
    // reply has several pending waits, so a real second click cannot race its terminal result.
    const abort=await newPage();try{
      await abort.page.locator('#ask').fill('build fixture');
      await abort.page.evaluate(()=>{window.__qaSendClicks=[];document.querySelector('#send').addEventListener('click',e=>__qaSendClicks.push({trusted:e.isTrusted,detail:e.detail,busy:nibbiApp.state().busy,done:nibbiApp.state().turns.at(-1)?.done||false,at:performance.now()}),true);});
      const box=await abort.page.locator('#send').boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;const cdp=await abort.context.newCDPSession(abort.page);
      const click=[{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1},{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1}];
      await Promise.all([...click,...click].map(event=>cdp.send('Input.dispatchMouseEvent',event)));await cdp.detach();
      const clicks=await abort.page.evaluate(()=>__qaSendClicks);assert.equal(clicks.length,2);assert.ok(clicks.every(c=>c.trusted&&c.detail===1));assert.equal(clicks[0].busy,false);assert.equal(clicks[1].busy,true,'second actual click reaches pending work');assert.equal(clicks[1].done,false);
      await abort.page.waitForFunction(()=>!nibbiApp.state().busy,null,{timeout:2500});const stopped=await qa.state(abort.page);
      assert.notEqual(stopped.interaction.lastEvent,'success');assert.equal(await abort.page.evaluate(()=>nibbiApp.state().turns.at(-1).done),true);assert.ok(!stopped.interaction.history.some(h=>['proud','ta-da','star'].includes(h.action)));assert.deepEqual(abort.network.mutations,[]);return {clicks,stopped,network:abort.network,...await qa.evidence(abort.page)};
    }finally{await abort.context.close();}
  });
  await check('visibility cancellation clears hold and pending previews',async()=>{
    await qa.settle(page);await page.locator('#fx').focus();await page.keyboard.down('Space');await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    const hidden=await qa.state(page);await page.waitForTimeout(800);await page.keyboard.up('Space');const later=await qa.state(page);assert.equal(later.interaction.holding,false);assert.equal(later.interaction.pendingTimers,0);assert.equal(later.interaction.actionSequence,hidden.interaction.actionSequence);
    await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});return {hidden,later};
  });
  await check('all real app paths avoid provider and action/agent/account mutations',async()=>{assert.deepEqual(network.mutations,[]);return {...network,...await qa.evidence(page)};});
  await context.close();
  const idle=await newPage();
  await check('real idle sleep timer followed by pointer movement wakes Nibbi',async()=>{
    await idle.page.clock.install();await idle.page.mouse.move(8,8);await idle.page.clock.fastForward(180100);assert.equal((await qa.state(idle.page)).mood,'sleep');await idle.page.mouse.move(12,12);const wake=await qa.semantic(idle.page,'wake');assert.equal(wake.interaction.lastAction,'wake');assert.equal(wake.mood,'idle');await shot(idle.page,'app-pointer-wake.png');return wake;
  });await idle.context.close();
  const mobile=await newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await check('touch-only connection menu reaches general calm preference',async()=>{await mobile.page.locator('#status').tap();await mobile.page.locator('#st-motion').tap();await mobile.page.waitForFunction(()=>nibbi.state().motion.reduced);await qa.noPanel(mobile.page);await shot(mobile.page,'app-mobile-preference.png');assert.deepEqual(mobile.network.mutations,[]);return qa.evidence(mobile.page);});await mobile.context.close();
  const legacy=await newPage();
  await check('legacy renderer accepts real character input without errors',async()=>{await qa.boot(legacy.page,fixture.base,'?nosw=1&demo=1&motion=legacy');await qa.tap(legacy.page);await legacy.page.locator('#fx').focus();await legacy.page.keyboard.press('Enter');assert.equal((await qa.state(legacy.page)).turns,0);await qa.noPanel(legacy.page);return qa.state(legacy.page);});await legacy.context.close();
  const completion=await newPage();
  await qa.boot(completion.page,fixture.base,'?nosw=1');
  await check('three actual read-only local command completions rotate success cues',async()=>{
    const records=[];for(const expected of ['proud','ta-da','star']){await qa.settle(completion.page);await completion.page.locator('#ask').fill('/help');await completion.page.locator('#send').click();await completion.page.waitForFunction(()=>!nibbiApp.state().busy);const s=await qa.semantic(completion.page,'success');assert.equal(s.interaction.lastAction,expected);records.push(s);}
    await shot(completion.page,'app-success-cycle.png');assert.deepEqual(completion.network.mutations,[]);return records;
  });
  await check('fixture run.updated events reach real merged milestone path and rotate',async()=>{
    const {runtime}=await import('../daemon/dist/store.js');const records=[];
    for(const [i,expected] of ['star','ta-da'].entries()){
      await qa.settle(completion.page);const run={...runtime().get('fixers','fixture-0'),id:`qa-merged-${i}`,status:'merged',title:`Isolated merged event ${i}`,game:'fixture',project:'fixture'};
      const event=runtime().emit({type:'run.updated',projectId:'fixture',runId:run.id,payload:{run}});
      const s=await qa.semantic(completion.page,'milestone');await qa.action(completion.page,expected);records.push({fixtureEvent:event,state:await qa.state(completion.page)});
    }
    await shot(completion.page,'app-fixture-milestone.png');assert.deepEqual(completion.network.mutations,[]);return records;
  });await completion.context.close();
  await check('source and built snapshot unchanged',async()=>qa.pin(root,results.sources));
  await check('no uncaught app errors',async()=>assert.deepEqual(results.pageErrors,[]));
}catch(e){results.checks.push({name:'runner',pass:false,error:e.message,stack:e.stack});console.error(e.stack);}
finally{await browser?.close();await fixture?.close();flush();}
console.log(JSON.stringify({out,passed:results.passed,failed:results.failed}));if(results.failed)process.exitCode=1;
