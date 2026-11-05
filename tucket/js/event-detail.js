/* TUCKET — Vista Detalle de evento (cantidad y total) */

var eventQty = 2;
var eventUnitPrice = 85000;
function setEventPrice(price){
  eventUnitPrice = Number(price) || 0;
  var priceEl=document.getElementById('detail-price');
  if(priceEl)priceEl.textContent=new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(eventUnitPrice);
  eventQty=1;
  changeQty(0);
}
function changeQty(delta){
  eventQty = Math.max(1, eventQty + delta);
  var qtyEl = document.getElementById('qty-val');
  var totalEl = document.getElementById('total-val');
  if(qtyEl){ qtyEl.textContent = eventQty; }
  if(totalEl){ totalEl.textContent = new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(eventQty * eventUnitPrice); }
  return false;
}

/* Confirmar la reserva
   El botón «Confirmar reserva» solo navegaba a Mis reservas: no guardaba
   nada. Ahora llama a POST /api/reservations, que es quien descuenta el
   cupo, congela el precio y emite las boletas.
   El máximo de 10 por reserva y la disponibilidad los decide el servidor;
   aquí solo se muestra lo que responda. */
function reservaMensaje(texto, tipo){
  var caja = document.getElementById('detalle-message');
  if(!caja) return;
  if(!texto){ caja.hidden = true; caja.textContent = ''; return; }
  caja.textContent = texto;
  caja.className = 'form-message form-message-' + (tipo === 'error' ? 'error' : 'success');
  caja.hidden = false;
}

async function confirmarReserva(){
  reservaMensaje('');

  var evento = window.selectedPublicEvent;
  if(!evento){
    reservaMensaje('Vuelve a abrir el evento desde la cartelera e inténtalo de nuevo.', 'error');
    return false;
  }

  /* Reservar es cosa de clientes. Si no hay sesión, requireAuth manda al
     login y recuerda a dónde iba; si la sesión es de agente, el servidor
     lo rechazaría, así que se avisa antes. */
  if(!isLoggedIn){
    pendingView = 'event-detail';
    return requireAuth('reservations');
  }
  if(currentRole !== 'cliente'){
    reservaMensaje('Solo las cuentas de cliente pueden reservar entradas.', 'error');
    return false;
  }

  var boton = document.getElementById('detalle-reservar');
  if(boton){ boton.classList.add('is-busy'); boton.textContent = 'Reservando…'; }

  try{
    var r = await tucketApi('/api/reservations', {
      method: 'POST',
      body: JSON.stringify({ eventCode: evento.code, quantity: eventQty })
    });
    reservaMensaje(r.message || 'Reserva creada.', 'success');
    /* Se recarga la cartelera para que el cupo disponible quede al día. */
    if(typeof loadPublicEvents === 'function') loadPublicEvents();
    setTimeout(function(){ nav('reservations'); }, 900);
  }catch(error){
    reservaMensaje(
      apiNoDisponible(error)
        ? 'No se pudo contactar con el servidor. Intenta de nuevo en un momento.'
        : error.message,
      'error'
    );
  }finally{
    if(boton){ boton.classList.remove('is-busy'); boton.textContent = 'Confirmar reserva'; }
  }
  return false;
}
