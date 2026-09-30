// Automation works the up-next list (the owner's decision, 2026-09-29; docs/CONTROL-PANEL.md §12): suggest adds improvements marked
// nibbi suggested and builds nothing; stage and ship build the top of up next into main or the copy chosen on the card, up to capacity
// and the spend cap; ship into a copy never ships to main; a set /goal keeps the roadmap. Real git in temporary repositories.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const directory = mkdtempSync(join(tmpdir(), 'nibbi-automation-'));
process.env.NODE_ENV = 'test';
process.env.NIBBI_STATE_DIR = join(directory, 'state'); process.env.NIBBI_VAULT_DIR = join(directory, 'vault');
process.env.NIBBI_WORK_DIR = join(directory, 'work'); process.env.NIBBI_PROJECTS_DIR = join(directory, 'projects');
const vault = process.env.NIBBI_VAULT_DIR;
mkdirSync(join(vault, 'plans'), { recursive: true });
for (const [name, text] of Object.entries({ 'SOUL.md': 'fixture-soul', 'AGENTS.md': 'fixture-agents', 'MEMORY.md': 'fixture-memory', 'index.md': 'fixture-index' })) writeFileSync(join(vault, name), text);
const { git } = await import('../src/processes.js');
const { createProject, updateProject } = await import('../src/projects.js');
const fixer = await import('../src/fixer.js');
const copies = await import('../src/project-copies.js');
const records = await import('../src/copy-records.js');
const previews = await import('../src/previews.js');
const { replaceProviderForTest } = await import('../src/providers/index.js');
const { runtime, closeRuntime } = await import('../src/store.js');
const { closeToolService } = await import('../src/tool-service.js');
const { shutdownSessions } = await import('../src/session.js');
const { projectSection, projectCommand } = await import('../src/project-workspace.js');
const { automationCycle, setGoal, goals } = await import('../src/scheduler.js');
const { suggestionsFrom } = await import('../src/auto-queue.js');
type Fixer = import('../src/fixer.js').Fixer;
type CopyRecord = import('../src/copy-records.js').CopyRecord;

// The fixer writes "<file> <content…>" from its prompt's first line and says what it cost; the lead answers `leadReply` and is
// remembered, with the tools it was given. While `held` is set every fixer waits for its release (or its abort).
let held: Promise<void> | undefined, leadReply = 'nothing to add';
const leadTurns: Array<{ prompt: string; tools: string[] }> = [];
const restoreProvider = replaceProviderForTest('claude', { id: 'claude', capabilities: { streaming: true, steering: true, cancellation: true, skills: true, tools: true, images: true }, start: input => ({
  result: (async () => {
    if (input.role !== 'fixer') { leadTurns.push({ prompt: input.prompt, tools: input.tools.names }); return { text: leadReply, isError: false, costUsd: 0.01 }; }
    if (held) await Promise.race([held, new Promise(resolve => input.signal.addEventListener('abort', resolve, { once: true }))]);
    const [file, ...rest] = input.prompt.split('\n')[0].split(' ');
    writeFileSync(join(input.cwd, file), (rest.join(' ') || file) + '\n');
    return { text: 'wrote ' + file, isError: false, costUsd: 0.1 };
  })(),
  cancel: async () => undefined, steer: async () => undefined,
}) });
function hold(): () => void { let release!: () => void; held = new Promise<void>(resolve => { release = resolve; }); return () => { held = undefined; release(); }; }
after(async () => { restoreProvider(); await fixer.shutdownFixers(); await shutdownSessions(); await previews.stopPreviews(); await copies.stopCopyWork(); await closeToolService(); closeRuntime(); rmSync(directory, { recursive: true, force: true }); });

