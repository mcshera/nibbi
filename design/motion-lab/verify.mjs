// Browser integration/visual checks for the isolated lab. Run with the local server up.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = process.env.NIBBI_MOTION_URL || 'http://127.0.0.1:4536/design/motion-lab/';
const out = fileURLToPath(new URL('./evidence/', import.meta.url));
await mkdir(out, {recursive:true});
const browser = await chromium.launch({channel:process.env.CI ? undefined : 'chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results = {checks:[], errors:[], warnings:[], environment:'Chrome, SwiftShader (software WebGL), local macOS; not a real-device performance benchmark'};
const check = (name, detail={}) => { results.checks.push({name, ...detail}); console.log('PASS',name); };
const collect = page => { page.on('pageerror',e => results.errors.push(e.message)); page.on('console',m => { if(m.type()==='error') results.errors.push(m.text()); else if(m.type()==='warning') results.warnings.push(m.text()); }); };
try {
  const page = await browser.newPage({viewport:{width:1440,height:1180},deviceScaleFactor:1}); collect(page);
  await page.goto(base); await page.waitForFunction(() => window.motionLab?.ready); await page.evaluate(() => document.fonts.ready);
  let snap = await page.evaluate(() => motionLab.seek('idle',0,{time:0}));
  assert(snap.styles.every(s => s.renderer.backend === 'webgl'));
  check('All three styles compile and use WebGL');
  await page.screenshot({path:out+'desktop.png',fullPage:true});
  const geometry = await page.evaluate(() => {
    const bad = [], stats = {samples:0,minFit:1,minEyeMargin:Infinity};
    for (const action of motionLab.actions) for (const energy of [.5,1,1.5]) for (const fraction of [0,.12,.25,.38,.5,.63,.76,.9,1]) {
      const s = motionLab.seek(action.id,fraction,{intensity:energy});
      for (const c of s.styles) {
        const g = c.renderer.geometry; stats.samples++; stats.minFit = Math.min(stats.minFit,g.fitScale);
        stats.minEyeMargin = Math.min(stats.minEyeMargin,g.minFaceMargin);
        if (!g.inBounds || !g.faceContained || !Number.isFinite(g.radius) || g.radius <= 0) bad.push({action:action.id,energy,fraction,id:c.id,g});
        if (70/135 - 58.9/135*c.pose.wide <= 0) bad.push({eyeWhiteOverlap:c.id,action:action.id,fraction,energy});
        for (const p of g.eyeCenters) if(p.x<g.bodyBounds.left || p.x>g.bodyBounds.right || p.y<g.bodyBounds.top || p.y>g.bodyBounds.bottom) bad.push({eyeOutsideBodyBox:c.id,action:action.id,fraction});
      }
    }
    return {bad, ...stats};
  });
  assert.equal(geometry.bad.length,0,JSON.stringify(geometry.bad.slice(0,2)));
  check('486 poses: bounds, full eye-outline containment, separate eye whites, all actions / energies',geometry);
  // Test actual pixels independently of the renderer's conservative geometry report.
  const pixels = await page.evaluate(() => {
    const failures = []; let count=0;
    for(const action of ['hop','morph','success']) for(const fraction of [.17,.34,.5,.7,.84]) {
      motionLab.seek(action,fraction,{intensity:1.5});
      for(const canvas of document.querySelectorAll('.stage canvas')) {
        const {width:w,height:h}=canvas, data=canvas.getContext('2d').getImageData(0,0,w,h).data;
        let ink=0,edge=0;
        for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(data[(y*w+x)*4+3]>32){ink++;if(x<2||y<2||x>=w-2||y>=h-2)edge++;}
        count++;if(ink<200||edge) failures.push({action,fraction,ink,edge});
      }
    }
    return {count,failures};
  });
  assert.equal(pixels.failures.length,0,JSON.stringify(pixels));check('45 high-energy pixel readbacks: visible ink, no edge clipping',pixels);
  await page.evaluate(() => motionLab.seek('hop',.4,{intensity:1}));
  await page.click('[data-action="morph"]');
  await page.waitForFunction(() => motionLab.snapshot().elapsed > .05);
  await page.click('[data-action="success"]');
  assert((await page.evaluate(() => motionLab.snapshot().queue)).includes('success'));
  check('A repeated cue queues rather than resetting an active gesture');
  await page.click('#pause'); assert(await page.evaluate(() => motionLab.snapshot().paused));
  const still1 = await page.evaluate(() => ({clock:motionLab.snapshot().clock,frames:motionLab.snapshot().frames}));
  // Two browser frame opportunities: no long sleeps or timing-only completion guesses.
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const still2 = await page.evaluate(() => ({clock:motionLab.snapshot().clock,frames:motionLab.snapshot().frames}));
  assert.deepEqual(still1,still2);check('Pause stops animation scheduling');
  await page.locator('#scrub').fill('430'); await page.locator('#scrub').dispatchEvent('input');
  assert.equal(await page.evaluate(() => motionLab.snapshot().inspection),.43);check('Timeline scrubs and pauses');
  await page.check('#loop'); assert(await page.evaluate(() => motionLab.snapshot().paused && motionLab.snapshot().inspection===.43)); await page.uncheck('#loop');check('Loop setting preserves an inspected pause');
  await page.selectOption('#speed','0.5'); assert.equal(await page.evaluate(() => motionLab.snapshot().speed),.5);check('Half-speed control changes playback');
  await page.selectOption('#texture','boil'); assert.equal(await page.evaluate(() => motionLab.snapshot().styles[0].renderer.texture.mode),'boil');check('Texture comparison control');
  const before = await page.locator('[data-style="liquid"] .choose').getAttribute('aria-pressed');
  await page.click('[data-style="liquid"] .choose');
  assert.notEqual(await page.locator('[data-style="liquid"] .choose').getAttribute('aria-pressed'),before);check('Shortlist selection updates');
  await page.click('#reduced');
  const reduced1 = await page.evaluate(() => [...document.querySelectorAll('.stage canvas')].map(c => c.toDataURL()));
  await page.evaluate(() => motionLab.seek('success',.65,{reduced:true,time:12}));
  const reduced2 = await page.evaluate(() => [...document.querySelectorAll('.stage canvas')].map(c => c.toDataURL()));
  assert.deepEqual(reduced1,reduced2);check('Reduced mode freezes body, shapes, particles, face and texture across times/cues');
  await page.screenshot({path:out+'reduced-motion.png',fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.reload();await page.waitForFunction(() => window.motionLab?.ready);
  assert.equal(await page.evaluate(() => motionLab.snapshot().reduced),true);check('OS reduced-motion preference honored at load');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForFunction(() => !motionLab.snapshot().reduced);
  assert.equal(await page.evaluate(() => motionLab.snapshot().reduced),false);check('OS preference change updates policy');
  await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})); window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})); });
  assert((await page.evaluate(() => motionLab.seek('hop',.4))).styles.every(s => !s.renderer.destroyed));check('Persisted page transition preserves the renderer');
  await page.goto(base+'baseline.html');await page.waitForFunction(() => window.nibbi);
  await page.goBack();await page.waitForFunction(() => window.motionLab?.ready);
  assert((await page.evaluate(() => motionLab.seek('morph',.3))).styles.every(s => !s.renderer.destroyed && s.renderer.geometry.inBounds));check('Original-engine reference and browser Back remain usable');
  // Contact sheets are actual renderer output, not drawings of intended poses.
  for(const action of ['hop','morph']){
    const url = await page.evaluate(async action => {
      const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=805;const ctx=canvas.getContext('2d');
      ctx.fillStyle='#f5f2ec';ctx.fillRect(0,0,1440,805);ctx.fillStyle='#252820';ctx.font='30px Geist';ctx.fillText(`Nibbi / ${action === 'hop' ? 'Jump' : 'Shapeshift'} studies`,28,45);
      ctx.font='13px Geist';ctx.fillStyle='#727468';ctx.fillText('Actual prototype frames · same percentage of each gesture · energy 1×',28,73);
      const phases=[0,.16,.32,.49,.71,.96];
      const names=['01 Pocket spring','02 Living ink','03 Little oddball'];
      for(let row=0;row<3;row++){
        ctx.fillStyle='#3d5641';ctx.font='14px Geist';ctx.fillText(names[row],28,109+row*227);
        for(let col=0;col<phases.length;col++){
          const s=motionLab.seek(action,phases[col],{intensity:1,reduced:false,texture:'flow'});
          const src=document.querySelectorAll('.stage canvas')[row];const x=col*238+15,y=117+row*227;
          ctx.drawImage(src,x,y,225,165);
          ctx.fillStyle='#727468';ctx.font='11px GeistMono';ctx.fillText(`${Math.round(phases[col]*100)}% · ${s.styles[row].pose.phase}`,x+9,y+187);
        }
      }
      return canvas.toDataURL('image/png');
    },action);
    await writeFile(out+action+'-storyboard.png',Buffer.from(url.split(',')[1],'base64'));
  }
  check('Jump and shapeshift contact sheets exported');
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(() => motionLab.seek('morph',.45,{intensity:1.5}));
  const mobile = await page.evaluate(() => ({width:innerWidth,doc:document.documentElement.scrollWidth,styles:motionLab.snapshot().styles.map(c=>({id:c.id,bounds:c.renderer.geometry.inBounds}))}));
  assert(mobile.doc<=mobile.width);assert(mobile.styles.every(s=>s.bounds));
  await page.locator('[data-style="mischief"]').scrollIntoViewIfNeeded();
  const controlY=await page.locator('.bench').evaluate(e=>e.getBoundingClientRect().top);assert(controlY>=0 && controlY<12);
  await page.locator('#scrub-mobile').fill('500');await page.locator('#scrub-mobile').dispatchEvent('input');
  assert.equal(await page.evaluate(() => motionLab.snapshot().inspection),.5);check('Mobile sticky controls and scrub remain usable at the third card');
  await page.screenshot({path:out+'mobile-inspect.png'});
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:out+'mobile.png',fullPage:true});check('390px mobile layout: no horizontal overflow or shape clipping',mobile);
  await page.setViewportSize({width:768,height:1024});await page.evaluate(() => motionLab.seek('hop',.42,{intensity:1.5}));
  assert(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth));check('768px tablet layout has no horizontal overflow');
  await page.close();
  const fallback=await browser.newPage({viewport:{width:1100,height:1000},deviceScaleFactor:2});collect(fallback);
  await fallback.goto(base+'?2d');await fallback.waitForFunction(() => window.motionLab?.ready);
  snap=await fallback.evaluate(() => motionLab.seek('morph',.45,{intensity:1.5}));
  assert(snap.styles.every(s=>s.renderer.backend==='canvas2d' && s.renderer.geometry.inBounds && s.renderer.dpr===2));
  await fallback.screenshot({path:out+'fallback.png',fullPage:true});check('Forced Canvas2D fallback renders all three at DPR2 without geometry clipping');
  await fallback.close();
  assert.equal(results.errors.length,0,JSON.stringify(results.errors));check('No page or console errors');
  results.ok=true;
}catch(error){results.ok=false;results.failure=error.stack;console.error(error);process.exitCode=1;}
finally{await writeFile(out+'browser-results.json',JSON.stringify(results,null,2));await browser.close();}
