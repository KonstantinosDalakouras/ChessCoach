// Move classification (Best / Excellent / Good / Book / Inaccuracy / Mistake / Blunder / Miss / Great / Brilliant / Forced)
// based on the lichess win% model (thresholds 5 / 10 / 15 win% points, plus lichess' mate rules).
import { winPctFor, moveAccuracy, isMate, ceiledCp } from '../chess/score.js';
import { legalCaptureGain } from '../chess/util.js';

export const CLASSES = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'miss', 'blunder'];
export const ERROR_CLASSES = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);
export const GOOD_CLASSES = new Set(['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced']);
export const CLASS_SYMBOL = { brilliant: '!!', great: '!', best: '★', excellent: '', good: '', book: '', forced: '', inaccuracy: '?!', mistake: '?', miss: '✗', blunder: '??' };

const THRESH = { inaccuracy: 5, mistake: 10, blunder: 15 };

/** Mover-POV mate number (positive: mover mates) or undefined. */
function moverMate(score, mover) {
  if (!isMate(score) || score.mate === 0) return undefined;
  return mover === 'white' ? score.mate : -score.mate;
}
const moverCp = (score, mover) => (isMate(score) ? 0 : (mover === 'white' ? 1 : -1) * score.cp);

/**
 * @param {object} a
 * @param {'white'|'black'} a.mover
 * @param {string} a.uci the move played (standard UCI)
 * @param {{score, lines:[{score, pv}], depth}} a.before analysis of the position before the move (lines[0] = best)
 * @param {{score, pv, depth}} [a.after] analysis of the position after the move (needed if the move isn't in before.lines)
 * @param {boolean} [a.book] position after the move is opening theory
 * @param {number} [a.legalMoves] number of legal moves before the move
 * @param {number} [a.opponentLoss] win% lost by the opponent's previous move
 * @param {object} [a.posBefore] chessops position before the move
 * @param {object} [a.posAfter] chessops position after the move
 * @param {string} [a.prevUci] opponent's previous move (for recapture detection)
 * @param {boolean} [a.prevWasCapture]
 */
