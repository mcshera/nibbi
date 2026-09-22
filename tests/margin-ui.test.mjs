import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {progressLine} from '../public/lib/margin-ui.js';

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
test('sidebar preserves live authority, drafts, focus, and responsive controls', {timeout: 60000}, async () => {
  const browser = await chromium.launch({channel: process.env.CI ? undefined : 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    const errors = []; page.on('pageerror', err => errors.push(err.message));
    await page.setContent('<style>:root{--ease:ease-out;--ink:#151413;--ink-2:#3a3835;--ink-3:#6f6b65}*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:#f5f2ec}</style><nav id="project-rail"></nav><nav id="settings-rail"></nav><button id="outside" style="position:fixed;bottom:10px;left:50%">Outside</button><div id="already-inert" inert>Previously unavailable</div>');
    await page.addStyleTag({content: await readFile(new URL('../public/tokens.css', import.meta.url), 'utf8')});
    await page.addStyleTag({content: await readFile(new URL('../public/margins.css', import.meta.url), 'utf8')});
    const moduleURL = 'data:text/javascript;base64,' + Buffer.from(await readFile(new URL('../public/lib/margin-ui.js', import.meta.url))).toString('base64');
    await page.evaluate(async url => {
      const {installMarginUI} = await import(url);
      window.calls = [];
      window.ui = installMarginUI({onAction: (action,id,value) => {
        calls.push({action,id,value});
        if (action === 'fix') return Promise.reject(new Error('Fixture action failed'));
        if (action === 'spendCap') return new Promise(resolve => {window.capResolve = resolve;});
      }});
      window.model = {projects: [
        {id:'alpha', name:'Alpha <img src=x onerror=alert(1)>', active:true, branch:'main', goal:'A real goal', mode:'stage', inFlight:2,pending:1,staged:3,spend:14.2,spendCap:40,done:2,total:7,planAvailable:true,playable:true},
        {id:'beta',name:'Beta',mode:'off',done:null,total:null,spend:null,spendCap:null,playable:false},
        {id:'gamma',name:'Gamma',mode:'off',done:0,total:0,playable:false},
      ], activeProject:'alpha', busy:false, settings:{microphone:false,microphonePhase:'off',voice:true,sounds:false,notifications:false,notificationsSupported:true,notificationStatus:'Not requested',model:'fixture-model',provider:'fixture',brain:'ready',session:'test',context:'100 tokens',demo:false,calm:false,systemReduced:false}};
      ui.update(model);
    }, moduleURL);
    assert.deepEqual(await page.evaluate(() => calls), []);
    assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'false', 'desktop starts expanded');
    assert.equal(await page.locator('#workspace-sidebar').getAttribute('role'), 'complementary');
    assert.equal(await page.locator('#project-rail img').count(), 0);
    const progress = page.locator('#project-rail #sidebar-progress');
    assert.equal(await progress.count(), 1, 'one companion progress line in the projects rail');
    assert.equal(await progress.getAttribute('role'), 'status');
    assert.ok(await progress.evaluate(el => el.classList.contains('margin-muted')), 'quiet muted style');
    assert.equal(await progress.innerText(), 'Progress not available', 'no progress in the model reads as unavailable, not zero');
    assert.ok(await progress.evaluate(el => el.compareDocumentPosition(document.querySelector('.margin-body')) & Node.DOCUMENT_POSITION_PRECEDING), 'the quiet line sits under the conversations, not over the project list');
    await page.evaluate(() => {model.progress = {available: true, today: {deliveries: 0}, week: {deliveries: 0}, streak: 0}; ui.update(model);});
    assert.equal(await progress.innerText(), 'Nothing merged yet today');
    await page.evaluate(() => {model.progress = {available: true, today: {deliveries: 0}, week: {deliveries: 4}, streak: 0}; ui.update(model);});
    assert.equal(await progress.innerText(), 'Nothing merged yet today · 4 this week');
    await page.evaluate(() => {model.progress = {available: true, today: {deliveries: 2}, week: {deliveries: 5}, streak: 3}; ui.update(model);});
    assert.equal(await progress.innerText(), '2 merged today · 5 this week · 3-day streak');
    await page.evaluate(() => {model.progress = {available: true, today: {deliveries: 1}, week: {deliveries: 1}, streak: 1}; ui.update(model);});
    assert.equal(await progress.innerText(), '1 merged today · 1 this week · 1-day streak');
    await page.evaluate(() => {model.progress = {available: false}; ui.update(model);});
    assert.equal(await progress.innerText(), 'Progress not available');
    await page.evaluate(() => {delete model.progress; ui.update(model);});
    assert.equal(await progress.innerText(), 'Progress not available');
    assert.deepEqual(await page.evaluate(() => calls), [], 'progress rendering dispatches nothing');
    const card = page.locator('.margin-card:not([hidden])');
    const switcher = page.locator('.margin-switch-trigger');
    const openMenu = async () => { if (!await page.locator('.margin-switch-menu').isVisible()) await switcher.click(); };
    // The gear lives in the switcher's list now, so reaching it means opening the list.
    const gear = async id => { await openMenu(); return options(id); };
    const row = id => page.locator(`.margin-switch-menu .margin-project[data-project-id="${id}"]`);
    const options = id => page.locator('.project-group').filter({has:page.locator(`.margin-project[data-project-id="${id}"]`)}).locator('.project-options');
    // Every project is a row in the switcher's list; only the current one has a strip and a body.
    assert.equal(await page.locator('.project-group').count(), 3);
    assert.equal(await switcher.getAttribute('data-current-project'), 'alpha', 'the switcher names the project the model says is active');
    assert.deepEqual(await page.locator('.project-section[data-project-section]').evaluateAll(els => els.map(el => el.dataset.projectSection)), ['builds','issues','plans']);
    assert.deepEqual(await page.locator('.project-section[data-section-project]').evaluateAll(els => [...new Set(els.map(el => el.dataset.sectionProject))]), ['alpha'], 'only the current project has a strip');
    assert.equal(await page.locator('.margin-switch-menu').isVisible(), false, 'the list starts closed');
    await openMenu();
    assert.equal(await page.locator('.margin-switch-menu').isVisible(), true);
    assert.deepEqual(await page.evaluate(() => calls), [], 'opening the list dispatches nothing');
    assert.equal(await card.count(), 0, 'opening the list does not open settings');
    await row('beta').click();
    assert.equal(await page.locator('.margin-switch-menu').isVisible(), false, 'choosing a project closes the list');
    assert.deepEqual(await page.evaluate(() => calls), [{action:'selectProject',id:'beta',value:undefined}]);
    assert.equal(await switcher.getAttribute('data-current-project'), 'alpha', 'project selection remains owned by the supplied model');
    for (const section of ['builds','issues','plans']) {
      await page.locator(`.project-section[data-section-project="alpha"][data-project-section="${section}"]`).click();
      assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action:'projectSection',id:'alpha',value:section});
    }
    assert.deepEqual(await page.evaluate(() => calls.filter(c => c.action === 'selectProject')), [{action:'selectProject',id:'beta',value:undefined}]);
    // Chat carries aria-current when no section is open — that is the point of it being a tab — so
    // the question is only whether a *section* invented state.
    assert.equal(await page.locator('.project-section[data-project-section][aria-current]').count(), 0, 'clicking does not invent active section state');
    assert.equal(await page.locator('.margin-tab[data-margin-tab="chat"][aria-current="page"]').count(), 1, 'Chat is the current tab when no section is open');
    await page.evaluate(() => {model.view={project:'alpha',section:'issues'};ui.update(model);});
    assert.equal(await page.locator('.project-section[aria-current="page"]').count(), 1);
    assert.equal(await page.locator('.project-section[aria-current="page"]').getAttribute('data-project-section'), 'issues');
    assert.equal(await page.locator('.project-section[aria-current="page"]').getAttribute('data-section-project'), 'alpha');
    await page.evaluate(() => {model.view=null;ui.update(model);});
    assert.equal(await page.locator('.project-section[data-project-section][aria-current]').count(), 0);
    // The Chat tab asks for the conversation that is already open. What it is really asking for is
    // to stop looking at a record section, so it must dispatch even when nothing about the thread
    // changes — openThread leaves the section before it notices the thread is unchanged.
    await page.evaluate(() => {model.view={project:'alpha',section:'builds'};model.projects[0].threads=[{id:'home',title:'Home',lastAt:new Date().toISOString(),active:true}];ui.update(model);});
    const beforeChat = await page.evaluate(() => calls.length);
    await page.locator('.margin-tab[data-margin-tab="chat"]').click();
    assert.equal(await page.evaluate(() => calls.length), beforeChat + 1, 'the Chat tab dispatches even when its conversation is already the open one');
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action:'thread',id:'alpha',value:'home'});
    // A thread's name is one clipped line in a 256px bar, and the first thing that will truncate.
    await page.evaluate(() => {const long='Rework the turn lock so an abort clears it before the stream closes';model.view=null;model.projects[0].threads=[{id:'home',title:'Home',active:true},{id:'long',title:long,lastAt:new Date().toISOString()}];ui.update(model);window.longTitle=long;});
    const longRow = page.locator('[data-thread-id="long"]');
    assert.equal(await longRow.getAttribute('title'), await page.evaluate(() => window.longTitle), 'the whole name is reachable even though the row shows one line of it');
    assert.ok(await longRow.locator('.project-section-copy').evaluate(el => el.scrollWidth > el.clientWidth), 'and it really is clipped, so the title is not decoration');

    // Escape belongs to whatever you are actually in. Docked, the bar is open all day; swallowing
    // every Escape meant the composer and the palette never saw one.
    await page.locator('#outside').focus();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'false', 'Escape from the page leaves the docked bar alone');
    await page.locator('.sidebar-collapse').focus();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'true', 'Escape from inside the bar closes it');
    assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-label'), 'Open sidebar', 'the toggle names what pressing it does');
    await page.locator('#sidebar-toggle').click();
    assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'false');

    await page.evaluate(() => {model.view=null;ui.update(model);});
    await openMenu();
    assert.equal(await (await gear('alpha')).getAttribute('aria-label'), 'Project settings for Alpha <img src=x onerror=alert(1)>');
    const callsBeforeSettings = await page.evaluate(() => calls.length);
    await (await gear('alpha')).click();
    assert.equal(await page.evaluate(() => calls.length), callsBeforeSettings, 'opening project settings does not change the active project or dispatch work');
    assert.equal(await card.count(), 1);
    assert.match(await card.textContent(), /2 of 7 complete/);
    const cap = card.locator('input[type="number"]');
    await cap.fill('123.45');
    await page.evaluate(() => {model.projects[0].spendCap = 99; model.projects[0].done = 3; ui.update(model);});
    assert.equal(await cap.inputValue(), '123.45');
    assert.equal(await cap.evaluate(el => document.activeElement === el), true);
    assert.match(await card.textContent(), /3 of 7 complete/);
    await card.getByRole('button', {name:'ship', exact:true}).click();
    assert.equal(await page.evaluate(() => calls.filter(c => c.action === 'autoMode').length), 0);
    await card.getByRole('button', {name:'Enable ship', exact:true}).click();
    assert.deepEqual(await page.evaluate(() => calls.find(c => c.action === 'autoMode')), {action:'autoMode',id:'alpha',value:'ship'});
    await card.getByRole('button', {name:'Save', exact:true}).click();
    assert.equal(await card.getByRole('button', {name:'Save', exact:true}).isDisabled(), true);
    await cap.fill('124');
    await page.evaluate(() => capResolve());
    await page.evaluate(() => ui.update(model));
    assert.equal(await cap.inputValue(), '124');
    await card.getByRole('button', {name:'Fix…', exact:true}).click();
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
    await page.locator('#status').click();
    assert.equal(await page.locator('#status').getAttribute('aria-expanded'), 'true');
    for (const id of ['st-platform','st-motion','st-microphone','st-voice','st-sounds','st-demo','st-clear']) assert.equal(await card.locator(`#${id}`).count(), 1);
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
    assert.match(await card.textContent(), /Progress not available/);
    assert.match(await card.textContent(), /Spend not available · Cap not available/);
    await page.evaluate(() => {model.projects[1].spend = 0; model.projects[1].spendCap = 0; ui.update(model);});
    assert.match(await card.textContent(), /\$0 spent · No cap/);
    assert.match(await card.textContent(), /0 means no cap/);
    assert.equal(await card.getByRole('button', {name:'Play',exact:true}).isDisabled(), true);
    await page.locator('#status').click();
    assert.equal(await card.locator('h2').innerText(), 'Settings', 'settings replaces project details');
    for (const width of [320,390,520,899,900,1180,1440]) {
      await page.setViewportSize({width,height:760});
      await page.waitForFunction(narrow => document.querySelector('#workspace-sidebar').getAttribute('role') === (narrow ? 'dialog' : 'complementary'), width < 900);
      await page.evaluate(() => ui.close());
      if (width < 900) {
        assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'true');
        await page.locator('#sidebar-toggle').click();
        // The sidebar slides in; focus order is only meaningful once it has laid out.
        await page.evaluate(() => Promise.all(document.querySelector('#workspace-sidebar').getAnimations().map(a => a.finished.catch(() => {}))));
        assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-modal'), 'true');
        assert.equal(await page.locator('#outside').evaluate(el => el.inert), true);
        await page.locator('#status').focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('.sidebar-collapse').evaluate(el => el === document.activeElement), true, 'mobile Tab wraps inside sidebar');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.locator('#status').evaluate(el => el === document.activeElement), true, 'mobile reverse Tab wraps');
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
        await page.locator('#st-clear').focus(); await page.keyboard.press('Tab');
        assert.equal(await card.locator('.margin-close').evaluate(el => el === document.activeElement), true, 'open card owns mobile focus');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#status').evaluate(el => el === document.activeElement), true);
        await openMenu();   // New project lives at the foot of the switcher's list
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
    await page.evaluate(() => {model.projects = Array.from({length:60},(_,i)=>({...model.projects[0],id:`p-${i}`,name:'A very long project name '.repeat(10)+i,active:i===0}));model.activeProject='p-0';ui.update(model);});
    assert.equal(await page.locator('#project-rail [data-project-id]').count(), 60, 'every project is a row in the list');
    // Sixty projects, one strip: only the project you are in renders its sections and its
    // conversations. That is the whole difference between this bar and the tree it replaced.
    assert.equal(await page.locator('[data-project-section]').count(), 3);
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
    assert.deepEqual(await page.locator('#status').boundingBox(), settingsBefore, 'settings stays pinned while the list scrolls');
    assert.ok(settingsBefore.y >= 0 && settingsBefore.y + settingsBefore.height <= 760);
    await page.keyboard.press('Escape');
    // The foot sits under the conversations and against the bottom of the bar. Left in the flow it
    // ended up stranded mid-bar with four hundred pixels of empty paper below it.
    await page.evaluate(() => ui.setSidebar(true));
    await page.setViewportSize({width: 1180, height: 820});
    await page.evaluate(() => {model.projects=[model.projects[0]];model.activeProject='p-0';model.projects[0].threads=[{id:'home',title:'Home',active:true}];model.view=null;ui.update(model);});
    const gap = await page.evaluate(() => {
      const bar = document.querySelector('#workspace-sidebar').getBoundingClientRect();
      const foot = document.querySelector('.margin-foot').getBoundingClientRect();
      const settings = document.querySelector('#settings-rail').getBoundingClientRect();
      const body = document.querySelector('.margin-body').getBoundingClientRect();
      return {belowFoot: settings.top - foot.bottom, barBottom: bar.bottom, footBottom: foot.bottom, bodyHeight: body.height};
    });
    assert.ok(gap.belowFoot <= 24, 'the foot is contiguous with Settings, not floating above a void: ' + gap.belowFoot);
    assert.ok(gap.bodyHeight > 200, 'and the conversations take the room that leaves: ' + gap.bodyHeight);

    // A backend that has not answered, and a first run, say so rather than describing a project
    // that does not exist.
    await page.evaluate(() => {model.projects=[];model.activeProject=null;model.projectsLoaded=false;ui.update(model);});
    assert.match(await page.locator('.margin-switch-trigger').innerText(), /Loading projects/);
    await page.evaluate(() => {model.projectsLoaded=true;ui.update(model);});
    const firstRun = await page.locator('.margin-switch-trigger').innerText();
    assert.match(firstRun, /No projects yet/);
    assert.doesNotMatch(firstRun, /quiet|no branch/, 'nothing is invented about a project that is not there');
    assert.equal(await page.locator('.margin-body .margin-empty-new').count(), 1, 'and there is one way to start');
    await page.locator('.margin-body .margin-empty-new').click();
    assert.equal(await page.evaluate(() => calls.at(-1).action), 'newProject');

    // data-link was set on the body and styled by nothing. It has a home now.
    await page.evaluate(() => {model.link='offline';ui.update(model);});
    assert.match(await page.locator('.margin-link').innerText(), /Offline/);
    await page.evaluate(() => {model.link='live';ui.update(model);});
    assert.equal(await page.locator('.margin-link').isVisible(), false);

    await page.evaluate(() => {model.projects=[];model.activeProject=null;ui.update(model);});
    assert.equal(await page.locator('#project-rail [data-project-id]').count(), 0);
    assert.equal(await page.locator('.project-section').count(), 0);
    await page.evaluate(() => ui.destroy());
    assert.equal(await page.locator('.margin-card').count(), 0);
    assert.equal(await page.locator('#status').count(), 0);
    assert.equal(await page.locator('#workspace-sidebar').count(), 0);
    assert.equal(await page.locator('#outside').evaluate(el => el.inert), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
