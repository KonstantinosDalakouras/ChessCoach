import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Chessground } from '@lichess-org/chessground';
import { settings } from '../store.js';
import { t } from '../i18n.js';

const BRUSHES = {
  green: { key: 'g', color: '#15781B', opacity: 1, lineWidth: 10 },
  red: { key: 'r', color: '#882020', opacity: 1, lineWidth: 10 },
  blue: { key: 'b', color: '#003088', opacity: 1, lineWidth: 10 },
  yellow: { key: 'y', color: '#e68f00', opacity: 1, lineWidth: 10 },
  engine1: { key: 'e1', color: '#1b63c9', opacity: 0.85, lineWidth: 11 },
  engine2: { key: 'e2', color: '#1b63c9', opacity: 0.5, lineWidth: 8 },
  engine3: { key: 'e3', color: '#1b63c9', opacity: 0.32, lineWidth: 6 },
  hint: { key: 'h', color: '#15781B', opacity: 0.9, lineWidth: 11 },
  threat: { key: 't', color: '#c62828', opacity: 0.85, lineWidth: 10 },
  best: { key: 'bs', color: '#2e9e3f', opacity: 0.9, lineWidth: 11 },
  played: { key: 'pl', color: '#e0662f', opacity: 0.85, lineWidth: 10 },
  paleGreen: { key: 'pg', color: '#15781B', opacity: 0.4, lineWidth: 15 },
};

const BOARD_COLORS = {
  green: ['#eeeed2', '#769656'],
  brown: ['#f0d9b5', '#b58863'],
  blue: ['#dee3e6', '#8ca2ad'],
  grey: ['#dcdcdc', '#9c9fa6'],
  purple: ['#e9e1f2', '#9b85b8'],
  wood: ['#e6c89c', '#a87b4f'],
};
export const BOARD_THEMES = Object.keys(BOARD_COLORS);

const boardImageCache = {};
export function boardImage(theme) {
  if (boardImageCache[theme]) return boardImageCache[theme];
  const [light, dark] = BOARD_COLORS[theme] || BOARD_COLORS.green;
  let d = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2 === 1) d += `M${x} ${y}h1v1h-1z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges"><rect width="8" height="8" fill="${light}"/><path fill="${dark}" d="${d}"/></svg>`;
  boardImageCache[theme] = `url("data:image/svg+xml;base64,${btoa(svg)}")`;
  return boardImageCache[theme];
}
export const boardColors = theme => BOARD_COLORS[theme] || BOARD_COLORS.green;

const ANIM = { fast: 120, normal: 220, off: 0 };

/**
 * props: fen, orientation, turnColor, lastMove, check, movableColor, dests, premove, viewOnly,
 *        autoShapes, onMove(orig, dest, promotion?), isPromotion(orig, dest), onUserShapes
 */
