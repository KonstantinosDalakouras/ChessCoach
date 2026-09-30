// Play vs Stockfish 19 with a live coach.
import { signal } from '@preact/signals';
import { engineManager as engine } from '../engine/manager.js';
import { GameTree, moverOf } from '../game/tree.js';
import { openings } from '../game/openings.js';
import { pgnDate } from '../game/pgn.js';
import { START_FEN, setupPosition, opposite, nullMoveFen, pvToSan, parseMove, makeSan, posFromFen } from '../chess/util.js';
import { winPctFor, isMate } from '../chess/score.js';
import { evalFromResult, storeEval, reviewMove } from '../analysis/review.js';
import { explainMove } from '../analysis/explain.js';
import { ERROR_CLASSES } from '../analysis/classify.js';
import { settings, safeStorage } from '../store.js';
import { sounds } from '../sound.js';
import { t } from '../i18n.js';
import { toast } from '../ui/common.jsx';
import { saveGame } from '../library.js';

const AUTOSAVE = 'sf19c.play.v1';

export const COACH_PRECISION = {
  fast: { depth: 14, movetime: 900, minDepth: 12 },
  normal: { depth: 16, movetime: 1600, minDepth: 14 },
  deep: { depth: 20, movetime: 4000, minDepth: 17 },
};

const idle = () => ({
  status: 'idle', tree: null, cur: null, config: null, phase: null, result: null,
  feedback: null, hint: null, threat: null, alert: null, stats: { hints: 0, takebacks: 0 }, savedId: null,
});

export const playState = signal(idle());
export const playLive = signal(null); // live analysis during the user's turn
export const playVersion = signal(0);
export const playClock = signal({ white: null, black: null, running: null, since: 0 });

const sleep = ms => new Promise(r => setTimeout(r, ms));

function resultString(res) {
  if (!res) return '*';
  if (!res.winner) return '1/2-1/2';
  return res.winner === 'white' ? '1-0' : '0-1';
}

export function engineDisplayName() {
  return 'Stockfish 19';
}

class PlayController {
  constructor() {
    this.token = 0;
    this.live = null;
    this.liveNodeId = null;
    this.engineSearch = null;
    this.clockTimer = null;
    this.suspended = false;
    this.pendingHint = false;
    this.lastLivePush = 0;
    engine.onReady(() => this.onEngineReady());
  }

  get s() { return playState.value; }
  patch(p) { playState.value = { ...playState.value, ...p }; }
  bump() { playVersion.value++; }
  get tree() { return this.s.tree; }

  liveNode() { return this.tree ? this.tree.lineEnd(this.tree.root) : null; }
  get userColor() { return this.s.config ? this.s.config.userColor : 'white'; }
  get engineColor() { return opposite(this.userColor); }

  // ---------------------------------------------------------------- lifecycle
  start(ng) {
    const s = settings.value;
    const userColor = ng.color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : ng.color;
    let startFen = START_FEN;
    if (ng.startFen) {
      const r = setupPosition(ng.startFen);
      if (!r.error) startFen = r.fen;
    }
    const training = ng.mode === 'training';
    const config = {
      userColor,
      elo: ng.max ? null : Math.max(1320, Math.min(3190, Math.round(ng.elo))),
      clock: ng.clock ? { base: Math.round(ng.base * 60000), inc: Math.round(ng.inc * 1000) } : null,
      movetime: ng.movetime || 1000,
      mode: ng.mode,
      coach: training ? !!ng.coach : false,
      pause: training ? !!ng.pause : false,
      evalbar: training ? !!ng.evalbar : false,
      hints: training ? !!ng.hints : false,
      takebacks: training ? !!ng.takebacks : false,
      alertOpp: training ? !!ng.alertOpp : false,
    };
    const tree = new GameTree(startFen);
    const me = s.playerName || t('side.you');
    const sf = engineDisplayName(config);
    tree.headers = {
      Event: config.mode === 'training' ? 'SF19 Coach training game' : 'SF19 Coach game',
      Site: typeof location !== 'undefined' ? location.origin : '?',
      Date: pgnDate(),
      White: userColor === 'white' ? me : sf,
      Black: userColor === 'black' ? me : sf,
      Result: '*',
    };
    tree.headers[userColor === 'white' ? 'BlackElo' : 'WhiteElo'] = config.elo ? String(config.elo) : '3190+';
    if (config.clock) tree.headers.TimeControl = `${config.clock.base / 1000}+${config.clock.inc / 1000}`;
    this.token++;
    this.stopLive();
    engine.stopAll();
    engine.newGame();
    this.stopClockTimer();
    playClock.value = config.clock
      ? { white: config.clock.base, black: config.clock.base, running: null, since: 0 }
      : { white: null, black: null, running: null, since: 0 };
    playLive.value = null;
    playState.value = { ...idle(), status: 'playing', tree, cur: tree.root.id, config, phase: null };
    this.bump();
    this.persist();
    this.nextTurn();
  }

