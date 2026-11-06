/* TUCKET — Las dos rejillas de eventos de la portada.

   «Eventos que no te puedes perder» y «Explora la cartelera completa»
   estaban escritas a mano en el HTML: mostraban siempre los mismos tres
   eventos inventados y los que publicaban los agentes no aparecían nunca.
   Ahora salen de la base, y cada evento nuevo entra solo.

   Los datos no se piden aquí: los pasa el carrusel, que ya consulta
   /api/events al cargar la portada. Con una sola consulta se llenan las
   tres cosas, en vez de pedir lo mismo tres veces. */

var DESTACADOS_ARRIBA = 3;   /* tarjetas en «no te puedes perder» */
var DESTACADOS_ABAJO  = 6;   /* tarjetas en «cartelera completa» */

/* Un evento entra a la portada si todavía se puede ir: ni cancelado, ni
   terminado. Mostrar en la página de inicio algo a lo que ya nadie puede
   asistir es una promesa rota. */
function destacableEnPortada(ev){
  if(!ev || ev.status === 'Cancelado' || ev.status === 'Finalizado') return false;
  var fin = new Date(ev.ends_at).getTime();
  return !Number.isNaN(fin) && fin > Date.now();
}

/* Entradas ya vendidas, para ordenar por lo que más se mueve.
   available_seats viene de la vista event_availability; si falta, se asume
   que no se ha vendido nada todavía. */
function vendidasDe(ev){
  var cupo = Number(ev.total_capacity) || 0;
  var libres = (ev.available_seats === null || ev.available_seats === undefined)
    ? cupo : Number(ev.available_seats);
  return Math.max(0, cupo - libres);
}

function pintarEn(idRejilla, idEstado, eventos, textoVacio){
  var rejilla = document.getElementById(idRejilla);
  if(!rejilla) return;
  rejilla.replaceChildren();
  rejilla.setAttribute('aria-busy', 'false');

  if(!eventos.length){
    var vacio = document.createElement('p');
    vacio.className = 'events-empty';
    vacio.id = idEstado;
    vacio.textContent = textoVacio;
    rejilla.append(vacio);
    return;
  }
  /* La misma tarjeta que usa la cartelera, para que se vean y se comporten
     igual en los dos sitios. */
  eventos.forEach(function(ev){ rejilla.append(tarjetaDeEvento(ev)); });
}

/* La llama el carrusel con la lista completa que devolvió la API. */
function pintarDestacados(eventos){
  if(typeof tarjetaDeEvento !== 'function') return;

  var vigentes = (Array.isArray(eventos) ? eventos : []).filter(destacableEnPortada);

  /* Arriba, lo que más se vende; a igualdad, lo que ocurre antes. */
  var porVentas = vigentes.slice().sort(function(a, b){
    return vendidasDe(b) - vendidasDe(a) ||
           (new Date(a.starts_at).getTime() || Infinity) - (new Date(b.starts_at).getTime() || Infinity);
  });
  var arriba = porVentas.slice(0, DESTACADOS_ARRIBA);

  /* Abajo, los siguientes por fecha, sin repetir los de arriba. */
  var yaMostrados = {};
  arriba.forEach(function(ev){ yaMostrados[ev.code] = true; });
  var abajo = vigentes
    .filter(function(ev){ return !yaMostrados[ev.code]; })
    .sort(function(a, b){
      return (new Date(a.starts_at).getTime() || Infinity) - (new Date(b.starts_at).getTime() || Infinity);
    })
    .slice(0, DESTACADOS_ABAJO);

  llenarCiudadesDelBuscador(eventos);

  pintarEn('featured-grid', 'featured-estado', arriba,
    'Todavía no hay eventos publicados. Cuando un agente publique el primero, aparecerá aquí.');
  pintarEn('more-events-grid', 'more-events-estado', abajo,
    arriba.length ? 'Por ahora no hay más eventos además de los destacados.'
                  : 'La cartelera está vacía por ahora.');
}

/* El desplegable de ciudades del buscador de la portada.

   Tenía cuatro ciudades escritas a mano —Cali, Tuluá, Bogotá y Medellín—
   de las más de mil que hay en la base. Un evento en cualquier otra no se
   podía filtrar, y elegir una ciudad sin eventos no devolvía nada.

   Ahora se llena con las ciudades que de verdad tienen eventos vigentes,
   sin repetir y en orden alfabético: el filtro nunca ofrece una opción
   que lleve a una lista vacía. */
function llenarCiudadesDelBuscador(eventos){
  var select = document.getElementById('home-search-city');
  if(!select) return;

  var ciudades = [];
  (Array.isArray(eventos) ? eventos : [])
    .filter(destacableEnPortada)
    .forEach(function(ev){
      if(ev.city && ciudades.indexOf(ev.city) === -1) ciudades.push(ev.city);
    });
  ciudades.sort(function(a, b){ return a.localeCompare(b, 'es'); });

  var elegida = select.value;
  select.innerHTML = '';
  var todas = document.createElement('option');
  todas.value = ''; todas.textContent = 'Todas las ciudades';
  select.append(todas);
  ciudades.forEach(function(nombre){
    var o = document.createElement('option');
    o.value = nombre; o.textContent = nombre;
    select.append(o);
  });
  /* Si la persona ya había elegido una ciudad, se respeta su elección. */
  if(elegida && ciudades.indexOf(elegida) !== -1) select.value = elegida;
}

/* Sin servidor no hay nada que mostrar, y conviene decirlo en vez de dejar
   «Cargando…» para siempre. */
function portadaSinConexion(){
  pintarEn('featured-grid', 'featured-estado', [],
    'No pudimos contactar con el servidor, así que no hay eventos que mostrar.');
  pintarEn('more-events-grid', 'more-events-estado', [],
    'Enciende el backend y recarga la página.');
}
