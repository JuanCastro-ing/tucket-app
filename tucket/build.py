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
#    Las listas de vistas y de parciales se leen del propio loader.js, para que
#    agregar una vista nueva no obligue a tocar también este archivo.
loader = read('js/loader.js')
views = re.findall(r'"([\w-]+)"', loader.split('var VIEWS')[1].split(']')[0])
partials = re.findall(r'"([\w-]+)"', loader.split('var PARTIALS')[1].split(']')[0])
views_html = '\n'.join(read(f'views/{v}.html').rstrip() + '\n' for v in views)

# Los trozos compartidos (el pie de página) se incrustan aquí igual que hace el
# loader en el navegador, así el archivo único queda idéntico a la versión que
# sirve el servidor.
for nombre in partials:
    views_html = views_html.replace(
        f'<div data-parcial="{nombre}"></div>',
        read(f'views/partials/{nombre}.html').rstrip()
    )

html = html.replace('<div id="app"></div>', views_html)

# 3) JS local -> <script> (sin el loader, que ya no hace falta).
#    Las vistas ya están incrustadas, pero las inicializaciones que hacía el
#    loader tras pintarlas siguen siendo necesarias. Deben ser EXACTAMENTE las
#    mismas que las del loader: si allí se agrega una y aquí no, el archivo
#    único se comporta distinto que la página servida, que es muy difícil de
#    depurar porque el código es el mismo.
INIT = '''<script>
document.addEventListener('DOMContentLoaded', function(){
  if(typeof syncSkipLink === 'function') syncSkipLink(document.querySelector('.view.active'));
  if(typeof montarBotonesVolver === 'function') montarBotonesVolver();
  if(typeof restoreAgentSession === 'function') restoreAgentSession();
  if(typeof initHeroSlider === 'function') initHeroSlider();
  if(typeof cargarCifrasPortada === 'function') cargarCifrasPortada();
});
</script>
'''
html = html.replace('<script src="js/loader.js"></script>\n', INIT)
html = re.sub(r'<script src="(js/[^"]+)"></script>',
              lambda m: '<script>\n' + read(m.group(1)).rstrip() + '\n</script>', html)

os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
out = os.path.join(ROOT, 'dist', 'tucket-app.html')
open(out, 'w', encoding='utf-8').write(html)
print('Generado:', out, f'({html.count(chr(10))+1} líneas)')
