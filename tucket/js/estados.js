/* TUCKET — Catálogo de estados en el navegador.

   Los estados y su comportamiento viven en la base (tablas
   event_statuses, reservation_statuses y request_statuses) y llegan aquí
   por /api/statuses. Antes estaban repetidos en el HTML, como opciones
   escritas a mano de los desplegables, y en el JavaScript, como mapas de
   color y listas de estados finales.

   El resultado es que agregar un estado nuevo —«Aplazado», por ejemplo—
   es un INSERT en la base: el desplegable, el color y la regla de si
   admite reservas salen solos, sin tocar ni una línea de aquí.

   Se pide una sola vez y se guarda: son tres listas cortas que no cambian
   mientras la página está abierta. */

var catalogoEstados = null;
var promesaEstados = null;

/* Si el servidor no responde, la interfaz no debe quedarse en blanco: se
   usan los estados que había al escribir esto. Es una red de seguridad,
   no la fuente de verdad. */
var ESTADOS_DE_EMERGENCIA = {
  eventos: [
    { code:'Programado',   label:'Programado',   badgeClass:'badge-programado', allowsReservation:true,  isFinal:false },
    { code:'En Boletería', label:'En Boletería', badgeClass:'badge-boleteria',  allowsReservation:true,  isFinal:false },
    { code:'En Vivo',      label:'En Vivo',      badgeClass:'badge-vivo',       allowsReservation:false, isFinal:false },
    { code:'Finalizado',   label:'Finalizado',   badgeClass:'badge-finalizado', allowsReservation:false, isFinal:true  },
    { code:'Cancelado',    label:'Cancelado',    badgeClass:'badge-cancelado',  allowsReservation:false, isFinal:true  }
  ],
  reservas: [
    { code:'Reservada',  label:'Reservada',  badgeClass:'badge-programado', isFinal:false },
    { code:'Confirmada', label:'Confirmada', badgeClass:'badge-boleteria',  isFinal:false },
    { code:'Usada',      label:'Usada',      badgeClass:'badge-finalizado', isFinal:true  },
    { code:'Cancelada',  label:'Cancelada',  badgeClass:'badge-cancelado',  isFinal:true  }
  ],
  solicitudes: [
    { code:'Pendiente', label:'Pendiente', badgeClass:'badge-programado' },
    { code:'Aprobada',  label:'Aprobada',  badgeClass:'badge-boleteria'  },
    { code:'Rechazada', label:'Rechazada', badgeClass:'badge-cancelado'  }
  ]
};

function cargarEstados(){
  if(catalogoEstados) return Promise.resolve(catalogoEstados);
  if(promesaEstados) return promesaEstados;
  promesaEstados = tucketApi('/api/statuses')
    .then(function(datos){ catalogoEstados = datos; return datos; })
    .catch(function(){ catalogoEstados = ESTADOS_DE_EMERGENCIA; return catalogoEstados; });
  return promesaEstados;
}

/* Devuelve lo que haya cargado; si todavía no llegó, la red de seguridad.
   Lo usan las funciones que pintan y no pueden esperar, como la que arma
   una tarjeta de evento. */
function estadosYa(){ return catalogoEstados || ESTADOS_DE_EMERGENCIA; }

function buscarEstado(familia, code){
  var lista = estadosYa()[familia] || [];
  for(var i = 0; i < lista.length; i++){ if(lista[i].code === code) return lista[i]; }
  return null;
}

/* Clase CSS del color de la etiqueta. Antes era un objeto repetido en
   cuatro archivos distintos. */
function claseDeEstado(familia, code){
  var e = buscarEstado(familia, code);
  return 'badge ' + (e ? e.badgeClass : 'badge-programado');
}

function esEstadoFinal(familia, code){
  var e = buscarEstado(familia, code);
  return Boolean(e && e.isFinal);
}

/* Llena un <select> con los estados de una familia. `incluirTodos` agrega
   la opción «Todos» de los filtros. */
function llenarSelectDeEstados(select, familia, opciones){
  if(!select) return;
  var cfg = opciones || {};
  var elegido = cfg.elegido !== undefined ? cfg.elegido : select.value;
  select.innerHTML = '';

  if(cfg.incluirTodos){
    var todos = document.createElement('option');
    todos.value = ''; todos.textContent = cfg.textoTodos || 'Todos los estados';
    select.append(todos);
  }
  (estadosYa()[familia] || []).forEach(function(e){
    if(cfg.excluir && cfg.excluir.indexOf(e.code) !== -1) return;
    var o = document.createElement('option');
    o.value = e.code; o.textContent = e.label;
    select.append(o);
  });
  if(elegido) select.value = elegido;
}
