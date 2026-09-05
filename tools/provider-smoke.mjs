// Explicit, account-using acceptance check. Never part of offline CI; all work is temporary.
import assert from 'node:assert/strict';
import { testBackend } from './test-backend.mjs';
const provider = process.argv[2];
if (!['claude', 'codex'].includes(provider)) throw new Error('Usage: node tools/provider-smoke.mjs claude|codex (uses your signed-in provider account)');
const fixture = await testBackend();
const request = async (path, value) => {
  const response = await fetch(fixture.base + path, {
    method: value === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    body: value === undefined ? undefined : JSON.stringify(value), signal: AbortSignal.timeout(120000),
  });
  const result = await response.json(); assert.equal(response.ok, true, JSON.stringify(result)); return result;
};
const command = async (name, args) => {
  const result = await request('/api/commands', { name, projectId: 'fixture', args, idempotencyKey: crypto.randomUUID() });
  assert.equal(result.ok, true, JSON.stringify(result)); return result.data;
};
try {
  await command('project.settings', { settings: { lead: { provider }, fixer: { provider } } });
  const lead = await request('/api/send', { project: 'fixture', message: 'Reply with exactly NIBBI_BUILD_OK. Deployment smoke test only. Do not use tools, edit files, or dispatch tasks.', stream: false });
  assert.equal(lead.isError, false, JSON.stringify(lead)); assert.match(lead.text, /NIBBI_BUILD_OK/);
  console.log(provider + ': lead response passed');
  const catalog = await request('/api/skills'); const skill = catalog.skills.find(skill => skill.name === 'nibbi-verify-change');
  assert.ok(skill, 'Bundled verification skill must be available');
  await command('skills.enable', { role: 'fixer', refs: [{ id: skill.id, revision: skill.revision }] });
  await command('project.commands', { install: 'true', check: "test -f smoke.txt && test \"$(cat smoke.txt)\" = NIBBI_FIXER_OK" });
  const run = await command('run.dispatch', { issue: 'Use the nibbi-verify-change skill. Create only smoke.txt containing the single line NIBBI_FIXER_OK. Use Nibbi governed tools. Do not commit, merge, dispatch, or change other files. The backend runs the final check.', title: 'Isolated provider acceptance' });
  const deadline = Date.now() + 120000;
  for (;;) {
    const saved = (await request('/api/fixers')).find(item => item.id === run.id); assert.ok(saved);
    if (['staged', 'failed', 'cancelled', 'interrupted'].includes(saved.status)) {
      assert.equal(saved.status, 'staged', saved.summary ?? JSON.stringify(saved.verification));
      assert.equal(saved.verification?.status, 'passed');
      assert.deepEqual(saved.skillRefs, [{ id: skill.id, revision: skill.revision }]);
      console.log(provider + ': pinned skill, real fixer tools, sandbox verification and staging passed'); break;
    }
    if (Date.now() > deadline) throw new Error('Provider acceptance timed out; temporary run will be cancelled');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
} finally { await fixture.close(); }
