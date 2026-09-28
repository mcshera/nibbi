// The project frame (public/lib/project-workspace.js), phase 1: Repository & GitHub in its own head
// and body, and the page host the control panel's pages draw into. The Builds lobby, the Issues board
// and Plans left the UI (docs/CONTROL-PANEL.md §2.3); what their tests proved about the Log, the diff
// card, play and focus under live updates is carried by tests/project-pages-ui.test.mjs.
//
//   CI=1 node --test tests/project-workspace-ui.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('public');
const repository = { project: 'paper-garden', connection: null, binding: null, repository: null, warnings: [] };

async function harness(browser, viewport) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://workspace.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/project-workspace.css"><style>:root{--feed-top:30px;--feed-bottom:30px;--workspace-left:0px}body{background:var(--paper);font:14px Arial}*{box-sizing:border-box}[hidden]{display:none!important}</style></head><body></body></html>' });
    try { return route.fulfill({ contentType: extname(path) === '.css' ? 'text/css' : 'text/javascript', body: readFileSync(resolve(root, '.' + path)) }); } catch { return route.fulfill({ status: 404 }); }
  });
  await page.goto('https://workspace.test/');
  await page.evaluate(async data => {
    window.calls = []; window.closes = 0;
    const { installProjectWorkspace } = await import('/lib/project-workspace.js');
    window.workspace = installProjectWorkspace({
      renderDiff: d => { const pre = document.createElement('pre'); pre.className = 'diffv'; pre.textContent = d.diff; return pre; },
      onClose: () => { window.closes++; },
      onAction: async (name, project, value) => { calls.push({ name, project, kind: value?.kind }); if (name === 'githubRead') return structuredClone({ ...data, project }); return { ok: true }; },
    });
  }, repository);
  return { page, context, errors };
}

test('the frame opens Repository & GitHub, leaves by × and Escape, and gives the page host the whole frame', async () => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
  try {
    for (const viewport of [{ width: 1180, height: 820 }, { width: 390, height: 844 }]) {
      const { page, context, errors } = await harness(browser, viewport);
      try {
        await page.evaluate(() => workspace.open({ project: 'paper-garden', section: 'repository' }));
        await page.waitForFunction(() => document.querySelector('#project-workspace').getAttribute('aria-busy') === 'false');
        const open = await page.evaluate(() => {
          const el = document.querySelector('#project-workspace');
          return { hidden: el.hidden, title: document.querySelector('#project-workspace-title').textContent, labelledBy: el.getAttribute('aria-labelledby'),
            focused: document.activeElement?.id, panel: !!el.querySelector('.project-workspace-body .github-panel'), host: el.querySelector('.cp-page-host').hidden,
            first: el.firstElementChild.className, snapshot: workspace.snapshot(), reads: calls.filter(c => c.name === 'githubRead').map(c => [c.project, c.kind]) };
        });
        assert.equal(open.hidden, false);
        assert.equal(open.title, 'Repository & GitHub');
        assert.equal(open.labelledBy, 'project-workspace-title');
        assert.equal(open.focused, 'project-workspace-title', 'the heading takes focus, as sections did');
        assert.equal(open.panel, true, 'the project’s GitHub panel is the body');
        assert.equal(open.host, true, 'the page host is hidden while the repository shows');
        assert.equal(open.first, 'cp-page-host', 'the host comes first, so the first .project-close is always the one on screen');
        assert.deepEqual(open.reads, [['paper-garden', 'project']]);
        assert.deepEqual(open.snapshot, { project: 'paper-garden', page: 'repository', id: null, section: 'repository', hasDraft: false });

        await page.locator('#project-workspace .project-close:visible').click();
        assert.equal(await page.evaluate(() => closes), 1, '× asks the app to go back to the chat');
        await page.locator('#project-workspace .project-workspace-body').focus();
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => closes), 2, 'Escape from inside the frame does too');
        // Something inside that takes Escape for itself (a page's open confirm) keeps it.
        await page.evaluate(() => { const b = document.querySelector('.project-workspace-body'); b.addEventListener('keydown', e => { if (e.key === 'Escape') e.preventDefault(); }, { once: true }); });
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => closes), 2, 'an Escape already taken is left alone');

        // A notice is information; only data-kind="error" is a verdict.
        const notice = await page.evaluate(() => {
          const probe = name => { const el = document.createElement('span'); el.style.color = `var(${name})`; document.body.append(el); const colour = getComputedStyle(el).color; el.remove(); return colour; };
          const n = document.querySelector('.project-workspace-body > .project-notice'); n.hidden = false; n.textContent = 'Saved.';
          const plain = getComputedStyle(n).color; n.dataset.kind = 'error'; const error = getComputedStyle(n).color; n.hidden = true; delete n.dataset.kind;
          return { plain, error, ink: probe('--ink-2'), fail: probe('--fail-text') };
        });
        assert.equal(notice.plain, notice.ink, 'a notice without a kind is ink');
        assert.equal(notice.error, notice.fail);

        // The pages: the host shows, the repository head and body hide, and nothing of them is announced.
        const paged = await page.evaluate(() => {
          workspace.showPage(true);
          const el = document.querySelector('#project-workspace'), host = workspace.pageHost;
          host.innerHTML = '<div class="cp-page"><header class="project-workspace-head"><h1 tabindex="-1">main</h1><button type="button" class="project-close">×</button></header></div>';
          const visible = [...el.querySelectorAll('.project-close')].filter(b => b.getClientRects().length).length;
          return { hidden: el.hidden, host: host.hidden, head: el.querySelector(':scope > .project-workspace-head').hidden, body: el.querySelector(':scope > .project-workspace-body').hidden,
            labelledBy: el.getAttribute('aria-labelledby'), busy: el.getAttribute('aria-busy'), visible, first: el.querySelector('.project-close').closest('.cp-page-host') === host, snapshot: workspace.snapshot(),
            width: document.documentElement.scrollWidth <= innerWidth };
        });
        assert.deepEqual(paged, { hidden: false, host: false, head: true, body: true, labelledBy: null, busy: 'false', visible: 1, first: true, snapshot: null, width: true });
        await page.evaluate(() => workspace.close());
        assert.deepEqual(await page.evaluate(() => [document.querySelector('#project-workspace').hidden, workspace.pageHost.hidden]), [true, true]);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
});
