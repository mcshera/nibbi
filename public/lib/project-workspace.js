import { loadProjectSection } from './project-data.js';
import { describeProjectSection, buildStatusLabel, verificationLabel, buildGroup as groupForStatus, buildMatchesFilter, buildListGroup } from './project-summary.js';
import { createGithubPanel, githubDeliveryLabel } from './github-ui.js';

const labels = { builds: 'Builds', issues: 'Issues', plans: 'Plans' };
const viewLabels = {...labels, repository:'Repository & GitHub'};
const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
const button = (label, cls, action) => { const el = node('button', cls, label); el.type = 'button'; el.onclick = action; return el; };
const displayMarkdown = text => String(text || '').replace(/<!--\s*nibbi-(?:task|issue|milestone|current-milestone)\b[\s\S]*?-->/g, '');
const dateLabel = value => { const date = new Date(value || ''); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const workflow = run => buildStatusLabel(run.status);
const verification = run => verificationLabel(run.verification);
const buildGroup = run => groupForStatus(run.status);
const done = item => item.checked === true || item.done === true;
const itemText = item => item.text || item.title || item.name || 'Untitled';
const itemKey = item => item.id || `line-${item.line}`;
const sectionKey = selection => `${selection.project}\u0000${selection.section}`;
const pendingBuild = item => (item.linkedBuilds || []).some(run => ['active', 'review'].includes(buildGroup(run)));
const taskState = item => done(item) ? 'Completed' : (item.linkedBuilds || []).some(run => buildGroup(run) === 'review') ? 'Awaiting review' : (item.linkedBuilds || []).some(run => buildGroup(run) === 'active') ? 'Building' : 'Planned';
const commandLabels = { 'run.stop': 'Stop build', 'run.retry': 'Start replacement build', 'run.verify': 'Verify', 'run.discard': 'Discard', 'run.steer': 'Guide build', 'preview.start': 'Preview', 'preview.stop': 'Stop preview', 'run.merge': 'Merge locally' };

/** Section views retain their own drafts, filters and reading position. The app owns commands. */
export function installProjectWorkspace({ renderMarkdown, renderDiff, onNavigate, onAction, onClose, onData, load = loadProjectSection } = {}) {
  const el = node('section', 'project-workspace'); el.id = 'project-workspace'; el.hidden = true;
  el.setAttribute('aria-labelledby', 'project-workspace-title');
  const head = node('header', 'project-workspace-head');
  const title = node('h1', '', 'Project'); title.id = 'project-workspace-title'; title.tabIndex = -1;
  const back = button('Back to chat', 'project-text-button', () => onClose?.()); head.append(title, back);
  const tabs = node('nav', 'project-tabs'); tabs.setAttribute('aria-label', 'Project sections');
  const tabButtons = {};
  for (const [section, label] of Object.entries(labels)) {
    const b = button('', 'project-tab', () => onNavigate?.(current.project, section));
    b.append(node('span', 'project-tab-name', label), node('span', 'project-tab-count', 'Loading'));
    b.dataset.workspaceSection = section; tabs.append(b); tabButtons[section] = b;
  }
  const body = node('div', 'project-workspace-body'); body.tabIndex = 0;
  body.setAttribute('role', 'region'); body.setAttribute('aria-label', 'Project content');
  const notice = node('div', 'project-notice'); notice.setAttribute('role', 'status'); notice.hidden = true;
  const content = node('div', 'project-content'); body.append(notice, content); el.append(head, tabs, body); document.body.append(el);
  const views = new Map(), summaries = new Map(), actions = new Set();
  let current = null, generation = 0, controller = null, busy = false, pointerActive = false, pointerRelease = null;
  content.addEventListener('pointerdown', () => { clearTimeout(pointerRelease); pointerActive = true; }, true);
  content.addEventListener('click', () => { clearTimeout(pointerRelease); pointerActive = false; if (current && getView().noticePending) renderNotice(getView()); }, true);
  const finishPointer = () => { clearTimeout(pointerRelease); pointerRelease = setTimeout(() => { pointerActive = false; if (current && getView().noticePending) renderNotice(getView()); }, 0); };
  document.addEventListener('pointerup', finishPointer, true);
  document.addEventListener('pointercancel', finishPointer, true);
  function getView(selection = current) {
    const key = sectionKey(selection);
    if (!views.has(key)) views.set(key, { selection: { ...selection }, data: null, state: 'loading', filter: selection.section === 'issues' ? 'open' : 'all', search: '', grouped: true, open: new Set(), evidence: new Map(), scroll: 0, form: null, message: '', messageKind: '', pending: new Set(), deferred: false });
    return views.get(key);
  }
  function githubPanel(view, run) {
    view.githubPanels ||= new Map(); const key = run?.id || 'repository';
    if (!view.githubPanels.has(key)) view.githubPanels.set(key, createGithubPanel({project:view.selection.project,buildId:run?.id,run,onAction,renderMarkdown,renderDiff,onChanged:async()=>{if(view.selection.section!=='repository'){const result=await load(view.selection);accept(view,result,true);if(isCurrent(view))render(true);}}}));
    return view.githubPanels.get(key);
  }
  const isCurrent = view => current && sectionKey(current) === sectionKey(view.selection) && !el.hidden;
  const show = (view, text, kind = '') => { view.message = text; view.messageKind = kind; if (isCurrent(view)) renderNotice(view); };
  function renderNotice(view) {
    // Even a notice can move the pressed control before pointerup reaches it.
    if (pointerActive) { view.noticePending = true; return; }
    view.noticePending = false;
    notice.replaceChildren();
    const warnings = (view.data?.warnings || []).map(item => typeof item === 'string' ? item : item.message).filter(Boolean);
    if (view.state === 'stale') warnings.unshift('Showing the last available records. Refresh to reconnect.');
    if (view.deferred) warnings.push('Updated records are available. Your place and unsaved text are preserved.');
    const copy = [view.message, ...warnings].filter(Boolean).join(' ');
    notice.hidden = !copy; notice.dataset.kind = view.messageKind;
    if (copy) notice.append(node('span', '', copy));
    if (view.deferred) notice.append(button('Show updates', 'project-text-button', () => render(true)));
    if (view.state === 'stale' || view.state === 'error') notice.append(button('Try again', 'project-text-button', () => void refresh()));
  }
  function updateTabs() {
    if (!current) return;
    const projectSummaries = summaries.get(current.project) || {};
    for (const [section, b] of Object.entries(tabButtons)) {
      const cached = views.get(sectionKey({ ...current, section }));
      const raw = section === current.section && cached?.data ? cached.data : projectSummaries[section] || cached?.data;
      const summary = describeProjectSection(section, raw);
      const label = summary.badge;
      b.querySelector('.project-tab-count').textContent = label;
      b.setAttribute('aria-label', `${current.project}, ${labels[section]}, ${summary.accessible || label}${summary.stale || cached?.state === 'stale' ? ', stale' : ''}`);
      b.dataset.freshness = summary.stale || cached?.state === 'stale' ? 'stale' : raw?.status || cached?.state || 'loading';
      if (section === current.section) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
  }
  function accept(view, data, force = false) {
    if (!force && isCurrent(view) && view.data && (pointerActive || view.deferred || view.form || content.contains(document.activeElement))) {
      view.pendingData = data; view.deferred = true; renderNotice(view); return;
    }
    view.pendingData = null;
    view.data = data; view.state = data.status || 'ready'; onData?.(view.selection, data); updateTabs();
  }
  function action(label, perform, { primary = false, key = label, disabled = false, reason, mutating = true } = {}) {
    const view = getView();
    const b = button(label, 'project-action' + (primary ? ' primary' : ''), async () => {
      if (view.pending.has(key)) return;
      view.pending.add(key); b.disabled = true; b.setAttribute('aria-busy', 'true');
      show(view, `${label}…`);
      try { await perform(view); }
      catch (error) { show(view, error?.message || 'Could not complete this action. Try again.', 'error'); }
      finally { view.pending.delete(key); if (b.isConnected) { b.disabled = disabled || (mutating && busy); b.removeAttribute('aria-busy'); } }
    });
    b.dataset.intrinsicDisabled = String(disabled); b.dataset.mutating = String(mutating); b.dataset.actionKey = key;
    b.disabled = disabled || (mutating && busy) || view.pending.has(key);
    if (reason) b.title = reason;
    actions.add(b); return b;
  }
  async function sendCommand(view, payload, message = 'Saved.') {
    const result = await onAction?.('projectCommand', view.selection.project, payload);
    if (!result) throw new Error('No save confirmation was received. Refresh before trying again.');
    if (result.ok === false) throw new Error(result.error?.message || 'Could not save the change.');
    if (result.section && typeof result.section === 'object') accept(view, result.section, true);
    if (result.plan && typeof result.plan === 'object') accept(getView({ ...view.selection, section: 'plans' }), result.plan);
    if (result.itemId) { view.open.add(String(result.itemId)); view.open.add(`issue-${result.itemId}`); view.open.add(`task-${result.itemId}`); }
    show(view, message, 'success');
    if (isCurrent(view)) { render(true); if (!result.section) await refresh({ preserveMessage: true }); }
    return result;
  }
  function toolbar(summary, controls = []) {
    const row = node('div', 'project-toolbar'); row.append(node('p', 'project-summary', summary));
    const group = node('div', 'project-toolbar-actions'); group.append(button('Refresh', 'project-text-button', () => void refresh()), ...controls); row.append(group); return row;
  }
  function documentView(markdown) {
    const doc = node('div', 'project-document said');
    if (renderMarkdown) doc.append(renderMarkdown(displayMarkdown(markdown))); else doc.textContent = displayMarkdown(markdown);
    return doc;
  }
  function empty(title, description) { const state = node('div', 'project-empty'); state.append(node('h2', '', title), node('p', '', description)); return state; }
  function disclosure(key, label, cls = '', initiallyOpen = false) {
    const view = getView(), detail = node('details', cls); detail.dataset.detailKey = key;
    detail.open = view.open.has(key) || initiallyOpen;
    if (initiallyOpen) view.open.add(key);
    detail.append(typeof label === 'string' ? node('summary', '', label) : label);
    detail.addEventListener('toggle', () => { if (!detail.isConnected) return; if (detail.open) view.open.add(key); else view.open.delete(key); });
    return detail;
  }
  function filters(options, label) {
    const view = getView(), row = node('div', 'project-filters'); row.setAttribute('role', 'group'); row.setAttribute('aria-label', label);
    for (const [key, name, count] of options) {
      const b = button(`${name} ${count}`, 'project-filter', () => { view.filter = key; if (view.selection.section === 'builds') view.selectedBuild = null; render(true); content.querySelector(`[data-filter="${key}"]`)?.focus({ preventScroll: true }); });
      b.dataset.filter = key; b.setAttribute('aria-pressed', String(view.filter === key)); row.append(b);
    }
    return row;
  }
  function source(markdown, label) {
    if (!markdown?.trim()) return;
    const full = disclosure('source', label, 'project-source'); full.append(documentView(markdown)); content.append(full);
  }
  function formHost() { const host = node('div', 'project-form-host'); if (getView().form) host.append(getView().form.element); return host; }
  function beginForm(spec) {
    const view = getView();
    if (view.form) { view.form.element.querySelector('input,textarea,select')?.focus(); show(view, 'Finish or cancel the open form before starting another.'); return; }
    const form = node('form', 'project-inline-form'); form.setAttribute('aria-label', spec.heading);
    form.append(node('h2', '', spec.heading), node('p', 'project-muted', `Saving to ${view.selection.project} · ${labels[view.selection.section]}`));
    const fields = {}, revision = view.renderedRevision || view.data?.revision;
    for (const field of spec.fields) {
      const label = node('label', 'project-field'), span = node('span', '', field.label);
      const input = node(field.options ? 'select' : field.multiline ? 'textarea' : 'input');
      input.name = field.name; input.required = field.required || false;
      input.setAttribute('aria-label', field.label);
      if (field.multiline) input.rows = 4;
      if (field.maxLength) input.maxLength = field.maxLength;
      if (field.options) for (const option of field.options) { const el = node('option', '', option.label); el.value = option.value; input.append(el); }
      input.value = field.value || ''; fields[field.name] = input;
      label.append(span, input); if (field.hint) label.append(node('small', 'project-muted', field.hint)); form.append(label);
    }
    const error = node('p', 'project-form-error'); error.setAttribute('role', 'alert'); error.hidden = true; form.append(error);
    const row = node('div', 'project-toolbar-actions'), submit = node('button', 'project-action primary', spec.submit || 'Save'); submit.type = 'submit';
    const cancel = button('Cancel', 'project-action', () => { view.form = null; view.deferred = false; render(true); }); row.append(submit, cancel); form.append(row);
    let submitting = false;
    form.onsubmit = async event => {
      event.preventDefault(); if (submitting || busy || !form.reportValidity()) return;
      const values = Object.fromEntries(Object.entries(fields).map(([name, input]) => [name, input.value.trim()]));
      submitting = true; if (view.form) view.form.submitting = true; submit.disabled = true; cancel.disabled = true; for (const input of Object.values(fields)) input.disabled = true; submit.textContent = spec.buildCommand ? 'Sending…' : 'Saving…'; error.hidden = true;
      try {
        const result = await onAction?.(spec.buildCommand ? 'buildCommand' : 'projectCommand', view.selection.project, spec.buildCommand ? { ...spec.payload, args: values } : { ...spec.payload, ...values, expectedRevision: revision });
        if (!result || result.ok === false) throw new Error(result?.error?.message || 'No save confirmation was received. Refresh before trying again.');
        view.form = null; view.deferred = false;
        if (result.section && typeof result.section === 'object') accept(view, result.section, true);
        if (result.plan) accept(getView({ ...view.selection, section: 'plans' }), result.plan);
        if (result.itemId) { view.open.add(`issue-${result.itemId}`); view.open.add(`task-${result.itemId}`); view.open.add(`milestone-${result.itemId}`); }
        if (spec.payload.action === 'issue.create') view.filter = 'open';
        if (['issue.create', 'issue.edit'].includes(spec.payload.action)) view.search = '';
        show(view, spec.success || 'Saved.', 'success');
        if (isCurrent(view)) {
          render(true);
          const saved = result.itemId && [...content.querySelectorAll('[data-record-id]')].find(el => el.dataset.recordId === result.itemId);
          saved?.scrollIntoView({ block: 'nearest' }); saved?.querySelector('summary')?.focus({ preventScroll: true });
          if (!result.section) await refresh({ preserveMessage: true });
        }
      } catch (err) {
        error.textContent = err?.message || 'Could not save. Your text is still here.'; error.hidden = false;
        if (err?.code === 'REVISION_CONFLICT' || err?.status === 409 || /revision|changed|conflict/i.test(error.textContent)) {
          error.textContent += ' Your text is preserved. Cancel to review the latest records, then reapply your changes.';
          if (isCurrent(view)) void refresh({ preserveMessage: true });
        }
      } finally { submitting = false; if (view.form) view.form.submitting = false; submit.disabled = busy; cancel.disabled = false; for (const input of Object.values(fields)) input.disabled = false; submit.textContent = spec.submit || 'Save'; }
    };
    view.form = { element: form, revision }; render(true); form.querySelector('input,textarea,select')?.focus(); form.scrollIntoView({ block: 'nearest' });
  }
  const textFields = (item = {}) => [
    { name: 'title', label: 'Title', required: true, value: item?.text || item?.title || item?.name || '', maxLength: 1000 },
    { name: 'description', label: 'Description', multiline: true, value: item?.description || '', hint: 'Keep details, reproduction steps, or the intended result here.' },
  ];
  function editIssue(item) { beginForm({ heading: item ? 'Edit issue' : 'New issue', fields: textFields(item), payload: { action: item ? 'issue.edit' : 'issue.create', ...(item ? { id: item.id } : {}) }, success: item ? 'Issue updated.' : 'Issue saved.' }); }
  function editMilestone(item) { beginForm({ heading: item ? 'Edit milestone' : 'New milestone', fields: textFields(item), payload: { action: item ? 'milestone.edit' : 'milestone.create', ...(item ? { id: item.id } : {}) }, success: item ? 'Milestone updated.' : 'Milestone saved.' }); }
  function editTask(item, milestoneId) {
    const view = getView(), milestones = view.data.milestones || [];
    const fields = textFields(item);
    if (milestones.length) fields.push({ name: 'milestoneId', label: 'Milestone', value: milestoneId || item?.milestoneId || '', options: [{ value: '', label: 'Outside a milestone' }, ...milestones.map(m => ({ value: m.id, label: m.name }))] });
    beginForm({ heading: item ? 'Edit task' : 'New task', fields, payload: { action: item ? 'task.edit' : 'task.create', ...(item ? { id: item.id } : {}), ...(milestoneId ? { milestoneId } : {}) }, success: item ? 'Task updated.' : 'Task saved.' });
  }
  async function issueToPlan(view, item) {
    const planSelection = { ...view.selection, section: 'plans' }, plan = await load(planSelection);
    accept(getView(planSelection), plan);
    if (!isCurrent(view)) return;
    if (!plan.revision) throw new Error('The plan revision is unavailable. Refresh Plans before adding this issue.');
    const options = (plan.milestones || []).map(m => ({ value: m.id, label: m.name }));
    beginForm({ heading: `Add to plan: ${itemText(item)}`, fields: [{ name: 'milestoneId', label: 'Destination milestone', options: [{ value: '', label: 'Outside a milestone' }, ...options] }], payload: { action: 'issue.plan', id: item.id, planRevision: plan.revision }, submit: 'Add to plan', success: 'Issue added to the plan. The saved task is linked to this issue.' });
    show(view, 'Choose where this issue belongs in the plan.');
  }
  function linkedBuilds(item) {
    const view = getView(), list = node('div', 'project-related');
    for (const run of item.linkedBuilds || []) {
      const b = button(`${run.title || run.id} · ${workflow(run)}`, 'project-related-link', () => {
        const target = getView({ ...view.selection, section: 'builds' }); target.selectedBuild = run.id; target.open.add(`build-${run.id}`); target.filter = 'all';
        onNavigate?.(view.selection.project, 'builds');
      }); list.append(b);
    }
    if ((item.linkedTaskIds || []).length) list.append(button(`${item.linkedTaskIds.length} linked plan task${item.linkedTaskIds.length === 1 ? '' : 's'}`, 'project-related-link', () => onNavigate?.(view.selection.project, 'plans')));
    return list;
  }
  function issueRow(item) {
    const view = getView(), summary = node('summary', 'project-record-summary'), copy = node('span', 'project-record-copy');
    copy.append(node('strong', '', itemText(item))); if (item.heading && !view.grouped) copy.append(node('span', 'project-muted', item.heading));
    summary.append(copy, node('span', 'project-record-status', done(item) ? 'Completed' : 'Open'));
    const row = disclosure(`issue-${itemKey(item)}`, summary, 'project-record project-issue' + (done(item) ? ' completed' : '')); row.dataset.recordId = item.id || '';
    const detail = node('div', 'project-record-detail'); detail.append(item.description ? documentView(item.description) : node('p', 'project-muted', 'No description yet. Add details or reproduction steps with Edit.'));
    detail.append(linkedBuilds(item));
    for(const linked of item.githubIssueLinks||[]){let url;try{url=new URL(linked.url);}catch{continue;}if(!['https:','http:'].includes(url.protocol))continue;const a=node('a','project-related-link',`GitHub issue · ${linked.repository} #${linked.number}`);a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';detail.append(a);}
    if (item.id && view.data.revision) {
      const group = node('div', 'project-toolbar-actions');
      if (!done(item)) {
        group.append(action(pendingBuild(item) ? 'Build already linked' : 'Build a fix', v => sendCommand(v, { action: 'issue.build', id: item.id, expectedRevision: v.data.revision }, 'Fix build started. The issue remains open until you complete it or its linked fix merges.'), { primary: true, key: `issue.build-${item.id}`, disabled: pendingBuild(item) }));
        group.append(action((item.linkedTaskIds || []).length ? 'Added to plan' : 'Add to plan', v => issueToPlan(v, item), { disabled: (item.linkedTaskIds || []).length > 0 }));
      }
      group.append(action('Edit', () => editIssue(item)), action(done(item) ? 'Reopen issue' : 'Complete issue', v => sendCommand(v, { action: done(item) ? 'issue.reopen' : 'issue.complete', id: item.id, expectedRevision: v.data.revision }, done(item) ? 'Issue reopened.' : 'Issue completed.')));
      detail.append(group);
    }
    row.append(detail); return row;
  }
  function renderIssues() {
    const view = getView(), data = view.data, items = data.items || [], total = items.length, complete = items.filter(done).length;
    const canEdit = !!data.revision;
    content.append(toolbar(data.counts ? `${data.counts.open} open · ${data.counts.done} completed` : total ? `${total - complete} open · ${complete} completed` : data.markdown?.trim() ? 'Issue notes' : 'Project issues', [action('New issue', () => canEdit ? editIssue() : onAction?.('newIssue', current.project), { primary: true })]), formHost());
    content.append(filters([['open', 'Open', total - complete], ['done', 'Completed', complete], ['all', 'All', total]], 'Issue status'));
    if (!total) {
      if (data.markdown?.trim()) { content.append(node('p', 'project-muted', 'These notes do not contain checklist issues yet. Add an issue to make it actionable.'), documentView(data.markdown)); }
      else content.append(empty(data.status === 'partial' ? 'Issue list is incomplete' : 'No issues yet', data.status === 'partial' ? 'Refresh to read the unavailable records.' : 'Capture a bug, an idea, or something that needs attention.'));
      return;
    }
    const tools = node('div', 'project-list-tools'), searchLabel = node('label', 'project-search');
    searchLabel.append(node('span', 'project-sr-only', 'Search issues'));
    const search = node('input'); search.type = 'search'; search.placeholder = 'Search issues'; search.value = view.search; search.setAttribute('aria-label', 'Search issues');
    search.oninput = () => { view.search = search.value; renderIssueResults(); }; searchLabel.append(search); tools.append(searchLabel);
    const grouping = button(view.grouped ? 'Grouped by heading' : 'Group by heading', 'project-filter', () => { view.grouped = !view.grouped; grouping.textContent = view.grouped ? 'Grouped by heading' : 'Group by heading'; grouping.setAttribute('aria-pressed', String(view.grouped)); renderIssueResults(); }); grouping.setAttribute('aria-pressed', String(view.grouped)); tools.append(grouping); content.append(tools);
    const results = node('div', 'project-issue-results'); results.id = 'project-issue-results'; content.append(results); renderIssueResults();
    source(data.markdown, 'Read full issue notes');
  }
  function renderIssueResults() {
    const view = getView(), results = content.querySelector('.project-issue-results'); if (!results) return;
    results.replaceChildren(); const query = view.search.toLocaleLowerCase();
    const items = (view.data.items || []).filter(item => (view.filter === 'all' || done(item) === (view.filter === 'done')) && `${itemText(item)} ${item.description || ''} ${item.heading || ''}`.toLocaleLowerCase().includes(query));
    if (!items.length) { results.append(empty(query ? 'No matching issues' : view.filter === 'open' ? 'No open issues' : 'No completed issues', query ? 'Try a different search or choose another filter.' : view.filter === 'open' ? 'Everything in this issue list is complete.' : 'Completed issues will appear here.')); return; }
    const groups = new Map(); for (const item of items) { const heading = view.grouped ? item.heading || 'Other issues' : ''; if (!groups.has(heading)) groups.set(heading, []); groups.get(heading).push(item); }
    for (const [heading, records] of groups) { if (heading) results.append(node('h2', 'project-group-title', `${heading} · ${records.length}`)); for (const item of records) results.append(issueRow(item)); }
  }
  function buildEvidence(run, detail) {
    const view = getView(), key = run.id, active = view.evidence.get(key) || { kind: 'summary' };
    const tabs = node('div', 'project-evidence-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', `Evidence for ${run.title || run.id}`);
    const panel = node('div', 'project-evidence-panel'); panel.setAttribute('aria-live', 'polite');
    const paint = () => {
      const selected = view.evidence.get(key) || active; selected.repaint = paint; panel.replaceChildren();
      for (const b of tabs.children) b.setAttribute('aria-pressed', String(b.dataset.kind === selected.kind));
      if (selected.loading) { panel.append(node('p', 'project-muted', `Loading ${selected.kind}…`)); return; }
      if (selected.error) { panel.append(node('p', 'project-form-error', selected.error), button('Try again', 'project-action', () => void select(selected.kind, true))); return; }
      if (selected.kind === 'summary') {
        panel.append(run.summary ? documentView(run.summary) : node('p', 'project-muted', 'No change summary has been reported. Inspect the log for current activity.'));
        if (run.currentActivity || run.activity) panel.append(node('p', 'project-activity', typeof (run.currentActivity || run.activity) === 'string' ? run.currentActivity || run.activity : 'Build activity is available in the log.'));
        const meta = [run.provider, Number.isFinite(run.costUsd) ? `$${run.costUsd.toFixed(2)}` : '', run.id].filter(Boolean).join(' · '); panel.append(node('p', 'project-muted', meta)); return;
      }
      if (selected.kind === 'github') { const github = githubPanel(view,run); panel.append(github.element); github.setBusy(busy); github.open(); return; }
      const evidence = selected.value || {};
      if (selected.kind === 'checks') {
        const check = evidence.verification || evidence.data?.verification || run.verification;
        panel.append(node('h3', '', `Verification: ${verification({ verification: check })}`));
        if (check?.command) panel.append(node('pre', 'project-evidence-code', check.command));
        if (run.lastVerifiedSha || run.github?.headSha && check?.status === 'passed') panel.append(node('p','project-muted',`Locally tested commit: ${run.lastVerifiedSha || run.commitSha || run.github.headSha}`));
        if (check?.at) panel.append(node('p', 'project-muted', dateLabel(check.at)));
        const info = check?.detail || evidence.detail || evidence.text; if (info) panel.append(node('pre', 'project-evidence-code', info));
        if (!info && !check?.command) panel.append(node('p', 'project-muted', 'No verification evidence is available for this build.'));
        if (run.github?.mode === 'github') { panel.append(node('h3','','GitHub checks'),node('p','project-muted',run.github.checks?.status ? String(run.github.checks.status).replaceAll('_',' ') : 'Unavailable')); if (run.github.checks?.blockers?.length) panel.append(node('p','project-muted',run.github.checks.blockers.join(' '))); panel.append(button('Inspect GitHub checks','project-action',()=>void select('github'))); }
      } else if (selected.kind === 'changes') {
        const diff = typeof evidence === 'string' ? evidence : evidence.diff || evidence.data?.diff || evidence.text || '';
        if (diff && renderDiff) { const rendered = renderDiff(typeof evidence === 'string' ? { diff: evidence } : evidence); if (typeof rendered === 'string') panel.append(node('pre', 'project-evidence-code', diff)); else if (rendered) panel.append(rendered); }
        else panel.append(node('pre', 'project-evidence-code', diff || 'No diff is available for this build.'));
      } else {
        const entries = evidence.entries || evidence.data?.entries || evidence.log;
        const text = typeof evidence === 'string' ? evidence : typeof entries === 'string' ? entries : Array.isArray(entries) ? entries.map(entry => typeof entry === 'string' ? entry : [entry.timestamp || entry.at || entry.time, entry.text || entry.message || entry.content || JSON.stringify(entry)].filter(Boolean).join(' ')).join('\n') : evidence.text || '';
        panel.append(node('pre', 'project-evidence-code', text || 'No log entries have been reported.'));
      }
    };
    const select = async (kind, force = false) => {
      if (kind === 'summary' || kind === 'github') { view.evidence.set(key, { kind }); paint(); return; }
      const existing = view.evidence.get(key);
      if (!force && existing?.kind === kind && existing.value) { paint(); return; }
      const request = { kind, loading: true }; view.evidence.set(key, request); paint();
      try { request.value = await onAction?.('buildEvidence', view.selection.project, { id: run.id, kind }); }
      catch (error) { request.error = error.message || `Could not read ${kind}.`; }
      finally { request.loading = false; if (view.evidence.get(key) === request) request.repaint?.(); }
    };
    for (const [kind, label] of [['summary', 'Summary'], ['changes', 'Changes'], ['checks', 'Checks'], ['github','GitHub'], ['log', 'Log']]) {
      const b = button(label, 'project-filter', () => void select(kind)); b.dataset.kind = kind; tabs.append(b);
    }
    detail.append(tabs, panel); paint();
    const controls = node('div', 'project-toolbar-actions');
    const confirmation = node('div', 'project-confirmation'); confirmation.hidden = true;
    const executeBuild = async (v, command) => {
      v.confirmation = null; confirmation.hidden = true;
      const result = await onAction?.('buildCommand', v.selection.project, { id: run.id, command });
      show(v, result?.text || 'Build updated.', 'success'); if (isCurrent(v)) await refresh({ preserveMessage: true });
    };
    const confirmBuild = command => {
      const verb = { 'run.merge': 'merge', 'run.discard': 'discard', 'run.stop': 'stop' }[command];
      view.confirmation = { runId: run.id, command }; confirmation.replaceChildren(); confirmation.hidden = false;
      confirmation.append(node('p', '', `${verb === 'merge' ? 'Merge the reviewed changes from' : verb === 'discard' ? 'Discard the retained changes from' : 'Stop'} “${run.title || run.id}” in ${view.selection.project}?`));
      const row = node('div', 'project-toolbar-actions');
      row.append(action(`Confirm ${verb}`, v => executeBuild(v, command), { primary: true, key: `confirm-${run.id}-${command}` }), button('Cancel', 'project-action', () => { view.confirmation = null; confirmation.hidden = true; }));
      confirmation.append(row);
    };
    controls.append(action(buildGroup(run) === 'review' ? 'Review changes' : buildGroup(run) === 'failed' ? 'Inspect failure' : buildGroup(run) === 'active' ? 'View activity' : 'View result', () => select(buildGroup(run) === 'failed' || buildGroup(run) === 'active' ? 'log' : 'changes'), { mutating: false }));
    for (const command of run.allowedActions || []) if (commandLabels[command]) controls.append(action(commandLabels[command], async v => {
      if (command === 'run.steer') {
        beginForm({ heading: `Guide build: ${run.title || run.id}`, fields: [{ name: 'text', label: 'Instruction', multiline: true, required: true }], buildCommand: true, payload: { id: run.id, command }, submit: 'Send instruction', success: 'Build instruction sent.' });
        return;
      }
      if (['run.merge', 'run.discard', 'run.stop'].includes(command)) { confirmBuild(command); show(v, 'Confirm this build action below.'); return; }
      await executeBuild(v, command);
    }, { primary: command === 'run.merge', key: `${run.id}-${command}` }));
    detail.append(controls, confirmation);
    if (view.confirmation?.runId === run.id && run.allowedActions?.includes(view.confirmation.command)) confirmBuild(view.confirmation.command);
  }
  function renderBuilds() {
    const view = getView(), runs = view.data.runs || [], count = group => runs.filter(run => buildMatchesFilter(run,group)).length;
    content.append(toolbar(`${runs.length} build${runs.length === 1 ? '' : 's'}`, [action('Repository & GitHub',()=>onNavigate?.(view.selection.project,'repository'),{mutating:false}),action('New build', () => onAction?.('newBuild', current.project), { primary: true })]), formHost());
    const extra = [['toPush','To push',count('toPush')],['pullRequests','Pull requests',count('pullRequests')],['attention','Needs attention',count('attention')]];
    content.append(filters([['all', 'All', runs.length], ['active', 'Active', count('active')], ['review', 'Review', count('review')],...extra,['history', 'History',count('history')]], 'Build status'));
    if (!runs.length) { content.append(empty(view.data.status === 'partial' ? 'Build history is incomplete' : 'No builds yet', 'Start a build to give Nibbi something to work on for this project.')); return; }
    const returnToList = () => { view.selectedBuild = null; render(true); body.scrollTop = view.listScroll ?? body.scrollTop; };
    if (view.selectedBuild) content.append(button('Back to build list', 'project-text-button project-build-return', returnToList));
    const list = node('div', 'project-build-list'); if (view.selectedBuild) list.classList.add('has-selection');
    const groupLabels = { active: 'Active work', review: 'Awaiting local review', attention: 'Needs attention',toPush:'Ready to push',pullRequests:'Pull requests', history: 'History' };
    let shown = 0;
    for (const group of ['active', 'attention','toPush','pullRequests','review','history']) {
      const records = runs.filter(run => buildListGroup(run) === group && buildMatchesFilter(run,view.filter)); if (!records.length) continue;
      list.append(node('h2', 'project-group-title', `${groupLabels[group]} · ${records.length}`));
      for (const run of records) {
        shown++; const summary = node('summary'), left = node('span', 'project-build-label'); left.append(node('strong', '', run.title || run.issue || run.id));
        if (run.branch) left.append(node('span','project-build-branch',`${run.branch} → ${run.github?.baseBranch || run.targetBranch || 'Target unavailable'}`));
        left.append(node('span', 'project-muted', [`Checks: ${verification(run)}`, dateLabel(run.endedAt || run.startedAt)].filter(Boolean).join(' · ')));
        left.append(node('span','project-muted project-build-delivery',githubDeliveryLabel(run)));
        const status = node('span', 'project-build-status', workflow(run)); status.dataset.status = run.status; summary.append(left, status);
        const row = disclosure(`build-${run.id}`, summary, 'project-build'); row.dataset.buildId = run.id; if (view.selectedBuild === run.id) row.classList.add('is-selected');
        summary.addEventListener('click', () => { if (!row.open) { view.listScroll = body.scrollTop; view.selectedBuild = run.id; list.classList.add('has-selection'); for (const child of list.querySelectorAll('.project-build')) child.classList.toggle('is-selected', child === row); if (!content.querySelector('.project-build-return')) { const back = button('Back to build list', 'project-text-button project-build-return', returnToList); list.before(back); } } });
        const detail = node('div', 'project-build-detail'); buildEvidence(run, detail); row.append(detail); list.append(row);
      }
    }
    content.append(shown ? list : empty(`No ${view.filter === 'review' ? 'builds awaiting review' : `${view.filter} builds`}`, 'Choose another filter to see the rest of this project’s work.'));
  }
  function reorderControl(records, item, actionName, milestoneId) {
    const view = getView(), index = records.findIndex(record => record.id === item.id), row = node('div', 'project-order-actions');
    for (const [delta, label] of [[-1, 'Move up'], [1, 'Move down']]) row.append(action(label, v => {
      const ids = records.map(record => record.id); [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
      return sendCommand(v, { action: actionName, ids, ...(milestoneId ? { milestoneId } : {}), expectedRevision: view.data.revision }, 'Order updated.');
    }, { disabled: index + delta < 0 || index + delta >= records.length, key: `${actionName}-${item.id}-${delta}` }));
    return row;
  }
  function taskRow(task, allTasks, milestoneId) {
    const view = getView(), summary = node('summary', 'project-record-summary'); summary.append(node('strong', '', itemText(task)), node('span', 'project-record-status', taskState(task)));
    const row = disclosure(`task-${itemKey(task)}`, summary, 'project-record project-task' + (done(task) ? ' completed' : '')); row.dataset.recordId = task.id || '';
    const detail = node('div', 'project-record-detail');
    if (task.description) detail.append(documentView(task.description));
    detail.append(linkedBuilds(task));
    if (task.id && view.data.revision) {
      const actions = node('div', 'project-toolbar-actions');
      if (!done(task)) actions.append(action(pendingBuild(task) ? 'Build already linked' : 'Build this task', v => sendCommand(v, { action: 'task.build', id: task.id, expectedRevision: v.data.revision }, 'Task build started. The task remains unfinished until its linked build merges successfully.'), { primary: true, disabled: pendingBuild(task), key: `task.build-${task.id}` }));
      actions.append(action('Edit task', () => editTask(task, milestoneId))); detail.append(actions, reorderControl(allTasks, task, 'task.reorder', milestoneId));
    }
    if (!detail.childElementCount) detail.append(node('p', 'project-muted', 'No further task details.'));
    row.append(detail); return row;
  }
  function renderPlans() {
    const view = getView(), data = view.data, milestones = data.milestones || [], items = data.items || milestones.flatMap(m => m.tasks || []), counts = data.counts;
    const hasPlan = !!data.markdown?.trim() || milestones.length > 0 || items.length > 0, canEdit = !!data.revision;
    const controls = [];
    if (canEdit) controls.push(action(hasPlan ? 'Add milestone' : 'Create milestone', () => editMilestone(), { primary: true }));
    controls.push(action(hasPlan ? 'Discuss plan changes' : 'Discuss a plan', () => onAction?.(hasPlan ? 'editPlan' : 'newPlan', current.project)));
    content.append(toolbar(counts ? `${counts.done} of ${counts.total} tasks complete` : data.markdown?.trim() ? 'Written plan' : 'Project roadmap', controls), formHost());
    if (!hasPlan) { content.append(empty(data.status === 'partial' ? 'Plan is unavailable' : 'No plan yet', data.status === 'partial' ? 'Some plan information could not be read. Refresh to try again.' : 'Give the next milestone an outcome, then add the tasks that will get it there.')); return; }
    if (data.outcome) { const outcome = node('section', 'project-plan-outcome'); outcome.append(node('h2', '', 'Outcome'), documentView(data.outcome)); content.append(outcome); }
    const currentMilestone = data.currentMilestone || data.focusedMilestone;
    if (currentMilestone) content.append(node('p', 'project-plan-focus', `Current milestone: ${typeof currentMilestone === 'string' ? currentMilestone : currentMilestone.name}`));
    const first = items.find(item => !done(item));
    if (first) {
      const next = node('div', 'project-next-task'); next.append(node('span', 'project-muted', 'First unfinished'), button(itemText(first), 'project-next-link', () => {
        view.open.add(`task-${itemKey(first)}`); if (first.milestoneId) view.open.add(`milestone-${first.milestoneId}`); render(true);
        const row = [...content.querySelectorAll('[data-record-id]')].find(row => row.dataset.recordId === first.id); row?.scrollIntoView({ block: 'nearest' }); row?.querySelector('summary')?.focus();
      })); content.append(next);
    } else if (items.length) content.append(empty('This plan is complete', 'Add the next milestone when you are ready to continue. Completed work stays below.'));
    const activeMilestones = milestones.filter(m => (m.tasks || []).some(task => !done(task)) || !(m.tasks || []).length), completedMilestones = milestones.filter(m => (m.tasks || []).length && (m.tasks || []).every(done));
    const milestoneRow = milestone => {
      const tasks = milestone.tasks || items.filter(item => item.milestoneId === milestone.id), summary = node('summary', 'project-milestone-summary');
      summary.append(node('strong', '', milestone.name), node('span', 'project-muted', `${milestone.done ?? tasks.filter(done).length}/${milestone.total ?? tasks.length} tasks`));
      const firstOpen = !view.openInitialized && activeMilestones[0]?.id === milestone.id;
      const row = disclosure(`milestone-${milestone.id || milestone.name}`, summary, 'project-milestone', firstOpen); row.dataset.recordId = milestone.id || '';
      if (milestone.description) row.append(documentView(milestone.description));
      if (canEdit && milestone.id) {
        const controls = node('div', 'project-toolbar-actions project-milestone-actions');
        controls.append(action('Add task', () => editTask(null, milestone.id)), action('Edit milestone', () => editMilestone(milestone)));
        if (currentMilestone?.id !== milestone.id) controls.append(action('Set current milestone', v => sendCommand(v, { action: 'milestone.select', id: milestone.id, expectedRevision: v.data.revision }, 'Current milestone updated.')));
        row.append(controls, reorderControl(milestones, milestone, 'milestone.reorder'));
      }
      const unfinished = tasks.filter(task => !done(task)), completed = tasks.filter(done);
      for (const task of unfinished) row.append(taskRow(task, tasks, milestone.id));
      if (completed.length) { const history = disclosure(`completed-${milestone.id}`, `Completed tasks · ${completed.length}`, 'project-completed-tasks'); for (const task of completed) history.append(taskRow(task, tasks, milestone.id)); row.append(history); }
      if (!tasks.length) row.append(node('p', 'project-muted', 'No tasks in this milestone yet.'));
      return row;
    };
    const list = node('div', 'project-milestones'); for (const milestone of activeMilestones) list.append(milestoneRow(milestone)); content.append(list);
    const assigned = new Set(milestones.flatMap(m => (m.tasks || []).map(itemKey))), ungrouped = items.filter(item => !assigned.has(itemKey(item)) && !milestones.some(m => m.id === item.milestoneId));
    if (ungrouped.length || (!milestones.length && canEdit)) {
      content.append(node('h2', 'project-group-title', 'Tasks'));
      if (canEdit) content.append(action('Add task', () => editTask()));
      for (const task of ungrouped.filter(task => !done(task))) content.append(taskRow(task, ungrouped));
      const completed = ungrouped.filter(done); if (completed.length) { const history = disclosure('completed-ungrouped', `Completed tasks · ${completed.length}`, 'project-completed-tasks'); for (const task of completed) history.append(taskRow(task, ungrouped)); content.append(history); }
    }
    if (completedMilestones.length) { const history = disclosure('completed-milestones', `Completed milestones · ${completedMilestones.length}`, 'project-plan-history'); for (const milestone of completedMilestones) history.append(milestoneRow(milestone)); content.append(history); }
    view.openInitialized = true;
    if (!items.length && !milestones.length && data.markdown?.trim()) content.append(node('p', 'project-muted', 'This is a written plan. Add a milestone and tasks when you are ready to track its progress.'));
    source(data.markdown, 'Read full plan');
  }
  function render(force = false) {
    if (!current) return;
    const view = getView();
    // Keep the actual focused node and any open form in place during live reads.
    if (!force && (pointerActive || view.deferred || view.form || content.contains(document.activeElement))) { view.deferred = true; renderNotice(view); updateTabs(); return; }
    if (view.pendingData) accept(view, view.pendingData, true);
    view.deferred = false; view.renderedRevision = view.data?.revision; const scroll = body.scrollTop;
    content.replaceChildren(); actions.clear();
    if (current.section === 'repository') { content.append(button('Back to builds','project-text-button',()=>onNavigate?.(current.project,'builds'))); const github=githubPanel(view);content.append(github.element);github.setBusy(busy); }
    else if (view.data) { if (current.section === 'builds') renderBuilds(); else if (current.section === 'issues') renderIssues(); else renderPlans(); }
    else if (view.state === 'error') content.append(empty(`Could not load ${labels[current.section].toLowerCase()}`, 'The records are unavailable. Try again when Nibbi is connected.'));
    else content.append(node('p', 'project-loading', `Loading ${labels[current.section].toLowerCase()}…`));
    body.scrollTop = scroll; renderNotice(view); updateTabs();
  }
  // Applying deferred records is explicit. Blur can occur between pointerdown and
  // click, when activeElement is briefly body; replacing rows there drops clicks.
  body.addEventListener('scroll', () => { if (current) getView().scroll = body.scrollTop; }, { passive: true });
  async function refresh({ preserveMessage = false } = {}) {
    if (!current || el.hidden) return;
    if (current.section === 'repository') { const view=getView(),panel=githubPanel(view);el.setAttribute('aria-busy','true');try{if(panel.snapshot().hasData)await panel.refresh();else await panel.open();view.state=panel.snapshot().hasData?'ready':'error';}finally{el.setAttribute('aria-busy','false');}return; }
    const view = getView(), request = ++generation; controller?.abort(); controller = new AbortController();
    if (!view.data) view.state = 'loading'; el.setAttribute('aria-busy', 'true');
    if (!preserveMessage && !view.form) { view.message = ''; view.messageKind = ''; }
    if (!view.data) render();
    try {
      const result = await load({ ...view.selection, signal: controller.signal });
      if (request !== generation || !isCurrent(view)) return;
      accept(view, result); render();
      const selected=view.selectedBuild;
      if(selected&&view.evidence.get(selected)?.kind==='github')void view.githubPanels?.get(selected)?.refresh();
    } catch (error) {
      if (request !== generation || error?.name === 'AbortError') return;
      view.state = view.data ? 'stale' : 'error'; show(view, error?.message || 'Could not read project records. Try again.', 'error');
      if (!view.data) render(); else updateTabs();
    } finally { if (request === generation) el.setAttribute('aria-busy', 'false'); }
  }
  return {
    element: el,
    open(selection) {
      if (!viewLabels[selection.section]) throw new Error('Unknown project section.');
      pointerActive = false; clearTimeout(pointerRelease);
      if (current) getView().scroll = body.scrollTop;
      current = { ...selection }; const view = getView(); if(selection.section==='builds'&&selection.buildId){view.filter='all';view.selectedBuild=selection.buildId;view.open.add(`build-${selection.buildId}`);view.evidence.set(selection.buildId,{kind:selection.evidence||'summary'});} title.textContent = selection.project; body.setAttribute('aria-label', `${selection.project} ${viewLabels[selection.section]}`);
      el.hidden = false; render(true); body.scrollTop = view.scroll; title.focus({ preventScroll: true }); void refresh();
    },
    close() { if (current) getView().scroll = body.scrollTop; pointerActive = false; clearTimeout(pointerRelease); generation++; controller?.abort(); current = null; el.hidden = true; },
    refresh,
    setSummaries(project, values) { summaries.set(project, values || {}); updateTabs(); },
    setBusy(value) { busy = !!value; for (const b of actions) b.disabled = b.dataset.intrinsicDisabled === 'true' || (busy && b.dataset.mutating === 'true') || !!(current && getView().pending.has(b.dataset.actionKey)); for (const view of views.values()) { const submit = view.form?.element.querySelector('[type="submit"]'); if (submit) submit.disabled = busy || !!view.form.submitting;for(const panel of view.githubPanels?.values()||[])panel.setBusy(busy); } },
    snapshot() { return current ? { ...current, state: getView().state, filter: getView().filter, hasDraft: !!getView().form||[...(getView().githubPanels?.values()||[])].some(panel=>panel.snapshot().hasDraft||panel.snapshot().reviewing) } : null; },
    destroy() { generation++; controller?.abort(); clearTimeout(pointerRelease); document.removeEventListener('pointerup', finishPointer, true); document.removeEventListener('pointercancel', finishPointer, true); for(const view of views.values())for(const panel of view.githubPanels?.values()||[])panel.destroy();views.clear(); el.remove(); },
  };
}
