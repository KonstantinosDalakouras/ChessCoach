import { h } from 'preact';
import { useState, useMemo, useRef, useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Chessground } from '@lichess-org/chessground';
import { t, lang } from '../i18n.js';
import { settings, updateSettings, resetSettings, DEFAULT_NEW_GAME, effectiveThreads } from '../store.js';
import { Modal, Btn, Toggle, Segmented, Select, Field, Icon, ClassIcon, Kbd, copyText, downloadText, toast, confirmDialog } from './common.jsx';
import { BOARD_THEMES, boardImage, boardColors } from './Board.jsx';
import { engineManager, maxThreads, mtSupported } from '../engine/manager.js';
import { setupPosition, START_FEN } from '../chess/util.js';
import { importPgn, exportPgn } from '../game/pgn.js';
import { GameTree } from '../game/tree.js';
import { explanationText } from './Panels.jsx';
import { explainMove } from '../analysis/explain.js';
import { posFromFen } from '../chess/util.js';
import { moverOf } from '../game/tree.js';
import { clearLibrary, allGames } from '../library.js';

export const dialogState = signal(null); // { type, props }
export const openDialog = (type, props = {}) => { dialogState.value = { type, props }; };
export const closeDialog = () => { dialogState.value = null; };

// Lazily bound to avoid import cycles (set by main.jsx).
export const hooks = { startGame: null, loadIntoAnalysis: null, analysisState: null, restartEngine: null, currentTree: null };

export function Dialogs() {
  const d = dialogState.value;
  if (!d) return null;
  const props = { ...d.props, onClose: closeDialog };
  switch (d.type) {
    case 'newGame': return <NewGameDialog {...props} />;
    case 'settings': return <SettingsDialog {...props} />;
    case 'import': return <ImportDialog {...props} />;
    case 'export': return <ExportDialog {...props} />;
    case 'help': return <HelpDialog {...props} />;
    case 'welcome': return <WelcomeDialog {...props} />;
    case 'editor': return <EditorDialog {...props} />;
    default: return null;
  }
}

// ---------------------------------------------------------------- New game
const LEVELS = [1320, 1600, 1900, 2100, 2300, 2500, 2700, 2900, 3100];
export const levelLabel = elo => t(`lvl.${[...LEVELS].reverse().find(l => elo >= l) || 1320}`);
const TC_PRESETS = [[1, 0], [2, 1], [3, 0], [3, 2], [5, 0], [5, 3], [10, 0], [10, 5], [15, 10], [30, 0], [30, 20]];
const MOVETIMES = [300, 500, 1000, 2000, 3000, 5000, 10000];

