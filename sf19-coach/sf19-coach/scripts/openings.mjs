// Converts the lichess chess-openings dataset (CC0, https://github.com/lichess-org/chess-openings)
// into a compact lookup table: EPD -> opening name, plus the set of "book" positions.
// Run once: `node scripts/openings.mjs` (the output is committed, so deploys don't need it).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';

const files = ['a', 'b', 'c', 'd', 'e'];
const names = [];
const nameIndex = new Map();
const pos = new Map(); // epd -> { idx, plies }

const epdOf = p => makeFen(p.toSetup(), { epd: true });

for (const f of files) {
  const lines = readFileSync(new URL(`../data-src/${f}.tsv`, import.meta.url), 'utf8').trim().split('\n').slice(1);
  for (const line of lines) {
    const [eco, name, pgn] = line.split('\t');
    const sans = pgn.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/).filter(Boolean);
    const p = Chess.default();
    const epds = [];
    let ok = true;
    for (const san of sans) {
      const mv = parseSan(p, san);
      if (!mv) { ok = false; break; }
      p.play(mv);
      epds.push(epdOf(p));
    }
    if (!ok) { console.warn('illegal line skipped:', eco, name, pgn); continue; }
    const key = `${eco}\t${name}`;
    if (!nameIndex.has(key)) { nameIndex.set(key, names.length); names.push([eco, name]); }
    const idx = nameIndex.get(key);
    const finalEpd = epds[epds.length - 1];
    const prev = pos.get(finalEpd);
    // Named position: keep the entry reached by the shortest line (canonical name).
    if (!prev || prev.idx < 0 || sans.length < prev.plies) pos.set(finalEpd, { idx, plies: sans.length });
    // Every intermediate position of a known line is "book".
    for (let i = 0; i < epds.length - 1; i++) if (!pos.has(epds[i])) pos.set(epds[i], { idx: -1, plies: i + 1 });
  }
}

const out = { v: 1, source: 'lichess-org/chess-openings (CC0)', names, pos: {} };
for (const [epd, { idx }] of pos) out.pos[epd] = idx;
mkdirSync(new URL('../src/static/data/', import.meta.url), { recursive: true });
const json = JSON.stringify(out);
writeFileSync(new URL('../src/static/data/openings.json', import.meta.url), json);
const named = [...pos.values()].filter(v => v.idx >= 0).length;
console.log(`${names.length} names, ${pos.size} book positions (${named} named), ${(json.length / 1024).toFixed(0)} KiB`);
