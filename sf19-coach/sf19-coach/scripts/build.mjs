// Build: bundles the app with esbuild, copies Stockfish 19 (WASM) from the npm package and static files into dist/.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');
const dev = process.argv.includes('--dev');
const nm = join(root, 'node_modules');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'assets'), { recursive: true });
mkdirSync(join(dist, 'engine'), { recursive: true });

// 1) Piece sprites (cburnett, from chessground) as CSS classes for figurines, captured pieces, editor.
const cburnett = readFileSync(join(nm, '@lichess-org/chessground/assets/chessground.cburnett.css'), 'utf8');
const pieceRules = [];
for (const m of cburnett.matchAll(/\.cg-wrap piece\.(\w+)\.(white|black)\s*\{\s*background-image:\s*url\('([^']+)'\);?\s*\}/g)) {
  const [, role, color, uri] = m;
  pieceRules.push(`.pc-${role}-${color}{background-image:url('${uri}')}`);
  if (color === 'white') pieceRules.push(`.fig-${role}{background-image:url('${uri}')}`);
}
if (pieceRules.length < 18) throw new Error('could not extract piece images');
mkdirSync(join(root, 'build-tmp'), { recursive: true });
writeFileSync(join(root, 'build-tmp/pieces.css'), `/* generated from chessground cburnett (GPL) */\n${pieceRules.join('\n')}\n`);

// 2) JS + CSS bundles
const common = { bundle: true, minify: !dev, sourcemap: true, target: ['es2020', 'chrome90', 'firefox90', 'safari15'], logLevel: 'warning', legalComments: 'linked' };
const js = await build({
  ...common,
  entryPoints: { app: join(src, 'js/main.jsx') },
  outdir: join(dist, 'assets'),
  entryNames: '[name]-[hash]',
  format: 'esm',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  metafile: true,
  define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
});
const css = await build({
  ...common,
  entryPoints: { app: join(src, 'css/app.css') },
  outdir: join(dist, 'assets'),
  entryNames: '[name]-[hash]',
  metafile: true,
  loader: { '.svg': 'dataurl', '.png': 'dataurl' },
});
const outName = (meta, ext) => Object.keys(meta.metafile.outputs).find(f => f.endsWith(ext) && !f.endsWith('.map')).split('/').slice(-2).join('/');
const appJs = outName(js, '.js');
const appCss = outName(css, '.css');

// 3) Static files
function copyDir(from, to) {
  for (const name of readdirSync(from)) {
    const a = join(from, name), b = join(to, name);
    if (statSync(a).isDirectory()) { mkdirSync(b, { recursive: true }); copyDir(a, b); }
    else copyFileSync(a, b);
  }
}
copyDir(join(src, 'static'), dist);

// 4) Stockfish 19 engine files (downloaded by `npm ci` from the `stockfish` package)
const sfBin = join(nm, 'stockfish/bin');
const engines = ['stockfish-19', 'stockfish-19-single', 'stockfish-19-lite', 'stockfish-19-lite-single'];
for (const e of engines) {
  for (const ext of ['.js', '.wasm']) {
    const f = join(sfBin, e + ext);
    if (!existsSync(f)) throw new Error(`Missing engine file ${f} — run "npm ci" first`);
    copyFileSync(f, join(dist, 'engine', e + ext));
  }
}
copyFileSync(join(nm, 'stockfish/Copying.txt'), join(dist, 'engine/COPYING.txt'));

// 5) index.html
const version = createHash('sha256').update(appJs + appCss + readFileSync(join(src, 'sw.js'))).digest('hex').slice(0, 10);
let html = readFileSync(join(src, 'index.html'), 'utf8');
html = html.replace('%APP_JS%', appJs).replace('%APP_CSS%', appCss).replace(/%VERSION%/g, version);
writeFileSync(join(dist, 'index.html'), html);

// 6) Service worker with the precache list
const precache = ['./', appJs, appCss, 'data/openings.json', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon.svg'];
let sw = readFileSync(join(src, 'sw.js'), 'utf8');
sw = sw.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache));
writeFileSync(join(dist, 'sw.js'), sw);

rmSync(join(root, 'build-tmp'), { recursive: true, force: true });

// Report
const size = f => statSync(join(dist, f)).size;
const kb = n => `${(n / 1024).toFixed(0)} KiB`;
console.log(`✔ built ${dev ? '(dev) ' : ''}v${version}`);
console.log(`  ${appJs}  ${kb(size(appJs))}`);
console.log(`  ${appCss}  ${kb(size(appCss))}`);
for (const e of engines) console.log(`  engine/${e}.wasm  ${(size(`engine/${e}.wasm`) / 1048576).toFixed(1)} MiB`);