function NewGameDialog({ onClose, startFen }) {
  const [c, setC] = useState(() => ({ ...DEFAULT_NEW_GAME, ...settings.value.newGame, ...(startFen ? { start: 'fen', fen: startFen } : {}) }));
  const set = p => setC(v => ({ ...v, ...p }));
  const fenCheck = c.start === 'fen' ? setupPosition(c.fen) : null;
  const fenError = c.start === 'fen' && (!c.fen.trim() || (fenCheck && fenCheck.error));
  const training = c.mode === 'training';
  const start = () => {
    if (fenError) return;
    const cfg = { ...c, startFen: c.start === 'fen' ? fenCheck.fen : undefined };
    updateSettings({ newGame: { ...c, start: c.start === 'fen' && startFen ? 'standard' : c.start, fen: c.start === 'fen' ? c.fen : '' } });
    onClose();
    hooks.startGame(cfg);
  };
  return (
    <Modal title={t('ng.title')} onClose={onClose} icon="swords" class="modal-newgame"
      footer={<><Btn label={t('c.cancel')} onClick={onClose} /><Btn variant="primary" icon="play" label={t('play.start')} onClick={start} disabled={fenError} /></>}>
      <Field label={t('ng.color')}>
        <div class="color-pick" role="radiogroup">
          {['white', 'random', 'black'].map(col => (
            <button type="button" role="radio" aria-checked={c.color === col} class={`color-opt${c.color === col ? ' on' : ''}`} onClick={() => set({ color: col })} title={t(`color.${col}`)}>
              {col === 'random' ? <span class="random-king"><i class="pc pc-king-white" /><i class="pc pc-king-black" /></span> : <i class={`pc pc-king-${col}`} />}
              <span>{t(`color.${col}`)}</span>
            </button>
          ))}
        </div>
      </Field>

      <Field label={t('ng.strength')} hint={t('ng.eloHint')}>
        <div class={`strength${c.max ? ' is-max' : ''}`}>
          <div class="strength-top">
            <span class="elo-value">{c.max ? '∞' : c.elo}</span>
            <span class="elo-label">{c.max ? t('lvl.max') : levelLabel(c.elo)}</span>
          </div>
          <input type="range" min="1320" max="3190" step="10" value={c.elo} disabled={c.max} aria-label={t('ng.strength')}
            onInput={e => set({ elo: +e.currentTarget.value })} class="range" />
          <div class="range-marks"><span>1320</span><span>2000</span><span>2600</span><span>3190</span></div>
          <Toggle checked={c.max} onChange={v => set({ max: v })} label={t('lvl.max')} />
        </div>
      </Field>

      <Field label={t('ng.time')}>
        <Segmented value={c.clock ? 'clock' : 'none'} onChange={v => set({ clock: v === 'clock' })}
          options={[{ value: 'none', label: t('play.noClock'), icon: 'infinity' }, { value: 'clock', label: t('ng.clock'), icon: 'clock' }]} />
        {!c.clock && (
          <div class="sub-field">
            <span class="sub-label">{t('play.moveTime')}</span>
            <div class="chips">
              {MOVETIMES.map(ms => <button type="button" class={`chip-btn${c.movetime === ms ? ' on' : ''}`} onClick={() => set({ movetime: ms })}>{ms < 1000 ? `${ms / 1000}s` : `${ms / 1000}s`}</button>)}
            </div>
          </div>
        )}
        {c.clock && (
          <div class="sub-field">
            <div class="chips">
              {TC_PRESETS.map(([b, i]) => <button type="button" class={`chip-btn${c.base === b && c.inc === i ? ' on' : ''}`} onClick={() => set({ base: b, inc: i })}>{b}+{i}</button>)}
            </div>
            <div class="tc-custom">
              <label>{t('ng.minutes')} <input type="number" min="0.5" max="180" step="0.5" value={c.base} onInput={e => set({ base: Math.max(0.5, +e.currentTarget.value || 1) })} class="input input-sm" /></label>
              <label>{t('ng.increment')} <input type="number" min="0" max="60" step="1" value={c.inc} onInput={e => set({ inc: Math.max(0, +e.currentTarget.value || 0) })} class="input input-sm" /></label>
            </div>
          </div>
        )}
      </Field>

      <Field label={t('ng.mode')}>
        <div class="mode-cards">
          <button type="button" class={`mode-card${training ? ' on' : ''}`} onClick={() => set({ mode: 'training' })}>
            <Icon name="graduation-cap" size={22} />
            <strong>{t('ng.training')}</strong>
            <span>{t('ng.trainingDesc')}</span>
          </button>
          <button type="button" class={`mode-card${!training ? ' on' : ''}`} onClick={() => set({ mode: 'normal' })}>
            <Icon name="swords" size={22} />
            <strong>{t('ng.normal')}</strong>
            <span>{t('ng.normalDesc')}</span>
          </button>
        </div>
        {training && (
          <details class="assist">
            <summary>{t('ng.advanced')}</summary>
            <Toggle checked={c.coach} onChange={v => set({ coach: v })} label={t('ng.coach')} />
            <Toggle checked={c.pause} onChange={v => set({ pause: v })} label={t('ng.pause')} disabled={!c.coach} />
            <Toggle checked={c.evalbar} onChange={v => set({ evalbar: v })} label={t('ng.evalbar')} />
            <Toggle checked={c.hints} onChange={v => set({ hints: v })} label={t('ng.hints')} />
            <Toggle checked={c.takebacks} onChange={v => set({ takebacks: v })} label={t('ng.takebacks')} />
            <Toggle checked={c.alertOpp} onChange={v => set({ alertOpp: v })} label={t('ng.alertOpp')} />
          </details>
        )}
      </Field>

      <Field label={t('ng.position')}>
        <Segmented value={c.start === 'fen' ? 'fen' : 'standard'} onChange={v => set({ start: v })}
          options={[{ value: 'standard', label: t('ng.standard') }, { value: 'fen', label: t('ng.fromFen') }]} />
        {c.start === 'fen' && (
          <>
            <input class={`input mono${fenError ? ' invalid' : ''}`} value={c.fen} placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
              onInput={e => set({ fen: e.currentTarget.value })} spellcheck={false} aria-label="FEN" />
            {fenError && c.fen.trim() && <div class="error-text">{t('ng.fenInvalid')}</div>}
          </>
        )}
      </Field>
    </Modal>
  );
}