export function classifyMove(a) {
  const { mover, uci, before } = a;
  const lines = (before && before.lines) || [];
  const best = lines[0];
  if (!best) return null;
  const bestUci = best.pv[0];
  const inLines = lines.find(l => l.pv[0] === uci);
  let afterScore = inLines ? inLines.score : a.after && a.after.score;
  if (!afterScore) return null;
  // A deeper dedicated analysis of the position after the move is more reliable than a MultiPV side line.
  if (inLines && a.after && a.after.score && (a.after.depth || 0) > (inLines.depth || 0) + 2 && uci !== bestUci) afterScore = a.after.score;

  const bestScore = best.score;
  const wBest = winPctFor(bestScore, mover);
  const wAfter = winPctFor(afterScore, mover);
  const loss = uci === bestUci ? 0 : Math.max(0, wBest - wAfter);
  const acc = uci === bestUci ? 100 : moveAccuracy(wBest, wAfter);
  const cpLoss = uci === bestUci ? 0 : Math.max(0, moverCpCeiled(bestScore, mover) - moverCpCeiled(afterScore, mover));

  const res = {
    cls: 'good', loss: round1(loss), acc: round1(acc), cpLoss, book: !!a.book,
    bestUci, bestScore, afterScore, wBest: round1(wBest), wAfter: round1(wAfter),
  };

  // Only one legal move: nothing to judge.
  if (a.legalMoves === 1) { res.cls = 'forced'; res.loss = 0; res.acc = 100; res.cpLoss = 0; return res; }

  // Lichess mate rules.
  const prevMate = moverMate(bestScore, mover);
  const nextMate = moverMate(afterScore, mover);
  const afterIsMateDelivered = isMate(afterScore) && afterScore.mate === 0;
  let mateJudgement;
  if (!afterIsMateDelivered) {
    if (prevMate === undefined && nextMate !== undefined && nextMate < 0) {
      const prevCp = moverCp(bestScore, mover);
      mateJudgement = prevCp < -999 ? 'inaccuracy' : prevCp < -700 ? 'mistake' : 'blunder';
      res.mateCreated = -nextMate;
    } else if (prevMate !== undefined && prevMate > 0 && (nextMate === undefined || nextMate < 0) && uci !== bestUci) {
      const nextCp = nextMate === undefined ? moverCp(afterScore, mover) : -1000;
      mateJudgement = nextCp > 999 ? 'inaccuracy' : nextCp > 700 ? 'mistake' : 'blunder';
      res.mateLost = prevMate;
    }
  }

  let cls;
  if (loss >= THRESH.blunder) cls = 'blunder';
  else if (loss >= THRESH.mistake) cls = 'mistake';
  else if (loss >= THRESH.inaccuracy) cls = 'inaccuracy';
  if (mateJudgement && (!cls || rank(mateJudgement) > rank(cls))) cls = mateJudgement;

  if (cls) {
    // Missed punishing the opponent's error.
    if ((a.opponentLoss || 0) >= THRESH.mistake && loss >= THRESH.mistake && wAfter >= 40 && !res.mateCreated) cls = 'miss';
    res.cls = cls;
    return res;
  }

  if (uci === bestUci) {
    res.cls = 'best';
    if (isGreat(a, lines, mover)) res.cls = 'great';
    const sac = sacrificeValue(a);
    const mating = (moverMate(afterScore, mover) || 0) > 0;
    if (sac >= 2 && wAfter >= 50 && (wBest <= 95 || mating) && (before.depth || 0) >= 12) { res.cls = 'brilliant'; res.sacrifice = sac; }
  } else if (loss < 2) res.cls = 'excellent';
  else res.cls = 'good';

  if (a.book && res.cls !== 'brilliant' && res.cls !== 'great') res.cls = 'book';
  return res;
}

const round1 = x => Math.round(x * 10) / 10;
const rank = c => ({ inaccuracy: 1, mistake: 2, miss: 2, blunder: 3 }[c] || 0);
const moverCpCeiled = (score, mover) => (mover === 'white' ? 1 : -1) * ceiledCp(score);

function isGreat(a, lines, mover) {
  if (lines.length < 2 || (a.before.depth || 0) < 10) return false;
  const w0 = winPctFor(lines[0].score, mover);
  const w1 = winPctFor(lines[1].score, mover);
  if (w0 - w1 < 12) return false;
  if (w0 < 30) return false; // still losing: "only move" to survive is less instructive, keep it as Best
  // Obvious recaptures are not "great".
  if (a.prevWasCapture && a.prevUci && a.uci.slice(2, 4) === a.prevUci.slice(2, 4)) return false;
  // Mate-in-1 style finishes are just "best".
  if (isMate(lines[0].score) && Math.abs(lines[0].score.mate) <= 1) return false;
  return true;
}

/** Material (in pawns) the move leaves en prise: the opponent's best legal capture, net of recaptures. */
function sacrificeValue(a) {
  const { posAfter } = a;
  if (!posAfter || posAfter.isCheckmate() || a.uci.length > 4) return 0; // ignore promotions
  return legalCaptureGain(posAfter).gain;
}

/** Summary per side: counts of each class, accuracy, ACPL. */
export function summarize(moves /* [{mover, review}] */) {
  const sides = {};
  for (const color of ['white', 'black']) {
    const mine = moves.filter(m => m.mover === color && m.review);
    const counts = Object.fromEntries(CLASSES.map(c => [c, 0]));
    for (const m of mine) counts[m.review.cls] = (counts[m.review.cls] || 0) + 1;
    const acpl = mine.length ? Math.round(mine.reduce((s, m) => s + (m.review.cpLoss || 0), 0) / mine.length) : 0;
    sides[color] = { counts, acpl, moves: mine.length };
  }
  return sides;
}
