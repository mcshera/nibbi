// node design/sidebar-lab/verify.mjs — the full sweep. Starts its own loopback server on an ephemeral
// port and drives local Chrome (bundled Chromium in CI). Writes evidence/*.png and
// evidence/browser-results.json. Exit code 1 if any gated check fails.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { listen } from './serve.mjs';
import { STATES, VIEWPORTS } from './states.mjs';

const out = fileURLToPath(new URL('./evidence/', import.meta.url));
await mkdir(out, { recursive: true });
const { server, url } = await listen(0);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
const results = {
  environment: 'local Chrome via Playwright; geometry in CSS pixels at the page\'s real viewport (?scale=1). Not a device benchmark, and it certifies neither Safari/WKWebView nor the native Tauri shell.',
  checks: [], measured: {}, errors: [], warnings: [], failed: false,
};
const check = (name, detail = {}) => { results.checks.push({ name, ...detail }); console.log('PASS', name); };
const fail = (name, detail) => { results.failed = true; results.checks.push({ name, failed: true, ...detail }); console.log('FAIL', name, JSON.stringify(detail).slice(0, 400)); };
const collect = page => {
  page.on('pageerror', e => results.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) results.errors.push(m.text()); });
};
// Everything the app's suites reach for, expressed as something an option can satisfy here.
const PINNED = [
  ['#workspace-sidebar', '[data-pin="workspace-sidebar"]'], ['#sidebar-toggle', '[data-lab-role="toggle"]'],
  ['.sidebar-collapse', '[data-lab-role="collapse"]'], ['.sidebar-backdrop', '[data-lab-role="backdrop"]'],
  ['#project-rail', '[data-pin="project-rail"]'], ['#settings-rail', '[data-pin="settings-rail"]'],
  ['#sidebar-progress', '[data-pin="sidebar-progress"]'], ['#status', '[data-lab-role="settings"]'],
  ['#st-voice', '#st-voice'], ['#st-platform', '#st-platform'], ['#st-motion', '#st-motion'],
  ['.margin-card', '.margin-card'], ['.margin-card-scroll', '.margin-card-scroll'], ['.margin-close', '.margin-close'],
  ['.margin-new', '[data-lab-role="new-project"]'], ['[data-project-id]', '[data-project-id][aria-expanded], [data-project-id]'],
  ['.project-options', '[data-lab-role="gear"]'], ['[data-project-section]', '[data-project-section][data-section-project]'],
  ['.project-section-badge', '[data-badge]'], ['.project-thread-new', '[data-lab-role="new-thread"]'],
];