  rematch() {
    const c = this.s.config;
    const tree = this.tree;
    if (!c) return;
    this.start({
      color: opposite(c.userColor), elo: c.elo || 2000, max: !c.elo,
      clock: !!c.clock, base: c.clock ? c.clock.base / 60000 : 10, inc: c.clock ? c.clock.inc / 1000 : 0,
      movetime: c.movetime, mode: c.mode, coach: c.coach, pause: c.pause, evalbar: c.evalbar,
      hints: c.hints, takebacks: c.takebacks, alertOpp: c.alertOpp,
      startFen: tree && !tree.isStandardStart ? tree.startFen : undefined,
    });
  }

  /** Called when switching away from the Play tab. */
  suspend() {
    if (this.suspended) return;
    this.suspended = true;
    this.token++;
    this.stopLive();
    if (this.engineSearch) { this.engineSearch.cancel(); this.engineSearch = null; }
    this.pauseClock();
  }

  resume() {
    if (!this.suspended) return;
    this.suspended = false;
    const s = this.s;
    if (s.status !== 'playing') return;
    if (s.phase === 'paused') return;
    if (s.phase === 'coaching') {
      // Coaching was interrupted: redo it for the last user move.
      const node = this.liveNode();
      if (node && node.parent && moverOf(node) === this.userColor && !node.coach) { this.runCoach(node.parent, node, null); return; }
    }
    this.nextTurn();
  }

  onEngineReady() {
    // Engine restarted (settings change / recovery): re-issue whatever the game needs.
    if (this.suspended) return;
    const s = this.s;
    if (s.status === 'playing' && (s.phase === 'engine' || s.phase === 'user')) { this.token++; this.nextTurn(); }
  }

  nextTurn() {
    const s = this.s;
    if (s.status !== 'playing' || this.suspended) return;
    const node = this.liveNode();
    const over = this.checkGameOver(node);
    if (over) { this.finish(over); return; }
    const turn = this.tree.turnOf(node);
    if (turn === this.userColor) {
      this.patch({ phase: 'user' });
      this.startClock(turn);
      if (this.needsLive()) this.startLive(node);
      if (this.pendingHint) this.hint();
    } else {
      this.patch({ phase: 'engine', hint: null, threat: null });
      this.startClock(turn);
      this.engineMove(node);
    }
  }

  needsLive() {
    const c = this.s.config;
    return !!(c && (c.coach || c.evalbar || c.hints || c.alertOpp));
  }

  checkGameOver(node) {
    const pos = this.tree.pos(node);
    if (pos.isCheckmate()) return { winner: opposite(pos.turn), reason: 'checkmate' };
    if (pos.isStalemate()) return { winner: null, reason: 'stalemate' };
    if (pos.isInsufficientMaterial()) return { winner: null, reason: 'material' };
    if (this.tree.repetitionCount(node) >= 3) return { winner: null, reason: 'repetition' };
    if (pos.halfmoves >= 100) return { winner: null, reason: 'fifty' };
    return null;
  }

  finish(result) {
    this.token++;
    this.stopLive();
    if (this.engineSearch) { this.engineSearch.cancel(); this.engineSearch = null; }
    this.pauseClock();
    const tree = this.tree;
    tree.headers.Result = resultString(result);
    const termination = { resign: 'Resignation', timeout: 'Time forfeit', timeoutMaterial: 'Time forfeit', checkmate: 'Normal', agreement: 'Normal' }[result.reason] || 'Normal';
    tree.headers.Termination = termination;
    const end = this.liveNode();
    const op = openings.forNode(end);
    if (op) { tree.headers.ECO = op.eco; tree.headers.Opening = op.name; }
    this.patch({ status: 'over', result, phase: null, hint: null, threat: null });
    this.bump();
    sounds.end();
    this.persist();
    this.savePromise = this.saveToLibrary();
  }