const notify = async (): Promise<void> => undefined;
const CHECK = 'test -f README.md';
const runsOf = (project: string): Fixer[] => fixer.listFixers().filter(run => run.game === project);
const run = (id: string): Fixer => runtime().get<Fixer>('fixers', id)!;
const copyOf = (id: string): CopyRecord => records.copyById(id)!;
const sha = (repo: string, ref: string): Promise<string> => git(repo, 'rev-parse', '--verify', ref);
async function project(name: string): Promise<string> { const { repo } = await createProject(name); updateProject(name, { check: CHECK }); return repo; }
async function act(project: string, action: string, args: Record<string, unknown> = {}) {
  const result = await projectCommand({ project, action, expectedRevision: projectSection(project, 'issues').revision, idempotencyKey: randomUUID(), ...args });
  if (!result.ok) throw new Error(result.error.message);
  return result;
}
const upNext = async (project: string, title: string): Promise<string> => (await act(project, 'issue.create', { title })).itemId!;
const itemsOf = (project: string): Array<Record<string, any>> => projectSection(project, 'issues').items;
/** Every try of these improvements has finished, landing included. */
async function settle(project: string): Promise<void> { for (const f of runsOf(project)) { await fixer.waitForFixer(f.id); await fixer.landOnCopy(f.id); } }

test('stage builds the top of up next, in issues.md order, and nothing past capacity', async () => {
  await project('stage');
  const first = await upNext('stage', 'a.txt first'), second = await upNext('stage', 'b.txt second');
  fixer.setAuto('stage', { mode: 'stage', maxConcurrent: 1 });
  const release = hold();
  try {
    await automationCycle(notify);
    assert.deepEqual(runsOf('stage').map(f => f.issueIds), [[first]], 'the top one, and only one: capacity is one');
    assert.equal(fixer.autoConfig().stage.note, 'building “a.txt first” from up next, into main');
    await automationCycle(notify);
    assert.equal(runsOf('stage').length, 1, 'still building: no second one past capacity');
  } finally { release(); }
  await settle('stage');
  assert.equal(runsOf('stage')[0].status, 'staged', 'stage stops at review');
  await automationCycle(notify);
  assert.deepEqual(runsOf('stage').map(f => f.issueIds![0]).sort(), [first, second].sort(), 'room again: the next one');
  await settle('stage');
  await automationCycle(notify);
  assert.equal(runsOf('stage').length, 2, 'both are in review: nothing is up next');
  // Discarded, the first is up next again — but automation already tried it this time round, so it waits for you.
  fixer.discardFixer(runsOf('stage').find(f => f.issueIds![0] === first)!.id);
  await automationCycle(notify);
  assert.equal(runsOf('stage').length, 2, 'a try you discarded is not started again by itself');
  assert.equal(runsOf('stage').filter(f => f.status === 'merged').length, 0, 'stage never merges');
  fixer.setAuto('stage', { mode: 'off' });
});

test('the spend cap stops it before it builds', async () => {
  await project('capped');
  const item = await upNext('capped', 'c.txt capped');
  fixer.setAuto('capped', { mode: 'stage', spendCap: 0.05 });
  const earlier = fixer.spawnFixer('capped', 'spent.txt a try you started', notify); await fixer.waitForFixer(earlier.id);
  assert.equal(run(earlier.id).costUsd, 0.1);
  await automationCycle(notify);
  const cfg = fixer.autoConfig().capped;
  assert.equal(cfg.mode, 'off'); assert.match(cfg.note!, /Spend cap reached/);
  assert.equal(runsOf('capped').filter(f => f.issueIds?.includes(item)).length, 0, 'nothing was built past the cap');
});

test('suggest puts its suggestions up next, marked nibbi suggested, and builds nothing', async () => {
  await project('ideas');
  await upNext('ideas', 'Existing thing');
  leadReply = 'Here are three:\n- a.txt make the title bigger\n- **b.txt** add a sound\n- existing thing\n1. c.txt a third one\n- d.txt one too many';
  fixer.setAuto('ideas', { mode: 'suggest' });
  const before = leadTurns.length;
  await automationCycle(notify);
  assert.equal(leadTurns.length, before + 1, 'the lead was asked once');
  const asked = leadTurns.at(-1)!;
  assert.match(asked.prompt, /Existing thing/, 'it is told what is already listed');
  assert.ok(!asked.tools.includes('dispatch_fixer'), 'suggest never has dispatch: ' + asked.tools.join(', '));
  const items = itemsOf('ideas');
  assert.deepEqual(items.map(item => [item.text, item.suggested]), [
    ['Existing thing', false], ['a.txt make the title bigger', true], ['b.txt add a sound', true], ['c.txt a third one', true],
  ], 'three, cleaned, none a repeat, in the order said');
  assert.equal(items.every(item => !item.done), true);
  assert.equal(fixer.autoConfig().ideas.note, 'nibbi suggested 3 — they’re up next, for you to build or mark done');
  assert.equal(runsOf('ideas').length, 0, 'suggest builds nothing');
  // While they wait for you, it doesn't ask again; once you've answered them all, it does.
  await automationCycle(notify);
  assert.equal(leadTurns.length, before + 1, 'no new suggestions while the last ones are up next');
  for (const item of items.filter(item => item.suggested)) await act('ideas', 'issue.complete', { id: item.id });
  leadReply = '- a.txt make the title bigger\n- existing thing';
  await automationCycle(notify);
  assert.equal(leadTurns.length, before + 2, 'asked again once you marked them done');
  assert.equal(itemsOf('ideas').length, 4, 'what you marked done is not suggested again');
  assert.equal(runsOf('ideas').length, 0);
  fixer.setAuto('ideas', { mode: 'off' }); leadReply = 'nothing to add';
});

