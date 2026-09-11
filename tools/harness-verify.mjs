// Phase 3 acceptance: live tool transcript, plan review before dispatch, mid-run steering, narrow-screen fit.
// Real candidate backend (tools/project-workflow-fixture.mjs) with deterministic providers: the fixer provider writes a fixture file, the lead returns fixed text without tools.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {homedir} from 'node:os';
import {projectWorkflowFixture} from './project-workflow-fixture.mjs';
// The verification sandbox needs ripgrep; the installed backend ships it in ~/.nibbi/bin.
const nibbiBin=join(homedir(),'.nibbi','bin');if(existsSync(join(nibbiBin,'rg'))&&!(process.env.PATH||'').split(':').includes(nibbiBin))process.env.PATH=nibbiBin+':'+(process.env.PATH||'');
const candidate=resolve(process.env.NIBBI_HARNESS_CANDIDATE||'.'),ui=join(candidate,'dist/ui'),daemon=join(candidate,'daemon/dist');
const out=resolve(process.env.NIBBI_HARNESS_OUTPUT||'output/playwright/harness');mkdirSync(out,{recursive:true});
for(const stale of readdirSync(out))if(/^failure-.*\.(png|html)$/.test(stale))rmSync(join(out,stale),{force:true});   // only this harness's own failure captures from earlier runs
const report={candidate,checks:[],errors:[],notes:[],fixture:'Actual HTTP routes, commands, SQLite, vault and Git worktrees; fixer provider writes a fixture file, lead provider answers fixed text without tools.'};
const note=text=>{report.notes.push(text);console.log('NOTE',text);};
const slug=name=>name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,60);
let fixture,browser,closed=false;
// Independent scenarios keep running after a failure; the exit code and results.json carry every verdict.
async function check(name,fn,page){
 try{await fn();report.checks.push({name,pass:true});console.log('PASS',name);}
 catch(error){report.checks.push({name,pass:false,error:error.stack||String(error)});process.exitCode=1;console.error('FAIL',name,error.message);
  if(page){try{await page.screenshot({path:join(out,'failure-'+slug(name)+'.png')});writeFileSync(join(out,'failure-'+slug(name)+'.html'),await page.content());}catch{/* page gone */}}}
}
async function cleanup(){if(closed)return;closed=true;try{await browser?.close();}catch(error){report.errors.push('browser close: '+error.message);}try{if(fixture){report.backendErrors=fixture.errors;report.requests=fixture.calls;await fixture.close();}}catch(error){report.errors.push('fixture close: '+error.message);}writeFileSync(join(out,'results.json'),JSON.stringify(report,null,2));}
const watchdog=setTimeout(()=>{console.error('harness-verify: timed out after 6 minutes');report.errors.push('timeout');process.exitCode=2;cleanup().finally(()=>process.exit(2));},6*60_000);watchdog.unref();

const sha256=text=>createHash('sha256').update(text).digest('hex');
const fingerprintFor=(steps,revision)=>sha256(JSON.stringify(steps)+'\n'+revision);
const api=async(path,init)=>{const r=await fetch(fixture.base+path,init);const body=await r.json().catch(()=>({}));return {status:r.status,body};};
const command=async(name,args,projectId)=>(await api('/api/commands',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,args,...(projectId?{projectId}:{}),idempotencyKey:randomUUID()})})).body;
const revisionOf=async()=>(await api('/api/project-section?project=paper-garden&section=plans')).body;