  async saveToLibrary() {
    const s = this.s;
    const tree = s.tree;
    if (!tree || !tree.mainline().length) return;
    const end = this.liveNode();
    const op = openings.forNode(end);
    try {
      const id = await saveGame({
        id: s.savedId || undefined,
        date: new Date().toISOString(),
        source: 'play',
        white: tree.headers.White,
        black: tree.headers.Black,
        result: tree.headers.Result,
        reason: s.result ? s.result.reason : null,
        userColor: s.config.userColor,
        elo: s.config.elo,
        tc: s.config.clock ? tree.headers.TimeControl : null,
        mode: s.config.mode,
        opening: op,
        plies: tree.mainline().length,
        stats: s.stats,
        summary: null,
        tree: tree.toJSON(),
      });
      this.patch({ savedId: id });
      this.persist();
    } catch (e) {
      console.error(e);
      toast(t('lib.storageFull'), { type: 'error' });
    }
  }

  // ---------------------------------------------------------------- moves
  select(node) {
    if (!node || !this.tree) return;
    this.patch({ cur: node.id });
  }

  isAtLive() {
    const n = this.liveNode();
    return !!n && this.s.cur === n.id;
  }

  /** User move from the board. Returns true if accepted. */
  onUserMove(uci) {
    const s = this.s;
    if (s.status !== 'playing' || s.phase !== 'user' || this.suspended) return false;
    const parent = this.liveNode();
    if (s.cur !== parent.id) return false;
    const node = this.tree.addMove(parent, uci);
    if (!node) return false;
    const token = ++this.token;
    // Keep the analysis that was running on the parent position.
    const liveSearch = this.live && this.liveNodeId === parent.id ? this.live : null;
    this.live = null;
    this.liveNodeId = null;
    this.stopClock(this.userColor);
    node.clock = this.clockOf(this.userColor);
    sounds.forNode(node);
    this.pendingHint = false;
    this.patch({ cur: node.id, hint: null, threat: null, alert: null });
    this.bump();
    this.persist();
    const over = this.checkGameOver(node);
    if (s.config.coach) {
      this.runCoach(parent, node, liveSearch, token, over);
    } else {
      if (liveSearch) liveSearch.cancel();
      if (over) this.finish(over); else this.nextTurn();
    }
    return true;
  }

  async runCoach(parent, node, liveSearch, token = this.token, over = null) {
    this.patch({ phase: 'coaching', feedback: { nodeId: node.id, pending: true } });
    let review = null;
    try {
      review = await this.coachEvaluate(parent, node, liveSearch, token);
    } catch (e) {
      console.error('coach failed', e);
    }
    if (token !== this.token || this.s.status !== 'playing') return;
    if (!review) {
      this.patch({ feedback: null });
    } else {
      this.patch({ feedback: this.buildFeedback(node) });
      if (review.cls === 'blunder' || review.cls === 'mistake' || review.cls === 'miss') sounds.error();
      else if (review.cls === 'brilliant' || review.cls === 'great') sounds.good();
    }
    this.bump();
    this.persist();
    if (over) { this.finish(over); return; }
    if (review && this.s.config.pause && (review.cls === 'mistake' || review.cls === 'blunder' || review.cls === 'miss')) {
      this.patch({ phase: 'paused' });
      return;
    }
    this.nextTurn();
  }

