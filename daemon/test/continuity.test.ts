import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { RuntimeStore } from '../src/store.js';
import { continuitySnapshot, continuityTools, CONTINUITY_LIMITS } from '../src/continuity.js';

type Seed = { project?: string | null; at?: string; role?: string; channel?: string; text?: string; metadata?: unknown };
type Page = Omit<ReturnType<typeof continuitySnapshot>, 'previousUser'>;
const NOW = new Date('2026-09-07T12:00:00.000Z');
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'nibbi-continuity-'));
  const store = new RuntimeStore(directory);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const insert = store.db.prepare('INSERT INTO messages(at,project_id,role,channel,text,metadata) VALUES(?,?,?,?,?,?)');
  const add = (seed: Seed = {}): number => Number(insert.run(seed.at ?? '2026-09-07T11:00:00.000Z', seed.project ?? null,
    seed.role ?? 'user', seed.channel ?? 'app', seed.text ?? 'Hello from the owner',
    typeof seed.metadata === 'string' ? seed.metadata : JSON.stringify(seed.metadata ?? {})).lastInsertRowid);
  const snapshot = (project?: string, maxMessages?: number) => continuitySnapshot(project, { now: NOW, maxMessages }, store);
  const call = async (name: 'recent_chat' | 'search_chat', args: Record<string, unknown> = {}, project?: string): Promise<Page> =>
    await continuityTools(project, store).find(tool => tool.name === name)!.call(args, new AbortController().signal) as Page;
  return { directory, store, add, snapshot, call };
}

test('project and vault scope are exact for snapshot, recent and search; no metadata/record leakage', async t => {
  const f = fixture(t);
  const vaultNull = f.add({ text: 'shared-token vault null' });
  const vaultLiteral = f.add({ project: 'vault', text: 'shared-token vault literal' });
  const alpha = f.add({ project: 'alpha', text: 'shared-token alpha', metadata: { costUsd: 9, credential: 'NEVER-RETURN-META' } });
  f.add({ project: 'alphabet', text: 'shared-token unrelated alphabet' });
  f.add({ project: 'beta', text: 'shared-token private beta' });
  f.store.put('hostconfig', 'credentials', { token: 'NEVER-READ-HOSTCONFIG' });
  for (const project of [undefined, 'vault']) {
    assert.deepEqual(f.snapshot(project).messages.map(message => message.id), [vaultLiteral, vaultNull]);
    assert.equal(f.snapshot(project).previousUser?.id, vaultLiteral);
    assert.deepEqual((await f.call('recent_chat', {}, project)).messages.map(message => message.id), [vaultLiteral, vaultNull]);
    assert.deepEqual((await f.call('search_chat', { query: 'shared-token' }, project)).messages.map(message => message.id), [vaultLiteral, vaultNull]);
  }
  assert.deepEqual(f.snapshot('alpha').scope, { kind: 'project', projectId: 'alpha' });
  const recent = await f.call('recent_chat', {}, 'alpha');
  assert.deepEqual(recent.messages.map(message => message.id), [alpha]);
  assert.deepEqual((await f.call('search_chat', { query: 'shared-token' }, 'alpha')).messages.map(message => message.id), [alpha]);
  const serialized = JSON.stringify(recent);
  for (const forbidden of ['private beta', 'alphabet', 'NEVER-RETURN-META', 'NEVER-READ-HOSTCONFIG', f.directory, 'runtime.sqlite']) assert.ok(!serialized.includes(forbidden));
  assert.equal(f.snapshot('missing').previousUser, null);
  assert.equal((await f.call('recent_chat', {}, 'missing')).outcome, 'no_match');
});

test('only visible human channels/roles survive; goal messages are not mistaken for automation', async t => {
  const f = fixture(t);
  const human: number[] = [];
  for (const channel of ['app', 'cli', 'telegram', 'goal']) {
    human.push(f.add({ channel, text: 'My goal is to test the watchdog implementation.' }));
    human.push(f.add({ role: 'oracle', channel, text: 'Human-visible reply.' }));
  }
  for (const channel of ['auto', 'cron', 'heartbeat', 'system', 'test', 'background', 'unknown', 'app-test']) {
    f.add({ channel, text: 'HIDDEN background' });
    f.add({ channel, role: 'oracle', text: 'HIDDEN background reply' });
  }
  for (const role of ['system', 'tool', 'developer', 'function']) f.add({ role, text: 'HIDDEN nonchat role' });
  const page = await f.call('recent_chat', { limit: 20 });
  assert.deepEqual(page.messages.map(message => message.id), human.reverse());
  assert.equal(page.messages[0].role, 'assistant');
  assert.equal(page.messages[0].channel, 'goal');
  assert.equal(f.snapshot().previousUser?.id, human[1]);
  assert.ok(!JSON.stringify(page).includes('HIDDEN'));
});

