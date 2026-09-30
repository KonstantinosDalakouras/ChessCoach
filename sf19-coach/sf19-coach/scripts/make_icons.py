# Renders the PNG app icons from SVG (run once; outputs are committed in src/static/icons).
import pathlib
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
jobs = [('build-icon-512.svg', 'src/static/icons/icon-512.png', 512), ('build-icon-512.svg', 'src/static/icons/icon-192.png', 192),
        ('build-icon-maskable.svg', 'src/static/icons/icon-maskable-512.png', 512)]
with sync_playwright() as p:
    b = p.chromium.launch()
    for src, out, size in jobs:
        page = b.new_page(viewport={'width': size, 'height': size}, device_scale_factor=1)
        svg = (root / src).read_text()
        old = 'width="512" height="512"'
        new = 'width="%d" height="%d"' % (size, size)
        svg = svg.replace(old, new, 1)
        page.set_content('<html><body style="margin:0;background:transparent">' + svg + '</body></html>')
        page.screenshot(path=str(root / out), omit_background=True, clip={'x': 0, 'y': 0, 'width': size, 'height': size})
        page.close()
    b.close()
print('icons done')
