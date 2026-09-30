import { h } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { t } from '../i18n.js';
import { analysis, anState, anLive, anVersion } from '../controllers/analysis.js';
import { settings, updateSettings } from '../store.js';
import { Board, engineArrows, arrow } from './Board.jsx';
import { EvalBar, PlayerBar, Material } from './BoardParts.jsx';
import { MoveList } from './MoveList.jsx';
import { EngineLines, ReviewPanel, TrainerPanel, CoachCard } from './Panels.jsx';
import { IconBtn, Icon, copyText, toast } from './common.jsx';
import { posFromFen, destsOf, isPromotion, materialImbalance, opposite } from '../chess/util.js';
import { openings } from '../game/openings.js';
import { openDialog } from './dialogs.jsx';
import { explainMove } from '../analysis/explain.js';
import { pvToSan } from '../chess/util.js';
import { moverOf } from '../game/tree.js';
import { playFromPosition } from '../app-actions.js';

export function AnalysisView() {
  const s = anState.value;
  const version = anVersion.value;
  const live = anLive.value;
  const cgRef = useRef();
  const tree = s.tree;
  const node = analysis.curNode();
  const tr = s.trainer;
  const trItem = tr ? analysis.trainerItem() : null;

  const board = useMemo(() => {
    let fen = node.fen, lastMove = node.uci ? [node.uci.slice(0, 2), node.uci.slice(2, 4)] : undefined;
    let movable = true;
    if (tr && trItem) {
      if (tr.attempt) { fen = tr.attempt.fen; lastMove = tr.attempt.lastMove; }
      else { fen = trItem.parent.fen; lastMove = trItem.parent.uci ? [trItem.parent.uci.slice(0, 2), trItem.parent.uci.slice(2, 4)] : undefined; }
      movable = tr.state === 'solving';
    }
    const pos = posFromFen(fen);
    return {
      fen, lastMove, pos, turnColor: pos.turn, check: pos.isCheck() ? pos.turn : false,
      movableColor: movable ? pos.turn : undefined,
      dests: movable ? destsOf(pos) : new Map(),
      viewOnly: !movable,
    };
  }, [node.id, version, tr && tr.state, tr && tr.index, tr && tr.attempt && tr.attempt.fen]);

  // ---- shapes
  let shapes = [];
  const liveHere = live && live.nodeId === node.id;
  if (tr && trItem) {
    if ((tr.state === 'solved' || tr.state === 'revealed') && trItem.review.bestUci) shapes.push(arrow(trItem.review.bestUci, 'best'));
    if (tr.state === 'revealed') shapes.push(arrow(trItem.uci, 'played'));
  } else if (settings.value.arrows && s.engineOn && liveHere && live.lines.length) {
    shapes = engineArrows(live.lines, Math.min(3, s.multiPv)).map(sh => (live.threat ? { ...sh, brush: 'threat' } : sh));
  }

  let barScore = null;
  if (!tr) {
    if (liveHere && live.lines[0] && !live.threat) barScore = live.lines[0].score;
    else if (node.eval) barScore = node.eval.score;
  }
  const imb = materialImbalance(board.pos);
  const orientation = s.orientation;
  const headers = tree.headers || {};
  const nameOf = c => headers[c === 'white' ? 'White' : 'Black'];
  const bar = color => (nameOf('white') || nameOf('black')) ? (
    <PlayerBar name={nameOf(color) || t(`color.${color}`)} sub={headers[color === 'white' ? 'WhiteElo' : 'BlackElo'] || null} color={color}
      isEngine={/stockfish/i.test(nameOf(color) || '')} toMove={board.turnColor === color}
      clock={clockOf(node, color)}
      material={<Material pieces={imb[color]} color={color} diff={color === 'white' ? imb.diff : -imb.diff} />} />
  ) : (
    <PlayerBar name={t(`color.${color}`)} color={color} toMove={board.turnColor === color}
      material={<Material pieces={imb[color]} color={color} diff={color === 'white' ? imb.diff : -imb.diff} />} />
  );

  return (
    <div class="game-layout">
      <section class="board-col">
        {bar(opposite(orientation))}
        <div class="board-row">
          <EvalBar score={barScore} orientation={orientation} hidden={!!tr} />
          <Board
            cgRef={cgRef}
            fen={board.fen}
            orientation={orientation}
            turnColor={board.turnColor}
            lastMove={board.lastMove}
            check={board.check}
            movableColor={board.movableColor}
            dests={board.dests}
            viewOnly={board.viewOnly}
            autoShapes={shapes}
            isPromotion={(o, d) => isPromotion(board.pos, o, d)}
            onMove={(o, d, p) => analysis.onBoardMove(o + d + (p || ''))}
          />
        </div>
        {bar(orientation)}
      </section>
      <aside class="side-col">
        <AnalysisPanel s={s} node={node} live={live} version={version} trItem={trItem} />
      </aside>
      {s.menu && <VariationMenu menu={s.menu} tree={tree} />}
    </div>
  );
}