test('machine-marked legacy installation/watchdog/test turns and their replies are excluded without hiding human discussion', async t => {
  const f = fixture(t);
  const human = f.add({ text: 'Can we check the installation? My goal is to fix tests and the watchdog.' });
  const reply = f.add({ role: 'assistant', text: 'A normal reply.' });
  for (const text of ['[INSTALLATION CHECK 1/2 — synthetic test, not personal facts.] Hello.',
    '[INSTALLATION CHECK 2/2 — synthetic test, not personal facts.] Bye.', '[HOST WATCHDOG] resume the standing goal',
    '[NIBBI WATCHDOG] resume', '[WATCHDOG] continue', '\t\n [NIBBI WATCHDOG] continue', '[SYNTHETIC TEST] hello',
    '[SMOKE TEST] hello', 'SUPPLIED SYNTHETIC FIXTURE FACTS (not real personal data): hello']) {
    f.add({ text });
    f.add({ role: 'oracle', text: 'HIDDEN synthetic reply with no marker' });
  }
  assert.deepEqual((await f.call('recent_chat')).messages.map(message => message.id), [reply, human]);
  assert.equal(f.snapshot().previousUser?.id, human);
  assert.equal((await f.call('search_chat', { query: 'HIDDEN' })).outcome, 'no_match');
});

test('hidden metadata fails closed and suppresses the associated assistant; cross-project/channel users cannot associate replies', async t => {
  const f = fixture(t);
  const human = f.add({ project: 'alpha' });
  const flags: unknown[] = [{ hidden: true }, { visible: false }, { humanVisible: false }, { automated: true },
    { background: true }, { synthetic: true }, { test: true }, { isTest: true }, { source: 'test' },
    { source: 'watchdog' }, '{bad json', '[]', 'null', JSON.stringify({ big: 'x'.repeat(5000) })];
  for (const metadata of flags) {
    f.add({ project: 'alpha', metadata, text: 'HIDDEN user' });
    f.add({ project: 'alpha', role: 'oracle', text: 'HIDDEN associated reply' });
  }
  f.add({ project: 'beta' });
  f.add({ project: 'alpha', role: 'oracle', text: 'HIDDEN alpha reply after beta human' });
  f.add({ project: 'alpha', channel: 'telegram', role: 'oracle', text: 'HIDDEN orphan telegram reply' });
  const nextHuman = f.add({ project: 'alpha', text: 'Back to the real conversation.' });
  const nextReply = f.add({ project: 'alpha', role: 'oracle', text: 'Real reply' });
  const page = await f.call('recent_chat', {}, 'alpha');
  assert.deepEqual(page.messages.map(message => message.id), [nextReply, nextHuman, human]);
  assert.ok(!JSON.stringify(page).includes('HIDDEN'));
  const v = fixture(t);
  v.add({ text: '[INSTALLATION CHECK 1/2 — synthetic test] hello' });
  v.add({ project: 'vault', role: 'oracle', text: 'HIDDEN reply spanning NULL/literal vault' });
  assert.deepEqual((await v.call('recent_chat')).messages, []);
});

