// Minimal, robust UCI output parsing.

/** Parse an `info ...` line. Returns null for non-info lines. */
export function parseInfo(line) {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== 'info') return null;
  const info = {};
  for (let i = 1; i < tokens.length; i++) {
    switch (tokens[i]) {
      case 'depth': info.depth = +tokens[++i]; break;
      case 'seldepth': info.seldepth = +tokens[++i]; break;
      case 'multipv': info.multipv = +tokens[++i]; break;
      case 'score': {
        const kind = tokens[++i];
        const v = +tokens[++i];
        if (kind === 'cp') info.score = { cp: v };
        else if (kind === 'mate') info.score = { mate: v };
        if (tokens[i + 1] === 'lowerbound' || tokens[i + 1] === 'upperbound') info.bound = tokens[++i];
        break;
      }
      case 'wdl': info.wdl = [+tokens[i + 1], +tokens[i + 2], +tokens[i + 3]]; i += 3; break;
      case 'nodes': info.nodes = +tokens[++i]; break;
      case 'nps': info.nps = +tokens[++i]; break;
      case 'hashfull': info.hashfull = +tokens[++i]; break;
      case 'tbhits': info.tbhits = +tokens[++i]; break;
      case 'time': info.time = +tokens[++i]; break;
      case 'currmove': info.currmove = tokens[++i]; break;
      case 'currmovenumber': info.currmovenumber = +tokens[++i]; break;
      case 'pv': info.pv = tokens.slice(i + 1); i = tokens.length; break;
      case 'string': info.string = tokens.slice(i + 1).join(' '); i = tokens.length; break;
      default: break;
    }
  }
  return info;
}

/** Parse `bestmove e2e4 ponder e7e5` → { bestmove, ponder } (bestmove null for "(none)"). */
export function parseBestmove(line) {
  const t = line.trim().split(/\s+/);
  if (t[0] !== 'bestmove') return null;
  const bm = t[1] && t[1] !== '(none)' && t[1] !== '0000' ? t[1] : null;
  const ponder = t[2] === 'ponder' && t[3] ? t[3] : null;
  return { bestmove: bm, ponder };
}

/** Parse `option name X type spin default 1 min 1 max 512`. */
export function parseOption(line) {
  const m = /^option name (.+?) type (\w+)(.*)$/.exec(line.trim());
  if (!m) return null;
  const opt = { name: m[1], type: m[2] };
  const rest = m[3];
  const def = /default (\S*)/.exec(rest);
  const min = /min (-?\d+)/.exec(rest);
  const max = /max (-?\d+)/.exec(rest);
  if (def) opt.default = def[1];
  if (min) opt.min = +min[1];
  if (max) opt.max = +max[1];
  return opt;
}

/** Build a `go` command from limits. */
export function goCommand(limits = {}) {
  const parts = ['go'];
  if (limits.infinite) parts.push('infinite');
  else {
    if (limits.wtime !== undefined) parts.push('wtime', Math.max(1, Math.round(limits.wtime)));
    if (limits.btime !== undefined) parts.push('btime', Math.max(1, Math.round(limits.btime)));
    if (limits.winc !== undefined) parts.push('winc', Math.max(0, Math.round(limits.winc)));
    if (limits.binc !== undefined) parts.push('binc', Math.max(0, Math.round(limits.binc)));
    if (limits.depth) parts.push('depth', limits.depth);
    if (limits.nodes) parts.push('nodes', Math.round(limits.nodes));
    if (limits.movetime) parts.push('movetime', Math.max(1, Math.round(limits.movetime)));
    if (parts.length === 1) parts.push('infinite');
  }
  if (limits.searchmoves && limits.searchmoves.length) parts.push('searchmoves', ...limits.searchmoves);
  return parts.join(' ');
}
