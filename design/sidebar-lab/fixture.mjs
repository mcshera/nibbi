/** The model every option renders. Same shape as syncMargins() in public/app.js:1551-1584, so an
    option that renders this renders the real app. Pure data: no clock, no DOM, no network.
    `now` is fixed so relative times ("3h", "24m") are identical in every screenshot. */
export const NOW = Date.parse('2026-09-14T17:00:00Z');
const ago = hours => new Date(NOW - hours * 3600e3).toISOString();
const thread = (id, title, hours) => ({ id, title, lastAt: ago(hours), archived: false, active: false });
/** Badge vocabulary copied from describeProjectSection() in public/lib/project-summary.js:27-59. */
const section = (badge, tone = 'quiet', detail = '') => ({ badge, tone, detail, accessible: [badge, detail].filter(Boolean).join('. ') });

const PROJECTS = [
  { id: 'shipless', name: 'shipless', branch: 'main', goal: '', mode: 'off',
    inFlight: 0, pending: 0, staged: 0, spend: 0, spendCap: 0, done: null, total: null, planAvailable: true, playable: false,
    threads: [thread('home', 'Home', 30)],
    sections: { builds: section('No builds'), issues: section('Notes'), plans: section('Written plan') } },
  { id: 'battalion', name: 'battalion', active: true, branch: 'v2', goal: 'Ship the lobby — one build staged, the rest queued', mode: 'stage',
    inFlight: 0, pending: 2, staged: 1, spend: 14.2, spendCap: 40, done: 56, total: 58, planAvailable: true, playable: true,
    threads: [thread('home', 'Home', 3), thread('t-left-bar', 'make the left bar less silly', 0.4), thread('t-threads', 'threads — more than one conversation', 26), thread('t-lobby', 'why does the lobby say 71', 70)],
    sections: { builds: section('71 need attention', 'error', '3 running'), issues: section('No issues'), plans: section('56/58 tasks', 'quiet', 'Ship the lobby') } },
  { id: 'nibbi', name: 'nibbi', branch: 'v2', goal: 'A glass window', mode: 'ship',
    inFlight: 1, pending: 0, staged: 0, spend: 3.1, spendCap: 0, done: 9, total: 9, planAvailable: true, playable: false,
    threads: [thread('home', 'Home', 5), thread('t-glass', 'glass window on Liquid Glass', 20)],
    sections: { builds: section('2 review', 'attention', '1 running'), issues: section('3 open', 'quiet', '1 linked build'), plans: section('Complete') } },
  { id: 'test', name: 'test', branch: 'main', goal: '', mode: 'suggest',
    inFlight: 0, pending: 0, staged: 0, spend: 0, spendCap: 0, done: 0, total: 0, planAvailable: false, playable: false,
    threads: [thread('home', 'Home', 200)],
    sections: { builds: section('1 active', 'active'), issues: section('No issues'), plans: section('No plan') } },
];
const EXTRA = [
  'a-very-long-project-name-that-keeps-going-and-going', 'observatory', 'paper-garden', 'weekend-notes',
  'the-quick-brown-fox-jumps-over-the-lazy-dog', 'battalion-2', 'shipless-docs', 'nibbi-site',
];
const clone = value => JSON.parse(JSON.stringify(value));
const blank = (name, i = 0) => ({
  id: name, name, branch: i % 2 ? 'main' : 'v2', goal: '', mode: ['off', 'suggest', 'stage'][i % 3],
  inFlight: 0, pending: 0, staged: 0, spend: 0, spendCap: 0, done: i % 5, total: 5, planAvailable: true, playable: false,
  threads: [thread('home', 'Home', 24 + i * 7)],
  sections: { builds: section(i % 4 === 1 ? '2 review' : 'No builds', i % 4 === 1 ? 'attention' : 'quiet'), issues: section('No issues'), plans: section(`${i % 5}/5 tasks`) },
});

export const settings = {
  microphone: false, microphonePhase: 'off', voice: true, sounds: false,
  notifications: false, notificationsSupported: true, notificationStatus: 'Not requested',
  model: 'claude-opus-5', provider: 'anthropic', brain: 'ready', session: 'lab-fixture', context: '12k tokens',
  demo: false, calm: false, systemReduced: false, glass: false, glassAvailable: true,
};
/** progressLine() in public/lib/margin-ui.js:39-47 renders this as "2 merged today · 5 this week · 3-day streak". */
export const progress = { available: true, today: { deliveries: 2 }, week: { deliveries: 5 }, streak: 3 };

export const base = () => ({ now: NOW, projects: clone(PROJECTS), projectsLoaded: true, activeProject: 'battalion', view: null, busy: false, progress, settings });
export const many = () => ({ ...base(), projects: [...clone(PROJECTS), ...EXTRA.map((name, i) => blank(name, i))] });
/** Mirrors the stress case in tests/margin-ui.test.mjs:205 — 60 projects with very long names. */
export const stress = (n = 60) => ({
  ...base(), activeProject: 'p-0',
  projects: Array.from({ length: n }, (_, i) => ({ ...blank('A very long project name '.repeat(10) + i, i), id: `p-${i}`, active: i === 0 })),
});
export const withView = (model, view) => ({ ...model, view });
export const withActiveThread = (model, project, id) => ({
  ...model, activeProject: project,
  projects: model.projects.map(p => ({ ...p, active: p.id === project, threads: p.threads.map(t => ({ ...t, active: p.id === project && t.id === id })) })),
});
export const withBusy = model => ({
  ...model, busy: true,
  projects: model.projects.map(p => p.id === 'battalion'
    ? { ...p, inFlight: 3, sections: { ...p.sections, builds: section('3 active', 'active') } } : p),
});
