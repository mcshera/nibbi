import { defineConfig } from 'vite';
import { cpSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

let uiOutput = resolve('dist/ui');
export default defineConfig({
  root: 'public',
  publicDir: false,
  plugins: [{ name: 'nibbi-static-shell', configResolved(config) { uiOutput = resolve(config.root, config.build.outDir); }, closeBundle() {
    for (const name of ['vendor', 'pocket-motion.js', 'nibbi.js', 'fonts', 'icons', 'favicon.svg', 'manifest.webmanifest']) cpSync(join('public', name), join(uiOutput, name), { recursive: true });
    const assets = readdirSync(join(uiOutput, 'assets')).map(name => '/assets/' + name);
    const shell = ['/', '/index.html', '/pocket-motion.js', '/nibbi.js', '/vendor/marked.js', '/vendor/qrcode.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', ...assets];
    const hash = createHash('sha256'); for (const asset of shell) hash.update(asset).update(readFileSync(join(uiOutput, asset === '/' ? 'index.html' : asset.slice(1))));
    const version = hash.digest('hex').slice(0, 12);
    const worker = readFileSync('public/sw.js', 'utf8').replace(/const V = .*?;/, `const V = 'nibbi-${version}';`).replace(/const SHELL = .*?;/, 'const SHELL = ' + JSON.stringify(shell) + ';');
    writeFileSync(join(uiOutput, 'sw.js'), worker);
  } }],
  build: { outDir: '../dist/ui', emptyOutDir: true, target: 'es2022' },
});
