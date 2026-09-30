import time, json

def square_center(page, sq, board_sel='.board-col .board-wrap'):
    box = page.locator(board_sel).first.bounding_box()
    orient = page.evaluate("document.querySelector('%s .cg-wrap').classList.contains('orientation-black') ? 'black' : 'white'" % board_sel)
    f = ord(sq[0]) - 97
    r = int(sq[1]) - 1
    size = box['width'] / 8
    if orient == 'white':
        x = box['x'] + (f + 0.5) * size
        y = box['y'] + (7 - r + 0.5) * size
    else:
        x = box['x'] + (7 - f + 0.5) * size
        y = box['y'] + (r + 0.5) * size
    return x, y

def click_move(page, uci, board_sel='.board-col .board-wrap'):
    x, y = square_center(page, uci[:2], board_sel)
    page.mouse.click(x, y)
    time.sleep(0.08)
    x, y = square_center(page, uci[2:4], board_sel)
    page.mouse.click(x, y)
    time.sleep(0.15)

def drag_move(page, uci, board_sel='.board-col .board-wrap'):
    x, y = square_center(page, uci[:2], board_sel)
    x2, y2 = square_center(page, uci[2:4], board_sel)
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move((x + x2) / 2, (y + y2) / 2, steps=4)
    page.mouse.move(x2, y2, steps=4)
    page.mouse.up()
    time.sleep(0.15)

def play_state(page):
    return page.evaluate("""(() => { const s = __sf19.playState.value; const t = s.tree;
      return { status: s.status, phase: s.phase, cur: s.cur, moves: t ? t.mainline().map(n => n.san) : [],
        fb: s.feedback ? { pending: s.feedback.pending, cls: s.feedback.review && s.feedback.review.cls } : null,
        result: s.result, hint: s.hint && s.hint.level, stats: s.stats } })()""")

def wait_phase(page, phase, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = play_state(page)
        if st['phase'] == phase or (phase == 'over' and st['status'] == 'over'):
            return st
        time.sleep(0.2)
    raise TimeoutError('phase %s not reached: %s' % (phase, play_state(page)))

def new_browser(p, width=1440, height=900, mobile=False):
    b = p.chromium.launch()
    kw = dict(viewport={'width': width, 'height': height}, device_scale_factor=1)
    if mobile:
        kw.update(is_mobile=True, has_touch=True, device_scale_factor=2)
    ctx = b.new_context(**kw)
    return b, ctx

def attach_logs(page, logs):
    page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))

def boot(page, url, variant='lite'):
    page.goto(url)
    page.wait_for_selector('.app', timeout=20000)
    time.sleep(0.3)
    if page.locator('.modal-welcome').count():
        if variant == 'lite':
            page.locator('.modal-welcome .mode-card').nth(1).click()
        page.locator('.modal-welcome .modal-foot button').click()
    page.wait_for_function("window.__sf19 && window.__sf19.engineManager.state.value.status === 'ready'", timeout=300000)
