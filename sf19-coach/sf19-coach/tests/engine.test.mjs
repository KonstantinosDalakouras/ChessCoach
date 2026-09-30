import assert from 'node:assert/strict';
import { Engine } from '../src/js/engine/engine.js';
import { nodeTransportFactory } from './node-transport.mjs';
import { formatScore, winPct } from '../src/js/chess/score.js';
import { setupPosition, pvToSan, see, parseSquare, posFromFen, nullMoveFen, bestCaptureGain } from '../src/js/chess/util.js';

const t0 = Date.now();
const createTransport = await nodeTransportFactory();
const engine = new Engine({ createTransport });
await engine.init({ Hash: 16 });
console.log('engine ready:', engine.name, Object.keys(engine.optionDefs).length, 'options', Date.now() - t0, 'ms');

// 1. bounded search
let r = await engine.run({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', limits: { depth: 10 }, options: { MultiPV: 3 } });
assert.equal(r.lines.length, 3);
assert.ok(r.bestmove && r.bestmove.length >= 4);
console.log('startpos d10:', r.bestmove, r.lines.map(l => formatScore(l.score) + ' ' + pvToSan(r.fen, l.pv, 4).map(m => m.san).join(' ')));

// 2. black to move -> score converted to white POV (white is winning here: black king vs K+Q)
r = await engine.run({ fen: '4k3/8/8/8/8/8/8/3QK3 b - - 0 1', limits: { depth: 12 } });
assert.ok(r.lines[0].score.cp > 500 || r.lines[0].score.mate > 0, JSON.stringify(r.lines[0].score));
console.log('KQ vs K (black to move) white POV:', formatScore(r.lines[0].score));

// 3. preemption: infinite search replaced by another search
let updates = 0;
const s1 = engine.search({ fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', limits: { infinite: true }, onUpdate: () => updates++ });
await new Promise(res => setTimeout(res, 400));
const s2 = engine.search({ fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', limits: { depth: 8 } });
const [r1, r2] = await Promise.all([s1.promise, s2.promise]);
assert.equal(r1.cancelled, true);
assert.ok(updates > 0);
assert.equal(r2.bestmove, 'd1d8');
assert.equal(r2.lines[0].score.mate, 1);
console.log('preempt ok; mate-in-1 found:', r2.bestmove, formatScore(r2.lines[0].score));

// 4. many rapid preemptions: only the last completes normally
const searches = [];
for (let i = 0; i < 6; i++) searches.push(engine.search({ fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', limits: i === 5 ? { depth: 6 } : { infinite: true } }));
const results = await Promise.all(searches.map(s => s.promise));
assert.deepEqual(results.map(x => x.cancelled), [true, true, true, true, true, false]);
console.log('rapid preemption ok');

// 5. strength-limited search + moves list
r = await engine.run({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: ['e2e4', 'e7e5', 'g1f3'], limits: { movetime: 300 }, options: { UCI_LimitStrength: true, UCI_Elo: 1500 } });
assert.ok(r.bestmove);
assert.equal(engine.current.UCI_LimitStrength, 'true');
r = await engine.run({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', limits: { depth: 5 } });
assert.equal(engine.current.UCI_LimitStrength, 'false');
console.log('option switching ok');

// 6. terminal & invalid positions never reach the engine
r = await engine.run({ fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', limits: { depth: 5 } });
assert.equal(r.bestmove, null); assert.equal(r.terminal.mate, 0); assert.equal(r.terminal.mated, 'white');
r = await engine.run({ fen: '4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1', limits: { depth: 5 } });
assert.ok(r.error, 'capturable king must be rejected');
r = await engine.run({ fen: 'QQQQQQQQ/QQ6/8/8/8/8/8/K5k1 w - - 0 1', limits: { depth: 5 } });
assert.ok(r.error, 'too many pieces must be rejected');
// engine still alive afterwards
r = await engine.run({ fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', limits: { depth: 6 } });
assert.equal(r.bestmove, 'd1d8');
console.log('validation ok');

// 7. SEE & helpers
let pos = posFromFen('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1'); // exd5 wins a pawn
assert.equal(see(pos, parseSquare('d5'), 'white'), 1);
pos = posFromFen('4k3/2p5/3p4/8/8/8/3Q4/4K3 w - - 0 1'); // Qxd6 cxd6: loses queen for pawn
assert.equal(see(pos, parseSquare('d6'), 'white'), 1 - 9);
pos = posFromFen('4k3/8/3r4/8/8/3R4/3R4/4K3 w - - 0 1'); // Rxd6 wins a rook (undefended)
assert.equal(see(pos, parseSquare('d6'), 'white'), 5);
pos = posFromFen('3rk3/8/3r4/8/8/3R4/3R4/4K3 w - - 0 1'); // R takes defended rook: RxR RxR RxR = +5
assert.equal(see(pos, parseSquare('d6'), 'white'), 5);
assert.deepEqual(bestCaptureGain(posFromFen('4k3/8/8/8/8/2n5/8/R3K3 w - - 0 1')).gain, 0);
assert.ok(nullMoveFen(posFromFen('4k3/8/8/8/8/8/8/R3K3 w - - 0 1')).includes(' b '));
assert.equal(nullMoveFen(posFromFen('4k3/8/8/8/8/8/8/r3K3 w - - 0 1')), undefined);
assert.ok(setupPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -').fen.endsWith(' 0 1'));
assert.equal(Math.round(winPct({ cp: 0 })), 50);
console.log('helpers ok');

engine.terminate();
console.log('ALL ENGINE TESTS PASSED in', Date.now() - t0, 'ms');
process.exit(0);
