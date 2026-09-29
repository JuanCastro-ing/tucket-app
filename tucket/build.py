"""Une todo el proyecto en UN solo archivo: dist/tucket-app.html
(útil para abrirlo con doble clic, entregarlo o subirlo tal cual).
Uso:  python build.py
"""
import re, os
ROOT = os.path.dirname(os.path.abspath(__file__))
read = lambda p: open(os.path.join(ROOT, p), encoding='utf-8').read()

html = read('index.html')

# 1) CSS local -> <style> (en el mismo orden del index)
def inline_css(m):
    return '<style>\n' + read(m.group(1)).rstrip() + '\n</style>'
html = re.sub(r'<link rel="stylesheet" href="(css/[^"]+)">', inline_css, html)

# 2) Vistas -> en lugar de <div id="app"></div>
loader = read('js/loader.js')
views = re.findall(r'"([\w-]+)"', loader.split('var VIEWS')[1].split(']')[0])
views_html = '\n'.join(read(f'views/{v}.html').rstrip() + '\n' for v in views)
html = html.replace('<div id="app"></div>', views_html)

# 3) JS local -> <script> (sin el loader, que ya no hace falta)
html = html.replace('<script src="js/loader.js"></script>\n', '')
html = re.sub(r'<script src="(js/[^"]+)"></script>',
              lambda m: '<script>\n' + read(m.group(1)).rstrip() + '\n</script>', html)

os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
out = os.path.join(ROOT, 'dist', 'tucket-app.html')
open(out, 'w', encoding='utf-8').write(html)
print('Generado:', out, f'({html.count(chr(10))+1} líneas)')