// ---------------------------------------------------------------- Settings
function SettingsDialog({ onClose }) {
  const s = settings.value;
  const es = engineManager.state.value;
  const mt = mtSupported();
  const maxT = maxThreads();
  const restart = patch => {
    updateSettings(patch);
    const v = settings.value;
    engineManager.start({ variant: v.variant, threads: effectiveThreads(), hash: v.hash });
  };
  const threadOpts = [];
  for (let i = 1; i <= maxT; i++) threadOpts.push({ value: String(i), label: String(i) });
  return (
    <Modal title={t('set.title')} onClose={onClose} icon="settings" wide class="modal-settings"
      footer={<><Btn label={t('set.reset')} icon="rotate-ccw" onClick={async () => { if (await confirmDialog(`${t('set.reset')}?`)) { resetSettings(); restart({}); } }} variant="ghost" /><Btn variant="primary" label={t('c.close')} onClick={onClose} /></>}>
      <div class="settings-grid">
        <section>
          <h3><Icon name="languages" size={16} /> {t('set.general')}</h3>
          <Field label={t('set.language')}>
            <Segmented value={s.lang} onChange={v => updateSettings({ lang: v })} options={[{ value: 'el', label: 'Ελληνικά' }, { value: 'en', label: 'English' }]} />
          </Field>
          <Field label={t('set.theme')}>
            <Segmented value={s.theme} onChange={v => updateSettings({ theme: v })} options={[
              { value: 'dark', label: t('set.themeDark'), icon: 'moon' }, { value: 'light', label: t('set.themeLight'), icon: 'sun' }, { value: 'system', label: t('set.themeSystem'), icon: 'monitor' },
            ]} />
          </Field>
          <Field label={t('set.playerName')} for="player-name">
            <input id="player-name" class="input" value={s.playerName} maxLength={40} onInput={e => updateSettings({ playerName: e.currentTarget.value })} placeholder={t('side.you')} />
          </Field>
          <Toggle checked={s.sound} onChange={v => updateSettings({ sound: v })} label={t('set.sound')} />
        </section>
        <section>
          <h3><Icon name="layers" size={16} /> {t('set.board')}</h3>
          <Field label={t('set.boardTheme')}>
            <div class="theme-swatches">
              {BOARD_THEMES.map(th => (
                <button type="button" class={`swatch${s.boardTheme === th ? ' on' : ''}`} onClick={() => updateSettings({ boardTheme: th })} title={th} aria-label={th}
                  style={{ backgroundImage: boardImage(th) }} />
              ))}
            </div>
          </Field>
          <Field label={t('set.animation')}>
            <Segmented value={s.animation} onChange={v => updateSettings({ animation: v })} options={[
              { value: 'fast', label: t('set.animFast') }, { value: 'normal', label: t('set.animNormal') }, { value: 'off', label: t('set.animOff') },
            ]} />
          </Field>
          <Toggle checked={s.coords} onChange={v => updateSettings({ coords: v })} label={t('set.coords')} />
          <Toggle checked={s.showDests} onChange={v => updateSettings({ showDests: v })} label={t('set.dests')} />
          <Toggle checked={s.arrows} onChange={v => updateSettings({ arrows: v })} label={t('set.arrows')} />
          <Toggle checked={s.figurine} onChange={v => updateSettings({ figurine: v })} label={t('set.figurine')} />
        </section>
        <section class="span-2">
          <h3><Icon name="cpu" size={16} /> {t('set.engine')}</h3>
          <Field label={t('set.variant')}>
            <Segmented value={s.variant} onChange={v => restart({ variant: v })} options={[
              { value: 'full', label: t('set.variantFull') }, { value: 'lite', label: t('set.variantLite') },
            ]} />
          </Field>
          <div class="field-row">
            <Field label={t('set.threads')} hint={mt ? null : t('set.threadsNa')}>
              <Select value={String(mt ? Math.min(maxT, effectiveThreads()) : 1)} disabled={!mt} options={threadOpts.length ? threadOpts : [{ value: '1', label: '1' }]}
                onChange={v => { updateSettings({ threads: +v }); engineManager.configure({ threads: +v, hash: s.hash }); }} />
            </Field>
            <Field label={t('set.hash')}>
              <Select value={String(s.hash)} options={[16, 32, 64, 128, 256, 512].map(v => ({ value: String(v), label: `${v} MB` }))}
                onChange={v => { updateSettings({ hash: +v }); engineManager.configure({ threads: effectiveThreads(), hash: +v }); }} />
            </Field>
          </div>
          <div class="field-row">
            <Field label={t('set.coachPrecision')}>
              <Segmented value={s.coachPrecision} onChange={v => updateSettings({ coachPrecision: v })} options={[
                { value: 'fast', label: t('set.precFast') }, { value: 'normal', label: t('set.precNormal') }, { value: 'deep', label: t('set.precDeep') },
              ]} />
            </Field>
            <Field label={t('set.reviewPreset')}>
              <Segmented value={s.reviewPreset} onChange={v => updateSettings({ reviewPreset: v })} options={[
                { value: 'fast', label: t('rv.fast') }, { value: 'standard', label: t('rv.standard') }, { value: 'deep', label: t('rv.deep') },
              ]} />
            </Field>
          </div>
          <div class="engine-info muted">
            <Icon name="info" size={14} /> {es.name || 'Stockfish 19'} · {es.build ? es.build.name : ''} · {es.threads > 1 ? t('engine.threads', { n: es.threads }) : t('engine.thread1')} · Hash {es.hash} MB
          </div>
        </section>
        <section class="span-2">
          <h3><Icon name="hard-drive-download" size={16} /> {t('set.data')}</h3>
          <div class="btn-row">
            <Btn icon="download" label={t('lib.exportAll')} onClick={exportAllGames} />
            <Btn icon="trash" variant="danger" label={t('lib.clearAll')} onClick={async () => { if (await confirmDialog(t('lib.clearConfirm'), { danger: true, okLabel: t('lib.clearAll') })) clearLibrary(); }} />
          </div>
        </section>
      </div>
    </Modal>
  );
}