  async coachEvaluate(parent, node, liveSearch, token) {
    const lim = COACH_PRECISION[settings.value.coachPrecision] || COACH_PRECISION.normal;
    const tree = this.tree;
    // 1) analysis of the position before the move
    let before = null;
    if (liveSearch) {
      const res = await liveSearch.stop();
      if (token !== this.token) return null;
      if (!res.error && res.lines && res.lines.length && res.depth >= lim.minDepth) before = evalFromResult(res);
    }
    if (!before && parent.eval && !parent.eval.terminal && (parent.eval.depth || 0) >= lim.minDepth && (parent.eval.lines || []).length) before = parent.eval;
    if (!before) {
      const res = await engine.search({ fen: tree.startFen, moves: tree.movesTo(parent), limits: { depth: lim.depth, movetime: lim.movetime }, options: { MultiPV: 2 } }).promise;
      if (token !== this.token) return null;
      if (res.error || !res.lines || !res.lines.length) return null;
      before = evalFromResult(res);
    }
    storeEval(parent, before);
    // 2) analysis of the position after the move
    const pos = tree.pos(node);
    let after = null;
    if (!pos.hasDests()) {
      after = { score: pos.isCheckmate() ? { mate: 0, mated: pos.turn } : { cp: 0 }, depth: 99, lines: [], terminal: true };
    } else {
      const line = (before.lines || []).find(l => l.pv[0] === node.uci);
      if (line && (line.depth || 0) >= lim.minDepth && line.pv.length > 1) {
        after = { score: line.score, depth: line.depth - 1, best: line.pv[1], pv: line.pv.slice(1), lines: [{ score: line.score, pv: line.pv.slice(1), depth: line.depth - 1 }] };
      } else {
        const res = await engine.search({ fen: tree.startFen, moves: tree.movesTo(node), limits: { depth: lim.depth, movetime: lim.movetime }, options: { MultiPV: 1 } }).promise;
        if (token !== this.token) return null;
        if (res.error || !res.lines || !res.lines.length) return null;
        after = evalFromResult(res);
      }
    }
    storeEval(node, after);
    return reviewMove(node, { openings, key: 'coach' });
  }

  buildFeedback(node) {
    const review = node.coach;
    if (!review) return null;
    const parent = node.parent;
    const posBefore = posFromFen(parent.fen);
    const posAfter = posFromFen(node.fen);
    const bestPv = parent.eval && parent.eval.pv ? parent.eval.pv : [];
    const afterPv = node.eval && node.eval.pv ? node.eval.pv : [];
    const op = openings.forNode(node);
    const { items } = explainMove({
      review, mover: moverOf(node), posBefore, posAfter, bestPv, afterPv,
      bestSan: review.bestSan, opening: op ? `: ${op.name}` : '',
    });
    return {
      nodeId: node.id, pending: false, review, items,
      bestLine: pvToSan(parent.fen, bestPv, 10),
      refLine: pvToSan(node.fen, afterPv, 10),
    };
  }

  /** Feedback object for any user move in the game (for browsing history). */
  feedbackFor(node) {
    if (!node || !node.coach) return null;
    const f = this.s.feedback;
    if (f && f.nodeId === node.id && !f.pending) return f;
    return this.buildFeedback(node);
  }

  async engineMove(node) {
    const token = this.token;
    const s = this.s;
    const cfg = s.config;
    const tree = this.tree;
    const clock = playClock.value;
    let limits;
    if (!cfg.clock) limits = { movetime: cfg.movetime };
    else {
      const mine = Math.max(50, this.clockOf(this.engineColor));
      if (cfg.elo) {
        // A strength-limited engine picks its move at a fixed depth, so long thinks are wasted: move at a human-like pace.
        const t = Math.max(250, Math.min(3000, mine / 80 + cfg.clock.inc / 2)) * (0.75 + Math.random() * 0.5);
        limits = { movetime: Math.min(t, mine / 4) };
      } else {
        limits = {
          wtime: Math.max(50, this.clockOf('white')), btime: Math.max(50, this.clockOf('black')), winc: cfg.clock.inc, binc: cfg.clock.inc,
          movetime: Math.max(500, Math.min(10000, mine / 15)),
        };
      }
    }
    const options = cfg.elo ? { UCI_LimitStrength: true, UCI_Elo: cfg.elo, MultiPV: 1 } : { MultiPV: 1 };
    const t0 = performance.now();
    const search = engine.search({ fen: tree.startFen, moves: tree.movesTo(node), limits, options });
    this.engineSearch = search;
    const res = await search.promise;
    if (this.engineSearch === search) this.engineSearch = null;
    if (token !== this.token || this.s.status !== 'playing' || this.suspended) return;
    if (res.cancelled) return;
    if (res.error || !res.bestmove) {
      if (res.error === 'engine-unavailable' || engine.state.value.status !== 'ready') return; // onEngineReady will resume
      console.warn('engine move failed', res.error);
      this.engineFailures = (this.engineFailures || 0) + 1;
      if (this.engineFailures <= 3) {
        toast(t('play.engineError'), { type: 'warn' });
        await sleep(600);
        if (token === this.token) this.engineMove(node);
      }
      return;
    }
    this.engineFailures = 0;
    const elapsed = performance.now() - t0;
    if (!cfg.clock && elapsed < 450) {
      await sleep(450 - elapsed);
      if (token !== this.token || this.suspended) return;
    }
    this.stopClock(this.engineColor);
    const child = tree.addMove(node, res.bestmove);
    if (!child) { console.error('engine played illegal move?', res.bestmove); return; }
    child.clock = this.clockOf(this.engineColor);
    if (!cfg.elo && res.lines && res.lines.length) storeEval(node, evalFromResult(res));
    sounds.forNode(child);
    this.patch({ cur: child.id });
    this.bump();
    this.persist();
    void clock;
    this.nextTurn();
  }

