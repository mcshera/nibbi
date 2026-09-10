/** Repository and publication UI. All writes use a server-prepared operation and explicit confirmation. */
const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
const button = (label, click, primary = false) => { const el = node('button', 'project-action' + (primary ? ' primary' : ''), label); el.type = 'button'; el.onclick = click; return el; };
const shortSha = value => typeof value === 'string' && value ? value.slice(0, 12) : 'Unavailable';
const labelCase = value => String(value || '').replace(/^[A-Z][A-Z_]+$/, text => text.toLowerCase()).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, c => c.toUpperCase());
const time = value => { const d = new Date(value || ''); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(); };
const valueText = value => value == null || value === '' ? 'Unavailable' : typeof value === 'object' ? Array.isArray(value) ? value.map(valueText).join(' · ') : Object.entries(value).filter(([,v]) => v != null).map(([k,v]) => `${labelCase(k)}: ${valueText(v)}`).join(' · ') : String(value);
const commandLabels = {
  'build.prDraft':'Mark pull request as draft', 'build.connect':'Connect retained Build to GitHub', 'project.promotionReady':'Mark promotion ready for review', 'project.verifyPromotion':'Verify merged promotion', 'project.issueLink':'Link a GitHub issue', 'github.connect': 'Save repository connection', 'build.publish': 'Push build branch', 'build.prCreate': 'Create draft pull request', 'build.prReady': 'Mark ready for review', 'build.prMerge': 'Merge pull request', 'build.prAdopt': 'Link existing pull request',
  'build.update': 'Update this build', 'build.updateBase': 'Update from integration branch', 'build.adoptRemote': 'Adopt commits from GitHub', 'build.checkpoint': 'Checkpoint as unverified', 'build.cleanup': 'Clean up retained work', 'build.adoptChanges': 'Create build from local changes',
  'project.publishBranch': 'Publish committed branch', 'project.syncTarget': 'Update local target', 'project.preparePromotion': 'Prepare promotion to release', 'project.mergePromotion': 'Merge promotion', 'build.verifyMerged':'Verify merged result',
};
const commandConfirms = { 'build.prDraft':'Confirm draft pull request', 'build.connect':'Confirm Build connection', 'project.promotionReady':'Confirm promotion ready', 'project.verifyPromotion':'Verify promotion result', 'project.issueLink':'Confirm issue link', 'github.connect': 'Confirm connection', 'build.publish': 'Confirm push', 'build.prCreate': 'Create draft PR', 'build.prReady': 'Confirm ready for review', 'build.prMerge': 'Confirm PR merge', 'build.prAdopt': 'Confirm PR link', 'build.update': 'Start update', 'build.updateBase': 'Update build base', 'build.adoptRemote': 'Adopt remote commits', 'build.checkpoint': 'Create unverified checkpoint', 'build.cleanup': 'Confirm cleanup', 'build.adoptChanges': 'Create selected build', 'project.publishBranch': 'Confirm branch publication', 'project.syncTarget': 'Confirm local update', 'project.preparePromotion': 'Create promotion PR', 'project.mergePromotion': 'Confirm promotion merge' };
function link(label, href) {
  let url; try { url = new URL(href); } catch { return node('span', '', label); }
  if (!['https:', 'http:'].includes(url.protocol)) return node('span', '', label);
  const el = node('a', 'project-related-link', label); el.href = url.href; el.target = '_blank'; el.rel = 'noopener noreferrer'; return el;
}
function facts(entries) {
  const dl = node('dl', 'github-facts');
  for (const [label, value] of entries) { if (value === undefined) continue; const row = node('div'); row.append(node('dt', '', label), node('dd', '', valueText(value))); dl.append(row); }
  return dl;
}
function disclosure(label, content, open = false) { const d = node('details', 'github-disclosure'); d.open = open; d.append(node('summary', '', label)); if (content) d.append(content); return d; }

export function githubDeliveryLabel(run) {
  const github = run.github || run.delivery;
  if(github?.delivery==='local_merge_unpublished')return 'Merged locally · Publication not tracked';
  if(github?.delivery==='local_merge_unknown')return 'Merged locally · Commit unavailable';
  if (!github || github.mode==='local') return run.status === 'merged' ? 'Merged locally · GitHub status unknown' : 'Local build';
  const pr = github.pr;
  if (pr?.state === 'MERGED' || pr?.state === 'merged') return `PR #${pr.number} merged into ${pr.baseBranch || pr.baseRefName || github.baseBranch || run.targetBranch || 'integration'}${github.delivery==='verification_pending'?' · verification pending':github.delivery==='verification_failed'?' · verification failed':''}`;
  if (github.error || github.freshness?.error) return 'GitHub status unavailable';
  if (github.delivery === 'remote_changed' || github.remoteChanged) return `PR #${pr?.number ?? '?'} · Remote branch changed`;
  if (github.toPush || github.publication?.state === 'unpublished' || github.publication?.status === 'not_pushed') return github.pushedSha || github.publication?.lastPushedSha ? 'Local updates to push' : 'Not pushed';
  if (pr) return `PR #${pr.number} · ${pr.isDraft || pr.draft ? 'Draft' : pr.reviewDecision === 'CHANGES_REQUESTED' ? 'Changes requested' : pr.reviewDecision === 'APPROVED' ? pr.approvals === 0 ? 'No review required' : 'Approved' : labelCase(pr.state || 'Awaiting review')}`;
  return github.publication?.state ? labelCase(github.publication.state) : github.pushedSha || github.publication?.lastPushedSha ? 'Published · No pull request' : 'Not pushed';
}