test('previous human contact is captured before the new write; assistant, background, and other projects do not move it', t => {
  const f = fixture(t);
  const id = f.add({ project: 'alpha', at: '2026-09-07T10:30:00.000Z' });
  f.add({ project: 'alpha', role: 'oracle', at: '2026-09-07T11:40:00.000Z' });
  f.add({ project: 'alpha', channel: 'cron', at: '2026-09-07T11:59:59.000Z' });
  f.add({ project: 'beta', at: '2026-09-07T11:59:59.999Z' });
  const before = f.snapshot('alpha');
  assert.deepEqual(before.previousUser, { id, at: '2026-09-07T10:30:00.000Z', timestampStatus: 'valid', channel: 'app', elapsedMs: 5400000, elapsedText: '1 hour, 30 minutes since the previous human message, measured at observedAt (not a visit interval).' });
  assert.equal(before.observedAt, NOW.toISOString());
  assert.equal(before.timezone, 'UTC');
  const current = f.add({ project: 'alpha', at: NOW.toISOString() });
  assert.equal(before.previousUser?.id, id);
  assert.equal(f.snapshot('alpha').previousUser?.id, current);
  assert.equal(f.snapshot('alpha').previousUser?.elapsedMs, 0);
  assert.equal(f.snapshot('alpha', 0).messages.length, 0);
  assert.equal(f.snapshot('alpha', 0).previousUser?.id, current);
  assert.equal(f.snapshot('alpha', 0).messagesOmitted, true);
  assert.equal(f.snapshot('alpha', 0).hasMore, false);
  assert.equal(f.snapshot('alpha', 0).pagination.nextBeforeId, null);
  assert.equal(f.snapshot('alpha', 0).scanned, 0);
  assert.equal(f.snapshot('alpha', 0).partial, true);
  assert.equal(f.snapshot('alpha', 0).outcome, 'partial');
});

test('missing, malformed, normalized-invalid, future, and timezone-offset timestamps are explicit', t => {
  const f = fixture(t);
  assert.equal(f.snapshot().previousUser, null);
  assert.equal(f.snapshot().outcome, 'no_match');
  for (const at of ['', 'not a date', '2026-09-07', '2026-02-31T12:00:00Z', '2026-09-07T24:00:00Z', '2026-09-07T11:00:00Z\u0000hidden', 'secret'.repeat(10000)]) {
    const id = f.add({ at });
    const snapshot = f.snapshot();
    assert.equal(snapshot.previousUser?.id, id);
    assert.equal(snapshot.previousUser?.at, null);
    assert.equal(snapshot.previousUser?.timestampStatus, 'invalid');
    assert.equal(snapshot.previousUser?.elapsedMs, null);
    assert.equal(snapshot.messages[0].at, null);
  }
  f.add({ at: '2026-09-08T12:00:00.000Z' });
  assert.equal(f.snapshot().previousUser?.timestampStatus, 'future');
  assert.equal(f.snapshot().previousUser?.elapsedMs, null);
  assert.equal(f.snapshot().messages[0].timestampStatus, 'future');
  f.add({ at: '2026-09-07T06:00:00-04:00' });
  assert.equal(f.snapshot().previousUser?.at, '2026-09-07T10:00:00.000Z');
  assert.equal(f.snapshot().previousUser?.elapsedMs, 7200000);
  assert.throws(() => continuitySnapshot(undefined, { now: new Date('invalid') }, f.store));
});

test('newest uses ID ordering with timestamp ties/backdating; append-stable beforeId/cutoffId pagination', async t => {
  const f = fixture(t);
  const ids = [f.add(), f.add(), f.add({ at: '2026-01-01T00:00:00Z' }), f.add()];
  const first = await f.call('recent_chat', { limit: 2 });
  assert.deepEqual(first.messages.map(message => message.id), [ids[3], ids[2]]);
  assert.equal(first.pagination.cutoffId, ids[3]);
  assert.equal(first.pagination.nextBeforeId, ids[2]);
  assert.equal(first.hasMore, true);
  assert.equal(first.partial, true);
  f.add({ at: '2025-01-01T00:00:00Z', text: 'Newly appended backdated message' });
  f.add({ project: 'other', text: 'Unrelated' });
  const second = await f.call('recent_chat', { limit: 2, cutoffId: first.pagination.cutoffId, beforeId: first.pagination.nextBeforeId });
  assert.deepEqual(second.messages.map(message => message.id), [ids[1], ids[0]]);
  assert.equal(second.hasMore, false);
  assert.equal(second.pagination.nextBeforeId, null);
  assert.equal(second.partial, false);
  assert.deepEqual((await f.call('recent_chat', { cutoffId: first.pagination.cutoffId })).messages.map(message => message.id), ids.reverse());
  assert.equal(f.snapshot().previousUser?.id, ids[0] + 1);
});

