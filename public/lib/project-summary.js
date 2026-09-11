import {loadProjectSummaries} from './project-data.js';
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export const buildGroup = status => ['queued','preparing','installing','running','checking','verifying','merging','awaiting_input'].includes(status) ? 'active' : ['staged','done'].includes(status) ? 'review' : ['failed','interrupted'].includes(status) ? 'failed' : 'history';
export const buildStatusLabel = status => ({queued:'Queued',preparing:'Preparing',installing:'Preparing',running:'Building',checking:'Checking',verifying:'Checking',merging:'Merging',awaiting_input:'Awaiting input',staged:'Awaiting review',done:'Awaiting review',merged:'Merged',failed:'Failed',interrupted:'Interrupted',cancelled:'Cancelled',discarded:'Discarded',superseded:'Replaced'})[status] || status || 'Status unavailable';
export const verificationLabel = verification => ({passed:'Passed',failed:'Failed',unverified:'Not verified'})[verification?.status] || 'Unavailable';
export function buildMatchesFilter(run, filter) {
  const group=buildGroup(run.status), github=run.github||{};
  if(filter==='all')return true;
  if(filter==='toPush')return !!github.toPush;
  if(filter==='pullRequests')return !!github.pullRequest;
  if(filter==='attention')return group==='failed'||!!github.needsAttention;
  if(filter==='review')return group==='review'&&!github.toPush&&!github.pullRequest&&!github.needsAttention;
  if(filter==='history')return group==='history'&&!github.toPush&&!github.pullRequest&&!github.needsAttention;
  return group===filter;
}
export function buildListGroup(run) {
  if(buildMatchesFilter(run,'active'))return 'active';
  if(buildMatchesFilter(run,'attention'))return 'attention';
  if(buildMatchesFilter(run,'toPush'))return 'toPush';
  if(buildMatchesFilter(run,'pullRequests'))return 'pullRequests';
  if(buildMatchesFilter(run,'review'))return 'review';
  return 'history';
}
export function projectBuildCounts(runs) {
  return Object.fromEntries([['total',runs.length],...['active','review','failed','toPush','pullRequests','attention','history'].map(key=>[key,runs.filter(run=>buildMatchesFilter(run,key)).length]),['readyPR',runs.filter(run=>run.github?.readyPR).length]]);
}
export function describeProjectSection(section, data) {
  const state = data?.status, stale = !!data?.stale, loading = !data || state === 'loading';
  let badge = loading ? 'Loading…' : 'Unavailable', detail = '', tone = 'quiet';
  const c = section==='builds'&&Array.isArray(data?.runs)?{...data?.counts,...projectBuildCounts(data.runs)}:data?.counts;
  if (state !== 'error' && c && integer(c.total) !== null) {
    if (section === 'builds') {
      const n = key => integer(c[key]) ?? 0;
      if(n('attention')&&(n('pullRequests')||n('toPush')||data.runs?.some(run=>run.github?.needsAttention))){badge=`${n('attention')} need attention`;tone='error';}
      else if(n('readyPR')){badge=`${n('readyPR')} PR ready`;tone='attention';}
      else if(n('toPush')){badge=`${n('toPush')} to push`;tone='attention';}
      else if(n('pullRequests')){badge=`${n('pullRequests')} pull request${n('pullRequests')===1?'':'s'}`;tone='attention';}
      else if (n('review')) { badge = `${n('review')} review`; tone = 'attention'; }
      else if (n('failed')) { badge = `${n('failed')} failed`; tone = 'error'; }
      else if (n('active')) { badge = `${n('active')} active`; tone = 'active'; }
      else badge = c.total ? `${n('history')} past` : 'No builds';
      const running = integer(c.byStatus?.running);
      detail = [n('active') && (running ? `${running} running` : `${n('active')} active`), n('failed') && n('review') && `${n('failed')} failed`].filter(Boolean).join(' · ');
      if (badge.endsWith('active')) detail = '';
    } else if (section === 'issues') {
      badge = c.total ? `${integer(c.open) ?? '—'} open` : data.hasNotes || data.markdown?.trim() ? 'Notes' : 'No issues';
      const linked = integer(data.linkedBuildCount); if (linked) detail = `${linked} linked build${linked === 1 ? '' : 's'}`;
    } else if (integer(c.done) !== null) {
      badge = c.total ? c.done === c.total ? 'Complete' : `${c.done}/${c.total} tasks` : data.hasNotes || data.markdown?.trim() ? 'Written plan' : 'No plan';
      detail = data.currentMilestone?.name || (typeof data.currentMilestone === 'string' ? data.currentMilestone : '') || '';
    }
  } else if (state === 'ready' || state === 'empty' || state === 'partial') {
    if (section === 'issues') badge = data.hasNotes || data.markdown?.trim() ? 'Notes' : state === 'empty' ? 'No issues' : 'Unavailable';
    if (section === 'plans') badge = data.hasNotes || data.markdown?.trim() ? 'Written plan' : state === 'empty' ? 'No plan' : 'Unavailable';
  }
  if (state === 'partial' && !c?.total) badge = 'Unavailable';
  if (stale) detail = detail ? `${detail} · last read` : 'Last read · reconnecting';
  return {badge, detail, tone, stale, accessible:[badge,detail].filter(Boolean).join('. ')};
}

