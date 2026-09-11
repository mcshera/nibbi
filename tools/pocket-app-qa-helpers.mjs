// Shared browser QA helpers. Input APIs are real Playwright/CDP input; diagnostics are read-only.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
export const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
export function sources(root) {
  const files=['public/app.js','public/index.html','public/lib/pocket-interactions.js','public/pocket-motion.js','public/nibbi.js','tools/pocket-verify.mjs','tools/pocket-app-extras.mjs','tools/pocket-app-qa-helpers.mjs','docs/POCKET-INTERACTIONS-IMPLEMENTATION.md'];
  function scan(dir) { if(existsSync(path.join(root,dir))) for(const e of readdirSync(path.join(root,dir),{withFileTypes:true})) e.isDirectory()?scan(path.join(dir,e.name)):files.push(path.join(dir,e.name)); }
  scan('dist/ui'); return Object.fromEntries(files.filter(f=>existsSync(path.join(root,f))).map(f=>[f,digest(path.join(root,f))]));
}
export function pin(root,before) { assert.deepEqual(sources(root),before,'source and built snapshot must not change during QA'); }
export async function instrument(page,fixture) {
  const network={mutations:[],passive:[],blocked:[]};
  await page.route('**/*',async route=>{
    const r=route.request(),u=new URL(r.url());
    if(!['http:','https:'].includes(u.protocol))return route.continue();
    if(u.origin!==new URL(fixture.base).origin){network.blocked.push({method:r.method(),url:r.url()});return route.abort();}
    if(!['GET','HEAD'].includes(r.method())){
      const entry={method:r.method(),path:u.pathname,body:r.postData()};
      if(r.method()==='POST'&&['/nibbi/state','/nibbi/client-log'].includes(u.pathname))network.passive.push(entry);
      else {network.mutations.push(entry);return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'QA blocks all agent/account/provider mutations'})});}
    }
    return route.continue();
  });
  await page.addInitScript(()=>{
    window.__qaInputs=[];
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel','keydown','keyup','input','focusin','drop','paste']) document.addEventListener(type,e=>{window.__qaInputs.push({type,at:performance.now(),eventTime:e.timeStamp,target:e.target?.id,x:e.clientX,y:e.clientY,pointer:e.pointerType,key:e.key,trusted:e.isTrusted});},true);
  });
  return network;
}
export async function boot(page,base,query='?nosw=1&demo=1') { await page.goto(base+'/'+query);await page.waitForFunction(()=>window.nibbiApp?.interactions&&window.nibbi?.state); }
export const state = page => page.evaluate(()=>({interaction:nibbiApp.interactions.state(),renderer:nibbi.state(),busy:nibbiApp.state().busy,mood:nibbi.mood(),mode:nibbiApp.state().mode,turns:nibbiApp.state().turns.length}));
export async function settle(page) { await page.mouse.move(8,8);await page.waitForTimeout(950);await page.waitForFunction(()=>!nibbi.state().motion?.action,null,{timeout:10000}); }
export async function point(page,nx=0,ny=0) { return page.evaluate(({nx,ny})=>{const s=nibbi.state(),b=s.geometry?.bodyBounds||s.bounds||{left:s.x-s.r,right:s.x+s.r,top:s.y-s.r,bottom:s.y+s.r};return {x:(b.left+b.right)/2+nx*(b.right-b.left)/2,y:(b.top+b.bottom)/2+ny*(b.bottom-b.top)/2,r:s.r};},{nx,ny}); }
export async function tap(page,nx=0,ny=0,touch=false) { const p=await point(page,nx,ny);if(touch)await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);return p; }
export async function action(page,id) { try {await page.waitForFunction(id=>nibbiApp.interactions.state().lastAction===id,id,{timeout:2500});}catch(e){throw new Error(`${id} was not accepted: ${JSON.stringify(await state(page))}`,{cause:e});}return state(page); }
export async function semantic(page,name) { await page.waitForFunction(name=>nibbiApp.interactions.state().lastEvent===name,name,{timeout:2500});return state(page); }
export async function noPanel(page) {
  assert.equal(await page.locator('#pocket-tricks,#st-tricks,[data-pocket-action],#pocket-energy,#pocket-stop').count(),0,'no animation shelf/chooser in real app');
  assert.equal(await page.evaluate(()=>Object.hasOwn(nibbiApp,'tricks')),false);
  assert.equal(await page.locator('#fx').getAttribute('tabindex'),'0','character supports keyboard focus');
  assert.equal(await page.locator('#fx').getAttribute('aria-hidden'),null,'character remains in accessibility tree');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#fx')).touchAction),'none');
  assert.notEqual(await page.evaluate(()=>getComputedStyle(document.body).touchAction),'none','touch-action restriction stays on canvas');
}
export async function drag(page,dx,dy,{slow=false,touch=false}={}) {
  const p=await point(page); const end={x:p.x+dx*p.r,y:p.y+dy*p.r};
  const before=(await state(page)).interaction.actionSequence;
  if(touch){const cdp=await page.context().newCDPSession(page);const start={type:'touchStart',touchPoints:[{x:p.x,y:p.y}]},move={type:'touchMove',touchPoints:[end]},release={type:'touchEnd',touchPoints:[]};if(slow){await cdp.send('Input.dispatchTouchEvent',start);await cdp.send('Input.dispatchTouchEvent',move);await page.waitForTimeout(400);await cdp.send('Input.dispatchTouchEvent',release);}else{/* Send ordered protocol input without paint/round-trip delays between flick events. */await Promise.all([start,move,release].map(event=>cdp.send('Input.dispatchTouchEvent',event)));}await cdp.detach();}
  else{await page.mouse.move(p.x,p.y);if(slow){await page.mouse.down();await page.mouse.move(end.x,end.y);await page.waitForTimeout(400);await page.mouse.up();}else{const cdp=await page.context().newCDPSession(page);await Promise.all([{type:'mousePressed',x:p.x,y:p.y,button:'left',buttons:1,clickCount:1},{type:'mouseMoved',...end,button:'left',buttons:1},{type:'mouseReleased',...end,button:'left',buttons:0,clickCount:1}].map(event=>cdp.send('Input.dispatchMouseEvent',event)));await cdp.detach();}}
  const after=await state(page);return {p,end,actions:after.interaction.history.filter(h=>h.sequence>before),after};
}
export async function evidence(page) {return {state:await state(page),inputs:await page.evaluate(()=>__qaInputs)};}