test('search is parameterized literal text, not wildcard, regex, SQL, or cross-scope search', async t => {
  const f = fixture(t);
  const needles = ["' OR 1=1 --", '%_[]', '.*', 'TeSt-ToKeN'];
  for (const needle of needles) {
    const id = f.add({ text: `Before ${needle} after` });
    f.add({ project: 'other', text: `private ${needle}` });
    const found = await f.call('search_chat', { query: needle.toLowerCase() });
    assert.deepEqual(found.messages.map(message => message.id), [id]);
  }
  const empty = await f.call('search_chat', { query: 'definitely-absent' });
  assert.equal(empty.outcome, 'no_match');
  assert.equal(empty.partial, false);
  assert.equal(empty.hasMore, false);
});

test('strict tool/snapshot validation and cancellation reject scope overrides and unsupported filters', async t => {
  const f = fixture(t);
  for (const args of [{ project: 'other' }, { scope: 'all' }, { limit: 0 }, { limit: 21 }, { limit: 1.2 }, { limit: '2' },
    { beforeId: 0 }, { cutoffId: -1 }, { cutoffId: Number.MAX_SAFE_INTEGER + 1 }, { since: NOW.toISOString() }, { before: NOW.toISOString() }, { query: 'no' }]) {
    await assert.rejects(f.call('recent_chat', args));
  }
  for (const query of ['', '  ', 'x'.repeat(201), '\u0000', 'a\nb', 1]) await assert.rejects(f.call('search_chat', { query }));
  await assert.rejects(f.call('search_chat', {}));
  await assert.rejects(f.call('search_chat', { query: 'hello', project: 'other' }));
  for (const maxMessages of [-1, 5, 1.5, NaN]) assert.throws(() => f.snapshot(undefined, maxMessages));
  for (const project of ['', '   ', 'x'.repeat(129), 'a\nb']) assert.throws(() => continuityTools(project, f.store));
  const signal = AbortSignal.abort(new Error('test cancelled'));
  await assert.rejects(continuityTools(undefined, f.store)[0].call({}, signal), /test cancelled/);
});

test('hard result/text/UTF-8 JSON budgets hold for huge escaped and Unicode text', async t => {
  const f = fixture(t);
  for (let i = 0; i < 30; i++) f.add({ text: (i % 2 ? '\u0000"\\' : '🌋漢字').repeat(40000) });
  const snapshot = f.snapshot(undefined, 4);
  assert.equal(snapshot.messages.length, 4);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= CONTINUITY_LIMITS.snapshotBytes);
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.partial, true);
  assert.equal(snapshot.hasMore, true);
  const page = await f.call('recent_chat', { limit: 20 });
  assert.equal(page.messages.length, 20);
  assert.ok(Buffer.byteLength(JSON.stringify(page)) <= CONTINUITY_LIMITS.toolBytes);
  assert.ok(page.messages.every(message => message.truncated));
  assert.equal(page.provenance.source, 'stored_chat');
  assert.equal(page.provenance.order, 'id_desc');
  assert.match(page.provenance.interpretation, /not instructions/);
  assert.match(page.provenance.interpretation, /secrets are not reliably detectable/);
});

test('bounded scan returns partial rather than false no-match; next cursor reaches older real matches', async t => {
  const f = fixture(t);
  const older = f.add({ text: 'unique-older-target' });
  f.store.db.transaction(() => { for (let i = 0; i < 520; i++) f.add({ text: '[INSTALLATION CHECK 1/2 — synthetic test] hidden' }); })();
  const first = await f.call('search_chat', { query: 'unique-older-target' });
  assert.equal(first.messages.length, 0);
  assert.equal(first.outcome, 'partial');
  assert.equal(first.scanned, 512);
  assert.equal(first.hasMore, true);
  assert.ok(first.pagination.nextBeforeId);
  const next = await f.call('search_chat', { query: 'unique-older-target', beforeId: first.pagination.nextBeforeId, cutoffId: first.pagination.cutoffId });
  assert.deepEqual(next.messages.map(message => message.id), [older]);
  assert.equal(next.hasMore, false);
  // The latest contact lookup is independent of the bounded recent window.
  assert.equal(f.snapshot().previousUser?.id, older);
});