  // ---------------------------------------------------------------- live analysis
  startLive(node) {
    const token = this.token;
    if (this.live && this.liveNodeId === node.id && !this.live.done) return;
    const mt = engine.state.value.build && engine.state.value.build.mt;
    const tree = this.tree;
    this.liveNodeId = node.id;
    this.live = engine.search({
      fen: tree.startFen,
      moves: tree.movesTo(node),
      limits: { depth: mt ? 30 : 26 },
      options: { MultiPV: 3 },
      onUpdate: search => this.onLiveUpdate(search, node, token),
      onDone: res => { if (token === this.token && !res.cancelled && !res.error) this.pushLive(res, node, true); },
    });
  }

  stopLive() {
    if (this.live) { this.live.cancel(); this.live = null; }
    this.liveNodeId = null;
  }

  onLiveUpdate(search, node, token) {
    if (token !== this.token) return;
    const now = performance.now();
    if (now - this.lastLivePush < 120 && search.depth < 8) return;
    if (now - this.lastLivePush < 120) {
      clearTimeout(this.liveTimer);
      this.liveTimer = setTimeout(() => { if (token === this.token && !search.done) this.pushLive(search.snapshot(), node, false); }, 130);
      return;
    }
    this.pushLive(search.snapshot(), node, false);
  }

  pushLive(snap, node, final) {
    this.lastLivePush = performance.now();
    const lines = (snap.lines || []).filter(Boolean);
    if (!lines.length) return;
    playLive.value = { nodeId: node.id, fen: node.fen, lines, depth: snap.depth, nps: snap.nps, final };
    if (snap.depth >= 10) storeEval(node, evalFromResult(snap));
    this.checkOpponentError(node, snap);
    if (this.pendingHint && snap.depth >= 10) { this.pendingHint = false; this.hint(); }
  }

  checkOpponentError(node, snap) {
    const s = this.s;
    if (!s.config.alertOpp || !node.parent || moverOf(node) !== this.engineColor) return;
    if (node.oppChecked || snap.depth < 12) return;
    const parent = node.parent;
    if (!parent.eval || parent.eval.terminal) return;
    node.oppChecked = true;
    const eng = this.engineColor;
    const before = winPctFor(parent.eval.score, eng);
    const after = winPctFor(snap.lines[0].score, eng);
    const loss = Math.max(0, before - after);
    node.oppLoss = loss;
    if (loss >= 10 && s.phase === 'user' && this.liveNode() === node) {
      this.patch({ alert: { nodeId: node.id, level: loss >= 15 ? 'blunder' : 'mistake' } });
      sounds.alert();
    }
  }

  // ---------------------------------------------------------------- helpers during the game
  hint() {
    const s = this.s;
    if (s.status !== 'playing' || !s.config.hints || s.phase !== 'user') return;
    const node = this.liveNode();
    const live = playLive.value;
    if (!live || live.nodeId !== node.id || !live.lines.length || live.depth < 10) {
      this.pendingHint = true;
      if (!this.live || this.liveNodeId !== node.id) this.startLive(node);
      toast(t('play.hintNeedsEngine'), { timeout: 1500 });
      return;
    }
    const best = live.lines[0];
    const prev = s.hint && s.hint.nodeId === node.id ? s.hint.level : 0;
    const level = Math.min(3, prev + 1);
    const line = pvToSan(node.fen, best.pv, 8);
    const stats = prev === 0 ? { ...s.stats, hints: s.stats.hints + 1 } : s.stats;
    this.patch({ hint: { nodeId: node.id, level, uci: best.pv[0], san: line[0] && line[0].san, line, score: best.score }, stats });
    this.persist();
  }