export async function exportAllGames() {
  const games = await allGames();
  const pgns = [];
  for (const g of games.sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
    try { pgns.push(exportPgn(GameTree.fromJSON(g.tree), { evals: true, annotations: true })); } catch (e) { console.warn(e); }
  }
  downloadText(`sf19coach-games-${new Date().toISOString().slice(0, 10)}.pgn`, pgns.join('\n\n'));
}

// ---------------------------------------------------------------- Import
function ImportDialog({ onClose }) {
  const [text, setText] = useState('');
  const [games, setGames] = useState(null);
  const [error, setError] = useState(null);
  const [auto, setAuto] = useState(true);
  const fileRef = useRef();

  const load = (input = text) => {
    setError(null);
    const raw = input.trim();
    if (!raw) return;
    // FEN?
    if (!raw.includes('\n') && /^[rnbqkpRNBQKP1-8]+(\/[rnbqkpRNBQKP1-8]+){7}(\s|$)/.test(raw)) {
      const r = setupPosition(raw);
      if (r.error) { setError(`${t('ng.fenInvalid')} (${r.error})`); return; }
      onClose();
      hooks.loadIntoAnalysis(new GameTree(r.fen), { source: 'new', orientation: r.pos.turn });
      return;
    }
    const found = importPgn(raw).filter(g => g.tree.mainline().length || !g.tree.isStandardStart);
    if (!found.length) { setError(t('io.invalid')); return; }
    if (found.length === 1) pick(found[0]);
    else setGames(found);
  };

  const pick = g => {
    const name = (settings.value.playerName || '').trim().toLowerCase();
    let userColor = null;
    if (name) {
      if ((g.headers.White || '').toLowerCase().includes(name)) userColor = 'white';
      else if ((g.headers.Black || '').toLowerCase().includes(name)) userColor = 'black';
    }
    if (g.errors.length) toast(t('io.warnings', { w: g.errors.slice(0, 2).join('; ') }), { type: 'warn', timeout: 6000 });
    onClose();
    hooks.loadIntoAnalysis(g.tree, { source: 'import', userColor, title: g.title, autoReview: auto });
  };

  const onFile = async e => {
    const f = e.currentTarget.files && e.currentTarget.files[0];
    if (!f) return;
    const txt = await f.text();
    setText(txt);
    load(txt);
  };

  return (
    <Modal title={t('io.importTitle')} onClose={onClose} icon="upload" wide
      footer={<><Btn label={t('c.cancel')} onClick={onClose} /><Btn variant="primary" icon="upload" label={t('io.load')} onClick={() => load()} disabled={!text.trim()} /></>}>
      {!games && (
        <>
          <textarea class="input textarea mono" rows={10} value={text} onInput={e => setText(e.currentTarget.value)} placeholder={t('io.paste')} spellcheck={false} aria-label={t('io.paste')} />
          <div class="btn-row">
            <input type="file" accept=".pgn,.txt,application/x-chess-pgn,text/plain" ref={fileRef} onChange={onFile} hidden />
            <Btn icon="file-text" label={t('io.file')} onClick={() => fileRef.current.click()} />
            <span class="grow" />
            <Toggle checked={auto} onChange={setAuto} label={t('io.autoReview')} />
          </div>
          {error && <div class="error-text">{error}</div>}
        </>
      )}
      {games && (
        <div class="game-pick">
          <div class="muted">{t('io.pick', { n: games.length })}</div>
          <div class="game-pick-list">
            {games.map(g => (
              <button type="button" class="game-pick-item" onClick={() => pick(g)}>
                <strong>{g.title}{g.headers.Result ? ` (${g.headers.Result})` : ''}</strong>
                <span class="muted">{[g.headers.Event, g.headers.Date].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- Export
function ExportDialog({ onClose }) {
  const st = hooks.analysisState();
  const tree = st.tree;
  const node = tree.get(st.cur) || tree.root;
  const [o, setO] = useState({ evals: true, annotations: true, variations: true, clocks: true });
  const [copied, setCopied] = useState(false);
  const pgn = useMemo(() => exportPgn(tree, {
    ...o,
    headers: { Annotator: tree.mainline().some(n => n.review) ? 'Stockfish 19 (SF19 Coach)' : undefined },
    describe: n => {
      if (!n.review || !n.parent || !n.parent.eval) return undefined;
      if (!['inaccuracy', 'mistake', 'miss', 'blunder'].includes(n.review.cls)) return undefined;
      const { items } = explainMove({ review: n.review, mover: moverOf(n), posBefore: posFromFen(n.parent.fen), posAfter: posFromFen(n.fen), bestPv: n.parent.eval.pv || [], afterPv: (n.eval && n.eval.pv) || [], bestSan: n.review.bestSan });
      return `${t(`cls.${n.review.cls}`)}. ${items.map(explanationText).join(' ')}`;
    },
  }), [tree, o, lang.value]);
  const fileName = () => {
    const h = tree.headers;
    const base = [h.White, h.Black].filter(Boolean).join('-vs-') || 'analysis';
    return `${base.replace(/[^\p{L}\p{N}_-]+/gu, '_')}-${new Date().toISOString().slice(0, 10)}.pgn`;
  };
  return (
    <Modal title={t('io.exportTitle')} onClose={onClose} icon="download" wide
      footer={<>
        <Btn icon={copied ? 'check' : 'copy'} label={copied ? t('io.copied') : t('io.copy')} onClick={() => copyText(pgn).then(ok => { if (ok !== false) { setCopied(true); setTimeout(() => setCopied(false), 1500); } })} />
        <Btn variant="primary" icon="download" label={t('io.download')} onClick={() => downloadText(fileName(), pgn)} />
      </>}>
      <div class="export-opts">
        <Toggle checked={o.evals} onChange={v => setO({ ...o, evals: v })} label={t('io.evals')} />
        <Toggle checked={o.annotations} onChange={v => setO({ ...o, annotations: v })} label={t('io.annotations')} />
        <Toggle checked={o.variations} onChange={v => setO({ ...o, variations: v })} label={t('io.variations')} />
        <Toggle checked={o.clocks} onChange={v => setO({ ...o, clocks: v })} label={t('io.clocks')} />
      </div>
      <textarea class="input textarea mono" rows={10} readOnly value={pgn} aria-label="PGN" />
      <Field label={t('io.fen')}>
        <div class="fen-row">
          <input class="input mono" readOnly value={node.fen} aria-label="FEN" onFocus={e => e.currentTarget.select()} />
          <Btn icon="copy" onClick={() => copyText(node.fen).then(() => toast(t('an.fenCopied'), { type: 'success', timeout: 1500 }))} title={t('io.copy')} />
          <a class="btn btn-default" href={`https://lichess.org/analysis/standard/${node.fen.replace(/ /g, '_')}`} target="_blank" rel="noopener noreferrer" title={t('io.lichess')}><Icon name="share-2" size={18} /></a>
        </div>
      </Field>
    </Modal>
  );
}

// ---------------------------------------------------------------- Help
function HelpDialog({ onClose }) {
  const classes = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];
  return (
    <Modal title={t('help.title')} onClose={onClose} icon="circle-help" wide footer={<Btn variant="primary" label={t('c.close')} onClick={onClose} />}>
      <div class="help-grid">
        <section>
          <h3><Icon name="keyboard" size={16} /> {t('help.keys')}</h3>
          <ul class="help-keys">
            <li><Kbd>←</Kbd> <Kbd>→</Kbd> <Kbd>Home</Kbd> <Kbd>End</Kbd> <Kbd>↑</Kbd> <Kbd>↓</Kbd><span>{t('help.k.nav')}</span></li>
            <li><Kbd>F</Kbd><span>{t('help.k.flip')}</span></li>
            <li><Kbd>H</Kbd> <Kbd>T</Kbd> <Kbd>U</Kbd><span>{t('help.k.hint')}</span></li>
            <li><Kbd>Space</Kbd> <Kbd>X</Kbd><span>{t('help.k.engine')}</span></li>
            <li><Kbd>N</Kbd> <Kbd>Esc</Kbd><span>{t('help.k.new')}</span></li>
          </ul>
        </section>
        <section>
          <h3><Icon name="star" size={16} /> {t('help.classes')}</h3>
          <div class="legend">
            {classes.map(c => <span class="legend-item"><ClassIcon cls={c} size={20} /> {t(`cls.${c}`)}</span>)}
          </div>
          <p class="muted">{t('help.classesText')}</p>
        </section>
        <section class="span-2">
          <h3><Icon name="info" size={16} /> {t('help.about')}</h3>
          <p>{t('help.aboutText')}</p>
          <p class="muted">{t('help.source')}</p>
        </section>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Welcome (first run)
function WelcomeDialog({ onClose }) {
  const s = settings.value;
  const [variant, setVariant] = useState(s.variant || 'full');
  const go = () => {
    updateSettings({ welcomed: true, variant });
    onClose();
    hooks.restartEngine();
  };
  return (
    <Modal title={t('wel.title')} onClose={null} icon="graduation-cap" class="modal-welcome" closeOnBackdrop={false}
      footer={<Btn variant="primary" icon="arrow-right" label={t('wel.start')} onClick={go} class="btn-lg" />}>
      <div class="welcome-lang">
        <Segmented value={s.lang} onChange={v => updateSettings({ lang: v })} options={[{ value: 'el', label: 'Ελληνικά' }, { value: 'en', label: 'English' }]} />
      </div>
      <p class="welcome-text">{t('wel.text')}</p>
      <Field label={t('wel.engine')}>
        <div class="mode-cards">
          <button type="button" class={`mode-card${variant === 'full' ? ' on' : ''}`} onClick={() => setVariant('full')}>
            <Icon name="cpu" size={22} /><strong>{t('wel.full')}</strong><span>{t('wel.fullDesc')}</span>
          </button>
          <button type="button" class={`mode-card${variant === 'lite' ? ' on' : ''}`} onClick={() => setVariant('lite')}>
            <Icon name="zap" size={22} /><strong>{t('wel.lite')}</strong><span>{t('wel.liteDesc')}</span>
          </button>
        </div>
      </Field>
      <p class="muted small"><Icon name="wifi-off" size={14} /> {t('engine.firstLoad')}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------- Board editor
const EDITOR_PIECES = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];

function EditorDialog({ onClose, fen: initialFen }) {
  const init = setupPosition(initialFen || START_FEN);
  const parts = (init.fen || START_FEN).split(' ');
  const [board, setBoard] = useState(parts[0]);
  const [turn, setTurn] = useState(parts[1] === 'b' ? 'black' : 'white');
  const [castle, setCastle] = useState({ K: parts[2].includes('K'), Q: parts[2].includes('Q'), k: parts[2].includes('k'), q: parts[2].includes('q') });
  const [spare, setSpare] = useState(null); // { role, color } | 'trash' | null
  const [orientation, setOrientation] = useState('white');
  const hostRef = useRef();
  const cgRef = useRef();
  const spareRef = useRef(spare);
  spareRef.current = spare;

  useEffect(() => {
    const cg = Chessground(hostRef.current, {
      fen: board, orientation, coordinates: true, autoCastle: false,
      movable: { free: true, color: 'both', showDests: false },
      premovable: { enabled: false }, draggable: { deleteOnDropOff: true, showGhost: true },
      drawable: { enabled: false }, animation: { enabled: false },
      events: {
        change: () => setBoard(cg.getFen()),
        select: key => {
          const sp = spareRef.current;
          if (!sp) return;
          if (sp === 'trash') cg.setPieces(new Map([[key, undefined]]));
          else cg.setPieces(new Map([[key, { role: sp.role, color: sp.color }]]));
          cg.selectSquare(null);
          setBoard(cg.getFen());
        },
      },
    });
    cgRef.current = cg;
    return () => cg.destroy();
  }, []);
  useEffect(() => { cgRef.current && cgRef.current.set({ orientation }); }, [orientation]);

  const castling = ['K', 'Q', 'k', 'q'].filter(k => castle[k]).join('') || '-';
  const rawFen = `${board} ${turn === 'white' ? 'w' : 'b'} ${castling} - 0 1`;
  const check = setupPosition(rawFen);
  const setPos = f => {
    const p = f.split(' ');
    cgRef.current.set({ fen: p[0] });
    setBoard(p[0]);
    if (p[1]) setTurn(p[1] === 'b' ? 'black' : 'white');
    if (p[2]) setCastle({ K: p[2].includes('K'), Q: p[2].includes('Q'), k: p[2].includes('k'), q: p[2].includes('q') });
  };
  const sparePiece = (color, role) => (
    <button type="button" class={`spare${spare && spare.role === role && spare.color === color ? ' on' : ''}`}
      onMouseDown={e => { if (e.button !== 0) return; setSpare({ role, color }); cgRef.current.dragNewPiece({ role, color }, e); }}
      onTouchStart={e => { setSpare({ role, color }); cgRef.current.dragNewPiece({ role, color }, e); }}
      onClick={() => setSpare({ role, color })} aria-label={`${color} ${role}`}>
      <i class={`pc pc-${role}-${color}`} />
    </button>
  );
  const apply = target => {
    if (check.error) return;
    onClose();
    if (target === 'play') openDialog('newGame', { startFen: check.fen });
    else hooks.loadIntoAnalysis(new GameTree(check.fen), { source: 'new', orientation: check.pos.turn });
  };
  return (
    <Modal title={t('an.editor')} onClose={onClose} icon="square-pen" wide class="modal-editor"
      footer={<>
        <Btn label={t('c.cancel')} onClick={onClose} />
        <Btn icon="swords" label={t('an.playFromHere')} onClick={() => apply('play')} disabled={!!check.error} />
        <Btn variant="primary" icon="microscope" label={t('mode.analysis')} onClick={() => apply('analysis')} disabled={!!check.error} />
      </>}>
      <div class="editor">
        <div class="editor-board">
          <div class="spares">{EDITOR_PIECES.map(r => sparePiece(orientation === 'white' ? 'black' : 'white', r))}</div>
          <div class={`board-wrap board-theme-${settings.value.boardTheme}`} style={{ '--board-image': boardImage(settings.value.boardTheme) }}>
            <div class="board-host" ref={hostRef} />
          </div>
          <div class="spares">{EDITOR_PIECES.map(r => sparePiece(orientation, r))}
            <button type="button" class={`spare trash${spare === 'trash' ? ' on' : ''}`} onClick={() => setSpare(spare === 'trash' ? null : 'trash')} aria-label="trash"><Icon name="eraser" size={20} /></button>
            <button type="button" class={`spare${!spare ? ' on' : ''}`} onClick={() => setSpare(null)} aria-label="move"><Icon name="hand" size={20} /></button>
          </div>
        </div>
        <div class="editor-side">
          <Field label={t('ed.toMove')}>
            <Segmented value={turn} onChange={setTurn} options={[{ value: 'white', label: t('color.white') }, { value: 'black', label: t('color.black') }]} />
          </Field>
          <Field label={t('ed.castling')}>
            <div class="castle-grid">
              {[['K', 'O-O'], ['Q', 'O-O-O'], ['k', 'O-O'], ['q', 'O-O-O']].map(([k, label]) => (
                <label class="check"><input type="checkbox" checked={castle[k]} onChange={e => setCastle({ ...castle, [k]: e.currentTarget.checked })} /> {k === k.toUpperCase() ? t('color.white') : t('color.black')} {label}</label>
              ))}
            </div>
          </Field>
          <div class="btn-row wrap">
            <Btn small icon="refresh-cw" label={t('ng.standard')} onClick={() => setPos(START_FEN)} />
            <Btn small icon="eraser" label={t('ed.clear')} onClick={() => setPos('8/8/8/8/8/8/8/8 w - - 0 1')} />
            <Btn small icon="arrow-up-down" label={t('ed.flip')} onClick={() => setOrientation(o => (o === 'white' ? 'black' : 'white'))} />
          </div>
          <Field label="FEN">
            <input class={`input mono${check.error ? ' invalid' : ''}`} value={check.error ? rawFen : check.fen} spellcheck={false}
              onChange={e => { const r = setupPosition(e.currentTarget.value); if (!r.error) setPos(r.fen); }} aria-label="FEN" />
            {check.error && <div class="error-text">{t('ng.fenInvalid')} ({check.error})</div>}
          </Field>
        </div>
      </div>
    </Modal>
  );
}
