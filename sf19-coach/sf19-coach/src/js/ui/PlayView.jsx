import { h } from 'preact';
import { useMemo, useRef, useState, useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import { t } from '../i18n.js';
import { play, playState, playLive, playVersion, playClock, engineDisplayName } from '../controllers/play.js';
import { settings } from '../store.js';
import { Board, arrow, circle } from './Board.jsx';
import { EvalBar, PlayerBar, Material } from './BoardParts.jsx';
import { MoveList } from './MoveList.jsx';
import { CoachCard, explanationText } from './Panels.jsx';
import { Btn, IconBtn, Icon, Spinner, confirmDialog, San } from './common.jsx';
import { PvLine } from './Pv.jsx';
import { posFromFen, destsOf, isPromotion, materialImbalance, opposite } from '../chess/util.js';
import { formatScore } from '../chess/score.js';
import { openings } from '../game/openings.js';
import { openDialog, levelLabel } from './dialogs.jsx';
import { goReview, goAnalyseFromPlay } from '../app-actions.js';

export const playFlip = signal(false);

export function PlayView() {
  const s = playState.value;
  const version = playVersion.value; // subscribe to tree mutations
  const live = playLive.value;
  const clock = playClock.value;
  const flipped = playFlip.value;
  const [bestFor, setBestFor] = useState(null); // user-move node id whose better alternative is shown
  const cgRef = useRef();
  const tree = s.tree;
  const cfg = s.config;
  const userColor = cfg ? cfg.userColor : 'white';
  const orientation = flipped ? opposite(userColor) : userColor;
  const liveNode = tree ? play.liveNode() : null;
  const node = tree ? tree.get(s.cur) || liveNode : null;
  const atLive = !!node && !!liveNode && node.id === liveNode.id;

  useEffect(() => {
    if (!bestFor || !tree) return;
    const n = tree.get(bestFor);
    if (!n || !n.parent || s.cur !== n.parent.id) setBestFor(null);
  }, [s.cur, version]);
  // Execute a premove once it's our turn again.
  useEffect(() => {
    if (s.status === 'playing' && s.phase === 'user' && atLive && cgRef.current) {
      setTimeout(() => cgRef.current && cgRef.current.playPremove(), 20);
    }
  }, [s.phase, version]);
  // Flip back to the player's side on a new game.
  useEffect(() => { playFlip.value = false; }, [tree]);
  // Drop a pending premove when the game ends or moves are taken back.
  useEffect(() => { if (cgRef.current) cgRef.current.cancelPremove(); }, [s.status, s.stats.takebacks, tree]);

  const board = useMemo(() => {
    if (!node) return { fen: '8/8/8/8/8/8/8/8 w - - 0 1' };
    const pos = posFromFen(node.fen);
    const turn = pos.turn;
    const playing = s.status === 'playing';
    const canMove = playing && atLive && s.phase === 'user' && turn === userColor;
    const canPremove = playing && atLive && (s.phase === 'engine') && turn !== userColor;
    return {
      fen: node.fen,
      turnColor: turn,
      lastMove: node.uci ? [node.uci.slice(0, 2), node.uci.slice(2, 4)] : undefined,
      check: pos.isCheck() ? turn : false,
      movableColor: canMove || canPremove ? userColor : undefined,
      dests: canMove ? destsOf(pos) : new Map(),
      premove: canPremove,
      viewOnly: !(canMove || canPremove),
      pos,
    };
  }, [node && node.id, s.phase, s.status, atLive, version]);

  if (s.status === 'idle' || !tree) return <PlayWelcome />;

  // ---- board decorations
  const shapes = [];
  // Which coach card to show: the pinned "show best" move, the latest move, or the move being viewed.
  let cardNodeId = null;
  if (bestFor && tree.get(bestFor)) cardNodeId = bestFor;
  else if (atLive && s.feedback) cardNodeId = s.feedback.nodeId;
  else if (node && node.coach) cardNodeId = node.id;
  const cardNode = cardNodeId ? tree.get(cardNodeId) : null;
  const cardFeedback = atLive && !bestFor && s.feedback && s.feedback.pending ? s.feedback : cardNode ? play.feedbackFor(cardNode) : null;
  if (s.hint && s.hint.nodeId === node.id && atLive) {
    if (s.hint.level === 1) shapes.push(circle(s.hint.uci.slice(0, 2), 'hint'));
    else shapes.push(arrow(s.hint.uci, 'hint'));
  }
  if (s.threat && s.threat.nodeId === node.id && s.threat.uci && !s.threat.none) shapes.push(arrow(s.threat.uci, 'threat'));
  if (bestFor && cardNode && cardNode.parent && node.id === cardNode.parent.id && cardNode.coach) {
    shapes.push(arrow(cardNode.uci, 'played'));
    if (cardNode.coach.bestUci) shapes.push(arrow(cardNode.coach.bestUci, 'best'));
  }

  // ---- eval bar score
  let barScore = null;
  if (cfg.evalbar || s.status === 'over') {
    if (live && live.nodeId === node.id && live.lines[0]) barScore = live.lines[0].score;
    else if (node.eval) barScore = node.eval.score;
    else if (node.parent && node.parent.eval && node.coach) barScore = node.coach.afterScore;
  }

  const imb = materialImbalance(board.pos);
  const me = settings.value.playerName || t('side.you');
  const sfName = engineDisplayName(cfg);
  const running = clock.running;
  const clockFor = c => (cfg.clock ? (running === c ? clock[c] - (performance.now() - clock.since) : clock[c]) : null);
  const bar = color => (
    <PlayerBar
      name={color === userColor ? me : sfName}
      sub={color === userColor ? null : (cfg.elo ? `Elo ${cfg.elo} · ${levelLabel(cfg.elo)}` : t('lvl.max'))}
      color={color}
      isEngine={color !== userColor}
      clock={clockFor(color)}
      clockRunning={running === color}
      lowTime={cfg.clock && clockFor(color) < 20000}
      toMove={s.status === 'playing' && board.turnColor === color && atLive}
      thinking={color !== userColor && s.phase === 'engine' && s.status === 'playing'}
      material={<Material pieces={imb[color]} color={color} diff={color === 'white' ? imb.diff : -imb.diff} />}
    />
  );
  const topColor = opposite(orientation);

  const onMove = (orig, dest, promo) => {
    const uci = orig + dest + (promo || '');
    if (!play.onUserMove(uci)) {
      // rejected (e.g. not our turn anymore): reset the board
      cgRef.current && cgRef.current.set({ fen: node.fen });
    }
  };

  return (
    <div class="game-layout">
      <section class="board-col">
        {bar(topColor)}
        <div class="board-row">
          <EvalBar score={barScore} orientation={orientation} hidden={!(cfg.evalbar || s.status === 'over')} thinking={s.phase === 'engine'} />
          <Board
            cgRef={cgRef}
            fen={board.fen}
            orientation={orientation}
            turnColor={board.turnColor}
            lastMove={board.lastMove}
            check={board.check}
            movableColor={board.movableColor}
            dests={board.dests}
            premove={board.premove}
            viewOnly={board.viewOnly}
            autoShapes={shapes}
            isPromotion={(o, d) => isPromotion(board.pos, o, d) || (board.premove && isPromotionPremove(board.pos, o, d, userColor))}
            onMove={onMove}
            overlay={!atLive && s.status === 'playing' ? (
              <button type="button" class="history-banner" onClick={() => play.select(liveNode)}>
                <Icon name="chevrons-right" size={16} /> {t('board.backToGame')}
              </button>
            ) : null}
          />
        </div>
        {bar(orientation)}
      </section>
      <aside class="side-col">
        <PlayPanel s={s} node={node} liveNode={liveNode} atLive={atLive} cardFeedback={cardFeedback} cardNode={cardNode}
          showBest={!!bestFor} onToggleBest={() => {
            if (bestFor) { setBestFor(null); play.select(liveNode); }
            else if (cardNode && cardNode.parent) { setBestFor(cardNode.id); play.select(cardNode.parent); }
          }} orientation={orientation} onFlip={() => { playFlip.value = !playFlip.value; }} version={version} />
      </aside>
    </div>
  );
}

function isPromotionPremove(pos, orig, dest, color) {
  const p = pos.board.get(orig.charCodeAt(0) - 97 + (orig.charCodeAt(1) - 49) * 8);
  if (!p || p.role !== 'pawn' || p.color !== color) return false;
  return (color === 'white' && dest[1] === '8') || (color === 'black' && dest[1] === '1');
}

function PlayWelcome() {
  return (
    <div class="play-welcome">
      <div class="welcome-card">
        <div class="welcome-art" aria-hidden="true"><i class="pc pc-knight-white" /><i class="pc pc-king-black" /></div>
        <h1>{t('play.welcomeTitle')}</h1>
        <p>{t('play.welcomeText')}</p>
        <Btn variant="primary" icon="swords" label={t('play.newGame')} onClick={() => openDialog('newGame')} class="btn-lg" />
      </div>
    </div>
  );
}

function statusText(s) {
  if (s.status !== 'playing') return null;
  switch (s.phase) {
    case 'user': return t('play.yourTurn');
    case 'engine': return t('play.engineTurn');
    case 'coaching': return t('play.coaching');
    case 'paused': return t('play.paused');
    default: return '';
  }
}

function resultTitle(s) {
  const r = s.result;
  if (!r) return '';
  const user = s.config.userColor;
  if (!r.winner) return t('res.youDraw');
  return r.winner === user ? t('res.youWin') : t('res.youLose');
}

function PlayPanel({ s, node, liveNode, atLive, cardFeedback, cardNode, showBest, onToggleBest, orientation, onFlip, version }) {
  const cfg = s.config;
  const tree = s.tree;
  const opening = openings.forNode(node);
  const playing = s.status === 'playing';
  const paused = playing && s.phase === 'paused';
  const cardIsLatest = cardNode && cardNode === liveNode;
  const hint = s.hint && s.hint.nodeId === (liveNode && liveNode.id) ? s.hint : null;
  const threat = s.threat && s.threat.nodeId === (liveNode && liveNode.id) ? s.threat : null;

  const nav = {
    first: () => play.select(tree.root),
    prev: () => node.parent && play.select(node.parent),
    next: () => node.children[0] && play.select(node.children[0]),
    last: () => play.select(liveNode),
  };

  return (
    <div class="panel">
      <div class="panel-head">
        <div class="game-chips">
          <span class="chip"><Icon name="cpu" size={13} /> {cfg.elo ? `Elo ${cfg.elo}` : t('play.maxStrength')}</span>
          <span class={`chip ${cfg.mode === 'training' ? 'chip-accent' : ''}`}><Icon name={cfg.mode === 'training' ? 'graduation-cap' : 'swords'} size={13} /> {cfg.mode === 'training' ? t('ng.training') : t('ng.normal')}</span>
          <span class="chip"><Icon name="clock" size={13} /> {cfg.clock ? `${cfg.clock.base / 60000}+${cfg.clock.inc / 1000}` : t('play.noClock')}</span>
          {(s.stats.hints > 0 || s.stats.takebacks > 0) && (
            <span class="game-stats" title={t('play.stats', s.stats)}>
              <span><Icon name="lightbulb" size={13} />{s.stats.hints}</span>
              <span><Icon name="undo-2" size={13} />{s.stats.takebacks}</span>
            </span>
          )}
        </div>
        {opening && <div class="opening-name" title={`${opening.eco} ${opening.name}`}><span class="eco">{opening.eco}</span> {opening.name}</div>}
      </div>

      {s.status === 'over' && (
        <div class={`result-card ${s.result.winner ? (s.result.winner === cfg.userColor ? 'win' : 'loss') : 'draw'}`}>
          <div class="result-title">{resultTitle(s)}</div>
          <div class="result-sub">{s.tree.headers.Result} · {t(`reason.${s.result.reason}`)}</div>
          <div class="result-actions">
            <Btn variant="primary" icon="scan-search" label={t('play.review')} onClick={goReview} />
            <Btn icon="refresh-cw" label={t('play.rematch')} onClick={() => play.rematch()} />
            <Btn icon="plus" label={t('play.newGame')} onClick={() => openDialog('newGame')} />
          </div>
        </div>
      )}

      {playing && (
        <div class={`turn-line phase-${s.phase}`}>
          {(s.phase === 'engine' || s.phase === 'coaching') && <Spinner size={14} />}
          {s.phase === 'user' && <span class={`dot ${cfg.userColor}`} />}
          <span>{statusText(s)}</span>
        </div>
      )}

      {s.alert && atLive && s.alert.nodeId === liveNode.id && playing && s.phase === 'user' && (
        <div class={`alert-card ${s.alert.level}`}><Icon name="zap" size={16} /> {t(s.alert.level === 'blunder' ? 'play.oppBlunder' : 'play.oppMistake')}</div>
      )}

      {cfg.coach ? (
        cardFeedback ? (
          <CoachCard feedback={cardFeedback} node={cardNode || (cardFeedback.nodeId && tree.get(cardFeedback.nodeId))} paused={paused && cardIsLatest}
            canRetry={playing && cfg.takebacks && !!cardNode && (cardIsLatest || cardNode.children[0] === liveNode)}
            onRetry={() => play.retry()} onContinue={() => play.continueGame()} showBest={showBest} onToggleBest={onToggleBest} orientation={orientation} />
        ) : playing ? <div class="coach-card empty"><Icon name="graduation-cap" size={18} /> {t('coach.waiting')}</div> : null
      ) : playing ? <div class="coach-card empty muted"><Icon name="info" size={16} /> {t('coach.normalMode')}</div> : null}

      {hint && (
        <div class="hint-card">
          <Icon name="lightbulb" size={16} />
          <span>
            {hint.level === 1 && t('play.hintLevel1')}
            {hint.level === 2 && <>{t('play.hintLevel2', { move: '' })}<San san={hint.san} /></>}
            {hint.level === 3 && <>{t('play.hintLevel2', { move: '' })}<San san={hint.san} /> <span class="muted">({formatScore(hint.score)})</span><div class="hint-line"><PvLine moves={hint.line} max={8} orientation={orientation} /></div></>}
          </span>
        </div>
      )}
      {threat && (
        <div class="hint-card threat">
          <Icon name="crosshair" size={16} />
          <span>
            {threat.pending && <Spinner size={12} />}
            {threat.inCheck && t('play.threatInCheck')}
            {threat.none && !threat.pending && t('play.noThreat')}
            {!threat.none && !threat.inCheck && threat.uci && <>{t('play.threatLabel')} <San san={threat.san} /> <span class="muted">({formatScore(threat.score)})</span></>}
          </span>
        </div>
      )}

      <MoveList tree={tree} cur={node.id} version={version} onSelect={n => play.select(n)}
        showCls={n => (n.review ? n.review : (n.ply % 2 === 1 ? 'white' : 'black') === cfg.userColor ? n.coach : null)} empty={t('play.yourTurn')} />

      <div class="controls">
        <div class="nav-btns">
          <IconBtn icon="chevrons-left" title={t('nav.first')} onClick={nav.first} disabled={!node.parent} />
          <IconBtn icon="chevron-left" title={t('nav.prev')} onClick={nav.prev} disabled={!node.parent} />
          <IconBtn icon="chevron-right" title={t('nav.next')} onClick={nav.next} disabled={!node.children[0]} />
          <IconBtn icon="chevrons-right" title={t('nav.last')} onClick={nav.last} disabled={atLive} />
        </div>
        <div class="action-btns">
          {playing && <IconBtn icon="lightbulb" title={cfg.hints ? t('play.hint') : t('play.hintOff')} onClick={() => play.hint()} disabled={!cfg.hints || s.phase !== 'user' || !atLive} />}
          {playing && <IconBtn icon="crosshair" title={cfg.hints ? t('play.threat') : t('play.hintOff')} onClick={() => play.threat()} disabled={!cfg.hints || s.phase !== 'user' || !atLive} />}
          {playing && <IconBtn icon="undo-2" title={cfg.takebacks ? t('play.takeback') : t('play.takebackOff')} onClick={() => play.takeback()} disabled={!cfg.takebacks || !liveNode.parent} />}
          <IconBtn icon="arrow-up-down" title={t('board.flip')} onClick={onFlip} />
          {playing && <IconBtn icon="handshake" title={t('play.offerDraw')} onClick={() => play.offerDraw()} disabled={s.phase !== 'user'} />}
          {playing && <IconBtn icon="flag" title={t('play.resign')} onClick={async () => { if (await confirmDialog(t('play.resignConfirm'), { okLabel: t('play.resign'), danger: true })) play.resign(); }} />}
          {!playing && <IconBtn icon="microscope" title={t('play.analyse')} onClick={() => goAnalyseFromPlay(node)} />}
          <IconBtn icon="plus" title={t('play.newGame')} onClick={() => openDialog('newGame')} class="accent" />
        </div>
      </div>
    </div>
  );
}

export { explanationText };
