// Owns the single Stockfish 19 instance in the browser: picks the right build (full/lite × multi/single
// thread), shows download progress, recovers from a mis-served .wasm, and restarts on settings changes.
import { signal } from '@preact/signals';
import { Engine } from './engine.js';

export const BUILDS = {
  'stockfish-19': { bytes: 99065439, mt: true, variant: 'full' },
  'stockfish-19-single': { bytes: 99102793, mt: false, variant: 'full' },
  'stockfish-19-lite': { bytes: 1636291, mt: true, variant: 'lite' },
  'stockfish-19-lite-single': { bytes: 1787571, mt: false, variant: 'lite' },
};

export const mtSupported = () =>
  typeof SharedArrayBuffer !== 'undefined' && typeof Atomics !== 'undefined' && self.crossOriginIsolated === true;

export const maxThreads = () => (mtSupported() ? Math.max(1, Math.min(32, navigator.hardwareConcurrency || 4)) : 1);

export function defaultThreads() {
  const hc = navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(8, Math.floor(hc / 2)));
}

export function pickBuild(variant, forceSingle = false) {
  const mt = mtSupported() && !forceSingle;
  const base = variant === 'lite' ? 'stockfish-19-lite' : 'stockfish-19';
  const name = mt ? base : `${base}-single`;
  return { name, mt, variant: variant === 'lite' ? 'lite' : 'full', js: `engine/${name}.js`, wasm: `engine/${name}.wasm`, bytes: BUILDS[name].bytes };
}

function workerTransport(build, wasmUrl) {
  return ({ onLine, onError, onProgress }) => {
    const url = build.js + (wasmUrl ? `#${encodeURIComponent(wasmUrl)}` : '');
    const worker = new Worker(url);
    worker.onmessage = e => { if (typeof e.data === 'string') onLine(e.data); };
    worker.onerror = e => {
      if (e.preventDefault) e.preventDefault();
      onError(e.message || 'Engine worker failed to start');
    };
    if (onProgress && !wasmUrl && typeof MessageChannel !== 'undefined') {
      const ch = new MessageChannel();
      ch.port1.onmessage = ev => onProgress(ev.data);
      worker.postMessage({ progressPort: ch.port2 }, [ch.port2]);
    }
    return { send: cmd => worker.postMessage(cmd), terminate: () => worker.terminate() };
  };
}

/** Is the .wasm served as application/wasm? (Streaming compilation requires it.) Our service worker fixes it when active. */
async function wasmMimeOk(url) {
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) return true;
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (!r.ok) return true; // let the normal path surface the real error
    return (r.headers.get('content-type') || '').toLowerCase().includes('application/wasm');
  } catch { return true; }
}

async function fetchWasmBlob(url, total, onProgress) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  const t0 = performance.now();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    const secs = (performance.now() - t0) / 1000 || 0.001;
    onProgress({ loaded, total, percent: Math.min(1, loaded / total), speedBytesPerSec: loaded / secs });
  }
  return new Blob(chunks, { type: 'application/wasm' });
}

export class EngineManager {
  constructor() {
    this.state = signal({ status: 'idle', progress: null, build: null, threads: 1, hash: 64, name: '', error: null });
    this.engine = null;
    this.gen = 0;
    this.readyListeners = new Set();
    this.config = null;
  }

  get ready() { return this.state.value.status === 'ready'; }

  onReady(fn) { this.readyListeners.add(fn); return () => this.readyListeners.delete(fn); }

  _patch(p) { this.state.value = { ...this.state.value, ...p }; }