  async threat() {
    const s = this.s;
    if (s.status !== 'playing' || s.phase !== 'user' || !s.config.hints) return;
    const node = this.liveNode();
    const pos = this.tree.pos(node);
    if (pos.isCheck()) { this.patch({ threat: { nodeId: node.id, inCheck: true } }); return; }
    const fen = nullMoveFen(pos);
    if (!fen) { this.patch({ threat: { nodeId: node.id, none: true } }); return; }
    const token = this.token;
    this.stopLive();
    this.patch({ threat: { nodeId: node.id, pending: true } });
    const res = await engine.search({ fen, limits: { depth: 14, movetime: 1500 }, options: { MultiPV: 1 } }).promise;
    if (token !== this.token) return;
    if (res.error || !res.lines || !res.lines.length) { this.patch({ threat: { nodeId: node.id, none: true } }); }
    else {
      const l = res.lines[0];
      const mover = opposite(this.userColor);
      // Is it really a threat? Compare with the current evaluation.
      const current = node.eval ? winPctFor(node.eval.score, mover) : 50;
      const threatW = winPctFor(l.score, mover);
      const san = pvToSan(fen, l.pv, 1)[0];
      if (threatW - current < 8 && !(isMate(l.score) && winPctFor(l.score, mover) > 90)) this.patch({ threat: { nodeId: node.id, none: true, uci: l.pv[0], san: san && san.san } });
      else this.patch({ threat: { nodeId: node.id, uci: l.pv[0], san: san && san.san, score: l.score } });
    }
    if (this.s.phase === 'user' && this.needsLive()) this.startLive(node);
  }

  takeback() {
    const s = this.s;
    if (s.status !== 'playing' || !s.config.takebacks) return false;
    const tree = this.tree;
    let node = this.liveNode();
    if (!node.parent) return false;
    // Nothing to take back if only engine moves were played.
    if (!tree.path(node).some(n => moverOf(n) === this.userColor)) return false;
    this.token++;
    this.stopLive();
    if (this.engineSearch) { this.engineSearch.cancel(); this.engineSearch = null; }
    this.pauseClock();
    while (node.parent) {
      const mover = moverOf(node);
      const parent = tree.deleteNode(node);
      node = parent;
      if (mover === this.userColor) break;
    }
    this.pendingHint = false;
    playLive.value = null;
    this.patch({ cur: node.id, feedback: null, hint: null, threat: null, alert: null, phase: 'user', stats: { ...s.stats, takebacks: s.stats.takebacks + 1 } });
    this.bump();
    this.persist();
    this.nextTurn();
    return true;
  }

  retry() { return this.takeback(); }

  continueGame() {
    if (this.s.status === 'playing' && this.s.phase === 'paused') { this.token++; this.nextTurn(); }
  }

  async offerDraw() {
    const s = this.s;
    if (s.status !== 'playing') return;
    const node = this.liveNode();
    const eng = this.engineColor;
    let score = node.eval && node.eval.score;
    if (!score || (node.eval.depth || 0) < 12) {
      const res = await engine.search({ fen: this.tree.startFen, moves: this.tree.movesTo(node), limits: { depth: 14, movetime: 1500 }, options: { MultiPV: 1 } }).promise;
      if (res.lines && res.lines[0]) score = res.lines[0].score;
      if (this.s.phase === 'user' && this.needsLive()) this.startLive(node);
    }
    const w = score ? winPctFor(score, eng) : 50;
    const plies = node.ply - this.tree.root.ply;
    const accept = plies >= 20 && w <= 53;
    if (accept) { toast(t('play.drawAccepted')); this.finish({ winner: null, reason: 'agreement' }); }
    else toast(t('play.drawDeclined'), { type: 'warn' });
  }

  resign() {
    if (this.s.status !== 'playing') return;
    this.finish({ winner: this.engineColor, reason: 'resign' });
  }

  abandon() {
    this.token++;
    this.stopLive();
    engine.stopAll();
    this.stopClockTimer();
    playState.value = idle();
    playLive.value = null;
    safeStorage.remove(AUTOSAVE);
    this.bump();
  }

