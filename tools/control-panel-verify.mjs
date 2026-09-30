// The control panel's behaviour in the real built app (docs/CONTROL-PANEL.md §8.5): the Cards bar and the
// Console pages over real routes and real Git, never the live app. projectWorkflowFixture gives isolated
// state, deterministic providers and a real project check, so a run really stages and really merges.
// Fourteen checks at 1180x820 and 390x844 touch, on paper-garden (the last: stage mode picks up up next), and eight on observatory for its copies
// (docs/BUILDS-AS-COPIES.md §6.4: + New build, an improvement that lands in the copy, Ship to main asked
// twice, catch up, one plays at a time, retire, GitHub mode, 390 touch), with real git in temp repos. Each
// prints PASS or FAIL and a failure does not stop the rest. Screenshots in output/playwright/control-panel/.
// Run by `npm run verify`.
//
// It also carries what tools/kanban-verify.mjs protected before the Issues board left the UI: a thing
// kept for later survives a reload, and the draft in the composer is kept while you do it (checks 4, 5).
import assert from 'node:assert/strict';
import { mkdirSync, existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { projectWorkflowFixture } from './project-workflow-fixture.mjs';
import { chooseProject, closeSwitcher, openProjectCard } from './choose-project.mjs';

// A run's sandbox needs ripgrep; the installed backend ships it in ~/.nibbi/bin.
const nibbiBin = join(homedir(), '.nibbi', 'bin');
if (existsSync(join(nibbiBin, 'rg')) && !(process.env.PATH || '').split(':').includes(nibbiBin)) process.env.PATH = nibbiBin + ':' + (process.env.PATH || '');
const candidate = resolve(process.env.NIBBI_CP_CANDIDATE || '.'), daemon = join(candidate, 'daemon/dist');
const out = resolve(process.env.NIBBI_CP_OUTPUT || 'output/playwright/control-panel'); mkdirSync(out, { recursive: true });
const { WORDS, COPY } = await import(new URL('../public/lib/control-panel-contract.js', import.meta.url));
const fill = (template, values) => template.replace(/\{(\w+)\}/g, (all, key) => values[key] ?? all);
const fixture = await projectWorkflowFixture({ daemon, ui: join(candidate, 'dist/ui') });
const { updateProject } = await import(pathToFileURL(join(daemon, 'projects.js')).href);
const PROJECT = 'paper-garden', COPIES = 'observatory';
// main plays at a URL here, so ▶ is a live key with a press state; the project's own dev server is previews.ts's business.
updateProject(PROJECT, { play: fixture.base + '/?played=main' });

const errors = [];
let browser, failed = 0, passed = 0;
async function check(name, fn, page) {
  try { await fn(); passed++; console.log('PASS', name); }
  catch (error) {
    failed++; console.error('FAIL', name, '\n', error.stack || error.message);
    if (page) await page.screenshot({ path: join(out, 'failure-' + name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60) + '.png') }).catch(() => {});
  }
}
const until = async (what, test, ms = 15_000) => { const end = Date.now() + ms; for (;;) { const value = await test(); if (value) return value; if (Date.now() > end) throw new Error('timed out waiting for ' + what); await new Promise(r => setTimeout(r, 150)); } };
const settled = page => page.evaluate(() => Promise.race([
  Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))),
  new Promise(resolve => setTimeout(resolve, 2000)),
]));
async function shot(page, name) { await settled(page); await page.screenshot({ path: join(out, name + '.png') }); }

async function openApp({ width = 1180, height = 820, touch = false, reducedMotion = 'no-preference', project = PROJECT } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch, reducedMotion, serviceWorkers: 'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === fixture.base ? route.continue() : route.abort());
  const page = await context.newPage(); page.setDefaultTimeout(12_000);
  page.on('pageerror', error => errors.push(`${width}x${height}: ${error.message}`));
  const commands = [];   // every command the page sends, by name
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/commands') commands.push(request.postDataJSON()?.name); });
  await page.goto(fixture.base + '/?nosw=1');
  await boot(page, project);
  return { context, page, commands };
}
async function boot(page, project) {
  await page.waitForFunction(() => window.nibbiApp?.state().projects?.length >= 3 && document.body.dataset.link === 'live');
  await barOpen(page); await chooseProject(page, project); await closeSwitcher(page);
  await page.waitForFunction(p => nibbiApp.state().thread.project === p && document.querySelector('[data-bar-build="main"]'), project);
}
/** A press is visible, on --t1, and is not a click: pressed on the control and released elsewhere. */
async function pressProbe(page, name, locator) {
  const away = { x: 1100, y: 300 };
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox(); assert.ok(box, name + ' is on screen');
  await page.mouse.move(away.x, away.y); await page.waitForTimeout(200);
  const rest = await locator.evaluate(el => getComputedStyle(el).backgroundColor);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  // the press eases in on --t1; a loaded runner can go 200ms without a frame, so wait (up to 2s) for the first one that differs
  await locator.evaluate((el, rest) => new Promise(resolve => { const end = performance.now() + 2000; (function look() { if (getComputedStyle(el).backgroundColor !== rest || performance.now() > end) resolve(); else setTimeout(look, 16); })(); }), rest);
  const pressed = await locator.evaluate(el => { const s = getComputedStyle(el), props = s.transitionProperty.split(', '), times = s.transitionDuration.split(', '); return { bg: s.backgroundColor, active: el.matches(':active'), props, background: times[props.indexOf('background-color') % times.length] ?? null }; });
  await page.mouse.move(away.x, away.y); await page.mouse.up();   // released elsewhere: a press, never a click
  assert.equal(pressed.active, true, name + ' is pressed');
  assert.notEqual(pressed.bg, rest, `${name}: pressed (${pressed.bg}) differs from rest (${rest})`);
  assert.ok(!pressed.props.includes('all'), `${name}: no transition on all (${pressed.props})`);
  assert.equal(pressed.background, '0.12s', `${name}: background moves on --t1 (${pressed.props} / ${pressed.background})`);
}
async function barOpen(page) {
  if (await page.locator('#workspace-sidebar').getAttribute('aria-hidden') !== 'true') return;
  await page.locator('#sidebar-toggle').click();
  await page.waitForFunction(() => document.querySelector('#workspace-sidebar').getBoundingClientRect().x >= 0);
  await settled(page);
}
const bar = (page, selector) => page.locator('#workspace-sidebar ' + selector);
const pageOf = (page, kind, id) => page.locator(`#project-workspace .cp-page[data-cp-page="${kind}"][data-cp-id="${id}"]`);
async function ready(page, kind, id) {
  await page.waitForFunction(([kind, id]) => { const v = nibbiApp.state().projectView, root = document.querySelector('#project-workspace .cp-page'); return v?.page === kind && v.id === id && root?.dataset.cpId === id && root.getAttribute('aria-busy') === 'false'; }, [kind, id]);
  return pageOf(page, kind, id);
}
async function row(page, id) {
  const el = bar(page, `[data-bar-improvement="${id}"]`);
  if (!await el.count()) { const fold = bar(page, '[data-cp-fold]:not([aria-expanded="true"])'); if (await fold.count()) await fold.first().click(); }
  return el;
}
const view = page => page.evaluate(() => nibbiApp.state().projectView);
const inChat = page => page.evaluate(() => ({ view: nibbiApp.state().projectView, frame: document.querySelector('#project-workspace').hidden, room: document.body.classList.contains('project-view'), focus: document.activeElement?.id, home: document.querySelector('#workspace-sidebar [data-thread-id="home"]')?.getAttribute('aria-current') }));
const CHAT = { view: null, frame: true, room: false, focus: 'ask', home: 'true' };
const issues = () => fixture.section(PROJECT, 'issues');

