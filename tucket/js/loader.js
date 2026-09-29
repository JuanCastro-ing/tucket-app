/* TUCKET — Carga las vistas de /views dentro de #app.
   Para agregar una vista: crea views/<nombre>.html (con <div class="view" id="view-<nombre>">)
   y añade <nombre> a esta lista. */
var VIEWS = [
  "home",
  "login",
  "register",
  "events",
  "event-detail",
  "reservations",
  "agent-events",
  "agent-reservations",
  "admin-dashboard"
];

(function loadViews(){
  var app = document.getElementById('app');
  Promise.all(VIEWS.map(function(v){
    return fetch('views/' + v + '.html').then(function(r){
      if(!r.ok) throw new Error('No se pudo cargar views/' + v + '.html');
      return r.text();
    });
  })).then(function(parts){
    app.innerHTML = parts.join('\n');
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