/** Demand-driven, bounded summary reads shared by the sidebar and section tabs. */
export function createProjectSummaryStore({load = loadProjectSummaries, onChange = () => {}, ttl = 30000, batchSize = 12, concurrency = 2, now = Date.now} = {}) {
  const cache = new Map(), queued = new Set(), inFlight = new Set(), epochs = new Map();
  let watched = new Set(), active = 0, scheduled = false, destroyed = false;
  function notify(project) { if (!destroyed) onChange(project, cache.get(project)?.value); }
  function schedule() { if (scheduled || destroyed) return; scheduled = true; queueMicrotask(() => { scheduled = false; void drain(); }); }
  async function drain() {
    while (!destroyed && active < concurrency && queued.size) {
      const ids = [...queued].filter(id => !inFlight.has(id)).slice(0,batchSize); if (!ids.length) return;
      for (const id of ids) { queued.delete(id); inFlight.add(id); }
      active++;
      const versions = ids.map(id => epochs.get(id) || 0);
      void (async () => {
        try {
          const values = await load({projects:ids});
          ids.forEach((id,index) => { if ((epochs.get(id)||0) !== versions[index]) return; cache.set(id,{value:values[id],at:now()}); notify(id); });
        } catch (error) {
          ids.forEach((id,index) => { if ((epochs.get(id)||0) !== versions[index]) return;
            const previous = cache.get(id)?.value;
            const value = {project:id};
            for (const section of ['builds','issues','plans']) value[section] = previous?.[section] ? {...previous[section],stale:true,error:error.message} : {status:'error',error:error.message};
            cache.set(id,{value,at:now()}); notify(id);
          });
        } finally { active--; for (const id of ids) inFlight.delete(id); schedule(); }
      })();
    }
  }
  function ensure(ids, force = false) {
    for (const id of ids) {
      const value = cache.get(id);
      if (!force && (queued.has(id) || inFlight.has(id) || value && now()-value.at<ttl)) continue;
      if (force) epochs.set(id,(epochs.get(id)||0)+1);
      queued.add(id);
    }
    schedule();
  }
  return {
    get: project => cache.get(project)?.value,
    watch(ids) { watched = new Set(ids); ensure(watched); },
    ensure,
    invalidate(ids) { const targets = ids ? [...ids] : [...watched]; for(const id of targets){const old=cache.get(id);if(old) old.at=0;} ensure(targets.filter(id=>watched.has(id)),true); },
    accept(project, section, data) {
      epochs.set(project,(epochs.get(project)||0)+1);
      const previous=cache.get(project)?.value||{project};
      const value={...previous,[section]:{...data,hasNotes:!!data.markdown?.trim(),stale:false}};
      cache.set(project,{at:['builds','issues','plans'].every(key=>value[key])?now():0,value}); notify(project);
      if(inFlight.has(project)) queued.add(project);
    },
    markStale() { for(const id of watched){const item=cache.get(id);if(!item)continue;for(const section of ['builds','issues','plans'])if(item.value[section])item.value[section]={...item.value[section],stale:true};notify(id);} },
    destroy() { destroyed=true;queued.clear();watched.clear(); },
  };
}
