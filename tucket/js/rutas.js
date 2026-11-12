/* TUCKET — Rutas en la URL

   Tucket es una sola página: todas las vistas viven dentro de index.html y
   se muestran u ocultan con la clase .active. Eso traía dos problemas:
   recargar devolvía siempre al inicio, y las flechas de atrás y adelante
   del navegador sacaban del sitio en lugar de moverse entre vistas.

   La solución es escribir la vista en la parte de la URL que va después
   de la almohadilla:

       http://localhost:8000/#/events
       http://localhost:8000/#/event-detail/EVT-00012

   Ese trozo no viaja al servidor, así que no hay que configurar nada en
   Render: el servidor sigue entregando index.html y el navegador se
   encarga del resto.

   Se usa history.pushState en lugar de asignar location.hash porque
   pushState no dispara ningún evento: así escribir la URL no vuelve a
   lanzar la navegación y no hacen falta banderas para cortar el bucle.
   Las flechas del navegador sí disparan popstate, que es donde se aplica
   la ruta. */

var RUTA_INICIAL = 'home';

/* Cuántas entradas de historial ha creado la propia aplicación. Sirve para
   que el botón «Volver» no saque del sitio cuando se entró directamente
   por un enlace. */
var profundidadDeRuta = 0;

/* ---------- Leer y escribir la URL ---------- */

/* Las rutas de TUCKET siempre llevan barra: '#/events', '#/profile'.
   Un '#' seguido de un nombre a secas —'#agentes', '#ayuda-faq',
   '#main-content'— no es una ruta sino un ancla dentro de la página: el
   menú lateral del panel, los índices de la ayuda y el enlace de saltar al
   contenido. El navegador los resuelve solo, bajando hasta esa sección.

   Hay que distinguirlos. Si el enrutador trata un ancla como ruta, busca
   una vista llamada 'agentes', no la encuentra y devuelve al inicio: el
   menú del panel dejaba de funcionar por completo. */
function esRutaDeTucket(){
  var hash = location.hash || '';
  return hash === '' || hash.indexOf('#/') === 0;
}

