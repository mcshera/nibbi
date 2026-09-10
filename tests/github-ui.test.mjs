import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const head = 'a'.repeat(40), base = 'b'.repeat(40);
const connection = { repository: 'mcshera/paper-garden', host: 'github.com', account: 'mcshera', repo: '/a local garden', visibility: 'private', integrationBranch: 'staging', localTargetBranch: 'staging', releaseBranch: 'main', workflowMode: 'github', mergeMethods: ['squash'], requiredChecks: [{ name: 'verify', appId: 15368, acceptedConclusions: ['success'] }] };
const projectData = { project: 'paper-garden', connection, local: { branch: 'garden-work', headSha: head, dirty: true, changedFiles: 2, upstream: null }, branches: [{ name: 'staging', headSha: base }], allowedActions: ['build.adoptChanges', 'project.publishBranch', 'project.syncTarget', 'project.preparePromotion'], freshness: { status: 'fresh', observedAt: Date.now() }, promotions: [] };
const buildData = { buildId: 'build-one', project: 'paper-garden', mode: 'github', binding: { branch: 'nibbi/build-one', baseBranch: 'staging', connection }, publication: { headSha: head, pushedSha: base, verifiedSha: head }, toPush: true, pushedSha: base, pr: { number: 12, state: 'OPEN', draft: true, url: 'https://github.com/mcshera/paper-garden/pull/12', headSha: base, baseBranch: 'staging', reviewDecision: 'CHANGES_REQUESTED', mergeable: false, reviews: [{ author: 'Matty', state: 'CHANGES_REQUESTED', body: 'Keep keyboard controls.' }] }, checkState: { status: 'blocked', blockers: ['verify has not passed on the current head'] }, checks: [{ name: 'verify', status: 'completed', conclusion: 'failure', headSha: base }], allowedActions: ['build.publish', 'build.update', 'build.checkpoint', 'build.updateBase', 'build.prAdopt'], freshness: { status: 'stale', observedAt: Date.now() - 150000 }, operations: [] };
const changes = { project: 'paper-garden', headSha: head, sourceRevision: 'source-exact-1', files: [{ path: 'garden.txt', status: 'modified', hunks: [{ id: 'first', header: '@@ -1 +1 @@', patch: '-old\n+new' }, { id: 'second', header: '@@ -8 +8 @@', patch: '-other\n+retained' }] }, { path: 'leaf.png', status: 'added', binary: true, hunks: [] }] };

async function harness(browser, { build = true, viewport = { width: 1180, height: 712 } } = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://github-ui.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><link rel="stylesheet" href="/project-workspace.css"><style>:root{--ink:#151413;--ink-2:#484139;--ink-3:#6a645b;--paper:#f8f5ef;--line:#ddd7ce}body{margin:0;padding:24px;background:var(--paper);color:var(--ink);font:14px Georgia}*{box-sizing:border-box}[hidden]{display:none!important}main{max-width:760px;margin:auto}.project-action{font:inherit}</style></head><body><main></main></body></html>' });
    try { return route.fulfill({ contentType: extname(path) === '.css' ? 'text/css' : 'text/javascript', body: readFileSync(resolve('public', '.' + path)) }); } catch { return route.fulfill({ status: 404 }); }
  });
  await page.goto('https://github-ui.test/');
  await page.evaluate(async ({ projectData, buildData, changes, build }) => {
    window.records = { project: projectData, build: buildData, changes }; window.calls = []; window.receipts = []; window.outcome = { state: 'succeeded' };
    const { createGithubPanel } = await import('/lib/github-ui.js');
    window.mount = async (project = 'paper-garden', isBuild = build) => {
      const panel = createGithubPanel({ project, ...(isBuild ? { buildId: 'build-one', run: { title: 'Give seedlings room', commitSha: buildData.publication.headSha } } : {}), onChanged: result => receipts.push(result), onAction: async (name, selectedProject, args) => {
        calls.push({ name, project: selectedProject, args: Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'signal')) });
        if(name==='buildEvidence')return {entries:[{text:'Only entries for '+args.attemptId}]};
        if (name === 'githubRead') return structuredClone(records[args.kind]);
        if (name === 'githubRefresh') return {};
        if (args.command === 'github.prepare') {
          if (window.holdPrepare) await new Promise(resolve => window.finishPrepare = resolve);
          return { operationId: `operation-${selectedProject}`, review: { destination: `github.com/mcshera/${selectedProject}`, headSha: buildData.publication.headSha, baseSha: 'b'.repeat(40), ...args.args } };
        }
        if (window.holdExecute) await new Promise(resolve => window.finishExecute = resolve);
        if (window.conflict) throw new Error('The reviewed head changed. Prepare this operation again.');
        return structuredClone(window.outcome);
      } });
      document.querySelector('main').replaceChildren(panel.element); window.panel = panel; await panel.open(); return panel;
    };
    await mount();
  }, { projectData, buildData, changes, build });
  return { page, context, errors };
}

