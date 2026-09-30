import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n.js';
import { formatScore, winPct, isMate } from '../chess/score.js';
import { pvToSan } from '../chess/util.js';
import { Icon, IconBtn, Btn, Spinner, Progress, ClassIcon, San, Segmented } from './common.jsx';
import { PvLine } from './Pv.jsx';
import { engineManager } from '../engine/manager.js';
import { CLASSES } from '../analysis/classify.js';

// ---------------------------------------------------------------- engine lines
export function formatNps(nps) {
  if (!nps) return '';
  if (nps >= 1e6) return `${(nps / 1e6).toFixed(1)} M`;
  if (nps >= 1e3) return `${Math.round(nps / 1e3)} k`;
  return String(nps);
}

export function WdlBar({ wdl }) {
  if (!wdl) return null;
  const [w, d, l] = wdl.map(x => x / 10);
  return (
    <div class="wdl-row" title={`${t('engine.wdl')} (Stockfish 19): ${w.toFixed(0)}% / ${d.toFixed(0)}% / ${l.toFixed(0)}%`}>
      <div class="wdl">
        <span class="wdl-w" style={{ width: `${w}%` }} />
        <span class="wdl-d" style={{ width: `${d}%` }} />
        <span class="wdl-l" style={{ width: `${l}%` }} />
      </div>
      <span class="wdl-text"><b>{w.toFixed(0)}</b> · {d.toFixed(0)} · <b>{l.toFixed(0)}</b> %</span>
    </div>
  );
}

export function EngineLines({ live, on, onToggle, multiPv, onMultiPv, onPlay, orientation, threat, node }) {
  const st = engineManager.state.value;
  const lines = live && live.nodeId === (node && node.id) ? live.lines : [];
  const depth = live && live.nodeId === (node && node.id) ? live.depth : 0;
  const loading = st.status === 'loading';
  const fen = live ? live.fen : node && node.fen;
  return (
    <div class={`engine-box${on ? '' : ' off'}`}>
      <div class="engine-head">
        <label class="switch small" title={on ? t('engine.off') : t('engine.turnOn')}>
          <input type="checkbox" checked={on} onChange={onToggle} />
          <span class="slider" />
        </label>
        <span class="engine-title">
          <strong>Stockfish 19</strong>
          {st.build && <span class="engine-build">{st.build.variant === 'lite' ? t('engine.lite') : 'NNUE'} · {st.threads > 1 ? t('engine.threads', { n: st.threads }) : t('engine.thread1')}</span>}
        </span>
        <span class="engine-stats">
          {on && loading && <span class="muted">{t('engine.loading')}</span>}
          {on && !loading && depth > 0 && <span title={t('engine.depth')}>{t('engine.depth')} {depth}</span>}
          {on && live && live.nps > 0 && live.nodeId === node.id && <span class="muted">{formatNps(live.nps)}{t('engine.npsShort')}</span>}
        </span>
        <select class="select select-sm" value={multiPv} onChange={e => onMultiPv(+e.currentTarget.value)} title={t('engine.lines')} aria-label={t('engine.lines')}>
          {[1, 2, 3, 4, 5].map(n => <option value={n}>{n}</option>)}
        </select>
      </div>
      {on && threat && <div class="engine-threat"><Icon name="crosshair" size={14} /> {t('an.threatOn')}</div>}
      {on && (
        <div class="pv-list">
          {live && live.gameOver && <div class="pv-empty">{t('engine.gameOver')}</div>}
          {live && live.inCheck && <div class="pv-empty">{t('play.threatInCheck')}</div>}
          {!(live && (live.gameOver || live.inCheck)) && Array.from({ length: multiPv }).map((_, i) => {
            const l = lines[i];
            if (!l) return <div class="pv-row skeleton"><span class="pv-eval">{i === 0 && <Spinner size={12} />}</span><span class="pv-moves" /></div>;
            const moves = pvToSan(fen, l.pv, 16);
            return (
              <div class="pv-row">
                <span class={`pv-eval ${evalClass(l.score)}`}>{formatScore(l.score)}</span>
                <PvLine moves={moves} orientation={orientation} onMove={threat ? undefined : (idx) => onPlay && onPlay(l.pv.slice(0, idx + 1))} />
              </div>
            );
          })}
          {lines[0] && lines[0].wdl && !threat && <WdlBar wdl={lines[0].wdl} />}
        </div>
      )}
    </div>
  );
}