export function createGithubPanel({ project, buildId, run, onAction, onChanged, renderMarkdown, renderDiff } = {}) {
  const el = node('section', 'github-panel'); el.setAttribute('aria-label', buildId ? `GitHub for ${run?.title || buildId}` : `Repository & GitHub for ${project}`);
  const notice = node('div', 'project-notice github-notice'); notice.setAttribute('role', 'status'); notice.hidden = true;
  const content = node('div', 'github-content'); el.append(notice, content);
  let data = null, pendingData = null, form = null, review = null, busy = false, pending = false, generation = 0, destroyed = false, controller = null, pointer = false, releaseTimer = null, pendingNotice = null, opened = false;
  const buttons = new Set(), attemptLogs = new Map(), openDisclosures = new Set();
  const reveal=(label,body,initiallyOpen=false)=>{const detail=disclosure(label,body,initiallyOpen||openDisclosures.has(label));detail.addEventListener('toggle',()=>{if(detail.isConnected){if(detail.open)openDisclosures.add(label);else openDisclosures.delete(label);}});return detail;};
  const show = (text, kind = '') => { if (pointer) { pendingNotice = [text, kind]; return; } notice.replaceChildren(node('span', '', text)); notice.hidden = !text; notice.dataset.kind = kind; if (pendingData) notice.append(button('Show updates', () => { if(!pendingData)return;data = pendingData; pendingData = null; show('');render(); })); };
  content.addEventListener('pointerdown', () => { pointer = true; clearTimeout(releaseTimer); }, true);
  const release = () => { pointer = false; clearTimeout(releaseTimer); if (pendingNotice) { const copy = pendingNotice; pendingNotice = null; show(...copy); } };
  content.addEventListener('click', release, true);
  const up = () => { releaseTimer = setTimeout(release, 0); }; document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true);
  const markdown = text => { const holder = node('div', 'project-document'); if (renderMarkdown) holder.append(renderMarkdown(String(text || ''))); else holder.textContent = text || ''; return holder; };
  const read = (kind, extra = {}) => onAction('githubRead', project, { kind, ...(buildId ? { buildId } : {}), ...extra });
  const command = (name, args) => onAction('githubCommand', project, { command: name, args });
  function action(label, perform, { primary = false, readOnly = false, disabled = false } = {}) {
    const b = button(label, async () => {
      if (pending || b.disabled) return; pending = true; syncBusy(); b.setAttribute('aria-busy', 'true');
      try { await perform(); } catch (error) { show(error?.message || 'This action could not finish. Your work is preserved.', 'error'); }
      finally { pending = false; b.removeAttribute('aria-busy'); syncBusy(); }
    }, primary); b.dataset.readOnly = String(readOnly); b.dataset.disabled = String(disabled); buttons.add(b); b.disabled = disabled || pending || (!readOnly && busy); return b;
  }
  function syncBusy() { for (const b of buttons) b.disabled = b.dataset.disabled === 'true' || pending || (busy && b.dataset.readOnly !== 'true'); }
  async function refresh({ remote = false, force = false, notify = false } = {}) {
    const request = ++generation; controller?.abort(); controller = new AbortController();
    el.setAttribute('aria-busy', 'true');
    if (!data) content.replaceChildren(node('p', 'project-loading', 'Reading repository information…'));
    try {
      if (remote) await onAction('githubRefresh', project, buildId ? { buildId } : {});
      const next = await read(buildId ? 'build' : 'project', { signal: controller.signal });
      if (destroyed || request !== generation) return;
      if (!force && data && (pointer || form || review || content.contains(document.activeElement) || pendingData)) { pendingData = next; if(notice.dataset.kind==='error')show(notice.querySelector('span')?.textContent||'GitHub status needs attention.','error');else show('Updated GitHub records are available. Your current review and draft are preserved.'); }
      else { data = next; pendingData = null; render(); }
      if(notify)await onChanged?.({project,buildId,operation:'github.refresh'});
    } catch (error) {
      if (error?.name === 'AbortError' || destroyed || request !== generation) return;
      show(`${error?.message || 'Repository status is unavailable.'}${data ? ' Showing the last confirmed records.' : ''}`, 'error');
      if (!data) content.replaceChildren(node('p', 'project-muted', 'Local Builds, Issues and Plans remain available.'), action('Try again', () => refresh({ remote: true }), { readOnly: true }));
    } finally { if (request === generation) el.setAttribute('aria-busy', 'false'); }
  }
  function formField(spec) {
    const label = node('label', 'project-field'); label.append(node('span', '', spec.label));
    const input = node(spec.options ? 'select' : spec.multiline ? 'textarea' : 'input'); input.name = spec.name; input.setAttribute('aria-label', spec.label); input.required = !!spec.required; input.dataset.preserveWhitespace = String(!!spec.preserveWhitespace);
    if (spec.type) input.type = spec.type;
    if (spec.multiline) input.rows = spec.rows || 4;
    if (spec.options) for (const option of spec.options) { const o = node('option', '', option.label); o.value = option.value; input.append(o); }
    input.value = spec.value ?? ''; if (spec.maxLength) input.maxLength = spec.maxLength; label.append(input); if (spec.hint) label.append(node('small', 'project-muted', spec.hint));
    return { label, input };
  }
  function openForm(operation, specs, payload = {}, transform) {
    if (form || review) { show('Finish or cancel the current edit before starting another.'); return; }
    const element = node('form', 'project-inline-form github-form'); element.setAttribute('aria-label', commandLabels[operation]); element.append(node('h2', '', commandLabels[operation]), node('p', 'project-muted', project));
    const inputs = {};
    for (const spec of specs) { const {label,input} = formField(spec); inputs[spec.name] = input; element.append(label); }
    const error = node('p', 'project-form-error'); error.hidden = true; error.setAttribute('role', 'alert'); element.append(error);
    const controls = node('div', 'project-toolbar-actions'), submit = action('Review operation', async () => {}, { primary: true }); submit.type = 'submit'; submit.onclick = null;
    controls.append(submit, button('Cancel', () => { if(pending)return;form = null; review = null; render(); })); element.append(controls);
    const draft = { element, operation, payload, inputs, transform }; form = draft;
    element.onsubmit = async event => {
      event.preventDefault(); if (pending || busy || !element.reportValidity()) return;
      pending = true; syncBusy(); error.hidden = true;
      for (const input of Object.values(inputs)) input.disabled = true;
      try {
        const values = Object.fromEntries(Object.entries(inputs).map(([name,input]) => [name,input.dataset.preserveWhitespace==='true'?input.value:input.value.trim()]));
        await prepare(operation, { ...payload, ...(transform ? transform(values) : values) }, draft);
      } catch (errorValue) { error.textContent = errorValue.message || 'Could not prepare this operation.'; error.hidden = false; }
      finally { pending = false; for (const input of Object.values(inputs)) input.disabled = false; syncBusy(); }
    };
    render(); element.querySelector('input,textarea,select')?.focus(); element.scrollIntoView({ block: 'nearest' });return draft;
  }
  async function prepare(operation, args = {}, previousForm = null) {
    const result = await command('github.prepare', { operation, ...(buildId ? { buildId } : {}), ...args });
    if(destroyed||previousForm&&form!==previousForm)return;
    if (!result?.operationId || !result.review) throw new Error('The backend did not return a reviewable operation. Nothing was executed.');
    review = { operation, args, operationId: result.operationId, details: result.review, previousForm }; form = null; render();
    content.querySelector('.github-review h2')?.focus({ preventScroll: true }); content.querySelector('.github-review')?.scrollIntoView({ block: 'nearest' });
  }
  function renderReview() {
    const prepared = review, panel = node('section', 'github-review'); panel.setAttribute('aria-label', 'Review repository operation');
    const heading = node('h2', '', commandLabels[prepared.operation] || labelCase(prepared.operation)); heading.tabIndex = -1; panel.append(heading, node('p', 'project-muted', `For ${project}${buildId ? ` · ${run?.title || buildId}` : ''}`));
    const details = prepared.details;
    const primaryKeys = ['notice', 'destination', 'repository', 'branch', 'remoteBranch', 'baseBranch', 'integrationBranch', 'headSha', 'expectedHeadSha', 'baseSha', 'remoteSha', 'expectedRemoteSha', 'commitCount', 'title', 'method', 'workflowMode', 'account', 'requiredChecks'];
    const entries = primaryKeys.filter(key => details[key] !== undefined).map(key => [labelCase(key), details[key]]); panel.append(facts(entries));
    if (details.body) panel.append(markdown(details.body));
    if (details.instruction) panel.append(markdown(details.instruction));
    if (details.diff || details.changes?.diff) { const diff = details.diff || details.changes.diff; if (renderDiff) panel.append(renderDiff({ ...(typeof details.changes === 'object' ? details.changes : {}), ...details, diff })); else panel.append(node('pre', 'project-evidence-code', diff)); }
    if (details.files || details.selection || details.changes) panel.append(node('pre', 'project-evidence-code', valueText(details.files || details.selection || details.changes))); 
    if (details.warnings?.length) panel.append(node('p', 'github-warning', details.warnings.map(valueText).join(' ')));
    const other = Object.entries(details).filter(([key]) => !primaryKeys.includes(key) && !['body','instruction','diff','changes','files','selection','warnings'].includes(key));
    if (other.length) panel.append(reveal('Operation details', facts(other.map(([k,v]) => [labelCase(k),v]))));
    const controls = node('div', 'project-toolbar-actions'); controls.append(action(commandConfirms[prepared.operation] || 'Confirm operation', async () => {
      const result = await command(prepared.operation, { operationId: prepared.operationId });
      const outcome = result?.state || result?.status || result?.operation?.state || result?.operation?.status;
      if (['unknown', 'outcome_unknown', 'unknown_outcome', 'in_progress', 'running', 'queued','waiting','executing'].includes(outcome)) { show(result?.message || 'The operation is still being confirmed. Refresh GitHub status to inspect its result.'); review = null; form = null; await refresh({ force: true }); return; }
      if(outcome==='failed')throw new Error(typeof result.error==='string'?result.error:result.error?.message||'The reviewed operation failed. Inspect the latest status before retrying.');
      review = null; form = null; pendingData = null;
      show(result?.message || result?.text || 'Operation completed. Reading the confirmed result.', 'success');
      try{await onChanged?.({ project, buildId, operation: prepared.operation, result });}catch(error){show(`Operation completed. ${error.message||'Updated Build counts are unavailable.'} Refresh to read its current status.`, 'success');}
      await refresh({ force: true });
    }, { primary: true }), button(prepared.previousForm ? 'Back to edit' : 'Cancel', () => { if(pending)return;form = prepared.previousForm; review = null; render(); form?.element.querySelector('input,textarea,select')?.focus(); })); panel.append(controls); content.append(panel);
  }
  async function chooseChanges(operation) {
    if (form || review) { show('Finish or cancel the open edit first.'); return; }
    const changeSet = await read('changes'); if (destroyed) return;
    const element = node('form', 'project-inline-form github-change-form'); element.setAttribute('aria-label', commandLabels[operation]); element.append(node('h2', '', commandLabels[operation]), node('p', 'project-muted', 'Choose the exact changes to copy into this Build. The original checkout stays intact.'));
    element.append(facts([['Source commit', shortSha(changeSet.headSha)], ['Changed files', changeSet.files.length]]));
    const {label,input:title} = formField({ name:'title', label:operation === 'build.checkpoint' ? 'Checkpoint message' : 'Build title', required:true, value:operation === 'build.checkpoint' ? run?.title || '' : '' }); element.append(label);
    const selected = new Map();
    for (const file of changeSet.files) {
      const row = node('div', 'github-change-row'), label = node('label', 'github-file-select'), check = node('input'); check.type = 'checkbox'; check.setAttribute('aria-label', `Include ${file.path}`);
      label.append(check, node('span', '', file.path), node('small', 'project-muted', [file.status, file.binary ? 'Binary' : '', file.mode].filter(Boolean).join(' · '))); row.append(label);
      check.onchange = () => { check.indeterminate = false; if (check.checked) selected.set(file.path, null); else selected.delete(file.path); for (const h of row.querySelectorAll('.github-hunk input')) h.checked = check.checked; };
      if (file.hunks?.length && !file.binary) {
        const hunks = node('div');
        for (const hunk of file.hunks) {
          const block = node('div', 'github-hunk'), label = node('label'), select = node('input'); select.type = 'checkbox'; select.setAttribute('aria-label', `Include ${file.path} ${hunk.header}`);
          label.append(select, node('span', '', hunk.header)); block.append(label, node('pre', 'project-evidence-code', hunk.patch)); hunks.append(block);
          select.onchange = () => { const existing = selected.get(file.path); const ids = existing === null ? new Set(file.hunks.map(h => h.id)) : new Set(existing || []); if (select.checked) ids.add(hunk.id); else ids.delete(hunk.id); if (ids.size) selected.set(file.path, ids); else selected.delete(file.path); check.checked = ids.size > 0; check.indeterminate = ids.size > 0 && ids.size < file.hunks.length; };
        }
        row.append(reveal(`Inspect changes · ${file.hunks.length} hunk${file.hunks.length === 1 ? '' : 's'}`, hunks));
      } else if (file.patch) row.append(reveal('Inspect change', node('pre', 'project-evidence-code', file.patch)));
      element.append(row);
    }
    if (!changeSet.files.length) element.append(node('p', 'project-muted', 'There are no changes to capture.'));
    const error = node('p', 'project-form-error'); error.hidden = true; error.setAttribute('role', 'alert'); element.append(error);
    const controls = node('div', 'project-toolbar-actions'), submit = action('Review selected changes', async()=>{}, {primary:true,disabled:!changeSet.files.length}); submit.type = 'submit'; submit.onclick = null; controls.append(submit,button('Cancel',()=>{if(pending)return;form=null;render();})); element.append(controls);
    const draft = {element,operation}; form = draft;
    element.onsubmit = async event => { event.preventDefault(); if (pending || busy || !element.reportValidity()) return; if (!selected.size) { error.textContent = 'Select at least one file or hunk.'; error.hidden = false; return; } pending = true; syncBusy();
      try { await prepare(operation, { sourceRevision:changeSet.sourceRevision, selection:[...selected].map(([path,ids])=>({path,...(ids ? {hunkIds:[...ids]} : {})})), title:title.value.trim() }, draft); }
      catch(e) { error.textContent=e.message;error.hidden=false; } finally{pending=false;syncBusy();} };
    render(); title.focus();
  }
  async function openPrForm(operation, extra) {
    if(form||review){show('Finish or cancel the current edit before starting another.');return;}
    const suggestion=await read('prDraft');if(destroyed)return;
    const templates=suggestion.templates||[],selectedPath=suggestion.selectedTemplatePath||(templates.length===1?templates[0].path:'');
    const specs=[{name:'title',label:'Pull request title',required:true,value:suggestion.title||run?.title||''}];
    if(templates.length>1)specs.push({name:'template',label:'Pull request template',value:selectedPath,options:[...(!selectedPath?[{value:'',label:'Generated draft'}]:[]),...templates.map(template=>({value:template.path,label:template.path}))],hint:'Each template keeps your edits while this draft is open.'});
    specs.push({name:'body',label:'Pull request description',multiline:true,rows:7,preserveWhitespace:true,value:suggestion.body});
    const draft=openForm(operation,specs,extra,values=>({title:values.title,body:values.body}));if(!draft)return;
    const editedBodies=new Map([[selectedPath,suggestion.body]]);let activePath=selectedPath;
    if(draft.inputs.template)draft.inputs.template.onchange=()=>{editedBodies.set(activePath,draft.inputs.body.value);activePath=draft.inputs.template.value;draft.inputs.body.value=editedBodies.get(activePath)??templates.find(template=>template.path===activePath)?.body??suggestion.body;};
    const context=node('p','project-muted');context.textContent=[selectedPath&&templates.length===1?`Template: ${selectedPath}`:'',suggestion.commitSha?`${suggestion.source||'Draft source'} · ${shortSha(suggestion.commitSha)}`:suggestion.source||'',suggestion.templateNotice||''].filter(Boolean).join(' · ');if(context.textContent)draft.element.querySelector('.project-toolbar-actions').before(context);
  }
  function start(operation, extra = {}) {
    const connection = data?.connection || data?.binding?.connection || {};
    if (operation === 'build.adoptChanges' || operation === 'build.checkpoint') return chooseChanges(operation);
    if (operation === 'github.connect') {
      const local = data?.local || {};
      return openForm(operation, [
        { name:'repository', label:'GitHub repository', required:true, value:connection.repository || data?.summary?.repository || '', hint:'Owner/repository, exactly as shown on GitHub.' },
        { name:'host', label:'GitHub host', required:true, value:connection.host || 'github.com' },
        { name:'account', label:'GitHub account', required:true, value:connection.account || data?.capabilities?.account || '' },
        { name:'fetchRemote', label:'Fetch remote', required:true, value:connection.fetchRemote || 'origin' }, { name:'pushRemote', label:'Push remote', required:true, value:connection.pushRemote || 'origin' },
        { name:'integrationBranch', label:'Build pull request base', required:true, value:connection.integrationBranch || local.branch || '' },
        { name:'localTargetBranch', label:'Local integration branch', required:true, value:connection.localTargetBranch || local.branch || '' },
        { name:'releaseBranch', label:'Release branch', required:true, value:connection.releaseBranch || data?.summary?.defaultBranch || '' },
        { name:'workflowMode', label:'Completion workflow', value:connection.workflowMode || 'github', options:[{value:'github',label:'GitHub pull request merge'},{value:'local',label:'Local verified merge'}] },
        {name:'requiredWorkflowPath',label:'Required workflow file',value:[...new Set((connection.requiredChecks||[]).map(check=>check.workflowPath).filter(Boolean))].length===1?connection.requiredChecks.find(check=>check.workflowPath)?.workflowPath:'',hint:'For example, .github/workflows/verify.yml. Required when GitHub has multiple active workflows.'},
        { name:'requiredChecks', label:'Required GitHub checks', multiline:true, value:(connection.requiredChecks||[]).map(c=>typeof c==='string'?c:c.name).join('\n'), hint:'One check name per line. GitHub Actions must report success on the reviewed commit.' },
      ], {}, values=>({...values,requiredChecks:values.requiredChecks.split('\n').map(s=>s.trim()).filter(Boolean).map(name=>(connection.requiredChecks||[]).find(check=>typeof check==='object'&&check.name===name)||{name,appId:15368,acceptedConclusions:['success']})}));
    }
    if (['build.prCreate','project.preparePromotion'].includes(operation)) return openPrForm(operation,extra);
    if(operation==='project.issueLink'){const issues=(data.localIssues||[]).filter(issue=>issue.id);if(!issues.length){show('Add a local issue before linking its GitHub identity.');return;}return openForm(operation,[{name:'issueId',label:'Local issue',required:true,options:issues.map(issue=>({value:issue.id,label:issue.title||issue.text||issue.id}))},{name:'number',label:'GitHub issue number',type:'number',required:true}],extra,values=>({...values,number:Number(values.number)}));}
    if (operation === 'build.update') return openForm(operation,[{name:'instruction',label:'What should change?',multiline:true,required:true}],extra);
    if (operation === 'build.prAdopt') return openForm(operation,[{name:'number',label:'Existing pull request number',type:'number',required:true}],extra,v=>({number:Number(v.number)}));
    if (['build.prMerge','project.mergePromotion'].includes(operation)) {const methods=connection.mergeMethods||data.capabilities?.mergeMethods||['merge','squash','rebase'];return openForm(operation,[{name:'method',label:'Merge method',value:methods[0]||'merge',options:methods.map(value=>({value,label:({merge:'Merge commit',squash:'Squash and merge',rebase:'Rebase and merge'})[value]||value}))}],extra);}
    if (operation === 'project.publishBranch') {
      const branches = (data.branches || []).map(b=>typeof b==='string'?b:b.name).filter(Boolean);
      return openForm(operation,[{name:'branch',label:'Local committed branch',required:true,value:connection.localTargetBranch||data.local?.branch||'',...(branches.length?{options:branches.map(b=>({value:b,label:b}))}:{})},{name:'remoteBranch',label:'Destination branch on GitHub',required:true,value:connection.integrationBranch||''}],extra);
    }
    return prepare(operation,extra);
  }
  function operationButton(operation, extra, label) { return action(label || (operation==='build.connect'?'Review publication':commandLabels[operation]) || labelCase(operation),()=>start(operation,extra),{primary:operation==='build.publish'||operation==='build.prMerge'}); }
  function renderRepository() {
    const c = data.connection, local = data.local || {}, summary = data.summary || {};
    const toolbar = node('div','project-toolbar'); toolbar.append(node('h2','',c?.repository || 'Repository & GitHub'),action('Refresh GitHub',()=>refresh({remote:true,force:true,notify:true}),{readOnly:true})); content.append(toolbar);
    if (!c) content.append(node('p','project-muted','This project has a local repository. Connect its GitHub destination to publish reviewed Builds.'));
    content.append(facts([
      ['Project',project],['GitHub repository',c?.repository || summary.repository || 'Not connected'],['Visibility',summary.visibility || c?.visibility],['Account',c?.account],['Host',c?.host],
      ['Local folder',local.path || local.repo || c?.repo],['Working branch',local.branch],['Build PR base',c?.integrationBranch],['Local integration branch',c?.localTargetBranch],['Release branch',c?.releaseBranch],['GitHub default branch',c?.defaultBranch||summary.defaultBranch],['Fetch remote',c?.fetchRemote],['Push remote',c?.pushRemote],
      ['Tracking branch',local.upstream || 'No tracking branch'],['Local commits to push',local.upstream ? local.ahead : undefined],['Remote commits to fetch',local.upstream ? local.behind : undefined],['Uncommitted changes',local.changedFiles ?? local.dirtyCount ?? (Array.isArray(local.files) ? local.files.length : local.dirty === true ? 'Present' : local.dirty === false ? 'None' : undefined)],
      ['Completion',c?.workflowMode === 'github' ? 'After GitHub PR merge into the pinned base' : c?.workflowMode === 'local' ? 'After verified local merge' : undefined],
    ]));
    if (summary.url || c?.url) content.append(link('Open repository on GitHub',summary.url||c.url));
    const controls=node('div','project-toolbar-actions github-repository-actions');controls.append(operationButton('github.connect',{},c?'Edit repository connection':'Connect GitHub'));
    const allowed=data.allowedActions||summary.allowedActions||[];
    for(const operation of ['build.adoptChanges','project.publishBranch','project.syncTarget','project.preparePromotion','project.issueLink'])if(allowed.includes(operation))controls.append(operationButton(operation));
    toolbar.after(controls);
    if(data.githubIssueLinks?.length){const links=node('div');for(const item of data.githubIssueLinks){const row=node('p');row.append(node('span','',`${(data.localIssues||[]).find(issue=>issue.id===item.issueId)?.title||item.issueId} · `),link(`${item.repository||c?.repository} #${item.number}`,item.url||item.htmlUrl));links.append(row);}content.append(reveal('Linked GitHub issues',links));}
    if(data.deployment||data.installed){const deliveries=node('div');deliveries.append(facts([['Deployment status',data.deployment?.status==='unknown'?'Unavailable':labelCase(data.deployment?.status)],['Installed version',data.installed?.version||'Unavailable'],['Installed source commit',shortSha(data.installed?.sourceCommit)]]));for(const d of data.deployment?.deployments||[])deliveries.append(facts([['Environment',d.environment],['Commit',shortSha(d.sha)],['State',labelCase(d.state||d.status)]]));content.append(reveal('Deployment and installed version',deliveries));}
    const capabilities=data.capabilities||{};
    if(Object.keys(capabilities).length)content.append(reveal('Repository capabilities',facts(Object.entries(capabilities).map(([k,v])=>[labelCase(k),v]))));
    if(data.branches?.length)content.append(reveal('Repository branches',facts(data.branches.map(b=>typeof b==='string'?[b,'Local branch']:[b.name,valueText({local:b.local,remote:b.remote,head:b.sha||b.headSha,upstream:b.upstream})]))));
    for(const promotion of data.promotions||[]){const row=node('article','github-history-entry'),pr=promotion.observation||promotion.pr;row.append(node('h3','',pr?.title||'Promotion to release'),facts([['Branch',promotion.branch||c?.integrationBranch],['Release branch',promotion.baseBranch||promotion.connection?.releaseBranch],['State',pr?.state],['Published commit',shortSha(promotion.headSha||pr?.headSha)]]));if(pr?.url)row.append(link(`Open promotion PR #${pr.number}`,pr.url));for(const action of promotion.allowedActions||[])if(commandLabels[action])row.append(operationButton(action,{promotionId:promotion.id}));content.append(row);}
  }
  function renderChecks() {
    const checkData=data.checks||[],checks=Array.isArray(checkData)?checkData:checkData.all||checkData.checks||[];
    const section=node('section','github-checks');section.append(node('h3','','GitHub checks'));
    const state=data.checkState||data.binding?.checkState; if(state)section.append(node('p','project-muted',`Required checks: ${labelCase(state.status)}`));
    if(!checks.length)section.append(node('p','project-muted',checkData.status==='unavailable'?'GitHub checks are unavailable.':'No GitHub checks have been reported for this revision.'));
    for(const check of checks){const row=node('div','github-check-row');row.append(node('strong','',check.name||check.context||'Check'),node('span','project-record-status',labelCase(check.bucket||check.conclusion||check.state||check.status||'Unavailable')));if(check.headSha||check.sha)row.append(node('small','project-muted',shortSha(check.headSha||check.sha)));if(check.link||check.detailsUrl||check.url)row.append(link('Details',check.link||check.detailsUrl||check.url));section.append(row);}
    content.append(section);
  }
  function renderBuild() {
    const binding=data.binding||{},publication=data.publication||{},pr=data.pr;
    const toolbar=node('div','project-toolbar');toolbar.append(node('h2','','GitHub delivery'),action('Refresh GitHub',()=>refresh({remote:true,force:true,notify:true}),{readOnly:true}));content.append(toolbar);
    content.append(facts([['Repository',binding.repository||binding.connection?.repository],['Build branch',binding.branch||run?.branch],['PR base',binding.baseBranch||binding.integrationBranch||run?.targetBranch],['Local candidate',shortSha(publication.headSha||data.headSha||run?.commitSha)],['Locally verified commit',shortSha(publication.verifiedSha||binding.lastVerifiedSha)],['Published commit',shortSha(publication.lastPushedSha||publication.pushedSha||binding.lastPushedSha)],['Publication',githubDeliveryLabel({ ...run, github:data })],['Pull request',pr?`#${pr.number} · ${pr.isDraft||pr.draft?'Draft':labelCase(pr.state)}`:'No pull request'],['GitHub PR head',data.remoteChanged?shortSha(data.remoteHeadSha||pr?.headSha):undefined],['Review requested from',pr?.reviewRequests?.length?pr.reviewRequests.join(', '):undefined],['Review',pr?.reviewDecision==='APPROVED'&&pr.approvals===0?'No review required':pr?.reviewDecision?labelCase(pr.reviewDecision):pr?'No review decision':undefined],['Mergeability',pr?pr.mergeable===true?'No conflicts':pr.mergeable===false?'Conflicts':'Not yet known':undefined],['Merge state',pr?.mergeStateStatus?labelCase(pr.mergeStateStatus):undefined],['GitHub head',pr?.headSha||pr?.headRefOid?shortSha(pr.headSha||pr.headRefOid):undefined],['Merged commit',binding.completion?.receipt?.mergeSha?shortSha(binding.completion.receipt.mergeSha):undefined],['Completion',binding.completion?.state?labelCase(binding.completion.state):undefined],['Local synchronization',binding.localSync?.state?labelCase(binding.localSync.state):undefined],['Release branch reached',binding.release?.baseBranch]]));
    if(pr?.url)content.append(link(`Open PR #${pr.number} on GitHub`,pr.url));if(pr?.body)content.append(reveal('Pull request description',markdown(pr.body)));if(pr?.files?.length){const files=node('div');files.append(node('p','project-muted',`GitHub PR head ${shortSha(pr.headSha)}`));for(const file of pr.files){const row=node('div','github-history-entry');row.append(node('h3','',file.path),node('p','project-muted',`${file.status} · +${file.additions} −${file.deletions}`));if(file.patch)row.append(node('pre','project-evidence-code',file.patch));files.append(row);}content.append(reveal(`Files in this pull request · ${pr.files.length}`,files));}
    if(data.notice)content.append(node('p','github-warning',data.notice));
    const controls=node('div','project-toolbar-actions');for(const operation of data.allowedActions||[])if(commandLabels[operation])controls.append(operationButton(operation));toolbar.after(controls);
    const blockers=data.mergeBlockers||data.blockers||data.checkState?.blockers||binding.checkState?.blockers||[];if(blockers.length)content.append(node('p','github-warning',blockers.map(valueText).join(' ')));
    renderChecks();
    const comments=pr?.comments?.nodes||pr?.comments||data.comments||[];const reviews=pr?.reviews?.nodes||pr?.reviews||data.reviews||[];
    if(comments.length||reviews.length){const discussion=node('div');for(const item of [...reviews,...comments]){const row=node('article','github-history-entry');row.append(node('h3','',`${item.author?.login||item.author||'GitHub'}${item.state?' · '+labelCase(item.state):''}`),markdown(item.body||''));if(item.url)row.append(link('View on GitHub',item.url));discussion.append(row);}content.append(reveal('Reviews and discussion',discussion));}
    if(data.attempts?.length){const attempts=node('div');for(const attempt of data.attempts){const row=node('article','github-history-entry');row.append(node('h3','',attempt.title||`${labelCase(attempt.kind||'Execution')} attempt`),facts([['Status',labelCase(attempt.status)],['Candidate',shortSha(attempt.candidateSha||attempt.commitSha)],['Local verification',attempt.verification?.status||attempt.checks?.status||'Unavailable'],['Cost',Number.isFinite(attempt.costUsd)?`$${attempt.costUsd.toFixed(2)}`:undefined],['Started',time(attempt.startedAt)],['Ended',time(attempt.endedAt)]]));if(attempt.instruction)row.append(reveal('Instructions',markdown(attempt.instruction)));if(attempt.summary)row.append(markdown(attempt.summary));const log=attemptLogs.get(attempt.id)||attempt.log;if(log)row.append(reveal('Attempt log',node('pre','project-evidence-code',typeof log==='string'?log:valueText(log)),true));else if(attempt.id)row.append(action('Read attempt log',async()=>{const value=await onAction('buildEvidence',project,{id:buildId,kind:'log',attemptId:attempt.id});const entries=value.entries||[];attemptLogs.set(attempt.id,entries.length?entries.map(entry=>[entry.timestamp||entry.ts||entry.at,entry.text||entry.message].filter(Boolean).join(' ')).join('\n'):'No entries were recorded for this attempt.');render();},{readOnly:true}));attempts.append(row);}content.append(reveal(`Execution attempts · ${data.attempts.length}`,attempts));}
  }
  function renderOperations() {
    if(!data.operations?.length)return;const history=node('div');for(const operation of data.operations){const row=node('article','github-history-entry');row.append(node('h3','',commandLabels[operation.command||operation.operation]||labelCase(operation.kind||operation.command||'Operation')),facts([['State',labelCase(operation.state||operation.status)],['Destination',operation.review?.destination||operation.destination],['Commit',operation.headSha?shortSha(operation.headSha):undefined],['Time',time(operation.updatedAt||operation.createdAt)],['Result',(typeof operation.error==='string'?operation.error:operation.error?.message)||operation.message]]));if(operation.receipt?.url)row.append(link('View receipt',operation.receipt.url));if(operation.state==='prepared'&&commandLabels[operation.operation]&&operation.id){if(operation.expiresAt&&operation.expiresAt<Date.now())row.append(node('p','project-muted','This review expired. Prepare the operation again from its current status.'));else row.append(action('Review this operation',()=>{review={operation:operation.operation,operationId:operation.id,details:operation.review||{},previousForm:null};render();}));}history.append(row);}content.append(reveal('Publication history',history));
  }
  function render() {
    if(destroyed)return;const scroll=el.closest('.project-workspace-body')?.scrollTop;content.replaceChildren();buttons.clear();
    if(review)renderReview();else if(form)content.append(form.element);else if(data){if(buildId)renderBuild();else renderRepository();renderOperations();const freshness=data.freshness||{};if(freshness.observedAt||freshness.at)content.append(node('p','project-muted github-freshness',`Last read ${time(freshness.observedAt||freshness.at)}${freshness.stale||freshness.status==='stale'?' · stale':''}`));if(!freshness.observedAt&&freshness.status==='stale')content.append(node('p','project-muted','GitHub status has not been refreshed yet.'));if(freshness.error)show(freshness.error.message||freshness.error,'error');}
    for(const b of content.querySelectorAll('button[data-read-only]'))buttons.add(b);
    const body=el.closest('.project-workspace-body');if(body&&scroll!=null)body.scrollTop=scroll;syncBusy();
  }
  const poller=setInterval(()=>{if(!destroyed&&opened&&!pending&&document.visibilityState==='visible'&&el.getClientRects().length&&(data?.connection||data?.binding))void refresh({remote:true});},30000);
  return {element:el,refresh,open(){if(opened&&data)return Promise.resolve();opened=true;return refresh().then(()=>{if(!destroyed&&(data?.connection||data?.binding))void refresh({remote:true});});},setBusy(value){busy=!!value;syncBusy();},snapshot(){return{project,buildId,hasDraft:!!form,reviewing:review?.operation,pending,hasData:!!data};},destroy(){destroyed=true;generation++;controller?.abort();clearTimeout(releaseTimer);clearInterval(poller);document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',up,true);el.remove();}};
}