test('GitHub writes execute only the reviewed operation; stale head errors retain the exact review', async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const { page, context, errors } = await harness(browser);
  try {
    assert.match(await page.locator('.github-content').innerText(), /Local updates to push/);
    assert.match(await page.locator('.github-content').innerText(), /verify has not passed on the current head/);
    assert.equal(await page.getByRole('button', { name: 'Merge pull request', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Push build branch', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm push', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => calls.filter(c => c.name === 'githubCommand' && c.args.command !== 'github.prepare').length), 0);
    assert.match(await page.locator('.github-review').innerText(), new RegExp(head));
    await page.evaluate(() => { window.conflict = true; });
    await page.getByRole('button', { name: 'Confirm push', exact: true }).click();
    await page.getByText('The reviewed head changed. Prepare this operation again.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Confirm push', exact: true }).isVisible(), true);
    const execute = await page.evaluate(() => calls.find(c => c.args.command === 'build.publish'));
    assert.deepEqual(execute, { name: 'githubCommand', project: 'paper-garden', args: { command: 'build.publish', args: { operationId: 'operation-paper-garden' } } });
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});

test('adoption captures exact selected text hunks and whole binary files without capturing other edits', async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const { page, context, errors } = await harness(browser, { build: false });
  try {
    await page.getByRole('button', { name: 'Create build from local changes', exact: true }).click();
    await page.getByLabel('Build title', { exact: true }).fill('One leaf, one text change');
    await page.getByText('Inspect changes · 2 hunks', { exact: true }).click();
    await page.getByLabel('Include garden.txt @@ -1 +1 @@', { exact: true }).check();
    await page.getByLabel('Include leaf.png', { exact: true }).check();
    await page.getByRole('button', { name: 'Review selected changes', exact: true }).click();
    await page.getByRole('button', { name: 'Create selected build', exact: true }).waitFor();
    const prepared = await page.evaluate(() => calls.find(c => c.args.command === 'github.prepare').args.args);
    assert.deepEqual(prepared, { operation: 'build.adoptChanges', sourceRevision: 'source-exact-1', selection: [{ path: 'garden.txt', hunkIds: ['first'] }, { path: 'leaf.png' }], title: 'One leaf, one text change' });
    await page.getByRole('button', { name: 'Back to edit', exact: true }).click();
    assert.equal(await page.getByLabel('Build title', { exact: true }).inputValue(), 'One leaf, one text change');
    assert.equal(await page.getByLabel('Include garden.txt @@ -8 +8 @@', { exact: true }).isChecked(), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});

test('background refresh retains form focus and a real pointer target; late receipts retain their project', async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const { page, context, errors } = await harness(browser);
  try {
    await page.getByRole('button', { name: 'Update this build', exact: true }).click();
    await page.getByLabel('What should change?', { exact: true }).fill('Keep this typed review note.');
    await page.evaluate(async () => { window.input = document.activeElement; records.build.pr.number = 99; await panel.refresh(); });
    assert.equal(await page.evaluate(() => input === document.activeElement), true);
    const target = page.getByRole('button', { name: 'Review operation', exact: true });
    const handle = await target.elementHandle(), box = await target.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.evaluate(() => panel.refresh());
    assert.equal(await handle.evaluate(el => el.isConnected), true);
    await page.mouse.up();
    await page.getByRole('button', { name: 'Start update', exact: true }).waitFor();
    await page.evaluate(() => { window.holdExecute = true; });
    await page.getByRole('button', { name: 'Start update', exact: true }).click();
    await page.waitForFunction(() => !!window.finishExecute);
    await page.evaluate(async () => { window.oldPanel = panel; await mount('other-project', false); finishExecute(); });
    await page.waitForFunction(() => receipts.length === 1);
    assert.equal(await page.evaluate(() => receipts[0].project), 'paper-garden');
    assert.equal(await page.locator('.github-panel').getAttribute('aria-label'), 'Repository & GitHub for other-project');
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});

test('unknown remote outcomes stay pending and expose operation evidence', async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const { page, context, errors } = await harness(browser);
  try {
    await page.getByRole('button', { name: 'Push build branch', exact: true }).click();
    await page.evaluate(() => { outcome = { state: 'unknown' }; records.build.operations = [{ operation: 'build.publish', state: 'unknown', error: 'Transport timed out after publication began.', updatedAt: Date.now() }]; });
    await page.getByRole('button', { name: 'Confirm push', exact: true }).click();
    await page.getByText('The operation is still being confirmed. Refresh GitHub status to inspect its result.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => receipts.length), 0);
    await page.getByText('Publication history', { exact: true }).click();
    assert.match(await page.locator('.github-content').innerText(), /Unknown[\s\S]*Transport timed out/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});

test('repository and build evidence fit desktop, narrow, and short windows with usable controls', async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const viewport of [{ width: 1180, height: 712 }, { width: 390, height: 844 }, { width: 390, height: 430 }]) {
      const { page, context, errors } = await harness(browser, { viewport });
      try {
        for (const surface of ['build', 'repository', 'connection']) {
          if (surface === 'repository') await page.evaluate(() => mount('paper-garden', false));
          if (surface === 'connection') await page.getByRole('button', { name: 'Edit repository connection', exact: true }).click();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          const shortControls = await page.locator('.github-panel button:visible').evaluateAll(els => els.filter(el => el.getBoundingClientRect().height < 43.9).map(el => el.textContent));
          assert.deepEqual(shortControls, []);
          const out = resolve('output/playwright/github-ui'); mkdirSync(out, { recursive: true });
          await page.screenshot({ path: resolve(out, `${surface}-${viewport.width}x${viewport.height}.png`), fullPage: true });
        }
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
});

test('persisted operation reviews execute their exact id and attempt logs keep immutable attribution', async()=>{
 const browser=await chromium.launch({channel:'chrome'});const{page,context,errors}=await harness(browser);
 try{
  await page.evaluate(async()=>{records.build.attempts=[{id:'first-attempt',kind:'initial',status:'staged',candidateSha:'a'.repeat(40)},{id:'second-attempt',kind:'update',status:'staged',candidateSha:'c'.repeat(40)}];records.build.operations=[{id:'persisted-review',operation:'build.publish',state:'prepared',expiresAt:Date.now()+60000,review:{destination:'github.com/mcshera/paper-garden',headSha:'a'.repeat(40)}}];await panel.refresh({force:true});});
  await page.getByText('Execution attempts · 2',{exact:true}).click();await page.getByRole('button',{name:'Read attempt log',exact:true}).first().click();
  await page.getByText('Only entries for first-attempt',{exact:true}).waitFor();assert.equal(await page.getByText('Only entries for second-attempt',{exact:true}).count(),0);
  await page.getByText('Publication history',{exact:true}).click();await page.getByRole('button',{name:'Review this operation',exact:true}).click();
  assert.equal(await page.evaluate(()=>calls.filter(c=>c.args.command==='github.prepare').length),0);await page.getByRole('button',{name:'Confirm push',exact:true}).click();
  await page.waitForFunction(()=>receipts.length===1);assert.equal(await page.evaluate(()=>calls.find(c=>c.args.command==='build.publish').args.args.operationId),'persisted-review');assert.deepEqual(errors,[]);
 }finally{await context.close();await browser.close();}
});

test('PR templates are editable, retain separate drafts through refresh, and submit the exact reviewed body',async()=>{
 const browser=await chromium.launch({channel:'chrome'});
 try{
  for(const build of [true,false]){
   const{page,context,errors}=await harness(browser,{build,viewport:{width:320,height:568}});
   try{
    await page.evaluate(async build=>{records.prDraft={project:'paper-garden',...(build?{buildId:'build-one'}:{}),title:build?'Garden change':'Promote the garden',body:'## Problem\nTemplate default\n\n## Validation\nRecorded context\n',selectedTemplatePath:'.github/pull_request_template.md',commitSha:'a'.repeat(40),templates:[{path:'.github/pull_request_template.md',body:'## Problem\nTemplate default\n',commitSha:'a'.repeat(40)},{path:'.github/PULL_REQUEST_TEMPLATE/release.md',body:'## Release notes\nFill these in.\n',commitSha:'a'.repeat(40)}]};if(build)records.build.allowedActions=['build.prCreate'];await panel.refresh({force:true});},build);
    await page.getByRole('button',{name:build?'Create draft pull request':'Prepare promotion to release',exact:true}).click();
    const body=page.getByLabel('Pull request description',{exact:true}),template=page.getByLabel('Pull request template',{exact:true});
    assert.match(await body.inputValue(),/Template default[\s\S]*Recorded context/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const edited='\n## Problem\nMy edited description.\n\n## Validation\nExact trailing newline.\n';await body.fill(edited);
    await template.selectOption('.github/PULL_REQUEST_TEMPLATE/release.md');assert.equal(await body.inputValue(),'## Release notes\nFill these in.\n');await template.selectOption('.github/pull_request_template.md');assert.equal(await body.inputValue(),edited);
    await body.focus();await page.evaluate(async()=>{window.savedInput=document.activeElement;records.prDraft.body='A new server draft must not overwrite my text.';await panel.refresh();});assert.equal(await body.inputValue(),edited);assert.equal(await page.evaluate(()=>document.activeElement===savedInput),true);
    await page.getByRole('button',{name:'Review operation',exact:true}).click();await page.locator('.github-review').waitFor();const prepared=await page.evaluate(()=>calls.find(call=>call.args.command==='github.prepare').args.args);assert.equal(prepared.body,edited);assert.equal(prepared.operation,build?'build.prCreate':'project.preparePromotion');assert.equal(Object.hasOwn(prepared,'template'),false);assert.match(await page.locator('.github-review').innerText(),/My edited description/);
    await page.getByRole('button',{name:build?'Create draft PR':'Create promotion PR',exact:true}).click();await page.waitForFunction(()=>receipts.length===1);const executed=await page.evaluate(()=>calls.find(call=>['build.prCreate','project.preparePromotion'].includes(call.args.command)).args.args);assert.deepEqual(executed,{operationId:'operation-paper-garden'});assert.deepEqual(errors,[]);
   }finally{await context.close();}
  }
 }finally{await browser.close();}
});

test('delivery labels distinguish remote branch changes from ordinary pull request states', async () => {
  const { githubDeliveryLabel } = await import('../public/lib/github-ui.js');
  const pr = { number: 12, state: 'OPEN', draft: false, reviewDecision: 'APPROVED', approvals: 1 };
  assert.equal(githubDeliveryLabel({ status: 'staged', github: { mode: 'github', pr, delivery: 'pull_request', freshness: {} } }), 'PR #12 · Approved');
  assert.equal(githubDeliveryLabel({ status: 'staged', github: { mode: 'github', pr, delivery: 'remote_changed', remoteChanged: true, freshness: {} } }), 'PR #12 · Remote branch changed');
});
