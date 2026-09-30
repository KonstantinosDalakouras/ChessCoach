// Analysis board: free analysis with variations, full-game review and the "learn from your mistakes" trainer.
import { signal } from '@preact/signals';
import { engineManager as engine } from '../engine/manager.js';
import { GameTree, moverOf } from '../game/tree.js';
import { openings } from '../game/openings.js';
import { START_FEN, setupPosition, nullMoveFen, applyUci, posFromFen } from '../chess/util.js';
import { winPctFor } from '../chess/score.js';
import { ReviewRunner, evalFromResult, storeEval, computeSummary, reviewMove } from '../analysis/review.js';
import { settings } from '../store.js';
import { sounds } from '../sound.js';
import { t } from '../i18n.js';
import { toast } from '../ui/common.jsx';
import { saveGame } from '../library.js';

const TRAIN_CLASSES = new Set(['mistake', 'blunder', 'miss']);

const blankReview = () => ({ status: 'idle', done: 0, total: 0, summary: null, error: null });

function initial() {
  const tree = new GameTree();
  return {
    tree, cur: tree.root.id, orientation: 'white', engineOn: true, threat: false, multiPv: settings.value.multiPv || 3,
    meta: { source: 'new', libraryId: null, userColor: null, title: '' },
    review: blankReview(), trainer: null, menu: null,
  };
}

export const anState = signal(initial());
export const anLive = signal(null);
export const anVersion = signal(0);

class AnalysisController {
  constructor() {
    this.active = false;
    this.token = 0;
    this.live = null;
    this.runner = null;
    this.debounce = null;
    this.lastPush = 0;
    engine.onReady(() => { if (this.active) this.analyze(); });
  }

  get s() { return anState.value; }
  get tree() { return this.s.tree; }
  patch(p) { anState.value = { ...anState.value, ...p }; }
  bump() { anVersion.value++; }
  curNode() { return this.tree.get(this.s.cur) || this.tree.root; }

  activate() {
    this.active = true;
    this.analyze();
  }

  deactivate() {
    this.active = false;
    this.stopLive();
    if (this.runner) this.cancelReview();
    if (this.s.trainer && this.trSearch) this.trSearch.cancel();
  }

  // ---------------------------------------------------------------- loading
  load(tree, meta = {}) {
    this.stopLive();
    if (this.runner) this.cancelReview();
    const nodes = [tree.root, ...tree.mainline()];
    const reviewed = nodes.length > 1 && nodes.slice(1).every(n => n.review) && nodes.every(n => n.eval);
    const summary = reviewed ? computeSummary(tree, nodes) : null;
    anState.value = {
      ...anState.value,
      tree, cur: meta.cur || tree.root.id,
      orientation: meta.orientation || (meta.userColor === 'black' ? 'black' : 'white'),
      threat: false,
      meta: {
        source: meta.source || 'new', libraryId: meta.libraryId || null, userColor: meta.userColor || null, title: meta.title || '',
        date: meta.date || null, elo: meta.elo === undefined ? null : meta.elo, stats: meta.stats || null,
      },
      review: reviewed ? { ...blankReview(), status: 'done', summary } : blankReview(),
      trainer: null, menu: null,
    };
    anLive.value = null;
    this.bump();
    if (this.active) this.analyze();
    if (meta.autoReview && !reviewed) this.startReview();
  }

  newBoard(fen = START_FEN) {
    const r = setupPosition(fen);
    if (r.error) { toast(t('ng.fenInvalid'), { type: 'error' }); return false; }
    this.load(new GameTree(r.fen), { source: 'new', orientation: r.pos.turn });
    return true;
  }

  // ---------------------------------------------------------------- navigation
  select(node, { sound = false } = {}) {
    if (!node) return;
    if (this.s.trainer) return;
    this.patch({ cur: node.id, menu: null });
    if (sound) sounds.forNode(node);
    this.scheduleAnalysis();
  }

  prev() { const n = this.curNode(); if (n.parent) this.select(n.parent); }
  next() { const n = this.curNode(); if (n.children[0]) this.select(n.children[0], { sound: true }); }
  first() { this.select(this.tree.root); }
  last() { this.select(this.tree.lineEnd(this.curNode())); }
  sibling(dir) {
    const n = this.curNode();
    if (!n.parent) return;
    const sibs = n.parent.children;
    const i = sibs.indexOf(n) + dir;
    if (i >= 0 && i < sibs.length) this.select(sibs[i]);
  }

