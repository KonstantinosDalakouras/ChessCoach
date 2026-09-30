import sys, time, json, subprocess
sys.path.insert(0, '/home/claude/sf19coach/tests/e2e')
from helpers import *
from playwright.sync_api import sync_playwright

def run(url, variant, label, block_sw=False, threads=None, offline_check=False):
    logs = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1280, 'height': 800}, service_workers='block' if block_sw else 'allow')
        page = ctx.new_page()
        attach_logs(page, logs)
        settings = {'welcomed': True, 'variant': variant, 'lang': 'el'}
        if threads: settings['threads'] = threads
        page.add_init_script("localStorage.setItem('sf19c.settings.v1', JSON.stringify(%s))" % json.dumps(settings))
        t0 = time.time()
        page.goto(url)
        page.wait_for_function("window.__sf19 && ['ready','error'].includes(window.__sf19.engineManager.state.value.status)", timeout=600000)
        st = page.evaluate("JSON.stringify({s: __sf19.engineManager.state.value.status, e: __sf19.engineManager.state.value.error, name: __sf19.engineManager.state.value.name, build: __sf19.engineManager.state.value.build && __sf19.engineManager.state.value.build.name, threads: __sf19.engineManager.state.value.threads, coi: crossOriginIsolated, sw: !!navigator.serviceWorker && !!navigator.serviceWorker.controller})")
        print(f'[{label}] {time.time()-t0:.1f}s', st)
        # quick analysis
        res = page.evaluate("""async () => { const s = __sf19.engineManager.search({ fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3', limits: { depth: 16 }, options: { MultiPV: 2 } }); const r = await s.promise; return { depth: r.depth, nps: r.nps, best: r.bestmove, err: r.error, lines: r.lines.length }; }""")
        print(f'[{label}] search:', res)
        if offline_check:
            time.sleep(2)
            ctx.set_offline(True)
            page.reload()
            page.wait_for_function("window.__sf19 && ['ready','error'].includes(window.__sf19.engineManager.state.value.status)", timeout=120000)
            st2 = page.evaluate("JSON.stringify({s: __sf19.engineManager.state.value.status, build: __sf19.engineManager.state.value.build && __sf19.engineManager.state.value.build.name, coi: crossOriginIsolated})")
            print(f'[{label}] offline reload:', st2)
            ctx.set_offline(False)
        b.close()
    errs = [l for l in logs if 'error' in l.lower()]
    if errs: print(f'[{label}] console:', '\n'.join(errs[-8:]))

mode = sys.argv[1]
if mode == 'full-mt':
    run('http://localhost:8080/', 'full', 'full MT (COI headers)', threads=2)
elif mode == 'lite-offline':
    run('http://localhost:8080/', 'lite', 'lite + offline', offline_check=True)
elif mode == 'nocoi-sw':
    run('http://localhost:8081/', 'lite', 'no headers, SW isolation')
elif mode == 'nocoi-nosw':
    run('http://localhost:8081/', 'lite', 'no headers, no SW', block_sw=True)
elif mode == 'badmime-nosw':
    run('http://localhost:8082/', 'lite', 'bad wasm mime, no SW', block_sw=True)
elif mode == 'full-st-nosw':
    run('http://localhost:8081/', 'full', 'full ST (no COI, no SW)', block_sw=True)
