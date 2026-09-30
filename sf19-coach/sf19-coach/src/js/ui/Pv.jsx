import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Chessground } from '@lichess-org/chessground';
import { San } from './common.jsx';
import { settings } from '../store.js';
import { boardImage } from './Board.jsx';

/** Hover preview state: { fen, lastMove, orientation, x, y } */
export const preview = signal(null);
const canHover = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: hover)').matches;

export function showPreview(e, fen, uci, orientation) {
  if (!canHover) return;
  const r = e.currentTarget.getBoundingClientRect();
  preview.value = { fen, lastMove: uci ? [uci.slice(0, 2), uci.slice(2, 4)] : undefined, orientation, x: r.left + r.width / 2, y: r.top, bottom: r.bottom };
}
export const hidePreview = () => { preview.value = null; };

export function MiniBoard() {
  const p = preview.value;
  const ref = useRef();
  const cg = useRef();
  useEffect(() => {
    if (!p || !ref.current) return;
    if (!cg.current) {
      cg.current = Chessground(ref.current, { viewOnly: true, coordinates: false, animation: { enabled: false }, drawable: { enabled: false, visible: false } });
    }
    cg.current.set({ fen: p.fen, lastMove: p.lastMove, orientation: p.orientation || 'white' });
  }, [p && p.fen, p && p.orientation]);
  useEffect(() => () => { if (cg.current) { cg.current.destroy(); cg.current = null; } }, [!!p]);
  if (!p) return null;
  const size = 200;
  const left = Math.max(8, Math.min(window.innerWidth - size - 8, p.x - size / 2));
  const above = p.y - size - 10 > 8;
  const top = above ? p.y - size - 10 : p.bottom + 10;
  return (
    <div class={`mini-board board-wrap board-theme-${settings.value.boardTheme}`} style={{ left: `${left}px`, top: `${top}px`, width: `${size}px`, height: `${size}px`, '--board-image': boardImage(settings.value.boardTheme) }} aria-hidden="true">
      <div class="board-host" ref={ref} />
    </div>
  );
}

/**
 * A principal variation rendered as clickable SAN moves with move numbers.
 * moves: [{san, uci, fen, color, fullmove}] (from pvToSan)
 */
export function PvLine({ moves, max = 14, onMove, orientation, class: cls = '' }) {
  if (!moves || !moves.length) return <span class={`pv-moves ${cls}`}>…</span>;
  const shown = moves.slice(0, max);
  return (
    <span class={`pv-moves ${cls}`}>
      {shown.map((m, i) => (
        <span class="pv-move" role={onMove ? 'button' : undefined}
          onMouseEnter={e => showPreview(e, m.fen, m.uci, orientation)} onMouseLeave={hidePreview}
          onClick={onMove ? () => { hidePreview(); onMove(i, m); } : undefined}>
          {(m.color === 'white' || i === 0) && <span class="pv-no">{m.fullmove}{m.color === 'white' ? '.' : '…'}</span>}
          <San san={m.san} />
        </span>
      ))}
      {moves.length > max && <span class="pv-more">…</span>}
    </span>
  );
}
