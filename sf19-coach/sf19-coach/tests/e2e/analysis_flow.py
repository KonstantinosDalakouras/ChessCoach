import sys, time, json
sys.path.insert(0, '/home/claude/sf19coach/tests/e2e')
from helpers import *
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8080/'
PGN = """[Event "Casual game"]
[White "Konstantinos"]
[Black "Opponent"]
[Result "0-1"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# 0-1"""
logs = []
with sync_playwright() as p:
    b, ctx = new_browser(p)
    page = ctx.new_page()
    attach_logs(page, logs)
    boot(page, URL, 'lite')
    page.evaluate("localStorage.setItem('sf19c.settings.v1', JSON.stringify({...JSON.parse(localStorage.getItem('sf19c.settings.v1')), playerName: 'Konstantinos', reviewPreset: 'fast'}))")
    page.reload()
    page.wait_for_function("window.__sf19 && window.__sf19.engineManager.state.value.status === 'ready'", timeout=60000)
    page.locator('.tab').nth(1).click()
    time.sleep(1.5)
    page.screenshot(path='/tmp/shots/20-analysis-empty.png')
    # import
    page.locator('.action-btns button[title="Εισαγωγή PGN/FEN"]').click()
    page.locator('.modal textarea').fill(PGN)
    page.locator('.modal .modal-foot .btn-primary').click()
    page.wait_for_function("__sf19.anState.value.review.status === 'done'", timeout=240000)
    time.sleep(0.8)
    page.screenshot(path='/tmp/shots/21-imported-reviewed.png')
    st = page.evaluate("(() => { const s = __sf19.anState.value; return { user: s.meta.userColor, sum: s.review.summary && { w: s.review.summary.white.accuracy, b: s.review.summary.black.accuracy }, cls: s.tree.mainline().map(n => n.san + ':' + (n.review && n.review.cls)) } })()")
    print(json.dumps(st))
    # jump to next mistake of white
    page.locator('.review-actions button[title="Επόμενο λάθος"]').click()
    time.sleep(1.5)
    page.screenshot(path='/tmp/shots/22-mistake.png')
    # practice
    page.locator('.review-actions .btn-primary').click()
    time.sleep(0.5)
    page.screenshot(path='/tmp/shots/23-trainer.png')
    tr = page.evaluate("(() => { const s = __sf19.anState.value; const it = __sf19.analysis.trainerItem(); return { n: s.trainer.items.length, best: it.review.bestUci, played: it.uci, fen: it.parent.fen } })()")
    print('trainer:', tr)
    # wrong attempt: play a random legal non-best move
    wrong = page.evaluate("""(() => { const it = __sf19.analysis.trainerItem(); const lines = it.parent.eval.lines; 
       const pos = it.parent.fen; return null })()""")
    # make the played (bad) move again -> should be wrong
    drag_move(page, tr['played'])
    time.sleep(2.5)
    page.screenshot(path='/tmp/shots/24-trainer-wrong.png')
    print('state after wrong:', page.evaluate("__sf19.anState.value.trainer.state"))
    time.sleep(1.5)
    # correct
    drag_move(page, tr['best'])
    time.sleep(1.0)
    print('state after best:', page.evaluate("__sf19.anState.value.trainer.state"))
    page.screenshot(path='/tmp/shots/25-trainer-solved.png')
    # next until finished
    for i in range(10):
        s = page.evaluate("__sf19.anState.value.trainer && __sf19.anState.value.trainer.state")
        if s == 'finished' or s is None: break
        if s in ('solving', 'wrong'):
            page.locator('.trainer-actions .btn', has_text='Λύση').click(); time.sleep(0.3)
        page.locator('.trainer-actions .btn-primary').click(); time.sleep(0.4)
    page.screenshot(path='/tmp/shots/26-trainer-finished.png')
    page.locator('.trainer-actions .btn-primary').click()
    time.sleep(1)
    # variations: go to move 3 (Bc4) and play an alternative 3...Nf6 via board
    page.evaluate("(() => { const a = __sf19.analysis; const n = a.tree.mainline()[4]; a.select(n); })()")
    time.sleep(0.5)
    drag_move(page, 'g8f6')
    time.sleep(0.4)
    drag_move(page, 'f3g5')
    time.sleep(2.0)
    page.screenshot(path='/tmp/shots/27-variation.png')
    # click first engine PV move
    page.locator('.pv-row .pv-move').first.click()
    time.sleep(1.5)
    page.screenshot(path='/tmp/shots/28-pv-click.png')
    # context menu on a variation move
    mv = page.locator('.variations .mv').first
    mv.click(button='right')
    time.sleep(0.3)
    page.screenshot(path='/tmp/shots/29-ctx.png')
    page.locator('.ctx-menu button').first.click()
    time.sleep(0.5)
    # export dialog
    page.locator('.action-btns button[title="Εξαγωγή PGN"]').click()
    time.sleep(0.5)
    page.screenshot(path='/tmp/shots/30-export.png')
    pgn = page.locator('.modal textarea').input_value()
    print('PGN head:', pgn[:400].replace('\n', ' | '))
    page.keyboard.press('Escape')
    time.sleep(0.3)
    # library
    page.locator('.tab').nth(2).click()
    time.sleep(1)
    page.screenshot(path='/tmp/shots/31-library.png')
    # settings & help & editor
    page.locator('.header-right button[title="Ρυθμίσεις"]').click(); time.sleep(0.5)
    page.screenshot(path='/tmp/shots/32-settings.png'); page.keyboard.press('Escape'); time.sleep(0.3)
    page.locator('.header-right button[title="Βοήθεια"]').click(); time.sleep(0.5)
    page.screenshot(path='/tmp/shots/33-help.png'); page.keyboard.press('Escape'); time.sleep(0.3)
    page.locator('.tab').nth(1).click(); time.sleep(0.5)
    page.locator('.action-btns button[title="Επεξεργασία θέσης"]').click(); time.sleep(0.8)
    page.screenshot(path='/tmp/shots/34-editor.png'); page.keyboard.press('Escape')
    # english
    page.locator('.lang-btn').click(); time.sleep(0.5)
    page.screenshot(path='/tmp/shots/35-english.png')
    b.close()
print('\n'.join(logs[-40:]))
