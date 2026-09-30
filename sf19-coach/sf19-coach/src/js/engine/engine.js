// UCI engine wrapper with a small state machine so that searches never get mixed up:
// at most one search runs inside the engine; a new request preempts the running one
// (we send `stop`, wait for its `bestmove`, then start the next).
import { parseInfo, parseBestmove, parseOption, goCommand } from './uci.js';
import { setupPosition, applyUci, fenOf } from '../chess/util.js';
import { toWhitePov, wdlToWhite, terminalScore } from '../chess/score.js';

let searchSeq = 0;

export class Search {
  constructor(engine, req, root) {
    this.engine = engine;
    this.req = req;
    this.id = ++searchSeq;
    this.root = root; // { startFen, moves, fen, turn, pos }
    this.fen = root && root.fen;
    this.turn = root && root.turn;
    this.lines = [];
    this.depth = 0;
    this.seldepth = 0;
    this.nodes = 0;
    this.nps = 0;
    this.time = 0;
    this.hashfull = 0;
    this.done = false;
    this.cancelled = false;
    this.stopping = false;
    this.started = false;
    this.startedAt = 0;
    this.result = null;
    this.promise = new Promise(res => { this._resolve = res; });
  }

  /** Stop the search early but keep (and deliver) its result. */
  stop() { this.engine._stopSearch(this, false); return this.promise; }
  /** Stop and mark the result as cancelled. */
  cancel() { this.engine._stopSearch(this, true); return this.promise; }

  get best() { return this.lines[0]; }

  snapshot() {
    return {
      fen: this.fen, turn: this.turn, depth: this.depth, seldepth: this.seldepth, nodes: this.nodes,
      nps: this.nps, time: this.time, hashfull: this.hashfull,
      lines: this.lines.filter(Boolean).map(l => ({ ...l, pv: l.pv.slice() })),
    };
  }

  _onInfo(info) {
    if (info.nodes !== undefined) this.nodes = info.nodes;
    if (info.nps !== undefined) this.nps = info.nps;
    if (info.time !== undefined) this.time = info.time;
    if (info.hashfull !== undefined) this.hashfull = info.hashfull;
    if (!info.score) return;
    if (!info.pv || !info.pv.length) {
      // "info depth 0 score mate 0" (checkmated) / "score cp 0" (stalemate)
      if (info.depth === 0) this.terminal = toWhitePov(info.score, this.turn);
      return;
    }
    if (info.bound) return; // aspiration-window fail lines: noisy, skip
    const k = (info.multipv || 1) - 1;
    const line = {
      multipv: k + 1,
      depth: info.depth || 0,
      seldepth: info.seldepth || 0,
      score: toWhitePov(info.score, this.turn),
      wdl: wdlToWhite(info.wdl, this.turn),
      pv: info.pv,
      nodes: info.nodes,
    };
    this.lines[k] = line;
    if (k === 0) {
      this.depth = line.depth;
      this.seldepth = line.seldepth;
    }
    if (this.req.onUpdate && !this.cancelled) {
      try { this.req.onUpdate(this); } catch (e) { console.error(e); }
    }
  }

  _finish({ bestmove = null, ponder = null, error = null } = {}) {
    if (this.done) return;
    this.done = true;
    const snap = this.snapshot();
    this.result = {
      ...snap,
      id: this.id,
      bestmove: bestmove || (snap.lines[0] && snap.lines[0].pv[0]) || null,
      ponder,
      cancelled: this.cancelled,
      error,
      terminal: this.terminal,
      elapsed: this.startedAt ? performance.now() - this.startedAt : 0,
    };
    this._resolve(this.result);
    if (this.req.onDone) {
      try { this.req.onDone(this.result); } catch (e) { console.error(e); }
    }
  }
}

/** Resolve the root of a search request: validate FEN + moves so the engine never sees an invalid position. */
export function resolveRoot(req) {
  const setup = setupPosition(req.fen);
  if (setup.error) return { error: `fen:${setup.error}` };
  let pos = setup.pos;
  const moves = [];
  for (const uci of req.moves || []) {
    const r = applyUci(pos, uci);
    if (!r) return { error: `move:${uci}` };
    moves.push(r.uci);
    pos = r.pos;
  }
  const fen = moves.length ? fenOf(pos) : setup.fen;
  return { startFen: setup.fen, moves, fen, turn: pos.turn, pos };
}

