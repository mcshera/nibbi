// Web access acceptance: real backend routes and settings UI; every fetch is served by an in-process fixture transport.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {projectWorkflowFixture} from './project-workflow-fixture.mjs';
const candidate=resolve(process.env.NIBBI_WEB_CANDIDATE||'.'),ui=join(candidate,'dist/ui'),daemon=join(candidate,'daemon/dist');
const out=resolve(process.env.NIBBI_WEB_OUTPUT||'output/playwright/web-access');mkdirSync(out,{recursive:true});
const report={candidate,checks:[],errors:[],fixture:'Actual backend HTTP, isolated state; web transport and search key injected in-process, no external network.'};
const fixture=await projectWorkflowFixture({daemon,ui});
const web=await import(pathToFileURL(join(daemon,'web-tools.js')).href);
const pages=new Map([['https://docs.example.org/guide','<html><head><title>Guide</title></head><body><h1>Guide</h1><p>Real docs text.</p></body></html>']]);
const restoreTransport=web.replaceWebTransportForTest({key:'fixture-brave-key',lookup:async()=>[{address:'203.0.113.9',family:4}],transport:async request=>{const body=Buffer.from(pages.get(request.url.href)??'missing');return {status:pages.has(request.url.href)?200:404,headers:{'content-type':'text/html; charset=utf-8'},body:(async function*(){yield body;})()};}});
let browser;
const check=async(name,fn)=>{try{await fn();report.checks.push({name,pass:true});console.log('PASS',name);}catch(error){report.checks.push({name,pass:false,error:error.stack});console.error('FAIL',name,error.message);throw error;}};
async function createPage(width=1180,height=712){const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.base?route.continue():route.abort());await page.goto(fixture.base+'/?nosw=1'+(width===1180?'&app=1':''));await page.waitForFunction(()=>window.nibbiApp?.state().projects?.length>=3);return {context,page};}
async function openProviders(page){if(await page.locator('#sidebar-toggle').isVisible()){await page.locator('#sidebar-toggle').click();await page.waitForFunction(()=>document.querySelector('#workspace-sidebar').getBoundingClientRect().x>=0);}await page.locator('#status').click();await page.locator('#st-motion').waitFor({state:'visible'});await page.locator('#st-platform').click();const dialog=page.locator('dialog.platform-panel[open]');await dialog.waitFor();await dialog.getByLabel('Project settings',{exact:true}).waitFor();return dialog;}
try{
 browser=await chromium.launch({channel:'chrome'});
 const {page,context}=await createPage();
 try{
  await check('web access settings round-trip through the real API and stay owner-only',async()=>{
   const dialog=await openProviders(page);await dialog.getByLabel('Project settings',{exact:true}).selectOption('paper-garden');
   const status=dialog.locator('.platform-web p[role=status]');await status.waitFor();assert.match(await status.innerText(),/Search: Serper key in Keychain · Fetch: no allowed domains/);
   await dialog.getByLabel('Vault-wide web domains Nibbi may read (one per line)',{exact:true}).fill('Example.com\n*.docs.example.org');await dialog.getByRole('button',{name:'Save web domains',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('dialog.platform-panel .platform-web p[role=status]')?.textContent.includes('2 vault domains'));
   const api=await fetch(fixture.base+'/api/web?project=paper-garden').then(r=>r.json());assert.deepEqual(api.vaultDomains,['docs.example.org','example.com']);assert.equal(api.searchConfigured,true);
   await dialog.getByLabel('Web domains this project may read (comma separated)',{exact:true}).fill('godotengine.org, forum.godotengine.org');await dialog.getByRole('button',{name:'Save project commands',exact:true}).click();
   await page.waitForFunction(async()=>{const projects=await fetch('/api/projects').then(r=>r.json());return (projects.find(p=>p.name==='paper-garden')?.webDomains||[]).length===2;});
   const projects=await fetch(fixture.base+'/api/projects').then(r=>r.json());assert.deepEqual(projects.find(p=>p.name==='paper-garden').webDomains,['forum.godotengine.org','godotengine.org']);assert.deepEqual(projects.find(p=>p.name==='paper-garden').installDomains,['registry.npmjs.org']);
   await dialog.getByRole('button',{name:'Check web access',exact:true}).click();await page.waitForFunction(()=>document.querySelector('dialog.platform-panel .platform-web p[role=status]')?.textContent.includes('2 project domains for paper-garden'));
   await page.screenshot({path:join(out,'web-access-1180.png')});
   await page.keyboard.press('Escape');await page.locator('dialog.platform-panel[open]').waitFor({state:'detached'});
  });
  await check('governed fetch allows only allowlisted hosts and records each decision as an event',async()=>{
   const tools=await web.webTools('paper-garden',{store:fixture.runtime});assert.deepEqual(tools.map(t=>t.name).sort(),['web_fetch','web_search']);
   const fetchTool=tools.find(t=>t.name==='web_fetch'),signal=new AbortController().signal;
   const page=await fetchTool.call({url:'https://docs.example.org/guide'},signal);assert.equal(page.title,'Guide');assert.match(page.text,/Real docs text/);
   const denied=await fetchTool.call({url:'https://evil.example.net/'},signal);assert.equal(denied.decision,'denied');
   const events=fixture.runtime.replay(0,5000).filter(e=>e.type==='web.fetched');assert.deepEqual(events.map(e=>e.payload.decision),['allowed','denied']);
   assert.doesNotMatch(JSON.stringify(fixture.runtime.replay(0,5000)),/fixture-brave-key/);
  });
 }finally{await context.close();}
 for(const [w,h]of[[390,844],[320,568]]){const {page,context}=await createPage(w,h);try{await check(`web access fieldset fits ${w}x${h}`,async()=>{const dialog=await openProviders(page);await dialog.locator('.platform-web').scrollIntoViewIfNeeded();const box=await dialog.locator('.platform-web').boundingBox();assert(box.width<=w+1,'fieldset fits');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const small=await dialog.locator('.platform-web button:visible').evaluateAll(els=>els.filter(el=>el.getBoundingClientRect().height<43.9).map(el=>el.textContent));assert.deepEqual(small,[]);await page.screenshot({path:join(out,`web-access-${w}x${h}.png`)});});}finally{await context.close();}}
 assert.deepEqual(report.errors,[]);report.pass=report.checks.every(c=>c.pass);if(!report.pass)process.exitCode=1;
}catch(error){report.error=error.stack;process.exitCode=1;console.error(error);}
finally{restoreTransport();await browser?.close();await fixture.close();writeFileSync(join(out,'results.json'),JSON.stringify(report,null,2));}
