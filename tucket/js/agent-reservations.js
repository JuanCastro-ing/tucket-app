/* TUCKET — Vista Reservas del agente
   (necesita api.js y navigation.js)

   Antes esta vista tenía siete reservas escritas a mano en el HTML, con
   clientes y eventos inventados: cualquier agente que entrara veía las
   mismas, aunque no fueran suyas. Ahora se piden a
   GET /api/events/mine/reservations, que filtra por el agente de la sesión
   en el propio JOIN, así que solo llegan las de sus eventos. */

var reservasAgente = [];

function agresMensaje(texto, tipo){
  var caja = document.getElementById('agres-message');
  if(!caja) return;
  if(!texto){ caja.hidden = true; caja.textContent = ''; return; }
  caja.textContent = texto;
  caja.className = 'form-message form-message-' + (tipo === 'error' ? 'error' : 'success');
  caja.hidden = false;
}

function agresMoneda(valor){
  return new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 })
    .format(Number(valor) || 0);
}
function agresFecha(valor){
  var d = new Date(valor);
  return isNaN(d.getTime()) ? '—'
    : new Intl.DateTimeFormat('es-CO', { dateStyle:'medium', timeStyle:'short', timeZone:'America/Bogota' }).format(d);
}
function agresBadge(estado){
  return ({ Reservada:'badge-reservada', Confirmada:'badge-confirmada',
            Cancelada:'badge-cancelado', Usada:'badge-finalizado' })[estado] || 'badge-programado';
}

/* ------------------------------------------------------------------
   Tabla
------------------------------------------------------------------ */
function renderReservasAgente(){
  var cuerpo = document.getElementById('agres-body');
  if(!cuerpo) return;

  var porEvento = (document.getElementById('agres-filtro-evento') || {}).value || '';
  var porEstado = (document.getElementById('agres-filtro-estado') || {}).value || '';

  var filas = reservasAgente.filter(function(r){
    return (!porEvento || r.event_code === porEvento) && (!porEstado || r.status === porEstado);
  });

  cuerpo.replaceChildren();
  if(!filas.length){
    var tr = document.createElement('tr');
    var td = document.createElement('td');
    td.colSpan = 7; td.className = 'cell-muted';
    td.textContent = reservasAgente.length
      ? 'Ninguna reserva coincide con estos filtros.'
      : 'Todavía no hay reservas para tus eventos.';
    tr.append(td); cuerpo.append(tr);
    return;
  }

  filas.forEach(function(r){
    var tr = document.createElement('tr');

    var codigo = document.createElement('td');
    codigo.className = 'cell-strong';
    codigo.textContent = r.code;

    var cliente = document.createElement('td');
    cliente.textContent = r.client_name;
    if(r.client_email){
      var correo = document.createElement('div');
      correo.className = 'cell-muted';
      correo.textContent = r.client_email;
      cliente.append(correo);
    }

    var evento = document.createElement('td');
    evento.textContent = r.event_name;
    var ciudad = document.createElement('div');
    ciudad.className = 'cell-muted';
    ciudad.textContent = r.event_city || '';
    evento.append(ciudad);

    var entradas = document.createElement('td');
    entradas.textContent = r.quantity;

    var valor = document.createElement('td');
    valor.textContent = agresMoneda(r.total_amount);

    var fecha = document.createElement('td');
    fecha.textContent = agresFecha(r.created_at);

    var estado = document.createElement('td');
    var badge = document.createElement('span');
    badge.className = 'badge ' + agresBadge(r.status);
    badge.textContent = r.status;
    estado.append(badge);
    if(r.status === 'Cancelada' && r.cancellation_reason){
      var causa = document.createElement('div');
      causa.className = 'cell-muted cell-reason';
      causa.textContent = 'Causa: ' + r.cancellation_reason;
      estado.append(causa);
    }

    tr.append(codigo, cliente, evento, entradas, valor, fecha, estado);
    cuerpo.append(tr);
  });
}

/* El desplegable de eventos se arma con los eventos que de verdad tienen
   reservas: ofrecer los demás solo daría filtros que no devuelven nada. */
function agresLlenarEventos(){
  var select = document.getElementById('agres-filtro-evento');
  if(!select) return;
  var previo = select.value;
  var vistos = {};
  select.replaceChildren(new Option('Todos mis eventos', ''));
  reservasAgente.forEach(function(r){
    if(vistos[r.event_code]) return;
    vistos[r.event_code] = true;
    select.add(new Option(r.event_name, r.event_code));
  });
  select.value = vistos[previo] ? previo : '';
}

function agresResumen(counts, ingresos){
  var poner = function(id, valor){
    var el = document.getElementById(id);
    if(el) el.textContent = valor;
  };
  poner('agres-reservadas', counts.Reservada || 0);
  poner('agres-confirmadas', counts.Confirmada || 0);
  poner('agres-canceladas', counts.Cancelada || 0);
  poner('agres-valor', agresMoneda(ingresos));
}

/* ------------------------------------------------------------------
   Carga
------------------------------------------------------------------ */
async function cargarReservasAgente(){
  agresMensaje('');
  try{
    var datos = await tucketApi('/api/events/mine/reservations');
    reservasAgente = datos.reservations || [];
    agresResumen(datos.counts || {}, datos.revenue || 0);
    agresLlenarEventos();
    renderReservasAgente();
  }catch(error){
    reservasAgente = [];
    agresResumen({}, 0);
    renderReservasAgente();
    agresMensaje(
      rutaNoMontada(error)
        ? 'El servidor está encendido pero no reconoce esta ruta: quedó con una versión anterior del código. Deténlo con Ctrl+C y vuelve a correr npm start.'
        : apiNoDisponible(error)
        ? 'No se pudo contactar con el servidor. Enciende el backend y recarga.'
        : error.message,
      'error'
    );
  }
}

/* nav() llama a esto al entrar a la vista. */
function initAgentReservations(){
  cargarReservasAgente();
}