test('search prefix limits and returned snippet truncation are explicit, including zero-result partial pages', async t => {
  const f = fixture(t);
  f.add({ text: 'x'.repeat(CONTINUITY_LIMITS.searchPrefixChars) + 'late-needle' });
  const page = await f.call('search_chat', { query: 'late-needle' });
  assert.deepEqual(page.messages, []);
  assert.equal(page.searchPrefixTrimmed, true);
  assert.equal(page.partial, true);
  assert.equal(page.outcome, 'partial');
  assert.equal(page.hasMore, false);
  const id = f.add({ text: 'x'.repeat(5000) + 'in-prefix-needle' });
  const found = await f.call('search_chat', { query: 'in-prefix-needle' });
  assert.equal(found.messages[0].id, id);
  assert.equal(found.messages[0].truncated, true);
  assert.equal(found.messages[0].text.includes('in-prefix-needle'), true);
  assert.equal(found.messages[0].textOffset, 5000 - CONTINUITY_LIMITS.searchLeadingChars);
  assert.equal(found.messages[0].matchOffset, CONTINUITY_LIMITS.searchLeadingChars);
  assert.equal(found.messages[0].matchLength, 'in-prefix-needle'.length);
  assert.match(found.provenance.searchCoverage, /first 16384/);
});

test('all retrieval works with query_only SQLite and leaves isolated DB/WAL and files unchanged', async t => {
  const f = fixture(t);
  f.add({ text: 'read-only-needle' });
  f.store.put('hostconfig', 'private', { credentials: 'not-returned' });
  writeFileSync(join(f.directory, 'MEMORY.md'), 'Never change this fixture.');
  writeFileSync(join(f.directory, 'hostconfig.json'), '{"private":"not-returned"}');
  f.store.db.pragma('wal_checkpoint(TRUNCATE)');
  f.store.db.pragma('query_only = ON');
  const hashes = () => Object.fromEntries(readdirSync(f.directory).filter(name => !name.endsWith('-shm')).sort()
    .map(name => [name, createHash('sha256').update(readFileSync(join(f.directory, name))).digest('hex')]));
  const before = hashes();
  const changes = f.store.db.prepare('SELECT total_changes() AS n').get();
  f.snapshot();
  await f.call('recent_chat');
  await f.call('search_chat', { query: 'read-only-needle' });
  assert.deepEqual(f.store.db.prepare('SELECT total_changes() AS n').get(), changes);
  assert.deepEqual(hashes(), before);
  assert.equal(f.store.get('hostconfig', 'private') && readFileSync(join(f.directory, 'MEMORY.md'), 'utf8'), 'Never change this fixture.');
});


test('ordinary watchdog/test headings remain human; only bounded leading whitespace and actual machine labels are excluded', async t => {
  const f = fixture(t);
  const human: number[] = [];
  for (const channel of ['app', 'goal']) {
    for (const text of ['Watchdog: please explain why this process is running.', 'Host watchdog: what is this?',
      '[watchdog notes] please review these.', '[smoke test results] help me interpret the errors.',
      '[installation check results] here is my manual report.']) {
      human.push(f.add({ channel, text }));
      human.push(f.add({ role: 'oracle', channel, text: 'A real human reply.' }));
    }
  }
  for (const prefix of ['\t\n ', '\r\n\t', ' '.repeat(450)]) {
    f.add({ text: prefix + '[NIBBI WATCHDOG] synthetic work' });
    f.add({ role: 'oracle', text: 'HIDDEN reply' });
  }
  const page = await f.call('recent_chat', { limit: 20 });
  assert.deepEqual(page.messages.map(message => message.id), [...human].reverse());
  assert.equal(f.snapshot().previousUser?.id, human.at(-2));
  assert.equal(page.messages[0].replyAttribution, 'legacy-nearest-user');
  assert.match(page.provenance.interpretation, /Unlabelled legacy automation cannot be reliably identified/);
  // Label checking inspects only the first 512 characters. It does not scan arbitrary whole messages.
  const beyond = f.add({ text: ' '.repeat(512) + '[NIBBI WATCHDOG] beyond bounded label check' });
  assert.equal(f.snapshot().previousUser?.id, beyond);
});

