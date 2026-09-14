import { webkit } from '/Users/Matty/Documents/Nibbi/node_modules/playwright/index.mjs';
import { readFile } from 'node:fs/promises';
const root = '/private/tmp/nibbi-iconrow';
const b = await webkit.launch();
let bad = 0;
for (const [w,h] of [[1440,900],[1180,820],[390,844],[320,568]]) {
  const p = await b.newPage({ viewport:{width:w,height:h} });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.setContent('<style>:root{--ease:cubic-bezier(.2,.7,.2,1);--ink:#151413;--ink-2:#3a3835;--ink-3:#6f6b65;--ink-4:#8a857c}*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:#f5f2ec;font:16px/1.5 system-ui}</style><nav id="project-rail"></nav><nav id="settings-rail"></nav>');
  await p.addStyleTag({ content: await readFile(root+'/public/margins.css','utf8') });
  const mod = 'data:text/javascript;base64,'+Buffer.from(await readFile(root+'/public/lib/margin-ui.js')).toString('base64');
  await p.evaluate(async url => {
    const { installMarginUI } = await import(url);
    window.ui = installMarginUI({ onAction: () => {} });
    const th=(id,t,h)=>({id,title:t,lastAt:new Date(Date.now()-h*3600e3).toISOString(),active:id==='home'});
    const sec=(b,t='quiet',d='')=>({badge:b,tone:t,detail:d,accessible:b});
    ui.update({activeProject:'a',projectsLoaded:true,progress:{available:true,today:{deliveries:1}},settings:{},projects:[
      {id:'a',name:'battalion',branch:'v2',mode:'stage',done:5,total:9,threads:[th('home','Home',3),th('t','make the left bar less silly',1)],sections:{builds:sec('71 need attention','error','3 running'),issues:sec('No issues'),plans:sec('5/9 tasks')}},
      {id:'b',name:'nibbi',branch:'v2',mode:'ship',threads:[th('home','Home',5)],sections:{builds:sec('2 review','attention'),issues:sec('3 open'),plans:sec('Complete')}}]});
  }, mod);
  await p.waitForTimeout(350);
  // Below 900px the bar starts closed, the way the app opens on a phone. Open it before measuring.
  await p.evaluate(() => { if (document.querySelector('#workspace-sidebar').getAttribute('aria-hidden') === 'true') document.querySelector('#sidebar-toggle').click(); });
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const t = document.querySelector('.margin-switch-trigger');
    const tabs = [...document.querySelectorAll('.margin-tab')];
    const bar = document.querySelector('#workspace-sidebar');
    return { tabs: tabs.length, current: document.querySelector('.margin-tab.is-current')?.textContent.trim(),
      overflowX: bar.scrollWidth - bar.clientWidth,
      minTab: Math.min(...tabs.map(el => Math.round(el.getBoundingClientRect().height))),
      triggerH: Math.round(t.getBoundingClientRect().height) };
  });
  // open the dropdown and check it lands inside the bar
  await p.evaluate(() => document.querySelector('.margin-switch-trigger').click());
  await p.waitForTimeout(250);
  const menu = await p.evaluate(() => {
    const m = document.querySelector('.margin-switch-menu'), bar = document.querySelector('#workspace-sidebar');
    const mr = m.getBoundingClientRect(), br = bar.getBoundingClientRect();
    return { visible: !m.hidden, insideBar: mr.left >= br.left - 1 && mr.right <= br.right + 1, rows: m.querySelectorAll('[data-project-id]').length };
  });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  const closed = await p.evaluate(() => document.querySelector('.margin-switch-menu').hidden && document.querySelector('#workspace-sidebar').getAttribute('aria-hidden') === 'false');
  const okMin = w <= 899 ? r.minTab >= 44 : r.minTab >= 32;
  const pass = r.tabs===4 && r.overflowX<=1 && okMin && menu.visible && menu.insideBar && menu.rows===2 && closed && !errs.length;
  if (!pass) bad++;
  console.log(`${pass?'PASS':'FAIL'} webkit ${w}x${h}`, JSON.stringify({...r, ...menu, escapeClosedMenuNotBar: closed, errs: errs.slice(0,2)}));
  await p.close();
}
await b.close();
process.exitCode = bad ? 1 : 0;
