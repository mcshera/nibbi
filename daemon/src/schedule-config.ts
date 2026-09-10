import { runtime, type RuntimeStore } from './store.js';

export interface Schedule { id: string; name: string; pattern: string; when: string; desc: string; prompt: string; enabled: boolean; next?: string; last?: number; error?: string }
const defaults: Schedule[] = [
  { id: 'heartbeat', name: 'heartbeat', pattern: '*/30 8-23 * * *', when: 'every 30 min · 8am–11pm', desc: 'Read the watching list; report only what needs attention.', prompt: 'Read HEARTBEAT.md. Report only what needs attention; otherwise reply HEARTBEAT_OK. Do not dispatch work.', enabled: false },
  { id: 'brief', name: 'morning brief', pattern: '30 7 * * *', when: '7:30 AM daily', desc: 'A short brief from journal, issues and inbox.', prompt: 'Read recent journal, issues and inbox. Compose a concise morning brief.', enabled: false },
  { id: 'consolidate', name: 'consolidation', pattern: '0 3 * * *', when: '3:00 AM daily', desc: 'File durable notes into unprotected vault pages.', prompt: 'Review recent journal and inbox. File durable facts into unprotected vault pages. Do not remove source evidence or activate skills.', enabled: false },
  { id: 'review', name: 'weekly self-review', pattern: '0 18 * * 0', when: 'Sundays 6:00 PM', desc: 'Review lessons; propose improvements for owner review.', prompt: 'Review recent journal and work. Write a weekly brief with shipped work, repeated lessons and possible skill candidates. Learned skills require two evidence runs and owner review; never enable them yourself.', enabled: false },
];
/** Read configured flags from the same defaults as the scheduler; no timers or writes. */
export function scheduleSettings(store: RuntimeStore = runtime()): Schedule[] {
  return defaults.map(def => ({ ...def, ...(store.get<Partial<Schedule>>('schedules', def.id) ?? {}) }));
}

/** Stable schedule keys and configured flags only; never expose schedule prompts in lead context. */
export function configuredScheduleFlags(store: RuntimeStore = runtime()): { id: string; enabled: boolean }[] {
  return scheduleSettings(store).map((entry, index) => ({ id: defaults[index].id, enabled: Boolean(entry.enabled) }));
}
