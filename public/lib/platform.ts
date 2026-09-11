import { createClient } from './client';
import type { ProjectSettings, SkillDescriptor, SkillRef } from '@nibbi/contracts';

interface McpServerView { name: string; transport: 'stdio' | 'http'; command?: string; args?: string[]; cwd?: string; url?: string; env?: Record<string, string>; secretEnv?: string[]; secretHeaders?: string[]; enabled: boolean; projects: string[] | '*'; allowTools?: string[]; denyTools?: string[]; limits: { timeoutMs: number; maxArgBytes: number; maxResultBytes: number } }
interface McpHealthView { server: string; state: 'disabled' | 'connected' | 'disconnected' | 'error'; toolCount: number; tools: Array<{ name: string; description: string }>; lastError?: string; lastConnectedAt?: number; checkedAt: number }
interface WebStatusView { searchConfigured: boolean; vaultDomains: string[]; projectDomains: string[]; effectiveDomains: string[] }
interface McpTokenView { name: string; scopes: string[]; projects: string[] | '*'; createdAt: number; expiresAt?: number; lastUsedAt?: number; useCount: number; revokedAt?: number; hashPrefix: string }
const MCP_SCOPES = [{ id: 'read', label: 'read — roadmap, activity, chat history, vault files, progress' }, { id: 'web', label: 'web — web_search and web_fetch under the vault allowlist' }, { id: 'dispatch', label: 'dispatch — queue Builds on allowed projects (never merges)' }, { id: 'steer', label: 'steer — guide live Builds and turns on allowed projects' }];
const splitList = (value: string): string[] => value.split(/[\n,]/).map(item => item.trim()).filter(Boolean);
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => { const element = document.createElement(tag); if (text) element.textContent = text; return element; };
const mcpPort = (): string => location.port || '4527';
/** Per-harness config for POST /mcp on this backend's real port; `<token>` stays a placeholder until a token is revealed. */
const mcpSnippets = (token: string): Array<{ title: string; text: string }> => { const url = 'http://127.0.0.1:' + mcpPort() + '/mcp'; return [
  { title: 'Claude Code', text: 'claude mcp add --transport http nibbi ' + url + ' --header "Authorization: Bearer ' + token + '"' },
  { title: 'Codex (~/.codex/config.toml)', text: '[mcp_servers.nibbi]\nurl = "' + url + '"\nbearer_token_env_var = "NIBBI_MCP_TOKEN"\n# then in the shell that starts codex: export NIBBI_MCP_TOKEN=' + token },
  { title: 'opencode (opencode.json)', text: JSON.stringify({ mcp: { nibbi: { type: 'remote', url, headers: { Authorization: 'Bearer ' + token } } } }, null, 2) },
]; };
const copyText = async (text: string, source: HTMLElement): Promise<void> => {
  try { await navigator.clipboard.writeText(text); }
  catch { const range = document.createRange(); range.selectNodeContents(source); const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range); document.execCommand('copy'); }
};
export function platformPanel(activeProject: () => string | undefined, changed: () => void) {
  const api = createClient(activeProject), dialog = node('dialog'); dialog.className = 'platform-panel'; dialog.setAttribute('aria-label', 'Nibbi settings'); document.body.append(dialog);
  const header = node('header'), title = node('h2', 'Your Nibbi'), close = node('button', 'Close'); close.type = 'button'; close.className = 'platform-close'; close.onclick = () => dialog.close(); header.append(title, close);
  const tabs = node('nav'); tabs.setAttribute('aria-label', 'Settings sections'); dialog.append(header, tabs);
  let view: HTMLElement[] = [];
  const input = (label: string, value = ''): { label: HTMLLabelElement; input: HTMLInputElement } => { const l = node('label', label), field = node('input'); field.value = value; l.append(field); return { label: l, input: field }; };
  const show = async (tab: string): Promise<void> => {
    // Each visit owns its nodes: delayed reads and saves from an old tab can
    // finish without overwriting the view the owner has since selected.
    const content = node('section'), message = node('p'); content.className = 'platform-content'; content.setAttribute('aria-label', tab); message.className = 'panel-message'; message.setAttribute('role', 'status');
    for (const element of view) element.remove(); view = [message, content]; dialog.append(...view);
    const refresh = async (): Promise<void> => { if (dialog.open && content.isConnected) await show(tab); };
    const action = (label: string, run: () => Promise<unknown>): HTMLButtonElement => {
      const button = node('button', label); button.type = 'button'; button.onclick = async () => { button.disabled = true; message.textContent = ''; try { await run(); changed(); } catch (error) { message.textContent = (error as Error).message; } finally { button.disabled = false; } }; return button;
    };
    content.replaceChildren(node('p', 'Loading…')); message.textContent = ''; for (const child of tabs.children) child.setAttribute('aria-current', child.textContent === tab ? 'page' : 'false');
    try {
      if (tab === 'Providers') {
        const projects = await api.get<Array<{ name: string; settings?: ProjectSettings; install?: string; check?: string; play?: string; installDomains?: string[]; webDomains?: string[] }>>('/api/projects'); const select = node('select'); select.setAttribute('aria-label', 'Project settings');
        for (const project of projects) { const option = node('option', project.name); option.value = project.name; select.append(option); } select.value = activeProject() ?? projects[0]?.name ?? 'vault';
        const projectLabel = node('label', 'Project settings'); projectLabel.className = 'platform-project'; projectLabel.append(select); content.replaceChildren(projectLabel); const roles = node('div'); roles.className = 'platform-roles'; content.append(roles);
        const render = (): void => {
          roles.replaceChildren(); const project = projects.find(project => project.name === select.value);
          for (const role of (select.value === 'vault' ? ['lead'] : ['lead', 'fixer']) as Array<'lead' | 'fixer'>) {
            const group = node('fieldset'), legend = node('legend', role === 'lead' ? 'Conversation lead' : 'Coding fixer'), provider = node('select'); provider.setAttribute('aria-label', role + ' provider');
            for (const name of ['claude', 'codex']) { const option = node('option', name); option.value = name; provider.append(option); }
            provider.value = project?.settings?.[role]?.provider ?? 'claude'; const model = input('Model (blank uses provider default)', project?.settings?.[role]?.model ?? '');
            group.append(legend, provider, model.label, action('Save ' + role, async () => { const settings: ProjectSettings = project?.settings ?? { lead: { provider: 'claude' }, fixer: { provider: 'claude' } }; settings[role] = { provider: provider.value as 'claude' | 'codex', model: model.input.value || undefined }; await api.command('project.settings', { settings }, select.value); message.textContent = 'Saved for the next run. Active runs keep their provider.'; })); roles.append(group);
          }
          if (project && project.name !== 'vault') {
            const group = node('fieldset'), install = input('Install command', project.install ?? 'true'), check = input('Verification command', project.check ?? 'true'), play = input('Preview command or URL', project.play ?? ''), installDomains = input('Install domains (comma separated)', (project.installDomains ?? ['registry.npmjs.org']).join(', ')), webDomains = input('Web domains this project may read (comma separated)', (project.webDomains ?? []).join(', '));
            group.className = 'platform-commands'; group.append(node('legend', 'Project commands'), node('p', 'Commands execute in the OS sandbox. A real passing check is required before any merge.'), install.label, check.label, play.label, installDomains.label, webDomains.label, action('Save project commands', async () => { await api.command('project.commands', { install: install.input.value, check: check.input.value, play: play.input.value || undefined, installDomains: splitList(installDomains.input.value), webDomains: splitList(webDomains.input.value) }, select.value); message.textContent = 'Commands saved. Existing verification is not retroactively trusted.'; })); roles.append(group);
          }
        }; select.onchange = render; render();
        const auth = node('div'), connection = node('p'); auth.className = 'platform-connections'; connection.setAttribute('role', 'status');
        content.append(auth, connection, node('p', 'Claude uses your Claude Code sign-in on this Mac. No API key is required. Sign-in opens the official Claude Code flow in Terminal and your browser; your credentials stay with Claude Code. Plan limits apply.'));
        auth.append(action('Check connections', async () => { const status = await api.get('/api/providers'); connection.textContent = 'Claude: ' + (status.claude.connected ? (status.claude.mode === 'api-key' ? 'explicit API-key mode' : 'signed in' + (status.claude.subscription ? ' · ' + status.claude.subscription : '')) : status.claude.error || 'sign in required') + ' · Codex: ' + (status.codex.connected ? 'connected' : status.codex.error || 'sign in required'); }), action('Sign in with Claude', async () => { const result = await api.post('/api/providers/claude/login'); connection.textContent = result.message; }), action('Connect Codex', async () => { const result = await api.post('/api/providers/login'); const link = node('a', 'Continue Codex sign-in'); link.href = result.authUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; auth.append(link); }));
        const web = node('fieldset'), webStatus = node('p'), webDomains = node('textarea'), webLabel = node('label', 'Vault-wide web domains Nibbi may read (one per line)'); webDomains.rows = 4; webLabel.append(webDomains); webStatus.setAttribute('role', 'status'); web.className = 'platform-web';
        const webQuery = (): string => '/api/web?project=' + encodeURIComponent(select.value);
        const describeWeb = (status: WebStatusView): void => { const plural = (n: number, word: string): string => n + ' ' + word + (n === 1 ? '' : 's'); webStatus.textContent = 'Search: ' + (status.searchConfigured ? 'Serper key in Keychain' : 'no key in Keychain, search unavailable') + ' · Fetch: ' + (status.effectiveDomains.length ? plural(status.vaultDomains.length, 'vault domain') + ', ' + plural(status.projectDomains.length, 'project domain') + ' for ' + select.value : 'no allowed domains, page reading unavailable'); };
        try { const status = await api.get<WebStatusView>(webQuery()); webDomains.value = status.vaultDomains.join('\n'); describeWeb(status); } catch (error) { webStatus.textContent = (error as Error).message; }
        web.append(node('legend', 'Web access'), node('p', 'Nibbi can search the web through Serper and read pages only from listed domains. Fetched text is treated as untrusted data. Builds never get web access.'), webLabel, webStatus,
          action('Save web domains', async () => { await api.command('web.settings', { domains: splitList(webDomains.value) }); const status = await api.get<WebStatusView>(webQuery()); webDomains.value = status.vaultDomains.join('\n'); describeWeb(status); message.textContent = 'Saved vault-wide web domains.'; }),
          action('Store Serper key in Keychain', async () => { const result = await api.command<{ message: string }>('web.keyPrompt', {}); message.textContent = result.message; }),
          action('Check web access', async () => { describeWeb(await api.get<WebStatusView>(webQuery())); }));
        content.append(web);
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
      } else if (tab === 'MCP') {
        const view = await api.get<{ servers: McpServerView[]; health: McpHealthView[] }>('/api/mcp'), projects = await api.get<Array<{ name: string }>>('/api/projects');
        content.replaceChildren(node('p', 'External MCP servers Nibbi may use in conversation. Their tools appear only while a server is enabled, connected and allowed for the active project; results are treated as untrusted data. Secrets go to Keychain, never into these records.'));
        const describe = (health: McpHealthView | undefined, server: McpServerView): string => !server.enabled ? 'Disabled' : !health || health.state === 'disconnected' ? 'Not checked yet' : health.state === 'connected' ? 'Connected · ' + health.toolCount + ' tool' + (health.toolCount === 1 ? '' : 's') : 'Error: ' + (health.lastError || 'unavailable') + ' (tools are not offered until Check succeeds)';
        for (const server of view.servers) {
          const health = view.health.find(item => item.server === server.name), group = node('fieldset'), status = node('p', describe(health, server)); status.setAttribute('role', 'status'); group.className = 'platform-mcp-server';
          group.append(node('legend', server.name), node('p', server.transport === 'stdio' ? [server.command, ...(server.args ?? [])].join(' ') : server.url ?? ''), node('small', 'Projects: ' + (server.projects === '*' ? 'all' : server.projects.join(', ') || 'none') + ' · timeout ' + Math.round(server.limits.timeoutMs / 1000) + ' s · results ≤ ' + Math.round(server.limits.maxResultBytes / 1024) + ' KB' + (server.secretEnv?.length || server.secretHeaders?.length ? ' · secrets: ' + [...(server.secretEnv ?? []), ...(server.secretHeaders ?? [])].join(', ') : '')), status);
          if (health?.tools.length) group.append(node('small', 'Tools: ' + health.tools.map(tool => tool.name).join(', ')));
          const controls = node('div'); controls.className = 'platform-toolbar-actions';
          controls.append(action('Check', async () => { await api.command('mcp.check', { name: server.name }); await refresh(); }), action(server.enabled ? 'Disable' : 'Enable', async () => { await api.command('mcp.enable', { name: server.name, enabled: !server.enabled }); if (!server.enabled) await api.command('mcp.check', { name: server.name }); await refresh(); }));
          for (const key of [...(server.secretEnv ?? []), ...(server.secretHeaders ?? [])]) controls.append(action('Store ' + key, async () => { const result = await api.command<{ message: string }>('mcp.secretPrompt', { name: server.name, key }); message.textContent = result.message; }));
          controls.append(action('Remove', async () => { if (!confirm('Remove MCP server ' + server.name + '? Its Keychain secrets stay until you delete them in Keychain Access.')) return; await api.command('mcp.remove', { name: server.name }); await refresh(); }));
          group.append(controls); content.append(group);
        }
        if (!view.servers.length) content.append(node('p', 'No external MCP servers yet.'));
        const form = node('fieldset'), name = input('Server name (lowercase slug)'), transport = node('select'), command = input('Command (stdio): executable only'), args = input('Arguments (stdio, space separated)'), cwd = input('Working folder (stdio, absolute path)'), url = input('URL (http): https://host/mcp'), env = input('Environment values (stdio, NAME=value, comma separated, no secrets)'), secretEnv = input('Secret environment names (stdio, comma separated)'), secretHeaders = input('Secret header names (http, comma separated, e.g. AUTHORIZATION)'), allow = input('Allow only these remote tools (comma separated, blank = all)'), deny = input('Deny these remote tools (comma separated)'), timeout = input('Timeout seconds', '30');
        transport.setAttribute('aria-label', 'Transport'); for (const value of ['stdio', 'http']) { const option = node('option', value); option.value = value; transport.append(option); }
        const picker = node('fieldset'); picker.append(node('legend', 'Projects that may use it')); const boxes: Array<{ box: HTMLInputElement; name: string }> = []; const all = node('label'), allBox = node('input'); allBox.type = 'checkbox'; all.append(allBox, document.createTextNode('All projects')); picker.append(all);
        for (const project of projects.filter(project => project.name !== 'vault')) { const label = node('label'), box = node('input'); box.type = 'checkbox'; label.append(box, document.createTextNode(project.name)); picker.append(label); boxes.push({ box, name: project.name }); }
        const list = (value: string): string[] | undefined => { const items = splitList(value); return items.length ? items : undefined; };
        form.className = 'platform-mcp-form'; form.append(node('legend', 'Add an MCP server'), name.label, node('label', 'Transport'), transport, command.label, args.label, cwd.label, url.label, env.label, secretEnv.label, secretHeaders.label, allow.label, deny.label, timeout.label, picker,
          action('Save server', async () => {
            const stdio = transport.value === 'stdio';
            const envPairs = Object.fromEntries(splitList(env.input.value).map(pair => { const index = pair.indexOf('='); return index > 0 ? [pair.slice(0, index).trim(), pair.slice(index + 1)] : [pair.trim(), '']; }).filter(([key]) => key));
            const server = { name: name.input.value.trim(), transport: transport.value, ...(stdio ? { command: command.input.value.trim(), args: args.input.value.trim() ? args.input.value.trim().split(/\s+/) : undefined, cwd: cwd.input.value.trim() || undefined, env: Object.keys(envPairs).length ? envPairs : undefined, secretEnv: list(secretEnv.input.value) } : { url: url.input.value.trim(), secretHeaders: list(secretHeaders.input.value) }),
              enabled: false, projects: allBox.checked ? '*' : boxes.filter(item => item.box.checked).map(item => item.name), allowTools: list(allow.input.value), denyTools: list(deny.input.value), limits: { timeoutMs: Math.round(Number(timeout.input.value) || 30) * 1000, maxArgBytes: 16384, maxResultBytes: 49152 } };
            await api.command('mcp.upsert', { server }); message.textContent = 'Saved ' + server.name + '. Store its secrets, then Enable and Check.'; await refresh();
          }));
        content.append(form);
        // Nibbi as a server: named bearer tokens for outside harnesses. The plaintext is shown once; the table only ever sees a hash prefix.
        const serverSection = node('fieldset'); serverSection.className = 'platform-mcp-tokens';
        serverSection.append(node('legend', 'Nibbi as a server'), node('p', 'Claude Code, Codex and opencode can call Nibbi\'s governed tools over POST /mcp on this Mac with a named bearer token. Tokens are read-only unless you add scopes; dispatch never merges; every call is recorded under mcp-<name> in the Log. The route stays loopback-only unless the backend starts with NIBBI_MCP_REMOTE=1.'));
        const checkbox = (parent: HTMLElement, text: string, checked = false): HTMLInputElement => { const label = node('label'), box = node('input'); box.type = 'checkbox'; box.checked = checked; label.className = 'platform-check'; label.append(box, document.createTextNode(text)); parent.append(label); return box; };
        const snippetBlock = (token: string): HTMLElement => {
          const wrap = node('div'); wrap.className = 'platform-snippets';
          for (const snippet of mcpSnippets(token)) {
            const pre = node('pre', snippet.text), copy = node('button', 'Copy'), head = node('div'); copy.type = 'button'; head.className = 'platform-snippet-head';
            copy.onclick = async () => { await copyText(snippet.text, pre); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1500); };
            head.append(node('strong', snippet.title), copy); wrap.append(head, pre);
          }
          return wrap;
        };
        const tokenList = node('div');
        const renderTokens = async (): Promise<void> => {
          try {
            const tokens = await api.get<{ tokens: McpTokenView[] }>('/api/mcp/tokens'), live = tokens.tokens.filter(token => !token.revokedAt), revoked = tokens.tokens.length - live.length;
            if (!live.length) { tokenList.replaceChildren(node('p', 'No tokens yet.')); return; }
            const scroller = node('div'), table = node('table'), head = node('tr'); scroller.className = 'platform-table'; table.append(head);
            for (const heading of ['Token', 'Scopes', 'Projects', 'Last used', 'Uses', '']) head.append(node('th', heading));
            for (const token of live) {
              const row = node('tr'), cell = node('td'), name = node('td', token.name); name.append(node('small', token.hashPrefix + (token.expiresAt ? ' · expires ' + new Date(token.expiresAt).toLocaleDateString() : '')));
              cell.append(action('Revoke', async () => { if (!confirm('Revoke token ' + token.name + '? Harnesses using it lose access immediately.')) return; await api.command('mcp.tokenRevoke', { name: token.name }); await renderTokens(); }));
              row.append(name, node('td', token.scopes.join(', ')), node('td', token.projects === '*' ? 'all' : token.projects.join(', ')), node('td', token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : 'never'), node('td', String(token.useCount)), cell); table.append(row);
            }
            scroller.append(table); tokenList.replaceChildren(scroller);
            if (revoked) tokenList.append(node('small', revoked + ' revoked token' + (revoked === 1 ? '' : 's') + ' kept for the audit trail.'));
          } catch { tokenList.replaceChildren(node('p', 'Token list unavailable.')); }
        };
        await renderTokens(); serverSection.append(tokenList);
        const create = node('fieldset'), tokenName = input('Token name (lowercase slug, e.g. claude-code)'), expiry = input('Expires after days (blank = never)'), reveal = node('div'); create.className = 'platform-mcp-token-form'; reveal.className = 'platform-reveal';
        const scopeGroup = node('fieldset'); scopeGroup.append(node('legend', 'Scopes')); const scopeBoxes = MCP_SCOPES.map(scope => ({ id: scope.id, box: checkbox(scopeGroup, scope.label, scope.id === 'read') }));
        const tokenProjects = node('fieldset'); tokenProjects.append(node('legend', 'Projects it may act on')); const tokenAll = checkbox(tokenProjects, 'All projects', true);
        const tokenBoxes = projects.filter(project => project.name !== 'vault').map(project => ({ name: project.name, box: checkbox(tokenProjects, project.name) }));
        create.append(node('legend', 'Create a token'), tokenName.label, scopeGroup, tokenProjects, expiry.label, action('Create token', async () => {
          const days = expiry.input.value.trim();
          const result = await api.command<{ token: string; record: McpTokenView }>('mcp.tokenCreate', { name: tokenName.input.value.trim(), scopes: scopeBoxes.filter(scope => scope.box.checked).map(scope => scope.id), projects: tokenAll.checked ? '*' : tokenBoxes.filter(item => item.box.checked).map(item => item.name), ...(days ? { expiresDays: Number(days) } : {}) });
          const pre = node('pre', result.token), copy = node('button', 'Copy token'); copy.type = 'button'; copy.onclick = async () => { await copyText(result.token, pre); copy.textContent = 'Copied'; };
          reveal.replaceChildren(node('h4', 'Token ' + result.record.name + ' — shown once'), node('p', 'Copy it now. Nibbi keeps only a hash; once this panel closes the plaintext is gone.'), pre, copy, node('h4', 'Ready-to-paste config'), snippetBlock(result.token));
          tokenName.input.value = ''; message.textContent = ''; await renderTokens();
        }), reveal);
        serverSection.append(create, node('h4', 'Connect a harness'), node('p', 'Replace <token> with a token from above. The address uses this backend\'s port (' + mcpPort() + ').'), snippetBlock('<token>'));
        content.append(serverSection);
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
  for (const tab of ['Providers', 'Skills', 'MCP', 'Vault', 'Proposals', 'Schedules', 'Activity', 'Phone']) {
    const button = node('button', tab); button.type = 'button'; button.onclick = () => { void show(tab); }; tabs.append(button);
  }
  return (tab = 'Providers'): void => { if (!dialog.open) dialog.showModal(); void show(tab); };
}
