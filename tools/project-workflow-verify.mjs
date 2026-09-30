import assert from 'node:assert/strict';
import {chooseProject,closeSwitcher} from './choose-project.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {projectWorkflowFixture} from './project-workflow-fixture.mjs';
// This checkout by default; a prepared install candidate via NIBBI_WORKFLOW_CANDIDATE.
const candidate=process.env.NIBBI_WORKFLOW_CANDIDATE||'.';
const root=resolve(candidate),ui=join(root,'dist/ui'),daemon=join(root,'daemon/dist');
const out=resolve(process.env.NIBBI_WORKFLOW_OUTPUT||'output/playwright/project-workflow');mkdirSync(out,{recursive:true});
const report={candidate:root,scope:process.env.NIBBI_WORKFLOW_ONLY||'all',checks:[],errors:[],fixture:'Actual HTTP routes, temporary SQLite/vault/Git repositories, both providers replaced with deterministic test implementations.'};
const fixture=await projectWorkflowFixture({daemon,ui});let browser;
const check=async(name,fn)=>{try{await fn();report.checks.push({name,pass:true});console.log('PASS',name);}catch(error){report.checks.push({name,pass:false,error:error.stack});console.error('FAIL',name,error.message);throw error;}};
function silentMicrophone(){
 const fake=window.workflowMicrophone={tracks:[],requests:0};const NativeAudioContext=window.AudioContext;
 class CaptureContext extends NativeAudioContext{createMediaStreamSource(){return{connect(){},disconnect(){}}}createAnalyser(){const node=super.createAnalyser();node.getByteTimeDomainData=a=>a.fill(128);return node}}
 window.AudioContext=CaptureContext;window.webkitAudioContext=CaptureContext;
 Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{fake.requests++;const track={readyState:'live',stop(){this.readyState='ended'},addEventListener(){},removeEventListener(){}};fake.tracks.push(track);return{getTracks:()=>[track],getAudioTracks:()=>[track]}}});
 class Recorder extends EventTarget{static isTypeSupported(){return true}constructor(stream,options={}){super();this.state='inactive';this.mimeType=options.mimeType||'audio/webm'}start(){throw new Error('Silent microphone must never record')}stop(){this.state='inactive'}}window.MediaRecorder=Recorder;
}
async function attachFixture(page){await page.evaluate(()=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1cAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'fixture.png',{type:'image/png'}));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true}));});await page.locator('#attach img').waitFor({state:'attached'});}
// The fixed words the pages say (a refusal while nibbi answers), from the checkout this tool belongs to.
const {WORDS}=await import(new URL('../public/lib/control-panel-contract.js',import.meta.url));
async function sidebarOpen(page){if(await page.locator('#sidebar-toggle').isVisible()){await page.locator('#sidebar-toggle').click();await page.waitForFunction(()=>document.querySelector('#workspace-sidebar').getBoundingClientRect().x>=0);}}
const pageOf=(page,kind,id)=>page.locator(`#project-workspace .cp-page[data-cp-page="${kind}"][data-cp-id="${id}"]`);
async function ready(page,kind,id){await page.waitForFunction(([kind,id])=>{const v=nibbiApp.state().projectView,root=document.querySelector('#project-workspace .cp-page');return v?.page===kind&&v.id===id&&root?.dataset.cpPage===kind&&root.dataset.cpId===id&&root.getAttribute('aria-busy')==='false';},[kind,id]);return pageOf(page,kind,id);}
/* A page, opened the way the owner opens it (docs/CONTROL-PANEL.md §6.2): main's row for its build page, an
   improvement's row inside main for its ticket. Choosing a project can put the drawer away, so it is opened again. */
