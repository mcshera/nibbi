import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {projectWorkflowFixture} from './project-workflow-fixture.mjs';
const candidate=process.env.NIBBI_WORKFLOW_CANDIDATE||JSON.parse(readFileSync('output/project-workflow-install/candidate-preparation.json')).sourceCopy;
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
async function ready(page,section){await page.waitForFunction(section=>nibbiApp.state().projectView?.section===section&&document.querySelector('#project-workspace').getAttribute('aria-busy')==='false',section);}
async function open(page,project,section){
 if(await page.locator('#sidebar-toggle').isVisible()){await page.locator('#sidebar-toggle').click();await page.waitForFunction(()=>document.querySelector('#workspace-sidebar').getBoundingClientRect().x>=0);}
 const row=page.locator(`[data-project-id="${project}"]`);if(await row.getAttribute('aria-expanded')!=='true')await row.click();
 await page.locator(`[data-section-project="${project}"][data-project-section="${section}"]`).click();await ready(page,section);
}
async function tab(page,section){await page.locator(`[data-workspace-section="${section}"]`).click();await ready(page,section);}
async function shot(page,name){await page.waitForFunction(()=>{const s=nibbi.state();return Math.abs(s.y-s.ty)<2&&Math.abs(s.x-s.tx)<2&&Math.abs(s.r-s.tr)<1;});await page.screenshot({path:join(out,name+'.png')});}
async function createPage(width=1180,height=712){const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});await context.addInitScript(silentMicrophone);const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.base?route.continue():route.abort());await page.goto(fixture.base+'/?nosw=1'+(width===1180?'&app=1':''));await page.waitForFunction(()=>window.nibbiApp?.state().projects?.length>=3);return{context,page};}
async function saveForm(page,title,description){const form=page.locator('.project-inline-form');await form.getByLabel('Title',{exact:true}).fill(title);if(description!==undefined)await form.getByLabel('Description',{exact:true}).fill(description);await form.getByRole('button',{name:'Save',exact:true}).click();await form.waitFor({state:'detached'});}
const record=(page,title)=>page.locator('.project-record').filter({has:page.locator('summary strong').filter({hasText:title})});
try{
 browser=await chromium.launch({channel:'chrome'});
 if(report.scope!=='responsive'){
 const {page,context}=await createPage();
 try{
  await check('informative navigation agrees with actual canonical records',async()=>{
   await page.locator('#ask').fill('Preserve this conversation draft');await attachFixture(page);await open(page,'paper-garden','issues');
   await page.waitForFunction(()=>document.querySelector('[data-section-project="paper-garden"][data-project-section="issues"] .project-section-badge').textContent==='2 open');
   assert.equal(await page.locator('[data-workspace-section="issues"] .project-tab-count').innerText(),'2 open');assert.equal(await page.locator('.project-issue').count(),2);
   await tab(page,'plans');assert.equal(await page.locator('[data-workspace-section="plans"] .project-tab-count').innerText(),'1/3 tasks');assert.equal(await page.locator('.project-summary').innerText(),'1 of 3 tasks complete');await shot(page,'plans-desktop');
  });
  let createdIssueId,linkedTaskId,buildId;
  await check('inline issue capture, editing, search, completion and reopen persist',async()=>{
   await tab(page,'issues');await page.getByRole('button',{name:'New issue',exact:true}).click();await saveForm(page,'Let seedlings rest','Pause gently while focus is elsewhere.');
   let data=await fixture.section('paper-garden','issues');let issue=data.items.find(i=>i.text==='Let seedlings rest');assert(issue);createdIssueId=issue.id;
   let row=page.locator(`[data-record-id="${createdIssueId}"]`);if(!await row.evaluate(el=>el.open))await row.locator('summary').click();await row.getByRole('button',{name:'Edit',exact:true}).click();await saveForm(page,'Let seedlings rest quietly','Keep this edited description.');
   data=await fixture.section('paper-garden','issues');issue=data.items.find(i=>i.id===createdIssueId);assert.equal(issue.text,'Let seedlings rest quietly');assert.match(issue.description,/edited description/);
   await page.getByRole('searchbox',{name:'Search issues'}).fill('rest quietly');assert.equal(await page.locator('.project-issue').count(),1);
   row=page.locator(`[data-record-id="${createdIssueId}"]`);if(!await row.evaluate(el=>el.open))await row.locator('summary').click();await row.getByRole('button',{name:'Complete issue',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.project-issue').length===0);
   await page.locator('[data-filter="done"]').click();row=page.locator(`[data-record-id="${createdIssueId}"]`);if(!await row.evaluate(el=>el.open))await row.locator('summary').click();await row.getByRole('button',{name:'Reopen issue',exact:true}).click();await page.locator('[data-filter="open"]').click();
   await page.getByRole('searchbox',{name:'Search issues'}).fill('');assert.equal(await page.locator('#ask').inputValue(),'Preserve this conversation draft');await shot(page,'issues-desktop');
  });
  await check('stale issue save rejects and preserves the draft and concurrent source change',async()=>{
   const row=page.locator(`[data-record-id="${createdIssueId}"]`);if(!await row.evaluate(el=>el.open))await row.locator('summary').click();await row.getByRole('button',{name:'Edit',exact:true}).click();
   const form=page.locator('.project-inline-form');await form.getByLabel('Title',{exact:true}).fill('Unsaved conflict text');
   const path=join(fixture.vault,'games/paper-garden/issues.md');writeFileSync(path,readFileSync(path,'utf8')+'\nConcurrent note that must survive.\n');fixture.runtime.emit({type:'vault.updated',projectId:'paper-garden',payload:{path:'games/paper-garden/issues.md'}});
   await form.getByRole('button',{name:'Save',exact:true}).click();await form.locator('.project-form-error').waitFor({state:'visible'});assert.equal(await form.getByLabel('Title',{exact:true}).inputValue(),'Unsaved conflict text');assert.match(readFileSync(path,'utf8'),/Concurrent note/);await form.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Refresh',exact:true}).click();await ready(page,'issues');
  });
  await check('issue to plan association survives task edits and milestone ordering',async()=>{
   const row=page.locator(`[data-record-id="${createdIssueId}"]`);if(!await row.evaluate(el=>el.open))await row.locator('summary').click();await row.getByRole('button',{name:'Add to plan',exact:true}).click();
   const form=page.locator('.project-inline-form');await form.getByLabel('Destination milestone').selectOption('first-shoots');await form.getByRole('button',{name:'Add to plan',exact:true}).click();await form.waitFor({state:'detached'});
   const data=await fixture.section('paper-garden','plans');const task=data.items.find(i=>i.issueIds.includes(createdIssueId));assert(task);linkedTaskId=task.id;
   await tab(page,'plans');let taskRow=page.locator(`[data-record-id="${linkedTaskId}"]`);await taskRow.locator('summary').click();await taskRow.getByRole('button',{name:'Edit task',exact:true}).click();await saveForm(page,'A quiet pause for seedlings','Task details survive linking.');
   const milestone=page.locator('.project-milestone').filter({has:page.locator('.project-milestone-summary strong').filter({hasText:'First shoots'})});await milestone.getByRole('button',{name:'Set current milestone',exact:true}).click();await page.getByText('Current milestone: First shoots',{exact:true}).waitFor();
   taskRow=page.locator(`[data-record-id="${linkedTaskId}"]`);if(!await taskRow.evaluate(el=>el.open))await taskRow.locator('summary').click();await taskRow.getByRole('button',{name:'Move up',exact:true}).click();
   const latest=await fixture.section('paper-garden','plans');assert(latest.items.find(i=>i.id===linkedTaskId).issueIds.includes(createdIssueId));assert.equal(latest.currentMilestone.id,'first-shoots');
  });
  await check('real task dispatch, review evidence and confirmed merge complete linked records',async()=>{
   const row=page.locator(`[data-record-id="${linkedTaskId}"]`);if(!await row.evaluate(el=>el.open))await row.locator('summary').click();await row.getByRole('button',{name:'Build this task',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.project-notice')?.textContent.includes('Task build started'));
   const started=fixture.runtime.list('fixers').find(run=>run.taskId===linkedTaskId);assert(started);buildId=started.id;await fixture.fixer.waitForFixer(buildId);
   assert.equal(fixture.runtime.get('fixers',buildId).status,'staged');assert.equal((await fixture.section('paper-garden','plans')).items.find(i=>i.id===linkedTaskId).done,false);assert.equal((await fixture.section('paper-garden','issues')).items.find(i=>i.id===createdIssueId).done,false);
   await tab(page,'builds');const build=page.locator(`[data-build-id="${buildId}"]`);if(!await build.evaluate(el=>el.open))await build.locator('summary').click();
   await build.getByRole('button',{name:'Changes',exact:true}).click();await build.locator('.project-evidence-panel').getByText(/fixture-change/).first().waitFor();assert.equal(await page.locator('#ask').inputValue(),'Preserve this conversation draft');
   await build.getByRole('button',{name:'Checks',exact:true}).click();await build.getByRole('heading',{name:'Verification: Passed',exact:true}).waitFor();await shot(page,'build-review-desktop');
   await build.getByRole('button',{name:'Merge locally',exact:true}).click();assert.equal(fixture.runtime.get('fixers',buildId).status,'staged','First click only asks for confirmation');
   await page.getByRole('button',{name:/^Confirm merge/i}).click();await page.waitForFunction(()=>document.querySelector('.project-notice')?.textContent.toLowerCase().includes('merged'));
   assert.equal(fixture.runtime.get('fixers',buildId).status,'merged');assert.equal((await fixture.section('paper-garden','plans')).items.find(i=>i.id===linkedTaskId).done,true);assert.equal((await fixture.section('paper-garden','issues')).items.find(i=>i.id===createdIssueId).done,true);
  });
  await check('project and filter navigation retains reading state and drafts',async()=>{
   await tab(page,'issues');await page.locator('[data-filter="all"]').click();await page.getByRole('searchbox',{name:'Search issues'}).fill('seedlings');await tab(page,'plans');await tab(page,'issues');assert.equal(await page.getByRole('searchbox',{name:'Search issues'}).inputValue(),'seedlings');assert.equal(await page.locator('[data-filter="all"]').getAttribute('aria-pressed'),'true');
   await open(page,'observatory','plans');assert.match(await page.locator('.project-content').innerText(),/written plan/i);assert(!/seedlings/.test(await page.locator('.project-content').innerText()));await open(page,'weekend-notes','issues');assert.match(await page.locator('.project-content').innerText(),/No issues yet/);
   await page.getByRole('button',{name:'Back to chat',exact:true}).click();assert.equal(await page.locator('#ask').inputValue(),'Preserve this conversation draft');assert.equal(await page.locator('#attach img').count(),1);assert.equal(await page.locator('#project-workspace').isVisible(),false);
  });
  await check('empty plan supports inline milestone and task creation and editing',async()=>{
   await open(page,'weekend-notes','plans');await page.getByRole('button',{name:'Create milestone',exact:true}).click();await saveForm(page,'A useful weekend','Keep room for small ideas.');
   let data=await fixture.section('weekend-notes','plans');const milestoneId=data.milestones[0].id;assert.equal(data.milestones[0].name,'A useful weekend');
   let milestone=page.locator(`[data-record-id="${milestoneId}"]`);if(!await milestone.evaluate(el=>el.open))await milestone.locator('summary').first().click();await milestone.getByRole('button',{name:'Add task',exact:true}).click();await saveForm(page,'Collect one idea','A small, concrete next step.');
   data=await fixture.section('weekend-notes','plans');const taskId=data.items[0].id;assert.equal(data.items[0].milestoneId,milestoneId);
   milestone=page.locator(`[data-record-id="${milestoneId}"]`);await milestone.getByRole('button',{name:'Edit milestone',exact:true}).click();await saveForm(page,'A quiet weekend','Preserve this direction.');
   const task=page.locator(`[data-record-id="${taskId}"]`);if(!await task.evaluate(el=>el.open))await task.locator('summary').click();await task.getByRole('button',{name:'Edit task',exact:true}).click();const form=page.locator('.project-inline-form');await form.getByLabel('Milestone',{exact:true}).selectOption('');await saveForm(page,'Collect two ideas','Keep the canonical task identity.');
   data=await fixture.section('weekend-notes','plans');assert.equal(data.milestones[0].id,milestoneId);assert.equal(data.milestones[0].name,'A quiet weekend');assert.equal(data.items[0].id,taskId);assert.equal(data.items[0].milestoneId,undefined);assert.equal(data.items[0].text,'Collect two ideas');assert.equal(await page.locator('#ask').inputValue(),'Preserve this conversation draft');assert.equal(await page.locator('#attach img').count(),1);
  });
 }catch(error){await shot(page,'failure');writeFileSync(join(out,'failure.html'),await page.content());throw error;}finally{await context.close();}
 }
 for(const [w,h]of[[1440,900],[390,844],[320,568],[390,430]]){
  const {page,context}=await createPage(w,h);
  try{await check(`responsive sections and composer ${w}x${h}`,async()=>{
   await page.locator('#ask').fill('A mobile draft');await attachFixture(page);await open(page,'paper-garden','plans');
   assert.equal(await page.locator('#pill').evaluate(el=>el.inert),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   for(const selector of ['#project-workspace','#pill']){const b=await page.locator(selector).boundingBox();assert(b.x>=-1&&b.y>=-1&&b.x+b.width<=w+1&&b.y+b.height<=h+1,selector+' fits');}
   if(h<600){assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('project-compose-compact')),true);assert.equal(await page.locator('#ask').isVisible(),false);await page.locator('#project-compose-toggle').click();assert.equal(await page.locator('#ask').inputValue(),'A mobile draft');assert.equal(await page.evaluate(()=>document.activeElement.id),'ask');await page.locator('#project-compose-toggle').click();assert.equal(await page.locator('#ask').inputValue(),'A mobile draft');}
   await shot(page,`plans-${w}x${h}`);await tab(page,'issues');await shot(page,`issues-${w}x${h}`);await tab(page,'builds');await shot(page,`builds-${w}x${h}`);
   assert.equal(await page.locator('#attach img').count(),1);assert.equal(await page.locator('#ask').inputValue(),'A mobile draft');
   const mic=page.locator('#mic'),box=await mic.boundingBox();assert(box.width>=44&&box.height>=44);await mic.click();await page.waitForFunction(()=>nibbiApp.voice.snapshot().phase==='paused');await mic.click();await page.waitForFunction(()=>nibbiApp.voice.snapshot().phase==='off');assert.equal(await page.evaluate(()=>workflowMicrophone.requests),1);assert.equal(await page.evaluate(()=>workflowMicrophone.tracks.every(t=>t.readyState==='ended')),true);assert.equal(fixture.calls.some(r=>r.path==='/api/transcribe'),false);
   assert.equal(await page.evaluate(()=>nibbi.state().character),'pool-velvet');
  });}finally{await context.close();}
 }
 assert.deepEqual(report.errors,[]);report.pass=true;
}catch(error){report.error=error.stack;report.pass=false;process.exitCode=1;console.error(error);}finally{await browser?.close();report.requests=fixture.calls;report.backendErrors=fixture.errors;await fixture.close();writeFileSync(join(out,'results.json'),JSON.stringify(report,null,2));}
