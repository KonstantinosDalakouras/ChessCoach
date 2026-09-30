import { h, render } from 'preact';
import { settings, effectiveThreads } from './store.js';
import { t } from './i18n.js';
import { App } from './ui/App.jsx';
import { engineManager } from './engine/manager.js';
import { openings } from './game/openings.js';
import { play, playState, playVersion } from './controllers/play.js';
import { analysis, anState, anVersion } from './controllers/analysis.js';
import { mode, setMode, loadIntoAnalysis, startGame } from './app-actions.js';
import { hooks, openDialog, dialogState } from './ui/dialogs.jsx';
import { confirmState, toast } from './ui/common.jsx';
import { refreshLibrary } from './library.js';
import { sounds } from './sound.js';
import { playFlip } from './ui/PlayView.jsx';
import { posFromFen, destsOf } from './chess/util.js';

const COI_KEY = 'sf19c.coi-reload';
const ss = {
  get: k => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
};

/**
 * Multi-threaded Stockfish needs SharedArrayBuffer, i.e. a cross-origin isolated page (COOP/COEP headers).
 * If the host doesn't send them, our service worker adds them — which only takes effect after one reload.
 */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    let refreshing = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing || !hadController) return;
      refreshing = true;
      toast(t('c.updateReady'), { timeout: 0, action: { label: t('c.reload'), onClick: () => location.reload() } });
    });
    return reg;
  } catch (e) {
    console.warn('Service worker registration failed:', e);
    return null;
  }
}

function waitForActive(reg, timeout = 5000) {
  return new Promise(resolve => {
    if (reg.active && reg.active.state === 'activated') { resolve(true); return; }
    const sw = reg.installing || reg.waiting || reg.active;
    if (!sw) { resolve(false); return; }
    const timer = setTimeout(() => resolve(false), timeout);
    sw.addEventListener('statechange', () => { if (sw.state === 'activated') { clearTimeout(timer); resolve(true); } });
  });
}

async function ensureIsolation() {
  const reg = await registerServiceWorker();
  if (window.crossOriginIsolated || !reg) return;
  if (ss.get(COI_KEY)) return; // already tried in this tab: the browser doesn't honour SW-provided headers
  if (navigator.serviceWorker.controller) { ss.set(COI_KEY, '1'); return; }
  const ok = await waitForActive(reg);
  if (!ok) return;
  ss.set(COI_KEY, '1');
  location.reload();
  await new Promise(() => {}); // stop here until the reload happens
}

function startEngine() {
  const s = settings.value;
  engineManager.start({ variant: s.variant, threads: effectiveThreads(), hash: s.hash });
}

function isTyping(e) {
  const el = e.target;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function onKey(e) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
  if (dialogState.value || confirmState.value) return;
  const m = mode.value;
  const k = e.key;
  let handled = true;
  if (m === 'play') {
    const s = playState.value;
    const tree = s.tree;
    const node = tree && (tree.get(s.cur) || play.liveNode());
    switch (k) {
      case 'ArrowLeft': if (node && node.parent) play.select(node.parent); break;
      case 'ArrowRight': if (node && node.children[0]) play.select(node.children[0]); break;
      case 'Home': case 'ArrowUp': if (tree) play.select(tree.root); break;
      case 'End': case 'ArrowDown': if (tree) play.select(play.liveNode()); break;
      case 'f': case 'F': playFlip.value = !playFlip.value; break;
      case 'h': case 'H': play.hint(); break;
      case 't': case 'T': play.threat(); break;
      case 'u': case 'U': play.takeback(); break;
      case 'n': case 'N': openDialog('newGame'); break;
      case '?': openDialog('help'); break;
      default: handled = false;
    }
  } else if (m === 'analysis') {
    switch (k) {
      case 'ArrowLeft': analysis.prev(); break;
      case 'ArrowRight': analysis.next(); break;
      case 'ArrowUp': analysis.sibling(-1); break;
      case 'ArrowDown': analysis.sibling(1); break;
      case 'Home': analysis.first(); break;
      case 'End': analysis.last(); break;
      case 'f': case 'F': analysis.flip(); break;
      case ' ': analysis.toggleEngine(); break;
      case 'x': case 'X': analysis.toggleThreat(); break;
      case 'n': case 'N': openDialog('newGame'); break;
      case '?': openDialog('help'); break;
      default: handled = false;
    }
  } else if (k === 'n' || k === 'N') openDialog('newGame');
  else handled = false;
  if (handled) e.preventDefault();
}

async function boot() {
  await ensureIsolation();

  hooks.startGame = cfg => startGame(cfg);
  hooks.loadIntoAnalysis = (tree, opts) => loadIntoAnalysis(tree, opts);
  hooks.analysisState = () => anState.value;
  hooks.restartEngine = startEngine;

  play.restore();
  const initial = (location.hash || '').slice(1);
  if (['play', 'analysis', 'library'].includes(initial)) mode.value = initial;

  const root = document.getElementById('app');
  root.textContent = '';
  render(<App />, root);

  if (mode.value === 'play') play.resume();
  else if (mode.value === 'analysis') analysis.activate();

  if (!settings.value.welcomed) openDialog('welcome');
  else startEngine();

  openings.load().then(() => { playVersion.value++; anVersion.value++; }).catch(() => {});
  refreshLibrary();
  document.addEventListener('keydown', onKey);
  // Browsers only allow audio after a user gesture.
  const unlock = () => { sounds.unlock(); window.removeEventListener('pointerdown', unlock); };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('offline', () => toast(t('c.offline'), { timeout: 3000 }));
  // Debug/test hook
  window.__sf19 = {
    play, analysis, engineManager, setMode, playState, anState,
    legal: fen => { const pos = posFromFen(fen); const out = []; for (const [from, tos] of destsOf(pos)) for (const to of tos) out.push(from + to); return out; },
  };
}

boot().catch(e => {
  console.error(e);
  const root = document.getElementById('app');
  if (root) root.innerHTML = `<div class="boot-error"><h1>SF19 Coach</h1><p>${String(e && e.message ? e.message : e)}</p></div>`;
});
