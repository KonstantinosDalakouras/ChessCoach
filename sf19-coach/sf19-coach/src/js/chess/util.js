// Chess helpers built on chessops (rules, FEN, SAN) — no UI code in here.
import { Chess, castlingSide, normalizeMove, isImpossibleCheck } from 'chessops/chess';
import { parseFen, makeFen, INITIAL_FEN } from 'chessops/fen';
import { parseUci, makeSquare, parseSquare, kingCastlesTo, opposite } from 'chessops/util';
import { makeSan, parseSan } from 'chessops/san';
import { chessgroundDests } from 'chessops/compat';
import { SquareSet } from 'chessops/squareSet';

export { opposite, makeSquare, parseSquare };
export const START_FEN = INITIAL_FEN;
export const ROLE_VALUE = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };
const SEE_VALUE = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 50 };

/**
 * Parse and validate a FEN strictly enough that Stockfish 19 accepts it
 * (SF19 rejects e.g. >16 pieces per side, capturable kings, bad ep squares).
 * Returns { pos, fen } or { error }.
 */
export function setupPosition(fen) {
  if (typeof fen !== 'string' || !fen.trim()) return { error: 'ERR_FEN' };
  // Accept FENs without move counters (EPD-like input from books/sites).
  let parts = fen.trim().split(/\s+/);
  if (parts.length === 4) parts = [...parts, '0', '1'];
  if (parts.length === 2) parts = [...parts, '-', '-', '0', '1'];
  const setup = parseFen(parts.join(' '));
  if (setup.isErr) return { error: setup.error.message || 'ERR_FEN' };
  const res = Chess.fromSetup(setup.value);
  if (res.isErr) return { error: res.error.message || 'ERR_POSITION' };
  const pos = res.value;
  for (const color of ['white', 'black']) {
    const own = pos.board[color];
    if (own.size() > 16) return { error: 'ERR_TOO_MANY_PIECES' };
    if (own.intersect(pos.board.pawn).size() > 8) return { error: 'ERR_TOO_MANY_PAWNS' };
  }
  if (isImpossibleCheck(pos)) return { error: 'ERR_IMPOSSIBLE_CHECK' };
  return { pos, fen: makeFen(pos.toSetup()) };
}

export const fenOf = pos => makeFen(pos.toSetup());
export const epdOf = pos => makeFen(pos.toSetup(), { epd: true });
export const turnOf = fen => (fen.split(' ')[1] === 'b' ? 'black' : 'white');
export const fullmoveOf = fen => parseInt(fen.split(' ')[5] || '1', 10) || 1;
export const epdFromFen = fen => fen.split(' ').slice(0, 4).join(' ');

/** Position from a (trusted) FEN; throws on invalid input. */
export function posFromFen(fen) {
  const r = setupPosition(fen);
  if (r.error) throw new Error(`Invalid FEN (${r.error}): ${fen}`);
  return r.pos;
}

/** Parse a UCI move against a position, returning a normalized legal chessops move or undefined. */
export function parseMove(pos, uci) {
  const raw = typeof uci === 'string' ? parseUci(uci) : uci;
  if (!raw || !('from' in raw)) return undefined;
  const move = normalizeMove(pos, raw);
  return pos.isLegal(move) ? move : undefined;
}

/** Standard (non-960) UCI for a chessops move: castling as e1g1 instead of king-takes-rook. */
export function uciOf(pos, move) {
  const side = castlingSide(pos, move);
  const to = side ? kingCastlesTo(pos.turn, side) : move.to;
  return makeSquare(move.from) + makeSquare(to) + (move.promotion ? move.promotion[0] : '');
}

/**
 * Play a UCI move on a clone of pos. Returns { pos, san, uci, fen, epd, captured, check, move } or undefined.
 */
export function applyUci(pos, uci) {
  const move = parseMove(pos, uci);
  if (!move) return undefined;
  const san = makeSan(pos, move);
  const std = uciOf(pos, move);
  const captured = capturedRole(pos, move);
  const castle = !!castlingSide(pos, move);
  const next = pos.clone();
  next.play(move);
  return {
    pos: next, san, uci: std, fen: fenOf(next), epd: epdOf(next), captured, castle,
    promotion: move.promotion, check: next.isCheck(), move,
  };
}

function capturedRole(pos, move) {
  const target = pos.board.get(move.to);
  if (target && target.color !== pos.turn) return target.role;
  const piece = pos.board.get(move.from);
  if (piece && piece.role === 'pawn' && pos.epSquare === move.to) return 'pawn';
  return undefined;
}

export function sanToUci(pos, san) {
  const move = parseSan(pos, san);
  return move ? uciOf(pos, move) : undefined;
}

/** Convert a PV (list of UCI moves) into [{san, uci, fen, color, fullmove}] — stops at the first illegal move. */
export function pvToSan(fen, ucis, max = 64) {
  const out = [];
  let pos;
  try { pos = posFromFen(fen); } catch { return out; }
  for (const uci of ucis.slice(0, max)) {
    const color = pos.turn, fullmove = pos.fullmoves;
    const r = applyUci(pos, uci);
    if (!r) break;
    out.push({ san: r.san, uci: r.uci, fen: r.fen, color, fullmove, check: r.check, captured: r.captured });
    pos = r.pos;
  }
  return out;
}

