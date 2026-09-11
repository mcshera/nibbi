// Pocket spring renderer + organic actual-app QA. Isolated fixture; providers are never called.
// Run from the repo: node tools/pocket-verify.mjs [--harness-only|--app-only] [--quick] [--headed]
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import * as appQA from './pocket-app-qa-helpers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = new Set(process.argv.slice(2));
const out = path.resolve(root, process.env.NIBBI_POCKET_QA_OUT || 'output/pocket-interactions');
mkdirSync(out, {recursive:true});
const expected = ['hello','nod','bow','peek','hop','boing','double-hop','triple-hop','squish','stretch','puff','star','drop','pancake','wiggle','giggle','ta-da','proud','curious','think','listen','yawn','wake','oops'];
const selected = args.has('--quick') ? ['hop','boing','star','pancake','yawn','oops'] : expected;
const fractions = [0,.10,.22,.36,.50,.65,.79,.92,1.08];
const report = {startedAt:new Date().toISOString(),command:process.argv,scope:{harness:!args.has('--app-only'),app:!args.has('--harness-only'),quick:args.has('--quick')},
  checks:[], samples:[], screenshots:[], browserErrors:[], warnings:[], limitations:[
    'Chromium automation, not Safari/WKWebView/Tauri certification or a real-GPU performance benchmark.',
    'Visibility is simulated through document.hidden plus visibilitychange in the isolated harness.',
    'Pixel edge checks detect sampled opaque clipping. They do not prove every fuzzy fringe pixel is inside bounds.',
    'Eye containment uses renderer diagnostics when available; the report records missing diagnostics.',
    'Screenshots/contact sheet are review evidence, not an automated proof that all gestures feel distinct.'
  ]};
