import sys, time, json
sys.path.insert(0, '/home/claude/sf19coach/tests/e2e')
from helpers import *
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8080/'
logs = []
with sync_playwright() as p:
    b, ctx = new_browser(p)
    page = ctx.new_page()
    attach_logs(page, logs)
    boot(page, URL, 'lite')
    # New game dialog
    page.locator('.play-welcome .btn-primary').click()
    page.wait_for_selector('.modal-newgame')
    page.screenshot(path='/tmp/shots/10-newgame.png')
    page.locator('.modal-newgame .color-opt').nth(0).click()  # white
    page.locator('.modal-newgame .modal-foot .btn-primary').click()
    st = wait_phase(page, 'user', 30)
    print('start:', st)
    click_move(page, 'e2e4')
    st = play_state(page); print('after e4:', st)
    st = wait_phase(page, 'user', 60)
    print('after engine reply:', st)
    page.screenshot(path='/tmp/shots/11-after-e4.png')
    # deliberately bad move: Ba6 (bishop hangs in most lines) or Qh5 if a6 blocked
    legal = page.evaluate("(() => { const s = __sf19.playState.value; const n = s.tree.lineEnd(s.tree.root); return n.fen })()")
    print('fen:', legal)
    move = 'f1a6'
    drag_move(page, move)
    t0 = time.time()
    while time.time() - t0 < 60:
        st = play_state(page)
        if st['phase'] in ('paused', 'user', 'engine') and st['fb'] and not st['fb']['pending']:
            break
        time.sleep(0.2)
    print('after Ba6:', st)
    page.screenshot(path='/tmp/shots/12-ba6.png')
    if st['phase'] == 'paused':
        page.locator('.coach-actions .btn', has_text='Ξαναπροσπάθησε').click()
        st = wait_phase(page, 'user', 30)
        print('after retry:', st)
    # hint
    page.keyboard.press('h')
    time.sleep(3)
    page.keyboard.press('h')
    time.sleep(0.5)
    st = play_state(page); print('hint level:', st['hint'])
    page.screenshot(path='/tmp/shots/13-hint.png')
    # play a normal move: d2d4
    click_move(page, 'd2d4')
    st = wait_phase(page, 'user', 60)
    print('after d4:', st)
    page.screenshot(path='/tmp/shots/14-d4.png')
    # resign
    page.locator('.action-btns button[title="Εγκατάλειψη"]').click()
    page.locator('.modal-confirm .btn-danger').click()
    st = wait_phase(page, 'over', 10)
    print('over:', st['status'], st['result'])
    time.sleep(0.5)
    page.screenshot(path='/tmp/shots/15-over.png')
    # review
    page.locator('.result-card .btn-primary').click()
    page.wait_for_function("__sf19.anState.value.review.status === 'done'", timeout=180000)
    time.sleep(0.5)
    page.screenshot(path='/tmp/shots/16-review.png')
    summary = page.evaluate("JSON.stringify(__sf19.anState.value.review.summary)")
    print('summary:', summary)
    b.close()
print('\n'.join(logs[-40:]))