/* '#/event-detail/EVT-00012' → { vista:'event-detail', parametro:'EVT-00012' } */
function rutaDesdeHash(){
  var crudo = (location.hash || '').replace(/^#\/?/, '');
  if(!crudo) return { vista: RUTA_INICIAL, parametro: null };
  var partes = crudo.split('/');
  return { vista: partes[0], parametro: partes[1] ? decodeURIComponent(partes[1]) : null };
}

/* La vista que se está mostrando ahora mismo, en el mismo formato que la
   URL. Comparar las dos cadenas evita aplicar dos veces la misma ruta. */
function rutaEnPantalla(){
  var vista = typeof vistaActual === 'function' ? vistaActual() : null;
  if(!vista) return null;
  if(vista === 'event-detail' && window.selectedPublicEvent){
    return vista + '/' + window.selectedPublicEvent.code;
  }
  return vista;
}

function textoDeRuta(viewId){
  if(viewId === 'event-detail' && window.selectedPublicEvent){
    return viewId + '/' + encodeURIComponent(window.selectedPublicEvent.code);
  }
  return viewId;
}

/* La llama nav() cada vez que se muestra una vista. Si la URL ya dice esa
   misma ruta no se apila nada: así recargar o volver no deja entradas
   repetidas que obliguen a pulsar «atrás» dos veces para moverse una. */
function escribirRuta(viewId){
  if(!viewId) return;
  var destino = '#/' + textoDeRuta(viewId);
  if(location.hash === destino) return;
  profundidadDeRuta += 1;
  history.pushState({ tucket: profundidadDeRuta }, '', destino);
}

/* ---------- Aplicar la ruta ---------- */

/* El detalle de evento necesita además el evento: la vista se rellena con
   los datos que ya están en memoria. Al recargar esa memoria está vacía,
   así que primero se pide la cartelera y después se abre el evento.
   Si el código ya no existe —el evento se eliminó— lleva a la cartelera
   en lugar de dejar una pantalla vacía. */
function abrirDetallePorCodigo(code){
  var hayCartelera = typeof publicEvents !== 'undefined' && publicEvents && publicEvents.length;
  var listo = hayCartelera || typeof loadPublicEvents !== 'function'
    ? Promise.resolve()
    : loadPublicEvents();

  return Promise.resolve(listo).then(function(){
    var existe = typeof publicEvents !== 'undefined' && publicEvents &&
      publicEvents.some(function(e){ return e.code === code; });
    if(existe && typeof openEventDetails === 'function') return openEventDetails(code);
    return nav('events');
  }).catch(function(){
    return nav('events');
  });
}

function aplicarRutaActual(){
  /* Un ancla dentro de la página no cambia de vista: la deja quieta y el
     navegador baja hasta la sección. */
  if(!esRutaDeTucket()) return;

  var ruta = rutaDesdeHash();
  var pedida = ruta.vista + (ruta.parametro ? '/' + ruta.parametro : '');
  if(pedida === rutaEnPantalla()) return;          // ya se está viendo

  /* Una vista que no existe no debe dejar la pantalla en blanco. */
  if(!document.getElementById('view-' + ruta.vista)) return nav(RUTA_INICIAL);

  if(ruta.vista === 'event-detail' && ruta.parametro) return abrirDetallePorCodigo(ruta.parametro);
  return nav(ruta.vista);
}

/* ---------- Arranque ---------- */

/* Lo llama loader.js cuando las vistas ya están en el documento y la
   sesión ya se comprobó. El orden importa: si se aplicara la ruta antes
   de saber si hay sesión, una vista privada rebotaría al login aunque la
   cuenta siguiera abierta. */
/* Las anclas se atienden aquí y no se dejan al navegador.

   Dejarlas pasar tiene dos efectos malos. El primero es que la URL pierde
   la ruta: '#/admin-dashboard' se convierte en '#agentes', y al recargar
   ya no se sabe en qué vista estaba. El segundo es que cada clic agrega
   una entrada al historial, así que la flecha atrás recorre las secciones
   del menú en vez de volver a la vista anterior.

   Bajar hasta la sección con scrollIntoView da el mismo resultado visible
   sin tocar ni la URL ni el historial. */
function atenderAnclas(){
  document.addEventListener('click', function(evento){
    var enlace = evento.target.closest ? evento.target.closest('a[href^="#"]') : null;
    if(!enlace) return;

    var destino = enlace.getAttribute('href');
    /* '#' a secas son los botones que ya usan onclick, y '#/...' son rutas
       de verdad: ninguno de los dos se toca. */
    if(!destino || destino === '#' || destino.indexOf('#/') === 0) return;

    var seccion = document.getElementById(destino.slice(1));
    if(!seccion) return;

    evento.preventDefault();
    seccion.scrollIntoView({ behavior: 'smooth', block: 'start' });

    /* Quien llegue con el teclado debe quedar parado en la sección, no
       seguir en el enlace del menú. */
    if(!seccion.hasAttribute('tabindex')) seccion.setAttribute('tabindex', '-1');
    seccion.focus({ preventScroll: true });
  });
}

function arrancarRutas(){
  atenderAnclas();

  window.addEventListener('popstate', function(evento){
    profundidadDeRuta = (evento.state && evento.state.tucket) || 0;
    aplicarRutaActual();
  });

  /* Por si alguien edita la URL a mano. pushState no dispara este evento,
     y aplicarRutaActual() no hace nada si la vista ya es la correcta, así
     que no se pisa con popstate. */
  window.addEventListener('hashchange', aplicarRutaActual);

  /* Al abrir la página con un ancla en la URL no hay ruta que aplicar,
     pero tampoco conviene dejar el ancla puesta: la primera navegación la
     reemplazaría igual y mientras tanto el historial queda sin estado. */
  if(location.hash && esRutaDeTucket()){
    history.replaceState({ tucket: 0 }, '', location.hash);
    aplicarRutaActual();
  }else{
    history.replaceState({ tucket: 0 }, '', '#/' + RUTA_INICIAL);
  }
}
