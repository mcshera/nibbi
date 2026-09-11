import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

test('transcription uploads are private and removed on success, failure and closed response', async () => {
  const state = mkdtempSync(join(tmpdir(), 'nibbi-voice-privacy-'));
  process.env.NIBBI_STATE_DIR = state;
  mkdirSync(join(state, 'bin'));
  const helper = join(state, 'bin', 'transcribe');
  const script = (fail = false) => writeFileSync(helper, `#!${process.execPath}
const fs = require('node:fs'); const file = process.argv[2]; if ((fs.statSync(file).mode & 0o777) !== 0o600) process.exit(9); if (fs.readFileSync(file, 'utf8') !== 'synthetic audio') process.exit(8); ${fail ? "process.exit(7);" : "console.log('synthetic transcript');"}
`, { mode: 0o700 });
  try {
    const { api } = await import('../src/api.js');
    const invoke = async (closed = false) => {
      const req = Object.assign(Readable.from([Buffer.from('synthetic audio')]), { method: 'POST', headers: {} });
      let code = 0, result: unknown;
      const res = { destroyed: closed, writableEnded: false, writeHead: (value: number) => { code = value; }, end: (value: string) => { result = JSON.parse(value); } };
      await api(req as any, res as any, new URL('http://localhost/api/transcribe'));
      return { code, result };
    };
    script(); assert.deepEqual(await invoke(), { code: 200, result: { heard: 'synthetic transcript' } });
    assert.deepEqual(readdirSync(join(state, 'tmp')), []);
    script(true); await assert.rejects(invoke(), /exited 7/);
    assert.deepEqual(readdirSync(join(state, 'tmp')), []);
    script(); assert.deepEqual(await invoke(true), { code: 0, result: undefined });
    assert.deepEqual(readdirSync(join(state, 'tmp')), []);
    // Force a real exclusive-create collision at the request's generated path.
    const originalOpen = fs.openSync, originalWrite = fs.writeFileSync;
    let collisionPath = '';
    fs.openSync = ((path: any, flags: any, mode: any) => {
      if (flags === 'wx' && String(path).endsWith('.webm')) {
        collisionPath = String(path);
        originalWrite(path, 'preexisting private audio');
      }
      return originalOpen(path, flags, mode);
    }) as typeof fs.openSync;
    syncBuiltinESMExports();
    try { await assert.rejects(invoke(), (error: any) => error.code === 'EEXIST'); }
    finally { fs.openSync = originalOpen; syncBuiltinESMExports(); }
    assert.equal(fs.readFileSync(collisionPath, 'utf8'), 'preexisting private audio');
    rmSync(collisionPath);

    // An owned file must be closed and removed even after a partial write fails.
    let partialFd: number | undefined;
    fs.writeFileSync = ((path: any, data: any, options: any) => {
      if (typeof path === 'number') {
        partialFd = path;
        originalWrite(path, 'partial');
        throw new Error('synthetic partial write failure');
      }
      return originalWrite(path, data, options);
    }) as typeof fs.writeFileSync;
    syncBuiltinESMExports();
    try { await assert.rejects(invoke(), /synthetic partial write failure/); }
    finally { fs.writeFileSync = originalWrite; syncBuiltinESMExports(); }
    assert.notEqual(partialFd, undefined);
    assert.throws(() => fs.fstatSync(partialFd!), (error: any) => error.code === 'EBADF');
    assert.deepEqual(readdirSync(join(state, 'tmp')), []);

  } finally { rmSync(state, { recursive: true, force: true }); }
});
