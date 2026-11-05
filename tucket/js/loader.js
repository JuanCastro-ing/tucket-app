/* TUCKET — Carga las vistas de /views dentro de #app.
   Para agregar una vista: crea views/<nombre>.html (con <div class="view" id="view-<nombre>">)
   y añade <nombre> a esta lista. */

/* Trozos de HTML que se repiten en varias vistas y viven en
   views/partials/. Una vista los pide escribiendo

       <div data-parcial="footer"></div>

   y aquí se sustituye por el contenido del archivo.

   El pie de página estaba copiado tal cual en siete vistas: 81 líneas
   repetidas siete veces. Cambiar un enlace obligaba a editar los siete
   archivos y acordarse de los siete, que fue justo lo que dejó un pie
   duplicado en el panel de administrador. */
var PARTIALS = ["footer"];

var VIEWS = [
  "home",
  "login",
  "register",
  "agent-request",
  "events",
  "event-detail",
  "reservations",
  "profile",
  "ayuda",
  "agent-events",
  "agent-reservations",
  "admin-dashboard"
];

(function loadViews(){
  var app = document.getElementById('app');

  function traer(ruta){
    return fetch(ruta).then(function(r){
      if(!r.ok) throw new Error('No se pudo cargar ' + ruta);
      return r.text();
    });
  }

  Promise.all([
    Promise.all(VIEWS.map(function(v){ return traer('views/' + v + '.html'); })),
    Promise.all(PARTIALS.map(function(p){ return traer('views/partials/' + p + '.html'); }))
  ]).then(function(resultado){
    var parts = resultado[0];
    var trozos = resultado[1];
    var html = parts.join('\n');

    /* Se sustituyen los marcadores antes de insertar nada en el documento:
       así el navegador analiza el HTML una sola vez y nadie llega a ver la
       página sin pie. */
    PARTIALS.forEach(function(nombre, i){
      var marcador = new RegExp('<div data-parcial="' + nombre + '"></div>', 'g');
      html = html.replace(marcador, trozos[i]);
    });

    app.innerHTML = html;
    syncSkipLink(document.querySelector('.view.active'));
    if(typeof montarBotonesVolver === 'function') montarBotonesVolver();
    if(typeof restoreAgentSession === 'function') restoreAgentSession();
    if(typeof initHeroSlider === 'function') initHeroSlider();
    if(typeof cargarCifrasPortada === 'function') cargarCifrasPortada();
  }).catch(function(err){
    app.innerHTML = '<div style="padding:40px;font-family:sans-serif;max-width:640px;margin:auto">' +
      '<h2>No se pudieron cargar las vistas</h2>' +
      '<p>Este proyecto carga cada vista desde su propio archivo, así que debe abrirse con un servidor local ' +
      '(no con doble clic). Usa la extensión <b>Live Server</b> de VS Code o ejecuta ' +
      '<code>python -m http.server</code> en esta carpeta y abre <code>http://localhost:8000</code>.</p>' +
      '<p>Si solo quieres un archivo único que abra con doble clic, ejecuta <code>python build.py</code> ' +
      'y usa <code>dist/tucket-app.html</code>.</p><small>' + err.message + '</small></div>';
  });
})();
