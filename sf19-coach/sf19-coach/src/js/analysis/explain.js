// Turns engine numbers into short, concrete explanations (material lost along the refutation, allowed mates, …).
import { material, applyUci, opposite, legalCaptureGain, parseSquare } from '../chess/util.js';
import { ERROR_CLASSES } from './classify.js';

/** Play up to `max` plies of a PV and stop when the position settles (next move is not a capture). */
function playPv(pos, pv, max = 8) {
  let p = pos;
  const played = [];
  for (let i = 0; i < Math.min(pv.length, max); i++) {
    const r = applyUci(p, pv[i]);
    if (!r) break;
    played.push(r);
    p = r.pos;
    const next = pv[i + 1] && applyUci(p, pv[i + 1]);
    if (i >= 1 && (!next || !next.captured) && !r.check) break;
  }
  return { pos: p, played };
}

/** Describe the material change for `color` between two positions, or null if < 1 pawn. */
export function materialChange(before, after, color) {
  const mb = material(before), ma = material(after);
  const sign = color === 'white' ? 1 : -1;
  const delta = (ma.points - mb.points) * sign; // > 0: color gained
  if (Math.abs(delta) < 1) return null;
  const opp = opposite(color);
  const lost = (c, r) => mb.count[c][r] - ma.count[c][r];
  const loser = delta < 0 ? color : opp;
  const winner = opposite(loser);
  const minors = c => lost(c, 'knight') + lost(c, 'bishop');
  let what;
  if (lost(loser, 'queen') > lost(winner, 'queen')) what = 'queen';
  else if (lost(loser, 'rook') > lost(winner, 'rook')) what = minors(winner) > minors(loser) ? 'exchange' : 'rook';
  else if (minors(loser) > minors(winner)) what = 'piece';
  else what = Math.abs(delta) === 1 ? 'pawn' : 'pawns';
  return { delta, what, n: Math.abs(delta) };
}

/**
 * @returns {{ items: {key:string, params?:object}[] }}
 */
export function explainMove({ review, mover, posBefore, posAfter, bestPv, afterPv, bestSan, opening }) {
  const items = [];
  if (!review) return { items };
  const cls = review.cls;

  if (review.mateCreated) items.push({ key: 'ex.allowsMate', params: { n: review.mateCreated } });
  if (review.mateLost) items.push({ key: 'ex.missedMate', params: { n: review.mateLost, move: bestSan } });

  if (ERROR_CLASSES.has(cls)) {
    if (!review.mateCreated && posAfter && afterPv && afterPv.length) {
      const hang = legalCaptureGain(posAfter);
      const first = afterPv[0];
      if (hang.gain >= 2 && hang.uci && first && first.slice(0, 4) === hang.uci.slice(0, 4)) {
        const sq = parseSquare(first.slice(2, 4));
        const piece = posAfter.board.get(sq);
        if (piece && piece.color === mover) items.push({ key: 'ex.hangs', params: { role: piece.role, square: first.slice(2, 4) } });
      }
      const seq = playPv(posAfter, afterPv, 8);
      const ch = materialChange(posAfter, seq.pos, mover);
      if (ch && ch.delta <= -1) items.push({ key: 'ex.losesMaterial', params: { what: ch.what, n: ch.n } });
    }
    if (!review.mateLost && posBefore && bestPv && bestPv.length) {
      const seq = playPv(posBefore, bestPv, 8);
      const ch = materialChange(posBefore, seq.pos, mover);
      if (ch && ch.delta >= 2) items.push({ key: 'ex.missedWin', params: { move: bestSan, what: ch.what, n: ch.n } });
    }
    if (cls === 'miss') items.push({ key: 'ex.missPunish' });
    // Name the better move unless an item above already did.
    if (bestSan && !items.some(i => i.key === 'ex.missedWin' || i.key === 'ex.missedMate')) items.push({ key: 'ex.bestWas', params: { move: bestSan } });
    return { items };
  }

  switch (cls) {
    case 'brilliant': items.push({ key: 'ex.brilliant', params: { n: review.sacrifice } }); break;
    case 'great': items.push({ key: 'ex.great' }); break;
    case 'best': items.push({ key: 'ex.best' }); break;
    case 'excellent': items.push({ key: 'ex.excellent' }); if (bestSan) items.push({ key: 'ex.alsoGood', params: { move: bestSan } }); break;
    case 'good': items.push({ key: 'ex.good' }); if (bestSan) items.push({ key: 'ex.bestWas', params: { move: bestSan } }); break;
    case 'book': items.push({ key: 'ex.book', params: { opening: opening || '' } }); break;
    case 'forced': items.push({ key: 'ex.forced' }); break;
    default: break;
  }
  return { items };
}
