/* Pantalla de pago y comprobante.

   SIMULACIÓN: el número de la tarjeta no sale del formulario más allá del
   servidor, que lo valida y lo descarta. Lo que se guarda son los cuatro
   últimos dígitos, igual que imprime cualquier recibo.

   El flujo tiene tres estados en una sola vista: cargando, formulario y
   comprobante. Se usa una vista y no tres para que el cliente no pierda
   de vista lo que está pagando. */

var pagoReserva = null;     /* la reserva que se está pagando */
var pagoMetodos = [];       /* catálogo traído del servidor */
var pagoMetodoElegido = null;

function pagoMoneda(valor){
  return '$ ' + Number(valor || 0).toLocaleString('es-CO');
}

function pagoFecha(iso){
  if(!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', {
    day:'numeric', month:'long', year:'numeric', hour:'numeric', minute:'2-digit'
  });
}

function pagoMostrar(seccion){
  var mapa = {
    cargando: 'pago-cargando',
    formulario: 'pago-cuerpo',
    comprobante: 'pago-comprobante'
  };
  Object.keys(mapa).forEach(function(k){
    var el = document.getElementById(mapa[k]);
    if(el) el.hidden = (k !== seccion);
  });
}

function pagoMensaje(texto, tipo){
  var caja = document.getElementById('pago-mensaje');
  if(!caja) return;
  caja.hidden = !texto;
  caja.textContent = texto || '';
  caja.className = 'form-msg' + (tipo ? ' ' + tipo : '');
}

/* ---------- Entrada a la pantalla ---------- */

/* La llama el botón «Pagar» de Mis reservas. */
async function irAPagar(codigoReserva){
  /* nav() devuelve false siempre: es lo que esperan los onclick de los
     enlaces para no seguir el href. Así que el permiso se consulta
     aparte, no por lo que devuelva nav(). */
  if(typeof canAccess === 'function' && !canAccess('pago')) return nav('login');
  nav('pago');
  pagoMostrar('cargando');
  pagoMensaje('');

  try{
    var datos = await tucketApi('/api/reservations/' + encodeURIComponent(codigoReserva));
    pagoReserva = datos.reservation || datos;

    if(!pagoMetodos.length){
      var cat = await tucketApi('/api/payments/methods');
      pagoMetodos = cat.methods || [];
    }

    pagoPintarResumen();
    pagoPintarMetodos();
    pagoMostrar('formulario');
  }catch(error){
    pagoMostrar('formulario');
    pagoMensaje(error.message || 'No pudimos cargar la reserva.', 'error');
  }
  return false;
}

function pagoPintarResumen(){
  var r = pagoReserva || {};
  var poner = function(id, texto){
    var el = document.getElementById(id);
    if(el) el.textContent = texto;
  };
  poner('pago-titulo', 'Pagar ' + (r.code || 'reserva'));
  poner('pago-res-codigo', r.code || '—');
  poner('pago-res-evento', r.event_name || '—');
  poner('pago-res-fecha', pagoFecha(r.starts_at));
  poner('pago-res-lugar', [r.venue, r.city].filter(Boolean).join(' · ') || '—');
  poner('pago-res-cantidad', r.quantity != null ? String(r.quantity) : '—');
  poner('pago-res-unitario', pagoMoneda(r.unit_price));
  poner('pago-res-total', pagoMoneda(r.total_amount));
}

/* ---------- Métodos ---------- */

function pagoPintarMetodos(){
  var lista = document.getElementById('pago-metodos-lista');
  if(!lista) return;
  lista.replaceChildren();

  pagoMetodos.forEach(function(m, i){
    var id = 'metodo-' + m.code;

    var opcion = document.createElement('label');
    opcion.className = 'pago-metodo';
    opcion.setAttribute('for', id);

    var radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'metodo';
    radio.id = id;
    radio.value = m.code;
    radio.checked = (i === 0);
    radio.addEventListener('change', function(){ pagoElegirMetodo(m); });

    var texto = document.createElement('span');
    texto.className = 'pago-metodo-texto';
    texto.textContent = m.label;

    opcion.append(radio, texto);
    lista.append(opcion);

    if(i === 0) pagoElegirMetodo(m);
  });
}