  // ---------------------------------------------------------------- clocks
  clockOf(color) {
    const c = playClock.value;
    if (c[color] === null) return undefined;
    if (c.running === color) return c[color] - (performance.now() - c.since);
    return c[color];
  }

  movesMadeBy(color) {
    return this.tree.mainline().filter(n => moverOf(n) === color).length;
  }

  startClock(color) {
    const cfg = this.s.config;
    if (!cfg || !cfg.clock) return;
    // Each side's first move is free (like lichess).
    if (this.movesMadeBy(color) === 0) { playClock.value = { ...playClock.value, running: null }; return; }
    playClock.value = { ...playClock.value, running: color, since: performance.now() };
    this.startClockTimer();
  }

  stopClock(color) {
    const cfg = this.s.config;
    if (!cfg || !cfg.clock) return;
    const c = playClock.value;
    const next = { ...c };
    // Increment is only added for moves made on a running clock (each side's first move is free).
    if (c.running === color) next[color] = c[color] - (performance.now() - c.since) + cfg.clock.inc;
    next.running = null;
    playClock.value = next;
  }

  pauseClock() {
    const c = playClock.value;
    if (!c.running) return;
    playClock.value = { ...c, [c.running]: c[c.running] - (performance.now() - c.since), running: null };
  }

  startClockTimer() {
    if (this.clockTimer) return;
    let lastTickSec = null;
    this.clockTimer = setInterval(() => {
      const c = playClock.value;
      if (!c.running) return;
      const remaining = c[c.running] - (performance.now() - c.since);
      playClock.value = { ...c }; // re-render
      if (c.running === this.userColor && remaining < 10000 && remaining > 0) {
        const sec = Math.ceil(remaining / 1000);
        if (sec !== lastTickSec) { lastTickSec = sec; sounds.tick(); }
      }
      if (remaining <= 0) this.flag(c.running);
    }, 100);
  }

  stopClockTimer() {
    if (this.clockTimer) { clearInterval(this.clockTimer); this.clockTimer = null; }
  }

  flag(color) {
    if (this.s.status !== 'playing') return;
    this.pauseClock();
    const c = playClock.value;
    playClock.value = { ...c, [color]: 0 };
    const pos = this.tree.pos(this.liveNode());
    const winner = opposite(color);
    if (pos.hasInsufficientMaterial(winner)) this.finish({ winner: null, reason: 'timeoutMaterial' });
    else this.finish({ winner, reason: 'timeout' });
  }

  // ---------------------------------------------------------------- persistence
  persist() {
    const s = this.s;
    if (!s.tree) return;
    const data = {
      v: 1, status: s.status, phase: s.phase === 'paused' ? 'paused' : null, config: s.config, result: s.result, stats: s.stats, savedId: s.savedId,
      tree: s.tree.toJSON(), clock: { white: this.clockOf('white') ?? null, black: this.clockOf('black') ?? null },
    };
    safeStorage.set(AUTOSAVE, JSON.stringify(data));
  }

  restore() {
    let data;
    try { data = JSON.parse(safeStorage.get(AUTOSAVE) || 'null'); } catch { data = null; }
    if (!data || !data.tree || !data.config) return false;
    try {
      const tree = GameTree.fromJSON(data.tree);
      const end = tree.lineEnd(tree.root);
      playClock.value = { white: data.clock ? data.clock.white : null, black: data.clock ? data.clock.black : null, running: null, since: 0 };
      playState.value = { ...idle(), status: data.status === 'over' ? 'over' : 'playing', tree, cur: end.id, config: data.config, result: data.result, stats: data.stats || { hints: 0, takebacks: 0 }, savedId: data.savedId || null, phase: data.phase || null };
      const f = this.buildFeedback(end.coach ? end : end.parent && end.parent.coach ? end.parent : end);
      if (f) this.patch({ feedback: f });
      this.bump();
      if (data.status !== 'over') {
        this.suspended = true; // resumed when the Play tab becomes active
      }
      return true;
    } catch (e) {
      console.warn('could not restore game', e);
      return false;
    }
  }
}

export const play = new PlayController();

/** Utility for views: SAN of a UCI move in a position. */
export function sanOf(fen, uci) {
  try {
    const pos = posFromFen(fen);
    const mv = parseMove(pos, uci);
    return mv ? makeSan(pos, mv) : uci;
  } catch { return uci; }
}

export { ERROR_CLASSES };
