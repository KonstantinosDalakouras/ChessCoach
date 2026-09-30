import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Engine } from '../src/js/engine/engine.js';
import { nodeTransportFactory } from './node-transport.mjs';
import { importPgn, exportPgn } from '../src/js/game/pgn.js';
import { GameTree } from '../src/js/game/tree.js';
import { ReviewRunner } from '../src/js/analysis/review.js';
import { openings } from '../src/js/game/openings.js';
import { explainMove } from '../src/js/analysis/explain.js';
import { formatScore } from '../src/js/chess/score.js';
import { posFromFen } from '../src/js/chess/util.js';

openings.loadData(JSON.parse(readFileSync(new URL('../src/static/data/openings.json', import.meta.url))));

// --- PGN import with comments, clocks, evals, variations, NAGs
const pgn = `[Event "Test"]
[White "A"]
[Black "B"]
[Result "0-1"]

1. e4 { [%clk 0:05:00] [%eval 0.3] } e5 2. Nf3 Nc6 3. Bc4 Nd4!? (3... Nf6 4. Ng5) 4. Nxe5? Qg5 5. Nxf7?? Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# 0-1`;
const [g] = importPgn(pgn);
assert.equal(g.errors.length, 0, g.errors.join());
const ml = g.tree.mainline();
assert.equal(ml.length, 14);
assert.equal(ml[0].clock, 300);
assert.equal(ml[0].pgnEval.cp, 30);
assert.deepEqual(ml[5].nags, [5]);
assert.equal(ml[4].children.length, 2);
assert.equal(ml[5].parent.children[1].san, "Nf6", "variation 3...Nf6 kept");
assert.equal(g.tree.headers.White, 'A');
assert.equal(openings.forNode(ml[4]).name.startsWith('Italian Game'), true);
console.log('opening at ply 5:', openings.forNode(ml[4]));
console.log('opening at ply 6:', openings.forNode(ml[5]));

// --- repetition count
const rep = new GameTree();
let n = rep.root;
for (const m of ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']) n = rep.addMove(n, m);
assert.equal(rep.repetitionCount(n), 3);

// --- JSON roundtrip
const j = JSON.parse(JSON.stringify(g.tree.toJSON()));
const t2 = GameTree.fromJSON(j);
assert.equal(t2.mainline().length, 14);
assert.equal(t2.mainline()[5].nags[0], 5);

// --- Review with real engine
const createTransport = await nodeTransportFactory();
const engine = new Engine({ createTransport });
await engine.init({ Hash: 32 });
const nodes = [g.tree.root, ...ml];
const runner = new ReviewRunner({ engine, tree: g.tree, nodes, preset: 'fast', openings });
runner.limits = { depth: 12, movetime: 3000 };
const t0 = Date.now();
const summary = await runner.run();
console.log('review took', Date.now() - t0, 'ms');
for (const node of ml) {
  const r = node.review;
  const ex = explainMove({ review: r, mover: node.ply % 2 ? 'white' : 'black', posBefore: posFromFen(node.parent.fen), posAfter: posFromFen(node.fen),
    bestPv: node.parent.eval.pv, afterPv: node.eval.pv, bestSan: r.bestSan, opening: '' });
  console.log(String(node.ply).padStart(2), node.san.padEnd(6), (r.cls).padEnd(10), 'loss', String(r.loss).padEnd(5), 'best', (r.bestSan||'').padEnd(6), formatScore(node.eval.score).padEnd(7), ex.items.map(i => i.key + (i.params ? JSON.stringify(i.params) : '')).join(' | '));
}
console.log('summary', JSON.stringify({ w: summary.white.accuracy?.toFixed(1), b: summary.black.accuracy?.toFixed(1), wc: summary.white.counts, bc: summary.black.counts, acpl: [summary.white.acpl, summary.black.acpl] }));
const cls = ml.map(x => x.review.cls);
assert.ok(['mistake', 'blunder', 'inaccuracy'].includes(cls[6]), '4.Nxe5 should be an error: ' + cls[6]);
assert.ok(['blunder', 'mistake'].includes(cls[8]), '5.Nxf7 should be a blunder: ' + cls[8]);
assert.equal(ml[13].eval.terminal, true);
assert.ok(summary.black.accuracy > summary.white.accuracy);

// --- Export with annotations and re-import
const out = exportPgn(g.tree, { describe: node => node.review && ['blunder','mistake'].includes(node.review.cls) ? `${node.review.cls}. Best was ${node.review.bestSan}.` : undefined });
console.log(out.split('\n').slice(-4).join('\n'));
const [g2] = importPgn(out);
assert.equal(g2.tree.mainline().length, 14);
assert.ok(out.includes('[%eval'));
assert.ok(out.includes('$4') || out.includes('??'));
engine.terminate();
console.log('ALL REVIEW TESTS PASSED');
process.exit(0);