const hash = data => createHash('sha256').update(data).digest('hex');
function recordSources() {
  report.sources = {};
  for (const relative of ['public/pocket-motion.js','public/nibbi.js','public/lib/pocket-interactions.js','public/app.js','public/index.html','tools/pocket-verify.mjs','dist/ui/pocket-motion.js','dist/ui/nibbi.js','tools/pocket-harness.html','docs/POCKET-INTERACTIONS-IMPLEMENTATION.md','tools/pocket-app-qa-helpers.mjs']) {
    const file = path.join(root,relative); report.sources[relative] = existsSync(file) ? {sha256:hash(readFileSync(file)),bytes:readFileSync(file).length} : {missing:true};
  }
}
recordSources();
const appSnapshot=report.scope.app?appQA.sources(root):null;
if(appSnapshot)report.appSnapshot=appSnapshot;
const harnessContent = Object.fromEntries(['tools/pocket-harness.html','public/pocket-motion.js','public/nibbi.js'].filter(relative=>existsSync(path.join(root,relative))).map(relative=>[relative,readFileSync(path.join(root,relative))]));
const runId = report.startedAt.replace(/[:.]/g,'-');
function flush() { report.finishedAt = new Date().toISOString(); report.passed = report.checks.filter(c=>c.ok).length; report.failed = report.checks.filter(c=>!c.ok).length; const json=JSON.stringify(report,null,2); writeFileSync(path.join(out,'results.json'),json); writeFileSync(path.join(out,`results-${runId}.json`),json); }
async function check(name, fn) {
  const start = performance.now();
  try { const detail = await fn(); report.checks.push({name,ok:true,milliseconds:Math.round(performance.now()-start),detail}); console.log('PASS',name); flush(); return detail ?? true; }
  catch (error) { report.checks.push({name,ok:false,milliseconds:Math.round(performance.now()-start),error:error.message,stack:error.stack}); console.error('FAIL',name,':',error.message); flush(); return null; }
}
function finite(value, where='state') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value),`${where} must be finite, got ${value}`);
  else if (value && typeof value === 'object') for (const [key,child] of Object.entries(value)) finite(child,`${where}.${key}`);
}
function near(a,b,tolerance,message) { assert.ok(Math.abs(a-b)<=tolerance,`${message}: ${a} versus ${b}`); }
function queueLength(queue) { return Array.isArray(queue) ? queue.length : queue ? 1 : 0; }
function poseCheck(p,reduced=false) {
  assert.ok(p && typeof p === 'object','motion.pose exists'); finite(p,'pose');
  for (const key of ['x','lift','sx','sy','rotate','lean','round','star','drop','satellite','trail','impact','eyeX','eyeY','blink','wide','happy']) assert.equal(typeof p[key],'number',`pose.${key} is numeric`);
  near(p.sx*p.sy,1,.002,'scale area');
  for (const k of ['sx','sy']) assert.ok(p[k]>=2/3-.001 && p[k]<=1.501,`${k} bounded: ${p[k]}`);
  for (const [key,limit] of [['x',.3],['rotate',.35],['lean',.35]]) assert.ok(Math.abs(p[key])<=limit+.001,`${key} bounded: ${p[key]}`);
  assert.ok(p.lift>=-.001 && p.lift<=1.101,`lift bounded: ${p.lift}`);
  assert.ok(p.wide>0 && p.wide<=1.141,`safe eye widening: ${p.wide}`);
  for (const key of ['round','star','drop','satellite','trail','impact','blink','happy']) assert.ok(p[key]>=-.001 && p[key]<=1.001,`${key} bounded: ${p[key]}`);
  if (reduced) {
    for (const key of ['x','lift','rotate','lean','round','star','drop','satellite','trail','impact','eyeX','eyeY','blink']) near(p[key],0,1e-8,`reduced ${key}`);
    near(p.sx,1,1e-8,'reduced sx'); near(p.sy,1,1e-8,'reduced sy');
  }
}
function assertCapture(c,scene,{pixels=true,reduced=false,visible=true}={}) {
  const s = c.state; finite(s); assert.equal(s.motion?.enabled,true,'Pocket spring renderer is enabled'); poseCheck(s.motion.pose,reduced);
  assert.ok(queueLength(s.motion.queue)<=1,'queue stays bounded');
  const b = s.bounds; assert.ok(b && ['left','top','right','bottom'].every(k=>Number.isFinite(b[k])),'finite rendered bounds');
  assert.ok(b.right>b.left && b.bottom>b.top,'bounds have positive area');
  assert.ok(b.left>=-1 && b.top>=-1 && b.right<=scene.width+1 && b.bottom<=scene.height+1,`body inside ${scene.name}: ${JSON.stringify(b)}`);
  near(s.r,scene.target.r,.02,'base radius does not auto-shrink during motion');
  assert.equal(c.hit.far,false,'far-away point misses'); assert.ok(c.hit.eyes.every(Boolean),'registered eye centers are hittable');
  const g = s.geometry;
  if (g?.faceContained !== undefined) assert.equal(g.faceContained,true,'face stays inside body');
  if (typeof g?.minFaceMargin === 'number') assert.ok(g.minFaceMargin>=-.01,`face margin ${g.minFaceMargin}`);
  if (typeof g?.eyeGap === 'number') assert.ok(g.eyeGap>0,`eyes stay separate: gap=${g.eyeGap}`);
  if (reduced && typeof s.particleCount === 'number') assert.equal(s.particleCount,0,'reduced mode clears all particles');
  if (pixels && visible) {
    for (const name of ['main','mirror','smallMirror','agent','smallAgent']) {
      const p = c.pixels[name]; assert.ok(p.alpha>8,`${name} has rendered ink (alpha samples ${p.alpha})`);
      assert.ok(p.edgeOpaque<=2,`${name} has opaque pixels on its crop edge (${p.edgeOpaque}); inspect clipping`);
    }
  }
}
function observe(page,label) {
  page.on('pageerror',e=>report.browserErrors.push({label,type:'pageerror',message:e.message}));
  page.on('console',m=>{ if (m.type()==='error' || /\[nibbi\].*frame error/i.test(m.text())) report.browserErrors.push({label,type:m.type(),message:m.text(),url:m.location().url}); else if(m.type()==='warning') report.warnings.push({label,message:m.text()}); });
}
let browser, fixture;
const harnessOrigin = 'http://pocket-qa.invalid';
async function harnessPage(scene,{force2D=false,missing=false,legacy=false,manual=true}={}) {
  const context = await browser.newContext({viewport:{width:scene.width,height:scene.height},deviceScaleFactor:scene.dpr||1,serviceWorkers:'block'});
  await context.route('**/*',route=>{
    const u = new URL(route.request().url());
    const files = {'/':'tools/pocket-harness.html','/pocket-motion.js':'public/pocket-motion.js','/nibbi.js':'public/nibbi.js'};
    if(u.pathname==='/favicon.ico')return route.fulfill({status:204,body:''});
    if (u.origin!==harnessOrigin || !(u.pathname in files)) return route.fulfill({status:404,body:''});
    if (missing && u.pathname==='/pocket-motion.js') return route.fulfill({contentType:'text/javascript',body:'/* Deliberately absent library: fallback test. */'});
    return route.fulfill({contentType:u.pathname==='/'?'text/html':'text/javascript',body:harnessContent[files[u.pathname]]});
  });
  const page = await context.newPage(); observe(page,`${scene.name}/${force2D?'2d':'gl'}`);
  await page.goto(harnessOrigin+'/' +(force2D?'?2d':'')); await page.waitForFunction(()=>window.pocketQA?.ready);
  const boot = await page.evaluate(options=>pocketQA.boot(options),{target:scene.target,force2D,legacy,manual,name:scene.name,energy:1.5});
  return {context,page,boot};
}
async function screenshot(page,name,clip) {
  const file = path.join(out,name+'.png'); await page.screenshot({path:file,...(clip?{clip}:{fullPage:true})}); report.screenshots.push(name+'.png'); return name+'.png';
}
const scenes = [
  {name:'hero',width:1280,height:900,target:{x:640,y:441,r:135}},
  {name:'talk',width:1280,height:900,target:{x:640,y:76,r:40}},
  {name:'mobile',width:390,height:844,target:{x:195,y:355,r:62}},
  {name:'mobile-talk',width:390,height:844,target:{x:195,y:69,r:34}}
];
async function runActionScene(scene,force2D) {
  const tag = `${force2D?'2d':'gl'}/${scene.name}`;
  const h = await harnessPage(scene,{force2D}); const {page} = h;
  try {
    await check(`${tag}: boot, catalog, manual clock and copies`,async()=>{
      assert.equal(h.boot.rafDuringBoot,0,'manual renderer must not schedule RAF');
      const data = await page.evaluate(()=>({catalog:nibbi.animations(),globalCatalog:NibbiPocketMotion.catalog}));
      assert.deepEqual(data.catalog.map(a=>a.id).sort(),[...expected].sort(),'exactly 24 renderer action IDs');
      assert.deepEqual(data.globalCatalog.map(a=>a.id).sort(),[...expected].sort());
      for(const a of data.catalog) assert.ok(a.label && a.group && a.description && Number.isFinite(a.duration) && a.duration>0,`complete descriptor: ${a.id}`);
      assertCapture(h.boot,scene); assert.equal(!!h.boot.state.gl,!force2D,'requested renderer backend');
      if(!h.boot.state.geometry?.faceContained && h.boot.state.geometry?.faceContained!==true) report.limitations.push(`${tag}: face containment diagnostic absent or false; inspect the check result.`);
      return {backend:h.boot.state.backend||h.boot.state.gl,geometry:!!h.boot.state.geometry};
    });
    for (const id of selected) await check(`${tag}: ${id} sampled through full action`,async()=>{
      const d = await page.evaluate(id=>nibbi.animations().find(a=>a.id===id).duration,id);
      const start = await page.evaluate(id=>pocketQA.play(id),id); assert.equal(start.admitted,true,`${id} admitted`);
      let previous = 0, peak = {score:-1,seconds:0}; const records = [];
      for (const fraction of fractions) {
        const seconds = d*fraction;
        const c = await page.evaluate(ms=>pocketQA.step(ms),Math.max(0,(seconds-previous)*1000)); previous=seconds;
        assertCapture(c,scene); const p=c.state.motion.pose;
        const score=p.lift+Math.abs(Math.log(p.sy))+.7*(p.star+p.drop)+.5*Math.abs(p.rotate);
        if(score>peak.score) peak={score,seconds};
        records.push({fraction,state:c.state,pixels:c.pixels,hit:c.hit});
      }
      report.samples.push({tag,id,duration:d,records});
      if (!force2D && scene.name==='hero') {
        await page.evaluate(({id,ms})=>{pocketQA.play(id);return pocketQA.step(ms);},{id,ms:peak.seconds*1000});
        await screenshot(page,`action-${id}`,{x:355,y:45,width:570,height:620});
      }
      return {frames:records.length,peak:peak.seconds,backend:h.boot.state.backend||h.boot.state.gl};
    });
    await screenshot(page,`scene-${force2D?'2d':'gl'}-${scene.name}`);
    await check(`${tag}: every action and legacy effect obey reduced motion`,async()=>{
      await page.evaluate(()=>{nibbi.setReducedMotion(true);nibbi.setMood('idle');pocketQA.step(0);});
      const cues = [...selected.map(id=>({kind:'action',id})),...['hop','shake','spatter','drip','splash','pulse','blink','lookAt','pointer'].map(id=>({kind:'api',id})),...['happy','error','working','speaking','sleep'].map(id=>({kind:'mood',id}))];
      for(const cue of cues) {
        const captures=await page.evaluate(cue=>{
          if(cue.kind==='action') nibbi.animate(cue.id,{priority:80,interrupt:true});
          else if(cue.kind==='mood') nibbi.setMood(cue.id);
          else if(cue.id==='splash') nibbi.splash([.5,.2,.1],6);
          else if(cue.id==='pulse') nibbi.pulse(1);
          else if(cue.id==='lookAt' || cue.id==='pointer') nibbi[cue.id](10,10);
          else nibbi[cue.id](6);
          const first=pocketQA.step(0),last=pocketQA.step(1000);return {first,last};
        },cue);
        assertCapture(captures.first,scene,{reduced:true}); assertCapture(captures.last,scene,{reduced:true});
        for(const name of ['main','mirror','smallMirror','agent','smallAgent']) assert.equal(captures.first.pixels[name].hash,captures.last.pixels[name].hash,`${cue.kind}/${cue.id}: ${name} remains static`);
        assert.equal(queueLength(captures.last.state.motion.queue),0,'reduced queue cleared');
      }
      return {cues:cues.length};
    });
    await check(`${tag}: reduced layout, fade and resize redraw`,async()=>{
      const next={x:scene.target.x+Math.min(35,scene.width*.05),y:scene.target.y+25,r:scene.target.r*.88};
      const moved=await page.evaluate(t=>{nibbi.setReducedMotion(true);return pocketQA.setTarget(t);},next);
      for(const key of ['x','y','r']) near(moved.state[key],next[key],.01,`reduced target ${key} snaps`);
      const hidden=await page.evaluate(()=>{nibbi.setFade(0);return pocketQA.step(0);});
      assert.equal(hidden.pixels.main.alpha,0,'faded main ink and face disappear'); assert.equal(hidden.pixels.mirror.alpha,0,'mirror receives main fade');
      const restored=await page.evaluate(()=>{nibbi.setFade(1);return pocketQA.step(0);}); assert.ok(restored.pixels.main.alpha>8,'fade restores ink and eyes');
      await page.setViewportSize({width:scene.width+20,height:scene.height+20});
      const resized=await page.evaluate(()=>pocketQA.step(0)); assert.ok(resized.pixels.main.alpha>8,'reduced resize redraws ink');
      near(resized.pixels.main.css.width,scene.width+20,.1,'canvas follows viewport');
      return {moved:moved.state,resized:resized.state};
    });
  } finally {await h.context.close();}
}
async function runLifecycle() {
  const scene=scenes[0],h=await harnessPage(scene);const {page}=h;
  try {
    await check('director: bounded queue, interruption and smooth stop',async()=>{
      const result=await page.evaluate(()=>{
        pocketQA.play('boing');pocketQA.step(450);const before=nibbi.state();
        nibbi.animate('nod',{priority:10});nibbi.animate('hello',{priority:10});nibbi.animate('nod',{priority:10});const queued=nibbi.state();
        nibbi.animate('oops',{priority:100,interrupt:true});const after=pocketQA.step(0).state;
        pocketQA.step(140);const preStop=nibbi.state();nibbi.stopAnimation();const stopped=pocketQA.step(0).state;const settled=pocketQA.step(1800).state;
        return {before,queued,after,preStop,stopped,settled};
      });
      for(const s of Object.values(result)){finite(s);poseCheck(s.motion.pose);assert.ok(queueLength(s.motion.queue)<=1);}
      for(const key of ['x','lift','sx','sy','rotate','lean']) {near(result.before.motion.pose[key],result.after.motion.pose[key],.04,`interruption no ${key} snap`);near(result.preStop.motion.pose[key],result.stopped.motion.pose[key],.04,`stop no ${key} snap`);}
      assert.equal(queueLength(result.settled.motion.queue),0); assert.ok(!result.settled.motion.action || ['idle','rest'].includes(result.settled.motion.action),'stop reaches ambient rest');
      return result;
    });
    await check('visibility: hidden manual time freezes, resume does not catch up',async()=>{
      const result=await page.evaluate(()=>{pocketQA.play('boing');const before=pocketQA.step(400);pocketQA.visibility(true);const hidden=pocketQA.step(8000);pocketQA.visibility(false);const after=pocketQA.step(80);return {before,hidden,after};});
      near(result.before.state.motion.elapsed,result.hidden.state.motion.elapsed,1e-9,'hidden elapsed');
      assert.deepEqual(result.before.state.motion.pose,result.hidden.state.motion.pose,'hidden pose frozen');
      assert.ok(result.after.state.motion.elapsed-result.before.state.motion.elapsed<=.081,'resume advances only its requested delta');
      return result;
    });
    await check('WebGL context loss keeps a usable character',async()=>{
      const supported=await page.evaluate(()=>pocketQA.contextLoss());
      if(!supported){report.limitations.push('WEBGL_lose_context extension absent; context-loss transition not exercised.');return {skipped:true};}
      await page.waitForFunction(()=>window.__qaLost===true,null,{timeout:2500});
      const c=await page.evaluate(()=>pocketQA.step(50));assert.equal(c.state.gl,false,'context loss selects fallback');assertCapture(c,scene);return {backend:c.state.backend};
    });
    await check('destroy: idempotent, no RAF or resize listener left',async()=>{
      await page.evaluate(()=>pocketQA.boot({manual:false,target:{x:640,y:441,r:135}}));
      await page.waitForFunction(()=>__qaRAF.requested>0);
      const result=await page.evaluate(()=>{const widths=[document.querySelector('#ink').width,document.querySelector('#fx').width];const destroyed=pocketQA.destroy();return {widths,destroyed};});
      assert.equal(result.destroyed.raf.pending,0,'renderer RAF cancelled');
      await page.setViewportSize({width:1300,height:920});
      const later=await page.evaluate(()=>({widths:[document.querySelector('#ink').width,document.querySelector('#fx').width],pending:__qaRAF.pending()}));
      assert.deepEqual(later.widths,result.widths,'destroy removed resize hook');assert.equal(later.pending,0);return result;
    });
  } finally {await h.context.close();}
  for(const kind of ['missing','legacy']) await check(`${kind} library escape hatch still renders ink`,async()=>{
    const h=await harnessPage(scene,{[kind]:true});try{assert.ok(h.boot.pixels.main.alpha>8,'fallback body stays visible');assert.notEqual(h.boot.state.motion?.enabled,true,'new motion disabled or legacy state shape');return {gl:h.boot.state.gl,motion:h.boot.state.motion};}finally{await h.context.close();}
  });
}
async function appScene(mobile=false) {
  const label=`built ${mobile?'mobile':'desktop'}`;
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},deviceScaleFactor:mobile?2:1,isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
  const page=await context.newPage();observe(page,label);const network=await appQA.instrument(page,fixture);
  try {
    await appQA.boot(page,fixture.base,'?nosw=1');
    await check(`${label}: organic greeting, no panel and body/background gating`,async()=>{
      await appQA.semantic(page,'greet');assert.equal((await appQA.state(page)).interaction.lastAction,'hello');await appQA.noPanel(page);
      await appQA.settle(page);const before=await appQA.state(page);
      if(mobile)await page.touchscreen.tap(8,180);else await page.mouse.click(8,180);
      const after=await appQA.state(page);assert.deepEqual(after.interaction,before.interaction,'blank canvas cannot interact');
      await screenshot(page,mobile?'app-mobile-idle':'app-desktop-idle');return {before,after};
    });
    await check(`${label}: center, crown, left, right and feet respond to real ${mobile?'touch':'pointer'}`,async()=>{
      const records=[];for(const [id,x,y] of [['hop',0,0],['puff',0,-.65],['peek',-.65,0],['curious',.65,0],['squish',0,.65]]){await appQA.settle(page);const p=await appQA.tap(page,x,y,mobile);records.push({id,p,state:await appQA.action(page,id)});}return records;
    });
    await check(`${label}: rapid taps escalate without legacy double-click tidy`,async()=>{
      await appQA.settle(page);const turns=(await appQA.state(page)).turns;const records=[];
      for(const id of ['hop','double-hop','triple-hop']){await appQA.tap(page,0,0,mobile);records.push(await appQA.action(page,id));}
      assert.equal((await appQA.state(page)).turns,turns);return records;
    });
    await check(`${label}: hold preview, long hold and release`,async()=>{
      await appQA.settle(page);const p=await appQA.point(page);let cdp;
      if(mobile){cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y}]});}else{await page.mouse.move(p.x,p.y);await page.mouse.down();}
      await page.waitForTimeout(230);const preview=await appQA.action(page,'squish');await page.waitForTimeout(520);const held=await appQA.action(page,'pancake');
      if(mobile){await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}else await page.mouse.up();
      return {preview,held,release:await appQA.action(page,'boing')};
    });
    await check(`${label}: upward flick/pull, downward and horizontal drag`,async()=>{
      const records=[];for(const [dx,dy,slow,preview,release] of [[0,-.95,false,'stretch','boing'],[0,-.95,true,'stretch','drop'],[0,.95,false,'pancake','puff'],[.95,0,false,'wiggle','wiggle']]){
        await appQA.settle(page);const r=await appQA.drag(page,dx,dy,{slow,touch:mobile});assert.ok(r.actions.some(a=>a.action===preview),`${preview} preview in ${JSON.stringify(r)}`);await appQA.action(page,release);records.push(r);
      }await screenshot(page,mobile?'app-mobile-drag':'app-desktop-drag');return records;
    });
    if(!mobile)await check(`${label}: gentle back-and-forth strokes tickle once`,async()=>{
      await appQA.settle(page);const p=await appQA.point(page);await page.mouse.move(p.x,p.y);
      for(const direction of [1,-1,1,-1,1]){await page.waitForTimeout(130);await page.mouse.move(p.x+direction*p.r*.30,p.y);}
      const first=await appQA.action(page,'giggle');return first;
    });
    await check(`${label}: keyboard tap, hold/release and Escape cancellation do not send chat`,async()=>{
      await appQA.settle(page);await page.locator('#fx').focus();await page.keyboard.press('Enter');const enter=await appQA.action(page,'hop');
      await appQA.settle(page);await page.keyboard.down('Space');await page.waitForTimeout(750);const held=await appQA.action(page,'pancake');await page.keyboard.up('Space');await appQA.action(page,'boing');
      await appQA.settle(page);await page.keyboard.down('Space');await page.keyboard.press('Escape');const cancelled=await appQA.state(page);await page.keyboard.up('Space');await page.waitForTimeout(800);const later=await appQA.state(page);
      assert.equal(later.interaction.holding,false);assert.equal(later.interaction.lastAction,cancelled.interaction.lastAction,'cancelled hold has no deferred preview/release');assert.equal(later.turns,0);return {enter,held,cancelled,later};
    });
    await check(`${label}: zero-detail assistive activation and body-following focus ring`,async()=>{
      await appQA.settle(page);await page.locator('#fx').focus();await page.locator('#fx').evaluate(el=>el.click());const activated=await appQA.action(page,'hop');
      const ring=await page.evaluate(()=>{const b=nibbi.state().geometry.bodyBounds;const el=[...document.body.children].find(el=>el.getAttribute('aria-hidden')==='true'&&el.style.borderRadius==='45%');if(!el)return null;const r=el.getBoundingClientRect();return {hidden:el.hidden,pointer:getComputedStyle(el).pointerEvents,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},body:b};});
      assert.ok(ring&&!ring.hidden);assert.equal(ring.pointer,'none');await screenshot(page,mobile?'app-mobile-keyboard-focus':'app-desktop-keyboard-focus');return {activated,ring};
    });
    await check(`${label}: pointer cancel and outside release clear capture/timers`,async()=>{
      await appQA.settle(page);const p=await appQA.point(page);const cdp=await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await cdp.detach();
      const cancelled=await appQA.state(page);await page.waitForTimeout(800);const later=await appQA.state(page);assert.equal(later.interaction.holding,false);assert.equal(later.interaction.lastAction,cancelled.interaction.lastAction);
      await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(8,8);await page.mouse.up();assert.equal((await appQA.state(page)).interaction.holding,false);return {cancelled,later};
    });
    await check(`${label}: OS calm cancels active input and blocks deferred motion`,async()=>{
      await appQA.settle(page);const p=await appQA.point(page);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.emulateMedia({reducedMotion:'reduce'});await page.mouse.up();await page.waitForTimeout(800);
      await appQA.tap(page,0,0,mobile);poseCheck(await page.evaluate(()=>nibbi.state().motion.pose),true);assert.equal((await appQA.state(page)).interaction.holding,false);
      await screenshot(page,mobile?'app-mobile-calm':'app-desktop-calm');await page.emulateMedia({reducedMotion:'no-preference'});return appQA.state(page);
    });
    await check(`${label}: local interaction makes no action/agent/account mutations`,async()=>{assert.deepEqual(network.mutations,[]);return {...network,...await appQA.evidence(page)};});
  }finally{await context.close();}
}
async function contactSheet() {
  const items=report.screenshots.filter(name=>name.startsWith('action-'));
  if(!items.length)return;
  const html=`<!doctype html><meta charset="utf-8"><title>Pocket spring QA contact sheet</title><style>body{background:#f5f2ec;color:#252820;margin:24px;font:13px system-ui}h1{font-size:24px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}figure{margin:0;border:1px solid #d8d9cf;background:#faf8f3}img{width:100%;display:block}figcaption{padding:8px}p{max-width:950px}</style><h1>Pocket spring · 24 action samples</h1><p>Selected high-amplitude frame per action at hero radius 135, energy 1.5. These stills do not prove choreography or motion quality. See results.json for sampled states, clipping checks, backend and source hashes.</p><div class="grid">${items.map(name=>`<figure><img src="${name}"><figcaption>${name.replace('action-','').replace('.png','')}</figcaption></figure>`).join('')}</div>`;
  writeFileSync(path.join(out,'contact-sheet.html'),html);
  const page=await browser.newPage({viewport:{width:1280,height:1000}});
  await page.route('http://pocket-evidence.invalid/**',route=>{const pathname=new URL(route.request().url()).pathname;return route.fulfill({contentType:pathname.endsWith('.png')?'image/png':'text/html',body:pathname==='/'?html:readFileSync(path.join(out,path.basename(pathname)))});});
  await page.goto('http://pocket-evidence.invalid/');await page.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
  await page.screenshot({path:path.join(out,'contact-sheet.png'),fullPage:true});await page.close();report.screenshots.push('contact-sheet.png');
}
try {
  browser=await chromium.launch({channel:process.env.NIBBI_QA_CHANNEL||(process.env.CI?undefined:'chrome'),headless:!args.has('--headed'),args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  report.browser={version:browser.version(),requestedRenderer:'ANGLE SwiftShader (software)',headless:!args.has('--headed')};
  if(report.scope.harness){for(const force2D of [false,true])for(const scene of scenes)await runActionScene(scene,force2D);await runLifecycle();await contactSheet();}
  if(report.scope.app){
    await check('built UI corresponds to current motion sources',async()=>{for(const name of ['pocket-motion.js','nibbi.js'])assert.equal(hash(readFileSync(path.join(root,'dist/ui',name))),hash(readFileSync(path.join(root,'public',name))),`${name}: run npm run build before app QA`);});
    const {testBackend}=await import('./test-backend.mjs');fixture=await testBackend();report.fixture={isolated:true};await appScene(false);await appScene(true);
  }
  await check('production source snapshot stayed unchanged during QA',async()=>{for(const relative of ['public/pocket-motion.js','public/nibbi.js',...(report.scope.app?['public/app.js','public/lib/pocket-interactions.js','public/index.html']:[])])assert.equal(hash(readFileSync(path.join(root,relative))),report.sources[relative].sha256,`${relative} changed during QA; rerun the candidate snapshot`);if(appSnapshot)appQA.pin(root,appSnapshot);});
  await check('no unexpected browser or renderer frame errors',async()=>assert.deepEqual(report.browserErrors,[]));
} catch(error){report.checks.push({name:'runner fatal',ok:false,error:error.message,stack:error.stack});console.error(error.stack);}
finally {await browser?.close();await fixture?.close();flush();}
console.log(JSON.stringify({out,passed:report.passed,failed:report.failed,checks:report.checks.length,quick:report.scope.quick},null,2));
if(report.failed)process.exitCode=1;
