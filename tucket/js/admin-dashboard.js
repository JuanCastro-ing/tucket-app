/* TUCKET — Panel de administración: bandeja de solicitudes de agente
   (necesita api.js y navigation.js)

   Es la única sección del panel que trabaja contra la base real. El resto
   de las gráficas siguen siendo del prototipo.

   El administrador no se entera por correo de que hay solicitudes nuevas:
   las ve al entrar, en el contador de pendientes. Es deliberado — una
   notificación por correo exige un servicio de envío y credenciales, y
   esto resuelve lo mismo sin partes que se puedan caer. */

var solFiltro = 'Pendiente';
var solCargando = false;

function solBandejaMensaje(texto, tipo){
  var caja = document.getElementById('sol-bandeja-message');
  if(!caja) return;
  if(!texto){ caja.hidden = true; caja.textContent = ''; return; }
  caja.textContent = texto;
  caja.className = 'form-message form-message-' + (tipo === 'error' ? 'error' : 'success');
  caja.hidden = false;
}

function solFecha(valor){
  var fecha = new Date(valor);
  return isNaN(fecha.getTime()) ? '—'
    : new Intl.DateTimeFormat('es-CO', { dateStyle:'medium', timeStyle:'short', timeZone:'America/Bogota' }).format(fecha);
}

function solBadgeClase(estado){
  return ({ Pendiente:'badge-programado', Aprobada:'badge-boleteria', Rechazada:'badge-cancelado' })[estado] || 'badge-programado';
}

/* ------------------------------------------------------------------
   Contadores: pestañas, chip del encabezado y marca del menú lateral
------------------------------------------------------------------ */
function solPintarConteos(conteos){
  var total = (conteos.Pendiente || 0) + (conteos.Aprobada || 0) + (conteos.Rechazada || 0);
  var porPestana = {
    Pendiente: conteos.Pendiente || 0,
    Aprobada:  conteos.Aprobada  || 0,
    Rechazada: conteos.Rechazada || 0,
    todas:     total
  };

  var tabs = document.getElementById('sol-bandeja-tabs');
  if(tabs){
    tabs.querySelectorAll('[data-estado]').forEach(function(tab){
      var cuenta = tab.querySelector('.tab-count');
      if(cuenta) cuenta.textContent = '(' + porPestana[tab.dataset.estado] + ')';
    });
  }

  var pendientes = conteos.Pendiente || 0;
  var chip = document.getElementById('sol-pendientes-chip');
  var num = document.getElementById('sol-pendientes-num');
  if(chip && num){ num.textContent = pendientes; chip.hidden = pendientes === 0; }

  var badge = document.getElementById('sol-sidebar-badge');
  if(badge){ badge.textContent = pendientes; badge.hidden = pendientes === 0; }

  var resumen = document.getElementById('sol-bandeja-resumen');
  if(resumen){
    resumen.textContent = pendientes === 0
      ? 'No hay solicitudes esperando respuesta.'
      : (pendientes === 1 ? '1 solicitud espera tu respuesta.' : pendientes + ' solicitudes esperan tu respuesta.');
  }
}

/* ------------------------------------------------------------------
   Tarjeta de una solicitud
------------------------------------------------------------------ */
function solDato(etiqueta, valor){
  var bloque = document.createElement('div');
  bloque.className = 'sol-dato';
  var k = document.createElement('span'); k.className = 'k'; k.textContent = etiqueta;
  var v = document.createElement('span'); v.className = 'v'; v.textContent = valor || '—';
  bloque.append(k, v);
  return bloque;
}

function solTarjeta(solicitud){
  var card = document.createElement('article');
  card.className = 'sol-item';
  card.dataset.id = solicitud.id;

  var head = document.createElement('div');
  head.className = 'sol-item-head';

  var titulo = document.createElement('div');
  var h = document.createElement('h3');
  h.textContent = solicitud.full_name;
  var org = document.createElement('p');
  org.className = 'sol-org';
  org.textContent = solicitud.organization + (solicitud.nit ? ' · NIT ' + solicitud.nit : '');
  titulo.append(h, org);

  var badge = document.createElement('span');
  badge.className = 'badge ' + solBadgeClase(solicitud.status);
  badge.textContent = solicitud.status;

  head.append(titulo, badge);

  var datos = document.createElement('div');
  datos.className = 'sol-datos';
  datos.append(
    solDato('Correo', solicitud.email),
    solDato('Teléfono', solicitud.phone),
    solDato('Documento', solicitud.document_number),
    solDato('Recibida', solFecha(solicitud.created_at))
  );

  var just = document.createElement('blockquote');
  just.className = 'sol-just';
  just.textContent = solicitud.justification;

  card.append(head, datos, just);

  /* Resueltas: se muestra quién y cuándo, y el motivo si fue rechazada. */
  if(solicitud.status !== 'Pendiente'){
    var resolucion = document.createElement('p');
    resolucion.className = 'sol-resolucion';
    resolucion.textContent = solicitud.status + ' el ' + solFecha(solicitud.reviewed_at) +
      (solicitud.reviewed_by_name ? ' por ' + solicitud.reviewed_by_name : '') +
      (solicitud.review_notes ? ' — ' + solicitud.review_notes : '');
    card.append(resolucion);
    return card;
  }

  /* Pendientes: aprobar o rechazar. */
  var acciones = document.createElement('div');
  acciones.className = 'sol-acciones';

  var aprobar = document.createElement('button');
  aprobar.type = 'button';
  aprobar.className = 'btn btn-gold btn-sm';
  aprobar.textContent = 'Aprobar y crear la cuenta';
  aprobar.addEventListener('click', function(){ aprobarSolicitud(solicitud.id, aprobar); });

  var rechazar = document.createElement('button');
  rechazar.type = 'button';
  rechazar.className = 'btn btn-outline btn-sm';
  rechazar.textContent = 'Rechazar';
  rechazar.addEventListener('click', function(){ abrirRechazo(card); });

  acciones.append(aprobar, rechazar);
  card.append(acciones);

  /* El motivo del rechazo se escribe en la misma tarjeta: pedirlo en una
     ventana aparte hace perder de vista la solicitud que se está juzgando. */
  var motivo = document.createElement('div');
  motivo.className = 'sol-motivo';
  motivo.hidden = true;
  var etiqueta = document.createElement('label');
  etiqueta.textContent = 'Motivo del rechazo (lo verá quien solicitó)';
  var area = document.createElement('textarea');
  area.rows = 3; area.maxLength = 500;
  area.placeholder = 'Ej: No pudimos verificar la existencia del establecimiento.';
  var aviso = document.createElement('p');
  aviso.className = 'sol-motivo-aviso';
  aviso.hidden = true;
  var confirmar = document.createElement('button');
  confirmar.type = 'button';
  confirmar.className = 'btn btn-outline btn-sm';
  confirmar.textContent = 'Confirmar rechazo';
  confirmar.addEventListener('click', function(){
    var texto = area.value.trim();
    if(texto.length < 10){
      aviso.textContent = 'El motivo debe tener al menos 10 caracteres.';
      aviso.hidden = false;
      area.focus();
      return;
    }
    aviso.hidden = true;
    rechazarSolicitud(solicitud.id, texto, confirmar);
  });
  motivo.append(etiqueta, area, aviso, confirmar);
  card.append(motivo);

  return card;
}