function evalClass(score) {
  if (!score) return '';
  if (isMate(score)) return score.mate > 0 || score.mated === 'black' ? 'adv-white' : 'adv-black';
  if (score.cp > 30) return 'adv-white';
  if (score.cp < -30) return 'adv-black';
  return 'adv-even';
}

// ---------------------------------------------------------------- coach
export function explanationText(item) {
  const p = { ...(item.params || {}) };
  if (p.what) p.what = t(`what.${p.what}`, { n: p.n });
  if (item.key === 'ex.hangs') return t(`ex.hangs.${p.role}`, p);
  return t(item.key, p);
}

export function CoachCard({ feedback, node, paused, canRetry, onRetry, onContinue, showBest, onToggleBest, orientation, compact, linesOpen: linesDefault = true, slim, expanded, onExpand }) {
  const [open, setOpen] = useState(linesDefault);
  if (!feedback) return null;
  if (feedback.pending) {
    return <div class="coach-card pending"><Spinner size={16} /> <span>{t('play.coaching')}</span></div>;
  }
  const r = feedback.review;
  const cls = r.cls;
  const isError = ['inaccuracy', 'mistake', 'miss', 'blunder'].includes(cls);
  const moveNo = node ? `${Math.ceil(node.ply / 2)}${node.ply % 2 ? '.' : '…'}` : '';
  if (slim && !expanded) {
    return (
      <button type="button" class={`verdict-bar c-${cls}`} onClick={onExpand} title={t('coach.more')}>
        <ClassIcon cls={cls} size={20} />
        <span class="vb-label">{t(`cls.${cls}`)}</span>
        <span class="vb-move">{moveNo} {node && <San san={node.san} />}</span>
        {isError && r.bestSan && <span class="vb-best"><Icon name="arrow-right" size={12} /> <San san={r.bestSan} /></span>}
        <span class="vb-eval">{formatScore(r.bestScore)} → {formatScore(r.afterScore)}</span>
        <Icon name="chevron-down" size={16} />
      </button>
    );
  }
  return (
    <div class={`coach-card c-${cls}${paused ? ' paused' : ''}`}>
      {slim && <button type="button" class="coach-collapse icon-btn" onClick={onExpand} title={t('c.close')}><Icon name="chevron-up" size={16} /></button>}
      <div class="coach-head">
        <ClassIcon cls={cls} size={26} />
        <div class="coach-title">
          <div class="coach-label">{t(`cls.${cls}`)}{r.book && cls !== 'book' ? <span class="chip chip-book"><Icon name="book-open" size={12} /> {t('cls.book')}</span> : null}</div>
          <div class="coach-move">{moveNo} {node && <San san={node.san} />}</div>
        </div>
        <div class="coach-eval" title={t('coach.evalChange')}>
          <span>{formatScore(r.bestScore)}</span>
          <Icon name="arrow-right" size={14} />
          <span class={isError ? 'eval-drop' : ''}>{formatScore(r.afterScore)}</span>
        </div>
      </div>
      <ul class="coach-items">
        {feedback.items.map(it => <li>{explanationText(it)}</li>)}
      </ul>
      {!compact && open && isError && feedback.bestLine && feedback.bestLine.length > 0 && (
        <div class="coach-line"><span class="coach-line-label">{t('coach.bestLine')}</span><PvLine moves={feedback.bestLine} max={10} orientation={orientation} /></div>
      )}
      {!compact && open && isError && feedback.refLine && feedback.refLine.length > 0 && (
        <div class="coach-line"><span class="coach-line-label">{t('coach.refutation')}</span><PvLine moves={feedback.refLine} max={10} orientation={orientation} /></div>
      )}
      {!compact && (
        <div class="coach-actions">
          {isError && (feedback.bestLine || []).length > 0 && (
            <Btn small icon={open ? 'chevron-up' : 'chevron-down'} label={t('coach.lines')} onClick={() => setOpen(o => !o)} variant="ghost" />
          )}
          {isError && onToggleBest && <Btn small icon={showBest ? 'eye-off' : 'eye'} label={t('play.showBest')} onClick={onToggleBest} variant={showBest ? 'active' : 'default'} />}
          {isError && canRetry && <Btn small icon="rotate-ccw" label={t('play.retry')} onClick={onRetry} variant={paused ? 'primary' : 'default'} />}
          {paused && <Btn small icon="play" label={t('play.continue')} onClick={onContinue} />}
        </div>
      )}
      {paused && <div class="coach-paused-note"><Icon name="pause" size={14} /> {t('play.paused')}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- eval graph
export function EvalGraph({ nodes, curId, onSelect, height = 96 }) {
  const ref = useRef();
  const [width, setWidth] = useState(300);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(120, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(120, el.clientWidth));
    return () => ro.disconnect();
  }, []);
  const n = nodes.length;
  if (n < 2) return <div class="eval-graph" ref={ref} />;
  const H = height, W = width;
  const xs = i => (i / (n - 1)) * (W - 2) + 1;
  const pts = nodes.map((node, i) => {
    const s = node.eval && node.eval.score;
    const wp = s ? winPct(s) : null;
    return { x: xs(i), y: wp === null ? null : (1 - wp / 100) * (H - 4) + 2, node, i };
  });
  // fill forward gaps with previous value to keep the path continuous
  let last = H / 2;
  for (const p of pts) { if (p.y === null) p.y = last; else last = p.y; }
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[n - 1].x.toFixed(1)},${H} L${pts[0].x.toFixed(1)},${H} Z`;
  const curIdx = pts.findIndex(p => p.node.id === curId);
  const markers = pts.filter(p => p.node.review && ['inaccuracy', 'mistake', 'miss', 'blunder', 'brilliant', 'great'].includes(p.node.review.cls));
  const pick = e => {
    const r = ref.current.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    return Math.max(0, Math.min(n - 1, Math.round(((x - 1) / (W - 2)) * (n - 1))));
  };
  const hp = hover !== null ? pts[hover] : null;
  return (
    <div class="eval-graph" ref={ref} style={{ height: `${H}px` }}
      onMouseMove={e => setHover(pick(e))} onMouseLeave={() => setHover(null)}
      onClick={e => onSelect && onSelect(pts[pick(e)].node)} role="img" aria-label={t('rv.graph')}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <rect x="0" y="0" width={W} height={H} class="eg-bg" />
        <path d={area} class="eg-area" />
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} class="eg-mid" />
        <path d={line} class="eg-line" />
        {curIdx >= 0 && <line x1={pts[curIdx].x} x2={pts[curIdx].x} y1="0" y2={H} class="eg-cur" />}
        {hp && <line x1={hp.x} x2={hp.x} y1="0" y2={H} class="eg-hover" />}
        {markers.map(p => <circle cx={p.x} cy={p.y} r="3.6" class={`eg-dot c-${p.node.review.cls}`} />)}
      </svg>
      {hp && hp.node.parent && (
        <div class="eg-tip" style={{ left: `${Math.min(W - 110, Math.max(0, hp.x - 55))}px` }}>
          {Math.ceil(hp.node.ply / 2)}{hp.node.ply % 2 ? '.' : '…'} <San san={hp.node.san} /> <b>{hp.node.eval ? formatScore(hp.node.eval.score) : ''}</b>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- review summary
const SUMMARY_CLASSES = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];

export function accuracyColor(a) {
  if (a === null || a === undefined) return '';
  if (a >= 90) return 'acc-great';
  if (a >= 80) return 'acc-good';
  if (a >= 65) return 'acc-ok';
  return 'acc-bad';
}

export function ReviewPanel({ state, headers, nodes, curId, onSelect, onStart, onCancel, onPractice, onJump, onJumpClass, userColor, preset, onPreset }) {
  const rv = state;
  const [side, setSide] = useState(userColor || 'white');
  useEffect(() => { if (userColor) setSide(userColor); }, [userColor]);
  if (rv.status === 'idle' || rv.status === 'error') {
    return (
      <div class="review-box">
        <div class="review-cta">
          <div class="review-cta-text">
            <strong>{t('rv.title')}</strong>
            <span class="muted">{t('rv.preset')}</span>
          </div>
          <Segmented value={preset} onChange={onPreset} options={[
            { value: 'fast', label: t('rv.fast') }, { value: 'standard', label: t('rv.standard') }, { value: 'deep', label: t('rv.deep') },
          ]} />
          <Btn variant="primary" icon="scan-search" label={t('rv.run')} onClick={onStart} disabled={nodes.length < 2} />
        </div>
        {rv.status === 'error' && <div class="error-text">{rv.error}</div>}
      </div>
    );
  }
  if (rv.status === 'running') {
    return (
      <div class="review-box">
        <div class="review-running">
          <Spinner size={16} />
          <span>{t('rv.running', { i: rv.done, n: rv.total })}</span>
          <Btn small label={t('rv.cancel')} onClick={onCancel} />
        </div>
        <Progress value={rv.total ? rv.done / rv.total : 0} />
        <EvalGraph nodes={nodes} curId={curId} onSelect={onSelect} height={72} />
      </div>
    );
  }
  const sum = rv.summary;
  if (!sum) return null;
  const nm = c => headers[c === 'white' ? 'White' : 'Black'] || t(`color.${c}`);
  const mistakes = c => (sum[c].counts.mistake || 0) + (sum[c].counts.blunder || 0) + (sum[c].counts.miss || 0);
  const shownClasses = SUMMARY_CLASSES.filter(c => (sum.white.counts[c] || 0) + (sum.black.counts[c] || 0) > 0 || ['best', 'inaccuracy', 'mistake', 'blunder'].includes(c));
  return (
    <div class="review-box done">
      <div class="acc-cards">
        {['white', 'black'].map(c => (
          <div class={`acc-card ${c}${userColor === c ? ' mine' : ''}`} title={`${t('rv.accuracy')} · ${t('rv.acpl')}: ${sum[c].acpl}`}>
            <span class="acc-name"><span class={`dot ${c}`} />{nm(c)}</span>
            <span class={`acc-value ${accuracyColor(sum[c].accuracy)}`}>{sum[c].accuracy === null ? '–' : sum[c].accuracy.toFixed(1)}<small>%</small></span>
            <span class="acc-sub">{sum[c].acpl} ACPL</span>
          </div>
        ))}
      </div>
      <EvalGraph nodes={nodes} curId={curId} onSelect={onSelect} height={70} />
      <div class="cls-grid" style={{ gridTemplateColumns: `auto repeat(${shownClasses.length}, 1fr)` }}>
        <span />
        {shownClasses.map(c => <span class="cls-head"><ClassIcon cls={c} size={17} /></span>)}
        {['white', 'black'].map(side => (
          <>
            <span class="cls-side"><span class={`dot ${side}`} /></span>
            {shownClasses.map(c => {
              const n = sum[side].counts[c] || 0;
              return (
                <button type="button" class={`cls-n${n ? '' : ' zero'}`} disabled={!n} title={`${t(`cls.${c}`)}: ${n}`}
                  onClick={() => onJumpClass && onJumpClass(side, c)}>{n}</button>
              );
            })}
          </>
        ))}
      </div>
      <div class="review-actions">
        <Segmented class="seg-sm" value={side} onChange={setSide} options={[
          { value: 'white', label: t('color.white') }, { value: 'black', label: t('color.black') },
        ]} />
        <IconBtn icon="chevron-left" title={t('rv.prevMistake')} onClick={() => onJump(-1, side)} disabled={!mistakes(side)} />
        <IconBtn icon="chevron-right" title={t('rv.nextMistake')} onClick={() => onJump(1, side)} disabled={!mistakes(side)} />
        <Btn small variant="primary" icon="target" label={t('rv.practice', { n: mistakes(side) })} onClick={() => onPractice(side)} disabled={!mistakes(side)} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- trainer
export function TrainerPanel({ trainer, item, onReveal, onNext, onEnd, onRestart, orientation }) {
  const tr = trainer;
  const color = item ? (item.ply % 2 ? 'white' : 'black') : 'white';
  const bestLine = item && item.parent.eval ? pvToSan(item.parent.fen, item.parent.eval.pv || [], 8) : [];
  if (tr.state === 'finished') {
    return (
      <div class="trainer-box finished">
        <Icon name="trophy" size={34} />
        <h3>{t('tr.summary', { solved: tr.solved, n: tr.items.length })}</h3>
        <div class="trainer-dots">{tr.items.map((_, i) => <span class={`tdot ${tr.results[i] || ''}`} />)}</div>
        <div class="trainer-actions">
          <Btn icon="rotate-ccw" label={t('tr.again')} onClick={onRestart} />
          <Btn variant="primary" label={t('tr.finish')} onClick={onEnd} />
        </div>
      </div>
    );
  }
  const msg = tr.message;
  return (
    <div class={`trainer-box state-${tr.state}`}>
      <div class="trainer-head">
        <Icon name="target" size={18} />
        <strong>{t('tr.title')}</strong>
        <span class="muted">{t('tr.progress', { i: tr.index + 1, n: tr.items.length })}</span>
        <IconBtn icon="x" title={t('tr.finish')} onClick={onEnd} class="ml-auto" />
      </div>
      <div class="trainer-dots">{tr.items.map((_, i) => <span class={`tdot ${tr.results[i] || ''}${i === tr.index ? ' cur' : ''}`} />)}</div>
      <div class="trainer-prompt">
        <span class={`dot ${color}`} /> {t('tr.find', { color: t(`color.${color}`) })}
      </div>
      {item && (
        <div class="trainer-played">
          {t('tr.played', { move: '' })} <span class={`mv-inline c-${item.review.cls}`}>{Math.ceil(item.ply / 2)}{item.ply % 2 ? '.' : '…'} <San san={item.san} /> <ClassIcon cls={item.review.cls} size={16} /></span>
        </div>
      )}
      {tr.state === 'checking' && <div class="trainer-msg"><Spinner size={14} /> {t('tr.checking')}</div>}
      {tr.state === 'wrong' && msg && <div class="trainer-msg bad"><Icon name="circle-x" size={16} /> {t('tr.wrong', { score: formatScore(msg.score) })}</div>}
      {(tr.state === 'solved' || tr.state === 'revealed') && item && (
        <div class={`trainer-msg ${tr.state === 'solved' ? 'good' : ''}`}>
          <Icon name={tr.state === 'solved' ? 'circle-check' : 'lightbulb'} size={16} />
          <span>{tr.state === 'solved' ? t(msg.key, { move: item.review.bestSan }) : `${t('tr.solution')}: ${item.review.bestSan}`}</span>
        </div>
      )}
      {(tr.state === 'solved' || tr.state === 'revealed') && bestLine.length > 0 && (
        <div class="coach-line"><span class="coach-line-label">{t('coach.bestLine')}</span><PvLine moves={bestLine} max={8} orientation={orientation} /></div>
      )}
      <div class="trainer-actions">
        {(tr.state === 'solving' || tr.state === 'wrong') && <Btn icon="lightbulb" label={t('tr.solution')} onClick={onReveal} />}
        {(tr.state === 'solving' || tr.state === 'wrong') && <Btn icon="skip-forward" label={t('tr.skip')} onClick={onNext} />}
        {(tr.state === 'solved' || tr.state === 'revealed') && <Btn variant="primary" iconRight="chevron-right" label={t('tr.next')} onClick={onNext} />}
      </div>
    </div>
  );
}

export { CLASSES };
