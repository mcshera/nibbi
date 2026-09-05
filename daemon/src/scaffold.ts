import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { games, updateProject } from './projects.js';
import { git, withRepoLock } from './processes.js';
import { sandboxCommand } from './sandbox.js';

/** Owner-requested starter only; refuses to overwrite an existing application. */
export async function scaffoldProject(project: string, template: 'web' | 'game'): Promise<{ files: string[] }> {
  const cfg = games()[project]; if (!cfg) throw new Error('Unknown project');
  return withRepoLock(cfg.repo, async () => {
    if (readdirSync(cfg.repo).some(name => !['.git', 'README.md'].includes(name)) || await git(cfg.repo, 'status', '--porcelain')) throw new Error('Scaffolding requires a clean starter repository containing only README.md');
    const files: Record<string, string> = template === 'web' ? {
      'package.json': JSON.stringify({ name: project, private: true, type: 'module', scripts: { dev: 'vite --host 127.0.0.1', build: 'vite build', test: 'node --check src/main.js' }, devDependencies: { vite: '^7.0.0' } }, null, 2) + '\n',
      'index.html': '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>New app</title><div id="app"></div><script type="module" src="/src/main.js"></script></html>\n',
      'src/main.js': "import './style.css';\ndocument.querySelector('#app').textContent = 'Your next idea starts here.';\n",
      'src/style.css': 'body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 1.5rem system-ui; background: #f7f5ef; color: #26241f; }\n',
      '.gitignore': 'node_modules/\ndist/\n.env*\n',
    } : {
      'design.md': '# Design\n\n## Pillars\n\n## Core loop\n\n## First playable slice\n',
      'rules.md': '# Rules\n\n## Setup\n\n## Turn\n\n## Winning\n',
      'playtests/README.md': '# Playtests\n\nRecord observations, rules questions, and evidence here.\n',
    };
    for (const [name, text] of Object.entries(files)) { const path = join(cfg.repo, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text, { flag: 'wx' }); }
    if (template === 'web') {
      updateProject(project, { install: 'npm ci', check: 'npm test && npm run build', play: 'npm run dev' });
      await sandboxCommand(cfg.repo, 'npm install --package-lock-only --ignore-scripts && npm ci', { domains: ['registry.npmjs.org'] });
      await sandboxCommand(cfg.repo, 'npm test && npm run build');
    }
    await git(cfg.repo, 'add', '-A'); await git(cfg.repo, 'commit', '-m', 'Create ' + template + ' starter');
    return { files: Object.keys(files) };
  });
}
