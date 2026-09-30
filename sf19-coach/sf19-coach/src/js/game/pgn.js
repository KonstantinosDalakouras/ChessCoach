// PGN import/export on top of chessops' PGN parser/writer.
import { parsePgn, makePgn, startingPosition, parseComment, makeComment, ChildNode, Node as PgnNode } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { makeFen } from 'chessops/fen';
import { GameTree } from './tree.js';
import { setupPosition, uciOf } from '../chess/util.js';
import { isMate } from '../chess/score.js';

const HEADER_ORDER = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];

/** Parse PGN text. Returns an array of { tree, headers, errors, title }. */
export function importPgn(text) {
  const cleaned = String(text || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').trim();
  if (!cleaned) return [];
  const games = parsePgn(cleaned);
  const out = [];
  for (const game of games) {
    const errors = [];
    const headers = {};
    for (const [k, v] of game.headers) headers[k] = v;
    const start = startingPosition(game.headers);
    if (start.isErr) { errors.push(`FEN: ${start.error.message}`); continue; }
    const fen = makeFen(start.value.toSetup());
    const check = setupPosition(fen);
    if (check.error) { errors.push(`FEN: ${check.error}`); continue; }
    const tree = new GameTree(check.fen);
    // Keep only meaningful headers ("?" placeholders are noise).
    for (const [k, v] of Object.entries(headers)) if (v && v !== '?' && v !== '????.??.??') tree.headers[k] = v;
    if (game.comments && game.comments.length) tree.root.comments = game.comments.map(c => parseComment(c).text).filter(Boolean);
    const walk = (pgnNode, treeNode, pos) => {
      for (const child of pgnNode.children) {
        const move = parseSan(pos, child.data.san);
        if (!move) { errors.push(`Illegal move ${child.data.san} (ply ${treeNode.ply + 1})`); continue; }
        const uci = uciOf(pos, move);
        const node = tree.addMove(treeNode, uci);
        if (!node) { errors.push(`Illegal move ${child.data.san}`); continue; }
        const texts = [];
        for (const c of [...(child.data.startingComments || []), ...(child.data.comments || [])]) {
          const pc = parseComment(c);
          if (pc.text) texts.push(pc.text);
          if (pc.clock !== undefined) node.clock = pc.clock;
          if (pc.evaluation) {
            node.pgnEval = pc.evaluation.mate !== undefined
              ? { mate: pc.evaluation.mate }
              : { cp: Math.round(pc.evaluation.pawns * 100) };
          }
        }
        if (texts.length) node.comments = texts;
        if (child.data.nags && child.data.nags.length) node.nags = child.data.nags.slice();
        const next = pos.clone();
        next.play(move);
        walk(child, node, next);
      }
    };
    walk(game.moves, tree.root, start.value);
    const w = tree.headers.White, b = tree.headers.Black;
    const title = w || b ? `${w || '?'} – ${b || '?'}` : `${tree.mainline().length} plies`;
    out.push({ tree, headers: tree.headers, errors, title });
  }
  return out;
}

const NAG_FOR_CLASS = { brilliant: 3, great: 1, blunder: 4, mistake: 2, inaccuracy: 6, miss: 2 };

/**
 * Export a tree to PGN.
 * opts: { headers, evals, annotations, clocks, variations, describe(node) -> string|undefined }
 */
export function exportPgn(tree, opts = {}) {
  const { evals = true, annotations = true, clocks = true, variations = true, describe } = opts;
  const headers = new Map();
  const all = { ...tree.headers, ...(opts.headers || {}) };
  const defaults = { Event: '?', Site: '?', Date: '????.??.??', Round: '?', White: '?', Black: '?', Result: '*' };
  for (const k of HEADER_ORDER) headers.set(k, all[k] || defaults[k]);
  for (const [k, v] of Object.entries(all)) {
    if (HEADER_ORDER.includes(k) || k === 'FEN' || k === 'SetUp' || v === undefined || v === '') continue;
    headers.set(k, String(v));
  }
  if (!tree.isStandardStart) { headers.set('SetUp', '1'); headers.set('FEN', tree.startFen); }

  const convert = (treeNode, pgnParent) => {
    const kids = variations ? treeNode.children : treeNode.children.slice(0, 1);
    for (const node of kids) {
      const nags = [...(node.nags || [])];
      const texts = [...(node.comments || [])];
      const rv = node.review;
      // Our move-quality NAG, unless the game already carries a human one ($1–$6).
      if (annotations && rv && NAG_FOR_CLASS[rv.cls] && !nags.some(x => x >= 1 && x <= 6)) nags.push(NAG_FOR_CLASS[rv.cls]);
      if (annotations && describe) {
        const d = describe(node);
        if (d) texts.push(d);
      }
      const comment = {};
      if (texts.length) comment.text = texts.join(' ');
      const sc = node.eval && node.eval.score;
      if (evals && sc && !(isMate(sc) && sc.mate === 0)) {
        comment.evaluation = isMate(sc) ? { mate: sc.mate, depth: node.eval.depth } : { pawns: Math.round(sc.cp) / 100, depth: node.eval.depth };
      }
      if (clocks && node.clock !== undefined) comment.clock = Math.max(0, node.clock);
      const data = { san: node.san };
      if (nags.length) data.nags = nags;
      const c = makeComment(comment);
      if (c) data.comments = [c];
      const child = new ChildNode(data);
      pgnParent.children.push(child);
      convert(node, child);
    }
  };
  const moves = new PgnNode();
  convert(tree.root, moves);
  const game = { headers, moves };
  if (tree.root.comments && tree.root.comments.length) game.comments = tree.root.comments;
  return makePgn(game);
}

/** "2026.09.30" */
export function pgnDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

/** Seconds → "h:mm:ss" / "m:ss" for TimeControl-ish display. */
export function tcString(baseSec, incSec) {
  return `${baseSec}+${incSec}`;
}
