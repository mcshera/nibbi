import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuntimeStore } from '../src/store.js';
import { SkillCatalog, inspectSkill } from '../src/skills.js';
test('skills pin revisions, require review, and reject configuration and symlinks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nibbi-skills-')); const store = new RuntimeStore(join(dir, 'state')); const catalog = new SkillCatalog(store);
  try {
    const skillDir = join(dir, 'skill'); mkdirSync(skillDir); writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: useful-skill\ndescription: An explicit useful workflow.\n---\nRead the relevant tests.\n');
    const imported = catalog.import(skillDir, 'curated'); catalog.enable('demo', 'lead', [{ id: imported.id, revision: imported.revision }]);
    writeFileSync(join(skillDir, 'SKILL.md'), 'Changed upstream'); assert.equal(catalog.selected('demo', 'lead', 'codex')[0].revision, imported.revision);
    assert.throws(() => catalog.draft('no-evidence', 'No evidence.', 'Steps', ['a', 'b']), /terminal outcome/);
    store.put('fixers', 'a', { id: 'a', status: 'merged', endedAt: new Date().toISOString(), summary: 'Verified lesson A' }); store.put('fixers', 'b', { id: 'b', status: 'failed', endedAt: new Date().toISOString(), summary: 'Observed failure B' });
    const draft = catalog.draft('learned-workflow', 'A learned workflow.', 'Follow steps.', ['a', 'b']);
    assert.throws(() => catalog.enable('demo', 'fixer', [{ id: draft.id, revision: draft.revision }]), /reviewed/);
    catalog.review(draft.id, draft.revision); catalog.enable('demo', 'fixer', [{ id: draft.id, revision: draft.revision }]);
    symlinkSync(imported.path, join(skillDir, 'linked')); assert.equal(inspectSkill(skillDir).status, 'invalid');
    writeFileSync(join(imported.path, 'SKILL.md'), 'tampered'); assert.throws(() => catalog.resolve(imported), /changed/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});


test('web tool dependencies resolve for the lead and never for a fixer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nibbi-skills-web-')); const store = new RuntimeStore(join(dir, 'state')); const catalog = new SkillCatalog(store);
  try {
    const make = (name: string, roles: string): string => { const skillDir = join(dir, name); mkdirSync(skillDir); writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: ' + name + '\ndescription: Looks things up before acting.\nmetadata:\n  nibbi:\n    providers: [claude, codex]\n    roles: [' + roles + ']\n    dependencies: [tool:web_fetch]\n---\nRead the docs page first.\n'); return skillDir; };
    const lead = catalog.import(make('docs-first', 'lead'), 'curated'); catalog.enable('demo', 'lead', [{ id: lead.id, revision: lead.revision }]);
    assert.equal(catalog.selected('demo', 'lead', 'claude')[0]?.name, 'docs-first');
    const fixer = catalog.import(make('docs-first-fixer', 'fixer'), 'curated'); catalog.enable('demo', 'fixer', [{ id: fixer.id, revision: fixer.revision }]);
    assert.throws(() => catalog.selected('demo', 'fixer', 'claude'), /unavailable dependency tool:web_fetch/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