test('stage and ship leave nibbi’s suggestions for you: they build what you put up next, and none of what nibbi suggested', async () => {
  const repo = await project('yours');
  leadReply = '- s1.txt nibbi idea one\n- s2.txt nibbi idea two';
  fixer.setAuto('yours', { mode: 'suggest' });
  await automationCycle(notify);
  const suggested = itemsOf('yours').filter(item => item.suggested).map(item => item.id);
  assert.equal(suggested.length, 2, 'suggest put two up next');
  const mine = await upNext('yours', 'o.txt yours');
  fixer.setAuto('yours', { mode: 'stage' });
  await automationCycle(notify); await settle('yours');
  assert.deepEqual(runsOf('yours').map(f => f.issueIds), [[mine]], 'yours, below them in the list, and neither of nibbi’s');
  // ship into main merges what it builds: still none of nibbi's, however many passes
  fixer.setAuto('yours', { mode: 'ship' });
  for (let pass = 0; pass < 2; pass++) { await automationCycle(notify); await settle('yours'); }
  assert.equal(runsOf('yours').filter(f => f.issueIds?.some(id => suggested.includes(id))).length, 0, 'nibbi’s suggestions are never built by themselves');
  for (const id of suggested) assert.equal(itemsOf('yours').find(item => item.id === id)!.done, false, 'nor marked done');
  assert.equal(existsSync(join(repo, 's1.txt')) || existsSync(join(repo, 's2.txt')), false, 'nor merged into main');
  // build it now is yours to press: then it builds
  await act('yours', 'issue.build', { id: suggested[0] });
  assert.equal(runsOf('yours').filter(f => f.issueIds?.includes(suggested[0])).length, 1);
  await settle('yours');
  fixer.setAuto('yours', { mode: 'off' }); leadReply = 'nothing to add';
});

test('a suggestion list is its "- " lines, one short line each, none already listed', () => {
  assert.deepEqual(suggestionsFrom('intro\n- one\n* two\n• three\n2) four', [], 5), ['one', 'two', 'three', 'four']);
  assert.deepEqual(suggestionsFrom('- `code` and __bold__\n- <!-- nibbi-issue:x --> sneaky\n- ONE', ['one']), ['code and bold', 'sneaky']);
  assert.deepEqual(suggestionsFrom('no list here at all', []), []);
  assert.equal(suggestionsFrom('- ' + 'x'.repeat(400), [])[0].length, 200);
});