  flip() { this.patch({ orientation: this.s.orientation === 'white' ? 'black' : 'white' }); }

  onBoardMove(uci) {
    if (this.s.trainer) { this.trainerMove(uci); return; }
    const node = this.curNode();
    const child = this.tree.addMove(node, uci);
    if (!child) return;
    sounds.forNode(child);
    this.bump();
    this.select(child);
  }

  /** Play a sequence of UCI moves from the current node (e.g. clicking a move inside an engine line). */
  playLine(fromNode, ucis) {
    let n = fromNode;
    for (const u of ucis) {
      const c = this.tree.addMove(n, u);
      if (!c) break;
      n = c;
    }
    this.bump();
    this.select(n, { sound: true });
  }

  deleteNode(node) {
    const cur = this.curNode();
    const parent = this.tree.deleteNode(node);
    if (this.tree.isAncestorOf(node, cur) || !this.tree.get(cur.id)) this.patch({ cur: parent.id });
    this.patch({ menu: null });
    this.bump();
    this.scheduleAnalysis();
  }

  promote(node) { this.tree.promoteVariation(node); this.patch({ menu: null }); this.bump(); }
  makeMainline(node) {
    this.tree.promoteToMainline(node);
    // Review data belongs to the old main line.
    if (this.s.review.status === 'done') this.patch({ review: blankReview() });
    this.patch({ menu: null });
    this.bump();
  }

  openMenu(node, e) { this.patch({ menu: { nodeId: node.id, x: e.clientX, y: e.clientY } }); }
  closeMenu() { if (this.s.menu) this.patch({ menu: null }); }

  // ---------------------------------------------------------------- live engine
  toggleEngine() {
    const on = !this.s.engineOn;
    this.patch({ engineOn: on });
    if (on) this.analyze(); else { this.stopLive(); anLive.value = null; }
  }

  toggleThreat() {
    this.patch({ threat: !this.s.threat, engineOn: true });
    this.analyze();
  }

  setMultiPv(n) {
    this.patch({ multiPv: n });
    this.analyze();
  }

  scheduleAnalysis() {
    clearTimeout(this.debounce);
    // Show a cached evaluation immediately, then (re)start the engine.
    const node = this.curNode();
    if (!this.s.threat && node.eval && node.eval.lines && node.eval.lines.length) {
      anLive.value = { nodeId: node.id, fen: node.fen, threat: false, lines: node.eval.lines, depth: node.eval.depth, nps: 0, cached: true };
    } else if (anLive.value && anLive.value.nodeId !== node.id) {
      anLive.value = null;
    }
    this.debounce = setTimeout(() => this.analyze(), 70);
  }

  stopLive() {
    clearTimeout(this.debounce);
    if (this.live) { this.live.cancel(); this.live = null; }
  }

  analyze() {
    this.stopLive();
    const s = this.s;
    if (!this.active || !s.engineOn || s.review.status === 'running' || s.trainer) return;
    const node = this.curNode();
    const pos = this.tree.pos(node);
    if (!pos.hasDests()) {
      anLive.value = { nodeId: node.id, fen: node.fen, threat: false, lines: [], depth: 0, gameOver: true };
      return;
    }
    let fen = this.tree.startFen, moves = this.tree.movesTo(node);
    if (s.threat) {
      const nf = nullMoveFen(pos);
      if (!nf) { anLive.value = { nodeId: node.id, fen: node.fen, threat: true, lines: [], depth: 0, inCheck: true }; return; }
      fen = nf; moves = [];
    }
    const token = ++this.token;
    const mt = engine.state.value.build && engine.state.value.build.mt;
    const threat = s.threat;
    const multiPv = s.multiPv;
    this.live = engine.search({
      fen, moves,
      limits: { depth: mt ? 40 : 32 },
      options: { MultiPV: multiPv },
      onUpdate: search => this.onUpdate(search, node, token, threat, false),
      onDone: res => { if (!res.cancelled && !res.error) this.push(res, node, token, threat, true); },
    });
  }

  onUpdate(search, node, token, threat) {
    if (token !== this.token) return;
    const now = performance.now();
    if (now - this.lastPush < 100) {
      clearTimeout(this.pushTimer);
      this.pushTimer = setTimeout(() => { if (token === this.token && !search.done) this.push(search.snapshot(), node, token, threat, false); }, 110);
      return;
    }
    this.push(search.snapshot(), node, token, threat, false);
  }