export function Board(props) {
  const hostRef = useRef();
  const cgRef = useRef();
  const propsRef = useRef(props);
  propsRef.current = props;
  const [promo, setPromo] = useState(null); // { orig, dest, color }
  const s = settings.value;

  useEffect(() => {
    const cg = Chessground(hostRef.current, {
      fen: props.fen,
      orientation: props.orientation || 'white',
      coordinates: s.coords,
      animation: { enabled: s.animation !== 'off', duration: ANIM[s.animation] ?? 220 },
      highlight: { lastMove: true, check: true },
      movable: {
        free: false,
        showDests: s.showDests,
        rookCastle: true,
        events: {
          after: (orig, dest, meta) => {
            const p = propsRef.current;
            if (p.isPromotion && p.isPromotion(orig, dest)) {
              if (meta && meta.premove) { p.onMove && p.onMove(orig, dest, 'q'); return; }
              const color = cgRef.current.state.pieces.get(dest)?.color || p.movableColor || 'white';
              setPromo({ orig, dest, color });
              return;
            }
            p.onMove && p.onMove(orig, dest);
          },
        },
      },
      premovable: { enabled: false, showDests: true, castle: true },
      draggable: { enabled: true, showGhost: true, distance: 3 },
      drawable: { enabled: true, visible: true, brushes: BRUSHES, defaultSnapToValidMove: true, eraseOnMovablePieceClick: false,
        onChange: shapes => propsRef.current.onUserShapes && propsRef.current.onUserShapes(shapes) },
      disableContextMenu: true,
      trustAllEvents: false,
    });
    cgRef.current = cg;
    if (props.cgRef) props.cgRef.current = cg;
    return () => { cg.destroy(); cgRef.current = null; };
  }, []);

  // Sync state.
  useEffect(() => {
    const cg = cgRef.current;
    if (!cg) return;
    const viewOnly = !!props.viewOnly;
    cg.set({
      fen: props.fen,
      orientation: props.orientation || 'white',
      turnColor: props.turnColor || 'white',
      lastMove: props.lastMove || undefined,
      check: props.check || false,
      viewOnly,
      coordinates: s.coords,
      animation: { enabled: s.animation !== 'off', duration: ANIM[s.animation] ?? 220 },
      movable: {
        color: viewOnly ? undefined : props.movableColor,
        dests: viewOnly ? new Map() : props.dests || new Map(),
        showDests: s.showDests,
      },
      premovable: { enabled: !viewOnly && !!props.premove },
    });
    // (Premoves are kept when it becomes our turn: the view plays them right after the opponent's move.)
    if (viewOnly) cg.cancelPremove();
    if (promo) setPromo(null);
  }, [props.fen, props.orientation, props.turnColor, props.lastMove && props.lastMove.join(), props.check, props.movableColor, props.dests, props.premove, props.viewOnly, s.coords, s.animation, s.showDests]);

  useEffect(() => {
    const cg = cgRef.current;
    if (cg) cg.setAutoShapes(props.autoShapes || []);
  }, [props.autoShapes]);

  // Coordinates may be toggled: chessground only renders them on a full redraw.
  useEffect(() => { const cg = cgRef.current; if (cg) cg.redrawAll(); }, [s.coords]);

  const choosePromo = role => {
    const p = promo;
    setPromo(null);
    if (!p) return;
    if (!role) { cgRef.current && cgRef.current.set({ fen: propsRef.current.fen }); return; }
    propsRef.current.onMove && propsRef.current.onMove(p.orig, p.dest, role[0] === 'k' ? 'n' : role[0]);
  };

  const orientation = props.orientation || 'white';
  let promoStyle = null;
  if (promo) {
    const file = promo.dest.charCodeAt(0) - 97;
    const col = orientation === 'white' ? file : 7 - file;
    const top = (orientation === 'white') === (promo.color === 'white');
    promoStyle = { left: `${col * 12.5}%`, [top ? 'top' : 'bottom']: 0 };
  }

  return (
    <div class={`board-wrap board-theme-${s.boardTheme}${props.viewOnly ? ' view-only' : ''}`}
      style={{ '--board-image': boardImage(s.boardTheme) }}>
      <div class="board-host" ref={hostRef} />
      {promo && (
        <div class="promo-layer" onMouseDown={e => { if (e.target === e.currentTarget) choosePromo(null); }}>
          <div class="promo-col cg-wrap" style={promoStyle} role="dialog" aria-label={t('promo.title')}>
            {(((orientation === 'white') === (promo.color === 'white')) ? ['queen', 'knight', 'rook', 'bishop'] : ['bishop', 'rook', 'knight', 'queen']).map(role => (
              <button type="button" class="promo-choice" onClick={() => choosePromo(role)} aria-label={role}>
                <piece class={`${role} ${promo.color}`} />
              </button>
            ))}
          </div>
        </div>
      )}
      {props.overlay}
    </div>
  );
}

/** Build chessground shapes for engine lines (thicker = better). */
export function engineArrows(lines, max = 3) {
  const shapes = [];
  const seen = new Set();
  (lines || []).slice(0, max).forEach((l, i) => {
    const uci = l && l.pv && l.pv[0];
    if (!uci || seen.has(uci)) return;
    seen.add(uci);
    shapes.push({ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush: `engine${i + 1}` });
  });
  return shapes;
}

export const arrow = (uci, brush) => (uci ? { orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush } : null);
export const circle = (sq, brush) => ({ orig: sq, brush });
