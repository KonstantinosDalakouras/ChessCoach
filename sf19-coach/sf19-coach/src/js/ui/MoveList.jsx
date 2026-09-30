import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { San, CLS_GLYPH } from './common.jsx';
import { t } from '../i18n.js';

const NAG_GLYPH = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!', 7: '□', 10: '=', 13: '∞', 14: '⩲', 15: '⩱', 16: '±', 17: '∓', 18: '+−', 19: '−+', 22: '⨀', 32: '⟳', 36: '→', 40: '↑', 132: '⇆', 146: 'N' };
const SHOWN_GLYPH = new Set(['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder']);

function moveClass(node, showCls) {
  const r = showCls(node);
  return r ? r.cls : null;
}

function Move({ node, cur, onSelect, onContext, showCls, withNumber, variation }) {
  const cls = moveClass(node, showCls);
  const white = node.ply % 2 === 1;
  const no = Math.ceil(node.ply / 2);
  const glyphs = [];
  if (cls && SHOWN_GLYPH.has(cls)) glyphs.push(CLS_GLYPH[cls]);
  else if (node.nags) for (const n of node.nags) if (NAG_GLYPH[n] && n <= 6) { glyphs.push(NAG_GLYPH[n]); break; }
  return (
    <span class={`mv${node.id === cur ? ' current' : ''}${cls ? ` c-${cls}` : ''}${variation ? ' in-var' : ''}`} data-id={node.id}
      onClick={() => onSelect(node)} onContextMenu={e => { if (onContext) { e.preventDefault(); onContext(node, e); } }}
      role="button" tabIndex={-1}>
      {withNumber && <span class="mv-no">{white ? `${no}.` : `${no}…`}</span>}
      <San san={node.san} />
      {glyphs.length > 0 && <span class="mv-glyph">{glyphs.join('')}</span>}
    </span>
  );
}

function VariationLine({ start, depth, ...rest }) {
  const parts = [];
  let n = start;
  let first = true;
  let prevHadBreak = false;
  while (n) {
    const white = n.ply % 2 === 1;
    parts.push(<Move node={n} withNumber={first || white || prevHadBreak} variation {...rest} />);
    prevHadBreak = false;
    first = false;
    const next = n.children[0];
    if (next && n.children.length > 1) {
      // alternatives to `next`
      for (const alt of n.children.slice(1)) {
        parts.push(<span class="var-nested">(<VariationLine start={alt} depth={depth + 1} {...rest} />)</span>);
      }
      prevHadBreak = true;
    }
    n = next;
  }
  return <span class="var-line">{parts}</span>;
}

/**
 * props: tree, cur (node id), version, onSelect(node), onContext?(node, event), showCls(node) -> review|null
 */
export function MoveList({ tree, cur, version, onSelect, onContext, showCls = () => null, empty }) {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current && ref.current.querySelector('.mv.current');
    if (el) {
      const box = ref.current; // position: relative → offsetTop is relative to the list
      const top = el.offsetTop;
      if (top < box.scrollTop + 8 || top > box.scrollTop + box.clientHeight - 40) box.scrollTop = Math.max(0, top - box.clientHeight / 2);
    } else if (ref.current && tree && cur === tree.root.id) ref.current.scrollTop = 0;
  }, [cur, version]);

  if (!tree) return null;
  const common = { cur, onSelect, onContext, showCls };
  const rows = [];
  let row = null;
  const flush = () => { if (row) { rows.push(row); row = null; } };
  const main = tree.mainline();
  const push = (el) => { flush(); rows.push({ el }); };

  if (tree.root.comments && tree.root.comments.length) rows.push({ el: <div class="mv-comment">{tree.root.comments.join(' ')}</div> });
  for (const n of main) {
    const white = n.ply % 2 === 1;
    const no = Math.ceil(n.ply / 2);
    if (white) { flush(); row = { no, w: n, b: null }; }
    else if (!row) row = { no, w: 'dots', b: n };
    else row.b = n;
    const alts = n.parent.children.slice(1);
    const comment = n.comments && n.comments.length ? n.comments.join(' ') : null;
    if (alts.length || comment) {
      if (white) row.b = 'dots';
      flush();
      if (comment) push(<div class="mv-comment">{comment}</div>);
      if (alts.length) push(<div class="variations">{alts.map(a => <div class="variation"><VariationLine start={a} depth={1} {...common} /></div>)}</div>);
      if (white && n.children[0]) row = { no, w: 'dots', b: null };
    } else if (!white) flush();
  }
  flush();

  return (
    <div class="movelist" ref={ref} role="list" aria-label={t('c.moves')}>
      {main.length === 0 && <div class="movelist-empty">{empty || t('an.empty')}</div>}
      <div class="mv-grid">
        {rows.map(r => r.el ? r.el : (
          <div class="mv-row">
            <span class="mv-index">{r.no}</span>
            <span class="mv-cell">{r.w === 'dots' ? <span class="mv-dots">…</span> : r.w && <Move node={r.w} {...common} />}</span>
            <span class="mv-cell">{r.b === 'dots' ? <span class="mv-dots">…</span> : r.b && <Move node={r.b} {...common} />}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
