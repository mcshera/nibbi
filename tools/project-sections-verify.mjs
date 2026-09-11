// Browser acceptance with fixture data; every request stays inside this harness.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
const preparation=JSON.parse(readFileSync('output/project-sections-install/candidate-preparation.json'));
const ui=resolve(process.env.NIBBI_PROJECT_UI || preparation.candidate);
const out=resolve(process.env.NIBBI_PROJECT_OUTPUT || 'output/playwright/project-sections');mkdirSync(out,{recursive:true});
const report={ui,checks:[],errors:[],mutations:[]};
const browser=await chromium.launch({channel:'chrome'});
const projects=[{name:'paper-garden',kind:'game'},{name:'observatory',kind:'project'},{name:'weekend-notes',kind:'project'}];
const status={busy:false,ctxTokens:12345,turns:7,sessionShort:'fixture',modelOverride:'fixture-model',costUsdTotal:1};
const runs=[{id:'garden-2',game:'paper-garden',title:'Give the seedlings room to grow',status:'staged',startedAt:'2026-09-09T10:00:00Z',provider:'codex',costUsd:.17,summary:'Adjusted seedling spacing and kept keyboard controls working.'},{id:'garden-1',project:'paper-garden',title:'Let the garden remember its visitors',status:'merged',startedAt:'2026-09-08T10:00:00Z',verification:{status:'passed'}},{id:'observatory-1',project:'observatory',title:'Private observatory build',status:'failed'}];
const issues='# Garden issues\nKeep the garden calm and easy to explore.\n\n## Growing\n- [ ] Seedlings overlap near the edge <!-- nibbi-task:abc -->\n  Reproduce with a full garden.\n- [x] Remember returning visitors\n- [ ] Keyboard focus disappears after watering\n';
const plan='# A small garden, growing slowly\nMake returning to the garden feel familiar.\n\n## First shoots\n- [x] Remember the last visit <!-- nibbi-task:def -->\n- [ ] Give seedlings room\n\n## A place to return to\n- [ ] Add a quiet evening palette\n';
const documents={'games/paper-garden/issues.md':issues,'plans/paper-garden.md':plan,'projects/observatory/issues.md':'# Observatory notes\nKeep this prose-only issue notebook.','plans/observatory.md':'# Observatory direction\nA prose-only roadmap still counts as a plan.'};
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.webmanifest':'application/manifest+json'};
async function fixture(viewport){
 const context=await browser.newContext({viewport,serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(6500);
 const mode={failIssues:false,failPlan:false,failMilestones:false,failBuilds:false,delayPlan:0,delaySend:0};const requests=[];
 page.on('pageerror',e=>report.errors.push(e.message));
 await context.addInitScript(()=>{window.EventSource=class extends EventTarget{constructor(){super();queueMicrotask(()=>this.dispatchEvent(new MessageEvent('ready',{data:'{}'})));}close(){}};});
 await context.route('**/*',async route=>{
  const request=route.request(),u=new URL(request.url()),p=u.pathname;requests.push({path:p,search:u.search,method:request.method()});
  if(u.hostname!=='nibbi-projects.test')return route.abort();
  const fail=()=>route.fulfill({status:503,json:{error:'Fixture read unavailable'}});
  if(request.method()!=='GET'){
   if(p==='/nibbi/vault-write'){report.mutations.push({path:p,body:request.postData()});return route.fulfill({json:{ok:true}});}
   if(p.startsWith('/nibbi/'))return route.fulfill({json:{ok:true}});
   report.mutations.push({path:p,body:request.postData()});
   if(p==='/api/send'){if(mode.delaySend)await new Promise(r=>setTimeout(r,mode.delaySend));return route.fulfill({contentType:'text/event-stream',body:'event: done\ndata: {"text":"Your garden notes are ready.","isError":false}\n\n'});}
   return route.fulfill({status:403,json:{error:'Mutation blocked by fixture'}});
  }
  if(p==='/api/vault'){
   const path=u.searchParams.get('p');
   if(path.startsWith('plans/')&&mode.delayPlan)await new Promise(r=>setTimeout(r,mode.delayPlan));
   if(path.endsWith('issues.md')&&mode.failIssues||path.startsWith('plans/')&&mode.failPlan)return fail();
   return route.fulfill({json:{content:documents[path]||'(missing)'}});
  }
  if(p==='/api/milestones')return mode.failMilestones?fail():route.fulfill({json:u.searchParams.get('project')==='paper-garden'?[{name:'First shoots',done:1,total:2},{name:'A place to return to',done:0,total:1}]:[]});
  if(p==='/api/fixers')return mode.failBuilds?fail():route.fulfill({json:runs});
  if(p==='/api/artifacts')return mode.failBuilds?fail():route.fulfill({json:{changes:runs,files:[{name:'Private global export',path:'private-export.txt'}]}});
  if(p==='/api/fixer-log')return route.fulfill({json:{entries:[{kind:'assistant',text:'Build log fixture: the seedlings now fit.'}]}});
  if(p==='/api/fixer-diff')return route.fulfill({json:{diffstat:'garden.js | 2 ++',diff:'diff --git a/garden.js b/garden.js\n--- a/garden.js\n+++ b/garden.js\n@@ -1 +1 @@\n-old\n+new\n',target:'main'}});
  const data={'/api/snapshot':{cursor:0,status,projects,fixers:runs,auto:{},goals:{}},'/api/status':status,'/api/projects':projects,'/api/auto':{},'/api/goals':{},'/nibbi/goal':{},'/api/play':{playable:false,running:false},'/api/history':[], '/api/providers':{}};
  if(p in data)return route.fulfill({json:data[p]});
  if(p.startsWith('/api/')||p.startsWith('/nibbi/'))return route.fulfill({json:[]});
  const file=resolve(ui,'.'+(p==='/'?'/index.html':p));
  return existsSync(file)?route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:readFileSync(file)}):route.fulfill({status:404});
 });
 await page.goto('https://nibbi-projects.test/?nosw=1'+(viewport.width===1180?'&app=1':''));
 await page.waitForFunction(()=>window.nibbiApp?.state().projects?.length===3);return{page,context,mode,requests};
}
async function ready(page,section){await page.waitForFunction(section=>nibbiApp.state().projectView?.section===section&&document.querySelector('#project-workspace').getAttribute('aria-busy')==='false',section);}
async function open(page,project,section){
 if(await page.locator('#sidebar-toggle').isVisible()){await page.locator('#sidebar-toggle').click();await page.waitForFunction(()=>document.querySelector('#workspace-sidebar').getBoundingClientRect().x>=0);}
 const row=page.locator(`[data-project-id="${project}"]`);if(await row.getAttribute('aria-expanded')!=='true')await row.click();
 await page.locator(`[data-section-project="${project}"][data-project-section="${section}"]`).click();await ready(page,section);
 assert.equal(await page.locator('#project-workspace-title').innerText(),project);
}
async function tab(page,section){await page.locator(`[data-workspace-section="${section}"]`).click();await ready(page,section);}
async function shot(page,name){await page.evaluate(()=>Promise.all(document.querySelector('#workspace-sidebar').getAnimations().map(a=>a.finished.catch(()=>{}))));await page.waitForFunction(()=>{const s=nibbi.state();return Math.abs(s.y-s.ty)<2&&Math.abs(s.x-s.tx)<2&&Math.abs(s.r-s.tr)<1;});await page.screenshot({path:resolve(out,name+'.png')});}
async function fits(page,selector){const b=await page.locator(selector).boundingBox(),v=page.viewportSize();assert(b,selector);assert(b.x>=-1&&b.y>=-1&&b.x+b.width<=v.width+1&&b.y+b.height<=v.height+1,selector+' outside viewport '+JSON.stringify(b));return b;}
async function check(name,run){try{await run();report.checks.push({name,pass:true});console.log('PASS',name);}catch(e){report.checks.push({name,pass:false,error:e.stack});console.error('FAIL',name,e.message);}}
try{
 for(const [width,height]of[[1440,900],[1180,712],[390,844],[320,568],[390,430]]){
  const {page,context}=await fixture({width,height});
  try{await check(`three sections fit ${width}x${height}`,async()=>{
   await page.locator('#ask').fill('A draft worth keeping');await open(page,'paper-garden','builds');
   assert.equal(await page.locator('#ask').inputValue(),'A draft worth keeping');assert.equal(await page.locator('#project-workspace').evaluate(el=>el.inert),false);
   if(width<900){assert.equal(await page.locator('#pill').evaluate(el=>el.inert),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'project-workspace-title');}
   assert.equal(await page.locator('.project-build').count(),2);assert(!/Private/.test(await page.locator('.project-content').innerText()));
   await page.locator('[data-build-id="garden-2"] summary').click();assert.match(await page.locator('[data-build-id="garden-2"]').innerText(),/Checks: unverified/);
   await fits(page,'#project-workspace');const area=await fits(page,'.project-workspace-body'),pill=await fits(page,'#pill');assert(area.height>=60);assert(area.y+area.height<=pill.y);
   await shot(page,`builds-${width}x${height}`);await tab(page,'issues');assert.equal(await page.locator('.project-issue').count(),2);
   await shot(page,`issues-${width}x${height}`);await tab(page,'plans');assert.match(await page.locator('.project-summary').innerText(),/1 of 3 tasks complete/);
   assert.equal(await page.locator('.project-milestone').count(),2);assert(!/nibbi-task/.test(await page.locator('.project-document').innerText()));await shot(page,`plans-${width}x${height}`);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.getByRole('button',{name:'Back to chat',exact:true}).click();assert.equal(await page.locator('#project-workspace').isVisible(),false);assert.equal(await page.locator('#ask').inputValue(),'A draft worth keeping');assert.equal(await page.evaluate(()=>nibbi.state().character),'pool-velvet');
  });}finally{await context.close();}
 }
 const f=await fixture({width:1440,height:900}),{page,context,mode}=f;
 try{
  await check('issue filters, full notes and project isolation',async()=>{
   await open(page,'paper-garden','issues');await page.locator('[data-filter="done"]').click();assert.equal(await page.locator('.project-issue').count(),1);assert.match(await page.locator('.project-issue').innerText(),/returning visitors/);
   await page.locator('[data-filter="all"]').click();assert.equal(await page.locator('.project-issue').count(),3);await page.locator('.project-source summary').click();assert.match(await page.locator('.project-document').innerText(),/Reproduce with a full garden/);
   await open(page,'observatory','issues');assert.match(await page.locator('.project-document').innerText(),/prose-only issue notebook/);assert.equal(await page.locator('.project-issue').count(),0);
   await tab(page,'plans');assert.match(await page.locator('.project-document').innerText(),/prose-only roadmap/);assert.equal(await page.getByRole('button',{name:'Edit plan',exact:true}).count(),1);
   assert.equal(report.mutations.length,0,'Browsing never sends work or writes files');
  });
  await check('empty, partial, failed reads and retry',async()=>{
   await open(page,'weekend-notes','plans');assert.match(await page.locator('.project-content').innerText(),/No plan yet/);
   mode.failPlan=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await ready(page,'plans');assert.match(await page.locator('.project-content').innerText(),/Plan is unavailable/);assert.equal(await page.getByRole('button',{name:'Create plan',exact:true}).count(),0);
   mode.failMilestones=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await ready(page,'plans');assert.match(await page.locator('.project-content').innerText(),/Could not load plans/);
   mode.failPlan=false;mode.failMilestones=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await ready(page,'plans');assert.match(await page.locator('.project-content').innerText(),/No plan yet/);
   mode.failIssues=true;await tab(page,'issues');assert.match(await page.locator('.project-content').innerText(),/Could not load issues/);mode.failIssues=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await ready(page,'issues');assert.match(await page.locator('.project-content').innerText(),/No issues yet/);
   mode.failBuilds=true;await tab(page,'builds');assert.match(await page.locator('.project-content').innerText(),/Could not load builds/);mode.failBuilds=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await ready(page,'builds');assert.match(await page.locator('.project-content').innerText(),/No builds yet/);
  });
  await check('late plan response cannot replace the selected section',async()=>{
   mode.delayPlan=800;await page.locator('[data-workspace-section="plans"]').click();await tab(page,'issues');await page.waitForTimeout(950);assert.equal(await page.locator('.project-tab[aria-current="page"]').innerText(),'Issues');assert.match(await page.locator('.project-content').innerText(),/No issues yet/);mode.delayPlan=0;
  });
  await check('build evidence preserves drafts and uses read-only commands',async()=>{
   await page.locator('#ask').fill('Do not lose this draft');await open(page,'paper-garden','builds');await page.locator('[data-build-id="garden-2"] summary').click();await page.getByRole('button',{name:'Run log',exact:true}).first().click();
   await page.waitForFunction(()=>!nibbiApp.state().busy&&nibbiApp.state().turns.length===1);assert.equal(await page.locator('#ask').inputValue(),'Do not lose this draft');assert.match(await page.locator('.feed').innerText(),/Build log fixture/);
   await open(page,'paper-garden','builds');await page.locator('[data-build-id="garden-2"] summary').click();await page.getByRole('button',{name:'View changes',exact:true}).first().click();await page.waitForFunction(()=>!nibbiApp.state().busy&&nibbiApp.state().turns.length===2);assert.equal(await page.locator('#ask').inputValue(),'Do not lose this draft');assert.equal(report.mutations.length,0);
   await open(page,'paper-garden','issues');await page.getByRole('button',{name:'New issue',exact:true}).click();assert.equal(await page.locator('#ask').inputValue(),'Do not lose this draft');
  });
  await check('new actions prepare the selected project without sending',async()=>{
   await page.locator('#ask').fill('');await open(page,'observatory','issues');await page.getByRole('button',{name:'New issue',exact:true}).click();assert.equal(await page.locator('#ask').inputValue(),'/issue ');assert.equal(await page.evaluate(()=>nibbiApp.state().project),'observatory');
   await page.locator('#ask').fill('/issue A fixture issue');await page.locator('#send').click();await page.waitForFunction(()=>!nibbiApp.state().busy&&nibbiApp.state().turns.length===3);
   const issueWrite=report.mutations.find(m=>m.path==='/nibbi/vault-write');assert(issueWrite);assert.equal(JSON.parse(issueWrite.body).path,'projects/observatory/issues.md');
   await page.locator('#ask').fill('');await open(page,'paper-garden','builds');await page.getByRole('button',{name:'New build',exact:true}).click();assert.equal(await page.locator('#ask').inputValue(),'/fix ');
   await page.locator('#ask').fill('');await open(page,'weekend-notes','plans');await page.getByRole('button',{name:'Create plan',exact:true}).click();assert.match(await page.locator('#ask').inputValue(),/plans\/weekend-notes.md/);
   await page.locator('#ask').fill('');await open(page,'paper-garden','plans');await page.getByRole('button',{name:'Edit plan',exact:true}).click();assert.equal(await page.locator('#ask').inputValue(),'/plan edit ');assert.equal(report.mutations.length,1);
  });
  await check('busy browsing and send from a project view',async()=>{
   mode.delaySend=1200;await page.locator('#ask').fill('Fixture garden question');await page.locator('#send').click();await page.waitForFunction(()=>nibbiApp.state().busy);await open(page,'paper-garden','issues');assert.equal(await page.getByRole('button',{name:'New issue',exact:true}).isDisabled(),true);await page.waitForFunction(()=>!nibbiApp.state().busy);assert.equal(await page.getByRole('button',{name:'New issue',exact:true}).isDisabled(),false);
   mode.delaySend=0;await page.locator('#ask').fill('A follow-up from the project view');await page.locator('#send').click();await page.waitForFunction(()=>!nibbiApp.state().busy&&nibbiApp.state().turns.length===5);assert.equal(await page.locator('#project-workspace').isVisible(),false);assert.equal(JSON.parse(report.mutations.at(-1).body).project,'paper-garden');
  });
 }finally{await context.close();}
 assert.deepEqual(report.errors,[]);report.pass=report.checks.every(c=>c.pass);if(!report.pass)process.exitCode=1;
}catch(e){report.error=e.stack;process.exitCode=1;console.error(e);}finally{await browser.close();writeFileSync(resolve(out,'results.json'),JSON.stringify(report,null,2));}
