import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
const { githubApi, githubGit, clearGithubCache, replaceGithubRunnerForTest, GithubError } = await import('../src/github-cli.js');
const cwd = process.cwd();
const http = (body: unknown, headers = '') => ({ code: 0, stderr: '', stdout: 'HTTP/2.0 200 OK\r\n' + headers + '\r\n' + JSON.stringify(body) });

test('conditional GitHub reads retain the last confirmed response only after a server 304', async () => {
  const calls: string[][] = [];
  const restore = replaceGithubRunnerForTest(async (_command, args) => {
    calls.push(args);
    return args.includes('If-None-Match: "commit-1"') ? { code: 1, stdout: 'HTTP/2.0 304 Not Modified\r\n\r\n', stderr: 'gh: HTTP 304' } : http({ sha: 'first' }, 'ETag: "commit-1"\r\n');
  });
  try {
    const first = await githubApi('github.com', 'repos/example/project/branches/main', cwd); first.sha = 'mutated by consumer';
    const second = await githubApi('github.com', 'repos/example/project/branches/main', cwd);
    assert.equal(second.sha, 'first'); assert.equal(calls.length, 2); assert.ok(calls[1].includes('If-None-Match: "commit-1"')); assert.ok(calls.every(args => args.includes('GET')));
    clearGithubCache(); await githubApi('github.com', 'repos/example/project/branches/main', cwd); assert.equal(calls[2].some(arg => arg.startsWith('If-None-Match:')), false);
  } finally { restore(); }
});

test('coalescing and host concurrency bound duplicate refreshes without sharing mutable responses', async () => {
  let active = 0, maximum = 0, count = 0;
  const restore = replaceGithubRunnerForTest(async () => {
    count++; active++; maximum = Math.max(active, maximum); await new Promise(resolve => setTimeout(resolve, 10)); active--;
    return http({ values: ['confirmed'] });
  });
  try {
    const results = await Promise.all([githubApi('github.com', 'repos/a/one', cwd), githubApi('github.com', 'repos/a/one', cwd), githubApi('github.com', 'repos/a/two', cwd), githubApi('github.com', 'repos/a/three', cwd)]);
    assert.equal(count, 3); assert.equal(maximum, 2); results[0].values.push('local'); assert.deepEqual(results[1].values, ['confirmed']);
  } finally { restore(); }
});

test('rate-limit headers prevent immediate repeat API calls while local Git reads remain available', async () => {
  let count = 0;
  const restore = replaceGithubRunnerForTest(async command => {
    if (command === 'git') return { code: 0, stdout: 'main\n', stderr: '' };
    count++; return { code: 1, stdout: 'HTTP/2.0 429 Too Many Requests\r\nRetry-After: 120\r\n\r\n{"message":"rate limit"}', stderr: 'rate limit exceeded' };
  });
  try {
    let until = 0;
    await assert.rejects(githubApi('github.com', 'repos/a/one', cwd), error => { assert.ok(error instanceof GithubError); assert.equal(error.code, 'RATE_LIMITED'); until = error.retryAfter!; return true; });
    assert.ok(until >= Date.now() + 119_000);
    await assert.rejects(githubApi('github.com', 'repos/a/two', cwd), /requested a pause/); assert.equal(count, 1);
    assert.equal(await githubGit(cwd, ['symbolic-ref', '--short', 'HEAD']), 'main');
  } finally { restore(); }
});

test('a mutation invalidation cannot reuse an already running earlier observation', async () => {
  const releases: Array<() => void> = [];
  let count = 0;
  const restore = replaceGithubRunnerForTest(async () => { const current = ++count; await new Promise<void>(resolve => releases.push(resolve)); return http({ version: current }, 'ETag: "' + current + '"\r\n'); });
  try {
    const old = githubApi('github.com', 'repos/a/one', cwd);
    await new Promise(resolve => setImmediate(resolve)); clearGithubCache();
    const fresh = githubApi('github.com', 'repos/a/one', cwd);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(count, 2);
    releases[1](); assert.equal((await fresh).version, 2); releases[0](); assert.equal((await old).version, 1);
  } finally { releases.forEach(release => release()); restore(); }
});
