// Built UI acceptance in a browser with all network requests intercepted.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
const ui = resolve(process.env.NIBBI_SIDEBAR_UI || '/private/tmp/nibbi-sidebar-preview');
const out = resolve(process.env.NIBBI_SIDEBAR_OUTPUT || 'output/playwright/sidebar');
mkdirSync(out,{recursive:true});
const report={ui,checks:[],errors:[],mutations:[]};
const browser=await chromium.launch({channel:'chrome'});
const projects=[{name:'paper-garden',kind:'game',branch:'main'},{name:'observatory',kind:'game',branch:'v2'},{name:'weekend-notes',kind:'game',branch:'main'}];
const status={app:'nibbi',version:'0.8.0',busy:false,ctxTokens:12345,turns:7,sessionShort:'fixture',modelOverride:'fixture-model',costUsdTotal:1};
const auto=Object.fromEntries(projects.map(p=>[p.name,{on:false,mode:'off',inflight:0,pending:0,staged:0,spend:0,spendCap:0}]));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.webmanifest':'application/manifest+json'};
async function fixture(viewport, app=false) {
  const context=await browser.newContext({viewport,serviceWorkers:'block'}); const page=await context.newPage();
  page.setDefaultTimeout(6000);page.on('pageerror',e=>report.errors.push(e.message));
  await context.addInitScript(()=>{ window.EventSource=class extends EventTarget { constructor(){super();queueMicrotask(()=>this.dispatchEvent(new MessageEvent('ready',{data:'{}'})));} close(){} }; });
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url()),p=u.pathname;
    if(u.hostname!=='nibbi-sidebar.test')return route.abort();
    if(route.request().method()!=='GET'){
      if(p.startsWith('/nibbi/'))return route.fulfill({json:{ok:true}});
      report.mutations.push({path:p,body:route.request().postData()});
      if(p==='/api/send')return route.fulfill({contentType:'text/event-stream',body:'event: done\ndata: {"text":"Your notes are ready.","isError":false}\n\n'});
      return route.fulfill({status:403,json:{error:'Fixture blocks this mutation'}});
    }
    const data={'/api/snapshot':{cursor:0,status,projects,fixers:[],auto,goals:{}},'/api/status':status,'/api/projects':projects,'/api/fixers':[],'/api/auto':auto,'/api/goals':{},'/nibbi/goal':{},'/api/milestones':[{name:'A useful plan',done:2,total:7}],'/api/play':{playable:false,running:false},'/api/history':[], '/api/providers':{}};
    if(p in data)return route.fulfill({json:data[p]});
    if(p==='/api/events')return route.fulfill({contentType:'text/event-stream',body:'event: ready\ndata: {}\n\n'});
    if(p.startsWith('/api/')||p.startsWith('/nibbi/'))return route.fulfill({json:[]});
    const file=resolve(ui,'.'+(p==='/'?'/index.html':p));
    return existsSync(file)?route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:readFileSync(file)}):route.fulfill({status:404});
  });
  await page.goto('https://nibbi-sidebar.test/?nosw=1'+(app?'&app=1':''));
  await page.waitForFunction(()=>window.nibbiApp?.state().projects?.length===3);
  return {page,context};
}
async function bounds(page,selector) { const b=await page.locator(selector).boundingBox(),v=page.viewportSize();assert(b,selector+' exists'); assert(b.x>=-1&&b.y>=-1&&b.x+b.width<=v.width+1&&b.y+b.height<=v.height+1,selector+' fits '+JSON.stringify({b,v}));return b; }
async function shot(page,name){await page.evaluate(()=>Promise.all(document.querySelector('#workspace-sidebar').getAnimations().map(a=>a.finished.catch(()=>{}))));await page.waitForFunction(()=>Math.abs(nibbi.state().x-(innerWidth+(parseFloat(getComputedStyle(document.body).getPropertyValue('--workspace-left'))||0))/2)<3);await page.screenshot({path:resolve(out,name+'.png')});}
async function check(name,run){try{await run();report.checks.push({name,pass:true});console.log('PASS',name);}catch(e){report.checks.push({name,pass:false,error:e.stack});console.error('FAIL',name,e.message);}}
try {
 for(const [w,h] of [[1440,900],[1180,712],[900,680],[390,844],[320,568],[390,430]]) {
  const {page,context}=await fixture({width:w,height:h},w===1180);
  try { await check(`layout and navigation ${w}x${h}`,async()=>{
    await bounds(page,'#pill'); const dock=await bounds(page,'#dock'),ask=await bounds(page,'#ask'),send=await bounds(page,'#send');
    assert(dock.x+dock.width<=ask.x+1,'options button immediately left of the field');assert(ask.x+ask.width<=send.x+1,'field immediately left of Send');assert(Math.abs((dock.y+dock.height/2)-(send.y+send.height/2))<6,'controls aligned');assert(dock.height>=(w<=640?44:40)&&dock.width>=(w<=640?44:40),'options button target');assert(send.height>=44&&send.width>=44,'send target');
    assert.equal(await page.locator('#dock').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#dock-menu').isVisible(),false,'options panel closed at rest');
    await page.locator('#dock').click();assert.equal(await page.locator('#dock').getAttribute('aria-expanded'),'true');const menu=await bounds(page,'#dock-menu'),mic=await bounds(page,'#mic');
    assert(menu.y+menu.height<=dock.y+1,'options panel opens above the options button');assert(mic.height>=44,'Hey Nibbi row is a 44px target');assert.equal(await page.evaluate(()=>document.activeElement?.closest('#dock-menu')!==null),true,'focus moves into the panel');
    assert.equal(await page.locator('#mic').getAttribute('aria-pressed'),'false');assert.equal(await page.locator('#mic').innerText(),'Hey Nibbi');assert.equal(await page.locator('#plan-first').getAttribute('aria-pressed'),'false');
    await page.keyboard.press('Escape');assert.equal(await page.locator('#dock-menu').isVisible(),false,'Escape closes the panel');assert.equal(await page.evaluate(()=>document.activeElement?.id),'dock','Escape returns focus to the options button');
    assert.equal(await page.evaluate(()=>nibbi.state().character),'pool-velvet');
    assert.equal(await page.locator('.project-group').count(),3);
    for(const project of projects){
      const children=page.locator(`.project-section[data-section-project="${project.name}"]`);
      assert.deepEqual(await children.evaluateAll(els=>els.map(el=>el.dataset.projectSection)),['builds','issues','plans']);
    }
    assert.equal(await page.locator('[data-project-id="paper-garden"]').getAttribute('aria-expanded'),'true','initial active project expands its sections');
    await shot(page,`desktop-or-mobile-${w}x${h}`);
    await page.locator('#ask').fill('Keep this draft');
    if(w<900){await page.locator('#sidebar-toggle').click();await page.waitForFunction(()=>document.querySelector('#workspace-sidebar').getBoundingClientRect().x>=0);}
    await bounds(page,'#workspace-sidebar');await bounds(page,'#status');
    assert.equal(await page.locator('#settings-rail').evaluate(el=>el.closest('#workspace-sidebar')!==null),true);
    await page.locator('[data-project-id="observatory"]').click();
    assert.equal(await page.evaluate(()=>nibbiApp.state().project),'observatory');
    assert.equal(await page.locator('.margin-card:not([hidden])').count(),0,'project selection reveals sections without opening settings');
    assert.equal(await page.locator('[data-section-project="observatory"]:visible').count(),3);
    await page.getByRole('button',{name:'Project settings for observatory',exact:true}).click();
    await bounds(page,'.margin-card:not([hidden])');
    await page.keyboard.press('Escape');
    await page.locator('#status').click();await page.locator('#st-voice').waitFor({state:'visible'});
    await bounds(page,'.margin-card:not([hidden])');await shot(page,`settings-${w}x${h}`);
    await page.keyboard.press('Escape');await page.locator('.sidebar-collapse').click();
    assert.equal(await page.locator('#ask').inputValue(),'Keep this draft');assert.equal(await page.locator('#workspace-sidebar').evaluate(el=>el.inert),true);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'sidebar-toggle');
    await page.locator('#sidebar-toggle').press('Space');await page.waitForFunction(()=>document.querySelector('#workspace-sidebar').getBoundingClientRect().x>=0);
    assert.equal(await page.locator('[data-project-id="observatory"]').getAttribute('aria-current'),'true');
    if(w<900){assert.equal(await page.locator('#pill').evaluate(el=>el.inert),true);await page.locator('.sidebar-backdrop').click({position:{x:w-5,y:h/2}});assert.equal(await page.locator('#pill').evaluate(el=>el.inert),false);}
    else {const pill=await bounds(page,'#pill');assert(pill.x>=256);}
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  });} finally {await context.close();}
 }
 const {page,context}=await fixture({width:1440,height:900});
 try {
 await check('draft, send context, chat and collapse persistence',async()=>{
   await page.locator('[data-project-id="observatory"]').click();
   await page.locator('#ask').fill('A fixture message');await page.locator('#send').click();
   await page.waitForFunction(()=>nibbiApp.state().turns.length===1&&!nibbiApp.state().busy);
   assert.equal(JSON.parse(report.mutations.at(-1).body).project,'observatory');
   await page.locator('#ask').fill('A second draft');await page.locator('.sidebar-collapse').click();
   assert.equal(await page.locator('#ask').inputValue(),'A second draft');assert.equal(await page.locator('.turn').count(),1);
   await shot(page,'conversation-collapsed');await page.reload();
   await page.waitForFunction(()=>!!window.nibbiApp);assert.equal(await page.locator('#sidebar-toggle').isVisible(),true);
   await page.locator('#sidebar-toggle').click();await shot(page,'conversation-expanded');
 });
 }finally{await context.close();}
 assert.deepEqual(report.errors,[]);report.pass=report.checks.every(c=>c.pass);if(!report.pass)process.exitCode=1;
} catch(e){report.error=e.stack;process.exitCode=1;console.error(e);} finally {await browser.close();writeFileSync(resolve(out,'sidebar-results.json'),JSON.stringify(report,null,2));}
