// Pure presentation of reported metadata. Never infer project settings from brain state.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const count = value => number(value) !== null && Number.isInteger(value) ? value : null;

export function marginMetadata(input = {}) {
  const { status: rawStatus, project, busy, link, demo, sessionCost, sessionTurns } = record(input) || {};
  const status = record(rawStatus);
  const lead = record(record(record(project)?.settings)?.lead);
  const projectModel = text(lead?.model), projectProvider = text(lead?.provider);
  // modelOverride is the global brain override, not the selected project's model
  // (daemon/src/session.ts). Missing project settings do not mean unconfigured.
  const brainModel = text(status?.modelOverride);
  const model = projectModel || (projectProvider ? 'Provider default' : brainModel ? brainModel + ' · Brain override' : 'Not available');
  const provider = projectProvider || 'Not reported';
  const session = [text(status?.sessionShort) || text(status?.sessionId)?.slice(0, 8) || 'Not available'];
  const limit = text(record(status?.rateLimit)?.status);
  if (limit && limit !== 'allowed') session.push('rate-limited');
  const cost = number(sessionCost), turns = count(sessionTurns);
  if (cost !== null && turns !== null) session.push('$' + cost.toFixed(2) + ' known sitting cost / ' + turns + ' turns');
  else if (cost !== null) session.push('$' + cost.toFixed(2) + ' known sitting cost');
  else if (turns !== null) session.push(turns + ' sitting turns');
  const context = [];
  const tokens = count(status?.ctxTokens), totalTurns = count(status?.turns), totalCost = number(status?.costUsdTotal);
  if (tokens !== null) context.push(tokens < 1000 ? tokens + ' tokens' : Math.round(tokens / 1000) + 'k tokens');
  if (totalTurns !== null) context.push(totalTurns + ' turns');
  if (totalCost !== null) context.push('$' + totalCost.toFixed(2) + ' known lifetime cost');
  const brain = demo === true ? 'Demo · scripted replies' : link === 'offline' ? 'Offline' : status ? (busy === true || status.busy === true ? 'Working' : 'Ready') : 'Waking';
  return { brain, session: session.join(' · '), context: context.join(' · ') || 'Not available', model, provider };
}