function clockOf(node, color) {
  // Show clocks from imported PGNs ([%clk]) for the side: last known value on the path.
  for (let n = node; n && n.parent; n = n.parent) if (moverOf(n) === color && n.clock !== undefined) return n.clock * 1000;
  return undefined;
}

function AnalysisPanel({ s, node, live, version, trItem }) {
  const [verdictOpen, setVerdictOpen] = useState(false);
  const tree = s.tree;
  const opening = openings.forNode(node);
  const tr = s.trainer;
  const nodes = analysis.mainlineNodes();
  const title = s.meta.title || (tree.headers.White || tree.headers.Black ? `${tree.headers.White || '?'} – ${tree.headers.Black || '?'}` : '');

  // Coach-style explanation of the selected move once reviewed.
  let fb = null;
  const rv = node.review;
  if (!tr && rv && node.parent && node.parent.eval) {
    const posBefore = posFromFen(node.parent.fen), posAfter = posFromFen(node.fen);
    const bestPv = node.parent.eval.pv || [];
    const afterPv = (node.eval && node.eval.pv) || [];
    const op = openings.forNode(node);
    const { items } = explainMove({ review: rv, mover: moverOf(node), posBefore, posAfter, bestPv, afterPv, bestSan: rv.bestSan, opening: op ? `: ${op.name}` : '' });
    fb = { nodeId: node.id, review: rv, items, bestLine: pvToSan(node.parent.fen, bestPv, 10), refLine: pvToSan(node.fen, afterPv, 10) };
  }

  return (
    <div class="panel">
      <div class="panel-head">
        {title && <div class="game-title">{title}{tree.headers.Result && tree.headers.Result !== '*' ? <span class="muted"> · {tree.headers.Result}</span> : null}</div>}
        {opening ? <div class="opening-name"><span class="eco">{opening.eco}</span> {opening.name}</div>
          : !node.parent ? <div class="opening-name muted">{t('an.startPos')}</div> : null}
      </div>

      {tr ? (
        <TrainerPanel trainer={tr} item={trItem} orientation={s.orientation}
          onReveal={() => analysis.trainerReveal()} onNext={() => analysis.trainerNext()} onEnd={() => analysis.endTrainer()} onRestart={() => analysis.trainerRestart()} />
      ) : (
        <EngineLines live={live} on={s.engineOn} onToggle={() => analysis.toggleEngine()} multiPv={s.multiPv}
          onMultiPv={n => { analysis.setMultiPv(n); updateSettings({ multiPv: n }); }} onPlay={ucis => analysis.playLine(node, ucis)}
          orientation={s.orientation} threat={s.threat} node={node} />
      )}

      {!tr && fb && <CoachCard feedback={fb} node={node} orientation={s.orientation} linesOpen={true} slim expanded={verdictOpen} onExpand={() => setVerdictOpen(v => !v)} />}

      {!tr && nodes.length > 1 && (
        <ReviewPanel state={s.review} headers={tree.headers} nodes={nodes} curId={node.id} onSelect={n => analysis.select(n)}
          onStart={() => analysis.startReview(settings.value.reviewPreset)} onCancel={() => analysis.cancelReview()}
          onPractice={side => analysis.startTrainer(side)} onJump={(dir, side) => analysis.jumpMistake(dir, side)}
          onJumpClass={(side, cls) => analysis.jumpClass(side, cls)}
          userColor={s.meta.userColor} preset={settings.value.reviewPreset} onPreset={v => updateSettings({ reviewPreset: v })} />
      )}

      <MoveList tree={tree} cur={node.id} version={version} onSelect={n => analysis.select(n)} onContext={(n, e) => analysis.openMenu(n, e)}
        showCls={n => n.review || null} />


      <div class="controls">
        <div class="nav-btns">
          <IconBtn icon="chevrons-left" title={t('nav.first')} onClick={() => analysis.first()} disabled={!node.parent || !!tr} />
          <IconBtn icon="chevron-left" title={t('nav.prev')} onClick={() => analysis.prev()} disabled={!node.parent || !!tr} />
          <IconBtn icon="chevron-right" title={t('nav.next')} onClick={() => analysis.next()} disabled={!node.children[0] || !!tr} />
          <IconBtn icon="chevrons-right" title={t('nav.last')} onClick={() => analysis.last()} disabled={!node.children[0] || !!tr} />
        </div>
        <div class="action-btns">
          <IconBtn icon="arrow-up-down" title={t('board.flip')} onClick={() => analysis.flip()} />
          <IconBtn icon="crosshair" title={t('an.threat')} onClick={() => analysis.toggleThreat()} active={s.threat} disabled={!!tr} />
          <IconBtn icon="upload" title={t('an.import')} onClick={() => openDialog('import')} />
          <IconBtn icon="download" title={t('an.export')} onClick={() => openDialog('export')} disabled={!tree.root.children.length} />
          <IconBtn icon="copy" title={t('an.copyFen')} onClick={() => copyText(node.fen).then(() => toast(t('an.fenCopied'), { type: 'success', timeout: 1500 }))} />
          <IconBtn icon="swords" title={t('an.playFromHere')} onClick={() => playFromPosition(node.fen)} disabled={!posFromFen(node.fen).hasDests()} />
          <IconBtn icon="square-pen" title={t('an.editor')} onClick={() => openDialog('editor', { fen: node.fen })} />
          <IconBtn icon="file-text" title={t('an.newBoard')} onClick={() => analysis.newBoard()} />
        </div>
      </div>
    </div>
  );
}

function VariationMenu({ menu, tree }) {
  const node = tree.get(menu.nodeId);
  if (!node) return null;
  const isMain = tree.isMainline(node);
  const canPromote = node.parent && node.parent.children.indexOf(node) > 0;
  const x = Math.min(menu.x, window.innerWidth - 230), y = Math.min(menu.y, window.innerHeight - 160);
  return (
    <div class="ctx-backdrop" onMouseDown={() => analysis.closeMenu()} onContextMenu={e => { e.preventDefault(); analysis.closeMenu(); }}>
      <div class="ctx-menu" style={{ left: `${x}px`, top: `${y}px` }} onMouseDown={e => e.stopPropagation()} role="menu">
        {!isMain && <button type="button" role="menuitem" onClick={() => analysis.makeMainline(node)}><Icon name="git-branch" size={16} /> {t('an.mainline')}</button>}
        {canPromote && <button type="button" role="menuitem" onClick={() => analysis.promote(node)}><Icon name="arrow-up" size={16} /> {t('an.promoteVar')}</button>}
        <button type="button" role="menuitem" class="danger" onClick={() => analysis.deleteNode(node)}><Icon name="trash" size={16} /> {t('an.deleteVar')}</button>
      </div>
    </div>
  );
}