test('recorded run IDs attribute interleaved human/synthetic replies to the actual same-scope/channel user', async t => {
  const f = fixture(t);
  const hidden = f.add({ project: 'alpha', text: '[NIBBI WATCHDOG] synthetic', metadata: { runId: 'auto-1' } });
  const human = f.add({ project: 'alpha', text: 'A human request', metadata: { runId: 'human-1' } });
  f.add({ project: 'alpha', role: 'oracle', text: 'HIDDEN synthetic answer after real human', metadata: { runId: 'auto-1' } });
  const humanAnswer = f.add({ project: 'alpha', role: 'oracle', text: 'Real answer', metadata: { runId: 'human-1' } });
  const human2 = f.add({ project: 'alpha', text: 'A second human request', metadata: { runId: 'human-2' } });
  f.add({ project: 'alpha', text: '[NIBBI WATCHDOG] synthetic', metadata: { runId: 'auto-2' } });
  const humanAnswer2 = f.add({ project: 'alpha', role: 'assistant', text: 'Real answer after synthetic user', metadata: { runId: 'human-2' } });
  f.add({ project: 'alpha', role: 'oracle', text: 'HIDDEN second synthetic answer', metadata: { runId: 'auto-2' } });
  const page = await f.call('recent_chat', {}, 'alpha');
  assert.deepEqual(page.messages.map(message => message.id), [humanAnswer2, human2, humanAnswer, human]);
  assert(!page.messages.some(message => message.id === hidden));
  for (const [answer, parent] of [[humanAnswer, human], [humanAnswer2, human2]]) {
    const item = page.messages.find(message => message.id === answer)!;
    assert.equal(item.replyAttribution, 'run-id'); assert.equal(item.parentUserId, parent);
  }
  assert.equal(page.messages.find(message => message.id === human)!.replyAttribution, null);
  assert.equal(page.messages.find(message => message.id === human)!.parentUserId, null);
  assert.equal(f.snapshot('alpha').previousUser?.id, human2);
  assert.equal((await f.call('search_chat', { query: 'HIDDEN' }, 'alpha')).outcome, 'no_match');
  const second = await f.call('recent_chat', { limit: 2, cutoffId: page.pagination.cutoffId, beforeId: humanAnswer2 }, 'alpha');
  assert.deepEqual(second.messages.map(message => message.id), [human2, humanAnswer]);
  assert.equal(second.messages[1].parentUserId, human, 'parent can be older than this bounded page');
});

test('present run IDs fail closed on missing, invalid, future, wrong-channel or wrong-scope parents; legacy fallback stays labelled', async t => {
  const f = fixture(t);
  const real = f.add({ project: 'alpha', metadata: { runId: 'real' } });
  const legacy = f.add({ project: 'alpha', role: 'oracle', text: 'Legacy answer without a run ID' });
  f.add({ project: 'beta', metadata: { runId: 'other-project' } });
  f.add({ project: 'alpha', channel: 'telegram', metadata: { runId: 'other-channel' } });
  for (const runId of ['missing', 'other-project', 'other-channel', 'future', '', null, 123, {}, 'x'.repeat(201)]) {
    f.add({ project: 'alpha', role: 'oracle', text: 'HIDDEN invalid association', metadata: { runId } });
  }
  const future = f.add({ project: 'alpha', metadata: { runId: 'future' } });
  const page = await f.call('recent_chat', {}, 'alpha');
  assert.deepEqual(page.messages.filter(message => message.role === 'assistant').map(message => message.id), [legacy]);
  const item = page.messages.find(message => message.id === legacy)!;
  assert.equal(item.replyAttribution, 'legacy-nearest-user'); assert.equal(item.parentUserId, real);
  assert.equal(f.snapshot('alpha').previousUser?.id, future);
  assert(!JSON.stringify(page).includes('HIDDEN'));
  // Both vault spellings are one scope, including exact turn association.
  f.add({ metadata: { runId: 'vault-turn' } });
  const vaultAnswer = f.add({ project: 'vault', role: 'oracle', metadata: { runId: 'vault-turn' } });
  assert.equal((await f.call('recent_chat')).messages.find(message => message.id === vaultAnswer)!.replyAttribution, 'run-id');
});

