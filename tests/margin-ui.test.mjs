import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

// Isolated browser contract test: no app/backend/provider network access.
test('sidebar preserves live authority, drafts, focus, and responsive controls', {timeout: 60000}, async () => {
  const browser = await chromium.launch({channel: process.env.CI ? undefined : 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    const errors = []; page.on('pageerror', err => errors.push(err.message));
    await page.setContent('<style>:root{--ease:ease-out;--ink:#151413;--ink-2:#3a3835;--ink-3:#6f6b65}*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:#f5f2ec}</style><nav id="project-rail"></nav><nav id="settings-rail"></nav><button id="outside" style="position:fixed;bottom:10px;left:50%">Outside</button><div id="already-inert" inert>Previously unavailable</div>');
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
    const card = page.locator('.margin-card:not([hidden])');
    const row = id => page.locator(`#project-rail .margin-project[data-project-id="${id}"]`);
    const options = id => page.locator('.project-group').filter({has:page.locator(`.margin-project[data-project-id="${id}"]`)}).locator('.project-options');
    assert.equal(await page.locator('.project-group').count(), 3);
    for (const id of ['alpha','beta','gamma']) {
      const sections = page.locator(`.project-section[data-section-project="${id}"]`);
      assert.deepEqual(await sections.evaluateAll(els => els.map(el => el.dataset.projectSection)), ['builds','issues','plans']);
      assert.equal(await row(id).getAttribute('aria-expanded'), String(id === 'alpha'), 'only the initially active project starts expanded');
    }
    await row('alpha').click();
    assert.equal(await row('alpha').getAttribute('aria-expanded'), 'false');
    assert.deepEqual(await page.evaluate(() => calls), [], 'collapsing a project does not dispatch work');
    await row('alpha').click();
    assert.equal(await row('alpha').getAttribute('aria-expanded'), 'true');
    assert.deepEqual(await page.evaluate(() => calls), [{action:'selectProject',id:'alpha',value:undefined}]);
    assert.equal(await card.count(), 0, 'project rows expand navigation without opening settings');
    await row('beta').click();
    assert.equal(await row('beta').getAttribute('aria-current'), 'false', 'project selection remains owned by the supplied model');
    for (const section of ['builds','issues','plans']) {
      await page.locator(`.project-section[data-section-project="beta"][data-project-section="${section}"]`).click();
      assert.deepEqual(await page.evaluate(() => calls.at(-1)), {action:'projectSection',id:'beta',value:section});
    }
    assert.deepEqual(await page.evaluate(() => calls.filter(c => c.action === 'selectProject')), [{action:'selectProject',id:'alpha',value:undefined},{action:'selectProject',id:'beta',value:undefined}]);
    assert.equal(await page.locator('.project-section[aria-current]').count(), 0, 'clicking does not invent active section state');
    await page.evaluate(() => {model.view={project:'beta',section:'issues'};ui.update(model);});
    assert.equal(await page.locator('.project-section[aria-current="page"]').count(), 1);
    assert.equal(await page.locator('.project-section[aria-current="page"]').getAttribute('data-project-section'), 'issues');
    assert.equal(await page.locator('.project-section[aria-current="page"]').getAttribute('data-section-project'), 'beta');
    await page.evaluate(() => {model.view=null;ui.update(model);});
    assert.equal(await page.locator('.project-section[aria-current]').count(), 0);
    assert.equal(await options('alpha').getAttribute('aria-label'), 'Project settings for Alpha <img src=x onerror=alert(1)>');
    const callsBeforeSettings = await page.evaluate(() => calls.length);
    await options('alpha').click();
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
    await options('alpha').click();
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
    await options('beta').click();
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
        assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-modal'), 'true');
        assert.equal(await page.locator('#outside').evaluate(el => el.inert), true);
        await page.locator('#status').focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('.sidebar-collapse').evaluate(el => el === document.activeElement), true, 'mobile Tab wraps inside sidebar');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.locator('#status').evaluate(el => el === document.activeElement), true, 'mobile reverse Tab wraps');
      } else assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'false', 'desktop expansion survives breakpoint changes');
      await options('alpha').click();
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
    assert.equal(await page.locator('#project-rail [data-project-id]').count(), 60);
    assert.equal(await page.locator('.project-section').count(), 180);
    const settingsBefore = await page.locator('#status').boundingBox();
    assert.equal(await page.locator('#project-rail').evaluate(el => el.scrollHeight > el.clientHeight), true);
    await page.locator('#project-rail [data-project-id="p-59"]').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('#project-rail').evaluate(el => el.scrollTop > 0));
    assert.deepEqual(await page.locator('#status').boundingBox(), settingsBefore, 'settings stays pinned while projects scroll');
    assert.ok(settingsBefore.y >= 0 && settingsBefore.y + settingsBefore.height <= 760);
    await page.evaluate(() => {model.projects=[];ui.update(model);});
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