function silentMicrophone(){
 const Native=window.AudioContext;class Capture extends Native{createMediaStreamSource(){return{connect(){},disconnect(){}}}createAnalyser(){const n=super.createAnalyser();n.getByteTimeDomainData=a=>a.fill(128);return n}}
 window.AudioContext=Capture;window.webkitAudioContext=Capture;
 Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{const t={readyState:'live',stop(){this.readyState='ended'},addEventListener(){},removeEventListener(){}};return{getTracks:()=>[t],getAudioTracks:()=>[t]}}});
 class Recorder extends EventTarget{static isTypeSupported(){return true}constructor(){super();this.state='inactive'}start(){throw new Error('Silent microphone must not record')}stop(){this.state='inactive'}}window.MediaRecorder=Recorder;
}
async function pageFor({width=1180,height=712,demo=false,project}={}){
 const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});
 await context.addInitScript(silentMicrophone);
 if(project)await context.addInitScript(name=>{try{localStorage.setItem('nibbi.project',JSON.stringify(name));}catch{}},project);
 await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.base?route.continue():route.abort());
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(fixture.base+'/?nosw=1'+(demo?'&demo=1':'')+(width>800&&!demo?'&app=1':''));
 await page.waitForFunction(()=>window.nibbiApp?.state()&&document.querySelector('#ask')&&(new URLSearchParams(location.search).get('demo')==='1'||nibbiApp.state().projects?.length>=3));
 return {context,page};
}
/* send through the app, not the palette: a leading slash would otherwise be picked from the command palette on Enter */
async function say(page,text){const before=await page.evaluate(()=>nibbiApp.state().turns.length);await page.evaluate(t=>{void window.nibbiApp.send(t);},text);await page.waitForFunction(n=>{const s=nibbiApp.state();return !s.busy&&s.turns.length>n&&s.turns[s.turns.length-1].done;},before,{timeout:30000});return page.locator('.turn').last();}
async function shot(page,name){await page.waitForFunction(()=>{const s=window.nibbi?.state?.();return !s||(Math.abs(s.y-s.ty)<2&&Math.abs(s.x-s.tx)<2&&Math.abs(s.r-s.tr)<1);},null,{timeout:5000}).catch(()=>{});await page.evaluate(async()=>{await document.fonts.ready;});await page.screenshot({path:join(out,name+'.png')});}
async function ready(page,section){await page.waitForFunction(section=>nibbiApp.state().projectView?.section===section&&document.querySelector('#project-workspace').getAttribute('aria-busy')==='false',section);}
async function open(page,project,section){
 if(await page.locator('#sidebar-toggle').isVisible()){await page.locator('#sidebar-toggle').click();await page.waitForFunction(()=>document.querySelector('#workspace-sidebar').getBoundingClientRect().x>=0);}
 const row=page.locator(`[data-project-id="${project}"]`);if(await row.getAttribute('aria-expanded')!=='true')await row.click();
 await page.locator(`[data-section-project="${project}"][data-project-section="${section}"]`).click();await ready(page,section);
 const updates=page.locator('.project-notice').getByRole('button',{name:'Show updates',exact:true});if(await updates.isVisible())await updates.click();
}
const STEP_LINE=/\d+ steps? in \d+(?:\.\d+)?(?:s|m \d{2}s)(?: · \d+ failed)?/g;
/* the folded rows are display:none; "show" unfolds them the way a reader would, then the edit_file step is expanded through its summary */
async function unfoldEdit(page,turn){
 await turn.locator('.steps .fold').click();await turn.locator('.steps:not(.folded)').waitFor();
 const details=turn.locator('details.step');assert((await details.count())>=3,'governed demo steps are <details>: '+await details.count());
 const edit=details.filter({has:page.locator('code',{hasText:/^edit_file$/})});assert.equal(await edit.count(),1,'exactly one step names edit_file exactly');
 await edit.locator('summary').first().click();assert.equal(await edit.evaluate(el=>el.open),true,'clicking the summary expands the step');
 return edit;
}
const seedFixer=(id,extra={})=>fixture.runtime.put('fixers',id,{id,game:'paper-garden',project:'paper-garden',repo:join(process.env.NIBBI_PROJECTS_DIR,'paper-garden'),issue:'Seeded running build',title:'Seeded running build',branch:'nibbi/'+id,worktree:join(process.env.NIBBI_WORK_DIR,id),status:'running',startedAt:new Date().toISOString(),provider:'claude',model:'sonnet',executionKind:'provider',workflowMode:'local',attemptId:'attempt-'+id,verification:{status:'unverified'},...extra});
const seedProposal=(id,steps,review,revision)=>{const createdAt=Date.now();const proposal={id,project:'paper-garden',prompt:'make the garden calmer',leadRunId:'lead-'+id,state:'prepared',summary:review.summary,rationale:'Seeded by tools/harness-verify.mjs.',steps,review:{...review,roadmapRevision:revision},fingerprint:fingerprintFor(steps,revision),createdAt,expiresAt:createdAt+30*60_000};
 fixture.runtime.put('plan-proposals',id,proposal,{type:'plan.proposed',projectId:'paper-garden',payload:{id,steps:review.steps.map(step=>({n:step.n,title:step.title,taskId:step.task?.id}))}});return proposal;};

