// Full-game review: analyse every position of a line, classify every move, compute accuracy.
import { classifyMove, summarize } from './classify.js';
import { gameAccuracy } from './accuracy.js';
import { winPct } from '../chess/score.js';
import { posFromFen, makeSan, parseMove } from '../chess/util.js';
import { moverOf } from '../game/tree.js';

export const REVIEW_PRESETS = {
  fast: { depth: 14, movetime: 1500 },
  standard: { depth: 18, movetime: 4000 },
  deep: { depth: 22, movetime: 12000 },
};

/** Compact analysis record stored on a node. */
export function evalFromResult(res) {
  if (res.terminal) return { score: res.terminal, depth: 99, lines: [], terminal: true };
  const lines = (res.lines || []).filter(Boolean).map(l => ({ score: l.score, pv: l.pv.slice(0, 16), depth: l.depth, wdl: l.wdl }));
  if (!lines.length) return null;
  return { score: lines[0].score, depth: lines[0].depth, best: lines[0].pv[0], pv: lines[0].pv.slice(0, 16), lines, wdl: lines[0].wdl };
}

/** Merge a new analysis into node.eval if it's at least as deep. */
export function storeEval(node, ev) {
  if (!ev) return;
  const old = node.eval;
  if (!old || ev.terminal || (ev.depth || 0) > (old.depth || 0) || ((ev.depth || 0) === (old.depth || 0) && (ev.lines || []).length >= (old.lines || []).length)) {
    node.eval = ev;
  }
}

function legalCount(pos) {
  let n = 0;
  for (const [, dests] of pos.allDests()) n += dests.size();
  return n;
}

/** Classify the move leading to `node` (needs parent.eval and node.eval). Stores the result in node[key]. */
export function reviewMove(node, { openings, key = 'review' } = {}) {
  const parent = node.parent;
  if (!parent || !parent.eval || !node.eval) return null;
  const mover = moverOf(node);
  const posBefore = posFromFen(parent.fen);
  const posAfter = posFromFen(node.fen);
  const book = !!(openings && openings.isBook(node.epd) && (!parent.parent || openings.isBook(parent.epd)));
  const review = classifyMove({
    mover, uci: node.uci,
    before: parent.eval.terminal ? null : parent.eval,
    after: node.eval,
    book,
    legalMoves: legalCount(posBefore),
    opponentLoss: parent[key] ? parent[key].loss : parent.oppLoss || 0,
    posBefore, posAfter,
    prevUci: parent.uci, prevWasCapture: !!parent.captured,
  });
  if (!review) return null;
  if (review.bestUci) {
    const mv = parseMove(posBefore, review.bestUci);
    if (mv) review.bestSan = makeSan(posBefore, mv);
  }
  node[key] = review;
  return review;
}

export function computeSummary(tree, nodes) {
  const withEval = nodes.every(n => n.eval);
  const moves = nodes.slice(1).map(n => ({ mover: moverOf(n), review: n.review }));
  const sides = summarize(moves);
  let acc = { white: null, black: null };
  if (withEval && nodes.length > 1) {
    const wp = nodes.map(n => winPct(n.eval.score));
    acc = gameAccuracy(wp, tree.turnOf(nodes[0]));
  }
  return {
    white: { ...sides.white, accuracy: acc.white },
    black: { ...sides.black, accuracy: acc.black },
    complete: withEval,
  };
}

export class ReviewRunner {
  constructor({ engine, tree, nodes, preset = 'standard', openings, onProgress, onNode }) {
    this.engine = engine;
    this.tree = tree;
    this.nodes = nodes; // [root/start, ...line]
    this.limits = REVIEW_PRESETS[preset] || REVIEW_PRESETS.standard;
    this.openings = openings;
    this.onProgress = onProgress;
    this.onNode = onNode;
    this.cancelled = false;
    this.current = null;
  }

  cancel() {
    this.cancelled = true;
    if (this.current) this.current.cancel();
  }

  needsAnalysis(node) {
    const ev = node.eval;
    if (!ev) return true;
    if (ev.terminal) return false;
    return (ev.depth || 0) < this.limits.depth || (ev.lines || []).length < 2;
  }

  async run() {
    const { nodes, tree } = this;
    const total = nodes.length;
    for (let i = 0; i < total; i++) {
      if (this.cancelled) return null;
      const node = nodes[i];
      if (this.needsAnalysis(node)) {
        this.current = this.engine.search({
          fen: tree.startFen,
          moves: tree.movesTo(node),
          limits: { ...this.limits },
          options: { MultiPV: 2 },
        });
        const res = await this.current.promise;
        this.current = null;
        if (this.cancelled || res.cancelled) return null;
        if (res.error) throw new Error(res.error);
        storeEval(node, evalFromResult(res));
      }
      if (i > 0) reviewMove(node, { openings: this.openings });
      if (this.onNode) this.onNode(node, i);
      if (this.onProgress) this.onProgress(i + 1, total);
    }
    // Second pass: "miss" depends on the opponent's previous loss, which is now known for every move.
    for (let i = 1; i < total; i++) reviewMove(nodes[i], { openings: this.openings });
    return computeSummary(tree, nodes);
  }
}