test('ship into a copy lands in the copy and never ships to main; a retired copy falls back to main', async () => {
  const repo = await project('shipdev');
  const view = await copies.createCopy('shipdev', 'dev'); await copies.waitForCopy(view.id);
  const dev = copyOf(view.id); assert.equal(dev.status, 'ready');
  // The target is one of this project's live copies, or main.
  assert.throws(() => fixer.setAuto('shipdev', { copyId: 'copy-' + randomUUID() }), /that build is gone/);
  // An owner's own try on main, staged and verified: ship into a copy must not merge it.
  const own = fixer.spawnFixer('shipdev', 'm.txt yours, on main', notify); await fixer.waitForFixer(own.id);
  assert.equal(run(own.id).status, 'staged'); assert.equal(run(own.id).verification?.status, 'passed');
  const item = await upNext('shipdev', 's.txt into dev');
  const main = await sha(repo, 'refs/heads/main');
  fixer.setAuto('shipdev', { mode: 'ship', copyId: dev.id });
  assert.equal(fixer.autoConfig().shipdev.copyId, dev.id);
  await automationCycle(notify); await settle('shipdev');
  const built = runsOf('shipdev').find(f => f.issueIds?.includes(item))!;
  assert.equal(built.copyId, dev.id, 'built into dev'); assert.equal(run(built.id).status, 'merged', 'landed in dev');
  assert.notEqual(copyOf(dev.id).headSha, dev.headSha, 'dev moved');
  assert.ok(existsSync(join(dev.worktree, 's.txt')));
  assert.equal(await sha(repo, 'refs/heads/main'), main, 'main is where it was'); assert.equal(existsSync(join(repo, 's.txt')), false);
  assert.equal(copyOf(dev.id).ships.length, 0, 'no ship to main'); assert.equal(run(own.id).status, 'staged', 'your try on main is not merged');
  assert.equal(itemsOf('shipdev').find(i => i.id === item)!.done, false, 'done only when dev ships');
  await automationCycle(notify); await settle('shipdev');
  assert.equal(await sha(repo, 'refs/heads/main'), main, 'a second pass still ships nothing'); assert.equal(runsOf('shipdev').length, 2, 'and builds nothing new: it is in dev');
  // Retired, dev can't be built into: automation builds into main now, in stage (ship into a copy never merged main), and says so.
  await copies.retireCopy('shipdev', dev.id, copyOf(dev.id).headSha);
  const cfg = fixer.autoConfig().shipdev;
  assert.deepEqual([cfg.copyId, cfg.mode], [undefined, 'stage']);
  assert.equal(cfg.note, 'dev was retired, so automation builds into main now — in stage, so each one waits for you to merge it');
  fixer.setAuto('shipdev', { mode: 'off' });
});

test('ship into main keeps today’s merge', async () => {
  const repo = await project('shipmain');
  const item = await upNext('shipmain', 'k.txt straight to main');
  fixer.setAuto('shipmain', { mode: 'ship' });
  await automationCycle(notify); await settle('shipmain');
  const built = runsOf('shipmain')[0];
  assert.deepEqual([built.issueIds, built.copyId, run(built.id).status], [[item], undefined, 'staged']);
  await automationCycle(notify);
  assert.equal(run(built.id).status, 'merged', 'ship merged it into main'); assert.ok(existsSync(join(repo, 'k.txt')));
  assert.equal(itemsOf('shipmain').find(i => i.id === item)!.done, true);
  fixer.setAuto('shipmain', { mode: 'off' });
});

test('a set goal keeps the roadmap, as before', async () => {
  await project('goal');
  writeFileSync(join(vault, 'plans', 'goal.md'), '# Goal\n\n## M1 <!-- nibbi-milestone:m1 -->\n- [ ] Boot screen <!-- nibbi-task:t1 -->\n');
  const item = await upNext('goal', 'g.txt up next');
  setGoal('goal', { text: 'finish M1', focus: 'M1', mode: 'stage' });
  const before = leadTurns.length;
  await automationCycle(notify);
  assert.equal(leadTurns.length, before + 1);
  const turn = leadTurns.at(-1)!;
  assert.match(turn.prompt, /^Project goal\. Read its roadmap\. Focus: M1\. Capacity: 2\./);
  assert.ok(turn.tools.includes('dispatch_fixer'), 'the goal\'s lead can dispatch, as before');
  assert.equal(runsOf('goal').length, 0, 'up next is not built while a goal is set');
  // The roadmap done, the goal is complete and automation stops, as before; turned on again, it picks up up next.
  writeFileSync(join(vault, 'plans', 'goal.md'), '# Goal\n\n## M1 <!-- nibbi-milestone:m1 -->\n- [x] Boot screen <!-- nibbi-task:t1 -->\n');
  await automationCycle(notify);
  assert.deepEqual([fixer.autoConfig().goal.mode, fixer.autoConfig().goal.note, goals().goal.done], ['off', 'Roadmap complete', true]);
  fixer.setAuto('goal', { mode: 'stage' });
  await automationCycle(notify); await settle('goal');
  assert.deepEqual(runsOf('goal').map(f => f.issueIds), [[item]]);
  fixer.setAuto('goal', { mode: 'off' });
});