export const BASE_SEARCH_OPTIONS = {
  MultiPV: 1,
  UCI_LimitStrength: false,
  'Skill Level': 20,
  UCI_ShowWDL: true,
};

export class Engine {
  /**
   * @param {object} o
   * @param {(handlers) => {send(cmd:string):void, terminate():void}} o.createTransport
   */
  constructor({ createTransport, onStatus, onProgress, log } = {}) {
    this.createTransport = createTransport;
    this.onStatus = onStatus;
    this.onProgress = onProgress;
    this.log = log;
    this.status = 'idle';
    this.name = '';
    this.optionDefs = {};
    this.current = {}; // option values the engine currently has
    this.baseOptions = { ...BASE_SEARCH_OPTIONS };
    this.active = null;
    this.queued = null;
    this._waiters = [];
    this.error = null;
  }

  _setStatus(status, extra) {
    this.status = status;
    if (this.onStatus) this.onStatus(status, extra);
  }

  async init(options = {}, { timeoutMs = 300000 } = {}) {
    this._setStatus('loading');
    this.transport = this.createTransport({
      onLine: line => this._onLine(line),
      onError: err => this._onFatal(err),
      onProgress: p => this.onProgress && this.onProgress(p),
    });
    this._send('uci');
    await this._waitFor(line => line === 'uciok', timeoutMs, 'uciok');
    Object.assign(this.baseOptions, options);
    for (const [k, v] of Object.entries(this.baseOptions)) this._setOption(k, v);
    await this.isReady(60000);
    this._setStatus('ready');
    this._startQueued();
    return this;
  }

  /** Change persistent options (Threads, Hash, …). Applied immediately if idle, else before the next search. */
  configure(options) {
    Object.assign(this.baseOptions, options);
    if (!this.active && this.status === 'ready') for (const [k, v] of Object.entries(options)) this._setOption(k, v);
  }

  isReady(timeoutMs = 30000) {
    const p = this._waitFor(line => line === 'readyok', timeoutMs, 'readyok');
    this._send('isready');
    return p;
  }

  newGame() {
    if (this.status !== 'ready') return;
    if (this.active) this._stopSearch(this.active, true);
    if (this.queued) { const q = this.queued; this.queued = null; q.cancelled = true; q._finish(); }
    this._pendingNewGame = true;
    if (!this.active) this._flushNewGame();
  }

  _flushNewGame() {
    if (!this._pendingNewGame) return;
    this._pendingNewGame = false;
    this._send('ucinewgame');
  }

  /**
   * Start a search (preempting any running one).
   * req: { fen, moves?, limits: {depth, movetime, nodes, infinite, wtime, btime, winc, binc, searchmoves},
   *        options?: {MultiPV, UCI_LimitStrength, UCI_Elo, …}, onUpdate?(search), onDone?(result) }
   */
  search(req) {
    const root = resolveRoot(req);
    const s = new Search(this, req, root.error ? null : root);
    if (root.error) { s._finish({ error: root.error }); return s; }
    if (!root.pos.hasDests()) {
      // Game over in the root position: nothing to search.
      s.terminal = terminalScore(root.pos);
      s._finish({ bestmove: null });
      return s;
    }
    if (this.status === 'error' || this.status === 'dead') { s._finish({ error: 'engine-unavailable' }); return s; }
    if (this.queued) { const q = this.queued; this.queued = null; q.cancelled = true; q._finish(); }
    this.queued = s;
    if (this.active) this._stopSearch(this.active, true);
    else this._startQueued();
    return s;
  }

  /** Convenience: run a search to completion. */
  run(req) { return this.search(req).promise; }

  stopAll() {
    if (this.queued) { const q = this.queued; this.queued = null; q.cancelled = true; q._finish(); }
    if (this.active) this._stopSearch(this.active, true);
  }

