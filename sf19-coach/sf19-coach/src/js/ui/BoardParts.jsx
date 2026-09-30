import { h } from 'preact';
import { barFraction, formatShort, formatScore } from '../chess/score.js';
import { Icon, formatClock } from './common.jsx';
import { t } from '../i18n.js';

export function EvalBar({ score, orientation = 'white', hidden, thinking }) {
  if (hidden) return <div class="evalbar evalbar-hidden" aria-hidden="true" />;
  const frac = barFraction(score);
  const whiteBottom = orientation === 'white';
  const whiteAhead = frac >= 0.5;
  const label = score ? formatShort(score) : '';
  return (
    <div class={`evalbar${whiteBottom ? '' : ' flipped'}${thinking ? ' thinking' : ''}`} title={score ? formatScore(score) : ''}
      role="meter" aria-label={t('coach.evalChange')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(frac * 100)}>
      <div class="evalbar-fill" style={{ height: `${frac * 100}%` }} />
      <div class="evalbar-mid" />
      {label && <span class={`evalbar-label ${whiteAhead ? 'white-side' : 'black-side'}`}>{label}</span>}
    </div>
  );
}

const ROLE_ORDER = ['queen', 'rook', 'bishop', 'knight', 'pawn'];

/** Captured pieces for one side: `pieces` = roles this side is up (shown as the opponent's pieces). */
export function Material({ pieces, color, diff }) {
  const items = [];
  for (const role of ROLE_ORDER) {
    const n = (pieces && pieces[role]) || 0;
    if (!n) continue;
    const group = [];
    for (let i = 0; i < n; i++) group.push(<i class={`pc pc-${role}-${color === 'white' ? 'black' : 'white'}`} />);
    items.push(<span class="mat-group">{group}</span>);
  }
  return (
    <span class="material">
      {items}
      {diff > 0 && <span class="mat-diff">+{diff}</span>}
    </span>
  );
}

export function PlayerBar({ name, sub, color, isEngine, clock, clockRunning, lowTime, material, toMove, result, thinking }) {
  return (
    <div class={`player-bar${toMove ? ' to-move' : ''}`}>
      <span class={`player-avatar ${color}`} aria-hidden="true"><Icon name={isEngine ? 'cpu' : 'user'} size={18} /></span>
      <span class="player-id">
        <span class="player-name">{name}{thinking && <span class="thinking-dots" aria-label={t('engine.thinking')}><i /><i /><i /></span>}</span>
        {sub && <span class="player-sub">{sub}</span>}
      </span>
      {material}
      <span class="player-spacer" />
      {result && <span class="player-result">{result}</span>}
      {clock !== undefined && clock !== null && (
        <span class={`clock${clockRunning ? ' running' : ''}${lowTime ? ' low' : ''}`} role="timer">{formatClock(clock)}</span>
      )}
    </div>
  );
}