try {
  browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
  let runId = null;
  const START = 'Leave room between the seedlings', LATER = 'Water the seedlings at dusk';

  /* ---------------------------------------------------------------------------------------- 1180x820 */
  {
    const { context, page, commands } = await openApp();
    try {
      await check('1 chat is the default', async () => {
        assert.equal(await page.locator('#project-workspace').isHidden(), true, 'no page is open');
        await bar(page, '[data-thread-id="home"][aria-current="true"]').waitFor();
        assert.equal(await bar(page, '[aria-current="page"]').count(), 0, 'no row is marked as a page');
        assert.equal(await view(page), null);
        await shot(page, 'chat-1180');
      }, page);

      await check('2 a build row opens its build page', async () => {
        await bar(page, '[data-bar-build="main"]').click();
        await ready(page, 'build', 'main');
        assert.equal(await bar(page, '[data-bar-build="main"]').getAttribute('aria-current'), 'page');
        assert.equal(await bar(page, '[data-thread-id="home"]').getAttribute('aria-current'), null, 'the conversation is not marked while a page is the room');
        assert.equal(await page.locator('#pill').isVisible(), false, 'the composer steps back');
        assert.deepEqual(await view(page), { project: PROJECT, page: 'build', id: 'main' });
        await shot(page, 'build-1180');
      }, page);

      await check('3 an improvement row opens its ticket', async () => {
        await (await row(page, 'issue:seedling-overlap')).click();
        const ticket = await ready(page, 'ticket', 'issue:seedling-overlap');
        assert.equal(await bar(page, '[data-bar-improvement="issue:seedling-overlap"]').getAttribute('aria-current'), 'page');
        assert.equal(await bar(page, '[data-bar-build="main"]').getAttribute('aria-current'), null, 'exactly one row is marked');
        assert.equal(await bar(page, '[aria-current="page"]').count(), 1);
        assert.equal(await ticket.getAttribute('data-state'), 'up_next');
        assert.equal(await ticket.locator('h1').innerText(), 'Seedlings overlap');
        await shot(page, 'ticket-1180');
      }, page);

      await check('8 × and Escape return to chat', async () => {
        await page.locator('.project-close:visible').click();
        await page.waitForFunction(() => document.querySelector('#project-workspace').hidden);
        assert.deepEqual(await inChat(page), CHAT, '× goes back to the conversation, focus in the composer');
        await bar(page, '[data-bar-build="main"]').click();
        const build = await ready(page, 'build', 'main');
        await build.locator('.project-workspace-body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.querySelector('#project-workspace').hidden);
        assert.deepEqual(await inChat(page), CHAT, 'and so does Escape from inside the page');
      }, page);

      await check('7 plans are unreachable', async () => {
        const stale = await page.evaluate(() => document.querySelectorAll('[data-project-section], .margin-tab, [data-margin-tab], .project-milestone, .project-kanban-column').length);
        assert.equal(stale, 0, 'no section tab, no strip, no milestone, no board');
        assert.equal(await page.getByRole('button', { name: /^plans?$/i }).count() + await page.getByRole('link', { name: /^plans?$/i }).count(), 0, 'nothing named plan');
        await openProjectCard(page, PROJECT);
        const card = page.locator('.margin-card:not([hidden])');
        assert.deepEqual(await card.locator('.margin-pill:visible').allInnerTexts(), ['Save', 'Repository & GitHub', 'Providers'], 'the project card keeps its two doors and its cap, and nothing else');
        for (const pill of ['Plan', 'Play', 'Fix…', 'Review']) assert.equal(await card.getByRole('button', { name: pill, exact: true }).count(), 0, `no ${pill} pill`);
        await card.getByText(WORDS.auto.line.replace('{name}', 'main'), { exact: true }).waitFor();   // automation works up next, not the plan
        await page.keyboard.press('Escape'); await closeSwitcher(page);
      }, page);

      await check('4 + improvement → start now builds in place', async () => {
        await page.locator('#ask').fill('Keep this draft');
        const turns = await page.evaluate(() => nibbiApp.state().turns.length);
        await bar(page, '[data-cp-role="new-improvement"]').click();
        const field = bar(page, '.cp-improvement-form textarea');
        assert.equal(await field.evaluate(el => el === document.activeElement), true, 'the field takes focus');
        await field.fill(START);
        await page.keyboard.press('Enter');   // Enter is start now
        const made = bar(page, '[data-bar-improvement^="run:"]').filter({ has: page.locator('.cp-primary', { hasText: START }) });
        await made.waitFor({ timeout: 10_000 });
        assert.match(await made.getAttribute('data-state'), /^(building|ready)$/);
        runId = (await made.getAttribute('data-bar-improvement')).slice(4);
        assert.ok(fixture.runtime.get('fixers', runId), 'a real run: ' + runId);
        assert.equal(commands.filter(n => n === 'run.dispatch').length, 1, 'one run.dispatch');
        assert.equal(await view(page), null, 'it never leaves the chat');
        assert.equal(await page.locator('#ask').inputValue(), 'Keep this draft', 'and never types into the composer');
        assert.equal(await page.evaluate(() => nibbiApp.state().turns.length), turns, 'or starts a turn');
        assert.equal(await bar(page, '[data-cp-role="new-improvement"]').evaluate(el => el === document.activeElement), true, 'focus is back on + improvement');
        assert.equal(await bar(page, '.cp-improvement-form').isHidden(), true, 'the form closed');
      }, page);

      await check('5 up next lists it, and it survives a reload', async () => {
        await bar(page, '[data-cp-role="new-improvement"]').click();
        await bar(page, '.cp-improvement-form textarea').fill(LATER);
        await bar(page, '[data-cp-role="up-next"]').click();
        const item = await until('the issue', async () => (await issues()).items.find(i => i.text === LATER));
        assert.equal(item.done, false, 'an open item in issues.md');
        const kept = bar(page, `[data-bar-improvement="issue:${item.id}"]`);
        await kept.waitFor();
        assert.equal(await kept.getAttribute('data-state'), 'up_next');
        assert.equal(commands.filter(n => n === 'run.dispatch').length, 1, 'up next starts nothing');
        await page.reload();
        await page.waitForFunction(() => window.nibbiApp?.state().projects?.length >= 3 && document.body.dataset.link === 'live');
        await kept.waitFor();
        assert.equal(await kept.getAttribute('data-state'), 'up_next', 'still up next after a reload');
        await page.waitForFunction(() => document.querySelector('#ask').value === 'Keep this draft', null, { timeout: 5_000 });
        await shot(page, 'up-next-1180');
      }, page);

      await check('6 a staged ticket asks twice, then merges', async () => {
        assert.ok(runId, 'check 4 made a run');
        await fixture.fixer.waitForFixer(runId);
        assert.equal(fixture.runtime.get('fixers', runId).status, 'staged');
        await (await row(page, 'run:' + runId)).click();
        const ticket = await ready(page, 'ticket', 'run:' + runId);
        await page.waitForFunction(() => { const k = document.querySelector('#project-workspace .cp-page [data-cp-key="merge"]'); return k && !k.disabled && document.querySelector('#project-workspace .cp-page')?.dataset.state === 'ready'; }, null, { timeout: 15_000 });
        const before = commands.length;
        await ticket.locator('[data-cp-key="merge"]').click();
        await ticket.locator('.cp-confirm:not([hidden])').waitFor();
        assert.equal(await ticket.locator('[data-cp-key="confirm-no"]').evaluate(el => el === document.activeElement), true, 'the question takes focus on its "no"');
        await page.waitForTimeout(300);
        assert.equal(fixture.runtime.get('fixers', runId).status, 'staged', 'the first press only asks');
        assert.deepEqual(commands.slice(before), [], 'and sends nothing');
        await shot(page, 'merge-confirm-1180');
        await ticket.locator('[data-cp-key="confirm-yes"]').click();
        await until('the merge', () => fixture.runtime.get('fixers', runId).status === 'merged', 20_000);
        assert.deepEqual(commands.slice(before), ['run.merge'], 'the second press merges, once');
        await page.waitForFunction(id => document.querySelector(`#workspace-sidebar [data-bar-improvement="run:${id}"]`)?.dataset.state === 'in', runId, { timeout: 10_000 });
        await page.waitForFunction(() => document.querySelector('#project-workspace .cp-page')?.dataset.state === 'in', null, { timeout: 10_000 });
        assert.equal(await ticket.locator('.cp-status .cp-state').innerText(), 'in', 'the page says it');
        await ticket.locator('.cp-notice', { hasText: 'merged into main.' }).waitFor();
        await shot(page, 'merged-1180');
        await page.locator('.project-close:visible').click();
        await page.waitForFunction(() => document.querySelector('#project-workspace').hidden);
      }, page);

      await check('11 press states', async () => {
        const probe = (name, locator) => pressProbe(page, name, locator);
        await probe('a conversation row', bar(page, '.project-thread[data-thread-id="home"]'));
        await probe('main\'s row', bar(page, '[data-bar-build="main"]'));
        await probe('an improvement row', bar(page, '[data-bar-improvement="issue:keyboard-focus"]'));
        await probe('+ improvement', bar(page, '[data-cp-role="new-improvement"]'));
        await probe('▶', bar(page, '[data-cp-role="play-main"]'));
        await probe('the conversations +', bar(page, '.project-thread-new'));
        await probe('the builds +', bar(page, '[data-cp-role="new-build"]'));
        await probe('Settings', page.locator('#status'));
        await probe('collapse', page.locator('.sidebar-collapse'));
        await (await row(page, 'issue:keyboard-focus')).click();
        const ticket = await ready(page, 'ticket', 'issue:keyboard-focus');
        await probe('a page key', ticket.locator('[data-cp-key="mark-done"]'));
        assert.equal((await issues()).items.find(i => i.id === 'keyboard-focus').done, false, 'pressing is not clicking');
        assert.equal(await view(page).then(v => v?.id), 'issue:keyboard-focus', 'and nothing moved');
        await page.locator('.project-close:visible').click();
        await page.waitForFunction(() => document.querySelector('#project-workspace').hidden);
      }, page);

      // D8, reversed 2026-09-29 (docs/CONTROL-PANEL.md §12.2): a run is a background agent in its own worktree, so the keys
      // that start one don't wait for nibbi's reply — only a new conversation does.
      await check('9 while nibbi answers, start now still starts', async () => {
        const release = fixture.holdChat();
        try {
          await page.locator('#ask').fill('How does the garden look?'); await page.locator('#ask').press('Enter');
          await page.waitForFunction(() => nibbiApp.state().busy);
          await bar(page, '.cp-group[data-cp-group="conversations"] .cp-badge', { hasText: WORDS.answering }).waitFor();
          await bar(page, '[data-cp-role="new-improvement"]').click();
          const field = bar(page, '.cp-improvement-form textarea'), start = bar(page, '[data-cp-role="start-now"]');
          assert.equal(await start.isDisabled(), false, 'start now does not wait for the reply');
          assert.equal(await bar(page, '.cp-improvement-form .cp-form-note').isVisible(), false, 'and nothing says it waits');
          const dispatched = commands.filter(n => n === 'run.dispatch').length;
          await field.fill('Mulch the beds'); await field.press('Enter');
          const made = bar(page, '[data-bar-improvement^="run:"]').filter({ has: page.locator('.cp-primary', { hasText: 'Mulch the beds' }) });
          await made.waitFor({ timeout: 10_000 });
          assert.equal(commands.filter(n => n === 'run.dispatch').length, dispatched + 1, 'one run, started while nibbi answered');
          assert.equal(await page.evaluate(() => nibbiApp.state().busy), true, 'and nibbi was still answering');
          assert.equal(await bar(page, '.project-thread-new').isDisabled(), true, 'a new conversation still waits: one turn at a time');
          await shot(page, 'busy-1180');
        } finally { release(); }
        await page.waitForFunction(() => !nibbiApp.state().busy, null, { timeout: 20_000 });
        const mulch = fixture.runtime.list('fixers').find(f => f.game === PROJECT && f.issue === 'Mulch the beds');
        assert.ok(mulch, 'the run is the daemon’s'); await fixture.fixer.waitForFixer(mulch.id);
      }, page);

      await check('13 a failed try is not stuck: discard puts it away', async () => {
        const at = new Date(Date.now() - 60_000).toISOString();
        for (const [id, extra] of [['cp-failed-free', { title: 'Paint the fence' }], ['cp-failed-issue', { title: 'Seedlings overlap', issueIds: ['seedling-overlap'] }]]) {
          const r = { id, game: PROJECT, project: PROJECT, repo: join(process.env.NIBBI_PROJECTS_DIR, PROJECT), issue: extra.title, branch: 'nibbi/' + id, targetBranch: 'main', worktree: join(process.env.NIBBI_WORK_DIR, id), status: 'failed', startedAt: at, endedAt: at, provider: 'claude', executionKind: 'provider', workflowMode: 'local', attemptId: 'attempt-' + id, verification: { status: 'unverified' }, summary: 'tests broke', ...extra };
          fixture.runtime.put('fixers', id, r, { type: 'run.updated', projectId: PROJECT, runId: id, payload: { run: r } });
        }
        const keysOf = ticket => ticket.locator('.cp-actions [data-cp-key]').evaluateAll(els => els.map(el => el.dataset.cpKey));
        const discardReady = () => page.waitForFunction(() => { const k = document.querySelector('#project-workspace .cp-page [data-cp-key="discard"]'); return k && !k.disabled; }, null, { timeout: 10_000 });
        async function discard(ticket, id) {
          const before = commands.length;
          await ticket.locator('[data-cp-key="discard"]').click();
          await ticket.locator('.cp-confirm:not([hidden])').waitFor();
          await page.waitForTimeout(300);
          assert.equal(fixture.runtime.get('fixers', id).status, 'failed', 'the first press only asks');
          assert.deepEqual(commands.slice(before), [], 'and sends nothing');
          await ticket.locator('[data-cp-key="confirm-yes"]').click();
          await until('the discard', () => fixture.runtime.get('fixers', id).status === 'discarded');
          assert.deepEqual(commands.slice(before), ['run.discard'], 'the second press discards, once');
        }
        // a free-text try leaves the failed list for main's settled ones
        await (await row(page, 'run:cp-failed-free')).click();
        const free = await ready(page, 'ticket', 'run:cp-failed-free');
        await discardReady();
        assert.deepEqual(await keysOf(free), ['ask', 'discard', 'retry']);
        await shot(page, 'failed-ticket-1180');
        await discard(free, 'cp-failed-free');
        await page.waitForFunction(() => document.querySelector('#project-workspace .cp-page')?.dataset.state === 'discarded');
        await page.locator('.project-close:visible').click();
        await page.waitForFunction(() => document.querySelector('#project-workspace').hidden);
        const fold = bar(page, '[data-cp-fold]:not([aria-expanded="true"])'); if (await fold.count()) await fold.first().click();
        await page.waitForFunction(() => !document.querySelector('#workspace-sidebar [data-bar-improvement="run:cp-failed-free"]'));
        await bar(page, '[data-bar-build="main"]').click();
        const build = await ready(page, 'build', 'main');
        assert.equal(await build.locator('.cp-hist[data-state="discarded"] [data-cp-key="hist-run:cp-failed-free"]').count(), 1, 'the build page keeps it with the settled ones');
        // an issue's failed try: its words and its checkbox stay; put away, the issue is up next again
        await (await row(page, 'issue:seedling-overlap')).click();
        const issue = await ready(page, 'ticket', 'issue:seedling-overlap');
        await page.waitForFunction(() => document.querySelector('#project-workspace .cp-page')?.dataset.state === 'failed');
        await discardReady();
        assert.deepEqual(await keysOf(issue), ['ask', 'edit', 'mark-done', 'discard', 'retry']);
        await discard(issue, 'cp-failed-issue');
        await page.waitForFunction(() => document.querySelector('#project-workspace .cp-page')?.dataset.state === 'up_next');
        assert.equal(await bar(page, '[data-bar-improvement="issue:seedling-overlap"]').getAttribute('data-state'), 'up_next');
        assert.deepEqual(await keysOf(issue), ['edit', 'mark-done', 'build-now']);
        await page.locator('.project-close:visible').click();
        await page.waitForFunction(() => document.querySelector('#project-workspace').hidden);
      }, page);

      // The owner, 2026-09-29: automation works the up-next list. Stage mode, chosen on the card, takes the top of up next in
      // issues.md order — two at once, the project's capacity — and the bar shows them building; the third waits, and says who starts it.
      await check('22 stage picks up up next: the top ones turn into building', async () => {
        const { automationCycle } = await import(pathToFileURL(join(daemon, 'scheduler.js')).href);
        const open = (await issues()).items.filter(i => !i.done), later = open.find(i => i.text === LATER);
        assert.deepEqual(open.slice(0, 2).map(i => i.id), ['seedling-overlap', 'keyboard-focus'], 'issues.md order');
        const release = fixture.holdFixer();
        try {
          await openProjectCard(page, PROJECT);
          await page.locator('.margin-card:not([hidden]) .margin-mode[data-mode="stage"]').click();
          await until('stage mode', () => fixture.runtime.get('config', 'auto')?.[PROJECT]?.mode === 'stage');
          await page.waitForFunction(() => !nibbiApp.state().busy);
          await closeSwitcher(page);
          await (await row(page, 'issue:' + later.id)).click();
          const ticket = await ready(page, 'ticket', 'issue:' + later.id);
          await ticket.locator('.cp-status-line', { hasText: fill(WORDS.upNextAuto, { name: 'main' }) }).waitFor();
          await page.locator('.project-close:visible').click();
          await page.waitForFunction(() => document.querySelector('#project-workspace').hidden);
          const dispatched = commands.filter(n => n === 'run.dispatch').length;
          await automationCycle(async () => {});
          for (const id of ['seedling-overlap', 'keyboard-focus']) await page.waitForFunction(id => document.querySelector(`#workspace-sidebar [data-bar-improvement="issue:${id}"]`)?.dataset.state === 'building', id, { timeout: 10_000 });
          assert.equal(await (await row(page, 'issue:' + later.id)).getAttribute('data-state'), 'up_next', 'capacity is two: the third waits');
          assert.equal(commands.filter(n => n === 'run.dispatch').length, dispatched, 'the page started nothing: automation did');
          await shot(page, 'automation-stage-1180');
        } finally { fixture.fixer.setAuto(PROJECT, { mode: 'off' }); release(); }
        for (const f of fixture.runtime.list('fixers').filter(f => f.game === PROJECT && ['seedling-overlap', 'keyboard-focus'].includes(f.issueIds?.[0]))) await fixture.fixer.waitForFixer(f.id);
      }, page);
    } finally { await context.close(); }
  }

  /* ---------------------------------------------------------------------------------------- 390x844, touch */
  {
    const { context, page } = await openApp({ width: 390, height: 844, touch: true });
    try {
      await check('10 44px at 390 touch', async () => {
        const small = scope => page.locator(scope).evaluateAll(els => els.filter(el => el.getClientRects().length && !el.closest('[hidden]')).map(el => { const r = el.getBoundingClientRect(), icon = el.matches('.cp-icon-key, .cp-key'); return { name: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30) || el.className, h: Math.round(r.height), w: Math.round(r.width), icon }; }).filter(b => b.h < 43.5 || (b.icon && b.w < 43.5)));
        await barOpen(page);
        assert.deepEqual(await small('#workspace-sidebar button'), [], 'every button in the drawer is 44 tall, every icon key 44 wide');
        await bar(page, '[data-cp-role="new-improvement"]').click();
        assert.deepEqual(await small('#workspace-sidebar .cp-improvement-form button'), [], 'and the form\'s keys');
        await page.keyboard.press('Escape');   // the form, then
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll');
        await shot(page, 'bar-390');
        await bar(page, '[data-bar-build="main"]').click();
        await ready(page, 'build', 'main');
        assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'true', 'a row that opens a page puts the drawer away first');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll on the build page');
        assert.deepEqual(await small('#project-workspace .cp-page button'), [], 'every key on the build page is 44');
        await shot(page, 'build-390');
        await barOpen(page); await (await row(page, 'run:' + runId)).click();
        await ready(page, 'ticket', 'run:' + runId);
        assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'true');
        assert.deepEqual(await small('#project-workspace .cp-page button'), [], 'every key on a ticket is 44');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll on the ticket');
        await shot(page, 'ticket-390');
      }, page);
    } finally { await context.close(); }
  }

  /* ---------------------------------------------------------------------------------------- live, then reduced */
  {
    // A run that is building for as long as the check needs it: the record the daemon keeps while a provider works.
    const id = 'cp-seeded-building';
    const record = { id, game: PROJECT, project: PROJECT, repo: join(process.env.NIBBI_PROJECTS_DIR, PROJECT), issue: 'Keep the paths clear', title: 'Keep the paths clear', branch: 'nibbi/' + id, worktree: join(process.env.NIBBI_WORK_DIR, id), status: 'running', startedAt: new Date().toISOString(), provider: 'claude', executionKind: 'provider', workflowMode: 'local', attemptId: 'attempt-' + id, verification: { status: 'unverified' } };
    fixture.runtime.put('fixers', id, record, { type: 'run.updated', projectId: PROJECT, runId: id, payload: { run: record } });
    const running = async (page, inBar) => page.evaluate(inBar => document.getAnimations().filter(a => a.playState === 'running' && (inBar ? document.querySelector('#workspace-sidebar') : document.querySelector('#project-workspace')).contains(a.effect?.target)).map(a => a.animationName || a.transitionProperty), inBar);
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const { context, page } = await openApp({ reducedMotion });
      try {
        await check(reducedMotion === 'reduce' ? '12 reduced: nothing moves in the bar or the page' : '12 live: a building row\'s word pulses', async () => {
          const live = bar(page, `[data-bar-improvement="run:${id}"]`);
          await live.waitFor(); assert.equal(await live.getAttribute('data-state'), 'building');
          const word = live.locator('.cp-word.cp-live');
          if (reducedMotion === 'reduce') {
            await page.waitForTimeout(400);
            assert.deepEqual(await running(page, true), [], 'no animation runs in the bar');
            await live.click(); await ready(page, 'ticket', 'run:' + id); await page.waitForTimeout(600);
            assert.deepEqual(await running(page, false), [], 'or on the page');
          } else {
            assert.equal(await word.evaluate(el => el.getAnimations().some(a => a.animationName === 'cp-bar-pulse' && a.playState === 'running')), true, 'its word pulses (cp-bar-pulse)');
            await live.click(); const ticket = await ready(page, 'ticket', 'run:' + id);
            assert.equal(await ticket.locator('.cp-status .cp-state').evaluate(el => el.getAnimations().some(a => a.animationName === 'cp-page-pulse' && a.playState === 'running')), true, 'and so does the ticket\'s word (cp-page-pulse)');
          }
          await shot(page, 'building-' + reducedMotion);
        }, page);
      } finally { await context.close(); }
    }
  }

  /* ---------------------------------------------------------------------------------------- copies (docs/BUILDS-AS-COPIES.md §6.4) */
  {
    // observatory: main and its copies play as servers; the check is the fixture's real one
    await fixture.prepareCopies(COPIES);
    const repo = join(process.env.NIBBI_PROJECTS_DIR, COPIES);
    const gitIn = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
    const sha = ref => fixture.git(COPIES, 'rev-parse', ref);
    const copyNamed = async name => (await fixture.copies(COPIES)).copies.find(c => c.name === name);
    const word = (page, name) => page.evaluate(n => document.querySelector(`#workspace-sidebar [data-bar-build="${n}"] .cp-word:not(.cp-count)`)?.textContent ?? null, name);
    const note = (page, name) => page.evaluate(n => document.querySelector(`#workspace-sidebar [data-bar-build="${n}"] .cp-note`)?.textContent ?? null, name);
    const wordIs = (page, name, text, timeout = 20_000) => page.waitForFunction(([n, t]) => document.querySelector(`#workspace-sidebar [data-bar-build="${n}"] .cp-word:not(.cp-count)`)?.textContent === t, [name, text], { timeout });
    const playing = async id => (await fetch(fixture.base + '/api/preview?id=' + encodeURIComponent(id)).then(r => r.json()));
    const mainPlaying = async () => (await fetch(fixture.base + '/api/play?project=' + COPIES).then(r => r.json()));
    const posts = (commands, name) => commands.filter(n => n === name).length;
    const ON_DEV = 'Light the dome from below', LATER_DEV = 'Label the constellations';
    const small = (page, scope) => page.locator(scope).evaluateAll(els => els.filter(el => el.getClientRects().length && !el.closest('[hidden]')).map(el => { const r = el.getBoundingClientRect(), icon = el.matches('.cp-icon-key, .cp-key'); return { name: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30) || el.className, h: Math.round(r.height), w: Math.round(r.width), icon }; }).filter(b => b.h < 43.5 || (b.icon && b.w < 43.5)));
    let shippedRuns = [], issueId = null;

    const { context, page, commands } = await openApp({ project: COPIES });
    try {
      await check('14 + New build → dev appears, a copy of main', async () => {
        const mainSha = await sha('main');
        updateProject(COPIES, { install: 'sleep 2' });   // long enough to see it being made
        try {
          await bar(page, '[data-cp-role="new-build"]').click();
          const form = bar(page, '[data-cp-role="build-form"]'); await form.waitFor({ state: 'visible' });
          const field = bar(page, '[data-cp-role="build-name"]');
          assert.equal(await field.inputValue(), COPY.first, 'the suggested name is dev');
          assert.equal(await field.evaluate(el => el === document.activeElement && el.selectionStart === 0 && el.selectionEnd === el.value.length), true, 'and it is selected, so typing replaces it');
          await form.getByText(WORDS.copy.formSub, { exact: true }).waitFor();
          await page.keyboard.press('Enter');
          await bar(page, '[data-bar-build="dev"]').waitFor();
          await page.waitForFunction(() => { const w = document.querySelector('#workspace-sidebar [data-bar-build="dev"] .cp-word:not(.cp-count)'); return w?.textContent === 'making the copy' && w.getAnimations().some(a => a.animationName === 'cp-bar-pulse' && a.playState === 'running'); });
          await shot(page, 'copy-making-1180');
          await wordIs(page, 'dev', 'nothing to ship yet');
        } finally { updateProject(COPIES, { install: 'true' }); }
        assert.equal(posts(commands, 'copy.create'), 1, 'one copy.create');
        assert.equal(await note(page, 'dev'), WORDS.copy.line, 'line two: copy of main');
        assert.equal(await bar(page, '[data-bar-build="dev"]').evaluate(el => el === document.activeElement), true, 'focus is on the new row');
        const dev = await copyNamed('dev');
        assert.equal(dev.branch, COPY.branchPrefix + 'dev');
        assert.equal(dev.headSha, mainSha, 'made at main\'s head');
        assert.equal(await sha('refs/heads/' + dev.branch), mainSha);
        assert.ok(realpathSync(dev.worktree).startsWith(realpathSync(process.env.NIBBI_WORK_DIR) + '/'), 'its worktree is under the work dir: ' + dev.worktree);
        const at = (await fixture.git(COPIES, 'worktree', 'list', '--porcelain')).split('\n\n').filter(block => block.split('\n').includes('branch refs/heads/' + dev.branch));
        assert.equal(at.length, 1, 'the branch is checked out in one worktree');
        assert.equal(realpathSync(at[0].split('\n')[0].slice('worktree '.length)), realpathSync(dev.worktree), 'its own');
        assert.equal(await view(page), null, 'nothing opened a page');
        await pressProbe(page, 'a copy row', bar(page, '[data-bar-build="dev"]'));
        await shot(page, 'copy-made-1180');
      }, page);

      await check('15 + improvement on dev → it lands in dev, main unchanged', async () => {
        const mainSha = await sha('main'), before = await copyNamed('dev');
        await bar(page, '[data-cp-role="new-improvement"][data-build="dev"]').click();
        const field = bar(page, '.cp-improvement-form textarea');
        assert.equal(await field.getAttribute('placeholder'), WORDS.copy.formPlaceholder.replace('{name}', 'dev'), 'the form says where it lands');
        await field.fill(ON_DEV); await page.keyboard.press('Enter');
        const made = bar(page, '[data-bar-build-body="dev"] [data-bar-improvement^="run:"]').filter({ hasText: ON_DEV });
        await made.waitFor();
        const id = (await made.getAttribute('data-bar-improvement')).slice(4);
        assert.equal(fixture.runtime.get('fixers', id).copyId, before.id, 'the run aims at dev');
        await fixture.fixer.waitForFixer(id);
        await until('it lands', () => fixture.runtime.get('fixers', id).status === 'merged', 20_000);
        shippedRuns.push(id);
        assert.equal(await sha('main'), mainSha, 'main is unchanged');
        const dev = await copyNamed('dev');
        assert.notEqual(dev.headSha, before.headSha, 'dev moved');
        assert.equal(gitIn(dev.worktree, 'rev-parse', 'HEAD'), dev.headSha, 'its worktree is at its new head, not stale');
        assert.equal(gitIn(dev.worktree, 'status', '--porcelain'), '', 'and clean');
        assert.ok(readdirSync(dev.worktree).some(f => /^fixture-change-/.test(f) && readFileSync(join(dev.worktree, f), 'utf8').includes(ON_DEV)), 'with the change in it');
        assert.equal(gitIn(repo, 'status', '--porcelain'), '', 'the project folder is untouched');
        await page.waitForFunction(id => document.querySelector(`#workspace-sidebar [data-bar-build-body="dev"] [data-bar-improvement="run:${id}"]`)?.dataset.state === 'in', id);
        assert.equal(await bar(page, `.cp-build[data-build="main"] [data-bar-improvement="run:${id}"]`).count(), 0, 'it is in dev, not main');
        await wordIs(page, 'dev', 'ready to play');
        await page.waitForFunction(() => document.querySelector('#workspace-sidebar [data-bar-build="dev"] .cp-note')?.textContent === 'copy of main · 1 ahead');
        await bar(page, '[data-bar-build="dev"]').click();
        const devPage = await ready(page, 'build', 'dev');
        await page.waitForFunction(() => document.querySelector('#project-workspace .cp-copyline')?.textContent === 'copy of main · 1 ahead · 0 behind');
        await shot(page, 'copy-landed-1180');
        // up next on dev, then build it now from its ticket: it lands in dev, and the issue stays open
        await bar(page, '[data-cp-role="new-improvement"][data-build="dev"]').click();
        await bar(page, '.cp-improvement-form textarea').fill(LATER_DEV);
        await bar(page, '[data-cp-role="up-next"]').click();
        const item = await until('the issue', async () => (await fixture.section(COPIES, 'issues')).items?.find(i => i.text === LATER_DEV));
        issueId = item.id;
        const kept = bar(page, `[data-bar-build-body="dev"] [data-bar-improvement="issue:${item.id}"]`);
        await kept.waitFor(); assert.equal(await kept.getAttribute('data-state'), 'up_next');
        await kept.click();
        const ticket = await ready(page, 'ticket', 'issue:' + item.id);
        await page.waitForFunction(() => { const k = document.querySelector('#project-workspace .cp-page [data-cp-key="build-now"]'); return k && !k.disabled; });
        await ticket.locator('[data-cp-key="build-now"]').click();
        const run = await until('its run', () => fixture.fixer.listFixers().find(f => f.issueIds?.includes(item.id)));
        assert.equal(run.copyId, before.id, 'build it now aims at dev too');
        await fixture.fixer.waitForFixer(run.id);
        await until('it lands', () => fixture.runtime.get('fixers', run.id).status === 'merged', 20_000);
        shippedRuns.push(run.id);
        assert.equal(await sha('main'), mainSha, 'main is still unchanged');
        assert.equal((await fixture.section(COPIES, 'issues')).items.find(i => i.id === item.id).done, false, 'in dev is not done: the issue stays open until dev ships');
        void devPage;
      }, page);

      await check('16 Ship to main asks twice, then main has it and dev is level', async () => {
        await bar(page, '[data-bar-build="dev"]').click();
        const devPage = await ready(page, 'build', 'dev');
        const ship = devPage.locator('[data-cp-key="ship"]');
        await page.waitForFunction(() => { const k = document.querySelector('#project-workspace .cp-page [data-cp-key="ship"]'); return k && !k.disabled && /ink/.test(k.className); }, null, { timeout: 15_000 });
        const before = commands.length;
        await ship.click();
        const panel = devPage.locator('.cp-ship'); await panel.waitFor();
        assert.equal(await devPage.locator('[data-cp-key="ship-no"]').evaluate(el => el === document.activeElement), true, 'the question takes focus on "not yet"');
        const said = await panel.innerText();
        for (const title of [ON_DEV, LATER_DEV]) assert.ok(said.includes(title), 'it lists ' + title);
        assert.ok(said.includes(WORDS.copy.shipChecks.replace('{command}', 'test -n "$(ls fixture-change-*.txt)"')), 'and the checks it runs again');
        await page.waitForTimeout(300);
        assert.deepEqual(commands.slice(before), [], 'the first press only asks');
        await shot(page, 'ship-confirm-1180');
        const devHead = (await copyNamed('dev')).headSha;
        await devPage.locator('[data-cp-key="ship-yes"]').click();
        await until('main has dev', async () => await sha('main') === devHead, 30_000);
        assert.deepEqual(commands.slice(before), ['copy.ship'], 'yes ships, once');
        await devPage.locator('.cp-notice', { hasText: WORDS.copy.shipDoneMany.replace('{n}', '2') }).waitFor({ timeout: 15_000 });
        await page.waitForFunction(() => document.querySelector('#project-workspace .cp-copyline')?.textContent === 'copy of main · 0 ahead · 0 behind', null, { timeout: 15_000 });
        await wordIs(page, 'dev', 'nothing to ship yet');
        const dev = await copyNamed('dev');
        assert.equal(dev.headSha, devHead, 'the copy stays, level with main');
        assert.equal(dev.status, 'ready');
        assert.deepEqual([dev.ahead, dev.behind], [0, 0]);
        for (const id of shippedRuns) assert.equal(fixture.runtime.get('fixers', id).shipped?.sha, devHead, 'its runs are marked shipped');
        await page.waitForFunction(id => document.querySelector(`#workspace-sidebar .cp-build[data-build="main"] [data-bar-improvement="run:${id}"]`)?.dataset.state === 'in', shippedRuns[0]);
        assert.equal(await bar(page, `[data-bar-build-body="dev"] [data-bar-improvement]`).count(), 0, 'nothing is left in dev');
        assert.equal((await fixture.section(COPIES, 'issues')).items.find(i => i.id === issueId).done, true, 'the issue is done now, at ship');
        await shot(page, 'shipped-1180');
      }, page);

      await check('17 main moves on → dev says catch up → catch up', async () => {
        await page.locator('.project-close:visible').click();
        await page.waitForFunction(() => document.querySelector('#project-workspace').hidden);
        const moved = await fixture.commit(COPIES, 'Main moved on', { 'main-moved.txt': 'the owner committed on main\n' });
        await chooseProject(page, PROJECT); await closeSwitcher(page);
        await chooseProject(page, COPIES); await closeSwitcher(page);
        await wordIs(page, 'dev', 'main moved on · catch up');
        const row = bar(page, '[data-bar-build-body="dev"] [data-cp-role="catch-up"]'); await row.waitFor();
        await bar(page, '[data-bar-build="dev"]').click();
        const devPage = await ready(page, 'build', 'dev');
        await devPage.locator('.cp-tiles', { hasText: '1 behind' }).waitFor();
        await shot(page, 'behind-1180');
        const before = commands.length;
        await row.click();
        await page.waitForFunction(() => document.querySelector('#project-workspace .cp-copyline')?.textContent === 'copy of main · 0 ahead · 0 behind', null, { timeout: 20_000 });
        assert.deepEqual(commands.slice(before).filter(n => n.startsWith('copy.')), ['copy.catchUp'], 'one catch up, no question (it is not playing)');
        const dev = await copyNamed('dev');
        execFileSync('git', ['-C', repo, 'merge-base', '--is-ancestor', 'main', dev.branch]);
        assert.equal(await sha('main'), moved, 'main is only read');
        assert.equal(gitIn(dev.worktree, 'rev-parse', 'HEAD'), dev.headSha);
        assert.equal(gitIn(dev.worktree, 'status', '--porcelain'), '', 'dev\'s worktree is clean');
        assert.ok(existsSync(join(dev.worktree, 'main-moved.txt')), 'and has main\'s newest');
        await shot(page, 'caught-up-1180');
      }, page);

      await check('18 One plays at a time', async () => {
        const dev = await copyNamed('dev'), preview = COPY.preview.replace('{project}', COPIES).replace('{copyId}', dev.id);
        await bar(page, '[data-cp-role="play-main"]').click();
        await until('main playing', async () => { const p = await mainPlaying(); return p.running && p.url; }, 30_000);
        await bar(page, '[data-bar-build="dev"]').click();
        const devPage = await ready(page, 'build', 'dev');
        await devPage.locator('.cp-preview-hint', { hasText: WORDS.copy.oneAtATime.replace('{other}', 'main') }).waitFor();
        await devPage.locator('[data-cp-key="play"]').click();
        await until('dev playing', async () => { const p = await playing(preview); return p.running && p.url; }, 30_000);
        assert.equal((await mainPlaying()).running, false, 'playing dev stopped main');
        await devPage.locator('.cp-preview', { hasText: 'dev is playing' }).waitFor();
        await wordIs(page, 'dev', 'nothing to ship yet');
        await shot(page, 'playing-dev-1180');
        await devPage.locator('[data-cp-key="play-stop"]').click();
        await until('dev stopped', async () => !(await playing(preview)).running, 15_000);
      }, page);

      await check('19 Retire asks, refuses while building, then dev is gone', async () => {
        const release = fixture.holdFixer();
        let id;
        try {
          await bar(page, '[data-cp-role="new-improvement"][data-build="dev"]').click();
          await bar(page, '.cp-improvement-form textarea').fill('Polish the telescope');
          await page.keyboard.press('Enter');
          const made = bar(page, '[data-bar-build-body="dev"] [data-bar-improvement^="run:"]').filter({ hasText: 'Polish the telescope' });
          await made.waitFor(); id = (await made.getAttribute('data-bar-improvement')).slice(4);
          await bar(page, '[data-bar-build="dev"]').click();
          const devPage = await ready(page, 'build', 'dev');
          const retire = devPage.locator('[data-cp-key="retire"]');
          await page.waitForFunction(() => document.querySelector('#project-workspace .cp-page [data-cp-key="retire"]')?.disabled === true);
          assert.equal(await retire.getAttribute('title'), WORDS.copy.retireBuilding.replace('{name}', 'dev'), 'retire says why it waits');
          await shot(page, 'retire-building-1180');
        } finally { release(); }
        await fixture.fixer.waitForFixer(id);
        await until('it lands', () => fixture.runtime.get('fixers', id).status === 'merged', 20_000);
        const devPage = pageOf(page, 'build', 'dev');
        await page.waitForFunction(() => document.querySelector('#project-workspace .cp-page [data-cp-key="retire"]')?.disabled === false, null, { timeout: 15_000 });
        const dev = await copyNamed('dev'), mainSha = await sha('main');
        const before = commands.length;
        await devPage.locator('[data-cp-key="retire"]').click();
        const strip = devPage.locator('.cp-retire .cp-confirm'); await strip.waitFor();
        assert.ok((await strip.innerText()).includes(WORDS.copy.retireUnshippedOne.replace(/^, /, '')), 'it names the improvement that hasn\'t shipped');
        assert.equal(await devPage.locator('[data-cp-key="retire-no"]').evaluate(el => el === document.activeElement), true, 'focus on keep');
        await page.waitForTimeout(300);
        assert.deepEqual(commands.slice(before), [], 'the first press only asks');
        await shot(page, 'retire-confirm-1180');
        await devPage.locator('[data-cp-key="retire-yes"]').click();
        await until('dev retired', async () => !(await copyNamed('dev')), 15_000);
        assert.deepEqual(commands.slice(before), ['copy.retire'], 'yes retires, once');
        await page.waitForFunction(() => !document.querySelector('#workspace-sidebar [data-bar-build="dev"]'));
        assert.equal(existsSync(dev.worktree), false, 'its worktree is gone');
        assert.throws(() => execFileSync('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', 'refs/heads/' + dev.branch], { stdio: 'pipe' }), 'its branch is gone');
        assert.equal(await sha('main'), mainSha, 'main is unchanged');
        assert.ok(existsSync(fixture.runtime.get('fixers', id).worktree), 'the run\'s own worktree is kept');
        await page.locator('#project-workspace .cp-page h1', { hasText: WORDS.copy.gone }).waitFor();
        await shot(page, 'gone-1180');
        await page.locator('.project-close:visible').click();
        await page.waitForFunction(() => document.querySelector('#project-workspace').hidden);
      }, page);

      await check('20 A GitHub-mode project shows copies disabled with a reason', async () => {
        const GH = 'weekend-notes', undo = fixture.githubMode(GH);
        try {
          await page.reload(); await boot(page, GH);
          const words = WORDS.copy.githubMode.replace('{project}', GH);
          const key = bar(page, '[data-cp-role="new-build"]');
          await page.waitForFunction(w => document.querySelector('#workspace-sidebar [data-cp-role="new-build"]')?.title === w, words);
          const before = commands.length;
          await key.click();
          const form = bar(page, '[data-cp-role="build-form"]'); await form.waitFor({ state: 'visible' });
          assert.equal(await form.locator('.cp-form-note').innerText(), words, 'the form says why');
          assert.equal(await bar(page, '[data-cp-role="build-name"]').isDisabled(), true, 'the name can\'t be typed');
          assert.equal(await bar(page, '[data-cp-role="make-build"]').isDisabled(), true, 'and make it is off');
          assert.equal(await form.locator('.cp-form-x').evaluate(el => el === document.activeElement), true, 'focus waits on ×');
          await form.evaluate(el => el.requestSubmit()); await page.waitForTimeout(300);   // Enter in the form, whatever has focus
          assert.equal(await form.locator('.cp-form-note').innerText(), words, 'a submit only says it again');
          assert.deepEqual(commands.slice(before), [], 'nothing is sent');
          await shot(page, 'github-cant-1180');
          await form.locator('.cp-form-x').click();
          await form.waitFor({ state: 'hidden' });
          await bar(page, '[data-bar-build="main"]').click();
          const main = await ready(page, 'build', 'main');
          await main.locator('.cp-copies', { hasText: words }).waitFor();
          const direct = await fetch(fixture.base + '/api/commands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'copy.create', projectId: GH, args: { name: 'dev' }, idempotencyKey: randomUUID() }) }).then(r => r.json());
          assert.equal(direct.ok, false, 'the daemon refuses it too');
          assert.equal(direct.error.message, words);
          assert.equal((await fixture.copies(GH)).copies.length, 0, 'and nothing was made');
          await page.locator('.project-close:visible').click();
        } finally { undo(); }
      }, page);
    } finally { await context.close(); }

    const small390 = await openApp({ width: 390, height: 844, touch: true, project: COPIES });
    try {
      const { page } = small390;
      await check('21 Copies at 390 touch', async () => {
        await barOpen(page);
        await bar(page, '[data-cp-role="new-build"]').click();
        assert.equal(await bar(page, '[data-cp-role="build-name"]').inputValue(), 'dev', 'a retired name is free again');
        await page.keyboard.press('Enter');
        await bar(page, '[data-bar-build="dev"]').waitFor();
        await wordIs(page, 'dev', 'nothing to ship yet');
        await bar(page, '[data-cp-role="play-copy"][data-build="dev"]').scrollIntoViewIfNeeded();
        assert.deepEqual(await small(page, '#workspace-sidebar button'), [], 'every button in the drawer is 44 tall, every icon key 44 wide — the copy row, its caret, play and ship');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll');
        await shot(page, 'copies-bar-390');
        await bar(page, '[data-bar-build="dev"]').click();
        await ready(page, 'build', 'dev');
        assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'true', 'a copy row puts the drawer away first');
        assert.deepEqual(await small(page, '#project-workspace .cp-page button'), [], 'every key on the copy\'s page is 44');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll on its page');
        await shot(page, 'copy-page-390');
      }, page);
    } finally { await small390.context.close(); }
  }

  await check('no page errors', async () => { assert.deepEqual(errors, []); });
} finally {
  await browser?.close();
  await fixture.close();
}
if (failed) { console.error(`Control panel checks: ${failed} failed, ${passed} passed.`); process.exitCode = 1; }
else console.log(`Control panel checks passed (${passed}): chat by default, a build row and an improvement row open their pages, + improvement starts or keeps in place, a staged ticket asks twice and merges, a failed one can be put away, plans are unreachable, × and Escape come back, start now starts while nibbi answers, stage mode picks up up next, 44px at 390 touch, every control presses, and only building words move; + New build makes a real copy of main, an improvement lands in it and main is unchanged, Ship to main asks twice and leaves the copy level with main, catch up brings main's newest in, one build plays at a time, retire waits for a building improvement and then takes the copy off the machine, GitHub mode says why copies can't be made, and copies are 44px at 390 touch.`);