const HELPERS = () => {
  const lum = rgb => { const c = rgb.map(v => { const s = v / 255; return s <= .03928 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  const parse = v => (v.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
  window.__lab = {
    visible(el) { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; },
    background(el) {
      let n = el;
      while (n && n !== document.documentElement) { const bg = parse(getComputedStyle(n).backgroundColor); if (bg.length >= 3 && (bg[3] === undefined || bg[3] > .5)) return bg.slice(0, 3); n = n.parentElement; }
      return [245, 242, 236];
    },
    contrast(fg, bg) { const a = lum(fg) + .05, b = lum(bg) + .05; return Math.max(a, b) / Math.min(a, b); },
    parse,
    // Is the control on screen without scrolling the bar to find it?
    reachable(el, host) {
      if (!el || !window.__lab.visible(el)) return false;
      const frame = host.closest('.lab-frame') || document.documentElement;
      const fr = frame.getBoundingClientRect(), r = el.getBoundingClientRect();
      if (r.top < fr.top - 1 || r.bottom > fr.bottom + 1 || r.left < fr.left - 1 || r.right > fr.right + 1) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
    },
  };
};

let page;
try {
  // ---------- 1. The sweep: every option, every state, every size ----------
  const overflow = [], semantics = [], targets = [], contrastBad = [];
  const perViewport = {};
  for (const vp of VIEWPORTS) {
    page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    collect(page);
    await page.goto(`${url}?scale=1&frame=${vp.width}x${vp.height}`);
    await page.waitForFunction(() => window.sidebarLab?.ready, null, { timeout: 30000 });
    await page.addScriptTag({ content: `(${HELPERS.toString()})()` });
    const ids = await page.evaluate(() => sidebarLab.options);
    if (!ids.length) fail('options load', { viewport: vp.id });
    for (const state of STATES) {
      await page.evaluate(id => sidebarLab.cue(id), state.id);
      await page.waitForTimeout(state.id === 'many' ? 120 : 60);
      const report = await page.evaluate(({ stateId, narrow }) => {
        const rows = [];
        for (const id of sidebarLab.options) {
          const host = sidebarLab.hostEl(id), frame = sidebarLab.frameEl(id);
          if (!host || !frame) { rows.push({ id, missing: true }); continue; }
          const vp = sidebarLab.viewportOf(id);
          const min = vp.narrow ? 44 : 32;
          const row = { id, overflow: Math.max(frame.scrollWidth - frame.clientWidth, 0), semantics: [], targets: [], contrast: [] };
          const bar = host.querySelector('[data-pin="workspace-sidebar"]') || host.firstElementChild;
          if (bar) row.overflow = Math.max(row.overflow, bar.scrollWidth - bar.clientWidth);
          if (stateId !== 'collapsed' && !host.querySelector('[data-project-id]')) row.semantics.push('no project control');
          if (stateId === 'home') {
            const open = [...host.querySelectorAll('[data-thread-id][aria-current="true"]')];
            if (open.length !== 1) row.semantics.push(`${open.length} conversations marked open`);
            else if (open[0].dataset.threadId !== 'home') row.semantics.push('home is not the open conversation');
          }
          if (stateId === 'thread' && host.querySelector('[data-thread-id][aria-current="true"]')?.dataset.threadId !== 't-left-bar') row.semantics.push('the named thread is not marked open');
          if (stateId === 'builds') {
            const current = [...host.querySelectorAll('[data-project-section][aria-current="page"]')];
            if (current.length !== 1) row.semantics.push(`${current.length} sections marked current`);
            else if (current[0].dataset.projectSection !== 'builds') row.semantics.push('the wrong section is current');
          }
          if (stateId === 'card' && !host.querySelector('[data-lab-role="card"]:not([hidden])')) row.semantics.push('no open card');
          if (stateId === 'collapsed' && !window.__lab.visible(host.querySelector('[data-lab-role="toggle"]') || document.createElement('i'))) row.semantics.push('no visible way back');
          if (stateId === 'drawer' && vp.narrow && !host.querySelector('[data-lab-role="backdrop"]:not([hidden])')) row.semantics.push('no backdrop behind the drawer');
          for (const el of host.querySelectorAll('button, [role="button"], a[href]')) {
            if (!window.__lab.visible(el) || el.dataset.labRole === 'backdrop' || el.closest('[data-lab-role="card"]')) continue;
            const h = el.getBoundingClientRect().height;
            if (h + .5 < min) row.targets.push(`${(el.getAttribute('aria-label') || el.textContent || el.className).trim().slice(0, 24)} ${Math.round(h)}px<${min}`);
          }
          for (const el of host.querySelectorAll('*')) {
            if (!el.firstChild || el.firstChild.nodeType !== 3 || !el.textContent.trim()) continue;
            if (!window.__lab.visible(el) || el.closest('[data-lab-role="card"]')) continue;
            const style = getComputedStyle(el);
            if (parseFloat(style.fontSize) > 12.5) continue;
            const ratio = window.__lab.contrast(window.__lab.parse(style.color).slice(0, 3), window.__lab.background(el));
            row.minContrast = Math.min(row.minContrast ?? 99, Math.round(ratio * 100) / 100);
            if (ratio < 4.5) row.contrast.push(`"${el.textContent.trim().slice(0, 20)}" ${ratio.toFixed(2)}:1`);
          }
          rows.push(row);
        }
        return rows;
      }, { stateId: state.id, narrow: vp.narrow });
      for (const row of report) {
        const where = `${row.id} · ${state.id} · ${vp.id}`;
        if (row.missing) { semantics.push(`${where}: option did not load`); continue; }
        // A baseline is the app as it ships: what it gets wrong is a finding for the brief, not a gate.
        const isBaseline = row.id.startsWith('_');
        if (row.overflow > 1) overflow.push(`${where}: ${row.overflow}px`);
        for (const s of row.semantics) semantics.push(`${where}: ${s}`);
        for (const t of row.targets) (isBaseline ? results.warnings : targets).push(`${where}: ${t}`);
        for (const c of row.contrast) (isBaseline ? results.warnings : contrastBad).push(`${where}: ${c}`);
        const m = results.measured[row.id] ||= {};
        if (row.minContrast != null) m.minContrast = Math.min(m.minContrast ?? 99, row.minContrast);
      }
      perViewport[vp.id] = true;
    }
    if (vp.id === '1440x900' || vp.id === '390x844') {
      await page.evaluate(() => sidebarLab.cue('home'));
      await page.waitForTimeout(120);
      await page.screenshot({ path: `${out}viewport-${vp.id}-home.png`, fullPage: true });
    }
    await page.close();
  }
  const dedupe = list => [...new Set(list)];
  if (overflow.length) fail('no horizontal overflow', { examples: dedupe(overflow).slice(0, 10) });
  else check(`No horizontal overflow: ${STATES.length} states × ${VIEWPORTS.length} sizes`);
  if (semantics.length) fail('every state says what it should', { examples: dedupe(semantics).slice(0, 12) });
  else check('Every state marks the open conversation, the current section, the card, the way back and the backdrop');
  if (targets.length) fail('targets are big enough', { examples: dedupe(targets).slice(0, 12) });
  else check('Every control in the bar is at least 44px on a phone and 32px on a desktop');
  if (contrastBad.length) fail('quiet text is readable', { examples: dedupe(contrastBad).slice(0, 12) });
  else check('Text at 12px and under is at least 4.5:1 against its own background');

  // ---------- 2. Protocol, Escape, reduced motion, scale, and the scorecard rows ----------
  page = await browser.newPage({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });
  collect(page);
  await page.goto(`${url}?scale=1&frame=1180x820`);
  await page.waitForFunction(() => window.sidebarLab?.ready, null, { timeout: 30000 });
  await page.addScriptTag({ content: `(${HELPERS.toString()})()` });
  await page.evaluate(list => { window.__PINNED = list; }, PINNED);

  const protocol = await page.evaluate(async () => {
    const APP = new Set(['selectProject','projectSection','repository','newProject','thread','newThread','fix','plan','play','review','providers','autoMode','spendCap','model','advancedSettings','microphone','voice','sounds','notifications','calm','glass','demo','tidy']);
    const report = {};
    for (const id of sidebarLab.options) {
      sidebarLab.cue('home'); sidebarLab.clearActions();
      const host = sidebarLab.hostEl(id);
      for (const selector of ['[data-lab-role="chooser"]', '[data-project-id]', '[data-lab-role="chat"]', '[data-thread-id]:not([aria-current="true"])', '[data-lab-role="new-thread"]', '[data-project-section]', '[data-lab-role="new-project"]', '[data-lab-role="gear"]', '[data-lab-role="settings"]']) {
        const el = host.querySelector(selector);
        if (el && !el.disabled && window.__lab.visible(el)) { el.click(); await new Promise(r => setTimeout(r, 0)); }
      }
      const mine = sidebarLab.actions.filter(a => a.option === id);
      const names = [...new Set(mine.map(a => a.name))];
      const thread = mine.find(a => a.name === 'thread'), section = mine.find(a => a.name === 'projectSection');
      report[id] = {
        names, outside: names.filter(n => !APP.has(n) && !n.startsWith('lab:')),
        labOnly: names.filter(n => n.startsWith('lab:')),
        threadOk: !thread || !!(thread.projectId && thread.value),
        sectionOk: !section || ['builds', 'issues', 'plans'].includes(section.value),
      };
    }
    return report;
  });
  const badProtocol = Object.entries(protocol).filter(([, r]) => r.outside.length || !r.threadOk || !r.sectionOk);
  if (badProtocol.length) fail('speaks the app\'s protocol', { detail: Object.fromEntries(badProtocol) });
  else check('Every design dispatches only what handleMarginAction already understands', Object.fromEntries(Object.entries(protocol).map(([id, r]) => [id, r.names.join(' ')])));
  for (const [id, r] of Object.entries(protocol)) (results.measured[id] ||= {}).labOnlyActions = r.labOnly;

  const escape = await page.evaluate(async () => {
    const report = {};
    for (const id of sidebarLab.options) {
      sidebarLab.cue('card');
      const host = sidebarLab.hostEl(id);
      const bar = host.querySelector('[data-pin="workspace-sidebar"]') || host.firstElementChild;
      const press = () => (host.contains(document.activeElement) ? document.activeElement : host.querySelector('button'))
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      press(); await new Promise(r => setTimeout(r, 30));
      const cardClosed = !host.querySelector('[data-lab-role="card"]:not([hidden])');
      const barStillOpen = !bar || bar.getAttribute('aria-hidden') !== 'true';
      const focusKept = host.contains(document.activeElement);
      press(); await new Promise(r => setTimeout(r, 260));
      const barClosed = !bar || bar.getAttribute('aria-hidden') === 'true' || !window.__lab.visible(bar);
      report[id] = { cardClosed, barStillOpen, focusKept, barClosed };
    }
    return report;
  });
  const badEscape = Object.entries(escape).filter(([, r]) => !r.cardClosed || !r.barStillOpen || !r.focusKept || !r.barClosed);
  if (badEscape.length) fail('Escape has an order', { detail: Object.fromEntries(badEscape) });
  else check('Escape closes the card first and keeps focus, then closes the bar');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const still = await page.evaluate(async () => {
    sidebarLab.setEnvironment({ reduced: true });
    const report = {};
    for (const id of sidebarLab.options) { sidebarLab.cue('switch'); sidebarLab.cue('collapsed'); }
    await new Promise(r => setTimeout(r, 90));
    for (const id of sidebarLab.options) report[id] = sidebarLab.hostEl(id).getAnimations({ subtree: true }).filter(a => a.playState === 'running').length;
    sidebarLab.setEnvironment({ reduced: false });
    return report;
  });
  const moving = Object.entries(still).filter(([, n]) => n > 0);
  if (moving.length) fail('reduced motion settles', { detail: Object.fromEntries(moving) });
  else check('With reduced motion nothing is still animating a beat after a cue');
  await page.emulateMedia({ reducedMotion: null });

  // Scorecard rows.
  const measured = await page.evaluate(async () => {
    const report = {};
    const settle = () => new Promise(r => setTimeout(r, 280));   // the bar slides for 220ms; measuring mid-slide lies
    // How many clicks from home, and whether the bar has to be scrolled to see the target after them.
    const clicksTo = async (id, targetSelector, candidates) => {
      sidebarLab.cue('home');
      await settle();
      const host = sidebarLab.hostEl(id);
      let scrolled = false;
      for (let clicks = 1; clicks <= 4; clicks++) {
        let target = host.querySelector(targetSelector);
        if (window.__lab.reachable(target, host)) return { clicks, scrolled };
        if (target) {
          target.scrollIntoView({ block: 'nearest' });
          await new Promise(r => setTimeout(r, 60));
          if (window.__lab.reachable(target, host)) return { clicks, scrolled: true };
          scrolled = true;
        }
        let moved = false;
        for (const selector of candidates) {
          for (const el of host.querySelectorAll(selector)) {
            if (!el.disabled && window.__lab.reachable(el, host) && el.getAttribute('aria-expanded') !== 'true') { el.click(); moved = true; break; }
          }
          if (moved) break;
        }
        if (!moved) return { clicks: null, scrolled };
        await new Promise(r => setTimeout(r, 120));
      }
      return { clicks: null, scrolled };
    };
    for (const id of sidebarLab.options) {
      const row = {};
      row.clicksToSecondThread = await clicksTo(id, '[data-thread-project="battalion"][data-thread-id="t-left-bar"]',
        ['[data-lab-role="chat"]', '[data-project-id="battalion"]', '[data-lab-role="chooser"]']);
      row.clicksToOtherProjectThread = await clicksTo(id, '[data-thread-project="nibbi"][data-thread-id="home"]',
        ['[data-lab-role="chooser"]', '[data-project-id="nibbi"]', '[data-lab-role="chat"]']);
      // Where New thread sits in the focus order, counting from the bar's first control.
      sidebarLab.cue('home');
      await settle();
      const host = sidebarLab.hostEl(id);
      const focusable = () => [...host.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"], a[href]')].filter(el => window.__lab.visible(el));
      const order = focusable();
      const target = host.querySelector('[data-lab-role="new-thread"]');
      row.tabsToNewThread = target ? (order.indexOf(target) >= 0 ? order.indexOf(target) + 1 : null) : null;
      // Pinned selectors kept.
      sidebarLab.cue('card');
      await settle();
      const settings = host.querySelector('[data-lab-role="settings"]');
      if (settings) settings.click();
      await new Promise(r => setTimeout(r, 60));
      row.pinnedKept = window.__PINNED.filter(([, test]) => { try { return !!host.querySelector(test); } catch { return false; } }).map(([app]) => app);
      row.pinnedMissing = window.__PINNED.filter(([, test]) => { try { return !host.querySelector(test); } catch { return true; } }).map(([app]) => app);
      row.workspaceLeft = getComputedStyle(host).getPropertyValue('--workspace-left').trim();
      report[id] = row;
    }
    return report;
  });
  for (const [id, row] of Object.entries(measured)) Object.assign(results.measured[id] ||= {}, row);

  // New thread without scrolling, and conversations above the fold, at the sizes that decide it.
  for (const [vpId, width, height] of [['1180x820', 1180, 820], ['390x844', 390, 844]]) {
    const sizePage = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    collect(sizePage);
    await sizePage.goto(`${url}?scale=1&frame=${width}x${height}`);
    await sizePage.waitForFunction(() => window.sidebarLab?.ready, null, { timeout: 30000 });
    await sizePage.addScriptTag({ content: `(${HELPERS.toString()})()` });
    for (const [stateId, label] of [['home', '4'], ['many', '12']]) {
      await sizePage.evaluate(id => sidebarLab.cue(id), stateId);
      await sizePage.waitForTimeout(300);
      const row = await sizePage.evaluate(() => {
        const report = {};
        for (const id of sidebarLab.options) {
          const host = sidebarLab.hostEl(id);
          report[id] = {
            newThread: window.__lab.reachable(host.querySelector('[data-lab-role="new-thread"]'), host),
            threadsAboveFold: [...host.querySelectorAll('[data-thread-id]')].filter(el => window.__lab.reachable(el, host)).length,
          };
        }
        return report;
      });
      for (const [id, value] of Object.entries(row)) {
        const m = results.measured[id] ||= {};
        (m.newThreadWithoutScrolling ||= {})[`${vpId}/${label} projects`] = value.newThread;
        (m.conversationsAboveTheFold ||= {})[`${vpId}/${label} projects`] = value.threadsAboveFold;
      }
    }
    await sizePage.close();
  }

  // Scale: 60 projects.
  const scale = await page.evaluate(async () => {
    const report = {};
    for (const id of sidebarLab.options) {
      const inst = sidebarLab.instance(id);
      const module = await import(`./options/${id}.mjs`);
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;top:0;width:1180px;height:820px';
      document.body.append(host);
      const stress = (await import('./fixture.mjs')).stress(60);
      const t0 = performance.now();
      const probe = module.mount(host, { model: stress, state: 'home', viewport: { width: 1180, height: 820, narrow: false }, reduced: false, flags: {}, onAction: () => {} });
      const mountMs = Math.round(performance.now() - t0);
      const t1 = performance.now(); probe.setModel(stress); const setMs = Math.round(performance.now() - t1);
      probe.destroy();
      report[id] = { mountMs60: mountMs, setModelMs60: setMs, destroyClean: host.childElementCount === 0 };
      host.remove();
    }
    return report;
  });
  for (const [id, row] of Object.entries(scale)) Object.assign(results.measured[id] ||= {}, row);
  const slow = Object.entries(scale).filter(([, r]) => r.mountMs60 > 250);
  const dirty = Object.entries(scale).filter(([, r]) => !r.destroyClean);
  if (slow.length) fail('60 projects mount inside the budget', { detail: Object.fromEntries(slow) });
  else check('60 projects mount in under 250ms', Object.fromEntries(Object.entries(scale).map(([id, r]) => [id, r.mountMs60 + 'ms'])));
  if (dirty.length) fail('destroy() leaves the host empty', { detail: dirty.map(([id]) => id) });
  else check('destroy() leaves nothing behind');
  await page.close();

  // ---------- 3. Evidence ----------
  const shots = await browser.newPage({ viewport: { width: 1680, height: 1100 }, deviceScaleFactor: 1 });
  collect(shots);
  await shots.goto(url);
  await shots.waitForFunction(() => window.sidebarLab?.ready, null, { timeout: 30000 });
  await shots.waitForTimeout(400);
  await shots.screenshot({ path: out + 'lab-desktop.png', fullPage: true });
  for (const state of STATES) {
    await shots.evaluate(id => sidebarLab.cue(id), state.id);
    await shots.waitForTimeout(state.id === 'many' ? 200 : 120);
    const box = await shots.evaluate(() => { const r = document.getElementById('studies').getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y + scrollY), width: Math.min(r.width, innerWidth), height: Math.min(r.height, 1600) }; });
    await shots.screenshot({ path: `${out}state-${state.id}.png`, clip: box });
  }
  await shots.evaluate(() => { sidebarLab.cue('home'); sidebarLab.setFlags(Object.fromEntries(sidebarLab.flagIds.map(f => [f, true]))); });
  await shots.waitForTimeout(250);
  await shots.screenshot({ path: out + 'lab-improvements.png', fullPage: true });
  await shots.evaluate(() => { sidebarLab.setFlags({}); sidebarLab.setEnvironment({ glass: true, nativeMac: true }); });
  await shots.waitForTimeout(250);
  await shots.screenshot({ path: out + 'lab-glass.png', fullPage: true });
  await shots.close();
  const phoneShot = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  collect(phoneShot);
  await phoneShot.goto(url);
  await phoneShot.waitForFunction(() => window.sidebarLab?.ready, null, { timeout: 30000 });
  await phoneShot.waitForTimeout(400);
  const overflowPhone = await phoneShot.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflowPhone > 0) fail('the lab page itself fits a phone', { overflow: overflowPhone });
  else check('The lab page itself has no horizontal overflow at 420px');
  await phoneShot.screenshot({ path: out + 'lab-phone.png', fullPage: true });
  await phoneShot.close();

  if (results.errors.length) fail('no console or page errors', { errors: [...new Set(results.errors)].slice(0, 8) });
  else check('No console or page errors');
} catch (error) {
  results.failed = true;
  results.checks.push({ name: 'exception', failed: true, error: error.message, stack: (error.stack || '').split('\n').slice(0, 4).join('\n') });
  console.log('FAIL exception', error.message);
} finally {
  results.errors = [...new Set(results.errors)];
  results.pinnedCatalogue = PINNED.map(([app]) => app);
  await writeFile(out + 'browser-results.json', JSON.stringify(results, null, 2));
  await browser.close(); server.close();
  console.log(results.failed ? 'RESULT: FAILED' : 'RESULT: all browser checks passed');
  process.exitCode = results.failed ? 1 : 0;
}