test('matching source evidence survives Unicode offsets, prefix edges and the serialized JSON budget', async t => {
  const f = fixture(t);
  const needle = '漢'.repeat(200);
  const beforeMatch = '🌋'.repeat(5000) + ' amber ';
  const body = beforeMatch + needle + ' not violet ' + ('\\"漢🌋'.repeat(3000));
  for (let i = 0; i < 20; i++) f.add({ text: body });
  const page = await f.call('search_chat', { query: needle, limit: 20 });
  assert.equal(page.messages.length, 20);
  assert(Buffer.byteLength(JSON.stringify(page)) <= CONTINUITY_LIMITS.toolBytes);
  for (const message of page.messages) {
    const chars = Array.from(message.text);
    assert.equal(message.textOffset + message.matchOffset!, Array.from(beforeMatch).length, 'offsets count Unicode code points, not JS UTF-16 units');
    assert.equal(message.matchLength, 200);
    assert.equal(chars.slice(message.matchOffset!, message.matchOffset! + message.matchLength!).join(''), needle);
    assert(chars.slice(0, message.matchOffset!).join('').endsWith(' amber '));
    assert(chars.slice(message.matchOffset! + message.matchLength!).join('').startsWith(' not violet '));
    assert.equal(message.text, Array.from(body).slice(message.textOffset, message.textOffset + Array.from(message.text).length).join(''));
    assert.equal(message.truncated, true);
  }
  const edge = fixture(t);
  const edgeNeedle = 'EDGE';
  edge.add({ text: '🌋'.repeat(CONTINUITY_LIMITS.searchPrefixChars - edgeNeedle.length) + edgeNeedle + 'after' });
  const found = await edge.call('search_chat', { query: edgeNeedle });
  assert.equal(found.messages[0].textOffset + found.messages[0].matchOffset!, CONTINUITY_LIMITS.searchPrefixChars - edgeNeedle.length);
  assert.equal(found.messages[0].matchOffset, CONTINUITY_LIMITS.searchLeadingChars);
  assert(found.messages[0].text.includes(edgeNeedle)); assert.equal(found.searchPrefixTrimmed, true);
  assert.equal(found.hasMore, false); assert.equal(found.partial, true);
  const skipped = fixture(t);
  skipped.add({ text: 'x'.repeat(CONTINUITY_LIMITS.searchPrefixChars - 2) + edgeNeedle });
  const absent = await skipped.call('search_chat', { query: edgeNeedle });
  assert.deepEqual(absent.messages, []); assert.equal(absent.outcome, 'partial');
});


test('search retains decision context before amber highlight in short and late long messages', async t => {
  const f = fixture(t);
  const short = 'Keep the paper texture and amber highlight, not violet.';
  const shortId = f.add({ text: short });
  const long = '🌋'.repeat(5000) + short + ' Follow this decision.';
  const longId = f.add({ text: long });
  const page = await f.call('search_chat', { query: 'highlight' });
  assert.deepEqual(page.messages.map(message => message.id), [longId, shortId]);
  for (const message of page.messages) {
    const original = message.id === shortId ? short : long;
    const chars = Array.from(message.text);
    assert(message.text.includes('amber highlight, not violet'));
    assert.equal(chars.slice(message.matchOffset!, message.matchOffset! + message.matchLength!).join(''), 'highlight');
    assert.equal(message.text, Array.from(original).slice(message.textOffset, message.textOffset + chars.length).join(''));
    assert(message.matchOffset! <= CONTINUITY_LIMITS.searchLeadingChars);
  }
  assert.equal(page.messages[1].textOffset, 0); assert.equal(page.messages[1].truncated, false);
  assert.equal(page.messages[1].matchOffset, short.indexOf('highlight'));
  const recent = await f.call('recent_chat', { limit: 1 });
  assert.equal(recent.messages[0].matchOffset, null); assert.equal(recent.messages[0].matchLength, null);
});

