import { createClient } from './client';
import type { ProjectSettings, SkillDescriptor, SkillRef } from '@nibbi/contracts';

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => { const element = document.createElement(tag); if (text) element.textContent = text; return element; };
export function platformPanel(activeProject: () => string | undefined, changed: () => void) {
  const api = createClient(activeProject), dialog = node('dialog'); dialog.className = 'platform-panel'; dialog.setAttribute('aria-label', 'Nibbi settings'); document.body.append(dialog);
  const header = node('header'), title = node('h2', 'Your Nibbi'), close = node('button', 'Close'); close.type = 'button'; close.onclick = () => dialog.close(); header.append(title, close);
  const tabs = node('nav'); dialog.append(header, tabs);
  let view: HTMLElement[] = [];
  const input = (label: string, value = ''): { label: HTMLLabelElement; input: HTMLInputElement } => { const l = node('label', label), field = node('input'); field.value = value; l.append(field); return { label: l, input: field }; };
  const show = async (tab: string): Promise<void> => {
    // Each visit owns its nodes: delayed reads and saves from an old tab can
    // finish without overwriting the view the owner has since selected.
    const content = node('section'), message = node('p'); message.className = 'panel-message'; message.setAttribute('role', 'status');
    for (const element of view) element.remove(); view = [message, content]; dialog.append(...view);
    const refresh = async (): Promise<void> => { if (dialog.open && content.isConnected) await show(tab); };
    const action = (label: string, run: () => Promise<unknown>): HTMLButtonElement => {
      const button = node('button', label); button.type = 'button'; button.onclick = async () => { button.disabled = true; message.textContent = ''; try { await run(); changed(); } catch (error) { message.textContent = (error as Error).message; } finally { button.disabled = false; } }; return button;
    };
    content.replaceChildren(node('p', 'Loading…')); message.textContent = ''; for (const child of tabs.children) child.setAttribute('aria-current', child.textContent === tab ? 'page' : 'false');
    try {
      if (tab === 'Providers') {
        const projects = await api.get<Array<{ name: string; settings?: ProjectSettings; install?: string; check?: string; play?: string }>>('/api/projects'); const select = node('select'); select.setAttribute('aria-label', 'Project settings');
        for (const project of projects) { const option = node('option', project.name); option.value = project.name; select.append(option); } select.value = activeProject() ?? projects[0]?.name ?? 'vault';
        content.replaceChildren(select); const roles = node('div'); content.append(roles);
        const render = (): void => {
          roles.replaceChildren(); const project = projects.find(project => project.name === select.value);
          for (const role of (select.value === 'vault' ? ['lead'] : ['lead', 'fixer']) as Array<'lead' | 'fixer'>) {
            const group = node('fieldset'), legend = node('legend', role === 'lead' ? 'Conversation lead' : 'Coding fixer'), provider = node('select'); provider.setAttribute('aria-label', role + ' provider');
            for (const name of ['claude', 'codex']) { const option = node('option', name); option.value = name; provider.append(option); }
            provider.value = project?.settings?.[role]?.provider ?? 'claude'; const model = input('Model (blank uses provider default)', project?.settings?.[role]?.model ?? '');
            group.append(legend, provider, model.label, action('Save ' + role, async () => { const settings: ProjectSettings = project?.settings ?? { lead: { provider: 'claude' }, fixer: { provider: 'claude' } }; settings[role] = { provider: provider.value as 'claude' | 'codex', model: model.input.value || undefined }; await api.command('project.settings', { settings }, select.value); message.textContent = 'Saved for the next run. Active runs keep their provider.'; })); roles.append(group);
          }
          if (project && project.name !== 'vault') {
            const group = node('fieldset'), install = input('Install command', project.install ?? 'true'), check = input('Verification command', project.check ?? 'true'), play = input('Preview command or URL', project.play ?? '');
            group.append(node('legend', 'Project commands'), node('p', 'Commands execute in the OS sandbox. A real passing check is required before any merge.'), install.label, check.label, play.label, action('Save project commands', async () => { await api.command('project.commands', { install: install.input.value, check: check.input.value, play: play.input.value || undefined }, select.value); message.textContent = 'Commands saved. Existing verification is not retroactively trusted.'; })); roles.append(group);
          }
        }; select.onchange = render; render();
        const auth = node('div'), connection = node('p'); connection.setAttribute('role', 'status');
        content.append(auth, connection, node('p', 'Claude uses your Claude Code sign-in on this Mac. No API key is required. Sign-in opens the official Claude Code flow in Terminal and your browser; your credentials stay with Claude Code. Plan limits apply.'));
        auth.append(action('Check connections', async () => { const status = await api.get('/api/providers'); connection.textContent = 'Claude: ' + (status.claude.connected ? (status.claude.mode === 'api-key' ? 'explicit API-key mode' : 'signed in' + (status.claude.subscription ? ' · ' + status.claude.subscription : '')) : status.claude.error || 'sign in required') + ' · Codex: ' + (status.codex.connected ? 'connected' : status.codex.error || 'sign in required'); }), action('Sign in with Claude', async () => { const result = await api.post('/api/providers/claude/login'); connection.textContent = result.message; }), action('Connect Codex', async () => { const result = await api.post('/api/providers/login'); const link = node('a', 'Continue Codex sign-in'); link.href = result.authUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; auth.append(link); }));
      } else if (tab === 'Skills') {
        const project = activeProject() ?? 'vault', catalog = await api.get<{ skills: SkillDescriptor[] }>('/api/skills');
        content.replaceChildren(node('p', 'Pinned skills for ' + project + '. Updating a catalog entry never changes an active run.'));
        for (const role of ['lead', 'fixer'] as const) {
          const selected = await api.get<{ settings: SkillRef[] }>('/api/skills?project=' + encodeURIComponent(project) + '&role=' + role);
          const group = node('fieldset'); group.append(node('legend', role)); const checks: { input: HTMLInputElement; skill: SkillDescriptor }[] = [];
          for (const latest of catalog.skills.filter(skill => skill.roles.includes(role))) {
            const pinned = selected.settings.find(ref => ref.id === latest.id);
            const skill: SkillDescriptor = pinned && pinned.revision !== latest.revision ? (await api.get('/api/skills/content?id=' + encodeURIComponent(pinned.id) + '&revision=' + pinned.revision)).skill : latest;
            const label = node('label'), check = node('input'); check.type = 'checkbox'; check.checked = selected.settings.some(ref => ref.id === skill.id && ref.revision === skill.revision); check.disabled = skill.status !== 'available';
            label.append(check, document.createTextNode(skill.name + ' · ' + skill.revision.slice(0, 8) + ' · ' + skill.status)); group.append(label, node('small', skill.description)); checks.push({ input: check, skill });
            if (skill.revision !== latest.revision) group.append(action('Upgrade ' + skill.name + ' to ' + latest.revision.slice(0, 8), async () => { if (!confirm('Switch future runs to the new revision? Inspect the new package from its local source first.')) return; await api.command('skills.enable', { role, refs: selected.settings.map(ref => ref.id === latest.id ? { id: latest.id, revision: latest.revision } : ref) }, project); await refresh(); }));
            group.append(action('Inspect ' + skill.name, async () => {
              const query = '/api/skills/content?id=' + encodeURIComponent(skill.id) + '&revision=' + skill.revision;
              const detail = await api.get(query), viewer = node('article'), files = node('select'), pre = node('pre', detail.content);
              files.setAttribute('aria-label', 'Skill package file');
              for (const name of detail.files) { const option = node('option', name); option.value = name; files.append(option); } files.value = 'SKILL.md';
              files.onchange = () => { void api.get(query + '&file=' + encodeURIComponent(files.value)).then(result => { pre.textContent = result.content; }).catch(error => { message.textContent = error.message; }); };
              viewer.append(node('h3', skill.name + ' · ' + skill.revision.slice(0, 8)), node('p', 'Dependencies: ' + (skill.dependencies.join(', ') || 'none')), files, pre); content.append(viewer);
              if (skill.status === 'draft') viewer.append(action('Approve this revision', async () => { if (!confirm('Have you reviewed this package, its evidence, scripts and dependencies? Approval does not enable it.')) return; await api.command('skills.review', { id: skill.id, revision: skill.revision }); await refresh(); }));
            }));
          }
          group.append(action('Save ' + role + ' skills', async () => { await api.command('skills.enable', { role, refs: checks.filter(check => check.input.checked).map(check => ({ id: check.skill.id, revision: check.skill.revision })) }, project); message.textContent = 'Saved pinned revisions for the next run.'; })); content.append(group);
        }
        const path = input('Import a local skill folder'); content.append(path.label, action('Validate and import', async () => { await api.command('skills.import', { path: path.input.value }); await refresh(); }));
        const draft = node('fieldset'), name = input('Skill name (lowercase-with-hyphens)'), description = input('When should this skill be used?'), evidence = input('Evidence run IDs (comma separated)'), body = node('textarea'), label = node('label', 'Workflow instructions'); body.rows = 8; label.append(body);
        draft.append(node('legend', 'Draft a learned workflow'), node('p', 'Requires observations from two completed runs. Drafting never enables a skill.'), name.label, description.label, evidence.label, label, action('Save draft for review', async () => { await api.command('skills.draft', { name: name.input.value, description: description.input.value, body: body.value, evidence: evidence.input.value.split(',').map(id => id.trim()).filter(Boolean) }); await refresh(); })); content.append(draft);
      } else if (tab === 'Vault') {
        const browse = async (path = ''): Promise<void> => { const entries = await api.get<Array<{ name: string; directory: boolean }>>('/api/vault-tree?path=' + encodeURIComponent(path)); content.replaceChildren(node('h3', path || 'Vault')); if (!path) content.append(action('Checkpoint vault', async () => { if (!confirm('Commit all current vault changes, including your own edits? Review the vault first.')) return; const result = await api.command<{ text: string }>('vault.checkpoint'); message.textContent = result.text; })); if (path) content.append(action('Back', () => browse(path.split('/').slice(0, -1).join('/')))); for (const entry of entries) content.append(action(entry.name + (entry.directory ? '/' : ''), async () => { const next = [path, entry.name].filter(Boolean).join('/'); if (entry.directory) await browse(next); else { const result = await api.get('/api/vault?p=' + encodeURIComponent(next)); content.replaceChildren(action('Back to files', () => browse(path)), node('h3', next), node('pre', result.content)); } })); }; await browse();
      } else if (tab === 'Proposals') {
        const names = await api.get<string[]>('/api/proposals'); content.replaceChildren(node('p', 'Protected identity and instruction files only change after you review the exact proposal and current content.'));
        if (!names.length) content.append(node('p', 'No proposals to review.'));
        for (const name of names) content.append(action(name, async () => {
          const proposal = await api.get('/api/proposals?name=' + encodeURIComponent(name));
          content.replaceChildren(node('h3', proposal.target), node('h4', 'Current'), node('pre', proposal.before), node('h4', 'Proposed'), node('pre', proposal.content),
            action('Adopt reviewed proposal', async () => { if (!confirm('Replace ' + proposal.target + ' with exactly this proposal? Previous content will be backed up.')) return; const result = await api.command<{ text: string }>('proposal.adopt', { name, revision: proposal.revision, baseHash: proposal.baseHash }); message.textContent = result.text; }));
        }));
      } else if (tab === 'Schedules') {
        const schedules = await api.get<Array<{ id: string; name: string; when: string; enabled: boolean; desc: string; next?: string; error?: string }>>('/api/schedules'); content.replaceChildren(node('p', 'Schedules run on this Mac, in its local timezone. New installations start with schedules off.'));
        for (const schedule of schedules) { const group = node('fieldset'); group.append(node('legend', schedule.name), node('p', schedule.when + ' · ' + schedule.desc), node('small', schedule.error || 'Next: ' + (schedule.next ?? 'none')), action(schedule.enabled ? 'Disable' : 'Enable', async () => { await api.command('schedule.set', { id: schedule.id, enabled: !schedule.enabled }); await refresh(); })); content.append(group); }
      } else if (tab === 'Activity') {
        const snapshot = await api.get('/api/snapshot'); content.replaceChildren(node('p', 'Durable run history — preserved across restarts.'));
        for (const run of snapshot.fixers.slice().reverse()) { const article = node('article'); article.append(node('h3', run.title || run.id), node('p', [run.game, run.provider ?? 'legacy', run.status, run.verification?.status ?? 'unverified', run.costUsd === undefined ? 'cost unavailable' : '$' + run.costUsd.toFixed(2)].join(' · '))); if (run.summary) article.append(node('p', run.summary)); article.append(node('small', run.id)); if (['staged', 'failed', 'interrupted'].includes(run.status)) article.append(action('Verify retained commit', async () => { await api.command('run.verify', { id: run.id }, run.game); await refresh(); })); content.append(article); }
      } else if (tab === 'Phone') {
        const health = await api.get('/nibbi/health'); content.replaceChildren(node('p', 'Phone access stays on your LAN and requires HTTPS. Generate pairing codes only on this Mac.'));
        if (!health.remote) content.append(node('p', 'Start Nibbi with --remote to enable the HTTPS listener. Local-only mode is the default.'));
        const ca = node('a', 'Download the local CA certificate'); ca.href = '/nibbi/ca.crt'; content.append(ca, node('p', 'Transfer this certificate to your phone. On iOS install its profile, then enable it in Settings → General → About → Certificate Trust Settings.'));
        content.append(action('Generate one-use pairing code', async () => { const pair = await api.post('/api/pairing/new'); content.append(node('pre', pair.url + '\n\nCode: ' + pair.code + '\nExpires in five minutes.'), node('p', 'Open the HTTPS address, enter the code, then Share → Add to Home Screen. The code is not put in the URL.')); }), action('Revoke all paired devices', async () => { if (confirm('Sign out every paired phone?')) { await api.post('/api/pairing/revoke'); message.textContent = 'Paired devices revoked.'; } }));
      }
    } catch (error) { content.replaceChildren(); message.textContent = (error as Error).message; }
  };
  for (const tab of ['Providers', 'Skills', 'Vault', 'Proposals', 'Schedules', 'Activity', 'Phone']) {
    const button = node('button', tab); button.type = 'button'; button.onclick = () => { void show(tab); }; tabs.append(button);
  }
  return (tab = 'Providers'): void => { if (!dialog.open) dialog.showModal(); void show(tab); };
}
