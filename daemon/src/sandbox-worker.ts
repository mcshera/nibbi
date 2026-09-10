// One worker per command: SRT proxy/config state is never shared between runs.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { SandboxManager, SandboxRuntimeConfigSchema } from '@anthropic-ai/sandbox-runtime';
const require = createRequire(import.meta.url);
const { parse } = require('shell-quote') as { parse: (text: string) => unknown[] };

try {
  const settings = SandboxRuntimeConfigSchema.parse(JSON.parse(readFileSync(process.argv[2], 'utf8')));
  await SandboxManager.initialize(settings, undefined, false);
  const parts = parse(await SandboxManager.wrapWithSandbox(process.argv[3], '/bin/bash')).map(part => {
    // shell-quote reports SRT's escaped *.local proxy exclusion as a glob.
    // Pass this exact known value literally to env; never expand a glob.
    const glob = part as { op?: string; pattern?: string };
    if (glob?.op === 'glob' && /^(NO_PROXY|no_proxy)=localhost,127\.0\.0\.1,::1,\*\.local,\.local,169\.254\.0\.0\/16,10\.0\.0\.0\/8,172\.16\.0\.0\/12,192\.168\.0\.0\/16$/.test(glob.pattern ?? '')) return glob.pattern;
    return part;
  });
  // Fail closed if the pinned SRT wrapper format changes. Never execute parsed shell operators.
  if (parts.some(part => typeof part !== 'string')) throw new Error('Unsupported sandbox wrapper syntax');
  const args = parts as string[], index = args.indexOf('sandbox-exec');
  if (args[0] !== 'env' || index < 1 || args[index + 1] !== '-p' || !args[index + 2]?.includes('(deny default') || args.slice(1, index).some(arg => !/^[a-zA-Z_][a-zA-Z0-9_]*=/.test(arg))) throw new Error('Unsupported sandbox wrapper; upgrade requires policy review');
  const tmp = args.findIndex(arg => arg.startsWith('TMPDIR=')); if (tmp < 1 || !process.env.TMPDIR) throw new Error('Sandbox scratch directory is required'); args[tmp] = 'TMPDIR=' + process.env.TMPDIR;
  // SRT protects denied read regions against rename/unlink as well as reads.
  // Its broad /Users and state-directory movement rules also cover explicitly
  // writable worktrees/scratch, preventing npm from replacing its own files.
  // Exclude only those writable subtrees from the READ movement guards. Keep
  // ancestor guards, credential globs and every WRITE denial unchanged.
  const profile = args[index + 2], readStart = profile.indexOf('; File read\n'), writeStart = profile.indexOf('; File write\n');
  if (readStart < 0 || writeStart <= readStart) throw new Error('Unsupported sandbox filesystem profile; upgrade requires policy review');
  const writable = settings.filesystem.allowWrite;
  if (writable.some(path => !path.startsWith('/') || path === '/' || /[*?\[\]\r\n]/.test(path))) throw new Error('Sandbox write roots must be explicit absolute directories');
  const readRules = profile.slice(readStart, writeStart).replace(/\(deny file-write-unlink\s+\(subpath ("(?:\\.|[^"\\])*")\)\s+(\(with message "(?:\\.|[^"\\])*"\))\)/g, (rule, quotedPath: string, message: string) => {
    const deniedPath = JSON.parse(quotedPath) as string;
    const exceptions = writable.filter(path => path === deniedPath || path.startsWith(deniedPath.replace(/\/$/, '') + '/'));
    if (!exceptions.length) return rule;
    return `(deny file-write-unlink\n  (require-all (subpath ${quotedPath})${exceptions.map(path => ` (require-not (subpath ${JSON.stringify(path)}))`).join('')})\n  ${message})`;
  });
  args[index + 2] = profile.slice(0, readStart) + readRules + profile.slice(writeStart);
  // SRT allowRead takes precedence over denyRead. Append the credential rule last
  // to the SAME profile (macOS does not support nesting sandbox_apply calls).
  args[index + 2] += '\n(deny file-read* file-write* (regex "(^|/)([.]env([.][^/]+)?|[.]ssh|[.]aws|[.]gnupg|[.]npmrc|[.]netrc)(/|$)"))';
  args[index] = '/usr/bin/sandbox-exec';
  // SRT discovers host dependencies before applying the sandbox. Only its child
  // receives the restricted PATH; inaccessible npm launcher paths break spawn.
  if (!process.argv[4]) throw new Error('Sandbox command PATH is required');
  args.splice(index, 0, 'PATH=' + process.argv[4]);
  const child = spawn('/usr/bin/env', args.slice(1), { stdio: 'inherit' });
  const stop = (): void => { child.kill('SIGTERM'); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  try { process.exitCode = await new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code ?? 1)); }); }
  finally { process.off('SIGTERM', stop); process.off('SIGINT', stop); }
} catch (error) { console.error((error as Error).message); process.exitCode = 1; }
finally {
  // SRT's unreferenced proxy servers can leave close callbacks unsettled after
  // HTTPS downloads. This worker owns one finished command: give cleanup a
  // bounded grace period, then close its proxy handles by exiting the worker.
  // Keep the child's actual status, including failures and cancellation.
  const cleanupDeadline = setTimeout(() => {
    console.warn('Sandbox proxy cleanup exceeded its grace period; closing command worker');
    process.exit(typeof process.exitCode === 'number' ? process.exitCode : 1);
  }, 1000);
  try { await SandboxManager.reset(); }
  finally { clearTimeout(cleanupDeadline); }
}
