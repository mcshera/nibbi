// The control panel's behaviour in the real built app (docs/CONTROL-PANEL.md §8.5): the Cards bar and the
// Console pages over real routes and real Git, never the live app. projectWorkflowFixture gives isolated
// state, deterministic providers and a real project check, so a run really stages and really merges.
// Thirteen checks at 1180x820 and 390x844 touch, on paper-garden; each prints PASS or FAIL and a failure
// does not stop the rest. Screenshots in output/playwright/control-panel/. Run by `npm run verify`.
//
// It also carries what tools/kanban-verify.mjs protected before the Issues board left the UI: a thing
// kept for later survives a reload, and the draft in the composer is kept while you do it (checks 4, 5).
import assert from 'node:assert/strict';
import { mkdirSync, existsSync } from 'node:fs';
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
const { WORDS } = await import(new URL('../public/lib/control-panel-contract.js', import.meta.url));
const fixture = await projectWorkflowFixture({ daemon, ui: join(candidate, 'dist/ui') });
const { updateProject } = await import(pathToFileURL(join(daemon, 'projects.js')).href);
const PROJECT = 'paper-garden';
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

async function openApp({ width = 1180, height = 820, touch = false, reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch, reducedMotion, serviceWorkers: 'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === fixture.base ? route.continue() : route.abort());
  const page = await context.newPage(); page.setDefaultTimeout(12_000);
  page.on('pageerror', error => errors.push(`${width}x${height}: ${error.message}`));
  const commands = [];   // every command the page sends, by name
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/commands') commands.push(request.postDataJSON()?.name); });
  await page.goto(fixture.base + '/?nosw=1');
  await page.waitForFunction(() => window.nibbiApp?.state().projects?.length >= 3 && document.body.dataset.link === 'live');
  await barOpen(page); await chooseProject(page, PROJECT); await closeSwitcher(page);
  await page.waitForFunction(p => nibbiApp.state().thread.project === p && document.querySelector('[data-bar-build="main"]'), PROJECT);
  return { context, page, commands };
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
        await card.getByText(`automation picks its next step from plans/${PROJECT}.md`, { exact: true }).waitFor();
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
        const away = { x: 1100, y: 300 };
        const probe = async (name, locator) => {
          await locator.scrollIntoViewIfNeeded();
          const box = await locator.boundingBox(); assert.ok(box, name + ' is on screen');
          await page.mouse.move(away.x, away.y); await page.waitForTimeout(200);
          const rest = await locator.evaluate(el => getComputedStyle(el).backgroundColor);
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(200);
          const pressed = await locator.evaluate(el => { const s = getComputedStyle(el), props = s.transitionProperty.split(', '), times = s.transitionDuration.split(', '); return { bg: s.backgroundColor, active: el.matches(':active'), props, background: times[props.indexOf('background-color') % times.length] ?? null }; });
          await page.mouse.move(away.x, away.y); await page.mouse.up();   // released elsewhere: a press, never a click
          assert.equal(pressed.active, true, name + ' is pressed');
          assert.notEqual(pressed.bg, rest, `${name}: pressed (${pressed.bg}) differs from rest (${rest})`);
          assert.ok(!pressed.props.includes('all'), `${name}: no transition on all (${pressed.props})`);
          assert.equal(pressed.background, '0.12s', `${name}: background moves on --t1 (${pressed.props} / ${pressed.background})`);
        };
        await probe('a conversation row', bar(page, '.project-thread[data-thread-id="home"]'));
        await probe('main\'s row', bar(page, '[data-bar-build="main"]'));
        await probe('an improvement row', bar(page, '[data-bar-improvement="issue:keyboard-focus"]'));
        await probe('+ improvement', bar(page, '[data-cp-role="new-improvement"]'));
        await probe('▶', bar(page, '[data-cp-role="play-main"]'));
        await probe('the conversations +', bar(page, '.project-thread-new'));
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

      await check('9 busy refuses starting, in words', async () => {
        const release = fixture.holdChat();
        try {
          await page.locator('#ask').fill('How does the garden look?'); await page.locator('#ask').press('Enter');
          await page.waitForFunction(() => nibbiApp.state().busy);
          await bar(page, '.cp-group[data-cp-group="conversations"] .cp-badge', { hasText: WORDS.answering }).waitFor();
          await bar(page, '[data-cp-role="new-improvement"]').click();
          const field = bar(page, '.cp-improvement-form textarea'), start = bar(page, '[data-cp-role="start-now"]');
          assert.equal(await start.isDisabled(), true, 'start now waits for the reply');
          assert.equal(await start.getAttribute('title'), WORDS.busy);
          await field.fill('Mulch the beds'); await field.press('Enter');
          assert.equal(await bar(page, '.cp-form-note').innerText(), WORDS.busy, 'Enter says why, in words');
          const dispatched = commands.filter(n => n === 'run.dispatch').length;
          await bar(page, '[data-cp-role="up-next"]').click();
          await until('up next while answering', async () => (await issues()).items.find(i => i.text === 'Mulch the beds'));
          assert.equal(commands.filter(n => n === 'run.dispatch').length, dispatched, 'nothing started');
          assert.equal(await page.evaluate(() => nibbiApp.state().busy), true, 'and nibbi was still answering');
          await shot(page, 'busy-1180');
        } finally { release(); }
        await page.waitForFunction(() => !nibbiApp.state().busy, null, { timeout: 20_000 });
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

  await check('no page errors', async () => { assert.deepEqual(errors, []); });
} finally {
  await browser?.close();
  await fixture.close();
}
if (failed) { console.error(`Control panel checks: ${failed} failed, ${passed} passed.`); process.exitCode = 1; }
else console.log(`Control panel checks passed (${passed}): chat by default, a build row and an improvement row open their pages, + improvement starts or keeps in place, a staged ticket asks twice and merges, a failed one can be put away, plans are unreachable, × and Escape come back, starting waits for the reply in words, 44px at 390 touch, every control presses, and only building words move.`);
