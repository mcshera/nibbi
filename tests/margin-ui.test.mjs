import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {progressLine} from '../public/lib/margin-ui.js';
import {GROUPS, STATE_TONES, STATE_WORDS, WORDS} from '../public/lib/control-panel-contract.js';
import {buildsCard, conversationsFor, copyNameProblem} from '../public/lib/builds-model.js';

// The bar is loaded into the page as a data: module, and a data: module cannot resolve a relative
// import, so the two modules margin-ui.js imports (./empty.js, ./control-panel-contract.js) are inlined the same way.
async function marginModuleURL() {
  const inline = async name => 'data:text/javascript;base64,' + Buffer.from(await readFile(new URL('../public/lib/' + name, import.meta.url))).toString('base64');
  let source = await readFile(new URL('../public/lib/margin-ui.js', import.meta.url), 'utf8');
  for (const name of ['empty.js', 'control-panel-contract.js']) source = source.replace(`'./${name}'`, `'${await inline(name)}'`);
  return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
}
/** The view models the bar takes (control-panel-contract.js BarModel), built in the page. */
const VM = `
  window.imp = (id, title, state, more = {}) => ({ id, kind: id.startsWith('issue:') ? 'issue' : 'run', title, state,
    word: ${JSON.stringify(STATE_WORDS)}[state], tone: ${JSON.stringify(STATE_TONES)}[state], live: state === 'building',
    group: (${JSON.stringify(GROUPS)}.find(g => g.states.includes(state)) || {id: 'settled'}).id,
    context: '', when: null, reason: '', issueId: null, runIds: [], latestRunId: null, order: 0, ...more });
  window.mainOf = (over = {}) => ({ id: 'main', name: 'main', branch: 'main', line: 'live · what ships', word: 'live',
    badge: {text: '', tone: 'quiet'}, attention: {text: '', tone: 'quiet'}, counts: {},
    play: {playable: true, running: false, starting: false, url: null, blocked: '', note: '', lastCommit: ''},
    check: {command: 'npm test', real: true}, github: null, improvements: [], settled: [], list: 'ready', blocked: {start: '', queue: '', play: ''}, ...over });
  window.minutesAgo = m => new Date(Date.now() - m * 60000).toISOString();
`;
async function harness(page, {extra = '', onAction = 'calls.push({action, id, value})'} = {}) {
  const errors = []; page.on('pageerror', err => errors.push(err.message));
  await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--ease:ease-out;--ink:#151413;--ink-2:#3a3835;--ink-3:#6f6b65}*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:#f5f2ec}</style><nav id="project-rail"></nav><nav id="settings-rail"></nav>${extra}`);
  await page.addStyleTag({content: await readFile(new URL('../public/tokens.css', import.meta.url), 'utf8')});
  await page.addStyleTag({content: await readFile(new URL('../public/margins.css', import.meta.url), 'utf8')});
  await page.addScriptTag({content: VM});
  await page.evaluate(async ([url, body]) => {
    const {installMarginUI} = await import(url);
    window.calls = [];
    window.ui = installMarginUI({onAction: new Function('action', 'id', 'value', body)});
  }, [await marginModuleURL(), onAction]);
  return errors;
}
const frame = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
/** What a held control shows. The press eases in on --t1 and reads as its rest value until a frame is drawn, which a loaded runner can put off past 160ms, so poll (up to 2s) until `prop` leaves `rest`, or matches `want`. */
const held = (locator, rest, {prop = 'backgroundColor', want = null} = {}) => locator.evaluate((el, [rest, prop, want]) => new Promise(resolve => {
  const end = performance.now() + 2000;
  (function look() { const now = getComputedStyle(el)[prop]; if ((want ? new RegExp(want).test(now) : now !== rest) || performance.now() > end) resolve(now); else setTimeout(look, 16); })();
}), [rest, prop, want]);
const probeColor = (page, locator, value) => locator.evaluate((el, value) => { const probe = document.createElement('i'); probe.style.color = value; document.body.append(probe); const c = getComputedStyle(probe).color; probe.remove(); return c; }, value);

test('progress line reports verified merges without proposing a next goal', () => {
  assert.equal(progressLine(undefined), 'Progress not available');
  assert.equal(progressLine(null), 'Progress not available');
  assert.equal(progressLine({available: false}), 'Progress not available');
  assert.equal(progressLine({available: false, today: {deliveries: 4}, week: {deliveries: 9}, streak: 2}), 'Progress not available', 'unavailable wins over stale numbers');
  assert.equal(progressLine({available: true}), 'Progress not available', 'no counts is not zero progress');
  assert.equal(progressLine({available: true, today: {deliveries: 0}, week: {deliveries: 0}, streak: 0}), 'Nothing merged yet today');
  assert.equal(progressLine({available: true, today: {deliveries: 0}, week: {deliveries: 3}, streak: 0}), 'Nothing merged yet today · 3 this week');
  assert.equal(progressLine({available: true, today: {deliveries: 0}, week: {deliveries: 1}, streak: 1}), 'Nothing merged yet today · 1 this week · 1-day streak');
  assert.equal(progressLine({available: true, today: {deliveries: 2}, week: {deliveries: 5}, streak: 3}), '2 merged today · 5 this week · 3-day streak');
  assert.equal(progressLine({available: true, today: {deliveries: 1}, week: {deliveries: 1}, streak: 1}), '1 merged today · 1 this week · 1-day streak');
  assert.equal(progressLine({today: {deliveries: 1}, week: {deliveries: 1}, streak: 1}), '1 merged today · 1 this week · 1-day streak', 'available defaults to true when counts exist');
  assert.equal(progressLine({available: true, today: {deliveries: 2.7}, week: {deliveries: 'five'}, streak: -1}), '2 merged today', 'non-counts are dropped, not invented');
  for (const progress of [undefined, {available: true, today: {deliveries: 0}}, {available: true, today: {deliveries: 3}, week: {deliveries: 3}, streak: 4}]) {
    assert.doesNotMatch(progressLine(progress), /next milestone|keep going|next target|one more|remind/i);
  }
});