test('byte-budget context shrinking keeps exact relative/absolute offsets and never loops on match-only text', { timeout: 2000 }, async t => {
  const f = fixture(t);
  const query = '漢'.repeat(200);
  const contexts = ['before amber ', '\\"🌋'.repeat(1000) + ' amber '];
  const bodies = new Map<number, string>();
  for (let i = 0; i < 20; i++) {
    const body = i < 5 ? query : contexts[i % contexts.length] + query + ' not violet ' + '\\"🌋'.repeat(2000);
    bodies.set(f.add({ text: body }), body);
  }
  const page = await f.call('search_chat', { query, limit: 20 });
  assert.equal(page.messages.length, 20);
  assert(Buffer.byteLength(JSON.stringify(page)) <= CONTINUITY_LIMITS.toolBytes);
  assert(page.messages.some(message => message.matchOffset! < CONTINUITY_LIMITS.searchLeadingChars && message.textOffset > 0), 'budget trims leading context for at least one long snippet');
  for (const message of page.messages) {
    const body = bodies.get(message.id)!;
    const chars = Array.from(message.text);
    assert.equal(chars.slice(message.matchOffset!, message.matchOffset! + message.matchLength!).join(''), query);
    assert.equal(message.text, Array.from(body).slice(message.textOffset, message.textOffset + chars.length).join(''));
    if (body === query) {
      assert.equal(message.text, query); assert.equal(message.textOffset, 0); assert.equal(message.matchOffset, 0);
    } else {
      assert(chars.slice(0, message.matchOffset!).join('').endsWith('amber '));
      assert(chars.slice(message.matchOffset! + message.matchLength!).join('').startsWith(' not violet '));
    }
  }
});


test('previous human elapsedText uses exact bounded seconds/minutes/hours/days at observedAt, not visits', t => {
  const f = fixture(t);
  const suffix = ' since the previous human message, measured at observedAt (not a visit interval).';
  const cases: [number, string][] = [
    [0, '0 seconds'], [1, '0.001 seconds'], [999, '0.999 seconds'], [1000, '1 second'],
    [25_000, '25 seconds'], [25_731, '25.731 seconds'], [59_999, '59.999 seconds'],
    [60_000, '1 minute'], [60_001, '1 minute, 0.001 seconds'], [61_000, '1 minute, 1 second'],
    [120_000, '2 minutes'], [3_600_000, '1 hour'], [7_200_000, '2 hours'],
    [3_661_001, '1 hour, 1 minute, 1.001 seconds'], [86_400_000, '1 day'],
    [172_800_000, '2 days'], [90_061_999, '1 day, 1 hour, 1 minute, 1.999 seconds'],
  ];
  for (const [elapsedMs, text] of cases) {
    const id = f.add({ at: new Date(NOW.getTime() - elapsedMs).toISOString() });
    const snap = f.snapshot(undefined, 0);
    assert.equal(snap.previousUser?.id, id);
    assert.equal(snap.previousUser?.elapsedMs, elapsedMs);
    assert.equal(snap.previousUser?.elapsedText, text + suffix);
    assert.equal(snap.observedAt, NOW.toISOString());
    assert.ok(snap.previousUser!.elapsedText!.length < 180);
    assert.ok(Buffer.byteLength(JSON.stringify(snap)) <= CONTINUITY_LIMITS.snapshotBytes);
  }
});

test('elapsedText is null for invalid/future contact and absent with no history; maximal Date span stays bounded', t => {
  const f = fixture(t);
  assert.equal(f.snapshot().previousUser, null);
  for (const at of ['bad timestamp', '2026-02-30T00:00:00Z', '2026-09-08T00:00:00Z']) {
    f.add({ at });
    const previous = f.snapshot().previousUser!;
    assert.equal(previous.elapsedMs, null);
    assert.equal(previous.elapsedText, null);
  }
  f.add({ at: '0000-01-01T00:00:00Z', text: '🌋"\\'.repeat(40_000) });
  const maximum = continuitySnapshot(undefined, { now: new Date(8_640_000_000_000_000), maxMessages: 4 }, f.store);
  assert.equal(maximum.previousUser?.timestampStatus, 'valid');
  assert.ok(maximum.previousUser!.elapsedText!.length < 180);
  assert.match(maximum.previousUser!.elapsedText!, /^\d+ days/);
  assert.ok(Buffer.byteLength(JSON.stringify(maximum)) <= CONTINUITY_LIMITS.snapshotBytes);
  const id = f.add({ at: new Date(NOW.getTime() - 25_000).toISOString(), text: '🌋"\\'.repeat(40_000) });
  const large = f.snapshot(undefined, 4);
  assert.equal(large.previousUser?.id, id);
  assert.equal(large.previousUser?.elapsedText, '25 seconds since the previous human message, measured at observedAt (not a visit interval).');
  assert.equal(large.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(large)) <= CONTINUITY_LIMITS.snapshotBytes);
});
