// One rule, one check. The design language says a disabled control dims one way, a focused one
// rings one way, verdict colour means a verdict, and !important is not how a control gets its size.
// This reads the stylesheets and fails when a rule stops saying so. No dependencies, no browser.
// See design/LANGUAGE.md 2.3, 12 and 15.
//
//   node tools/style-verify.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/', import.meta.url));

// !important is kept for two jobs: [hidden] has to win over any display, and the reduced-motion kill
// switch has to win over any animation. styles.css carries both (the kill switch twice: the system
// setting and body.calm); margins.css carries its own copy of each for the bar. Everything else is a
// specificity problem, and the resets are under :where() so a class can win on its own. A budget can
// only go down: lower it here when a file sheds one.
const BUDGET = { 'styles.css': 7, 'margins.css': 3, 'project-workspace.css': 0, 'platform.css': 0, 'project-composer.css': 0, 'voice.css': 0, 'tokens.css': 0 };

// A selector may reach for --fail-* or --pass-* only if it names a verdict. A hook matches as a whole
// token: .step is a step and .steps is not, .fail is not .failover. The first line is the list the
// round-2 plan set; the second holds the verdict hooks the stylesheets already used and that list did
// not name (a badge whose tone is error, a tool result's ok flag, the bar's and a form's error line).
const cls = name => new RegExp(`\\.${name}(?![\\w-])`);
const VERDICT = [
  /\[data-status(?![\w-])/, /\[data-kind="error"\]/, cls('fail'), cls('error'), cls('diffv'), cls('step'), /\.planr(?:\[|:is\(\[)data-state(?![\w-])/, cls('warn'), cls('prwarn'), cls('armed'),
  /\[data-tone="error"\]/, /\[data-ok=/, cls('margin-error'), cls('project-form-error'), cls('prerr'),
];
const namesVerdict = part => VERDICT.some(hook => hook.test(part));
// Not verdicts, and recorded rather than swept: each is a decision for its owner, and any new one fails.
const RECORDED = new Map([
  ['.project-notice[data-kind="success"]', '"Saved." is not a verdict either; ink or --pass-text is the owner\'s call'],
  ['.github-warning', 'carries warnings, notices and merge blockers; 2.3 says a warning is --fail-edge with ink text'],
  ['.platform-panel .panel-message', 'the Settings dialog\'s one message line, used for failures and for plain notes alike'],
]);

const strip = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
// Innermost blocks only: a declaration block never contains braces, so this reaches every style
// rule, including the ones inside @media and @supports, and every keyframe step.
const rules = css => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] }));
// Split a selector list on the commas that separate selectors, not the ones inside :is() or :where().
function parts(selector) {
  const out = []; let depth = 0, start = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === '(') depth++; else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { out.push(selector.slice(start, i).trim()); start = i + 1; }
  }
  out.push(selector.slice(start).trim());
  return out.filter(Boolean);
}
// :not(:disabled) is the enabled state, and :not(:focus-visible) is the unfocused one.
const withoutNot = selector => selector.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '');
const decls = body => body.split(';').map(d => d.trim()).filter(Boolean).map(d => { const i = d.indexOf(':'); return [d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim()]; });

const failures = [], counts = {}, slack = [];
// The matcher checks itself first, on the near misses a substring test let through.
for (const [part, verdict] of [['.step.live .b', true], ['.step.fail .b', true], ['.margin-error', true], ['.planr:is([data-state="failed"]) .prs', true],
  ['.steps .fold .l', false], ['.stepper-hint', false], ['.margin-foot-error', false], ['.failover', false], ['.project-summary', false]])
  if (namesVerdict(part) !== verdict) failures.push(`style-verify: "${part}" should ${verdict ? '' : 'not '}count as naming a verdict`);
for (const [file, budget] of Object.entries(BUDGET)) {
  const css = strip(readFileSync(root + file, 'utf8'));
  const flags = (css.match(/!important/g) || []).length;
  counts[file] = flags;
  if (flags > budget) failures.push(`${file}: ${flags} !important, budget ${budget}. Fix the specificity instead (see the :where() resets).`);
  else if (flags < budget) slack.push(`${file} could drop its budget to ${flags}`);
  for (const { selector, body } of rules(css)) {
    const own = withoutNot(selector);
    for (const [prop, value] of decls(body)) {
      if (/:disabled\b/.test(own) && prop === 'opacity' && !/^var\(--dim-disabled\)$/.test(value) && Number(value) !== 1)
        failures.push(`${file}: "${selector}" dims with opacity ${value}; use var(--dim-disabled)`);
      if (/:focus-visible\b/.test(own) && /^outline(-color|-style|-width)?$/.test(prop) && !(prop === 'outline' && /^(0|var\(--focus-ring(-inverse)?\))$/.test(value)))
        failures.push(`${file}: "${selector}" draws its own focus ring (${prop}: ${value}); use outline: var(--focus-ring), or var(--focus-ring-inverse) on ink`);
    }
    if (!/var\(--(fail|pass)-/.test(body)) continue;
    for (const part of parts(selector)) {
      if (RECORDED.has(part) || namesVerdict(part)) continue;
      failures.push(`${file}: "${part}" uses verdict colour but names no verdict. Colour means a machine verdict; information is ink (LANGUAGE 2.3).`);
    }
  }
}

// Declared and deliberately not swept in: a px-to-token pass would be diff noise for no visible change.
// Reported so the count is in front of whoever next adopts them.
const all = Object.keys(BUDGET).filter(f => f !== 'tokens.css').map(f => strip(readFileSync(root + f, 'utf8'))).join('\n');
const uses = name => (all.match(new RegExp(`var\\(${name}\\)`, 'g')) || []).length;
const declared = [...strip(readFileSync(root + 'tokens.css', 'utf8')).matchAll(/(--(?:space-\d+|track-title)):/g)].map(m => m[1]);
console.log('declared, in use: ' + declared.map(name => `${name} ${uses(name)}`).join(', '));
console.log('!important per file: ' + Object.entries(counts).map(([f, n]) => `${f} ${n}/${BUDGET[f]}`).join(', '));
for (const note of slack) console.log('note: ' + note);
if (failures.length) {
  for (const f of failures) console.error('FAIL ' + f);
  process.exitCode = 1;
} else console.log(`Style checks passed: !important within budget, disabled dims with --dim-disabled, focus rings with --focus-ring (or its inverse on ink), verdict colour only on verdicts (${RECORDED.size} recorded exceptions).`);
