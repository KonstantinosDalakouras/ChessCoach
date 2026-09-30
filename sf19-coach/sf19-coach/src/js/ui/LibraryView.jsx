import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { t, lang } from '../i18n.js';
import { libraryList, libraryReady, deleteGame, refreshLibrary } from '../library.js';
import { Btn, IconBtn, Icon, Segmented, confirmDialog } from './common.jsx';
import { accuracyColor } from './Panels.jsx';
import { openLibraryGame } from '../app-actions.js';
import { openDialog, exportAllGames } from './dialogs.jsx';

function outcomeFor(g) {
  if (!g.userColor) return null;
  if (g.result === '1/2-1/2') return 'draw';
  if (g.result === '1-0') return g.userColor === 'white' ? 'win' : 'loss';
  if (g.result === '0-1') return g.userColor === 'black' ? 'win' : 'loss';
  return null;
}

function Sparkline({ values, height = 56 }) {
  const ref = useRef();
  const [w, setW] = useState(300);
  useEffect(() => {
    const ro = new ResizeObserver(() => ref.current && setW(ref.current.clientWidth));
    if (ref.current) { ro.observe(ref.current); setW(ref.current.clientWidth); }
    return () => ro.disconnect();
  }, []);
  const vals = values.filter(v => v !== null && v !== undefined);
  if (vals.length < 2) return <div class="sparkline empty" ref={ref} style={{ height: `${height}px` }}><span class="muted">—</span></div>;
  const min = Math.max(0, Math.min(...vals) - 5), max = Math.min(100, Math.max(...vals) + 5);
  const x = i => 4 + (i / (vals.length - 1)) * (w - 8);
  const y = v => height - 4 - ((v - min) / (max - min || 1)) * (height - 8);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  return (
    <div class="sparkline" ref={ref} style={{ height: `${height}px` }}>
      <svg width={w} height={height}>
        <line x1="0" x2={w} y1={y(avg)} y2={y(avg)} class="spark-avg" />
        <path d={d} class="spark-line" />
        {vals.map((v, i) => <circle cx={x(i)} cy={y(v)} r="2.5" class={`spark-dot ${accuracyColor(v)}`} />)}
      </svg>
    </div>
  );
}

export function LibraryView() {
  const list = libraryList.value;
  const [filter, setFilter] = useState('all');
  useEffect(() => { if (!libraryReady.value) refreshLibrary(); }, []);
  const mine = list.filter(g => g.userColor);
  const outcomes = mine.map(outcomeFor);
  const wins = outcomes.filter(o => o === 'win').length, draws = outcomes.filter(o => o === 'draw').length, losses = outcomes.filter(o => o === 'loss').length;
  const myAcc = g => (g.summary && g.userColor ? g.summary[g.userColor].accuracy : null);
  const accs = [...mine].reverse().map(myAcc).filter(a => a !== null);
  const avg = arr => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
  const reviewedMine = mine.filter(g => g.summary);
  const blunders = reviewedMine.length ? reviewedMine.reduce((s, g) => s + (g.summary[g.userColor].counts.blunder || 0), 0) / reviewedMine.length : null;
  const shown = list.filter(g => filter === 'all' || outcomeFor(g) === filter);
  const fmtDate = iso => { try { return new Date(iso).toLocaleDateString(lang.value === 'el' ? 'el-GR' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return ''; } };

  return (
    <div class="library">
      <div class="library-head">
        <h1>{t('lib.title')}</h1>
        <div class="btn-row">
          <Btn icon="upload" label={t('an.import')} onClick={() => openDialog('import')} />
          <Btn icon="download" label={t('lib.exportAll')} onClick={exportAllGames} disabled={!list.length} />
          <Btn variant="primary" icon="swords" label={t('play.newGame')} onClick={() => openDialog('newGame')} />
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-label">{t('lib.games')}</span>
          <span class="stat-value">{mine.length}</span>
          <span class="stat-sub"><span class="w">{wins}</span> / <span class="d">{draws}</span> / <span class="l">{losses}</span></span>
        </div>
        <div class="stat-card">
          <span class="stat-label">{t('lib.score')}</span>
          <span class="stat-value">{mine.length ? `${Math.round(((wins + draws / 2) / mine.length) * 100)}%` : '–'}</span>
          <span class="stat-sub">{t('lib.wins')} · {t('lib.draws')} · {t('lib.losses')}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">{t('lib.avgAcc')}</span>
          <span class={`stat-value ${accuracyColor(avg(accs))}`}>{avg(accs) === null ? '–' : `${avg(accs).toFixed(1)}%`}</span>
          <span class="stat-sub">{t('lib.last10')}: {avg(accs.slice(-10)) === null ? '–' : `${avg(accs.slice(-10)).toFixed(1)}%`}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">{t('lib.blundersPerGame')}</span>
          <span class="stat-value">{blunders === null ? '–' : blunders.toFixed(1)}</span>
          <span class="stat-sub">{t('lib.reviewedN', { n: reviewedMine.length })}</span>
        </div>
        <div class="stat-card wide">
          <span class="stat-label">{t('lib.trend')}</span>
          <Sparkline values={accs.slice(-30)} />
        </div>
      </div>

      <div class="library-filter">
        <Segmented value={filter} onChange={setFilter} options={[
          { value: 'all', label: t('lib.all') }, { value: 'win', label: t('lib.wins') }, { value: 'draw', label: t('lib.draws') }, { value: 'loss', label: t('lib.losses') },
        ]} />
      </div>

      {!list.length && libraryReady.value && (
        <div class="empty-state"><Icon name="library" size={40} /><p>{t('lib.empty')}</p></div>
      )}

      <div class="game-list" role="list">
        {shown.map(g => {
          const o = outcomeFor(g);
          const acc = myAcc(g);
          const opp = g.userColor ? `${g.userColor === 'white' ? g.black : g.white}${g.source === 'play' ? ` · ${g.elo ? g.elo : 'max'}` : ''}` : null;
          return (
            <div class={`game-row ${o || ''}`} role="listitem" key={g.id}>
              <button type="button" class="game-open" onClick={() => openLibraryGame(g.id)} title={t('lib.open')}>
                <span class={`res-badge ${o || 'none'}`}>{o === 'win' ? '1' : o === 'loss' ? '0' : o === 'draw' ? '½' : g.result}</span>
                <span class="game-main">
                  <span class="game-players">
                    {g.userColor ? <><span class={`dot ${g.userColor}`} /> {t('lib.vs')} <strong>{opp}</strong></> : <><strong>{g.white}</strong> – <strong>{g.black}</strong> <span class="chip">{t('lib.imported')}</span></>}
                  </span>
                  <span class="game-meta muted">
                    {fmtDate(g.date)} · {g.result}{g.tc ? ` · ${g.tc}` : ''} · {t('lib.moves', { n: Math.ceil((g.plies || 0) / 2) })}
                    {g.opening ? <> · <span class="eco">{g.opening.eco}</span> {g.opening.name}</> : null}
                  </span>
                </span>
                <span class={`game-acc ${accuracyColor(acc)}`}>
                  {acc !== null && acc !== undefined ? `${acc.toFixed(1)}%` : g.summary ? `${(g.summary.white.accuracy ?? 0).toFixed(0)} / ${(g.summary.black.accuracy ?? 0).toFixed(0)}` : <span class="muted small">{t('lib.notReviewed')}</span>}
                </span>
              </button>
              <IconBtn icon="trash" title={t('lib.delete')} onClick={async () => { if (await confirmDialog(t('lib.deleteConfirm'), { danger: true, okLabel: t('lib.delete') })) deleteGame(g.id); }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
