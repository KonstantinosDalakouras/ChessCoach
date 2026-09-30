// Game tree with variations. Every node stores its FEN, so any node can be displayed/analysed directly.
import { START_FEN, setupPosition, posFromFen, applyUci, epdFromFen } from '../chess/util.js';

let nodeSeq = 0;
const newId = () => `n${(++nodeSeq).toString(36)}`;

function plyFromFen(fen) {
  const parts = fen.split(' ');
  const full = parseInt(parts[5] || '1', 10) || 1;
  return (full - 1) * 2 + (parts[1] === 'b' ? 1 : 0);
}

export class GameTree {
  constructor(startFen = START_FEN) {
    const r = setupPosition(startFen);
    if (r.error) throw new Error(`Invalid start position: ${r.error}`);
    this.root = {
      id: newId(), parent: null, children: [], uci: null, san: null,
      fen: r.fen, epd: epdFromFen(r.fen), ply: plyFromFen(r.fen), check: r.pos.isCheck(),
    };
    this.headers = {};
    this.index = new Map([[this.root.id, this.root]]);
  }

  get startFen() { return this.root.fen; }
  get isStandardStart() { return this.root.fen === START_FEN; }

  get(id) { return this.index.get(id); }

  pos(node) { return posFromFen(node.fen); }

  turnOf(node) { return node.fen.split(' ')[1] === 'b' ? 'black' : 'white'; }

  /** Add (or reuse) the child reached by `uci`. Returns the child node or undefined if illegal. */
  addMove(parent, uci, { asMainline = false } = {}) {
    const existing = parent.children.find(c => c.uci === uci);
    if (existing) return existing;
    const r = applyUci(this.pos(parent), uci);
    if (!r) return undefined;
    const again = parent.children.find(c => c.uci === r.uci);
    if (again) return again;
    const node = {
      id: newId(), parent, children: [], uci: r.uci, san: r.san, fen: r.fen, epd: r.epd,
      ply: parent.ply + 1, check: r.check, captured: r.captured, castle: r.castle, promotion: r.promotion,
    };
    if (asMainline) parent.children.unshift(node);
    else parent.children.push(node);
    this.index.set(node.id, node);
    return node;
  }

  /** Nodes from root's child to `node` (inclusive). */
  path(node) {
    const out = [];
    for (let n = node; n && n.parent; n = n.parent) out.push(n);
    return out.reverse();
  }

  /** UCI moves from root to node. */
  movesTo(node) { return this.path(node).map(n => n.uci); }

  /** Mainline nodes (excluding root) starting after `from`. */
  mainline(from = this.root) {
    const out = [];
    for (let n = from.children[0]; n; n = n.children[0]) out.push(n);
    return out;
  }

  /** Follow the first child from `node` to the end of its line. */
  lineEnd(node) {
    let n = node;
    while (n.children[0]) n = n.children[0];
    return n;
  }

  isMainline(node) {
    for (let n = node; n.parent; n = n.parent) if (n.parent.children[0] !== n) return false;
    return true;
  }

  /** Is `node` on the path from root to `target`? */
  isAncestorOf(node, target) {
    for (let n = target; n; n = n.parent) if (n === node) return true;
    return false;
  }

  /** Make the line through `node` the mainline. */
  promoteToMainline(node) {
    for (let n = node; n.parent; n = n.parent) {
      const siblings = n.parent.children;
      const i = siblings.indexOf(n);
      if (i > 0) { siblings.splice(i, 1); siblings.unshift(n); }
    }
  }

  /** Move a variation one step up among its siblings. */
  promoteVariation(node) {
    const siblings = node.parent && node.parent.children;
    if (!siblings) return;
    const i = siblings.indexOf(node);
    if (i > 0) { siblings.splice(i, 1); siblings.splice(i - 1, 0, node); }
  }

  /** Delete `node` and its subtree. Returns the parent. */
  deleteNode(node) {
    if (!node.parent) return node;
    const parent = node.parent;
    parent.children = parent.children.filter(c => c !== node);
    this._unindex(node);
    return parent;
  }

  /** Remove everything after `node`. */
  truncateAfter(node) {
    for (const c of node.children) this._unindex(c);
    node.children = [];
  }

  _unindex(node) {
    this.index.delete(node.id);
    for (const c of node.children) this._unindex(c);
  }

  /** Number of positions identical (board, turn, castling, ep) to `node` on its path (for threefold). */
  repetitionCount(node) {
    let count = 0;
    let n = node;
    let halfmoves = parseInt(node.fen.split(' ')[4] || '0', 10);
    while (n) {
      if (n.epd === node.epd) count++;
      if (halfmoves <= 0) break; // irreversible move: earlier positions can't repeat
      n = n.parent;
      halfmoves--;
    }
    return count;
  }

  // ---- serialization (compact, for autosave and the game library) ----
  toJSON() {
    const enc = n => {
      const o = { u: n.uci };
      if (n.comments && n.comments.length) o.cm = n.comments;
      if (n.nags && n.nags.length) o.ng = n.nags;
      if (n.clock !== undefined) o.ck = n.clock;
      if (n.eval) o.ev = n.eval;
      if (n.review) o.rv = n.review;
      if (n.coach) o.co = n.coach;
      if (n.flags) o.fl = n.flags;
      if (n.children.length) o.c = n.children.map(enc);
      return o;
    };
    return {
      v: 1, fen: this.root.fen, headers: this.headers,
      root: { ev: this.root.eval, cm: this.root.comments, c: this.root.children.map(enc) },
    };
  }

  static fromJSON(data) {
    const tree = new GameTree(data.fen || START_FEN);
    tree.headers = data.headers || {};
    const r = data.root || {};
    if (r.ev) tree.root.eval = r.ev;
    if (r.cm) tree.root.comments = r.cm;
    const dec = (parent, list) => {
      for (const o of list || []) {
        const node = tree.addMove(parent, o.u);
        if (!node) continue;
        if (o.cm) node.comments = o.cm;
        if (o.ng) node.nags = o.ng;
        if (o.ck !== undefined) node.clock = o.ck;
        if (o.ev) node.eval = o.ev;
        if (o.rv) node.review = o.rv;
        if (o.co) node.coach = o.co;
        if (o.fl) node.flags = o.fl;
        dec(node, o.c);
      }
    };
    dec(tree.root, r.c);
    return tree;
  }
}

/** Move number label for a node: "12." for white moves, "12…" for black. */
export function moveNumberLabel(node, forceBlack = false) {
  const moveNo = Math.floor((node.ply - 1) / 2) + 1;
  const white = node.ply % 2 === 1;
  return white ? `${moveNo}.` : forceBlack ? `${moveNo}…` : '';
}

export const isWhiteMove = node => node.ply % 2 === 1;
export const moverOf = node => (node.ply % 2 === 1 ? 'white' : 'black');