  push(snap, node, token, threat, final) {
    if (token !== this.token) return;
    this.lastPush = performance.now();
    const lines = (snap.lines || []).filter(Boolean);
    anLive.value = { nodeId: node.id, fen: snap.fen, threat, lines, depth: snap.depth, seldepth: snap.seldepth, nps: snap.nps, nodes: snap.nodes, final };
    if (!threat && lines.length && snap.depth >= 12) {
      const before = node.eval && node.eval.depth;
      storeEval(node, evalFromResult(snap));
      if (node.eval && node.eval.depth !== before && node.parent && node.parent.eval && !this.runner) {
        // keep the per-move judgement in sync with the deeper evaluation
        if (node.review) reviewMove(node, { openings });
      }
    }
  }

  // ---------------------------------------------------------------- review
  mainlineNodes() { return [this.tree.root, ...this.tree.mainline()]; }

  async startReview(preset = settings.value.reviewPreset) {
    if (this.runner) return;
    const nodes = this.mainlineNodes();
    if (nodes.length < 2) return;
    this.stopLive();
    const runner = new ReviewRunner({
      engine, tree: this.tree, nodes, preset, openings,
      onProgress: (i, n) => { this.patch({ review: { ...this.s.review, status: 'running', done: i, total: n } }); },
      onNode: () => this.bump(),
    });
    this.runner = runner;
    this.patch({ review: { ...blankReview(), status: 'running', done: 0, total: nodes.length } });
    try {
      const summary = await runner.run();
      if (this.runner !== runner) return;
      if (!summary) { this.patch({ review: blankReview() }); return; }
      this.patch({ review: { ...blankReview(), status: 'done', summary } });
      this.bump();
      sounds.good();
      this.persistToLibrary(summary);
    } catch (e) {
      console.error(e);
      if (this.runner === runner) this.patch({ review: { ...blankReview(), status: 'error', error: String(e.message || e) } });
    } finally {
      if (this.runner === runner) this.runner = null;
      if (this.active) this.analyze();
    }
  }

  cancelReview() {
    if (!this.runner) return;
    const r = this.runner;
    this.runner = null;
    r.cancel();
    this.patch({ review: blankReview() });
    this.bump();
  }

  async persistToLibrary(summary) {
    const s = this.s;
    const tree = this.tree;
    const meta = s.meta;
    if (meta.source === 'new' && !tree.headers.White && !tree.headers.Black) return;
    const end = tree.lineEnd(tree.root);
    try {
      const id = await saveGame({
        id: meta.libraryId || undefined,
        date: meta.date || new Date().toISOString(),
        source: meta.source === 'play' ? 'play' : 'import',
        white: tree.headers.White || '?', black: tree.headers.Black || '?',
        result: tree.headers.Result || '*',
        userColor: meta.userColor,
        elo: meta.elo === undefined ? null : meta.elo,
        tc: tree.headers.TimeControl || null,
        opening: openings.forNode(end),
        plies: tree.mainline().length,
        stats: meta.stats || null,
        summary: stripSummary(summary),
        tree: tree.toJSON(),
      });
      this.patch({ meta: { ...this.s.meta, libraryId: id } });
    } catch (e) {
      console.error(e);
      toast(t('lib.storageFull'), { type: 'error' });
    }
  }

  /** Mainline nodes with an error of `color` (or both). */
  mistakes(color) {
    return this.tree.mainline().filter(n => n.review && TRAIN_CLASSES.has(n.review.cls) && (!color || color === 'both' || moverOf(n) === color));
  }

  jumpMistake(dir, color) {
    const list = this.mistakes(color);
    if (!list.length) return;
    const cur = this.curNode();
    const main = this.tree.mainline();
    const idx = main.indexOf(cur);
    let target;
    if (dir > 0) target = list.find(n => main.indexOf(n) > idx) || list[0];
    else target = [...list].reverse().find(n => main.indexOf(n) < idx) || list[list.length - 1];
    this.select(target);
  }

  /** Jump to the next mainline move of `color` classified as `cls` (cycling). */
  jumpClass(color, cls) {
    const main = this.tree.mainline();
    const list = main.filter(n => n.review && n.review.cls === cls && moverOf(n) === color);
    if (!list.length) return;
    const idx = main.indexOf(this.curNode());
    this.select(list.find(n => main.indexOf(n) > idx) || list[0]);
  }

  // ---------------------------------------------------------------- trainer
  startTrainer(color) {
    const items = this.mistakes(color).map(n => n.id);
    if (!items.length) { toast(t('rv.noMistakes'), { type: 'success' }); return; }
    this.stopLive();
    const first = this.tree.get(items[0]);
    this.patch({
      trainer: { items, index: 0, color, state: 'solving', solved: 0, attempt: null, message: null, results: [] },
      orientation: moverOf(first), cur: first.parent.id, menu: null,
    });
  }

