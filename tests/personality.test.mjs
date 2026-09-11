import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseActs } from '../public/lib/text.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const soul = read('../vault-template/SOUL.md');
const agents = read('../vault-template/AGENTS.md');
const pack = JSON.parse(read('../docs/personality/scenarios.json'));

// These guard the prompt contract and authored fixtures, not an LLM's adherence.
test('Nibbi has a companion purpose, a stable character, and an explicit response style', () => {
  assert.match(soul, /AI companion for everyday life and teammate for making things/);
  assert.match(soul, /## Character: an observant, quietly opinionated ally/);
  assert.match(soul, /## Response style/);
  assert.match(soul, /These are shifts of emphasis, not different characters/);
  assert.match(soul, /Shipping is one part of a good life, not the measure of one/);
  assert.doesNotMatch(soul, /Super concise\. One-line acks|One continuous mind|always-on partner for building/);
});

test('next steps are a visible conversational ending, not a mandatory footer or chip quota', () => {
  assert.match(soul, /## Every conversational reply ends with next steps/);
  assert.match(soul, /last visible sentence or short block/);
  assert.match(soul, /rest, or an explicit stopping point/);
  assert.match(soul, /stand on its own if action chips are hidden/);
  assert.match(soul, /Only for a real project\/run control choice/);
  assert.match(soul, /Exact-output requests/);
  assert.match(soul, /do not corrupt the deliverable with a footer or extra fields/);
  assert.match(soul, /explicit stop or no-questions request wins/);
});

test('warmth and initiative do not expand approval, memory, or relationship authority', () => {
  assert.match(soul, /require \{\{OWNER\}\}'s explicit/);
  assert.match(soul, /Never promise a later check-in, reminder, background watch, or saved note/);
  assert.match(soul, /No guilt for absence, jealousy, exclusivity/);
  assert.match(soul, /Ask before saving sensitive personal details/);
  assert.match(soul, /ordinary chat history may still be retained/);
  assert.match(agents, /Ask before storing sensitive personal details/);
  assert.match(agents, /same consent limits apply during consolidation and self-review/);
  assert.doesNotMatch(soul + agents, /chat is ephemeral|Capture\*\*: anything from|decisions, mood, open loops/);
  assert.doesNotMatch(soul + agents, /Matty|Matthew Shera/);
});

test('small wins do not trigger a survey, data dismissal, or unsolicited memory chips', () => {
  assert.match(soul, /Limited evidence is not no evidence/);
  assert.match(soul, /Do not turn that one question into a survey spread across bullets/);
  assert.match(soul, /no logging or memory chips/);
  assert.match(soul, /explicitly asked to save it/);
  assert.match(soul, /Without a write tool I cannot save even a harmless journal note/);
  assert.match(soul, /For an ordinary life question, start with one short paragraph/);
});

test('reference pack covers multi-turn character, corrections, endings, and strict-output cases', () => {
  assert.match(pack.status, /not observed model outputs/);
  assert.equal(new Set(pack.cases.map((c) => c.id)).size, pack.cases.length);
  assert.ok(pack.cases.filter((c) => c.turns.length > 1).length >= 5);
  for (const mode of ['building', 'overwhelm', 'listening', 'celebration', 'decision', 'technical', 'repair', 'authority', 'closure', 'capability', 'memory', 'relationship', 'answer', 'choice', 'safety', 'exact-output']) {
    assert.ok(pack.cases.some((c) => c.mode === mode), `Missing ${mode}`);
  }
});

for (const scenario of pack.cases) {
  test(`authored voice anchors: ${scenario.id}`, () => {
    for (const turn of scenario.turns) {
      assert.ok(turn.user && turn.referenceReply && turn.must.length);
      const parsed = parseActs(turn.referenceReply);
      if (scenario.mode === 'exact-output') {
        assert.equal(turn.landing, null);
        assert.deepEqual(parsed.acts, []);
      } else {
        assert.ok(turn.landing, 'Every conversational anchor needs an explicit landing');
        assert.ok(parsed.clean.trimEnd().endsWith(turn.landing), 'Landing remains visible after chips are stripped');
        assert.doesNotMatch(turn.landing, /Anything else\?|How does that sound\?|Would you like me to help\?/i);
      }
      if (parsed.acts.length) {
        assert.ok(parsed.acts.length >= 2 && parsed.acts.length <= 4);
        assert.ok(parsed.acts.every((a) => [...a].length <= 28 && !a.includes('?')));
        assert.match(turn.referenceReply.trimEnd().split('\n').at(-1), /^»acts:/);
      }
    }
  });
}

test('strict-format references show that conversational style does not corrupt deliverables', () => {
  const json = pack.cases.find((c) => c.id === 'strict-json').turns[0].referenceReply;
  assert.equal(json, '{"ok":true}');
  assert.deepEqual(JSON.parse(json), { ok: true });
  assert.equal(pack.cases.find((c) => c.id === 'code-only').turns[0].referenceReply, '2 + 2');
});
