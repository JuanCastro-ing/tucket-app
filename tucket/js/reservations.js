/* TUCKET — Vista Mis reservas
   (necesita api.js y navigation.js)

   Esta vista tenía cinco reservas escritas a mano en el HTML: se veían
   iguales para cualquier cliente y no cambiaban al reservar. Ahora salen
   de GET /api/reservations/mine, que filtra por el cliente de la sesión.

   Dos cosas viven aquí: pintar la lista y el filtro por estado. */

var misReservas = [];
var reservaFiltroActual = 'todas';

function resMensaje(texto, tipo){
  var caja = document.getElementById('res-message');
  if(!caja) return;
  if(!texto){ caja.hidden = true; caja.textContent = ''; return; }
  caja.textContent = texto;
  caja.className = 'form-message form-message-' + (tipo === 'error' ? 'error' : 'success');
  caja.hidden = false;
}

function resMoneda(valor){
  return new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 })
    .format(Number(valor) || 0);
}
function resFecha(valor, conHora){
  var d = new Date(valor);
  if(isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('es-CO', conHora
    ? { dateStyle:'medium', timeStyle:'short', timeZone:'America/Bogota' }
    : { dateStyle:'medium', timeZone:'America/Bogota' }).format(d);
}
function resBadge(estado){
  return ({ Reservada:'badge-reservada', Confirmada:'badge-confirmada',
            Cancelada:'badge-cancelado', Usada:'badge-finalizado' })[estado] || 'badge-programado';
}
/* El talón del boleto muestra el día del evento en dos líneas cortas. */
function resTalon(valor){
  var d = new Date(valor);
  if(isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('es-CO', { day:'2-digit', month:'short', timeZone:'America/Bogota' })
    .format(d).toUpperCase().replace('.', '');
}

/* Una tarjeta */
function resDato(etiqueta, valor){
  var bloque = document.createElement('div');
  bloque.className = 'rf';
  var l = document.createElement('div'); l.className = 'l'; l.textContent = etiqueta;
  var v = document.createElement('div'); v.className = 'v'; v.textContent = valor;
  bloque.append(l, v);
  return bloque;
}

function resTarjeta(r){
  var ticket = document.createElement('div');
  ticket.className = 'ticket res-ticket';
  ticket.dataset.code = r.code;
  if(r.status === 'Cancelada') ticket.style.opacity = '.7';

  var main = document.createElement('div');
  main.className = 'ticket-main';

  var info = document.createElement('div');
  info.className = 'res-info';
  var badge = document.createElement('span');
  badge.className = 'badge ' + resBadge(r.status);
  badge.style.marginBottom = '8px';
  badge.textContent = r.status;
  var titulo = document.createElement('h3');
  titulo.textContent = r.event_name;
  var lugar = document.createElement('div');
  lugar.className = 'venue';
  lugar.textContent = [r.venue, r.city, resFecha(r.starts_at, true)].filter(Boolean).join(' · ');
  info.append(badge, titulo, lugar);
  if(r.status === 'Cancelada' && r.cancellation_reason){
    var causa = document.createElement('div');
    causa.className = 'cell-muted cell-reason';
    causa.textContent = 'Causa: ' + r.cancellation_reason;
    info.append(causa);
  }
  /* Lo que el cliente pidió al reservar, para que pueda comprobar que
     quedó registrado y no tenga que fiarse. */
  if(r.observations){
    var nota = document.createElement('div');
    nota.className = 'cell-muted cell-reason';
    nota.textContent = 'Tu nota: ' + r.observations;
    info.append(nota);
  }

  var cifras = document.createElement('div');
  cifras.className = 'res-figures';
  cifras.append(
    resDato('ENTRADAS', r.quantity),
    resDato('VALOR TOTAL', resMoneda(r.total_amount)),
    resDato('RESERVADA EL', resFecha(r.created_at))
  );

  var acciones = document.createElement('div');
  acciones.className = 'res-actions';
  var ver = document.createElement('a');
  ver.href = '#';
  ver.className = 'btn btn-outline btn-sm';
  ver.textContent = 'Ver evento';
  ver.addEventListener('click', function(e){
    e.preventDefault();
    if(typeof openEventDetails === 'function') openEventDetails(r.event_code);
  });
  acciones.append(ver);

  /* Cancelar solo mientras la reserva lo admite. El servidor vuelve a
     comprobarlo —y además rechaza si el evento ya empezó—, así que esto
     es solo para no ofrecer un botón que va a fallar. */
  if(r.status === 'Reservada' || r.status === 'Confirmada'){
    var cancelar = document.createElement('a');
    cancelar.href = '#';
    cancelar.className = 'link-cancel';
    cancelar.textContent = 'Cancelar reserva';
    cancelar.addEventListener('click', function(e){
      e.preventDefault();
      cancelarReserva(r.code, cancelar);
    });
    acciones.append(cancelar);
  }

  main.append(info, cifras, acciones);

  var stub = document.createElement('div');
  stub.className = 'ticket-stub';
  var codigo = document.createElement('span');
  codigo.className = 'stub-code';
  codigo.textContent = r.code;
  var dia = document.createElement('span');
  dia.className = 'stub-date';
  dia.textContent = resTalon(r.starts_at);
  stub.append(codigo, dia);

  ticket.append(main, stub);
  return ticket;
}

/* Lista y filtro */
function reservaNormalizar(texto){
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase();
}

function renderMisReservas(){
  var lista = document.getElementById('res-list');
  if(!lista) return;

  var visibles = misReservas.filter(function(r){
    return reservaFiltroActual === 'todas' || reservaNormalizar(r.status) === reservaFiltroActual;
  });

  lista.replaceChildren();
  visibles.forEach(function(r){ lista.append(resTarjeta(r)); });

  var vacio = document.getElementById('res-empty');
  if(vacio){
    vacio.hidden = visibles.length !== 0;
    vacio.textContent = misReservas.length
      ? 'No tienes reservas en este estado.'
      : 'Todavía no has reservado entradas. Explora la cartelera y reserva tu primera función.';
  }
}

function actualizarConteosReservas(){
  var total = { todas: misReservas.length, reservada:0, confirmada:0, cancelada:0 };
  var entradas = 0;
  misReservas.forEach(function(r){
    var estado = reservaNormalizar(r.status);
    if(total[estado] !== undefined) total[estado] += 1;
    if(r.status !== 'Cancelada') entradas += Number(r.quantity) || 0;
  });

  var tabs = document.getElementById('res-tabs');
  if(tabs){
    tabs.querySelectorAll('[data-estado]').forEach(function(tab){
      var cuenta = tab.querySelector('.tab-count');
      if(cuenta) cuenta.textContent = '(' + (total[tab.dataset.estado] || 0) + ')';
    });
  }
  var marcador = document.getElementById('res-entradas');
  if(marcador) marcador.textContent = new Intl.NumberFormat('es-CO').format(entradas);
}

function filtrarReservas(estado, tab){
  reservaFiltroActual = estado || 'todas';
  var tabs = document.getElementById('res-tabs');
  if(tabs){
    tabs.querySelectorAll('[data-estado]').forEach(function(item){
      var activo = tab ? item === tab : item.dataset.estado === reservaFiltroActual;
      item.classList.toggle('active', activo);
      item.setAttribute('aria-selected', activo ? 'true' : 'false');
    });
  }
  renderMisReservas();
  return false;
}

/* Carga y cancelación */
async function cargarMisReservas(){
  resMensaje('');
  try{
    misReservas = await tucketApi('/api/reservations/mine');
    actualizarConteosReservas();
    renderMisReservas();
  }catch(error){
    misReservas = [];
    actualizarConteosReservas();
    renderMisReservas();
    resMensaje(
      rutaNoMontada(error)
        ? 'El servidor está encendido pero no reconoce esta ruta: quedó con una versión anterior del código. Deténlo con Ctrl+C y vuelve a correr npm start.'
        : apiNoDisponible(error)
        ? 'No se pudo contactar con el servidor. Enciende el backend y recarga.'
        : error.message,
      'error'
    );
  }
}

async function cancelarReserva(code, enlace){
  resMensaje('');
  if(enlace){ enlace.textContent = 'Cancelando…'; enlace.style.pointerEvents = 'none'; }
  try{
    var r = await tucketApi('/api/reservations/' + encodeURIComponent(code) + '/cancel', { method:'PATCH' });
    /* Primero se recarga y luego se avisa: cargarMisReservas() limpia los
       mensajes, así que al revés el aviso duraba un parpadeo. */
    await cargarMisReservas();
    resMensaje(r.message || 'Reserva cancelada.', 'success');
  }catch(error){
    resMensaje(error.message, 'error');
    if(enlace){ enlace.textContent = 'Cancelar reserva'; enlace.style.pointerEvents = ''; }
  }
}

/* nav() llama a esto al entrar a la vista. */
function initReservations(){
  cargarMisReservas();
}