  trainerItem() {
    const tr = this.s.trainer;
    return tr ? this.tree.get(tr.items[tr.index]) : null;
  }

  async trainerMove(uci) {
    const tr = this.s.trainer;
    if (!tr || tr.state !== 'solving') return;
    const item = this.trainerItem();
    const parent = item.parent;
    const pos = posFromFen(parent.fen);
    const r = applyUci(pos, uci);
    if (!r) return;
    sounds.forNode(r);
    const mover = moverOf(item);
    const best = item.review.bestUci;
    this.patchTrainer({ attempt: { uci: r.uci, fen: r.fen, san: r.san, lastMove: [uci.slice(0, 2), uci.slice(2, 4)] }, state: 'checking', message: null });
    if (r.uci === best) { this.trainerSolved('correct'); return; }
    let score = null;
    const line = parent.eval && (parent.eval.lines || []).find(l => l.pv[0] === r.uci);
    if (line) score = line.score;
    else if (r.pos.hasDests()) {
      const token = ++this.token;
      this.trSearch = engine.search({ fen: this.tree.startFen, moves: [...this.tree.movesTo(parent), r.uci], limits: { depth: 16, movetime: 1500 }, options: { MultiPV: 1 } });
      const res = await this.trSearch.promise;
      this.trSearch = null;
      if (token !== this.token || !this.s.trainer) return;
      if (res.lines && res.lines[0]) score = res.lines[0].score;
      else if (res.terminal) score = res.terminal;
    } else {
      score = r.pos.isCheckmate() ? { mate: 0, mated: r.pos.turn } : { cp: 0 };
    }
    if (!score || !parent.eval) { this.patchTrainer({ state: 'solving', attempt: null }); return; }
    const loss = winPctFor(parent.eval.score, mover) - winPctFor(score, mover);
    if (loss <= 3.5) { this.trainerSolved('good'); return; }
    sounds.error();
    this.patchTrainer({ state: 'wrong', message: { key: 'tr.wrong', score } });
    clearTimeout(this.trTimer);
    this.trTimer = setTimeout(() => {
      const cur = this.s.trainer;
      if (cur && cur.state === 'wrong' && cur.index === tr.index) this.patchTrainer({ state: 'solving', attempt: null });
    }, 1600);
  }

  trainerSolved(kind) {
    const tr = this.s.trainer;
    sounds.good();
    const results = [...tr.results];
    results[tr.index] = 'solved';
    this.patchTrainer({ state: 'solved', message: { key: kind === 'correct' ? 'tr.correct' : 'tr.good' }, solved: tr.solved + 1, results });
  }

  trainerReveal() {
    const tr = this.s.trainer;
    if (!tr) return;
    const results = [...tr.results];
    if (!results[tr.index]) results[tr.index] = 'revealed';
    this.patchTrainer({ state: 'revealed', attempt: null, results });
  }

  trainerNext() {
    const tr = this.s.trainer;
    if (!tr) return;
    const results = [...tr.results];
    if (!results[tr.index]) results[tr.index] = 'skipped';
    const index = tr.index + 1;
    if (index >= tr.items.length) { this.patchTrainer({ state: 'finished', results, attempt: null }); return; }
    const item = this.tree.get(tr.items[index]);
    this.patch({ trainer: { ...tr, index, state: 'solving', attempt: null, message: null, results }, cur: item.parent.id, orientation: moverOf(item) });
  }

  trainerRestart() { const tr = this.s.trainer; if (tr) this.startTrainer(tr.color); }

  endTrainer() {
    if (this.trSearch) { this.trSearch.cancel(); this.trSearch = null; }
    clearTimeout(this.trTimer);
    const tr = this.s.trainer;
    const item = tr && this.tree.get(tr.items[Math.min(tr.index, tr.items.length - 1)]);
    this.patch({ trainer: null, cur: item ? item.id : this.s.cur });
    this.analyze();
  }

  patchTrainer(p) { if (this.s.trainer) this.patch({ trainer: { ...this.s.trainer, ...p } }); }
}

function stripSummary(summary) {
  if (!summary) return null;
  const side = s => ({ accuracy: s.accuracy, acpl: s.acpl, counts: s.counts });
  return { white: side(summary.white), black: side(summary.black) };
}

export const analysis = new AnalysisController();