/** Legal destinations in chessground's format (Map<from, to[]>). */
export const destsOf = pos => chessgroundDests(pos);

export function isPromotion(pos, from, to) {
  const piece = pos.board.get(parseSquare(from));
  if (!piece || piece.role !== 'pawn') return false;
  const rank = to[1];
  return (piece.color === 'white' && rank === '8') || (piece.color === 'black' && rank === '1');
}

export function kingSquareInCheck(pos) {
  if (!pos.isCheck()) return undefined;
  const k = pos.board.kingOf(pos.turn);
  return k === undefined ? undefined : makeSquare(k);
}

/** Material: counts per color/role and the difference in points (white - black). */
export function material(pos) {
  const count = { white: {}, black: {} };
  let points = 0;
  for (const color of ['white', 'black']) {
    for (const role of ['queen', 'rook', 'bishop', 'knight', 'pawn']) {
      const n = pos.board.pieces(color, role).size();
      count[color][role] = n;
      points += (color === 'white' ? 1 : -1) * n * ROLE_VALUE[role];
    }
  }
  return { count, points };
}

/** Pieces "captured" relative to the other side (for the player bars): { white: {role: n}, black: {...}, diff }. */
export function materialImbalance(pos) {
  const { count, points } = material(pos);
  const white = {}, black = {};
  for (const role of ['queen', 'rook', 'bishop', 'knight', 'pawn']) {
    const d = count.white[role] - count.black[role];
    if (d > 0) white[role] = d; // white has extra (i.e. has captured more of these)
    else if (d < 0) black[role] = -d;
  }
  return { white, black, diff: points };
}

/**
 * Static exchange evaluation: material (in pawns) that `attacker` wins by capturing on `square`,
 * assuming both sides recapture with their least valuable piece and may stop at any time.
 * Pins are ignored — this is a heuristic for explanations, not for search.
 */
export function see(pos, square, attacker) {
  const board = pos.board;
  const target = board.get(square);
  if (!target || target.color === attacker) return 0;
  let occupied = board.occupied;
  const gain = [SEE_VALUE[target.role]];
  let side = attacker;
  let from = leastValuable(pos, square, side, occupied);
  if (from === undefined) return 0;
  let pieceValue = SEE_VALUE[board.get(from).role];
  let d = 0;
  while (from !== undefined && d < 32) {
    d++;
    gain[d] = pieceValue - gain[d - 1];
    if (Math.max(-gain[d - 1], gain[d]) < 0) break; // pruning: this capture can't help
    occupied = occupied.without(from);
    side = opposite(side);
    from = leastValuable(pos, square, side, occupied);
    if (from !== undefined) pieceValue = SEE_VALUE[board.get(from).role];
  }
  while (--d > 0) gain[d - 1] = -Math.max(-gain[d - 1], gain[d]);
  return gain[0];
}

function leastValuable(pos, square, color, occupied) {
  const attackers = pos.kingAttackers(square, color, occupied).intersect(occupied);
  let best, bestVal = Infinity;
  for (const sq of attackers) {
    const v = SEE_VALUE[pos.board.getRole(sq)];
    if (v < bestVal) { bestVal = v; best = sq; }
  }
  return best;
}

/** Largest SEE gain available to `color` (the side to move in pos) by any capture. */
export function bestCaptureGain(pos, color = pos.turn) {
  let best = 0, square;
  for (const sq of pos.board[opposite(color)]) {
    if (pos.board.getRole(sq) === 'king') continue;
    const g = see(pos, sq, color);
    if (g > best) { best = g; square = sq; }
  }
  return { gain: best, square: square === undefined ? undefined : makeSquare(square) };
}

/**
 * Best material gain (in pawns) the side to move can get with a LEGAL capture, assuming the other side
 * then recaptures optimally (static exchange). Returns { gain, uci }.
 */
export function legalCaptureGain(pos) {
  let best = 0, bestUci;
  const ctx = pos.ctx();
  for (const [from, dests] of pos.allDests(ctx)) {
    const piece = pos.board.get(from);
    for (const to of dests) {
      const target = pos.board.get(to);
      let captured;
      if (target && target.color !== pos.turn) captured = target.role;
      else if (piece.role === 'pawn' && to === pos.epSquare) captured = 'pawn';
      if (!captured || captured === 'king') continue;
      const promo = piece.role === 'pawn' && (squareRankOf(to) === 0 || squareRankOf(to) === 7) ? 'queen' : undefined;
      const after = pos.clone();
      after.play({ from, to, promotion: promo });
      const recapture = Math.max(0, see(after, to, opposite(pos.turn)));
      const gain = SEE_VALUE[captured] + (promo ? SEE_VALUE.queen - 1 : 0) - recapture;
      if (gain > best) { best = gain; bestUci = makeSquare(from) + makeSquare(to) + (promo ? 'q' : ''); }
    }
  }
  return { gain: best, uci: bestUci };
}
const squareRankOf = sq => sq >> 3;

/** Null-move FEN (same position, other side to move) for "what does the opponent threaten?". */
export function nullMoveFen(pos) {
  if (pos.isCheck()) return undefined;
  const setup = pos.toSetup();
  setup.turn = opposite(setup.turn);
  setup.epSquare = undefined;
  const fen = makeFen(setup);
  const r = setupPosition(fen);
  return r.error ? undefined : r.fen;
}

export { SquareSet, makeSan, parseSan };