function pagoElegirMetodo(m){
  pagoMetodoElegido = m;
  var campos = document.getElementById('pago-campos-tarjeta');
  if(campos) campos.hidden = !m.needsCard;

  var nota = document.getElementById('pago-nota-metodo');
  if(nota){
    if(m.code === 'Taquilla'){
      nota.hidden = false;
      nota.textContent = 'La reserva queda registrada con el pago pendiente. '
        + 'Pagas en la taquilla del recinto y el agente lo confirma allí.';
    }else if(!m.needsCard){
      nota.hidden = false;
      nota.textContent = 'En una integración real aquí se abriría el portal del banco. '
        + 'En la simulación el pago se aprueba al instante.';
    }else{
      nota.hidden = true;
      nota.textContent = '';
    }
  }

  var boton = document.getElementById('pago-enviar');
  if(boton) boton.textContent = m.instant ? 'Pagar ' + pagoMoneda(pagoReserva && pagoReserva.total_amount)
                                          : 'Registrar pago en taquilla';
  pagoMensaje('');
}

/* ---------- Validación en el navegador ----------
   El servidor vuelve a validar todo: esto solo evita un viaje de ida y
   vuelta para errores evidentes. */

function pagoError(campo, texto){
  var el = document.getElementById('err-pago-' + campo);
  if(!el) return;
  el.hidden = !texto;
  el.textContent = texto || '';
}

function pagoLuhn(numero){
  var suma = 0, doble = false;
  for(var i = numero.length - 1; i >= 0; i--){
    var d = numero.charCodeAt(i) - 48;
    if(d < 0 || d > 9) return false;
    if(doble){ d *= 2; if(d > 9) d -= 9; }
    suma += d;
    doble = !doble;
  }
  return numero.length >= 13 && suma % 10 === 0;
}

function pagoValidarTarjeta(){
  var ok = true;
  var titular = (document.getElementById('pago-card-holder').value || '').trim();
  var numero = (document.getElementById('pago-card-number').value || '').replace(/[\s-]/g, '');
  var venc = (document.getElementById('pago-card-expiry').value || '').trim();
  var cvv = (document.getElementById('pago-card-cvv').value || '').trim();

  pagoError('card-holder', ''); pagoError('card-number', '');
  pagoError('card-expiry', ''); pagoError('card-cvv', '');

  if(titular.length < 5){ pagoError('card-holder', 'Escribe el nombre que aparece en la tarjeta.'); ok = false; }
  if(!/^\d{13,19}$/.test(numero)){
    pagoError('card-number', 'El número debe tener entre 13 y 19 dígitos.'); ok = false;
  }else if(!pagoLuhn(numero)){
    pagoError('card-number', 'Ese número de tarjeta no es válido.'); ok = false;
  }
  var mesAnio = /^(\d{2})\/(\d{2})$/.exec(venc);
  if(!mesAnio){
    pagoError('card-expiry', 'Usa el formato MM/AA.'); ok = false;
  }else{
    var mes = Number(mesAnio[1]);
    /* La tarjeta vence al TERMINAR su mes, de ahí el día 1 del siguiente. */
    var vence = new Date(2000 + Number(mesAnio[2]), mes, 1);
    if(mes < 1 || mes > 12){
      pagoError('card-expiry', 'El mes debe estar entre 01 y 12.'); ok = false;
    }else if(vence <= new Date()){
      pagoError('card-expiry', 'Esa tarjeta ya venció.'); ok = false;
    }
  }
  if(!/^\d{3,4}$/.test(cvv)){ pagoError('card-cvv', 'Deben ser 3 o 4 dígitos.'); ok = false; }

  return ok;
}

/* Agrupa el número de a cuatro mientras se escribe. */
function pagoFormatearNumero(e){
  var limpio = e.target.value.replace(/\D/g, '').slice(0, 19);
  e.target.value = limpio.replace(/(.{4})/g, '$1 ').trim();
}

function pagoFormatearVencimiento(e){
  var limpio = e.target.value.replace(/\D/g, '').slice(0, 4);
  e.target.value = limpio.length > 2 ? limpio.slice(0, 2) + '/' + limpio.slice(2) : limpio;
}

/* ---------- Enviar ---------- */