function abrirRechazo(card){
  var motivo = card.querySelector('.sol-motivo');
  if(!motivo) return;
  motivo.hidden = !motivo.hidden;
  if(!motivo.hidden){ motivo.querySelector('textarea').focus(); }
}

/* ------------------------------------------------------------------
   Carga y filtros
------------------------------------------------------------------ */
async function cargarSolicitudes(){
  if(solCargando) return;
  solCargando = true;
  var lista = document.getElementById('sol-bandeja-lista');
  if(lista) lista.textContent = 'Cargando solicitudes…';

  try{
    var ruta = '/api/agent-requests' + (solFiltro === 'todas' ? '' : '?status=' + encodeURIComponent(solFiltro));
    var datos = await tucketApi(ruta);
    solPintarConteos(datos.counts || {});

    if(!lista) return;
    lista.replaceChildren();
    if(!datos.requests.length){
      var vacio = document.createElement('p');
      vacio.className = 'sol-vacio';
      vacio.textContent = solFiltro === 'Pendiente'
        ? 'No hay solicitudes pendientes. Cuando alguien pida una cuenta de agente aparecerá aquí.'
        : 'No hay solicitudes en este estado.';
      lista.append(vacio);
      return;
    }
    datos.requests.forEach(function(solicitud){ lista.append(solTarjeta(solicitud)); });
  }catch(error){
    if(lista) lista.textContent = '';
    solBandejaMensaje(
      apiNoDisponible(error)
        ? 'No pudimos contactar con el servidor. La bandeja de solicitudes necesita el backend encendido.'
        : error.message,
      'error'
    );
  }finally{
    solCargando = false;
  }
}

function filtrarSolicitudes(estado, tab){
  solFiltro = estado || 'Pendiente';
  var tabs = document.getElementById('sol-bandeja-tabs');
  if(tabs){
    tabs.querySelectorAll('[data-estado]').forEach(function(item){
      var activo = tab ? item === tab : item.dataset.estado === solFiltro;
      item.classList.toggle('active', activo);
      item.setAttribute('aria-selected', activo ? 'true' : 'false');
    });
  }
  solBandejaMensaje('');
  cargarSolicitudes();
  return false;
}

/* ------------------------------------------------------------------
   Resolver
------------------------------------------------------------------ */
async function aprobarSolicitud(id, boton){
  if(boton){ boton.disabled = true; boton.textContent = 'Creando la cuenta…'; }
  try{
    var r = await tucketApi('/api/agent-requests/' + id + '/approve', { method:'PATCH' });
    /* La contraseña temporal solo existe en esta respuesta: en la base queda
       su hash. Por eso se muestra aparte y se avisa que no vuelve a verse. */
    solBandejaMensaje(
      r.message + ' Contraseña temporal: ' + r.temporaryPassword +
      ' — cópiala y pásasela a la persona, no se puede volver a consultar.',
      'success'
    );
    await cargarSolicitudes();
  }catch(error){
    solBandejaMensaje(error.message, 'error');
    if(boton){ boton.disabled = false; boton.textContent = 'Aprobar y crear la cuenta'; }
  }
}

async function rechazarSolicitud(id, motivo, boton){
  if(boton){ boton.disabled = true; boton.textContent = 'Rechazando…'; }
  try{
    var r = await tucketApi('/api/agent-requests/' + id + '/reject', {
      method:'PATCH', body: JSON.stringify({ reviewNotes: motivo })
    });
    solBandejaMensaje(r.message, 'success');
    await cargarSolicitudes();
  }catch(error){
    solBandejaMensaje(error.message, 'error');
    if(boton){ boton.disabled = false; boton.textContent = 'Confirmar rechazo'; }
  }
}

/* nav() llama a esto al entrar al panel. Se piden las dos cosas en
   paralelo: la bandeja de solicitudes y los reportes, que viven en
   admin-stats.js. */
function initAdminDashboard(){
  solBandejaMensaje('');
  cargarSolicitudes();
  if(typeof initAdminStats === 'function') initAdminStats();
}