// Isolated browser contract test: no app/backend/provider network access.
test('the bar preserves live authority, drafts, focus, and responsive controls', {timeout: 90000}, async () => {
  const browser = await chromium.launch({channel: process.env.CI ? undefined : 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    const errors = await harness(page, {
      extra: '<button id="outside" style="position:fixed;bottom:10px;left:50%">Outside</button><div id="already-inert" inert>Previously unavailable</div>',
      onAction: `calls.push({action, id, value});
        if (action === 'repository') return Promise.reject(new Error('Fixture action failed'));
        if (action === 'spendCap') return new Promise(resolve => { window.capResolve = resolve; });`,
    });
    await page.evaluate(() => {
      window.model = {projects: [
        {id: 'alpha', name: 'Alpha <img src=x onerror=alert(1)>', active: true, branch: 'main', goal: 'A real goal', mode: 'stage', spend: 14.2, spendCap: 40,
          attention: {text: '1 ready to review', tone: 'attention'},
          conversations: [{id: 'home', title: 'Home', lastAt: minutesAgo(3), lastText: 'the last thing said', active: true, count: 2}],
          builds: [mainOf({badge: {text: '1 ready to review', tone: 'attention'}, improvements: [
            imp('run:r1', 'lobby: show who is ready', 'ready', {when: {verb: 'staged', at: minutesAgo(12)}}),
            imp('run:b1', 'queue music between rounds', 'building', {when: {verb: 'started', at: minutesAgo(4)}}),
            imp('issue:u1', 'spectators see the score', 'up_next', {context: 'from issues.md', issueId: 'u1'}),
          ]})]},
        {id: 'beta', name: 'Beta', mode: 'off', spend: null, spendCap: null, attention: {text: '', tone: 'quiet'}, conversations: [], builds: [mainOf()]},
        {id: 'gamma', name: 'Gamma', mode: 'off', attention: {text: '', tone: 'quiet'}, conversations: [], builds: [mainOf()]},
      ], projectsLoaded: true, activeProject: 'alpha', view: null, busy: false, settings: {microphone: false, microphonePhase: 'off', voice: true, sounds: false, notifications: false, notificationsSupported: true, notificationStatus: 'Not requested', model: 'fixture-model', provider: 'fixture', brain: 'ready', session: 'test', context: '100 tokens', demo: false, calm: false, systemReduced: false}};
      ui.update(model);
    });
    assert.deepEqual(await page.evaluate(() => calls), []);
    assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'false', 'desktop starts expanded');
    assert.equal(await page.locator('#workspace-sidebar').getAttribute('role'), 'complementary');
    assert.equal(await page.locator('#project-rail img').count(), 0);
    const progress = page.locator('#project-rail #sidebar-progress');
    assert.equal(await progress.count(), 1, 'one companion progress line in the projects rail');
    assert.equal(await progress.getAttribute('role'), 'status');
    assert.ok(await progress.evaluate(el => el.classList.contains('margin-muted')), 'quiet muted style');
    assert.equal(await progress.innerText(), 'Progress not available', 'no progress in the model reads as unavailable, not zero');
    assert.ok(await progress.evaluate(el => el.closest('.margin-foot') === document.querySelector('.margin-body').lastElementChild), 'the quiet line is the foot, the last thing in the scroll under the cards');
    for (const [value, said] of [
      [{available: true, today: {deliveries: 0}, week: {deliveries: 0}, streak: 0}, 'Nothing merged yet today'],
      [{available: true, today: {deliveries: 0}, week: {deliveries: 4}, streak: 0}, 'Nothing merged yet today · 4 this week'],
      [{available: true, today: {deliveries: 2}, week: {deliveries: 5}, streak: 3}, '2 merged today · 5 this week · 3-day streak'],
      [{available: true, today: {deliveries: 1}, week: {deliveries: 1}, streak: 1}, '1 merged today · 1 this week · 1-day streak'],
      [{available: false}, 'Progress not available'], [undefined, 'Progress not available'],
    ]) {
      await page.evaluate(value => { if (value === null) delete model.progress; else model.progress = value; ui.update(model); }, value ?? null);
      assert.equal(await progress.innerText(), said);
      assert.equal(await progress.textContent(), said, 'textContent is exactly progressLine(), which three suites pin');
    }
    await page.evaluate(() => {model.progress = {available: true, today: {deliveries: 2}, week: {deliveries: 5}, streak: 3}; ui.update(model);});
    assert.deepEqual(await progress.locator('.cp-seg').allTextContents(), ['2 merged today', ' · 5 this week', ' · 3-day streak'], 'each fact is its own piece, so one that does not fit drops whole');
    assert.equal(await progress.getAttribute('title'), '2 merged today · 5 this week · 3-day streak', 'and the whole line is reachable');
    assert.deepEqual(await page.evaluate(() => calls), [], 'progress rendering dispatches nothing');

    const card = page.locator('.margin-card:not([hidden])');
    const switcher = page.locator('.margin-switch-trigger');
    // every animation that ends (a building word pulses for as long as it builds)
    const settled = () => page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().endTime !== Infinity).map(a => a.finished.catch(() => {}))));
    const openMenu = async () => { await settled(); if (!await page.locator('.margin-switch-menu').isVisible()) await switcher.click(); await settled(); };   // a panel mid-fade still reads as visible
    // The gear lives in the switcher's list, so reaching it means opening the list.
    const gear = async id => { await openMenu(); return options(id); };
    const row = id => page.locator(`.margin-switch-menu .margin-project[data-project-id="${id}"]`);
    const options = id => page.locator('.project-group').filter({has: page.locator(`.margin-project[data-project-id="${id}"]`)}).locator('.project-options');
    // Every project is a row in the switcher's list; only the current one has its cards.
    assert.equal(await page.locator('.project-group').count(), 3);
    assert.equal(await switcher.getAttribute('data-current-project'), 'alpha', 'the switcher names the project the model says is active');
    assert.equal(await switcher.locator('.cp-badge').innerText(), '1 ready to review', 'and says what it wants from you, in words');
    assert.deepEqual(await page.locator('[data-bar-build]').evaluateAll(els => els.map(el => el.dataset.barBuild)), ['main'], 'a project with no copies draws main alone, for the current project only');
    assert.equal(await page.locator('[data-build-id]').count(), 0, 'the lobby’s hook is nowhere in the bar');
    assert.deepEqual(await page.locator('.cp-group').evaluateAll(els => els.map(el => el.dataset.cpGroup)), ['conversations', 'builds'], 'both groups, pinned open');
    assert.equal(await page.locator('.margin-switch-menu').isVisible(), false, 'the list starts closed');
    await openMenu();
    assert.equal(await page.locator('.margin-switch-menu').isVisible(), true);
    assert.deepEqual(await page.evaluate(() => calls), [], 'opening the list dispatches nothing');
    assert.equal(await card.count(), 0, 'opening the list does not open settings');
    await row('beta').click();
    await settled();
    assert.equal(await page.locator('.margin-switch-menu').isVisible(), false, 'choosing a project closes the list');
    assert.deepEqual(await page.evaluate(() => calls), [{action: 'selectProject', id: 'beta', value: undefined}]);
    assert.equal(await switcher.getAttribute('data-current-project'), 'alpha', 'project selection remains owned by the supplied model');

    // A build row opens its build page, an improvement row its ticket. The bar invents no state: the model's view marks the row.
    await page.locator('[data-bar-build="main"]').click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'openBuild', id: 'alpha', value: 'main'});
    await page.locator('[data-bar-improvement="run:r1"]').click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'openImprovement', id: 'alpha', value: 'run:r1'});
    const marked = () => page.locator('.margin-body [aria-current]').evaluateAll(els => els.map(el => [el.dataset.threadId ?? el.dataset.barBuild ?? el.dataset.barImprovement, el.getAttribute('aria-current')]));
    assert.deepEqual(await marked(), [['home', 'true']], 'chat is the default: the open conversation is the one row marked, and clicking invents no page');
    await page.evaluate(() => {model.view = {project: 'alpha', page: 'build', id: 'main'}; ui.update(model);});
    assert.deepEqual(await marked(), [['main', 'page']], 'the build page marks main, and only main');
    assert.equal(await page.locator('.cp-mainrow.is-current').count(), 1, 'main’s whole line lifts, its ▶ with it');
    await page.evaluate(() => {model.view = {project: 'alpha', page: 'ticket', id: 'issue:u1'}; ui.update(model);});
    assert.deepEqual(await marked(), [['issue:u1', 'page']], 'a ticket marks its improvement, and only it');
    await page.evaluate(() => {model.view = null; ui.update(model);});
    assert.deepEqual(await marked(), [['home', 'true']]);
    // A conversation row asks for its conversation even when it is the open one: what it really asks for is
    // to leave the page, so it dispatches whatever the thread — openThread leaves the page first.
    await page.evaluate(() => {model.view = {project: 'alpha', page: 'build', id: 'main'}; ui.update(model);});
    const beforeChat = await page.evaluate(() => calls.length);
    await page.locator('.project-thread[data-thread-id="home"]').click();
    assert.equal(await page.evaluate(() => calls.length), beforeChat + 1, 'the open conversation’s row dispatches even when nothing about the thread changes');
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'thread', id: 'alpha', value: 'home'});
    // Escape from inside the docked bar with a page open goes back to the chat, and leaves the bar where it is.
    await page.locator('.project-thread[data-thread-id="home"]').focus();
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'backToChat', id: 'alpha', value: undefined});
    assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'false', 'a page goes before the bar does');

    // A thread's name is one clipped line in a 256px bar, and the first thing that will truncate.
    await page.evaluate(() => {const long = 'Rework the turn lock so an abort clears it before the stream closes'; model.view = null; model.projects[0].conversations = [{id: 'home', title: 'Home', lastText: '', active: true}, {id: 'long', title: long, lastAt: new Date().toISOString(), lastText: 'I found where the lock is held across the abort and moved the release up.'}]; ui.update(model); window.longTitle = long;});
    const longRow = page.locator('[data-thread-id="long"]');
    assert.equal(await longRow.getAttribute('title'), await page.evaluate(() => window.longTitle), 'the whole name is reachable even though the row shows one line of it');
    assert.ok(await longRow.locator('.cp-primary').evaluate(el => el.scrollWidth > el.clientWidth), 'and it really is clipped, so the title is not decoration');
    assert.equal(await longRow.locator('.cp-note').getAttribute('title'), 'I found where the lock is held across the abort and moved the release up.', 'line two is the last thing said, and it is reachable too');
    assert.equal(await page.locator('[data-thread-id="home"] .cp-note').innerText(), WORDS.homeLine, 'home with nothing said is the first conversation');
    assert.match(await longRow.getAttribute('aria-label'), /^Rework the turn lock .* thread in Alpha/);
    // A thread is renamed or put away from its own row. Home is every message with no thread, so it
    // has no name to change and cannot be archived: no gear.
    assert.equal(await page.locator('.project-thread-row:has([data-thread-id="home"])').count(), 0, 'home has no gear');
    assert.equal(await page.locator('.project-thread-row:has([data-thread-id="long"]) .project-options').count(), 1, 'a thread does');
    assert.equal(await page.locator('.margin-card[role="dialog"]').count(), 1, 'no thread card exists until one is asked for');
    const threadGear = page.locator('.project-thread-row:has([data-thread-id="long"]) .project-options');
    const callsBeforeThread = await page.evaluate(() => calls.length);
    await threadGear.click();
    assert.equal(await page.locator('.margin-card[role="dialog"]').count(), 2, 'opening one builds its card');
    assert.equal(await card.locator('h2').innerText(), await page.evaluate(() => window.longTitle), 'titled with the thread');
    assert.equal(await threadGear.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.evaluate(() => calls.length), callsBeforeThread, 'opening it dispatches nothing');
    await card.locator('input[type="text"]').fill('Turn lock');
    await card.getByRole('button', {name: 'Save', exact: true}).click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'renameThread', id: 'long', value: {project: 'alpha', title: 'Turn lock'}});
    await card.getByRole('button', {name: 'Archive', exact: true}).click();
    assert.equal(await page.evaluate(() => calls.filter(c => c.action === 'archiveThread').length), 0, 'Archive asks first');
    assert.match(await card.locator('.margin-confirm').innerText(), /Archive this conversation\? It stays in the log\./);
    await card.locator('.margin-confirm').getByRole('button', {name: 'Cancel', exact: true}).click();
    assert.equal(await page.evaluate(() => calls.filter(c => c.action === 'archiveThread').length), 0, 'and Cancel means no');
    await page.keyboard.press('Escape');
    assert.equal(await card.count(), 0);
    assert.equal(await threadGear.evaluate(el => el === document.activeElement), true, 'Escape returns to the gear');
    // The list is redrawn whenever any thread in the project is written to, from any device. The
    // keyboard stays where it was instead of dropping to the page.
    await page.evaluate(() => {model.projects[0].conversations = [...model.projects[0].conversations, {id: 'other', title: 'Other', lastAt: new Date(Date.now() - 1000).toISOString(), lastText: ''}]; ui.update(model);});
    assert.equal(await threadGear.evaluate(el => el === document.activeElement), true, 'a redrawn list keeps focus on the gear');
    await longRow.focus();
    const rowNode = await longRow.elementHandle();
    await page.evaluate(() => {model.projects[0].conversations = [model.projects[0].conversations[0], ...model.projects[0].conversations.slice(1).reverse().map(t => t.id === 'other' ? {...t, lastAt: new Date().toISOString(), lastText: 'moved to the top'} : t)]; ui.update(model);});
    assert.equal(await longRow.evaluate(el => el === document.activeElement), true, 'and on the row, even when another moves above it');
    assert.equal(await rowNode.evaluate(el => el.isConnected && el.dataset.threadId === 'long'), true, 'the same node: rows are kept, not replaced');
    await threadGear.click();
    await card.getByRole('button', {name: 'Archive', exact: true}).click();
    await card.locator('.margin-confirm').getByRole('button', {name: 'Archive', exact: true}).click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'archiveThread', id: 'long', value: {project: 'alpha'}});
    assert.equal(await card.count(), 0, 'a confirmed archive closes the card');
    await page.evaluate(() => {model.projects[0].conversations = [{id: 'home', title: 'Home', lastText: '', active: true}]; ui.update(model);});
    assert.equal(await page.locator('.margin-card[role="dialog"]').count(), 1, 'and the card goes when its thread leaves the list');
    assert.equal(await page.locator('[data-thread-id="home"]').evaluate(el => el === document.activeElement), true, 'focus on a row that went away goes home');

    // Escape belongs to whatever you are actually in. Docked, the bar is open all day; swallowing
    // every Escape meant the composer and the palette never saw one.
    await page.locator('#outside').focus();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'false', 'Escape from the page leaves the docked bar alone');
    await page.locator('.sidebar-collapse').focus();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'true', 'Escape from inside the bar, in the chat, puts it away');
    assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-label'), 'Open sidebar', 'the toggle names what pressing it does');
    await page.locator('#sidebar-toggle').click();
    assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'false');

    await openMenu();
    assert.equal(await (await gear('alpha')).getAttribute('aria-label'), 'Project settings for Alpha <img src=x onerror=alert(1)>');
    const callsBeforeSettings = await page.evaluate(() => calls.length);
    await (await gear('alpha')).click();
    assert.equal(await page.evaluate(() => calls.length), callsBeforeSettings, 'opening project settings does not change the active project or dispatch work');
    assert.equal(await card.count(), 1);
    assert.match(await card.textContent(), /\$14\.2 spent · Cap \$40/, 'what it spends and may spend, and nothing about plans');
    assert.doesNotMatch(await card.textContent(), /complete|pending|in flight/, 'the plan meter and the old counts are gone');
    assert.equal(await card.locator('.margin-auto-line').innerText(), 'automation picks up up next · builds into main', 'automation works up next, and the card says so once');
    assert.equal(await card.locator('.margin-into-field').isVisible(), false, 'with no copy there is nothing to choose between');
    for (const gone of ['Plan', 'Play', 'Fix…', 'Review']) assert.equal(await card.getByRole('button', {name: gone, exact: true}).count(), 0, `no ${gone} pill`);
    for (const kept of ['Repository & GitHub', 'Providers']) assert.equal(await card.getByRole('button', {name: kept, exact: true}).count(), 1, `${kept} stays`);
    const cap = card.locator('input[type="number"]');
    await cap.fill('123.45');
    await page.evaluate(() => {model.projects[0].spendCap = 99; model.projects[0].spend = 15; ui.update(model);});
    assert.equal(await cap.inputValue(), '123.45');
    assert.equal(await cap.evaluate(el => document.activeElement === el), true);
    assert.match(await card.textContent(), /\$15 spent · Cap \$99/);
    await card.getByRole('button', {name: 'ship', exact: true}).click();
    assert.equal(await page.evaluate(() => calls.filter(c => c.action === 'autoMode').length), 0);
    await card.getByRole('button', {name: 'Enable ship', exact: true}).click();
    assert.deepEqual(await page.evaluate(() => calls.find(c => c.action === 'autoMode')), {action: 'autoMode', id: 'alpha', value: 'ship'});
    await card.getByRole('button', {name: 'Save', exact: true}).click();
    assert.equal(await card.getByRole('button', {name: 'Save', exact: true}).isDisabled(), true);
    await cap.fill('124');
    await page.evaluate(() => capResolve());
    await page.evaluate(() => ui.update(model));
    assert.equal(await cap.inputValue(), '124');
    await card.getByRole('button', {name: 'Repository & GitHub', exact: true}).click();
    assert.match(await card.locator('.margin-error').textContent(), /Fixture action failed/);
    assert.equal(await cap.inputValue(), '124');
    await page.locator('.sidebar-collapse').click();
    assert.equal(await card.count(), 0);
    assert.equal(await page.locator('#workspace-sidebar').evaluate(el => el.inert), true);
    await page.locator('#sidebar-toggle').click();
    assert.equal(await page.locator('[data-project-id="alpha"]').getAttribute('aria-current'), 'true');
    await (await gear('alpha')).click();
    assert.equal(await cap.inputValue(), '124', 'collapse preserves unsaved project draft');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.margin-card:not([hidden])').count(), 0);
    assert.equal(await options('alpha').evaluate(el => document.activeElement === el), true, 'Escape restores focus to the project settings trigger');
    assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'false', 'Escape dismisses a card before its sidebar');
    // Settings is a key in the head, immediately left of collapse, and its card opens from the top beside it.
    assert.equal(await page.locator('.sidebar-head #settings-rail #status').count(), 1, 'the head holds Settings');
    assert.equal(await page.locator('#settings-rail').evaluate(el => el.nextElementSibling?.classList.contains('sidebar-collapse')), true, 'immediately left of collapse');
    assert.equal(await page.locator('#status').getAttribute('aria-label'), 'Settings');
    assert.match(await page.locator('#status').getAttribute('title'), /^settings — /);
    await page.locator('#status').click();
    assert.equal(await page.locator('#status').getAttribute('aria-expanded'), 'true');
    await settled();   // it arrives from 10px below; measure where it lands
    const [statusBox, settingsTop] = [await page.locator('#status').boundingBox(), (await card.boundingBox()).y];
    assert.ok(settingsTop <= statusBox.y + 1, `the Settings card opens at the top, beside its key: ${settingsTop} vs ${statusBox.y}`);
    for (const id of ['st-platform', 'st-motion', 'st-microphone', 'st-voice', 'st-sounds', 'st-demo', 'st-clear']) assert.equal(await card.locator(`#${id}`).count(), 1);
    assert.equal(await page.locator('#st-microphone').getAttribute('aria-pressed'), 'false');
    await page.locator('#st-microphone').click();
    assert.equal(await page.evaluate(() => calls.filter(c => c.action === 'microphone').length), 1);
    assert.equal(await page.evaluate(() => calls.filter(c => c.action === 'voice').length), 0);
    await page.evaluate(() => {model.settings.microphone = true; model.settings.microphonePhase = 'armed'; ui.update(model);});
    assert.equal(await page.locator('#st-microphone').getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('#st-microphone').innerText(), /Ready/);
    await page.locator('#st-voice').click();
    assert.equal(await page.evaluate(() => calls.filter(c => c.action === 'voice').length), 1);
    assert.equal(await page.locator('#st-voice').getAttribute('aria-pressed'), 'true', 'model owns preference state');
    await page.evaluate(() => {model.settings.systemReduced = true; ui.update(model);});
    assert.equal(await page.locator('#st-motion').isDisabled(), true);
    await page.locator('#outside').click();
    assert.equal(await card.count(), 0);
    await (await gear('beta')).click();
    assert.match(await card.textContent(), /Spend not available · Cap not available/);
    await page.evaluate(() => {model.projects[1].spend = 0; model.projects[1].spendCap = 0; ui.update(model);});
    assert.match(await card.textContent(), /\$0 spent · No cap/);
    assert.match(await card.textContent(), /0 means no cap/);
    await page.locator('#status').click();
    assert.equal(await card.locator('h2').innerText(), 'Settings', 'settings replaces project details');
    for (const width of [320, 390, 520, 899, 900, 1180, 1440]) {
      await page.setViewportSize({width, height: 760});
      await page.waitForFunction(narrow => document.querySelector('#workspace-sidebar').getAttribute('role') === (narrow ? 'dialog' : 'complementary'), width < 900);
      await page.evaluate(() => ui.close());
      if (width < 900) {
        assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'true');
        await page.locator('#sidebar-toggle').click();
        // The sidebar slides in; focus order is only meaningful once it has laid out.
        await page.evaluate(() => Promise.all(document.querySelector('#workspace-sidebar').getAnimations().map(a => a.finished.catch(() => {}))));
        assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-modal'), 'true');
        assert.equal(await page.locator('#outside').evaluate(el => el.inert), true);
        assert.equal(await page.evaluate(() => (focusables => focusables[0]?.id)([...document.querySelector('#workspace-sidebar').querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length && !el.closest('[hidden]')))), 'status', 'the drawer’s first stop is Settings, in the head');
        await page.locator('#status').focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('.sidebar-collapse').evaluate(el => el === document.activeElement), true, 'Tab goes on to collapse');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.locator('#status').evaluate(el => el === document.activeElement), true, 'and back');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => { const items = [...document.querySelector('#workspace-sidebar').querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length && !el.closest('[hidden]')); return document.activeElement === items.at(-1); }), true, 'mobile reverse Tab from the first stop wraps to the last');
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('#status').evaluate(el => el === document.activeElement), true, 'and Tab from the last wraps to Settings');
      } else assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'false', 'desktop expansion survives breakpoint changes');
      await (await gear('alpha')).click();
      const bounds = await card.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, `card fits ${width}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'false');
      await page.locator('#status').click();
      const settingsBounds = await card.boundingBox();
      assert.ok(settingsBounds.x >= 0 && settingsBounds.x + settingsBounds.width <= width, `settings fits ${width}`);
      if (width < 900) {
        assert.ok(settingsBounds.y >= (await page.locator('#status').boundingBox()).y + 44 - 1, `the Settings card opens under the head at ${width}, so its key stays in view`);
        await page.locator('#st-clear').focus(); await page.keyboard.press('Tab');
        assert.equal(await card.locator('.margin-close').evaluate(el => el === document.activeElement), true, 'open card owns mobile focus');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#status').evaluate(el => el === document.activeElement), true);
        await openMenu();   // new project lives at the foot of the switcher's list
        await page.locator('.margin-new').click();
        assert.equal(await page.evaluate(() => calls.at(-1).action), 'newProject');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'true');
        assert.equal(await page.locator('#outside').evaluate(el => el.inert), false, 'closing mobile restores workspace input');
        assert.equal(await page.locator('#already-inert').evaluate(el => el.inert), true, 'preexisting inert state is preserved');
        assert.equal(await page.locator('#sidebar-toggle').evaluate(el => el === document.activeElement), true);
      }
    }
    await page.evaluate(() => ui.close());
    await page.evaluate(() => {model.projects = Array.from({length: 60}, (_, i) => ({...model.projects[0], id: `p-${i}`, name: 'A very long project name '.repeat(10) + i, active: i === 0})); model.activeProject = 'p-0'; ui.update(model);});
    assert.equal(await page.locator('#project-rail [data-project-id]').count(), 60, 'every project is a row in the list');
    // Sixty projects, one set of cards: only the project you are in draws its conversations and its builds.
    assert.equal(await page.locator('[data-bar-build]').count(), 1);
    assert.equal(await page.locator('.project-thread-new').count(), 1);
    assert.equal(await page.locator('.margin-switch-trigger').getAttribute('data-current-project'), 'p-0');
    // A card is a dialog with a form and a dozen bound controls in it. Sixty projects are sixty rows,
    // not sixty dialogs: the one that exists is Settings, and a project's is built when it is opened.
    assert.equal(await page.locator('.margin-card[role="dialog"]').count(), 1, 'no project card is built until one is asked for');
    await openMenu();
    await page.locator('.margin-switch-menu [data-project-id="p-3"]').locator('xpath=following-sibling::button').click();
    assert.equal(await page.locator('.margin-card[role="dialog"]').count(), 2, 'opening a project builds its card');
    assert.match(await page.locator('.margin-card:not([hidden]) h2').innerText(), /3$/, 'and it opens showing that project, not an empty one');
    await page.keyboard.press('Escape');
    await page.evaluate(() => ui.update(model));
    assert.equal(await page.locator('.margin-card[role="dialog"]').count(), 2, 'a refresh does not build the other fifty-nine');
    await openMenu();
    const settingsBefore = await page.locator('#status').boundingBox();
    const menuList = page.locator('.margin-switch-menu .margin-project-list');
    assert.equal(await menuList.evaluate(el => el.scrollHeight > el.clientHeight), true, 'the list scrolls rather than the bar');
    await page.locator('.margin-switch-menu [data-project-id="p-59"]').scrollIntoViewIfNeeded();
    assert.ok(await menuList.evaluate(el => el.scrollTop > 0));
    assert.deepEqual(await page.locator('#status').boundingBox(), settingsBefore, 'settings stays pinned in the head while the list scrolls');
    assert.ok(settingsBefore.y >= 0 && settingsBefore.y + settingsBefore.height <= 760);
    await page.keyboard.press('Escape');
    // A panel that appears and vanishes with no motion, next to a bar that slides and a menu that
    // arrives, is an inconsistent system rather than a quiet one. `hidden` stays the only state.
    await page.evaluate(() => ui.setSidebar(true));
    await page.locator('#status').click();
    const opening = await page.evaluate(() => document.querySelector('.margin-card:not([hidden])').getAnimations().map(a => a.transitionProperty));
    assert.ok(opening.includes('opacity'), 'the card arrives rather than appearing: ' + JSON.stringify(opening));
    await page.keyboard.press('Escape');
    const leaving = await page.evaluate(() => { const card = document.querySelector('.margin-card[hidden]'); const style = getComputedStyle(card); return {display: style.display, events: style.pointerEvents}; });
    assert.notEqual(leaving.display, 'none', 'it stays in the box long enough to leave');
    assert.equal(leaving.events, 'none', 'and cannot swallow the click that dismissed it');
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.margin-card')).display), 'none', 'then it is gone');

    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.locator('#status').click();
    assert.deepEqual(await page.evaluate(() => document.querySelector('.margin-card:not([hidden])').getAnimations()), [], 'with reduced motion it simply appears');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.margin-card')).display), 'none', 'and simply goes');
    await page.emulateMedia({reducedMotion: 'no-preference'});

    // The foot is the scroll's last item: right under the last card, 12 below it, when the cards are short — and
    // holding the bottom edge, with the cards fading out under it, once they run past it.
    await page.evaluate(() => ui.setSidebar(true));
    await page.setViewportSize({width: 1180, height: 820});
    await page.evaluate(() => {model.projects = [model.projects[0]]; model.activeProject = 'p-0'; model.projects[0].conversations = [{id: 'home', title: 'Home', lastText: '', active: true}]; model.projects[0].builds = [mainOf()]; model.view = null; ui.update(model);});
    await frame(page);
    const footAt = () => page.evaluate(() => {
      const body = document.querySelector('.margin-body'), foot = document.querySelector('.margin-foot').getBoundingClientRect();
      const last = document.querySelector('.cp-group[data-cp-group="builds"]').getBoundingClientRect(), box = body.getBoundingClientRect();
      return {gap: Math.round(foot.top - last.bottom), toBottom: Math.round(box.bottom - foot.bottom), overflows: body.scrollHeight > body.clientHeight, more: body.classList.contains('has-more')};
    });
    const short = await footAt();
    assert.equal(short.gap, 12, 'the foot sits 12 under the last card, not stranded at the bottom: ' + JSON.stringify(short));
    assert.ok(!short.overflows && !short.more && short.toBottom > 100, 'and nothing runs under it: ' + JSON.stringify(short));
    await page.evaluate(() => {model.projects[0].conversations = [{id: 'home', title: 'Home', lastText: '', active: true}, ...Array.from({length: 14}, (_, i) => ({id: `t${i}`, title: `thread ${i}`, lastAt: minutesAgo(i * 7), lastText: 'said something'}))]; ui.update(model);});
    await frame(page);
    const long = await footAt();
    assert.ok(long.overflows && long.more, 'with more cards than room the body scrolls, and says so: ' + JSON.stringify(long));
    assert.equal(long.toBottom, 0, 'and the foot holds the bottom edge: ' + JSON.stringify(long));
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.margin-foot'), '::before').opacity), '1', 'the cards fade out under it');

    // A backend that has not answered, and a first run, say so rather than describing a project
    // that does not exist.
    await page.evaluate(() => {model.projects = []; model.activeProject = null; model.projectsLoaded = false; ui.update(model);});
    assert.match(await page.locator('.margin-switch-trigger').innerText(), /Loading projects/);
    assert.equal(await page.locator('.cp-group:visible').count(), 0, 'no cards for a project that is not there');
    // A list that never arrived is not still loading. It says so once, and Retry asks again.
    await page.evaluate(() => {model.projectsError = true; ui.update(model);});
    assert.equal(await page.locator('.margin-switch-trigger').getAttribute('aria-label'), 'Projects: couldn’t reach the projects list');
    assert.doesNotMatch(await page.locator('.margin-switch-trigger').innerText(), /couldn’t/, 'said once, in the body, not truncated in the switcher too');
    assert.equal(await page.locator('.margin-body .margin-empty').innerText(), 'couldn’t reach the projects list');
    assert.doesNotMatch(await page.locator('#project-rail').innerText(), /Loading projects/, 'and nothing claims it is still loading');
    await page.locator('.margin-body').getByRole('button', {name: 'Retry', exact: true}).click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'refreshProjects', id: undefined, value: undefined});
    await page.evaluate(() => {delete model.projectsError; ui.update(model);});
    await page.evaluate(() => {model.projectsLoaded = true; ui.update(model);});
    const firstRun = await page.locator('.margin-switch-trigger').innerText();
    assert.match(firstRun, /No projects yet/);
    assert.doesNotMatch(firstRun, /quiet|no branch/, 'nothing is invented about a project that is not there');
    assert.equal(await page.locator('.margin-body .margin-empty-new').count(), 1, 'and there is one way to start');
    await page.locator('.margin-body .margin-empty-new').click();
    assert.equal(await page.evaluate(() => calls.at(-1).action), 'newProject');

    // data-link was set on the body and styled by nothing. It has a home now.
    await page.evaluate(() => {model.link = 'offline'; ui.update(model);});
    assert.match(await page.locator('.margin-link').innerText(), /Offline/);
    await page.evaluate(() => {model.link = 'live'; ui.update(model);});
    assert.equal(await page.locator('.margin-link').isVisible(), false);

    await page.evaluate(() => {model.projects = []; model.activeProject = null; ui.update(model);});
    assert.equal(await page.locator('#project-rail [data-project-id]').count(), 0);
    assert.equal(await page.locator('[data-bar-build]:visible').count(), 0);
    await page.evaluate(() => ui.destroy());
    assert.equal(await page.locator('.margin-card').count(), 0);
    assert.equal(await page.locator('#status').count(), 0);
    assert.equal(await page.locator('#workspace-sidebar').count(), 0);
    assert.equal(await page.locator('[data-bar-build]').count(), 0, 'and no build row outlives the bar');
    assert.equal(await page.locator('#outside').evaluate(el => el.inert), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

// On a phone the bar is a closed drawer, so what the project wants from you rides on the toggle, in words.
test('the closed bar says on its toggle what the project wants, without renaming the toggle', {timeout: 60000}, async () => {
  const browser = await chromium.launch({channel: process.env.CI ? undefined : 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
    const errors = await harness(page);
    await page.evaluate(() => {
      window.model = {projects: [{id: 'alpha', name: 'Alpha', active: true, branch: 'main', attention: {text: '1 needs you', tone: 'attention'}, conversations: [], builds: [mainOf()]}], activeProject: 'alpha', settings: {}};
      ui.update(model);
    });
    const toggle = page.locator('#sidebar-toggle'), count = page.locator('#sidebar-toggle .sidebar-toggle-count');
    assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'true', 'a phone starts with the bar closed');
    assert.equal(await count.innerText(), '1 needs you', 'words, never a bare number');
    assert.equal(await toggle.getAttribute('aria-label'), 'Open sidebar', 'the label is still what pressing it does');
    assert.equal(await toggle.getAttribute('aria-describedby'), await count.getAttribute('id'), 'the count describes the toggle');
    const box = await toggle.boundingBox();
    assert.ok(box.width > 60 && box.height >= 44, 'the toggle grows to hold the words, 44 tall at a touch: ' + JSON.stringify(box));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'and stays on the page');
    assert.equal(await count.evaluate(el => getComputedStyle(el).fontVariantNumeric), 'tabular-nums');
    assert.equal(await count.evaluate(el => getComputedStyle(el).color), await probeColor(page, count, 'var(--ink)'), 'what wants you is ink, not a verdict colour');
    await page.evaluate(() => {model.projects[0].attention = {text: '2 failed', tone: 'error'}; ui.update(model);});
    assert.equal(await count.innerText(), '2 failed');
    assert.equal(await count.evaluate(el => getComputedStyle(el).color), await probeColor(page, count, 'var(--fail-text)'), 'a failure is the verdict colour');
    // An interruption is not a verdict (the backend stopped under it): its words are ink, never the failed colour.
    await page.evaluate(() => {model.projects[0].attention = {text: '1 interrupted', tone: 'attention'}; ui.update(model);});
    assert.equal(await count.innerText(), '1 interrupted');
    assert.notEqual(await count.evaluate(el => getComputedStyle(el).color), await probeColor(page, count, 'var(--fail-text)'), 'an interruption is not a verdict');
    // With no attention on the project, the build's own attention is what it says.
    await page.evaluate(() => {delete model.projects[0].attention; model.projects[0].builds = [mainOf({attention: {text: '2 building', tone: 'active'}})]; ui.update(model);});
    assert.equal(await count.innerText(), '2 building');
    // The talk pose sits top-centre with r >= 48: on a 320px phone the words wrap before its left edge.
    await page.setViewportSize({width: 320, height: 568});
    // Past two lines the words are clamped, and the toggle's title still says them whole.
    for (const [words, fits] of [['1 needs you', true], ['14 need a look', true], ['2 pull requests open', false]]) {
      await page.evaluate(text => {model.projects[0].attention = {text, tone: 'attention'}; ui.update(model);}, words);
      const fit = await count.evaluate(el => ({right: el.closest('button').getBoundingClientRect().right, lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)), clipped: el.scrollHeight > el.clientHeight + 1}));
      assert.ok(fit.right <= 320 / 2 - 48, `"${words}" ends at ${fit.right}px, left of the talk pose at 112px`);
      assert.ok(fit.lines <= 2 && fit.clipped === !fits, `"${words}" in two lines at most${fits ? ', not clipped' : ', clamped'}: ${JSON.stringify(fit)}`);
      assert.equal(await toggle.getAttribute('title'), `open the bar — ${words}`, 'and the whole words are reachable');
    }
    await page.setViewportSize({width: 390, height: 844});
    await page.evaluate(() => {model.projects[0].attention = {text: '', tone: 'quiet'}; model.projects[0].builds = [mainOf()]; ui.update(model);});
    assert.equal(await count.textContent(), '', 'nothing waiting, nothing said');
    assert.equal(Math.round((await toggle.boundingBox()).width), 44, 'and the toggle is its own size again: 44 at a touch');
    await toggle.click();
    assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'false');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

// The builds card says one fact once, and a failed improvement's reason is never cut. Every Settings status names its subject.
test('the builds badge says one fact once, a failed row keeps its reason, and a blocked permission says so', {timeout: 60000}, async () => {
  const browser = await chromium.launch({channel: process.env.CI ? undefined : 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1180, height: 820}});
    const errors = await harness(page);
    await page.evaluate(() => {
      window.model = {projects: [
        {id: 'alpha', name: 'Alpha', active: true, branch: 'main', mode: 'stage', attention: {text: '1 ready to review', tone: 'attention'},
          conversations: [{id: 'home', title: 'Home', lastText: '', active: true}],
          builds: [mainOf({badge: {text: '1 ready to review', tone: 'attention'}, improvements: [
            imp('run:r1', 'lobby: show who is ready', 'ready', {when: {verb: 'staged', at: minutesAgo(12)}}),
            imp('run:f1', 'the lobby shows every player', 'failed', {when: {verb: 'failed', at: minutesAgo(30)}, reason: 'the lobby test timed out — main is unchanged'}),
            imp('run:x1', 'rounds end sooner', 'interrupted', {when: {verb: 'stopped', at: minutesAgo(40)}, reason: 'the backend stopped mid-run'}),
          ]})]},
      ], activeProject: 'alpha', busy: false, view: null,
      settings: {notifications: false, notificationsSupported: true, notificationBlocked: true, notificationStatus: 'Notifications are blocked in system or browser settings', session: 'abc · $1.00 · 7 turns', calm: false, systemReduced: false}};
      ui.update(model);
    });
    const builds = page.locator('.cp-group[data-cp-group="builds"]');
    assert.equal(await builds.locator('.cp-group-head .cp-badge').innerText(), '1 ready to review');
    assert.equal((await builds.locator('.cp-group-head').innerText()).split('1 ready to review').length - 1, 1, 'the header says its fact once');
    assert.equal(await builds.locator('.cp-group-head .cp-badge').getAttribute('data-tone'), 'attention');
    assert.equal(await builds.locator('.cp-group-head button').count(), 0, 'no + New build while the model says nothing about copies (BarProjectVM.newCopy absent): + improvement lives inside main');
    const edge = await builds.locator('.cp-group-head .cp-badge').evaluate(el => Math.round(el.getBoundingClientRect().right - document.querySelector('#workspace-sidebar').getBoundingClientRect().left));
    assert.equal(edge, 207, 'the badge ends on the right-hand edge, like every word under it');
    // phase 2: with newCopy the header holds exactly one key, + New build, on the trailing column; the badge still ends on 207
    await page.evaluate(() => { model.projects[0].newCopy = {blocked: '', why: '', suggested: 'dev', taken: [], limit: 5}; ui.update(model); });
    assert.deepEqual(await builds.locator('.cp-group-head button').evaluateAll(els => els.map(el => el.dataset.cpRole)), ['new-build']);
    const plus = await builds.locator('[data-cp-role="new-build"]').evaluate(el => { const r = el.getBoundingClientRect(), left = document.querySelector('#workspace-sidebar').getBoundingClientRect().left; return {w: Math.round(r.width), h: Math.round(r.height), centre: Math.round(r.left + r.width / 2 - left)}; });
    assert.deepEqual(plus, {w: 32, h: 32, centre: 223}, 'a 32px quiet key centred on the trailing column');
    assert.equal(await builds.locator('.cp-group-head .cp-badge').evaluate(el => Math.round(el.getBoundingClientRect().right - document.querySelector('#workspace-sidebar').getBoundingClientRect().left)), 207, 'and the badge stops at the key');
    await page.evaluate(() => { delete model.projects[0].newCopy; ui.update(model); });
    assert.equal(await builds.locator('.cp-group-head button').count(), 0, 'absent again when newCopy is');
    // failed and interrupted: two, so both show; each word on the right-hand edge and its reason under it, never cut
    for (const [id, word, tone] of [['run:f1', 'failed', 'error'], ['run:x1', 'interrupted', 'attention']]) {
      const row = page.locator(`[data-bar-improvement="${id}"]`);
      assert.equal(await row.getAttribute('data-state'), word);
      assert.equal(await row.locator('.cp-word').innerText(), word);
      assert.equal(await row.locator('.cp-word').getAttribute('data-tone'), tone, `${word} is ${tone}: colour only on a verdict`);
      const fit = await row.evaluate(el => { const bar = document.querySelector('#workspace-sidebar').getBoundingClientRect().left, line = el.querySelector('.cp-line-2'), word = el.querySelector('.cp-word').getBoundingClientRect(), reason = el.querySelector('.cp-reason');
        return {wordRight: Math.round(word.right - bar), wordTop: Math.round(word.top), lineTop: Math.round(line.getBoundingClientRect().top), lines: Math.round(line.getBoundingClientRect().height / 16), clipped: line.scrollHeight > line.clientHeight + 1, reason: reason.textContent}; });
      assert.equal(fit.wordRight, 207, `${word} ends on the right-hand edge: ${JSON.stringify(fit)}`);
      assert.equal(fit.wordTop, fit.lineTop, 'the word stands on line two’s first line');
      assert.ok(fit.lines >= 2 && fit.lines <= 3 && !fit.clipped, 'and the reason wraps under it, three lines at most, not cut: ' + JSON.stringify(fit));
      assert.match(await row.getAttribute('title'), new RegExp(fit.reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.equal(await page.locator('[data-bar-improvement="run:f1"] .cp-word').evaluate(el => getComputedStyle(el).color), await probeColor(page, page.locator('#workspace-sidebar'), 'var(--fail-text)'));
    assert.equal(await page.locator('#st-notifications .margin-pref-value').innerText(), 'Blocked', 'a denied permission reads Blocked, not Off');
    const note = await page.locator('.margin-pref-note').filter({hasText: /blocked/}).innerText();
    assert.match(note, /^Notifications /, 'and its note names what is blocked');
    // A value too long to sit beside its label takes a line of its own, and stays right-aligned with the rest.
    await page.evaluate(() => { Object.assign(model.settings, {brain: 'ready', model: 'fixture-model', provider: 'fixture', context: '240 turns · $31.20 known lifetime cost'}); ui.update(model); });
    await page.locator('#status').click();
    const rows = await page.locator('.margin-card:not([hidden]) .margin-data-row').evaluateAll(els => els.map(row => { const r = row.getBoundingClientRect(), dt = row.querySelector('dt').getBoundingClientRect(), dd = row.querySelector('dd').getBoundingClientRect(); return {label: row.querySelector('dt').textContent, wrapped: dd.top >= dt.bottom - 1, gap: Math.round(r.right - dd.right)}; }));
    assert.ok(rows.some(row => row.wrapped), 'one value is long enough to wrap: ' + JSON.stringify(rows));
    for (const row of rows) assert.equal(row.gap, 0, 'every value ends at the right edge, wrapped or not: ' + JSON.stringify(row));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

// + improvement is one inline form: start now builds it (run.dispatch), up next keeps it (issue.create).
// It never closes the view and never types into the composer; when a key cannot go, it says why in words.
test('+ improvement starts it now or keeps it up next, and says in words when it cannot', {timeout: 60000}, async () => {
  const browser = await chromium.launch({channel: process.env.CI ? undefined : 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1180, height: 820}});
    const errors = await harness(page, {onAction: `calls.push({action, id, value});
      if (window.hold && ['startImprovement', 'queueImprovement', 'askNibbi'].includes(action)) return new Promise((resolve, reject) => { window.release = resolve; window.refuse = reject; });`});
    await page.evaluate(() => {
      window.model = {projects: [{id: 'alpha', name: 'Alpha', active: true, branch: 'main', attention: {text: '', tone: 'quiet'},
        conversations: [{id: 'home', title: 'Home', lastText: '', active: true}], builds: [mainOf()]}], activeProject: 'alpha', busy: false, view: null, settings: {}};
      ui.update(model);
    });
    const add = page.locator('[data-cp-role="new-improvement"]'), form = page.locator('[data-cp-role="improvement-form"]');
    const field = form.locator('textarea'), start = form.locator('[data-cp-role="start-now"]'), queue = form.locator('[data-cp-role="up-next"]'), note = form.locator('.cp-form-note');
    const focused = locator => locator.evaluate(el => el === document.activeElement);
    assert.equal(await page.locator('.cp-build-body .cp-empty').innerText(), WORDS.emptyImprovements, 'nothing to improve says so, and + improvement is right under it');
    assert.equal(await add.getAttribute('aria-expanded'), 'false');
    assert.equal(await add.innerText(), 'improvement');
    await add.click();
    assert.equal(await form.isVisible(), true);
    assert.equal(await add.getAttribute('aria-expanded'), 'true');
    assert.equal(await focused(field), true, 'the field takes focus');
    assert.equal(await form.locator('label').innerText(), WORDS.form.label);
    assert.equal(await field.getAttribute('placeholder'), WORDS.form.placeholder);
    assert.equal(await field.getAttribute('maxlength'), '1000');
    assert.equal(await start.getAttribute('aria-keyshortcuts'), 'Enter');
    assert.match(await start.innerText(), /^start now/);
    assert.equal(await queue.innerText(), WORDS.form.queue);
    assert.equal(await form.locator('.cp-form-hint').innerText(), WORDS.form.hint);
    assert.equal(await form.locator('.cp-primary-key').count(), 1, 'one ink key: start now');
    await field.press('Enter');
    assert.equal(await page.evaluate(() => calls.length), 0, 'nothing to send, nothing sent');
    assert.match(await note.innerText(), /say what should change/);
    await field.fill('the lobby says who is ready');
    await field.press('Shift+Enter');
    await field.type('and who is not');
    assert.equal(await field.inputValue(), 'the lobby says who is ready\nand who is not', 'Shift+Enter is a newline');
    assert.equal(await page.evaluate(() => calls.length), 0);
    await page.evaluate(() => { window.hold = true; });
    await field.press('Enter');
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'startImprovement', id: 'alpha', value: {text: 'the lobby says who is ready\nand who is not'}}, 'Enter is start now: run.dispatch with the words');
    assert.equal(await start.getAttribute('aria-busy'), 'true', 'the key holds while it sends');
    assert.equal(await field.inputValue(), 'the lobby says who is ready\nand who is not', 'and the words stay');
    await page.evaluate(() => { calls.length = 0; ui.update(model); });
    await field.press('Enter');
    assert.equal(await page.evaluate(() => calls.length), 0, 'a second Enter while it sends sends nothing');
    await page.evaluate(() => release());
    await form.waitFor({state: 'hidden'});
    assert.equal(await field.inputValue(), '', 'sent: the field is cleared');
    assert.equal(await focused(add), true, 'and focus is back on + improvement');
    // up next, and a refusal said in the note with the words kept
    await add.click();
    await field.fill('spectators see the score');
    await queue.click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'queueImprovement', id: 'alpha', value: {text: 'spectators see the score'}}, 'up next: issue.create with the words');
    await page.evaluate(() => refuse(new Error('the list changed — try again')));
    await note.filter({hasText: 'the list changed'}).waitFor();
    assert.equal(await note.getAttribute('data-kind'), 'error');
    assert.equal(await form.isVisible(), true, 'a failure keeps the form open');
    assert.equal(await field.inputValue(), 'spectators see the score', 'and the words');
    // Escape (from inside the bar) closes it, focus goes back to +, and the words wait for next time
    await field.focus();
    await page.keyboard.press('Escape');
    assert.equal(await form.isVisible(), false);
    assert.equal(await focused(add), true);
    assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'false', 'Escape closed the form, not the bar');
    await add.click();
    assert.equal(await field.inputValue(), 'spectators see the score', 'the draft is still there');
    // the conversational route: the words go to nibbi instead
    await form.locator('[data-cp-role="ask-nibbi"]').click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'askNibbi', id: 'alpha', value: {text: 'spectators see the score'}});
    await page.evaluate(() => release());
    await form.waitFor({state: 'hidden'});
    await page.evaluate(() => { window.hold = false; calls.length = 0; });
    // nibbi answering: start now still goes — a run is a background agent in its own worktree, not the chat's turn (D8, reversed
    // 2026-09-29: docs/CONTROL-PANEL.md §12.2) — and keeps its double-press guard; up next goes; only the conversations + waits
    await page.evaluate(() => { model.busy = true; model.projects[0].builds = [mainOf()]; ui.update(model); window.hold = true; });
    await add.click();
    assert.equal(await start.isDisabled(), false, 'start now goes while nibbi answers');
    assert.equal(await note.isVisible(), false, 'and nothing says it waits for the reply');
    await field.fill('the join button is bigger');
    await field.press('Enter');
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'startImprovement', id: 'alpha', value: {text: 'the join button is bigger'}}, 'Enter starts it while nibbi answers');
    assert.equal(await start.getAttribute('aria-busy'), 'true', 'the key holds while it sends');
    await page.evaluate(() => { calls.length = 0; ui.update(model); });
    await field.press('Enter');
    assert.equal(await page.evaluate(() => calls.length), 0, 'a second Enter while it sends sends nothing, answering or not');
    await page.evaluate(() => { window.hold = false; release(); });
    await form.waitFor({state: 'hidden'});
    await add.click();
    await field.fill('a second thought');
    await queue.click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'queueImprovement', id: 'alpha', value: {text: 'a second thought'}}, 'up next works while nibbi answers');
    await form.waitFor({state: 'hidden'});
    const convo = page.locator('.cp-group[data-cp-group="conversations"]');
    assert.equal(await convo.locator('.cp-badge').innerText(), WORDS.answering);
    assert.equal(await convo.locator('.cp-badge').evaluate(el => el.getAnimations().map(a => a.animationName).join()), 'cp-bar-pulse', 'answering pulses, in opacity only');
    assert.equal(await convo.locator('.project-thread-new').isDisabled(), true, 'a new conversation still waits: one turn runs at a time');
    assert.equal(await convo.locator('.project-thread-new').getAttribute('title'), 'not while nibbi is answering');
    // the reply landed: the conversations + comes back; the form never changed
    await page.evaluate(() => { model.busy = false; ui.update(model); });
    assert.equal(await convo.locator('.project-thread-new').isDisabled(), false);
    await add.click();
    assert.equal(await start.isDisabled(), false);
    assert.equal(await note.isVisible(), false);
    // demo: both keys and ▶ say why they cannot, and main says it under its row
    await page.evaluate(w => { model.projects[0].builds = [mainOf({blocked: {start: w.demoStart, queue: w.demoChange, play: w.demoPlay}})]; ui.update(model); }, WORDS);
    assert.equal(await start.getAttribute('title'), WORDS.demoStart);
    assert.equal(await queue.isDisabled(), true);
    assert.equal(await queue.getAttribute('title'), WORDS.demoChange);
    const play = page.locator('[data-cp-role="play-main"]');
    assert.equal(await play.isDisabled(), true);
    assert.equal(await play.getAttribute('title'), WORDS.demoPlay);
    assert.equal(await page.locator('.cp-main-why').innerText(), WORDS.demoPlay);
    await page.keyboard.press('Escape');
    // ▶ plays main, and stops it; "playing" is a word on main's row and the key is held
    await page.evaluate(() => { model.projects[0].builds = [mainOf()]; ui.update(model); calls.length = 0; });
    assert.equal(await play.getAttribute('aria-label'), 'Play main');
    assert.equal(await page.locator('.cp-main-why').isVisible(), false);
    await play.click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'playMain', id: 'alpha', value: {action: 'start'}});
    await page.evaluate(() => { model.projects[0].builds = [mainOf({play: {playable: true, running: true, starting: false, url: 'http://127.0.0.1:5173', blocked: '', note: '', lastCommit: ''}})]; ui.update(model); });
    assert.equal(await play.getAttribute('aria-pressed'), 'true');
    assert.equal(await play.getAttribute('aria-label'), 'Stop main');
    assert.match(await page.locator('[data-bar-build="main"]').innerText(), /playing/);
    await play.click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'playMain', id: 'alpha', value: {action: 'stop'}});
    // main says where its work lands when that is not main
    await page.evaluate(() => { model.projects[0].builds = [mainOf({branch: 'v2', line: 'live · lands on v2'})]; ui.update(model); });
    assert.equal(await page.locator('[data-bar-build="main"] .cp-note').innerText(), 'lands on v2');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('many failed fold to one row, up next folds past three, and the open ticket’s row always shows', {timeout: 60000}, async () => {
  const browser = await chromium.launch({channel: process.env.CI ? undefined : 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1180, height: 820}});
    const errors = await harness(page);
    await page.evaluate(() => {
      const failed = Array.from({length: 14}, (_, i) => imp(`run:f${i}`, `failed thing ${i}`, 'failed', {when: {verb: 'failed', at: minutesAgo(60 + i)}, reason: 'the check failed — main is unchanged'}));
      const upNext = Array.from({length: 5}, (_, i) => imp(`issue:u${i}`, `up next ${i}`, 'up_next', {context: 'from issues.md', issueId: `u${i}`}));
      const landed = [...Array.from({length: 4}, (_, i) => imp(`run:in${i}`, `landed ${i}`, 'in', {when: {verb: 'landed', at: minutesAgo(30 + i)}})), imp('run:old', 'landed long ago', 'in', {when: {verb: 'landed', at: minutesAgo(60 * 49)}})];
      window.model = {projects: [{id: 'alpha', name: 'Alpha', active: true, attention: {text: '14 failed', tone: 'error'},
        conversations: [{id: 'home', title: 'Home', lastText: '', active: true}],
        builds: [mainOf({badge: {text: '14 failed', tone: 'error'}, improvements: [imp('run:b1', 'building now', 'building', {when: {verb: 'started', at: minutesAgo(2)}}), ...upNext, ...landed, ...failed],
          settled: [imp('run:s1', 'stopped one', 'stopped', {when: {verb: 'stopped', at: minutesAgo(90)}})]})]}], activeProject: 'alpha', busy: false, view: null, settings: {}};
      ui.update(model);
    });
    const shown = () => page.locator('.cp-build-body [data-bar-improvement]').evaluateAll(els => els.map(el => el.dataset.barImprovement));
    const fold = group => page.locator(`.cp-fold[data-cp-fold="${group}"]`);
    assert.deepEqual(await shown(), ['run:b1', 'issue:u0', 'issue:u1', 'issue:u2', 'run:in0', 'run:in1', 'run:in2'], 'building, three up next, three landed today, and no failed row');
    assert.equal(await fold('up_next').innerText(), '2 more up next');
    assert.equal(await fold('failed').innerText(), '14 failed');
    assert.equal(await fold('failed').locator('.cp-primary').getAttribute('data-tone'), 'error');
    assert.equal(await fold('failed').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.cp-build-body').evaluate(el => [...el.children].at(-1).dataset.cpRole), 'new-improvement', '+ improvement is last');
    // the open ticket's row shows, inside its fold, and it is the one row marked
    await page.evaluate(() => { model.view = {project: 'alpha', page: 'ticket', id: 'run:f5'}; ui.update(model); });
    assert.ok((await shown()).includes('run:f5'));
    assert.equal(await fold('failed').innerText(), '13 failed');
    assert.deepEqual(await page.locator('.margin-body [aria-current]').evaluateAll(els => els.map(el => [el.dataset.barImprovement, el.getAttribute('aria-current')])), [['run:f5', 'page']]);
    await page.evaluate(() => { model.view = {project: 'alpha', page: 'ticket', id: 'issue:u4'}; ui.update(model); });
    assert.deepEqual((await shown()).filter(id => id.startsWith('issue:')), ['issue:u0', 'issue:u1', 'issue:u2', 'issue:u4'], 'a folded up-next ticket shows too');
    assert.equal(await fold('up_next').innerText(), '1 more up next');
    await page.evaluate(() => { model.view = {project: 'alpha', page: 'ticket', id: 'run:old'}; ui.update(model); });
    assert.ok((await shown()).includes('run:old'), 'and an old landed one');
    await page.evaluate(() => { model.view = {project: 'alpha', page: 'ticket', id: 'run:s1'}; ui.update(model); });
    assert.equal((await shown()).at(-1), 'run:s1', 'and a settled one, at the end');
    assert.equal(await page.locator('[data-bar-improvement="run:s1"]').getAttribute('aria-current'), 'page');
    await page.evaluate(() => { model.view = null; ui.update(model); });
    assert.equal(await page.locator('[data-bar-improvement="run:s1"]').count(), 0, 'settled ones only show while their ticket is open');
    // a fold opens in place, is remembered across updates, and folds back
    await fold('failed').click();
    assert.equal(await fold('failed').getAttribute('aria-expanded'), 'true');
    assert.equal(await fold('failed').innerText(), WORDS.showFewer);
    assert.equal((await shown()).filter(id => id.startsWith('run:f')).length, 14);
    assert.equal(await fold('failed').evaluate(el => el === document.activeElement), true, 'focus stays on the fold');
    await page.evaluate(() => ui.update(model));
    assert.equal((await shown()).filter(id => id.startsWith('run:f')).length, 14, 'remembered');
    await fold('failed').click();
    assert.equal((await shown()).filter(id => id.startsWith('run:f')).length, 0);
    await fold('up_next').click();
    assert.deepEqual((await shown()).filter(id => id.startsWith('issue:')), ['issue:u0', 'issue:u1', 'issue:u2', 'issue:u3', 'issue:u4']);
    // failed and interrupted each say their own count
    await page.evaluate(() => { const b = model.projects[0].builds[0]; b.improvements = [...b.improvements.filter(i => i.state !== 'failed'), ...b.improvements.filter(i => i.state === 'failed').slice(0, 3), imp('run:x1', 'interrupted one', 'interrupted', {reason: 'the backend stopped mid-run'})]; ui.update(model); });
    assert.equal(await fold('failed').locator('.cp-primary').innerText(), '3 failed');
    assert.equal(await fold('failed').locator('.cp-word').innerText(), '1 interrupted');
    // the keys walk the rows; ArrowLeft from inside main goes to main
    const main = page.locator('[data-bar-build="main"]');
    await main.focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.barImprovement), 'run:b1');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.barImprovement), 'issue:u0');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await main.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.cpRole), 'new-improvement');
    await page.keyboard.press('Home');
    assert.equal(await main.evaluate(el => el === document.activeElement), true);
    // a focused row survives a refresh that puts a new row above it: the same node, still focused
    const row = page.locator('[data-bar-improvement="issue:u1"]');
    await row.focus();
    const handle = await row.elementHandle();
    await page.evaluate(() => { model.projects[0].builds[0].improvements.unshift(imp('run:n1', 'needs you now', 'needs_you', {when: {verb: 'asked you', at: minutesAgo(1)}})); ui.update(model); });
    assert.equal(await handle.evaluate(el => el === document.activeElement && el.isConnected), true);
    assert.equal((await shown())[0], 'run:n1', 'what waits on you comes first');
    // the list could not be read: the bar says so, and still lists the runs it has
    await page.evaluate(() => { model.projects[0].builds = [mainOf({list: 'unavailable', improvements: [imp('run:q1', 'queued one', 'up_next', {when: {verb: 'queued', at: minutesAgo(0)}})]})]; ui.update(model); });
    assert.equal(await page.locator('.cp-build-body .cp-list-line').innerText(), WORDS.noList);
    assert.deepEqual(await shown(), ['run:q1']);
    assert.match(await page.locator('[data-bar-improvement="run:q1"] .cp-when').innerText(), /^queued just now$/);
    assert.deepEqual(await page.locator('.cp-build-body .cp-empty').allInnerTexts(), [WORDS.noList], 'it says the list is unreadable, not that there is nothing to improve');
    await page.evaluate(() => { model.projects[0].builds = [mainOf({list: 'loading'})]; ui.update(model); });
    assert.equal(await page.locator('.cp-build-body .cp-empty:visible, .cp-build-body .cp-list-line:visible').count(), 0, 'while it loads, nothing claims there is nothing');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('every bar control presses, answers on --t1, is 44px at a touch, and speaks lowercase', {timeout: 90000}, async () => {
  const browser = await chromium.launch({channel: process.env.CI ? undefined : 'chrome'});
  try {
    const setup = () => {
      window.model = {projects: [
        {id: 'alpha', name: 'Alpha', active: true, branch: 'main', attention: {text: '1 ready to review', tone: 'attention'},
          conversations: [{id: 'home', title: 'Home', lastText: '', active: true}, {id: 't1', title: 'music between rounds', lastAt: minutesAgo(6), lastText: 'a short loop would fill it'}],
          builds: [mainOf({badge: {text: '1 ready to review', tone: 'attention'}, improvements: [
            imp('run:r1', 'lobby: show who is ready', 'ready', {when: {verb: 'staged', at: minutesAgo(12)}}),
            imp('run:b1', 'queue music between rounds', 'building', {when: {verb: 'started', at: minutesAgo(4)}}),
            ...Array.from({length: 3}, (_, i) => imp(`run:f${i}`, `failed ${i}`, 'failed', {reason: 'the check failed'})),
          ]})]},
        {id: 'beta', name: 'Beta', attention: {text: '1 failed', tone: 'error'}, conversations: [], builds: [mainOf()]},
      ], activeProject: 'alpha', busy: false, view: null, settings: {}};
      ui.update(model);
    };
    {
      const page = await browser.newPage({viewport: {width: 1180, height: 820}});
      const errors = await harness(page, {extra: '<div id="away" style="position:fixed;right:0;bottom:0;width:40px;height:40px"></div>'});
      await page.evaluate(setup);
      await page.mouse.move(1150, 800);
      const kinds = {
        'a conversation row': '[data-thread-id="t1"]', 'main’s row': '[data-bar-build="main"]', 'an improvement row': '[data-bar-improvement="run:r1"]',
        '+ improvement': '[data-cp-role="new-improvement"]', '▶': '[data-cp-role="play-main"]', 'the conversations +': '.project-thread-new',
        'Settings': '#status', 'collapse': '.sidebar-collapse', 'the project card': '.margin-switch-trigger', 'a fold': '.cp-fold', 'the rollup': '.margin-rollup',
      };
      for (const [kind, selector] of Object.entries(kinds)) {
        const el = page.locator(selector).first();
        const rest = await el.evaluate(el => ({bg: getComputedStyle(el).backgroundColor, property: getComputedStyle(el).transitionProperty, duration: getComputedStyle(el).transitionDuration}));
        const box = await el.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        const pressed = await held(el, rest.bg);
        await page.mouse.move(1150, 800); await page.mouse.up();
        assert.notEqual(pressed, rest.bg, `${kind} answers a press: ${rest.bg} → ${pressed}`);
        assert.match(rest.property, /background-color/, `${kind} moves its background in a transition: ${rest.property}`);
        assert.doesNotMatch(rest.property, /\ball\b/, `${kind} never transitions all`);
        assert.equal(rest.duration.split(', ')[rest.property.split(', ').indexOf('background-color')], '0.12s', `${kind} answers on --t1`);
      }
      assert.deepEqual(await page.evaluate(() => calls), [], 'pressing and letting go elsewhere dispatches nothing');
      assert.deepEqual(await page.locator('#workspace-sidebar button').evaluateAll(els => els.filter(el => getComputedStyle(el).transitionProperty.split(', ').includes('all')).map(el => el.className)), [], 'no control in the bar transitions all');
      // the one primary scales when held; nothing else does
      await page.locator('[data-cp-role="new-improvement"]').click();
      const start = page.locator('[data-cp-role="start-now"]');
      const box = await start.boundingBox();
      await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down();
      const scaled = await held(start, null, {prop: 'transform', want: '^matrix\\(0\\.96'});
      assert.match(scaled, /^matrix\(0\.96/, 'start now presses to .96');
      await page.mouse.move(1150, 800); await page.mouse.up();
      assert.equal(await page.locator('[data-cp-role="up-next"]').evaluate(el => getComputedStyle(el).transitionProperty.includes('transform')), false, 'up next does not scale');
      // one row, one header: two-line rows are 44 at a desk too; every word ends on the right-hand edge
      for (const selector of ['[data-thread-id="t1"]', '[data-bar-build="main"]', '[data-bar-improvement="run:r1"]']) {
        assert.equal(Math.round((await page.locator(selector).boundingBox()).height), 44, `${selector} is one 44px row`);
      }
      const edges = await page.evaluate(() => { const left = document.querySelector('#workspace-sidebar').getBoundingClientRect().left;
        return [...document.querySelectorAll('.margin-body .cp-row .cp-line-2 > .cp-word, .margin-body .cp-row .cp-line-1 > .cp-word, .cp-group-head .cp-badge, .margin-switch-trigger .cp-badge')].filter(el => el.getClientRects().length && el.textContent && !el.closest('.cp-sub-why')).map(el => Math.round(el.getBoundingClientRect().right - left)); });
      assert.deepEqual([...new Set(edges)], [207], 'one right-hand edge: ' + JSON.stringify(edges));
      const trailing = await page.evaluate(() => { const left = document.querySelector('#workspace-sidebar').getBoundingClientRect().left;
        return [...document.querySelectorAll('.cp-trail, .sidebar-collapse')].filter(el => el.getClientRects().length).map(el => { const r = el.getBoundingClientRect(); return Math.round(r.left + r.width / 2 - left); }); });
      assert.deepEqual([...new Set(trailing)], [223], 'one trailing column: ' + JSON.stringify(trailing));
      const words = await page.evaluate(() => { const left = document.querySelector('#workspace-sidebar').getBoundingClientRect().left;
        return [...document.querySelectorAll('.cp-card-head .cp-title, .cp-label, .margin-body > section > .cp-rows > * .cp-line-1, [data-bar-build] .cp-line-1, .margin-foot > .sidebar-progress')].map(el => Math.round(el.getBoundingClientRect().left - left)); });
      assert.deepEqual([...new Set(words)], [48], 'one words’ edge for the project, both labels, every top row and the foot: ' + JSON.stringify(words));
      // lowercase and spoken: every word the bar says itself (names from data aside)
      const said = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('.sidebar-brand, .cp-label, .cp-badge, .margin-rollup, .cp-main .cp-word, .cp-main .cp-note, .cp-improvement .cp-word, .cp-improvement .cp-when, .cp-fold, .cp-add, .cp-why, .cp-form-label, .cp-form .cp-primary-key, .cp-queue-key, .cp-quiet-key, .cp-form-hint, .margin-new')) if (el.textContent.trim()) out.push(el.textContent.trim().replace(/^Beta /, ''));
        for (const el of document.querySelectorAll('#status, .sidebar-collapse, .project-thread-new, [data-cp-role="play-main"], [data-cp-role="new-improvement"], .cp-fold, .cp-form-x, [data-cp-role="up-next"], [data-cp-role="start-now"], #sidebar-toggle')) if (el.title) out.push(el.title);
        out.push(document.querySelector('.margin-switch-search input').placeholder);
        return out;
      });
      for (const words of said) assert.doesNotMatch(words, /[A-Z]/, `the bar speaks lowercase: "${words}"`);
      assert.equal(await page.locator('[data-build-id]').count(), 0, 'no data-build-id anywhere');
      // reduced motion: the building word and the form stand still
      await page.emulateMedia({reducedMotion: 'reduce'});
      await page.evaluate(() => { ui.update(model); });
      assert.equal(await page.locator('[data-bar-improvement="run:b1"] .cp-word').evaluate(el => el.classList.contains('cp-live') && el.getAnimations().length), 0, 'no pulse under reduced motion');
      await page.emulateMedia({reducedMotion: 'no-preference'});
      assert.equal(await page.locator('[data-bar-improvement="run:b1"] .cp-word').evaluate(el => el.getAnimations().map(a => a.animationName).join()), 'cp-bar-pulse', 'and building pulses otherwise');
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      const page = await browser.newPage({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
      const errors = await harness(page);
      await page.evaluate(setup);
      await page.locator('#sidebar-toggle').click();
      await page.evaluate(() => Promise.all(document.querySelector('#workspace-sidebar').getAnimations().map(a => a.finished.catch(() => {}))));
      await page.locator('[data-cp-role="new-improvement"]').click();
      const small = await page.locator('#workspace-sidebar button').evaluateAll(els => els.filter(el => el.getClientRects().length && !el.closest('[hidden]')).map(el => { const r = el.getBoundingClientRect(); return {name: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 24) || el.className, w: Math.round(r.width), h: Math.round(r.height), icon: el.matches('.cp-icon-key, .cp-play')}; }).filter(b => b.h < 44 || (b.icon && b.w < 44)));
      assert.deepEqual(small, [], 'every visible control in the drawer is 44px to press, icon keys 44 wide too');
      const trailing = await page.evaluate(() => { const left = document.querySelector('#workspace-sidebar').getBoundingClientRect().left;
        return [...document.querySelectorAll('.cp-trail, .sidebar-collapse')].filter(el => el.getClientRects().length).map(el => { const r = el.getBoundingClientRect(); return Math.round(r.left + r.width / 2 - left); }); });
      assert.deepEqual([...new Set(trailing)], [262], 'the drawer’s trailing column is centred on 262: ' + JSON.stringify(trailing));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll');
      assert.equal(await page.locator('.margin-body').evaluate(el => el.scrollWidth <= el.clientWidth), true, 'and none inside the bar');
      // a row that opens a page puts the drawer away first
      await page.keyboard.press('Escape');
      await page.locator('[data-bar-improvement="run:r1"]').click();
      assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'openImprovement', id: 'alpha', value: 'run:r1'});
      assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'true', 'the drawer went so the page can show');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('every notification status the app reports names its subject', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const map = app.match(/notificationStatus: \{([^}]*)\}\[notificationPermission\] \|\| '([^']*)'/);
  assert.ok(map, 'the status map is where the Settings card reads it');
  const values = [...map[1].matchAll(/(\w+): '([^']*)'/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(values.map(([key]) => key), ['granted', 'denied', 'default', 'unavailable']);
  for (const [key, value] of [...values, ['fallback', map[2]]]) assert.match(value, /^Notifications /, key + ': ' + value);
  assert.match(app, /notificationBlocked: notificationPermission === 'denied'/);
});

// Words carry state: in the project card a long name is what gives way, never the state word beside it.
test('a long project name is cut before the project card’s state word is', {timeout: 60000}, async () => {
  const browser = await chromium.launch({channel: process.env.CI ? undefined : 'chrome'});
  try {
    for (const width of [1180, 390]) {
      const page = await browser.newPage({viewport: {width, height: 820}, hasTouch: width < 900});
      const errors = await harness(page);
      await page.evaluate(() => {
        window.model = {projects: [
          {id: 'paper-garden-community-edition', name: 'paper-garden-community-edition', active: true, branch: 'main', mode: 'stage', attention: {text: '1 ready to review', tone: 'attention'},
            conversations: [{id: 'home', title: 'Home', lastText: '', active: true}], builds: [mainOf({badge: {text: '1 ready to review', tone: 'attention'}})]},
        ], activeProject: 'paper-garden-community-edition', busy: false, view: null, settings: {}};
        ui.update(model);
      });
      if (width < 900) { await page.locator('#sidebar-toggle').click(); await frame(page); }
      const head = await page.locator('.cp-card-head').first().evaluate(el => {
        const badge = el.querySelector('.cp-badge'), title = el.querySelector('.cp-title');
        return {badge: badge.textContent, badgeCut: badge.scrollWidth > badge.clientWidth + 1, titleCut: title.scrollWidth > title.clientWidth + 1};
      });
      assert.equal(head.badge, '1 ready to review');
      assert.equal(head.badgeCut, false, `at ${width} the state word is whole: ${JSON.stringify(head)}`);
      assert.equal(head.titleCut, true, `at ${width} the long name gives way instead: ${JSON.stringify(head)}`);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

/* ================================================================================== phase 2: copies in the bar */
// docs/BUILDS-AS-COPIES.md §4.3. The VMs are the model's own (builds-model.js buildsCard over a CopiesRead), so the
// bar is held to what the app will hand it.
const T0 = Date.now();
const minsAgo = m => new Date(T0 - m * 60000).toISOString();
const cid = n => `copy-${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`;
const DEV = cid(1), DEV1 = cid(2), DEV3 = cid(3);
const sha = c => c.repeat(40);
const PLAYING = {running: true, starting: false, url: 'http://127.0.0.1:5199/', playable: true, kind: 'server', error: null};
const copyView = (id, name, over = {}) => ({id, project: 'alpha', name, branch: 'nibbi/copy/' + name, base: 'main', baseSha: sha('a'), worktree: '/w/' + name,
  headSha: sha('b'), lastVerifiedSha: sha('b'), lastVerifiedAt: minsAgo(60), status: 'ready', createdAt: minsAgo(600), updatedAt: minsAgo(60), lastLandedAt: minsAgo(60),
  playedAt: null, error: null, ships: [], catchUps: [], intent: null, retiredAt: null, retiredHead: null, ahead: 2, behind: 0, health: 'ok', dirtyFiles: [],
  play: {running: false, starting: false, url: null, playable: true, kind: 'server', error: null}, ...over});
const runOf = (id, extra = {}) => ({id, game: 'alpha', project: 'alpha', title: id, issue: id, branch: 'nibbi/fx-' + id, targetBranch: 'main', status: 'merged',
  startedAt: minsAgo(90), endedAt: minsAgo(80), verification: {status: 'passed', command: 'npm test'}, github: {mode: 'local'}, ...extra});
const onCopy = (copyId, name, id, extra) => runOf(id, {copyId, targetBranch: 'nibbi/copy/' + name, ...extra});
/** A BarModel for one project with main, dev (building, 2 in) and dev1 (1 up next, 1 failed; behind when asked). */
function copiesModel({behind = 0, catchUps = [], devPlay = null, mainPlays = false, github = false, demo = false, busy = false, extra = [], view = null, copies} = {}) {
  const runs = [
    runOf('tighten the round timer', {endedAt: minsAgo(300)}),
    onCopy(DEV, 'dev', 'double-tap on join starts two games', {status: 'running', startedAt: minsAgo(12), latestAttemptStartedAt: minsAgo(12), endedAt: undefined}),
    onCopy(DEV, 'dev', 'remember the last lobby', {endedAt: minsAgo(120)}),
    onCopy(DEV, 'dev', 'bigger join code on the tv', {endedAt: minsAgo(360)}),
    onCopy(DEV1, 'dev1', 'lobby: show who is ready', {status: 'failed', endedAt: minsAgo(40), summary: 'the lobby test timed out'}),
  ];
  const issues = {status: 'ready', revision: 'r'.repeat(64), items: [{id: 'q1', text: 'queue music between rounds', title: 'queue music between rounds', done: false, heading: 'alpha issues', description: '', copyId: DEV1}]};
  const live = copies || [copyView(DEV, 'dev', devPlay ? {play: devPlay, playedAt: minsAgo(1)} : {}), copyView(DEV1, 'dev1', {ahead: 0, behind, catchUps, headSha: sha('a'), lastVerifiedSha: null, lastLandedAt: null}), ...extra];
  const card = buildsCard({
    project: {name: 'alpha', branch: 'main', lastCommit: '', check: 'npm test', github: github ? {workflowMode: 'github', integrationBranch: 'v2', repository: 'o/alpha'} : null, dirty: 0},
    runs, sectionRuns: null, issues, list: 'ready', play: mainPlays ? {running: true, playable: true, url: 'http://127.0.0.1:5173/', kind: 'server'} : {running: false, playable: true, kind: 'server'},
    maxConcurrent: 2, busy, demo, now: T0,
    copies: {project: 'alpha', mode: github ? 'github' : 'local', disabled: github ? 'github' : '', limit: 5, main: {branch: 'main', sha: sha('a')}, copies: live, retired: [], ships: [], fetchedAt: T0},
  });
  return {projects: [{id: 'alpha', name: 'Alpha', active: true, branch: 'main', mode: 'stage', attention: card.attention,
    conversations: conversationsFor([{id: 'home', title: 'Home', lastAt: minsAgo(30)}], {activeId: 'home', project: 'alpha'}),
    builds: card.builds, buildsBadge: card.badge, newCopy: card.newCopy}],
  projectsLoaded: true, activeProject: 'alpha', view, busy, now: T0, settings: {demo}};
}
const put = (page, m) => page.evaluate(m => { window.model = m; ui.update(m); }, m);

test('copies draw under main in order, each row opens its page, its caret folds what is inside it and is remembered', {timeout: 90000}, async () => {
  const browser = await chromium.launch({channel: process.env.CI ? undefined : 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1180, height: 820}});
    const errors = await harness(page);
    await put(page, copiesModel());
    const shownBuilds = () => page.locator('[data-bar-build]').evaluateAll(els => els.map(el => el.dataset.barBuild));
    assert.deepEqual(await shownBuilds(), ['main', 'dev', 'dev1'], 'main first, then the copies');
    assert.equal(await page.locator('[data-build-id]').count(), 0, 'no data-build-id anywhere');
    assert.deepEqual(await page.locator('.cp-builds > .cp-build').evaluateAll(els => els.map(el => [el.dataset.build, el.dataset.copyId ?? null, el.classList.contains('cp-copy')])),
      [['main', null, false], ['dev', 'copy-11111111-1111-1111-1111-111111111111', true], ['dev1', 'copy-22222222-2222-2222-2222-222222222222', true]]);
    // the row: the branch glyph · name and headline · what it is and its counts
    const dev = page.locator('.cp-copy[data-build="dev"]'), dev1 = page.locator('.cp-copy[data-build="dev1"]');
    const devRow = page.locator('[data-bar-build="dev"]');
    assert.deepEqual(await devRow.evaluate(el => [el.querySelector('.cp-primary').textContent, el.querySelector('.cp-line-1 .cp-word').textContent, el.querySelector('.cp-line-1 .cp-word').dataset.tone, el.querySelector('.cp-line-1 .cp-word').classList.contains('cp-live'),
      el.querySelector('.cp-note').textContent, el.querySelector('.cp-count').textContent]), ['dev', '1 building', 'active', true, 'copy of main · 2 ahead', '2 in']);
    assert.equal(await devRow.getAttribute('aria-label'), 'dev, 1 building — copy of main · 2 ahead · 2 in. Open its page');
    assert.equal(await page.locator('[data-bar-build="dev1"] .cp-line-1 .cp-word').textContent(), '1 up next');
    await devRow.click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'openBuild', id: 'alpha', value: 'dev'});
    await page.locator('[data-bar-build="dev1"]').click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'openBuild', id: 'alpha', value: 'dev1'});
    // inside a copy: one step in, on its own trunk; the improvements that live in it, and none of main's
    const inside = name => page.locator(`[data-bar-build-body="${name}"] [data-bar-improvement]`).evaluateAll(els => els.map(el => [el.dataset.barImprovement, el.dataset.state]));
    assert.deepEqual(await inside('dev'), [['run:double-tap on join starts two games', 'building'], ['run:remember the last lobby', 'in'], ['run:bigger join code on the tv', 'in']]);
    assert.deepEqual(await inside('dev1'), [['issue:q1', 'up_next'], ['run:lobby: show who is ready', 'failed']]);
    assert.deepEqual(await page.locator('.cp-build[data-build="main"] [data-bar-improvement]').evaluateAll(els => els.map(el => el.dataset.barImprovement)), ['run:tighten the round timer']);
    assert.deepEqual(await page.locator('[data-bar-build-body="dev"]').evaluate(el => [el.getAttribute('role'), el.getAttribute('aria-label')]), ['group', 'inside dev']);
    // the caret: unfolded to start, folds, is remembered across a refresh, unfolds again
    const caret = dev.locator('[data-cp-role="build-disclosure"]');
    assert.deepEqual([await caret.getAttribute('aria-expanded'), await caret.getAttribute('aria-label'), await caret.getAttribute('title')], ['true', 'Hide what is in dev', 'fold dev']);
    assert.equal(await caret.getAttribute('aria-controls'), await page.locator('[data-bar-build-body="dev"]').getAttribute('id'));
    await caret.click();
    assert.equal(await page.locator('[data-bar-build-body="dev"]').count(), 0, 'folded: nothing inside it is drawn');
    assert.deepEqual([await caret.getAttribute('aria-expanded'), await caret.getAttribute('title')], ['false', 'show what is in dev']);
    assert.equal(await caret.evaluate(el => el === document.activeElement), true, 'focus stays on the caret');
    assert.equal(await page.evaluate(() => calls.filter(c => c.action !== 'openBuild').length), 0, 'folding is the bar’s own: nothing is sent');
    await put(page, copiesModel());
    assert.equal(await page.locator('[data-bar-build-body="dev"]').count(), 0, 'remembered across an update');
    assert.equal(await page.locator('[data-bar-build-body="dev1"]').count(), 1, 'per copy');
    await caret.click();
    assert.equal(await page.locator('[data-bar-build-body="dev"]').count(), 1);
    // the keys: ArrowLeft on a copy's row folds it, ArrowRight unfolds it, then steps inside; ArrowLeft from inside goes to its row
    await devRow.focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await caret.getAttribute('aria-expanded'), 'false');
    assert.equal(await devRow.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('ArrowRight');
    assert.equal(await caret.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.barImprovement), 'run:double-tap on join starts two games');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await devRow.evaluate(el => el === document.activeElement), true, 'from inside dev, ArrowLeft goes to dev');
    await page.locator('.cp-build[data-build="main"] [data-cp-role="new-improvement"]').focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await devRow.evaluate(el => el === document.activeElement), true, 'the arrows walk every build’s rows');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.closest('.cp-build').dataset.build), 'main');
    // marking: exactly one row, with a copy's page or one of its tickets open
    const marked = () => page.locator('.margin-body [aria-current]').evaluateAll(els => els.map(el => [el.dataset.threadId ?? el.dataset.barBuild ?? el.dataset.barImprovement, el.getAttribute('aria-current')]));
    await page.evaluate(() => { model.view = {project: 'alpha', page: 'build', id: 'dev'}; ui.update(model); });
    assert.deepEqual(await marked(), [['dev', 'page']]);
    assert.equal(await page.locator('.cp-copyrow.is-current').count(), 1, 'dev’s whole line lifts, its caret with it');
    await page.evaluate(() => { model.view = {project: 'alpha', page: 'ticket', id: 'issue:q1'}; ui.update(model); });
    assert.deepEqual(await marked(), [['issue:q1', 'page']]);
    // a folded copy unfolds when its page or one of its tickets opens
    await page.evaluate(() => { model.view = null; ui.update(model); });
    await dev1.locator('[data-cp-role="build-disclosure"]').click();
    assert.equal(await page.locator('[data-bar-build-body="dev1"]').count(), 0);
    await page.evaluate(() => { model.view = {project: 'alpha', page: 'ticket', id: 'run:lobby: show who is ready'}; ui.update(model); });
    assert.equal(await page.locator('[data-bar-build-body="dev1"]').count(), 1, 'its ticket opened: dev1 unfolds');
    assert.deepEqual(await marked(), [['run:lobby: show who is ready', 'page']]);
    // a copy that goes (retired): its row goes, and focus inside it goes to main
    await page.locator('[data-bar-build="dev1"]').focus();
    await put(page, copiesModel({copies: [copyView(DEV, 'dev')]}));
    assert.deepEqual(await shownBuilds(), ['main', 'dev']);
    assert.equal(await page.locator('[data-bar-build="main"]').evaluate(el => el === document.activeElement), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('a copy’s + improvement, play and ship to main, catch up — each sends what it should, and says why when it can’t', {timeout: 90000}, async () => {
  const browser = await chromium.launch({channel: process.env.CI ? undefined : 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1180, height: 820}});
    const errors = await harness(page, {onAction: `calls.push({action, id, value}); if (window.hold) return new Promise((resolve, reject) => { window.release = resolve; window.refuse = reject; });`});
    await put(page, copiesModel({behind: 1}));
    const form = page.locator('[data-cp-role="improvement-form"]'), field = form.locator('textarea');
    const addOn = name => page.locator(`[data-cp-role="new-improvement"][data-build="${name}"]`);
    // + improvement in dev: the one form moves into dev, says where it lands, and its words carry dev's id
    assert.equal(await addOn('dev').getAttribute('aria-label'), 'New improvement on dev');
    await addOn('dev').click();
    assert.equal(await form.evaluate(el => el.closest('[data-bar-build-body]')?.dataset.barBuildBody), 'dev', 'the form opens inside dev');
    assert.equal(await field.getAttribute('placeholder'), 'it lands on dev');
    assert.equal(await form.locator('.cp-form-hint').innerText(), 'start now builds it on dev right away · up next keeps it in dev’s list until you start it');
    assert.equal(await addOn('dev').getAttribute('aria-expanded'), 'true');
    assert.equal(await field.evaluate(el => el === document.activeElement), true);
    await field.fill('the join code blinks');
    await field.press('Enter');
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'startImprovement', id: 'alpha', value: {text: 'the join code blinks', copyId: DEV}});
    await form.waitFor({state: 'hidden'});
    assert.equal(await addOn('dev').evaluate(el => el === document.activeElement), true, 'focus back on dev’s + improvement');
    await addOn('dev1').click();
    await field.fill('a lobby countdown');
    await form.locator('[data-cp-role="up-next"]').click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'queueImprovement', id: 'alpha', value: {text: 'a lobby countdown', copyId: DEV1}});
    // drafts are per build: dev1's words wait while main's form is used, and main's send no copyId
    await addOn('dev1').click();
    await field.fill('half-typed on dev1');
    await addOn('main').click();
    assert.equal(await form.evaluate(el => el.closest('.cp-build').dataset.build), 'main');
    assert.equal(await field.inputValue(), '', 'main’s own (empty) draft');
    assert.equal(await field.getAttribute('placeholder'), WORDS.form.placeholder);
    await field.fill('main only');
    await field.press('Enter');
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'startImprovement', id: 'alpha', value: {text: 'main only'}}, 'main’s form is phase 1’s: no copyId');
    await addOn('dev1').click();
    assert.equal(await field.inputValue(), 'half-typed on dev1', 'dev1’s draft came back');
    await page.keyboard.press('Escape');
    assert.equal(await form.isVisible(), false);
    // folding the copy the form is open in closes it
    await addOn('dev1').click();
    await page.locator('.cp-copy[data-build="dev1"] [data-cp-role="build-disclosure"]').click();
    assert.equal(await form.isVisible(), false);
    await page.locator('.cp-copy[data-build="dev1"] [data-cp-role="build-disclosure"]').click();
    // play a copy: start, then stop; one plays at a time, in its title
    const play = page.locator('.cp-copy[data-build="dev"] [data-cp-role="play-copy"]');
    assert.deepEqual(await play.evaluate(el => [el.getAttribute('aria-label'), el.title, el.querySelector('[data-on]').textContent, el.getAttribute('aria-pressed')]), ['Play dev', 'play dev', 'play', null]);
    await page.evaluate(() => { calls.length = 0; });
    const playWidth = await play.evaluate(el => el.getBoundingClientRect().width);
    await play.click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'playCopy', id: 'alpha', value: {copyId: DEV, action: 'start'}});
    await put(page, copiesModel({behind: 1, mainPlays: true}));
    assert.equal(await play.getAttribute('title'), 'one plays at a time — this stops main');
    assert.equal(await page.locator('[data-cp-role="play-main"]').getAttribute('title'), 'main is playing — press to stop it');
    await put(page, copiesModel({behind: 1, devPlay: PLAYING}));
    assert.deepEqual(await play.evaluate(el => [el.getAttribute('aria-label'), el.title, el.querySelector('[data-on]').textContent, el.getAttribute('aria-pressed')]), ['Stop dev', 'dev is playing — press to stop it', 'playing', 'true']);
    assert.equal(await play.evaluate(el => el.getBoundingClientRect().width), playWidth, 'play → playing keeps the key’s width (both faces in one cell)');
    assert.equal(await page.locator('[data-cp-role="play-main"]').getAttribute('title'), 'one plays at a time — this stops dev');
    assert.match(await page.locator('[data-bar-build="dev"] .cp-count').textContent(), /playing$/);
    await play.click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'playCopy', id: 'alpha', value: {copyId: DEV, action: 'stop'}});
    // the key holds while it is out
    await page.evaluate(() => { window.hold = true; });
    await play.click();
    assert.equal(await play.getAttribute('aria-busy'), 'true');
    await page.evaluate(() => release());
    await page.waitForFunction(() => !document.querySelector('.cp-copy[data-build="dev"] [data-cp-role="play-copy"]').hasAttribute('aria-busy'));
    await page.evaluate(() => { window.hold = false; });
    // ship to main opens dev's page on its confirm; the bar never ships
    const ship = name => page.locator(`.cp-copy[data-build="${name}"] [data-cp-role="ship-copy"]`);
    assert.deepEqual(await ship('dev').evaluate(el => [el.disabled, el.title, el.getAttribute('aria-label'), el.textContent]), [false, 'ship dev to main — its page asks first', 'Ship dev to main', 'ship to main']);
    await ship('dev').click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'openShip', id: 'alpha', value: 'dev'});
    assert.equal(await page.evaluate(() => calls.some(c => c.action === 'shipCopy')), false);
    assert.deepEqual(await ship('dev1').evaluate(el => [el.disabled, el.title]), [true, 'nothing to ship yet — no improvement is in dev1']);
    assert.deepEqual(await page.locator('.cp-copy[data-build="dev1"] .cp-keys-why').evaluate(el => [...el.children].map(p => p.textContent)), ['nothing to ship yet — no improvement is in dev1'], 'why, in words, once');
    // catch up: behind, the row sends the catch-up straight to the daemon …
    const catchRow = name => page.locator(`[data-cp-role="catch-up"][data-build="${name}"]`);
    assert.equal(await catchRow('dev').count(), 0, 'not behind: no row');
    assert.deepEqual(await catchRow('dev1').evaluate(el => [el.querySelector('.cp-primary').textContent, el.querySelector('.cp-note').textContent, el.disabled]), ['catch up with main', 'main moved on — 1 behind', false]);
    assert.equal(await page.locator('[data-bar-build-body="dev1"] > :first-child').getAttribute('data-cp-role'), 'catch-up', 'first inside the copy');
    assert.equal(await page.locator('[data-bar-build="dev1"] .cp-line-1 .cp-word').textContent(), 'main moved on · catch up');
    await catchRow('dev1').click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'catchUpCopy', id: 'alpha', value: {copyId: DEV1, expectedHead: sha('a'), stopPlay: false}});
    // … its last failure on line two until the next try …
    await put(page, copiesModel({behind: 1, catchUps: [{at: minsAgo(2), ok: false, mainSha: sha('f'), from: sha('a'), to: null, reason: 'conflict', detail: 'CONFLICT', conflicts: ['src/lobby.js']}]}));
    assert.equal(await catchRow('dev1').locator('.cp-note').textContent(), 'main and dev1 both changed src/lobby.js — dev1 stays as it is; ask nibbi to bring them together');
    // … and while it plays, its page (which asks first)
    await put(page, copiesModel({copies: [copyView(DEV, 'dev'), copyView(DEV1, 'dev1', {behind: 1, play: PLAYING})]}));
    await page.evaluate(() => { calls.length = 0; });
    await catchRow('dev1').click();
    assert.deepEqual(await page.evaluate(() => calls), [{action: 'openBuild', id: 'alpha', value: 'dev1'}]);
    // in demo every copy key says so; its row can't catch up and says why on line two
    await put(page, copiesModel({behind: 1, demo: true}));
    assert.deepEqual(await play.evaluate(el => [el.disabled, el.title]), [true, WORDS.demoPlay]);
    assert.deepEqual(await catchRow('dev1').evaluate(el => [el.disabled, el.querySelector('.cp-note').textContent]), [true, WORDS.demoChange]);
    assert.deepEqual(await page.locator('.cp-copy[data-build="dev"] .cp-keys-why p').allTextContents(), [WORDS.demoPlay, WORDS.demoChange]);
    await addOn('dev').click();
    assert.equal(await form.locator('[data-cp-role="start-now"]').isDisabled(), true);
    assert.equal(await form.locator('.cp-form-note').innerText(), WORDS.demoStart);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('+ New build: the suggested name selected, name problems in words, Enter makes it, focus goes to the new row; the can’t state', {timeout: 90000}, async () => {
  const browser = await chromium.launch({channel: process.env.CI ? undefined : 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1180, height: 820}});
    const errors = await harness(page, {onAction: `calls.push({action, id, value}); if (window.hold && action === 'newCopy') return new Promise((resolve, reject) => { window.release = resolve; window.refuse = reject; });`});
    await put(page, copiesModel());
    const plus = page.locator('[data-cp-role="new-build"]'), buildForm = page.locator('[data-cp-role="build-form"]');
    const name = page.locator('[data-cp-role="build-name"]'), make = page.locator('[data-cp-role="make-build"]'), note = buildForm.locator('.cp-form-note');
    const focused = l => l.evaluate(el => el === document.activeElement);
    assert.deepEqual(await plus.evaluate(el => [el.getAttribute('aria-label'), el.title, el.getAttribute('aria-expanded'), el.disabled, el.closest('.cp-group-head') !== null]), ['New build', WORDS.copy.newTitle, 'false', false, true]);
    assert.equal(await plus.getAttribute('aria-controls'), await buildForm.getAttribute('id'));
    assert.equal(await buildForm.isVisible(), false);
    await plus.click();
    assert.equal(await buildForm.isVisible(), true);
    assert.equal(await buildForm.evaluate(el => el.previousElementSibling.classList.contains('cp-group-head')), true, 'it opens under the header');
    assert.equal(await plus.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(await name.evaluate(el => [el.value, el.selectionStart, el.selectionEnd, el === document.activeElement, el.maxLength, el.getAttribute('autocapitalize'), el.spellcheck]), ['dev2', 0, 4, true, 32, 'off', false], 'the suggested name, selected');
    assert.equal(await buildForm.locator('.cp-form-label').innerText(), 'name the new build');
    assert.equal(await buildForm.locator('.cp-form-sub').innerText(), 'a copy of main, as it is now');
    assert.match(await make.innerText(), /^make it/);
    assert.equal(await buildForm.locator('.cp-primary-key').count(), 1, 'one ink key');
    // name problems are said in words before anything is sent; focus stays in the field
    for (const [typed, words] of [['', WORDS.copy.nameEmpty], ['main', '“main” belongs to the build that ships — pick another'], ['dev', 'there’s already a build called dev'], ['-dev', WORDS.copy.nameShape], ['dév', WORDS.copy.nameShape]]) {
      await name.fill(typed);
      await name.press('Enter');
      assert.equal(await note.innerText(), words, JSON.stringify(typed));
      assert.equal(await focused(name), true);
    }
    assert.equal(await page.evaluate(() => calls.length), 0, 'nothing sent');
    await name.fill('Try Out');
    assert.equal(await note.isVisible(), false, 'typing clears the words');
    // Enter makes it: newCopy with the name as it will be made; the key holds while it goes
    await page.evaluate(() => { window.hold = true; });
    await name.press('Enter');
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'newCopy', id: 'alpha', value: {name: 'try-out'}});
    assert.equal(await make.getAttribute('aria-busy'), 'true');
    // a refusal keeps the name and says the daemon's words
    await page.evaluate(() => refuse(new Error('a branch called nibbi/copy/try-out is already in the repository')));
    await note.filter({hasText: 'already in the repository'}).waitFor();
    assert.equal(await name.inputValue(), 'Try Out');
    assert.equal(await buildForm.isVisible(), true);
    assert.equal(await make.getAttribute('aria-busy'), null);
    // ok: the form closes and clears; focus goes to the new copy's row once it is drawn
    await make.click();
    await page.evaluate(() => release());
    await buildForm.waitFor({state: 'hidden'});
    assert.equal(await focused(plus), true, 'no row yet: focus waits on +');
    await put(page, copiesModel({extra: [copyView(DEV3, 'try-out', {status: 'creating', ahead: 0, lastVerifiedSha: null})]}));
    assert.equal(await page.locator('[data-bar-build="try-out"]').evaluate(el => el === document.activeElement), true, 'then moves to the new row');
    assert.deepEqual(await page.locator('[data-bar-build="try-out"] .cp-line-1 .cp-word').evaluate(el => [el.textContent, el.classList.contains('cp-live')]), ['making the copy', true], 'it pulses while it is made');
    await plus.click();
    assert.equal(await name.inputValue(), 'dev2', 'opened again: the next suggestion');
    await page.evaluate(() => { window.hold = false; });
    // Escape closes it, focus back to +; + improvement and + New build are one form at a time
    await page.keyboard.press('Escape');
    assert.equal(await buildForm.isVisible(), false);
    assert.equal(await focused(plus), true);
    await plus.click();
    await page.locator('[data-cp-role="new-improvement"][data-build="dev"]').click();
    assert.equal(await buildForm.isVisible(), false, '+ improvement closed + New build');
    await plus.click();
    assert.equal(await page.locator('[data-cp-role="improvement-form"]').isVisible(), false, 'and the other way round');
    await page.keyboard.press('Escape');
    // it goes while nibbi answers
    await put(page, copiesModel({busy: true}));
    await plus.click();
    assert.equal(await make.isDisabled(), false);
    await name.fill('late');
    await name.press('Enter');
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'newCopy', id: 'alpha', value: {name: 'late'}});
    // the can't state: GitHub mode. The key is drawn, never disabled; its title and the form say why
    await put(page, copiesModel({github: true}));
    const githubWords = 'copies are local for now — alpha ships through GitHub pull requests';
    assert.equal(await plus.getAttribute('title'), githubWords);
    assert.equal(await plus.isDisabled(), false);
    await page.evaluate(() => { calls.length = 0; });
    await plus.click();
    assert.equal(await buildForm.isVisible(), true);
    assert.deepEqual([await note.innerText(), await name.isDisabled(), await make.isDisabled(), await name.inputValue()], [githubWords, true, true, '']);
    assert.equal(await focused(buildForm.locator('.cp-form-x')), true, '× has focus: it is the one thing to do');
    await buildForm.evaluate(el => el.requestSubmit());
    assert.equal(await page.evaluate(() => calls.length), 0, 'nothing is sent');
    await buildForm.locator('.cp-form-x').click();
    assert.equal(await buildForm.isVisible(), false);
    // the same can't form for five copies and for demo
    await put(page, copiesModel({extra: [3, 4, 5].map(n => copyView(cid(n), 'dev' + n))}));
    await plus.click();
    assert.deepEqual([await note.innerText(), await name.isDisabled()], [WORDS.copy.tooMany, true]);
    await page.keyboard.press('Escape');
    await put(page, copiesModel({demo: true}));
    await plus.click();
    assert.equal(await note.innerText(), WORDS.demoChange);
    await page.keyboard.press('Escape');
    // the bar's name rule says what the model's copyNameProblem says (the bar imports only the contract)
    const names = ['', '  ', 'main', 'Master', 'HEAD', 'dev', 'Dev', 'dev 2', 'my_try', '-x', 'x-', 'dév', 'a'.repeat(32), 'ok'];
    await put(page, copiesModel());
    await plus.click();
    for (const typed of names) {
      await name.fill(typed);
      await name.press('Enter');
      const said = await note.isVisible() ? await note.innerText() : '';
      const expected = copyNameProblem(typed, ['dev', 'dev1']);
      if (expected) assert.equal(said, expected, JSON.stringify(typed));
      else assert.equal((await page.evaluate(() => calls.at(-1))).action, 'newCopy', JSON.stringify(typed));
      if (!expected) { await put(page, copiesModel()); if (!await buildForm.isVisible()) await plus.click(); }
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('the project card: automation picks up up next, into main or the copy you choose, and says its last word', {timeout: 60000}, async () => {
  const browser = await chromium.launch({channel: process.env.CI ? undefined : 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1180, height: 820}});
    const errors = await harness(page);
    await put(page, copiesModel());
    const settled = () => page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().endTime !== Infinity).map(a => a.finished.catch(() => {}))));
    await page.locator('.margin-switch-trigger').click(); await settled();
    await page.locator('.project-group .project-options').first().click(); await settled();
    const card = page.locator('.margin-card:not([hidden])'), line = card.locator('.margin-auto-line'), into = card.locator('.margin-into');
    const keys = () => into.locator('button').evaluateAll(els => els.map(el => [el.textContent, el.getAttribute('aria-pressed')]));
    assert.equal(await line.innerText(), 'automation picks up up next · builds into main');
    assert.equal(await card.locator('.margin-into-field').isVisible(), true, 'a project with copies chooses where automation builds');
    assert.equal(await into.getAttribute('aria-label'), WORDS.auto.intoGroup);
    assert.equal(await card.locator('.margin-into-field .margin-field-label').innerText(), WORDS.auto.into);
    assert.deepEqual(await keys(), [['main', 'true'], ['dev', 'false'], ['dev1', 'false']], 'main, then the copies; main until you choose');
    assert.equal(await into.locator('button', {hasText: 'dev1'}).getAttribute('title'), 'automation builds what’s up next into dev1');
    await into.getByRole('button', {name: 'dev', exact: true}).click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'autoTarget', id: 'alpha', value: 'copy-11111111-1111-1111-1111-111111111111'});
    await page.evaluate(() => { model.projects[0].autoTarget = 'copy-22222222-2222-2222-2222-222222222222'; ui.update(model); });
    assert.deepEqual(await keys(), [['main', 'false'], ['dev', 'false'], ['dev1', 'true']], 'the model says where it builds; the card shows it');
    assert.equal(await line.innerText(), 'automation picks up up next · builds into dev1');
    // the chosen copy is seated like any pressed key: ink is for ship alone, even as the last key of its segment
    const bg = locator => locator.evaluate(el => getComputedStyle(el).backgroundColor);
    await settled();   // the key's colour moves on --t1
    assert.equal(await bg(into.locator('[aria-pressed="true"]')), await bg(card.locator('.margin-mode[data-mode="stage"]')));
    await into.getByRole('button', {name: 'main', exact: true}).click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'autoTarget', id: 'alpha', value: 'main'});
    // a /goal keeps the roadmap; automation's last word is under it, whole in its title
    await page.evaluate(() => { model.projects[0].goalActive = true; model.projects[0].autoNote = 'dev was retired, so automation builds into main now'; ui.update(model); });
    assert.equal(await line.innerText(), 'automation works toward your goal, from plans/alpha.md');
    assert.equal(await card.locator('.margin-auto-note').innerText(), 'dev was retired, so automation builds into main now');
    assert.equal(await card.locator('.margin-auto-note').getAttribute('title'), 'dev was retired, so automation builds into main now');
    await page.evaluate(() => { model.projects[0].goalActive = false; model.projects[0].autoNote = ''; model.busy = true; ui.update(model); });
    assert.equal(await card.locator('.margin-auto-note').isVisible(), false);
    assert.deepEqual(await into.locator('button').evaluateAll(els => els.map(el => el.disabled)), [true, true, true], 'while nibbi answers, like the other settings');
    // the copies go: nothing to choose, and the choice falls to main
    await page.evaluate(() => { model.busy = false; model.projects[0].builds = model.projects[0].builds.slice(0, 1); ui.update(model); });
    assert.equal(await card.locator('.margin-into-field').isVisible(), false);
    assert.equal(await line.innerText(), 'automation picks up up next · builds into main');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('copies at 390 touch: every row and key 44 to press, no sideways scroll; every new control presses on --t1 and speaks lowercase', {timeout: 90000}, async () => {
  const browser = await chromium.launch({channel: process.env.CI ? undefined : 'chrome'});
  try {
    {
      const page = await browser.newPage({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
      const errors = await harness(page);
      await put(page, copiesModel({behind: 1}));
      await page.locator('#sidebar-toggle').click();
      await page.evaluate(() => Promise.all(document.querySelector('#workspace-sidebar').getAnimations().map(a => a.finished.catch(() => {}))));
      await page.locator('[data-cp-role="new-build"]').click();
      const small = await page.locator('#workspace-sidebar button, #workspace-sidebar input').evaluateAll(els => els.filter(el => el.getClientRects().length && !el.closest('[hidden]')).map(el => { const r = el.getBoundingClientRect(); return {name: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 24) || el.className, w: Math.round(r.width), h: Math.round(r.height), icon: el.matches('.cp-icon-key, .cp-play')}; }).filter(b => b.h < 44 || (b.icon && b.w < 44)));
      assert.deepEqual(small, [], 'every visible control in the drawer is 44px to press, icon keys 44 wide too');
      for (const sel of ['[data-bar-build="dev"]', '.cp-copy[data-build="dev"] [data-cp-role="build-disclosure"]', '.cp-copy[data-build="dev"] [data-cp-role="play-copy"]', '.cp-copy[data-build="dev"] [data-cp-role="ship-copy"]', '[data-cp-role="catch-up"]', '[data-cp-role="new-build"]']) {
        const box = await page.locator(sel).first().boundingBox();
        assert.ok(box && box.height >= 44, `${sel} is 44 to press: ${JSON.stringify(box)}`);
      }
      const trailing = await page.evaluate(() => { const left = document.querySelector('#workspace-sidebar').getBoundingClientRect().left;
        return [...document.querySelectorAll('.cp-trail, .sidebar-collapse')].filter(el => el.getClientRects().length).map(el => { const r = el.getBoundingClientRect(); return Math.round(r.left + r.width / 2 - left); }); });
      assert.deepEqual([...new Set(trailing)], [262], 'the drawer’s trailing column holds the carets and + New build: ' + JSON.stringify(trailing));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll');
      assert.equal(await page.locator('.margin-body').evaluate(el => el.scrollWidth <= el.clientWidth), true, 'and none inside the bar');
      // a copy row puts the drawer away before its page opens
      await page.keyboard.press('Escape');
      await page.locator('[data-bar-build="dev"]').click();
      assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action: 'openBuild', id: 'alpha', value: 'dev'});
      assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'true');
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      const page = await browser.newPage({viewport: {width: 1180, height: 820}});
      const errors = await harness(page);
      await put(page, copiesModel({behind: 1}));
      await page.mouse.move(1150, 800);
      const kinds = {
        'a copy’s row': '[data-bar-build="dev"]', 'a copy’s caret': '.cp-copy[data-build="dev"] [data-cp-role="build-disclosure"]',
        'play a copy': '.cp-copy[data-build="dev"] [data-cp-role="play-copy"]', 'ship to main': '.cp-copy[data-build="dev"] [data-cp-role="ship-copy"]',
        'catch up': '[data-cp-role="catch-up"]', '+ New build': '[data-cp-role="new-build"]', 'a copy’s + improvement': '[data-cp-role="new-improvement"][data-build="dev"]',
      };
      for (const [kind, selector] of Object.entries(kinds)) {
        const el = page.locator(selector).first();
        await el.scrollIntoViewIfNeeded(); await page.mouse.move(1150, 800); await page.waitForTimeout(160);
        const rest = await el.evaluate(el => ({bg: getComputedStyle(el).backgroundColor, property: getComputedStyle(el).transitionProperty, duration: getComputedStyle(el).transitionDuration}));
        const box = await el.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        const pressed = await held(el, rest.bg);
        await page.mouse.move(1150, 800); await page.mouse.up();
        assert.notEqual(pressed, rest.bg, `${kind} answers a press: ${rest.bg} → ${pressed}`);
        assert.match(rest.property, /background-color/, `${kind} moves its background in a transition`);
        assert.doesNotMatch(rest.property, /\ball\b/, `${kind} never transitions all`);
        assert.equal(rest.duration.split(', ')[rest.property.split(', ').indexOf('background-color')], '0.12s', `${kind} answers on --t1`);
      }
      assert.deepEqual(await page.evaluate(() => calls), [], 'pressing and letting go elsewhere dispatches nothing');
      // one right-hand edge and one trailing column, copies included
      const edges = await page.evaluate(() => { const left = document.querySelector('#workspace-sidebar').getBoundingClientRect().left;
        return [...document.querySelectorAll('.cp-copy-row .cp-line-1 > .cp-word, .cp-copy-row .cp-line-2 > .cp-word, .cp-group-head .cp-badge')].filter(el => el.getClientRects().length && el.textContent).map(el => Math.round(el.getBoundingClientRect().right - left)); });
      assert.deepEqual([...new Set(edges)], [207], 'every word of a copy’s row ends on the right-hand edge: ' + JSON.stringify(edges));
      const trailing = await page.evaluate(() => { const left = document.querySelector('#workspace-sidebar').getBoundingClientRect().left;
        return [...document.querySelectorAll('.cp-trail')].filter(el => el.getClientRects().length).map(el => { const r = el.getBoundingClientRect(); return Math.round(r.left + r.width / 2 - left); }); });
      assert.deepEqual([...new Set(trailing)], [223]);
      const firstWords = await page.evaluate(() => { const left = document.querySelector('#workspace-sidebar').getBoundingClientRect().left;
        return [...document.querySelectorAll('.cp-copy-row .cp-line-1')].map(el => Math.round(el.getBoundingClientRect().left - left)); });
      assert.deepEqual([...new Set(firstWords)], [48], 'a copy’s name stands on the words’ edge');
      // a long headline beside a name takes its own line; the name is never cut
      assert.equal(await page.locator('[data-bar-build="dev1"] .cp-primary').evaluate(el => el.scrollWidth <= el.clientWidth), true, 'dev1 is whole beside “main moved on · catch up”');
      assert.equal(await page.locator('[data-bar-build="dev1"] .cp-line-1 .cp-word').evaluate(el => el.scrollWidth <= el.clientWidth), true, 'and so is its headline');
      // lowercase and spoken: every word and title a copy's controls say
      const said = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('.cp-copy .cp-word, .cp-copy .cp-note, .cp-copy .cp-catch, .cp-copy .cp-build-keys, .cp-copy .cp-keys-why, .cp-copy .cp-add')) if (el.textContent.trim()) out.push(el.textContent.trim());
        for (const el of document.querySelectorAll('.cp-copy button, [data-cp-role="new-build"]')) if (el.title) out.push(el.title);
        return out;
      });
      for (const words of said) assert.doesNotMatch(words, /[A-Z]/, `the bar speaks lowercase: "${words}"`);
      // reduced motion: the copy's headline stands still
      await page.emulateMedia({reducedMotion: 'reduce'});
      assert.equal(await page.locator('[data-bar-build="dev"] .cp-line-1 .cp-word').evaluate(el => el.getAnimations().length), 0);
      await page.emulateMedia({reducedMotion: 'no-preference'});
      assert.equal(await page.locator('[data-bar-build="dev"] .cp-line-1 .cp-word').evaluate(el => el.getAnimations().map(a => a.animationName).join()), 'cp-bar-pulse');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});
