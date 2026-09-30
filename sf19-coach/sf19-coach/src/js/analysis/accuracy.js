// Game accuracy exactly like lichess (lila: AccuracyPercent.gameAccuracy):
// per-move accuracy from win% loss, combined with a volatility-weighted mean and a harmonic mean.
import { moveAccuracy } from '../chess/score.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function stdDev(xs) {
  if (!xs.length) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

/**
 * @param {number[]} winPcts white win% for positions [start, after ply 1, after ply 2, ...]
 * @param {'white'|'black'} startColor side to move in the start position
 * @returns {{white:number|null, black:number|null, perMove:number[]}}
 */
export function gameAccuracy(winPcts, startColor = 'white') {
  const n = winPcts.length - 1;
  if (n < 1) return { white: null, black: null, perMove: [] };
  const windowSize = clamp(Math.floor(n / 10), 2, 8);
  const windows = [];
  const first = winPcts.slice(0, windowSize);
  for (let i = 0; i < Math.min(windowSize, winPcts.length) - 2; i++) windows.push(first);
  if (winPcts.length < windowSize) windows.push(winPcts.slice());
  else for (let i = 0; i + windowSize <= winPcts.length; i++) windows.push(winPcts.slice(i, i + windowSize));
  const weights = windows.map(xs => clamp(stdDev(xs), 0.5, 12));

  const per = { white: [], black: [] };
  const perMove = [];
  for (let i = 0; i < n; i++) {
    const whiteMove = (i % 2 === 0) === (startColor === 'white');
    const prev = winPcts[i], next = winPcts[i + 1];
    const acc = whiteMove ? moveAccuracy(prev, next) : moveAccuracy(100 - prev, 100 - next);
    perMove.push(acc);
    per[whiteMove ? 'white' : 'black'].push({ acc, w: weights[i] ?? 1 });
  }
  const colorAcc = list => {
    if (!list.length) return null;
    const wSum = list.reduce((s, x) => s + x.w, 0);
    const weighted = list.reduce((s, x) => s + x.acc * x.w, 0) / wSum;
    const harmonic = list.length / list.reduce((s, x) => s + 1 / Math.max(x.acc, 0.001), 0);
    return (weighted + harmonic) / 2;
  };
  return { white: colorAcc(per.white), black: colorAcc(per.black), perMove };
}