async function pagoEnviar(evento){
  evento.preventDefault();
  if(!pagoReserva || !pagoMetodoElegido) return;

  if(pagoMetodoElegido.needsCard && !pagoValidarTarjeta()) return;

  var boton = document.getElementById('pago-enviar');
  var textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = 'Procesando…';
  pagoMensaje('');

  var cuerpo = {
    reservationCode: pagoReserva.code,
    method: pagoMetodoElegido.code
  };
  if(pagoMetodoElegido.needsCard){
    cuerpo.cardHolder = document.getElementById('pago-card-holder').value;
    cuerpo.cardNumber = document.getElementById('pago-card-number').value;
    cuerpo.cardExpiry = document.getElementById('pago-card-expiry').value;
    cuerpo.cardCvv = document.getElementById('pago-card-cvv').value;
  }

  try{
    var r = await tucketApi('/api/payments', { method:'POST', body: JSON.stringify(cuerpo) });
    await pagoVerComprobante(r.payment.code);
  }catch(error){
    pagoMensaje(error.message || 'No pudimos procesar el pago.', 'error');
  }finally{
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

/* ---------- Comprobante ---------- */

async function pagoVerComprobante(codigo){
  try{
    var d = await tucketApi('/api/payments/' + encodeURIComponent(codigo));
    var p = d.payment, r = d.reservation, e = d.event, c = d.client;

    var poner = function(id, texto){
      var el = document.getElementById(id);
      if(el) el.textContent = texto;
    };

    var estado = document.getElementById('comp-estado');
    if(estado){
      estado.textContent = p.statusLabel;
      estado.className = 'badge ' + (p.badgeClass || '');
    }

    poner('comp-codigo', p.code);
    poner('comp-referencia', p.reference);
    poner('comp-fecha', pagoFecha(p.paidAt || p.createdAt));
    poner('comp-metodo', p.method + (p.cardLast4 ? ' · ' + (p.cardBrand || '') + ' ••••' + p.cardLast4 : ''));
    poner('comp-cliente', c.name);
    poner('comp-documento', c.document || '—');
    poner('comp-reserva', r.code);
    poner('comp-evento', e.name + ' · ' + e.city);
    poner('comp-cantidad', r.quantity + (r.quantity === 1 ? ' entrada' : ' entradas'));
    poner('comp-total', pagoMoneda(p.amount));

    var motivo = document.getElementById('comp-motivo');
    if(motivo){
      motivo.hidden = !p.declineReason;
      motivo.textContent = p.declineReason ? 'Motivo del rechazo: ' + p.declineReason : '';
    }

    /* Un rechazo no es un callejón sin salida: se ofrece volver a
       intentar, que es lo que hace cualquier tienda. */
    var reintentar = document.getElementById('comp-reintentar');
    if(reintentar){
      reintentar.hidden = (p.status !== 'Rechazado');
      reintentar.onclick = function(ev){
        ev.preventDefault();
        pagoMostrar('formulario');
        pagoMensaje('');
        var t = document.getElementById('pago-titulo');
        if(t && pagoReserva) t.textContent = 'Pagar ' + pagoReserva.code;
        var b = document.querySelector('#view-pago .page-head p');
        if(b) b.textContent = 'Elige cómo quieres pagar. La reserva queda confirmada apenas se apruebe el pago.';
        return false;
      };
    }

    /* El encabezado todavía decía «Pagar RES-…» y hablaba de elegir un
       método: ya no aplica una vez que el pago se resolvió. */
    var titulo = document.getElementById('pago-titulo');
    if(titulo) titulo.textContent = p.status === 'Aprobado' ? 'Pago aprobado'
      : p.status === 'Rechazado' ? 'Pago rechazado' : 'Pago registrado';
    var bajada = document.querySelector('#view-pago .page-head p');
    if(bajada){
      bajada.textContent = p.status === 'Aprobado'
        ? 'Tu reserva quedó confirmada. Guarda o imprime este comprobante.'
        : p.status === 'Rechazado'
          ? 'No se pudo cobrar. Tu reserva sigue activa: puedes intentar con otro método.'
          : 'El pago quedó pendiente de confirmación en taquilla.';
    }

    pagoMostrar('comprobante');
  }catch(error){
    pagoMensaje(error.message || 'No pudimos cargar el comprobante.', 'error');
  }
}

/* Los formularios se enlazan desde el HTML con onsubmit y oninput, que
   es la convención del proyecto: las vistas se cargan con fetch después
   de DOMContentLoaded, así que escuchar ese evento aquí no serviría. */