try{
 fixture=await projectWorkflowFixture({daemon,ui});
 browser=await chromium.launch({channel:'chrome'});

 /* 1. demo transcript: governed steps fold into <details>; edit_file carries input, summary and a diff card; the screen reader hears one line */
 {const {page,context}=await pageFor({demo:true});
  try{await check('demo transcript renders an expandable edit_file step with input, summary and diff card',async()=>{
   const turn=await say(page,'fix the turn lock bug');
   // after the turn the rows fold behind one line, and the screen reader hears that line exactly once
   assert.equal(await turn.locator('.steps.folded').count(),1,'steps fold after the turn');const foldLine=await turn.locator('.steps .fold .l').innerText();assert.match(foldLine,STEP_LINE,'fold line reads "N steps in Ts": '+foldLine);
   const sr=await page.locator('#sr').textContent();const lines=sr.match(STEP_LINE)||[];assert.equal(lines.length,1,'#sr carries exactly one steps summary line: '+JSON.stringify(sr));
   const edit=await unfoldEdit(page,turn);
   assert.equal(await edit.evaluate(el=>[...el.querySelectorAll('code')].some(c=>c.textContent==='edit_file')),true,'exact tool name is shown');
   assert.match(await edit.locator('pre').first().innerText(),/src\/session\.ts/,'bounded input <pre> shows the edited path');
   const verdict=await edit.evaluate(el=>(el.querySelector('.sres')||el.querySelector('.sbody')||el).textContent.replace(/\s+/g,' ').trim());assert.match(verdict,/Replaced 1 match/,'one-line summary is shown: '+verdict);
   assert.equal(await edit.locator('.diffv').count(),1,'one diff card');assert.match(await edit.locator('.diffv').innerText(),/clearOnAbort/,'diff body shows the added line');
   const summary=edit.locator('summary').first();await summary.focus();assert.equal(await summary.evaluate(el=>el===document.activeElement),true,'step summary is keyboard reachable');
   await shot(page,'demo-transcript-desktop');
  },page);}finally{await context.close();}}

 /* 2. Builds → Log renders structured rows from /api/fixer-log */
 let logRunId;
 {await check('fixture build stages and its log has structured entries',async()=>{
   // The seeded check command captures ls into a test and prints nothing; a plain ls gives the Log real process.output rows.
   const configured=await command('project.commands',{check:'ls fixture-change-*.txt',install:'true'},'paper-garden');assert.equal(configured.ok,true,JSON.stringify(configured.error));
   note('check 2: project check command set to `ls fixture-change-*.txt` so the fixture build emits process.output rows');
   const dispatched=await command('run.dispatch',{issue:'Give the Log tab something to show.',title:'Log tab fixture build'},'paper-garden');assert.equal(dispatched.ok,true,JSON.stringify(dispatched.error));
   logRunId=dispatched.data.id;await fixture.fixer.waitForFixer(logRunId);
   const run=fixture.runtime.get('fixers',logRunId);assert.equal(run.status,'staged','fixture build staged: '+run.status);
   const log=(await api('/api/fixer-log?id='+logRunId)).body;assert(Array.isArray(log.entries)&&log.entries.length>0,'fixer-log has entries');
   const kinds=[...new Set(log.entries.map(e=>e.kind))];note('check 2: fixer-log kinds '+kinds.join(', '));
   assert(kinds.includes('run.updated'),'run.updated rows are present');
   if(!kinds.includes('process.output'))note('check 2: no process.output rows were emitted by the fixture build');
  });
  const {page,context}=await pageFor();
  try{await check('Builds Log tab renders .project-log rows with kind badges',async()=>{
   assert(logRunId,'a staged fixture build exists');
   const entries=(await api('/api/fixer-log?id='+logRunId)).body.entries||[];
   await open(page,'paper-garden','builds');
   const row=page.locator(`[data-build-id="${logRunId}"]`);await row.waitFor();if(!await row.evaluate(el=>el.open))await row.locator(':scope > summary').click();
   await row.getByRole('button',{name:'Log',exact:true}).click();
   const panel=row.locator('.project-evidence-panel');await page.waitForFunction(id=>{const p=document.querySelector(`[data-build-id="${id}"] .project-evidence-panel`);return p&&p.textContent.trim()&&!/^Loading/.test(p.textContent.trim());},logRunId);
   if(!entries.length){assert.match(await panel.innerText(),/No log entries/i,'empty state when the run has no events');note('check 2: Log tab asserted the empty state — the run reported no events');return;}
   const rows=panel.locator('.project-log li');const count=await rows.count();assert(count>=1,'.project-log li rows exist (found '+count+')');
   const badged=await rows.evaluateAll(els=>els.filter(li=>li.querySelector('[class*="kind"],[data-kind]')).length);assert(badged>=1,'at least one row has a kind badge');
   const output=entries.filter(e=>e.kind==='process.output').map(e=>String(e.text||'').trim()).find(Boolean);
   if(output){const fragment=output.split(/\s+/)[0];assert.match(await panel.innerText(),new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),'process.output row shows its text: '+fragment);}
   const badgeText=await rows.first().evaluate(li=>li.querySelector('[class*="kind"],[data-kind]')?.textContent.trim()||'');note('check 2: first Log row badge reads "'+badgeText+'"');
   await shot(page,'log-tab-desktop');
  },page);}finally{await context.close();}}

 /* 3. plan review: seeded proposal → plan.execute queues the pinned task once; roadmap edits invalidate the review; the UI shows a failed card for a fenceless lead */
 {await check('seeded prepared proposal executes once, idempotently, with the pinned task id',async()=>{
   const plans=await revisionOf();assert(plans.revision,'plans section exposes a revision');
   const task=(plans.items||[]).find(item=>item.id==='space-seedlings');assert(task&&!task.done,'pinned task space-seedlings is open in the seeded roadmap');
   const steps=[{n:1,title:'Space the seedlings evenly',issue:'Space the seedlings so none overlap; keep room near the edges.',taskId:'space-seedlings',taskText:'Space the seedlings',issueIds:[]}];
   const review={summary:'One step: space the seedlings.',steps:[{n:1,title:'Space the seedlings evenly',task:{id:'space-seedlings',text:'Space the seedlings',milestone:'First shoots'},issueIds:[],context:'',dependsOn:[]}],warnings:[]};
   const seeded=seedProposal('plan-fixture',steps,review,plans.revision);
   const shown=(await api('/api/plans?id=plan-fixture')).body;assert.equal(shown.state,'prepared');assert.equal(shown.fingerprint,seeded.fingerprint,'GET /api/plans?id= reports the seeded fingerprint');assert.equal(shown.review.steps[0].task.id,'space-seedlings');
   assert((await api('/api/plans?project=paper-garden')).body.some(p=>p.id==='plan-fixture'),'project listing includes the proposal');
   const first=await command('plan.execute',{id:'plan-fixture',fingerprint:seeded.fingerprint},'paper-garden');assert.equal(first.ok,true,'plan.execute: '+JSON.stringify(first.error));
   assert.equal(first.data.state,'executed');assert.equal(first.data.results.length,1);
   const runId=first.data.results[0].runId;const fixers=(await api('/api/fixers')).body;const queued=fixers.find(f=>f.id===runId);assert(queued,'the queued Build is listed');assert.equal(queued.taskId,'space-seedlings','Build carries the pinned task id');assert.equal(queued.title,'Space the seedlings evenly');
   const second=await command('plan.execute',{id:'plan-fixture',fingerprint:seeded.fingerprint},'paper-garden');assert.equal(second.ok,true,'second approve is accepted: '+JSON.stringify(second.error));
   assert.deepEqual(second.data.results.map(r=>r.runId),[runId],'second approve is idempotent (same runIds)');
   assert.equal((await api('/api/fixers')).body.filter(f=>f.taskId==='space-seedlings').length,1,'exactly one Build for the pinned task');
   await fixture.fixer.waitForFixer(runId);
  });
  await check('roadmap edited after review rejects execution with REVIEW_CHANGED',async()=>{
   const plans=await revisionOf();
   const steps=[{n:1,title:'Dim the evening lights',issue:'Dim the lights after dusk.',taskId:'dim-lights',taskText:'Dim the lights',issueIds:[]}];
   const review={summary:'One step: dim the lights.',steps:[{n:1,title:'Dim the evening lights',task:{id:'dim-lights',text:'Dim the lights',milestone:'Evening garden'},issueIds:[],context:'',dependsOn:[]}],warnings:[]};
   const seeded=seedProposal('plan-fixture-changed',steps,review,plans.revision);
   assert.equal((await api('/api/plans?id=plan-fixture-changed')).body.state,'prepared');
   const path=join(fixture.vault,'plans/paper-garden.md');writeFileSync(path,readFileSync(path,'utf8')+'\n- [ ] Water at dusk <!-- nibbi-task:water-dusk -->\n');
   fixture.runtime.emit({type:'vault.updated',projectId:'paper-garden',payload:{path:'plans/paper-garden.md'}});
   assert.notEqual((await revisionOf()).revision,plans.revision,'the roadmap revision moved');
   const result=await command('plan.execute',{id:'plan-fixture-changed',fingerprint:seeded.fingerprint},'paper-garden');
   assert.equal(result.ok,false,'execution refused');assert.match(result.error.message,/^REVIEW_CHANGED:/,'error names REVIEW_CHANGED: '+result.error.message);
   const after=(await api('/api/plans?id=plan-fixture-changed')).body;assert.equal(after.state,'failed');assert.match(after.error||'',/^REVIEW_CHANGED:/);
   assert.equal((await api('/api/fixers')).body.some(f=>f.taskId==='dim-lights'),false,'nothing was queued for the changed plan');
  });
  const {page,context}=await pageFor({project:'paper-garden'});
  try{await check('/plan propose with a fenceless lead shows a failed review card without Approve',async()=>{
   await page.waitForFunction(()=>nibbiApp.state().project==='paper-garden');
   const turn=await say(page,'/plan propose make the garden calmer');
   const stored=(await api('/api/plans?project=paper-garden')).body;assert(Array.isArray(stored)&&stored.some(p=>p.state==='failed'&&/fence/i.test(p.error||'')),'the backend stored a failed proposal for the fenceless reply: '+JSON.stringify(stored).slice(0,300));
   const card=turn.locator('.planr');assert.equal(await card.count(),1,'one plan review card under the reply');
   assert.equal(await card.getAttribute('data-state'),'failed','card state is failed');
   assert.match(await card.locator('.prerr').first().innerText(),/json plan fence/i,'card shows the parse error');
   assert.equal(await card.getByRole('button',{name:/^approve/i}).count(),0,'no Approve button');
   assert.equal(await card.getByRole('button',{name:/^adjust/i}).count(),1,'Adjust stays available');
   await shot(page,'plan-review-desktop');
  },page);}finally{await context.close();}}

 /* 4. steering: honest errors, run.steer only while live, no Guide form on a record that is not live, send button idle label */
 {seedFixer('fx-seeded-running');   // a stored record with status running but no live provider: never steerable
  await check('turn.steer on a bogus id and run.steer on a non-live record refuse honestly',async()=>{
   const bogus=await command('turn.steer',{id:'turn-does-not-exist',text:'go the other way'},'paper-garden');
   assert.equal(bogus.ok,false);assert.equal(bogus.error.message,'Turn is not active');
   const status=(await api('/api/status')).body;assert.equal(status.activeTurn,null,'no active turn is reported');
   const steer=await command('run.steer',{id:'fx-seeded-running',text:'keep the edges clear'},'paper-garden');assert.equal(steer.ok,false);assert.equal(steer.error.message,'Run is not steerable');
   const builds=(await api('/api/project-section?project=paper-garden&section=builds')).body;const seeded=(builds.runs||[]).find(run=>run.id==='fx-seeded-running');assert(seeded,'seeded record is in the Builds section');
   assert.equal((seeded.allowedActions||[]).includes('run.steer'),false,'Builds section never offers run.steer for a record that is not live: '+(seeded.allowedActions||[]).join(','));
  });
  await check('/api/fixers rows carry allowedActions without run.steer for a non-live record',async()=>{
   const row=(await api('/api/fixers')).body.find(f=>f.id==='fx-seeded-running');assert(row,'seeded record is listed');
   assert(Array.isArray(row.allowedActions),'rows carry allowedActions (keys: '+Object.keys(row).join(',')+')');assert.equal(row.allowedActions.includes('run.steer'),false,'run.steer is not offered for a record that is not live: '+row.allowedActions.join(','));
  });
  const {page,context}=await pageFor();
  try{await check('agent card for a non-live running record shows no Guide form and the idle send button reads send',async()=>{
   assert.equal(await page.locator('#send').getAttribute('aria-label'),'send','idle send button label');
   const agent=page.locator('.agent[aria-label^="Seeded running build"]');await agent.waitFor({state:'attached'});
   await agent.evaluate(el=>{el.focus();el.dispatchEvent(new PointerEvent('pointerenter',{bubbles:true}));});
   await agent.locator('.card .acts .chip').first().waitFor({state:'attached'});
   assert.equal(await agent.locator('.guide, form[aria-label^="Guide"]').count(),0,'no Guide form on a record that is not live');
   assert.equal(await page.locator('form[aria-label^="Guide"]').count(),0,'no Guide form anywhere');
   assert.equal(await agent.locator('.card .acts .chip',{hasText:/^steer$/}).count(),1,'the /steer prefill chip remains');
   assert.equal(await page.evaluate(()=>nibbiApp.state().busy),false);assert.equal(await page.locator('#send').getAttribute('aria-label'),'send');
   await shot(page,'steering-desktop');
  },page);}finally{await context.close();}}

 /* 5. narrow screens: no horizontal scroll folded or with the edit_file step open, 44px targets in the composer and the turn */
 for(const [w,h] of [[390,844],[320,568]]){
  const {page,context}=await pageFor({width:w,height:h,demo:true});
  try{await check(`demo transcript fits ${w}x${h} with 44px targets`,async()=>{
   const turn=await say(page,'fix the turn lock bug');
   const tall=selector=>page.locator(selector).evaluateAll(els=>els.filter(el=>el.getBoundingClientRect().height<43.9).map(el=>(el.getAttribute('aria-label')||el.textContent.trim().slice(0,40)||el.className)+' '+Math.round(el.getBoundingClientRect().height)+'px'));
   const fits=async label=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal scroll '+label);for(const selector of ['#pill','.turn']){const b=await page.locator(selector).last().boundingBox();assert(b&&b.x>=-1&&b.x+b.width<=w+1,selector+' fits horizontally '+label);}};
   await fits('(folded)');assert.deepEqual(await tall('#pill button:visible, .turn button:visible'),[],'visible buttons in #pill and .turn are at least 44px tall');
   const edit=await unfoldEdit(page,turn);await edit.locator('.diffv').waitFor();
   await fits('(edit_file step open)');assert.deepEqual(await tall('.turn details.step > summary:visible'),[],'unfolded step summaries are at least 44px tall');
   await shot(page,`responsive-${w}x${h}`);
  },page);}finally{await context.close();}
 }
 await check('no page errors during the run',async()=>{assert.deepEqual(report.errors,[]);});
 report.pass=report.checks.every(c=>c.pass);if(!report.pass)process.exitCode=1;
}catch(error){report.error=error.stack;report.pass=false;process.exitCode=1;console.error(error);}
finally{clearTimeout(watchdog);await cleanup();console.log((report.pass?'PASS':'FAIL')+' harness-verify · '+report.checks.filter(c=>c.pass).length+'/'+report.checks.length+' checks · '+join(out,'results.json'));}
