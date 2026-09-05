import { readdirSync, readFileSync, lstatSync, mkdirSync, cpSync, existsSync, writeFileSync, accessSync, constants } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parse } from 'yaml';
import { z } from 'zod';
import type { AgentRole, ProviderId, SkillDescriptor, SkillRef } from '@nibbi/contracts';
import { RuntimeStore, runtime } from './store.js';
import { scopedPath } from './paths.js';

const Frontmatter = z.object({
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64),
  description: z.string().min(1).max(1024),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
const FORBIDDEN = new Set(['.git', '.claude', '.codex', '.agents', '.claude-plugin', 'node_modules', 'hooks.json']);
export function packageFiles(directory: string): string[] {
  const files: string[] = []; let size = 0;
  const walk = (dir: string): void => {
    if (lstatSync(dir).isSymbolicLink()) throw new Error('Skill packages cannot contain symlinks');
    for (const entry of readdirSync(dir).sort()) {
      if (FORBIDDEN.has(entry)) throw new Error(`Skill cannot install agent configuration: ${entry}`);
      const path = join(dir, entry), stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error('Skill packages cannot contain symlinks');
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) { files.push(relative(directory, path)); size += stat.size; }
      else throw new Error('Unsupported skill file');
      if (files.length > 500 || size > 20_000_000) throw new Error('Skill package exceeds 500 files / 20 MB');
    }
  };
  walk(directory); return files;
}
export function skillHash(directory: string): string {
  const hash = createHash('sha256');
  for (const name of packageFiles(directory)) hash.update(name).update('\0').update(readFileSync(join(directory, name))).update('\0');
  return hash.digest('hex');
}
export function inspectSkill(directory: string, source = 'local'): SkillDescriptor {
  const out: SkillDescriptor = { id: '', name: '', description: '', source, path: directory, revision: '', providers: ['claude', 'codex'], roles: ['lead', 'fixer'], dependencies: [], enabled: false, status: 'invalid', errors: [] };
  try {
    out.revision = skillHash(directory);
    const raw = readFileSync(join(directory, 'SKILL.md'), 'utf8');
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) throw new Error('SKILL.md requires YAML name and description');
    const meta = Frontmatter.parse(parse(match[1], { maxAliasCount: 20 }));
    out.name = meta.name; out.id = meta.name; out.description = meta.description;
    const nibbi = z.object({ providers: z.array(z.enum(['claude', 'codex'])).min(1).optional(), roles: z.array(z.enum(['lead', 'fixer'])).min(1).optional(), dependencies: z.array(z.string().regex(/^(bin|tool):[a-zA-Z0-9_-]+$/)).optional() }).parse(meta.metadata?.nibbi ?? {});
    out.providers = nibbi.providers ?? out.providers; out.roles = nibbi.roles ?? out.roles; out.dependencies = nibbi.dependencies ?? [];
    out.status = 'available';
  } catch (error) { out.errors.push((error as Error).message); }
  return out;
}
export class SkillCatalog {
  constructor(readonly store: RuntimeStore) {}
  list(): SkillDescriptor[] { return this.store.list<SkillDescriptor>('skills'); }
  /** Local import is an explicit user operation. No automatic marketplace downloads. */
  import(directory: string, source = 'local', draft = false): SkillDescriptor {
    const skill = inspectSkill(directory, source);
    if (skill.status !== 'available') throw new Error(skill.errors.join('; '));
    const destination = join(this.store.directory, 'skills', 'revisions', skill.revision);
    if (!existsSync(destination)) { mkdirSync(destination, { recursive: true }); cpSync(directory, destination, { recursive: true, dereference: false }); }
    if (skillHash(destination) !== skill.revision) throw new Error('Skill changed during import');
    skill.path = destination;
    if (draft) skill.status = 'draft';
    this.store.put('skill-revisions', `${skill.id}@${skill.revision}`, skill);
    this.store.put('skills', skill.id, skill, { type: draft ? 'skill.drafted' : 'skill.imported', payload: { id: skill.id, revision: skill.revision } });
    return skill;
  }
  review(id: string, revision: string): SkillDescriptor {
    const skill = this.resolve({ id, revision }, true);
    skill.status = 'available';
    this.store.put('skill-revisions', `${id}@${revision}`, skill);
    this.store.put('skills', id, skill, { type: 'skill.reviewed', payload: { id, revision } });
    return skill;
  }
  resolve(ref: SkillRef, allowDraft = false): SkillDescriptor {
    const skill = this.store.get<SkillDescriptor>('skill-revisions', `${ref.id}@${ref.revision}`);
    if (!skill || (!allowDraft && skill.status !== 'available')) throw new Error(`Skill ${ref.id} is not reviewed and available`);
    if (skillHash(skill.path) !== ref.revision) throw new Error(`Skill ${ref.id} revision changed on disk`);
    return skill;
  }
  enable(project: string, role: AgentRole, refs: SkillRef[]): void {
    if (new Set(refs.map(ref => ref.id)).size !== refs.length) throw new Error('Choose one revision of each skill per role');
    for (const ref of refs) { const skill = this.resolve(ref); if (!skill.roles.includes(role)) throw new Error(`Skill ${ref.id} does not support ${role}`); }
    this.store.put('skill-settings', `${project}:${role}`, refs, { projectId: project, type: 'skills.configured', payload: { role, refs } });
  }
  selected(project: string, role: AgentRole, provider: ProviderId): SkillDescriptor[] {
    const refs = this.store.get<SkillRef[]>('skill-settings', `${project}:${role}`) ?? [];
    return refs.map(ref => {
      const skill = this.resolve(ref);
      if (!skill.roles.includes(role) || !skill.providers.includes(provider)) throw new Error(`Skill ${skill.name} does not support ${provider}/${role}`);
      // Dependencies are declared and reviewed, never installed by loading a skill.
      for (const dependency of skill.dependencies) {
        const [kind, name] = dependency.split(':');
        const available = kind === 'bin' ? (process.env.PATH ?? '').split(':').some(path => { try { accessSync(join(path, name), constants.X_OK); return true; } catch { return false; } })
          : ['read_file', 'list_files', 'write_file', 'edit_file', ...(role === 'fixer' ? ['shell'] : ['dispatch_fixer', 'list_fixers', 'steer_fixer'])].includes(name);
        if (!available) throw new Error(`Skill ${skill.name} requires unavailable dependency ${dependency}; loading it cannot install or authorize that dependency`);
      }
      return skill;
    });
  }
  draft(name: string, description: string, body: string, evidence: string[]): SkillDescriptor {
    if (evidence.length < 2 || new Set(evidence).size < 2) throw new Error('A learned skill needs evidence from at least two distinct runs');
    for (const id of evidence) { const run = this.store.get<{ status: string; endedAt?: string; summary?: string }>('fixers', id); if (!run || !run.endedAt || !run.summary || !['staged', 'merged', 'failed', 'cancelled', 'interrupted', 'done'].includes(run.status)) throw new Error(`Evidence run ${id} must have a terminal outcome and recorded observations`); }
    Frontmatter.parse({ name, description });
    const directory = join(this.store.directory, 'skills', 'drafts', randomUUID()); mkdirSync(directory, { recursive: true });
    writeFileSync(scopedPath(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n`);
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ runs: evidence, createdAt: new Date().toISOString() }, null, 2));
    return this.import(directory, 'learned', true);
  }
  /** Controlled native plugin: only pinned skill files, never third-party hooks/settings. */
  materialize(runId: string, skills: SkillDescriptor[]): { root: string; paths: string[] } {
    if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error('Invalid run id');
    const root = join(this.store.directory, 'provider-skills', runId);
    mkdirSync(join(root, '.claude-plugin'), { recursive: true });
    writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'nibbi', version: '1.0.0', description: 'Pinned Nibbi skills' }));
    const paths = skills.map(skill => {
      this.resolve({ id: skill.id, revision: skill.revision });
      const destination = join(root, 'skills', skill.name);
      mkdirSync(destination, { recursive: true }); cpSync(skill.path, destination, { recursive: true });
      return join(destination, 'SKILL.md');
    });
    return { root, paths };
  }
}
export const skillCatalog = (): SkillCatalog => new SkillCatalog(runtime());