async function open(page,project,kind='build',id='main'){
 await sidebarOpen(page);await chooseProject(page,project);await closeSwitcher(page);await sidebarOpen(page);
 if(kind==='build')await page.locator('#workspace-sidebar [data-bar-build="main"]').click();
 else{const row=page.locator(`#workspace-sidebar [data-bar-improvement="${id}"]`);if(!await row.count()){const fold=page.locator('#workspace-sidebar [data-cp-fold]:not([aria-expanded="true"])');if(await fold.count())await fold.first().click();}await row.click();}
 return ready(page,kind,kind==='build'?'main':id);
}
// A draft belongs to its conversation (per-thread drafts): after browsing another project, go back to the one it was typed in.
async function backToDraft(page,project){if(await page.locator('#sidebar-toggle').isVisible()&&await page.locator('#workspace-sidebar').getAttribute('aria-hidden')==='true'){await page.locator('#sidebar-toggle').click();await page.waitForFunction(()=>document.querySelector('#workspace-sidebar').getBoundingClientRect().x>=0);}await chooseProject(page,project);await closeSwitcher(page);}
const until=async(what,test,ms=15000)=>{const end=Date.now()+ms;for(;;){const value=await test();if(value)return value;if(Date.now()>end)throw new Error('timed out waiting for '+what);await new Promise(r=>setTimeout(r,150));}};
const posts=()=>fixture.calls.filter(c=>c.method==='POST'&&c.path==='/api/commands').length;
async function shot(page,name){await page.waitForFunction(()=>{const s=nibbi.state();return Math.abs(s.y-s.ty)<2&&Math.abs(s.x-s.tx)<2&&Math.abs(s.r-s.tr)<1;});await page.screenshot({path:join(out,name+'.png')});}
async function createPage(width=1180,height=712){const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});await context.addInitScript(silentMicrophone);const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.base?route.continue():route.abort());await page.goto(fixture.base+'/?nosw=1'+(width===1180?'&app=1':''));await page.waitForFunction(()=>window.nibbiApp?.state().projects?.length>=3);return{context,page};}
/* edit the words on an up-next ticket: the title and the description are fields, "save the words" writes them */
async function editWords(ticket,title,description){await ticket.locator('[data-cp-key="edit"]').click();await ticket.locator('[data-cp-key="edit-title"]').fill(title);if(description!==undefined)await ticket.locator('[data-cp-key="edit-desc"]').fill(description);await ticket.locator('[data-cp-key="edit-save"]').click();}
try{
 browser=await chromium.launch({channel:'chrome'});
 if(report.scope!=='responsive'){
 const {page,context}=await createPage();let draftProject;
 try{
  await check('a page close preserves the active conversation and work while Nibbi is busy, and starting does not wait',async()=>{
   const release=fixture.holdChat();
   try {
    await page.locator('#ask').fill('Keep working while I browse');await page.locator('#ask').press('Enter');
    await page.waitForFunction(()=>nibbiApp.state().busy&&nibbiApp.state().activeRunId);
    await page.locator('#ask').fill('An unsent follow-up');await attachFixture(page);
    const before=await page.evaluate(()=>({thread:nibbiApp.state().thread,run:nibbiApp.state().activeRunId,turns:nibbiApp.state().turns.map(t=>t.text)}));
    const current=await page.evaluate(()=>nibbiApp.state().project);const writes=posts();
    // main's page opens while nibbi answers, and nothing on it waits for the reply: not up next, and not what starts a run (D8, reversed: docs/CONTROL-PANEL.md §12.2)
    const build=await open(page,current,'build');
    await build.locator('[data-cp-key="add"]').click();
    const start=build.locator('[data-cp-key="add-start"]'),queue=build.locator('[data-cp-key="add-queue"]');
    assert.equal(await start.isDisabled(),false,'start now does not wait for the reply');assert.equal(await start.getAttribute('title')||'','','and no words say it does');
    assert.equal(await queue.isDisabled(),false,'up next does not wait');
    await build.locator('[data-cp-key="add-cancel"]').click();
    // and an up-next issue's ticket, where the project has one: build it now goes too
    const upNext=page.locator('#workspace-sidebar [data-bar-improvement^="issue:"][data-state="up_next"]').first();
    if(await upNext.count()){const id=await upNext.getAttribute('data-bar-improvement');const ticket=await open(page,current,'ticket',id);const now=ticket.locator('[data-cp-key="build-now"]');assert.equal(await now.isDisabled(),false,'build it now does not wait for the reply');assert.equal(await now.getAttribute('title')||'','');}
    await open(page,current,'build');
    // Another project is refused while nibbi answers: the reply, its chips and its errors belong to the one it started in.
    {const other=(await page.evaluate(()=>nibbiApp.state().projects.map(p=>p.id||p.name))).find(id=>id&&id!==current&&id!=='vault');if(other){await sidebarOpen(page);await chooseProject(page,other);await closeSwitcher(page);assert.equal(await page.evaluate(()=>nibbiApp.state().project),current,'a project switch waits for the reply');await page.locator('.margin-error').filter({hasText:/answering in/}).waitFor();}};
    await page.getByRole('button',{name:'Close and return to the conversation',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>({thread:nibbiApp.state().thread,run:nibbiApp.state().activeRunId,turns:nibbiApp.state().turns.map(t=>t.text)})),before);
    assert.equal(await page.evaluate(()=>nibbiApp.state().busy),true);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'ask');
    assert.equal(await page.locator('#ask').inputValue(),'An unsent follow-up');assert.equal(await page.locator('#attach img').count(),1);
    assert.equal(posts(),writes,'opening pages sends nothing');
   } finally {release();}
   await page.waitForFunction(()=>!nibbiApp.state().busy);
   // Start the record workflow with its own attachment.
   await page.locator('#attach button').click();
  });
  await check('main and its improvements agree with the real records',async()=>{
   draftProject=await page.evaluate(()=>nibbiApp.state().project);await page.locator('#ask').fill('Preserve this conversation draft');await attachFixture(page);
   const build=await open(page,'paper-garden','build');
   const issues=await fixture.section('paper-garden','issues'),open_=issues.items.filter(i=>!i.done),done=issues.items.filter(i=>i.done);
   assert.equal(open_.length,2);assert.equal(done.length,1);
   for(const item of open_)assert.equal(await page.locator(`#workspace-sidebar [data-bar-improvement="issue:${item.id}"]`).getAttribute('data-state'),'up_next',`${item.text} is up next in the bar`);
   for(const item of done)assert.equal(await page.locator(`#workspace-sidebar [data-bar-improvement="issue:${item.id}"]`).count(),0,`${item.text} is done: not in the bar`);
   assert.equal(await build.locator('.cp-imp-group[data-cp-group="up_next"] .cp-imp-group-title').innerText(),'up next · 2');
   assert.equal(await build.locator('.cp-imp[data-state="up_next"]').count(),2);
   assert.match(await build.locator('.cp-history').innerText(),/Remember visitors/,'a done issue is in main\'s history');
   assert.equal(await page.locator('#ask').inputValue(),'Preserve this conversation draft');await shot(page,'build-desktop');
  });
  let createdIssueId,buildId;
  await check('an improvement kept up next is edited, marked done and reopened, and it persists',async()=>{
   // the bar's form: up next writes issues.md, stays in place, and never touches the composer
   await page.locator('#workspace-sidebar [data-cp-role="new-improvement"]').click();
   await page.locator('#workspace-sidebar .cp-improvement-form textarea').fill('Let seedlings rest\nPause gently while focus is elsewhere.');
   await page.locator('#workspace-sidebar [data-cp-role="up-next"]').click();
   const created=await until('the new issue',async()=>(await fixture.section('paper-garden','issues')).items.find(i=>i.text==='Let seedlings rest'));
   createdIssueId=created.id;assert.match(created.description,/Pause gently/,'the lines after the first are its description');
   const row=page.locator(`#workspace-sidebar [data-bar-improvement="issue:${createdIssueId}"]`);await row.waitFor();assert.equal(await row.getAttribute('data-state'),'up_next');
   assert.equal(await page.evaluate(()=>nibbiApp.state().projectView?.page),'build','the form does not move the main area');
   const ticket=await open(page,'paper-garden','ticket','issue:'+createdIssueId);
   await editWords(ticket,'Let seedlings rest quietly','Keep this edited description.');
   await ticket.locator('h1',{hasText:'Let seedlings rest quietly'}).waitFor();
   let item=(await fixture.section('paper-garden','issues')).items.find(i=>i.id===createdIssueId);assert.equal(item.text,'Let seedlings rest quietly');assert.match(item.description,/edited description/);
   await ticket.locator('[data-cp-key="mark-done"]').click();
   await until('the issue marked done',async()=>(await fixture.section('paper-garden','issues')).items.find(i=>i.id===createdIssueId)?.done===true);
   await page.waitForFunction(id=>document.querySelector(`#project-workspace .cp-page[data-cp-id="${id}"]`)?.dataset.state==='done','issue:'+createdIssueId);
   assert.equal(await row.getAttribute('aria-current'),'page','its row still shows while its ticket is open, settled or not');
   await ticket.locator('[data-cp-key="reopen"]').click();
   await until('the issue reopened',async()=>(await fixture.section('paper-garden','issues')).items.find(i=>i.id===createdIssueId)?.done===false);
   await page.waitForFunction(id=>document.querySelector(`#project-workspace .cp-page[data-cp-id="${id}"]`)?.dataset.state==='up_next','issue:'+createdIssueId);
   assert.equal(await page.locator('#ask').inputValue(),'Preserve this conversation draft');await shot(page,'ticket-up-next-desktop');
  });
  await check('a stale edit is refused and keeps the words and the concurrent change',async()=>{
   const ticket=pageOf(page,'ticket','issue:'+createdIssueId);
   await ticket.locator('[data-cp-key="edit"]').click();await ticket.locator('[data-cp-key="edit-title"]').fill('Unsaved conflict text');
   const path=join(fixture.vault,'games/paper-garden/issues.md');writeFileSync(path,readFileSync(path,'utf8')+'\nConcurrent note that must survive.\n');fixture.runtime.emit({type:'vault.updated',projectId:'paper-garden',payload:{path:'games/paper-garden/issues.md'}});
   await page.waitForTimeout(900);   // the page reads the list again under the open form (400ms after the event)
   assert.equal(await ticket.locator('[data-cp-key="edit-title"]').inputValue(),'Unsaved conflict text','the read keeps the words being edited');
   await ticket.locator('[data-cp-key="edit-save"]').click();
   const note=ticket.locator('.cp-edit .cp-page-note[data-kind="error"]');await note.waitFor();
   assert.equal(await note.innerText(),'the list changed — your words are still here; save again');
   assert.equal(await ticket.locator('[data-cp-key="edit-title"]').inputValue(),'Unsaved conflict text');assert.match(readFileSync(path,'utf8'),/Concurrent note/);
   assert.equal((await fixture.section('paper-garden','issues')).items.find(i=>i.id===createdIssueId).text,'Let seedlings rest quietly','nothing was written over');
   await ticket.locator('[data-cp-key="edit-cancel"]').click();await ticket.locator('h1',{hasText:'Let seedlings rest quietly'}).waitFor();
  });
  await check('build it now, review evidence and a confirmed merge complete the issue',async()=>{
   const ticket=await open(page,'paper-garden','ticket','issue:seedling-overlap');
   await ticket.locator('[data-cp-key="build-now"]').click();
   const started=await until('its build',()=>fixture.runtime.list('fixers').find(run=>(run.issueIds||[]).includes('seedling-overlap')));buildId=started.id;await fixture.fixer.waitForFixer(buildId);
   assert.equal(fixture.runtime.get('fixers',buildId).status,'staged');assert.equal((await fixture.section('paper-garden','issues')).items.find(i=>i.id==='seedling-overlap').done,false);
   await page.waitForFunction(()=>document.querySelector('#project-workspace .cp-page[data-cp-id="issue:seedling-overlap"]')?.dataset.state==='ready',null,{timeout:15000});
   const tryCard=ticket.locator(`article.cp-try[data-cp-run="${buildId}"]`);
   await tryCard.locator('.project-evidence-tabs button[data-kind="changes"]').click();
   await tryCard.locator('.project-evidence-panel').getByText(/fixture-change/).first().waitFor();assert.equal(await page.locator('#ask').inputValue(),'Preserve this conversation draft');
   assert.equal(await tryCard.locator('.cp-check[data-ok="true"]').count()>=1,true,'the project check passed on this try');
   assert.match(await ticket.locator('.cp-facts').innerText(),/checks\s*passed/);await shot(page,'ticket-review-desktop');
   const merge=ticket.locator('[data-cp-key="merge"]');await page.waitForFunction(()=>{const k=document.querySelector('#project-workspace .cp-page [data-cp-key="merge"]');return k&&!k.disabled;},null,{timeout:10000});
   const writes=posts();await merge.click();
   await ticket.locator('.cp-confirm:not([hidden])').waitFor();assert.equal(fixture.runtime.get('fixers',buildId).status,'staged','the first press only asks');assert.equal(posts(),writes,'and sends nothing');
   await ticket.locator('[data-cp-key="confirm-yes"]').click();await ticket.locator('.cp-notice',{hasText:/merged into/}).waitFor({timeout:20000});
   assert.equal(fixture.runtime.get('fixers',buildId).status,'merged');assert.equal((await fixture.section('paper-garden','issues')).items.find(i=>i.id==='seedling-overlap').done,true,'a merged try completes its issue');
   await page.waitForFunction(()=>document.querySelector('#project-workspace .cp-page[data-cp-id="issue:seedling-overlap"]')?.dataset.state==='in',null,{timeout:10000});
  });
  await check('pages keep their reading state and drafts across pages and projects',async()=>{
   const build=await open(page,'paper-garden','build');await build.locator('[data-cp-key="add"]').click();await build.locator('[data-cp-key="add-field"]').fill('A draft on main\'s page');
   const ticket=await open(page,'paper-garden','ticket','issue:keyboard-focus');await ticket.locator('[data-cp-key="crumb"]').click();
   const again=await ready(page,'build','main');assert.equal(await again.locator('[data-cp-key="add-field"]').inputValue(),'A draft on main\'s page','the build page kept its form and its words');
   await again.locator('[data-cp-key="add-field"]').fill('');await again.locator('[data-cp-key="add-cancel"]').click();
   // a build page follows you to another project's main; a project with nothing to improve says so
   for(const other of ['observatory','weekend-notes']){await sidebarOpen(page);await chooseProject(page,other);await closeSwitcher(page);await page.waitForFunction(p=>nibbiApp.state().projectView?.project===p&&nibbiApp.state().projectView?.page==='build',other);const text=await pageOf(page,'build','main').locator('.cp-improvements').innerText();assert.match(text,/nothing to improve yet/,other+': '+text);assert(!/seedlings/i.test(text),other+' shows only its own');}
   await page.getByRole('button',{name:'Close and return to the conversation',exact:true}).click();await backToDraft(page,draftProject);assert.equal(await page.locator('#ask').inputValue(),'Preserve this conversation draft');assert.equal(await page.locator('#attach img').count(),1);assert.equal(await page.locator('#project-workspace').isVisible(),false);
  });
 }catch(error){await shot(page,'failure');writeFileSync(join(out,'failure.html'),await page.content());throw error;}finally{await context.close();}
 }
 for(const [w,h]of[[1440,900],[390,844],[320,568],[390,430]]){
  const {page,context}=await createPage(w,h);
  try{await check(`responsive pages and composer ${w}x${h}`,async()=>{
   await page.locator('#ask').fill('A mobile draft');await attachFixture(page);
   for(const [kind,id,title,key] of [['build','main','main','Enter'],['ticket','issue:keyboard-focus','Keyboard focus disappears','Space']]){
    const root=await open(page,'paper-garden',kind,id);
    assert.equal(await page.locator('#project-workspace .cp-page h1').innerText(),title);
    assert.equal(await page.locator('.project-tabs').count(),0);
    assert.equal(await page.locator('#pill').isVisible(),false);
    assert.equal(await page.locator('#pill').evaluate(el=>el.inert),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    // The header × is the way back at every width; the floating launcher that covered records is gone, and so are the fixers.
    assert.equal(await page.locator('#project-chat-launcher').count(),0);assert.equal(await page.locator('#agents').evaluate(el=>getComputedStyle(el).display),'none');
    await page.waitForFunction(()=>document.querySelector('#project-workspace').getAnimations().length===0);   // the page slides in 10px; measure it once it has arrived
    const launcher=root.locator('.project-close'),before=await launcher.boundingBox();
    assert(before.width>=44&&before.height>=44,'the close control is a 44px target');assert(before.x+before.width<=w&&before.y>=0,'inside the viewport');
    const body=root.locator('.project-workspace-body');
    await body.evaluate(el=>el.scrollTop=el.scrollHeight);
    assert.deepEqual(await launcher.boundingBox(),before,'the close control stays fixed while the page scrolls');
    const scroll=await body.evaluate(el=>el.scrollTop);
    await shot(page,`${kind}-${w}x${h}`);
    await launcher.focus();await page.keyboard.press(key);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'ask');
    assert.equal(await page.locator('#ask').inputValue(),'A mobile draft');assert.equal(await page.locator('#attach img').count(),1);
    const back=await open(page,'paper-garden',kind,id);
    assert.equal(await back.locator('.project-workspace-body').evaluate(el=>el.scrollTop),scroll,'coming back finds the page where it was left');
   }
   await page.getByRole('button',{name:'Close and return to the conversation',exact:true}).click();
   const dock=page.locator('#dock'),dbox=await dock.boundingBox();assert(dbox.width>=(w<=640?44:40)&&dbox.height>=(w<=640?44:40),'options button target');const openDock=async()=>{if(await dock.getAttribute('aria-expanded')!=='true')await dock.click();};
   await openDock();const mic=page.locator('#mic'),box=await mic.boundingBox();assert(box.width>=44&&box.height>=44);await mic.click();await page.waitForFunction(()=>nibbiApp.voice.snapshot().phase==='paused');assert.equal(await page.locator('#dock-menu').isVisible(),false,'choosing a row closes the panel');assert.equal(await mic.getAttribute('aria-pressed'),'true','the panel toggle reports Hey Nibbi on');assert.equal(await page.locator('#listen').isVisible(),true,'the listen strip is the on-state cue inside the bar');assert.equal(await page.locator('.mode').count(),0,'no mode chips anywhere');await openDock();await mic.click();await page.waitForFunction(()=>nibbiApp.voice.snapshot().phase==='off');assert.equal(await mic.getAttribute('aria-pressed'),'false','the panel toggle reports Hey Nibbi off');assert.equal(await page.locator('#listen').isVisible(),false,'the listen strip leaves with the mode');assert.equal(await page.evaluate(()=>workflowMicrophone.requests),1);assert.equal(await page.evaluate(()=>workflowMicrophone.tracks.every(t=>t.readyState==='ended')),true);assert.equal(fixture.calls.some(r=>r.path==='/api/transcribe'),false);
   assert.equal(await page.evaluate(()=>nibbi.state().character),'pool-velvet');
  });}finally{await context.close();}
 }
 assert.deepEqual(report.errors,[]);report.pass=true;
}catch(error){report.error=error.stack;report.pass=false;process.exitCode=1;console.error(error);}finally{await browser?.close();report.requests=fixture.calls;report.backendErrors=fixture.errors;await fixture.close();writeFileSync(join(out,'results.json'),JSON.stringify(report,null,2));}