  /** (Re)start the engine with { variant, threads, hash }. */
  async start(config, forceSingle = false) {
    this.config = { ...config };
    const gen = ++this.gen;
    if (this.engine) { this.engine.terminate(); this.engine = null; }
    const build = pickBuild(config.variant, forceSingle);
    const threads = build.mt ? Math.max(1, Math.min(maxThreads(), config.threads || 1)) : 1;
    const hash = Math.max(16, Math.min(1024, config.hash || 64));
    this._patch({ status: 'loading', progress: null, build, threads, hash, error: null, name: '' });
    const options = { Threads: threads, Hash: hash };
    const viaBlob = async () => {
      const blob = await fetchWasmBlob(build.wasm, build.bytes, p => this._progress(gen, p));
      if (gen !== this.gen) return;
      const url = URL.createObjectURL(blob);
      try { await this._init(build, url, gen, options); } finally { setTimeout(() => URL.revokeObjectURL(url), 30000); }
    };
    try {
      if (!(await wasmMimeOk(build.wasm))) { await viaBlob(); return; }
      await this._init(build, null, gen, options);
    } catch (err) {
      if (gen !== this.gen) return;
      const msg = String((err && err.message) || err);
      // A host that serves .wasm with the wrong MIME type (or a silent worker failure) → retry via a Blob URL.
      if (/mime|content-type|compile|instantiate|wasm|stalled/i.test(msg)) {
        try { await viaBlob(); return; } catch (err2) { if (gen !== this.gen) return; err = err2; }
      }
      // Multi-threaded builds need large shared memory, which some devices refuse: fall back to one thread.
      if (build.mt && gen === this.gen) {
        console.warn('Multi-threaded engine failed, falling back to single-threaded:', err);
        this.start(config, true);
        return;
      }
      this._fail(err);
    }
  }

  _fail(err) {
    const msg = String((err && err.message) || err);
    console.error('Engine failed:', msg);
    if (this.engine) { try { this.engine.terminate(); } catch { /* ignore */ } this.engine = null; }
    this._patch({ status: 'error', error: msg });
  }

  _progress(gen, p) {
    if (gen !== this.gen || !p) return;
    this._patch({ progress: { loaded: p.loaded || 0, total: p.total || this.state.value.build.bytes, percent: p.percent || 0, speed: p.speedBytesPerSec || 0 } });
  }

  async _init(build, wasmUrl, gen, options) {
    // Watchdog: a worker whose WASM fails to instantiate dies silently (unhandled rejection inside the worker).
    let last = performance.now();
    let downloaded = !!wasmUrl;
    let timer;
    const stall = new Promise((_, reject) => {
      timer = setInterval(() => {
        const idle = performance.now() - last;
        if ((!downloaded && idle > 30000) || (downloaded && idle > 240000)) reject(new Error('engine stalled while loading wasm'));
      }, 1000);
    });
    const engine = new Engine({
      createTransport: workerTransport(build, wasmUrl),
      onProgress: p => { last = performance.now(); if (p && p.percent >= 1) downloaded = true; this._progress(gen, p); },
      onStatus: (status, extra) => {
        if (gen !== this.gen) return;
        if (status === 'error' && this.state.value.status === 'ready') {
          this._patch({ status: 'error', error: String(extra || 'engine crashed') });
        }
      },
    });
    this.engine = engine;
    try {
      await Promise.race([engine.init(options, { timeoutMs: 15 * 60 * 1000 }), stall]);
    } catch (e) {
      engine.terminate();
      if (this.engine === engine) this.engine = null;
      throw e;
    } finally {
      clearInterval(timer);
    }
    if (gen !== this.gen) { engine.terminate(); return; }
    this._patch({ status: 'ready', name: engine.name, progress: null, error: null });
    for (const fn of this.readyListeners) { try { fn(); } catch (e) { console.error(e); } }
  }

  /** Start a search; if the engine isn't available the returned search finishes with an error. */
  search(req) {
    if (!this.engine) {
      const fake = { done: true, cancelled: false, lines: [], stop: () => fake.promise, cancel: () => fake.promise };
      fake.promise = Promise.resolve({ error: 'engine-unavailable', lines: [], bestmove: null, cancelled: false });
      return fake;
    }
    return this.engine.search(req);
  }

  stopAll() { if (this.engine) this.engine.stopAll(); }

  newGame() { if (this.engine) this.engine.newGame(); }

  /** Apply Threads/Hash without restarting (when the build doesn't change). */
  configure({ threads, hash }) {
    if (!this.engine) return;
    const st = this.state.value;
    const t = st.build && st.build.mt ? Math.max(1, Math.min(maxThreads(), threads)) : 1;
    this.engine.configure({ Threads: t, Hash: hash });
    this._patch({ threads: t, hash });
  }
}

export const engineManager = new EngineManager();
