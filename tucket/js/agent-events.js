/* HU-03 y HU-04: alta de eventos y selección geográfica en cascada. */
(function(){
  var viewId = 'view-agent-events';

  /* Aquí vivían un catálogo geográfico y dos eventos escritos a mano que
     sostenían un «modo prototipo» sin PostgreSQL. Se quitaron: el panel
     trabaja únicamente contra la base de datos, así que lo que se ve en
     pantalla es siempre lo que está guardado. Sin servidor no hay datos, y
     se dice con un mensaje en vez de mostrar eventos que no existen. */
  var requestVersion = { departments: 0, cities: 0 };

  function el(id){ return document.getElementById(id); }
  function setMessage(message, kind){
    var box = el('event-form-message');
    if(!box) return;
    box.textContent = message || '';
    box.className = 'form-message' + (kind ? ' form-message-' + kind : '');
    box.hidden = !message;
  }
  function setOptions(select, rows, placeholder, valueKey){
    select.replaceChildren();
    var first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    first.disabled = true;
    first.selected = true;
    select.appendChild(first);
    rows.forEach(function(row){
      var option = document.createElement('option');
      option.value = row[valueKey];
      option.textContent = row.name;
      select.appendChild(option);
    });
  }
  function setLoading(select, label){
    select.replaceChildren();
    var option = document.createElement('option');
    option.value = '';
    option.textContent = label;
    option.selected = true;
    select.appendChild(option);
  }

  async function loadCountries(){
    var country = el('event-country');
    var department = el('event-department');
    var city = el('agent-event-city');
    if(!country || country.dataset.loaded === 'true') return;
    country.disabled = true;
    setLoading(country, 'Cargando países…');
    try{
      var rows = await tucketApi('/api/geography/countries');
      setOptions(country, rows, 'Selecciona un país', 'code');
      country.disabled = rows.length === 0;
      country.dataset.loaded = 'true';
      if(!rows.length) setMessage('No hay países registrados. Ejecuta la configuración de la base de datos.', 'error');
    }catch(error){
      setLoading(country, 'No se pudieron cargar los países');
      country.disabled = true;
      setMessage(error.message, 'error');
    }
    department.disabled = true;
    city.disabled = true;
  }

  async function loadDepartments(){
    var country = el('event-country');
    var department = el('event-department');
    var city = el('agent-event-city');
    var version = ++requestVersion.departments;
    ++requestVersion.cities;
    department.disabled = true;
    city.disabled = true;
    setLoading(department, country.value ? 'Cargando departamentos…' : 'Selecciona primero un país');
    setLoading(city, 'Selecciona primero un departamento');
    if(!country.value) return;
    try{
      var rows = await tucketApi('/api/geography/countries/' + encodeURIComponent(country.value) + '/departments');
      if(version !== requestVersion.departments || country.value === '') return;
      setOptions(department, rows, 'Selecciona un departamento', 'code');
      department.disabled = rows.length === 0;
      if(!rows.length) setMessage('No hay departamentos para el país seleccionado.', 'error');
      else setMessage('', '');
    }catch(error){
      if(version === requestVersion.departments){
        setLoading(department, 'No se pudieron cargar los departamentos');
        setMessage(error.message, 'error');
      }
    }
  }

  async function loadCities(){
    var department = el('event-department');
    var city = el('agent-event-city');
    var version = ++requestVersion.cities;
    city.disabled = true;
    setLoading(city, department.value ? 'Cargando ciudades…' : 'Selecciona primero un departamento');
    if(!department.value) return;
    try{
      var rows = await tucketApi('/api/geography/departments/' + encodeURIComponent(department.value) + '/cities');
      if(version !== requestVersion.cities || department.value === '') return;
      setOptions(city, rows, 'Selecciona una ciudad', 'id');
      city.disabled = rows.length === 0;
      if(!rows.length) setMessage('No hay ciudades registradas para el departamento seleccionado.', 'error');
      else setMessage('', '');
    }catch(error){
      if(version === requestVersion.cities){
        setLoading(city, 'No se pudieron cargar las ciudades');
        setMessage(error.message, 'error');
      }
    }
  }

  function prettyDate(value){
    return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }
  function badgeClass(status){
    return ({
      'Programado':   'badge-programado',
      'En Boletería': 'badge-boleteria',
      'En Vivo':      'badge-vivo',
      'Finalizado':   'badge-finalizado',
      'Cancelado':    'badge-cancelado'
    })[status] || 'badge-programado';
  }

  /* ----------------------------------------------------------------
     Afiche del evento.
     El archivo se lee en el navegador y viaja como base64 dentro del
     JSON; el backend lo guarda en disco y en la base queda solo la ruta.
  ---------------------------------------------------------------- */
  var MAX_AFICHE = 4 * 1024 * 1024;
  var TIPOS_AFICHE = ['image/jpeg', 'image/png', 'image/webp'];
  /* ----------------------------------------------------------------
     Imágenes del evento: afiche y banner

     Son dos campos con el mismo comportamiento —elegir, previsualizar,
     quitar— así que comparten código y solo cambian los identificadores
     y los textos. Antes esto estaba escrito una vez; duplicarlo para el
     banner habría dejado dos copias que se desincronizan.

     · Afiche: la imagen que se ve en la ficha y en la cartelera.
     · Banner: la imagen ancha del fondo del detalle. Es opcional, y si
       no se pone, el detalle usa el afiche.
  ---------------------------------------------------------------- */
  var CAMPOS_IMAGEN = {
    afiche: { input:'event-image',  caja:'event-image-preview',  thumb:'event-image-thumb',
              quitar:'event-image-clear', pista:'event-image-hint',
              vacio:'Sin afiche', nombre:'El afiche' },
    banner: { input:'event-banner', caja:'event-banner-preview', thumb:'event-banner-thumb',
              quitar:'event-banner-clear', pista:'event-banner-hint',
              vacio:'Sin banner', nombre:'El banner' }
  };

  var imagenesSeleccionadas = { afiche:null, banner:null };   /* dataURL de cada una */

  function limpiarImagen(clave){
    var campo = CAMPOS_IMAGEN[clave];
    imagenesSeleccionadas[clave] = null;
    var input = el(campo.input);
    var caja = el(campo.caja);
    var img = el(campo.thumb);
    var quitar = el(campo.quitar);
    var pista = el(campo.pista);
    if(input) input.value = '';
    if(img){ img.hidden = true; img.removeAttribute('src'); img.alt = ''; }
    if(caja) caja.dataset.empty = 'true';
    if(quitar) quitar.hidden = true;
    if(pista) pista.textContent = campo.vacio;
  }

  /* El botón «Quitar» hace dos cosas distintas según el momento: al
     crear solo descarta el archivo elegido, y al editar además hay que
     decirle al servidor que borre la imagen que ya estaba guardada. */
  function quitarImagen(clave){
    if(editandoCodigo) imagenesQuitadas[clave] = true;
    limpiarImagen(clave);
  }

  function elegirImagen(clave){
    var campo = CAMPOS_IMAGEN[clave];
    var input = el(campo.input);
    var archivo = input && input.files ? input.files[0] : null;
    if(!archivo){ limpiarImagen(clave); return; }

    /* Se valida aquí para avisar antes de subir 4 MB al servidor; el
       backend vuelve a validarlo igual, porque esto es solo comodidad. */
    if(TIPOS_AFICHE.indexOf(archivo.type) === -1){
      setMessage(campo.nombre + ' debe ser una imagen JPG, PNG o WEBP.', 'error');
      limpiarImagen(clave);
      return;
    }
    if(archivo.size > MAX_AFICHE){
      setMessage(campo.nombre + ' pesa ' + (archivo.size / 1048576).toFixed(1) + ' MB. El máximo es 4 MB.', 'error');
      limpiarImagen(clave);
      return;
    }

    var lector = new FileReader();
    lector.onload = function(){
      imagenesSeleccionadas[clave] = String(lector.result || '');
      var img = el(campo.thumb);
      var caja = el(campo.caja);
      var quitar = el(campo.quitar);
      var pista = el(campo.pista);
      if(img){
        img.src = imagenesSeleccionadas[clave];
        img.alt = 'Vista previa de ' + campo.nombre.toLowerCase() + ' seleccionado';
        img.hidden = false;
      }
      if(caja) caja.dataset.empty = 'false';
      if(quitar) quitar.hidden = false;
      if(pista) pista.textContent = archivo.name;
      setMessage('', '');
    };
    lector.onerror = function(){
      setMessage('No se pudo leer la imagen. Intenta con otro archivo.', 'error');
      limpiarImagen(clave);
    };
    lector.readAsDataURL(archivo);
  }

  /* Atajos con el nombre de antes, que es como los llama el resto del
     archivo y el arranque de la vista. */
  function limpiarAfiche(){ limpiarImagen('afiche'); limpiarImagen('banner'); }
  function elegirAfiche(){ elegirImagen('afiche'); }
  function elegirBanner(){ elegirImagen('banner'); }

  function renderEvents(events){
    var body = el('agent-events-body');
    if(!body) return;
    body.replaceChildren();
    if(!events.length){
      var empty = document.createElement('tr');
      var cell = document.createElement('td');
      cell.colSpan = 8;
      cell.className = 'cell-muted';
      cell.textContent = 'Aún no tienes eventos registrados. Completa el formulario para crear el primero.';
      empty.appendChild(cell);
      body.appendChild(empty);
      return;
    }
    events.forEach(function(event){
      var row = document.createElement('tr');
      var details = document.createElement('td');
      var strong = document.createElement('div');
      strong.className = 'cell-strong';
      strong.textContent = event.name;
      var code = document.createElement('div');
      code.className = 'cell-muted';
      code.textContent = event.code;
      /* Nombre y código van dentro de un bloque propio: cuando la fila
         tiene miniatura la celda es flex, y sin este contenedor el
         código se colocaba al lado del nombre y se salía de la celda
         encima de la columna siguiente. */
      var info = document.createElement('div');
      info.className = 'cell-info';
      info.append(strong, code);
      details.append(info);
      /* Miniatura del afiche, si el evento tiene uno. */
      if(event.image_path){
        details.classList.add('cell-with-thumb');
        var thumb = document.createElement('img');
        thumb.className = 'cell-thumb';
        thumb.src = event.image_path;
        thumb.alt = event.image_alt || ('Afiche de ' + event.name);
        thumb.loading = 'lazy';
        thumb.addEventListener('error', function(){ thumb.remove(); });
        details.prepend(thumb);
      }
      var city = document.createElement('td');
      city.textContent = event.city + ', ' + event.department;
      var date = document.createElement('td');
      date.textContent = prettyDate(event.starts_at);
      var capacity = document.createElement('td');
      capacity.textContent = Number(event.total_capacity).toLocaleString('es-CO');
      var venue = document.createElement('td');
      venue.textContent = event.venue;
      var price = document.createElement('td');
      price.textContent = Number(event.base_price).toLocaleString('es-CO', {
        style: 'currency', currency: 'COP', maximumFractionDigits: 2
      });
      var statusCell = document.createElement('td');
      var badge = document.createElement('span');
      badge.className = 'badge ' + badgeClass(event.status);
      badge.textContent = event.status;
      statusCell.appendChild(badge);
      if(event.status === 'Cancelado' && event.cancellation_reason){
        var causa = document.createElement('div');
        causa.className = 'cell-muted cell-reason';
        causa.textContent = 'Causa: ' + event.cancellation_reason;
        statusCell.appendChild(causa);
      }
      row.append(details, city, date, venue, capacity, price, statusCell, accionCelda(event));
      body.appendChild(row);
    });
    var nota = el('agent-store-note');
    if(nota) nota.textContent = 'Guardados en PostgreSQL';
    var origen = el('agent-api-state');
    if(origen) origen.textContent = 'PostgreSQL';
    var total = el('agent-event-count');
    if(total) total.textContent = events.length.toLocaleString('es-CO');
    var hint = el('agent-event-total');
    if(hint) hint.textContent = events.length + (events.length === 1 ? ' evento' : ' eventos') + ' tuyos';
    var ticketing = el('agent-ticketing-count');
    if(ticketing) ticketing.textContent = events.filter(function(item){ return item.status === 'En Boletería'; }).length.toLocaleString('es-CO');
    var scheduled = el('agent-scheduled-count');
    if(scheduled) scheduled.textContent = events.filter(function(item){ return item.status === 'Programado'; }).length.toLocaleString('es-CO');
  }

  /* ----------------------------------------------------------------
     Ciclo de vida del evento (HU del agente).
     Finalizado y Cancelado son estados finales: la fila deja de ofrecer
     cambios. Cancelar abre una fila con el campo de causa, obligatorio.
  ---------------------------------------------------------------- */
  var ESTADOS = ['Programado', 'En Boletería', 'En Vivo', 'Finalizado', 'Cancelado'];
  var ESTADOS_FINALES = ['Finalizado', 'Cancelado'];

  function accionCelda(event){
    var celda = document.createElement('td');
    var grupo = document.createElement('div');
    grupo.className = 'row-actions';
    celda.appendChild(grupo);

    if(ESTADOS_FINALES.indexOf(event.status) !== -1){
      var fin = document.createElement('span');
      fin.className = 'cell-muted';
      fin.textContent = 'Ciclo cerrado';
      grupo.appendChild(fin);
      /* Un evento cerrado ya no se edita, pero sí se puede borrar si
         nadie tiene boleta: es el caso de una publicación equivocada. */
      grupo.appendChild(botonEliminar(event));
      return celda;
    }

    var select = document.createElement('select');
    select.className = 'status-select';
    select.setAttribute('aria-label', 'Cambiar el estado de ' + event.name);
    var inicial = document.createElement('option');
    inicial.value = ''; inicial.textContent = 'Cambiar a…'; inicial.selected = true;
    select.appendChild(inicial);
    ESTADOS.forEach(function(estado){
      if(estado === event.status) return;
      var o = document.createElement('option');
      o.value = estado; o.textContent = estado;
      select.appendChild(o);
    });

    select.addEventListener('change', function(){
      var destino = select.value;
      if(!destino) return;
      if(destino === 'Cancelado'){ pedirCausa(event, select); }
      else { aplicarEstado(event.code, destino, null, select); }
    });

    grupo.appendChild(select);

    var editar = document.createElement('button');
    editar.type = 'button';
    editar.className = 'btn btn-outline btn-sm';
    editar.textContent = 'Editar';
    editar.setAttribute('aria-label', 'Editar ' + event.name);
    editar.addEventListener('click', function(){ entrarEnEdicion(event); });
    grupo.appendChild(editar);

    grupo.appendChild(botonEliminar(event));
    return celda;
  }

  /* ----------------------------------------------------------------
     Eliminar un evento.

     Se pide confirmación escrita en la propia fila y no con un
     confirm() del navegador: el aviso puede explicar que esto no es lo
     mismo que cancelar, y que lo borrado no vuelve.
  ---------------------------------------------------------------- */
  function botonEliminar(event){
    var boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'btn btn-danger btn-sm';
    boton.textContent = 'Eliminar';
    boton.setAttribute('aria-label', 'Eliminar ' + event.name);
    boton.addEventListener('click', function(){ pedirConfirmacionBorrado(event, boton); });
    return boton;
  }

  function pedirConfirmacionBorrado(event, boton){
    var fila = boton.closest('tr');
    if(!fila) return;
    var siguiente = fila.nextSibling;
    if(siguiente && siguiente.classList && siguiente.classList.contains('delete-row')) return;

    var extra = document.createElement('tr');
    extra.className = 'cancel-row delete-row';
    var celda = document.createElement('td');
    celda.colSpan = 8;

    var caja = document.createElement('div');
    caja.className = 'cancel-box';

    var titulo = document.createElement('p');
    titulo.className = 'cancel-title';
    titulo.textContent = '¿Eliminar «' + event.name + '» (' + event.code + ')?';

    var nota = document.createElement('p');
    nota.className = 'cancel-note';
    nota.textContent = 'Esto borra el evento de la base de datos y no se puede deshacer. Si ya hay gente con reserva, cancélalo en vez de borrarlo: así queda el registro y la causa.';

    var acciones = document.createElement('div');
    acciones.className = 'cancel-actions';
    var confirmar = document.createElement('button');
    confirmar.type = 'button'; confirmar.className = 'btn btn-danger btn-sm';
    confirmar.textContent = 'Sí, eliminar';
    var descartar = document.createElement('button');
    descartar.type = 'button'; descartar.className = 'btn btn-outline btn-sm';
    descartar.textContent = 'Conservar';

    descartar.addEventListener('click', function(){ extra.remove(); boton.focus(); });
    confirmar.addEventListener('click', function(){
      confirmar.disabled = true;
      confirmar.textContent = 'Eliminando…';
      eliminarEvento(event, confirmar);
    });

    acciones.append(confirmar, descartar);
    caja.append(titulo, nota, acciones);
    celda.appendChild(caja);
    extra.appendChild(celda);
    fila.parentNode.insertBefore(extra, fila.nextSibling);
    confirmar.focus();
  }

  async function eliminarEvento(event, boton){
    setMessage('', '');
    try{
      var r = await tucketApi('/api/events/' + encodeURIComponent(event.code), { method: 'DELETE' });
      /* Si se estaba editando justo ese evento, el formulario vuelve a
         modo creación: no tiene sentido guardar cambios de algo que ya
         no existe. */
      if(editandoCodigo === event.code) salirDeEdicion();
      setMessage(r.message, 'success');
      await loadAgentEvents();
    }catch(error){
      setMessage(error.message, 'error');
      if(boton){ boton.disabled = false; boton.textContent = 'Sí, eliminar'; }
    }
  }

  /* Fila desplegable con la causa de cancelación */
  function pedirCausa(event, select){
    var fila = select.closest('tr');
    if(!fila || fila.nextSibling && fila.nextSibling.classList && fila.nextSibling.classList.contains('cancel-row')) return;

    var extra = document.createElement('tr');
    extra.className = 'cancel-row';
    var celda = document.createElement('td');
    celda.colSpan = 8;

    var caja = document.createElement('div');
    caja.className = 'cancel-box';

    var etiqueta = document.createElement('label');
    var idCampo = 'cancel-reason-' + event.code;
    etiqueta.setAttribute('for', idCampo);
    etiqueta.textContent = 'Causa de la cancelación de «' + event.name + '»';

    var campo = document.createElement('input');
    campo.type = 'text'; campo.id = idCampo;
    campo.minLength = 10; campo.maxLength = 500;
    campo.placeholder = 'Explica por qué se cancela (mínimo 10 caracteres)';

    var aviso = document.createElement('p');
    aviso.className = 'cancel-note'; aviso.hidden = true; aviso.setAttribute('role','alert');

    var acciones = document.createElement('div');
    acciones.className = 'cancel-actions';
    var confirmar = document.createElement('button');
    confirmar.type = 'button'; confirmar.className = 'btn btn-danger btn-sm';
    confirmar.textContent = 'Confirmar cancelación';
    var descartar = document.createElement('button');
    descartar.type = 'button'; descartar.className = 'btn btn-outline btn-sm';
    descartar.textContent = 'Descartar';

    function cerrar(){ extra.remove(); select.value = ''; }
    descartar.addEventListener('click', cerrar);
    confirmar.addEventListener('click', function(){
      var causa = campo.value.trim();
      if(causa.length < 10){
        aviso.textContent = 'La causa debe tener al menos 10 caracteres.';
        aviso.hidden = false; campo.focus(); return;
      }
      aplicarEstado(event.code, 'Cancelado', causa, select);
    });

    acciones.append(confirmar, descartar);
    caja.append(etiqueta, campo, aviso, acciones);
    celda.appendChild(caja);
    extra.appendChild(celda);
    fila.parentNode.insertBefore(extra, fila.nextSibling);
    campo.focus();
  }

  async function aplicarEstado(code, status, causa, select){
    if(select) select.disabled = true;
    setMessage('', '');
    var cuerpo = { status: status };
    if(causa) cuerpo.cancellationReason = causa;
    try{
      var r = await tucketApi('/api/events/' + encodeURIComponent(code) + '/status', {
        method: 'PATCH', body: JSON.stringify(cuerpo)
      });
      setMessage(r.message, 'success');
      await loadAgentEvents();
    }catch(error){
      setMessage(error.message, 'error');
      if(select){ select.disabled = false; select.value = ''; }
      var abierta = document.querySelector('.cancel-row');
      if(abierta) abierta.remove();
    }
  }

  async function loadAgentEvents(){
    try{
      var events = await tucketApi('/api/events/mine');
      renderEvents(events);
    }catch(error){
      renderEvents([]);
      if(apiNoDisponible(error)){
        setMessage('No se pudo contactar con el servidor, así que no hay eventos que mostrar. Enciende el backend y recarga.', 'error');
        return;
      }
      if(error.message.toLowerCase().includes('sesión') || error.message.toLowerCase().includes('inicia sesión')){
        setMessage('Inicia sesión con una cuenta de agente para consultar y registrar eventos.', 'error');
      }else{
        setMessage(error.message, 'error');
      }
    }
  }

  /* ----------------------------------------------------------------
     Edición de un evento.

     Se reutiliza el mismo formulario en vez de abrir otro: son los
     mismos campos y las mismas validaciones, y así no hay dos sitios
     que mantener. Lo único que cambia es a dónde se envía y el texto
     de los botones.

     editandoCodigo guarda el código del evento abierto, o null cuando
     el formulario está creando uno nuevo.
  ---------------------------------------------------------------- */
  var editandoCodigo = null;
  var imagenesQuitadas = { afiche:false, banner:false };

  /* Un evento nuevo no puede empezar en el pasado: se publica para que
     alguien asista. Si se deja, el estado calculado lo marca Finalizado
     nada más crearlo y parece un error del sistema. El servidor lo
     revalida igual. */
  function ahoraLocal(){
    return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  function aplicarMinimoFechas(){
    var inicio = el('event-start');
    var fin = el('event-end');
    if(!inicio || !fin) return;
    inicio.min = ahoraLocal();
    fin.min = ahoraLocal();
  }

  function paraCampoLocal(iso){
    var d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  /* Deja seleccionados país, departamento y ciudad esperando a que cada
     lista termine de cargar: la de departamentos depende del país y la
     de ciudades del departamento, así que no se pueden fijar de golpe. */
  async function seleccionarUbicacion(countryCode, departmentCode, cityId){
    var country = el('event-country');
    var department = el('event-department');
    var city = el('agent-event-city');
    await loadCountries();
    country.value = countryCode || '';
    await loadDepartments();
    department.value = departmentCode || '';
    await loadCities();
    city.value = cityId ? String(cityId) : '';
  }

  /* Muestra la imagen que el evento ya tiene guardada. No es un archivo
     elegido, así que no viaja en el envío: solo se manda si el agente
     la reemplaza o la quita. */
  function mostrarImagenGuardada(clave, ruta, alt){
    var campo = CAMPOS_IMAGEN[clave];
    var img = el(campo.thumb);
    var caja = el(campo.caja);
    var quitar = el(campo.quitar);
    var pista = el(campo.pista);
    if(!ruta){ limpiarImagen(clave); return; }
    if(img){ img.src = ruta; img.alt = alt || ('Imagen actual de ' + campo.nombre.toLowerCase()); img.hidden = false; }
    if(caja) caja.dataset.empty = 'false';
    if(quitar) quitar.hidden = false;
    if(pista) pista.textContent = 'Imagen actual';
  }

  async function entrarEnEdicion(event){
    var form = el('agent-event-form');
    if(!form) return;
    editandoCodigo = event.code;
    imagenesQuitadas = { afiche:false, banner:false };
    imagenesSeleccionadas = { afiche:null, banner:null };

    el('event-form-title').textContent = 'Editar evento';
    el('event-code-display').textContent = event.code;
    el('event-code-help').textContent = 'El código no cambia al editar: las reservas ya hechas siguen apuntando a él.';
    el('event-submit').textContent = 'Guardar cambios';
    el('event-cancel-edit').hidden = false;
    var campoEstado = el('event-status-field');
    if(campoEstado) campoEstado.hidden = true;

    el('event-name').value = event.name;
    el('event-description').value = event.description || '';
    el('event-venue').value = event.venue || '';
    el('event-capacity').value = event.total_capacity;
    el('event-price').value = event.base_price;
    el('event-observations').value = event.observations || '';

    /* El mínimo de fecha se levanta: un evento ya publicado puede tener
       la fecha encima o recién pasada y el campo no debe bloquearla si
       no se va a cambiar. El servidor sí revisa que no la muevan al
       pasado. */
    var inicio = el('event-start');
    var fin = el('event-end');
    inicio.min = '';
    fin.min = '';
    inicio.value = paraCampoLocal(event.starts_at);
    fin.value = paraCampoLocal(event.ends_at);

    el('event-image-alt').value = event.image_alt || '';
    el('event-banner-alt').value = event.banner_alt || '';
    mostrarImagenGuardada('afiche', event.image_path, event.image_alt);
    mostrarImagenGuardada('banner', event.banner_path, event.banner_alt);

    setMessage('Estás editando «' + event.name + '». Cambia lo que necesites y guarda.', 'success');
    form.scrollIntoView({ behavior:'smooth', block:'start' });

    await seleccionarUbicacion(event.country_code, event.department_code, event.city_id);
  }

  function salirDeEdicion(){
    var form = el('agent-event-form');
    editandoCodigo = null;
    imagenesQuitadas = { afiche:false, banner:false };
    if(form) form.reset();
    limpiarAfiche();
    el('event-form-title').textContent = 'Registrar nuevo evento';
    el('event-code-help').textContent = 'Lo asigna el sistema de forma automática y consecutiva.';
    el('event-submit').textContent = 'Publicar evento';
    el('event-cancel-edit').hidden = true;
    var campoEstado = el('event-status-field');
    if(campoEstado) campoEstado.hidden = false;
    el('agent-event-status').value = 'Programado';
    el('event-department').disabled = true;
    el('agent-event-city').disabled = true;
    setLoading(el('event-department'), 'Selecciona primero un país');
    setLoading(el('agent-event-city'), 'Selecciona primero un departamento');
    aplicarMinimoFechas();
    mostrarProximoCodigo();
    setMessage('', '');
  }
  window.salirDeEdicion = salirDeEdicion;

  /* El próximo código se consulta al servidor solo para mostrarlo. El
     definitivo se asigna al guardar, porque entre tanto puede haber
     guardado otro agente. */
  async function mostrarProximoCodigo(){
    var caja = el('event-code-display');
    if(!caja || editandoCodigo) return;
    caja.textContent = 'Se asigna al guardar';
    try{
      var r = await tucketApi('/api/events/next-code');
      if(!editandoCodigo) caja.textContent = r.code;
    }catch(error){ /* Sin servidor se queda el texto genérico. */ }
  }

  async function createEvent(event){
    event.preventDefault();
    var form = event.currentTarget;
    var startInput = el('event-start');
    var endInput = el('event-end');
    endInput.setCustomValidity('');
    if(!form.reportValidity()) return false;
    if(new Date(endInput.value) <= new Date(startInput.value)){
      endInput.setCustomValidity('La fecha y hora de finalización debe ser posterior al inicio.');
      endInput.reportValidity();
      return false;
    }

    var editando = editandoCodigo;
    var submit = el('event-submit');
    submit.disabled = true;
    submit.textContent = 'Guardando…';
    setMessage('', '');
    var payload = {
      name: el('event-name').value.trim(),
      description: el('event-description').value.trim(),
      venue: el('event-venue').value.trim(),
      countryCode: el('event-country').value,
      departmentCode: el('event-department').value,
      cityId: Number(el('agent-event-city').value),
      startsAt: new Date(startInput.value).toISOString(),
      endsAt: new Date(endInput.value).toISOString(),
      totalCapacity: Number(el('event-capacity').value),
      basePrice: Number(el('event-price').value),
      observations: el('event-observations').value.trim(),
      status: el('agent-event-status').value
    };
    /* Las imágenes solo viajan si el agente eligió alguna. */
    if(imagenesSeleccionadas.afiche){
      payload.image = {
        data: imagenesSeleccionadas.afiche,
        alt: el('event-image-alt') ? el('event-image-alt').value.trim() : ''
      };
    }
    if(imagenesSeleccionadas.banner){
      payload.banner = {
        data: imagenesSeleccionadas.banner,
        alt: el('event-banner-alt') ? el('event-banner-alt').value.trim() : ''
      };
    }

    /* Al editar, el estado no se manda —se cambia desde la tabla— y sí
       se avisa de las imágenes que el agente quitó, porque no mandar
       nada significa «déjala como está». */
    if(editando){
      delete payload.status;
      if(imagenesQuitadas.afiche && !imagenesSeleccionadas.afiche) payload.removeImage = true;
      if(imagenesQuitadas.banner && !imagenesSeleccionadas.banner) payload.removeBanner = true;
      if(!imagenesSeleccionadas.afiche && !payload.removeImage){
        payload.image = { alt: el('event-image-alt').value.trim() };
      }
      if(!imagenesSeleccionadas.banner && !payload.removeBanner){
        payload.banner = { alt: el('event-banner-alt').value.trim() };
      }
    }

    try{
      var result = editando
        ? await tucketApi('/api/events/' + encodeURIComponent(editando), { method: 'PUT', body: JSON.stringify(payload) })
        : await tucketApi('/api/events', { method: 'POST', body: JSON.stringify(payload) });
      salirDeEdicion();
      setMessage(result.message, 'success');
      await loadAgentEvents();
    }catch(error){
      setMessage(error.message, 'error');
    }finally{
      submit.disabled = false;
      submit.textContent = editandoCodigo ? 'Guardar cambios' : 'Publicar evento';
    }
    return false;
  }

  window.initAgentEvents = function(){
    var view = el(viewId);
    if(!view) return;
    var country = el('event-country');
    var department = el('event-department');
    var form = el('agent-event-form');
    if(country && country.dataset.listeners !== 'true'){
      country.addEventListener('change', loadDepartments);
      department.addEventListener('change', loadCities);
      country.dataset.listeners = 'true';
    }
    if(form && form.dataset.listener !== 'true'){
      form.addEventListener('submit', createEvent);
      form.dataset.listener = 'true';
      el('event-end').addEventListener('input', function(){ this.setCustomValidity(''); });

      aplicarMinimoFechas();
      /* Y el final nunca antes del inicio: el calendario del navegador ya
         no deja elegirlo, en vez de avisar después de intentarlo. */
      var inicio = el('event-start');
      var fin = el('event-end');
      inicio.addEventListener('change', function(){
        fin.min = inicio.value || (editandoCodigo ? '' : ahoraLocal());
        if(fin.value && fin.value <= inicio.value) fin.value = '';
      });
    }
    var imagen = el('event-image');
    if(imagen && imagen.dataset.listener !== 'true'){
      imagen.addEventListener('change', elegirAfiche);
      var quitar = el('event-image-clear');
      if(quitar) quitar.addEventListener('click', function(){ quitarImagen('afiche'); });
      imagen.dataset.listener = 'true';
      limpiarImagen('afiche');
    }
    var banner = el('event-banner');
    if(banner && banner.dataset.listener !== 'true'){
      banner.addEventListener('change', elegirBanner);
      var quitarBanner = el('event-banner-clear');
      if(quitarBanner) quitarBanner.addEventListener('click', function(){ quitarImagen('banner'); });
      banner.dataset.listener = 'true';
      limpiarImagen('banner');
    }
    /* Al volver a entrar a la vista el formulario arranca siempre en
       modo creación: una edición a medias de la visita anterior no
       debería seguir abierta. */
    if(editandoCodigo) salirDeEdicion();
    else mostrarProximoCodigo();
    loadCountries();
    loadAgentEvents();
  };
})();
