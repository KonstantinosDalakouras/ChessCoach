// Cross-mode actions (switching tabs, sending a game from Play to Analysis, opening library games).
import { signal } from '@preact/signals';
import { play, playState } from './controllers/play.js';
import { analysis } from './controllers/analysis.js';
import { GameTree } from './game/tree.js';
import { refreshLibrary, getGame } from './library.js';
import { openDialog } from './ui/dialogs.jsx';
import { toast } from './ui/common.jsx';
import { t } from './i18n.js';

export const mode = signal('play');

export function setMode(m) {
  if (m === mode.value) return;
  if (mode.value === 'play') play.suspend();
  if (mode.value === 'analysis') analysis.deactivate();
  mode.value = m;
  try { history.replaceState(null, '', `#${m}`); } catch { /* ignore */ }
  if (m === 'play') play.resume();
  if (m === 'analysis') analysis.activate();
  if (m === 'library') refreshLibrary();
}

/** Copy of the play game (independent node ids), plus the node matching `node` in the copy. */
function copyPlayTree(node) {
  const s = playState.value;
  const copy = GameTree.fromJSON(s.tree.toJSON());
  let target = copy.root;
  if (node) {
    for (const uci of s.tree.movesTo(node)) {
      const next = target.children.find(c => c.uci === uci);
      if (!next) break;
      target = next;
    }
  }
  return { copy, target };
}

export async function goReview() {
  // The finished game is being written to the library: wait so the review updates that same entry.
  if (play.savePromise) await play.savePromise.catch(() => {});
  const s = playState.value;
  if (!s.tree) return;
  const { copy } = copyPlayTree(null);
  analysis.load(copy, {
    source: 'play', libraryId: s.savedId, userColor: s.config.userColor, elo: s.config.elo, stats: s.stats,
    autoReview: true, date: new Date().toISOString(),
  });
  setMode('analysis');
}

export function goAnalyseFromPlay(node) {
  const s = playState.value;
  if (!s.tree) return;
  const { copy, target } = copyPlayTree(node);
  analysis.load(copy, { source: 'play', libraryId: s.savedId, userColor: s.config.userColor, elo: s.config.elo, stats: s.stats, cur: target.id });
  setMode('analysis');
}

/** Start a new game from the New-game dialog (switching to the Play tab). */
export function startGame(cfg) {
  if (mode.value === 'analysis') analysis.deactivate();
  play.suspended = false;
  if (mode.value !== 'play') {
    mode.value = 'play';
    try { history.replaceState(null, '', '#play'); } catch { /* ignore */ }
  }
  play.start(cfg);
}

export function playFromPosition(fen) {
  openDialog('newGame', { startFen: fen });
}

export async function openLibraryGame(id) {
  const e = await getGame(id);
  if (!e || !e.tree) { toast('?', { type: 'error' }); return; }
  const tree = GameTree.fromJSON(e.tree);
  analysis.load(tree, {
    source: e.source, libraryId: e.id, userColor: e.userColor, elo: e.elo, stats: e.stats, date: e.date,
    title: e.source === 'import' ? '' : '',
  });
  setMode('analysis');
}

export function loadIntoAnalysis(tree, opts = {}) {
  analysis.load(tree, opts);
  setMode('analysis');
  if (opts.autoReview && tree.mainline().length) toast(t('rv.running', { i: 0, n: tree.mainline().length + 1 }), { timeout: 1500 });
}
