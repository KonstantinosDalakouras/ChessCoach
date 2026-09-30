import sys, time, json
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8080/'
variant = sys.argv[2] if len(sys.argv) > 2 else 'lite'
logs = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--enable-features=SharedArrayBuffer'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
    page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    page.goto(URL)
    page.wait_for_selector('.app', timeout=20000)
    time.sleep(0.5)
    print('isolated:', page.evaluate('crossOriginIsolated'))
    page.screenshot(path='/tmp/shots/01-welcome.png')
    # welcome dialog
    if page.locator('.modal-welcome').count():
        if variant == 'lite':
            page.locator('.modal-welcome .mode-card').nth(1).click()
        page.locator('.modal-welcome .modal-foot button').click()
    t0 = time.time()
    page.wait_for_function("window.__sf19 && window.__sf19.engineManager.state.value.status === 'ready'", timeout=300000)
    print('engine ready in %.1fs' % (time.time() - t0), page.evaluate("JSON.stringify({name: __sf19.engineManager.state.value.name, build: __sf19.engineManager.state.value.build.name, threads: __sf19.engineManager.state.value.threads})"))
    page.screenshot(path='/tmp/shots/02-ready.png')
    b.close()
print('\n'.join(logs[-30:]))
