// External MCP acceptance: real backend routes and the MCP settings tab against the stdio fixture server; no external network.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {projectWorkflowFixture} from './project-workflow-fixture.mjs';
const candidate=resolve(process.env.NIBBI_MCP_CANDIDATE||'.'),ui=join(candidate,'dist/ui'),daemon=join(candidate,'daemon/dist');
const out=resolve(process.env.NIBBI_MCP_OUTPUT||'output/playwright/mcp-client');mkdirSync(out,{recursive:true});
const fixtureServer=resolve('daemon/test/fixtures/mcp-server.mjs');
const report={candidate,checks:[],errors:[],fixture:'Actual backend HTTP and isolated state; external server is the stdio fixture in daemon/test/fixtures.'};
const fixture=await projectWorkflowFixture({daemon,ui});
const mcp=await import(pathToFileURL(join(daemon,'mcp-clients.js')).href);
let browser;
const check=async(name,fn)=>{try{await fn();report.checks.push({name,pass:true});console.log('PASS',name);}catch(error){report.checks.push({name,pass:false,error:error.stack});console.error('FAIL',name,error.message);throw error;}};
async function createPage(width=1180,height=712){const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.base?route.continue():route.abort());await page.goto(fixture.base+'/?nosw=1'+(width===1180?'&app=1':''));await page.waitForFunction(()=>window.nibbiApp?.state().projects?.length>=3);return {context,page};}
async function openTab(page,tab){if(await page.locator('#sidebar-toggle').isVisible()){await page.locator('#sidebar-toggle').click();await page.waitForFunction(()=>document.querySelector('#workspace-sidebar').getBoundingClientRect().x>=0);}await page.locator('#status').click();await page.locator('#st-motion').waitFor({state:'visible'});await page.locator('#st-platform').click();const dialog=page.locator('dialog.platform-panel[open]');await dialog.waitFor();await dialog.getByRole('button',{name:tab,exact:true}).click();await dialog.locator('section[aria-label="'+tab+'"]').waitFor();await page.waitForFunction(tab=>{const section=document.querySelector('dialog.platform-panel section[aria-label="'+tab+'"]');return section&&!/^Loading…$/.test(section.textContent.trim());},tab);return dialog;}
try{
 browser=await chromium.launch({channel:'chrome'});
 const {page,context}=await createPage();
 try{
  await check('an MCP server is added, secret-free, enabled and checked through the settings tab',async()=>{
   const dialog=await openTab(page,'MCP');assert.match(await dialog.innerText(),/No external MCP servers yet/);
   await dialog.getByLabel('Server name (lowercase slug)',{exact:true}).fill('fixture');await dialog.getByLabel('Transport',{exact:true}).selectOption('stdio');
   await dialog.getByLabel('Command (stdio): executable only',{exact:true}).fill(process.execPath);await dialog.getByLabel('Arguments (stdio, space separated)',{exact:true}).fill(fixtureServer+' stdio');
   await dialog.getByLabel('Secret environment names (stdio, comma separated)',{exact:true}).fill('FIXTURE_SECRET');await dialog.getByLabel('paper-garden',{exact:true}).check();
   await dialog.getByRole('button',{name:'Save server',exact:true}).click();await dialog.locator('fieldset.platform-mcp-server legend',{hasText:'fixture'}).waitFor();
   const stored=await fetch(fixture.base+'/api/mcp').then(r=>r.json());assert.equal(stored.servers[0].name,'fixture');assert.deepEqual(stored.servers[0].projects,['paper-garden']);assert.deepEqual(stored.servers[0].secretEnv,['FIXTURE_SECRET']);assert.equal(stored.servers[0].enabled,false);
   assert.equal(await dialog.getByRole('button',{name:'Store FIXTURE_SECRET',exact:true}).count(),1,'secret prompt offered per declared name');
   assert.match(await dialog.locator('fieldset.platform-mcp-server p[role=status]').innerText(),/Disabled/);
   assert.deepEqual(mcp.mcpToolsFor('paper-garden',{store:fixture.runtime}).map(t=>t.name),[],'disabled server exports nothing');
  });
  await check('enabling connects, lists tools, and exposes them only to the allowed project',async()=>{
   const restore=mcp.replaceMcpSecretsForTest(async()=>'from-keychain');
   try{
    const dialog=page.locator('dialog.platform-panel[open]');await dialog.getByRole('button',{name:'Enable',exact:true}).click();
    await page.waitForFunction(()=>/Connected · \d+ tools/.test(document.querySelector('dialog.platform-panel fieldset.platform-mcp-server p[role=status]')?.textContent||''));
    assert.match(await dialog.locator('fieldset.platform-mcp-server small',{hasText:'Tools:'}).innerText(),/echo/);
    const names=mcp.mcpToolsFor('paper-garden',{store:fixture.runtime}).map(t=>t.name);assert.ok(names.includes('ext_fixture_echo'),names.join(','));assert.deepEqual(mcp.mcpToolsFor('observatory',{store:fixture.runtime}),[]);
    const echo=mcp.mcpToolsFor('paper-garden',{store:fixture.runtime}).find(t=>t.name==='ext_fixture_echo');const result=await echo.call({text:'hello'},new AbortController().signal);assert.equal(result.content,'hello');assert.equal(result.caution,mcp.MCP_CAUTION);
    const secretEcho=mcp.mcpToolsFor('paper-garden',{store:fixture.runtime}).find(t=>t.name==='ext_fixture_secret_echo');assert.equal((await secretEcho.call({},new AbortController().signal)).content,'from-keychain');
    const events=fixture.runtime.replay(0,5000);assert.ok(events.some(e=>e.type==='mcp.called'&&e.payload.ok===true));assert.doesNotMatch(JSON.stringify(events),/from-keychain/);assert.doesNotMatch(JSON.stringify(fixture.runtime.list('mcp-servers')),/from-keychain/);
    await page.screenshot({path:join(out,'mcp-tab-1180.png')});
   }finally{restore();}
  });
  await check('disabling removes the tools from the next turn and the tab says so',async()=>{
   const dialog=page.locator('dialog.platform-panel[open]');await dialog.getByRole('button',{name:'Disable',exact:true}).click();
   await page.waitForFunction(()=>/Disabled/.test(document.querySelector('dialog.platform-panel fieldset.platform-mcp-server p[role=status]')?.textContent||''));
   assert.deepEqual(mcp.mcpToolsFor('paper-garden',{store:fixture.runtime}),[]);
   await page.keyboard.press('Escape');await page.locator('dialog.platform-panel[open]').waitFor({state:'detached'});
  });
 }finally{await context.close();}
 for(const [w,h]of[[390,844],[320,568]]){const {page,context}=await createPage(w,h);try{await check(`MCP tab fits ${w}x${h}`,async()=>{const dialog=await openTab(page,'MCP');await dialog.locator('fieldset.platform-mcp-form').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const small=await dialog.locator('section[aria-label="MCP"] button:visible').evaluateAll(els=>els.filter(el=>el.getBoundingClientRect().height<43.9).map(el=>el.textContent));assert.deepEqual(small,[]);await page.screenshot({path:join(out,`mcp-tab-${w}x${h}.png`)});});}finally{await context.close();}}
 assert.deepEqual(report.errors,[]);report.pass=report.checks.every(c=>c.pass);if(!report.pass)process.exitCode=1;
}catch(error){report.error=error.stack;process.exitCode=1;console.error(error);}
finally{await mcp.stopMcpClients(fixture.runtime).catch(()=>{});await browser?.close();await fixture.close();writeFileSync(join(out,'results.json'),JSON.stringify(report,null,2));}