  get busy() { return !!(this.active || this.queued); }

  terminate() {
    this.stopAll();
    if (this.active) { const a = this.active; this.active = null; a._finish({ error: 'terminated' }); }
    try { this.transport && this.transport.terminate(); } catch { /* ignore */ }
    this.transport = null;
    this._failWaiters('terminated');
    this._setStatus('dead');
  }

  _stopSearch(s, cancel) {
    if (s.done) return;
    if (cancel) s.cancelled = true;
    if (this.queued === s) { this.queued = null; s._finish(); return; }
    if (this.active === s && !s.stopping) {
      s.stopping = true;
      this._send('stop');
    }
  }

  _startQueued() {
    if (this.active || !this.queued || this.status !== 'ready') return;
    this._flushNewGame();
    const s = this.queued;
    this.queued = null;
    this.active = s;
    const opts = { ...this.baseOptions, ...(s.req.options || {}) };
    for (const [k, v] of Object.entries(opts)) this._setOption(k, v);
    const { startFen, moves } = s.root;
    this._send(`position fen ${startFen}${moves.length ? ' moves ' + moves.join(' ') : ''}`);
    s.started = true;
    s.startedAt = performance.now();
    this._send(goCommand(s.req.limits || { infinite: true }));
  }

  _setOption(name, value) {
    if (value === undefined || value === null) return;
    const def = this.optionDefs[name];
    if (!def && Object.keys(this.optionDefs).length) return; // unknown option for this build
    let v = value;
    if (def && def.type === 'spin') {
      v = Math.round(Number(v));
      if (def.min !== undefined) v = Math.max(def.min, v);
      if (def.max !== undefined) v = Math.min(def.max, v);
    }
    if (typeof v === 'boolean') v = v ? 'true' : 'false';
    v = String(v);
    if (this.current[name] === v) return;
    this.current[name] = v;
    this._send(`setoption name ${name} value ${v}`);
  }

  _send(cmd) {
    if (this.log) this.log('>', cmd);
    if (this.transport) this.transport.send(cmd);
  }

  _onLine(line) {
    if (this.log) this.log('<', line);
    if (line.startsWith('info')) {
      const info = parseInfo(line);
      if (!info) return;
      if (info.string) {
        if (/CRITICAL ERROR/i.test(info.string)) {
          // SF19 refuses the position; no bestmove will follow.
          const a = this.active;
          if (a) { this.active = null; a._finish({ error: info.string }); this._startQueued(); }
        }
        return;
      }
      if (this.active) this.active._onInfo(info);
      return;
    }
    if (line.startsWith('bestmove')) {
      const bm = parseBestmove(line);
      const a = this.active;
      this.active = null;
      if (a) a._finish(bm || {});
      this._startQueued();
      return;
    }
    if (line.startsWith('option ')) {
      const opt = parseOption(line);
      if (opt) this.optionDefs[opt.name] = opt;
    } else if (line.startsWith('id name ')) {
      this.name = line.slice(8).trim();
    }
    for (const w of [...this._waiters]) {
      if (w.test(line)) { this._waiters.splice(this._waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(line); }
    }
  }

  _waitFor(test, timeoutMs, label) {
    return new Promise((resolve, reject) => {
      const w = { test, resolve, reject };
      w.timer = setTimeout(() => {
        const i = this._waiters.indexOf(w);
        if (i >= 0) this._waiters.splice(i, 1);
        reject(new Error(`Engine timeout waiting for ${label}`));
      }, timeoutMs);
      this._waiters.push(w);
    });
  }

  _failWaiters(reason) {
    for (const w of this._waiters.splice(0)) { clearTimeout(w.timer); w.reject(new Error(reason)); }
  }

  _onFatal(err) {
    this.error = String(err && err.message ? err.message : err);
    const a = this.active, q = this.queued;
    this.active = null;
    this.queued = null;
    if (a) a._finish({ error: this.error });
    if (q) q._finish({ error: this.error });
    this._failWaiters(this.error);
    this._setStatus('error', this.error);
  }
}
