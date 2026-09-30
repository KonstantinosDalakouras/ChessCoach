// Scores are always stored from WHITE's point of view: { cp } or { mate } (mate > 0: white mates).
// Win-probability model and accuracy formula follow lichess (lila: WinPercent.scala / AccuracyPercent.scala).

export const CP_CEILING = 1000;

/** Convert an engine score (side-to-move POV) to white POV. */
export function toWhitePov(raw, turn) {
  if (!raw) return undefined;
  const s = turn === 'white' ? 1 : -1;
  if (raw.mate !== undefined && raw.mate !== null) {
    // "mate 0": the side to move is checkmated.
    if (raw.mate === 0) return { mate: 0, mated: turn };
    return { mate: raw.mate * s };
  }
  return { cp: raw.cp * s };
}

export const isMate = s => !!s && s.mate !== undefined && s.mate !== null;

/** Centipawns clamped to ±1000; mate counts as ±1000 (lichess convention). */
export function ceiledCp(score) {
  if (!score) return 0;
  if (isMate(score)) {
    if (score.mate === 0) return score.mated === 'white' ? -CP_CEILING : score.mated === 'black' ? CP_CEILING : 0;
    return score.mate > 0 ? CP_CEILING : -CP_CEILING;
  }
  return Math.max(-CP_CEILING, Math.min(CP_CEILING, score.cp));
}

/** Winning chances in [-1, 1] for white. */
export function winningChances(score) {
  const cp = ceiledCp(score);
  const wc = 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
  return Math.max(-1, Math.min(1, wc));
}

/** Win% (0..100) for white. */
export const winPct = score => 50 + 50 * winningChances(score);

/** Win% (0..100) for the given color. */
export const winPctFor = (score, color) => (color === 'white' ? winPct(score) : 100 - winPct(score));

/** Per-move accuracy (0..100) from the mover's win% before and after (lichess formula incl. +1 uncertainty bonus). */
export function moveAccuracy(before, after) {
  if (after >= before) return 100;
  const diff = before - after;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * diff) - 3.166924740191411 + 1;
  return Math.max(0, Math.min(100, raw));
}

/** Compare two scores for `color`: > 0 if a is better for color than b. */
export function scoreOrder(score) {
  // A total order usable for sorting: mates beat any cp, shorter mates are better.
  if (isMate(score)) {
    if (score.mate === 0) return score.mated === 'white' ? -100000 : score.mated === 'black' ? 100000 : 0;
    if (score.mate > 0) return 100000 - score.mate;
    return -100000 - score.mate;
  }
  return score.cp;
}

const MINUS = '−';

/** "+0.35", "−1.20", "#5", "#−3" (white POV unless flipped). */
export function formatScore(score, { digits } = {}) {
  if (!score) return '…';
  if (isMate(score)) {
    if (score.mate === 0) return score.mated === 'white' ? '0-1' : score.mated === 'black' ? '1-0' : '#';
    return score.mate > 0 ? `#${score.mate}` : `#${MINUS}${-score.mate}`;
  }
  const p = score.cp / 100;
  const d = digits ?? (Math.abs(p) >= 10 ? 1 : 2);
  const txt = Math.abs(p).toFixed(d);
  if (Number(txt) === 0) return (0).toFixed(d);
  return (p > 0 ? '+' : MINUS) + txt;
}

/** Short label for the eval bar: "0.4", "M3". */
export function formatShort(score) {
  if (!score) return '';
  if (isMate(score)) return score.mate === 0 ? '#' : `M${Math.abs(score.mate)}`;
  const p = Math.abs(score.cp / 100);
  return p >= 10 ? p.toFixed(0) : p.toFixed(1);
}

/** Fraction (0..1) of the eval bar that belongs to white. */
export function barFraction(score) {
  if (!score) return 0.5;
  if (isMate(score)) {
    if (score.mate === 0) return score.mated === 'white' ? 0 : score.mated === 'black' ? 1 : 0.5;
    return score.mate > 0 ? 1 : 0;
  }
  return Math.max(0.03, Math.min(0.97, 0.5 + 0.5 * winningChances(score)));
}

/** WDL (per mille, side-to-move POV) → white POV [w, d, l]. */
export function wdlToWhite(wdl, turn) {
  if (!wdl) return undefined;
  return turn === 'white' ? wdl : [wdl[2], wdl[1], wdl[0]];
}

/** Score of a finished position (checkmate/stalemate/draw) in white POV. */
export function terminalScore(pos) {
  if (pos.isCheckmate()) return { mate: 0, mated: pos.turn };
  return { cp: 0 };
}
