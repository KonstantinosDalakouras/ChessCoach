// SF19 Coach — deploy build (used by Render: `npm ci && npm run build`, publish directory `dist`).
// 1) downloads Stockfish 19 (WebAssembly) from the official npm package and verifies its checksum,
// 2) copies the ready-built site files + the engine into dist/.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';

const TARBALL = 'https://registry.npmjs.org/stockfish/-/stockfish-19.0.0.tgz';
const SHA1 = '88db50693ea779c8f4a3a4c1171250b3d5654bb7';
const SITE = [
  'index.html', 'app.js', 'app.css', 'sw.js', 'manifest.webmanifest', 'openings.json',
  'favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  'source.zip', 'LICENSE', 'LICENSE-lucide.txt',
];
const ENGINE = [
  'stockfish-19.js', 'stockfish-19.wasm', 'stockfish-19-single.js', 'stockfish-19-single.wasm',
  'stockfish-19-lite.js', 'stockfish-19-lite.wasm', 'stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm',
];

const missing = SITE.filter(f => !existsSync(f) && !['source.zip', 'LICENSE-lucide.txt'].includes(f));
if (missing.length) {
  console.error(`✖ Missing site files in the repository root: ${missing.join(', ')}`);
  console.error('  Upload ALL files of the sf19-coach-render folder to the root of the GitHub repository.');
  process.exit(1);
}

console.log(`↓ Downloading Stockfish 19: ${TARBALL}`);
const res = await fetch(TARBALL);
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());
const sha1 = createHash('sha1').update(buf).digest('hex');
if (sha1 !== SHA1) throw new Error(`Checksum mismatch (${sha1}) — refusing to use the download`);
console.log(`✔ ${(buf.length / 1048576).toFixed(0)} MB, checksum OK`);

rmSync('dist', { recursive: true, force: true });
rmSync('.sf-tmp', { recursive: true, force: true });
mkdirSync('dist/engine', { recursive: true });
mkdirSync('.sf-tmp', { recursive: true });
writeFileSync('.sf-tmp/sf.tgz', buf);
execSync('tar -xzf sf.tgz', { cwd: '.sf-tmp' });
for (const f of ENGINE) copyFileSync(`.sf-tmp/package/bin/${f}`, `dist/engine/${f}`);
copyFileSync('.sf-tmp/package/Copying.txt', 'dist/engine/COPYING.txt');
rmSync('.sf-tmp', { recursive: true, force: true });

for (const f of SITE) if (existsSync(f)) copyFileSync(f, `dist/${f}`);

console.log('✔ dist/ ready:');
for (const f of [...SITE.filter(existsSync), ...ENGINE.map(e => `engine/${e}`)]) {
  console.log(`   ${f.padEnd(34)} ${(statSync(`dist/${f}`).size / 1024).toFixed(0)} KiB`);
}
