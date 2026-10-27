/* HU-03 y HU-04: alta de eventos y selección geográfica en cascada. */
(function(){
  var viewId = 'view-agent-events';

  /* ---------------- Modo prototipo (sin PostgreSQL) ----------------
     Cuando la API no está disponible el panel sigue siendo usable con estos
     datos en memoria: se pueden consultar, crear y cambiar de estado. Todo se
     pierde al recargar, que es justo lo que se espera de un prototipo. */
  var DEMO_GEO = {
    paises: [{ code:'CO', name:'Colombia' }],
    departamentos: { CO: [
      { code:'76', name:'Valle del Cauca' },
      { code:'11', name:'Bogotá D.C.' },
      { code:'05', name:'Antioquia' }
    ]},
    ciudades: {
      '76': [{ id:1, name:'Cali' }, { id:2, name:'Tuluá' }, { id:3, name:'Palmira' }],
      '11': [{ id:4, name:'Bogotá' }],
      '05': [{ id:5, name:'Medellín' }]
    }
  };
  var demoEvents = [
    { code:'EVT-2026-0184', name:'Noche de Salsa — Grupo Niche Tributo',
      description:'Tributo a la salsa caleña con banda en vivo.',
      venue:'Teatro Los Cristales', city:'Cali', department:'Valle del Cauca',
      starts_at:'2026-11-14T20:00:00-05:00', ends_at:'2026-11-14T23:00:00-05:00',
      total_capacity:1200, base_price:85000, status:'En Boletería', observations:'' },
    { code:'EVT-2026-0201', name:'Romeo y Julieta — Compañía Nacional de Teatro',
      description:'Puesta en escena del clásico de Shakespeare.',
      venue:'Teatro Municipal Ángel María Camacho', city:'Tuluá', department:'Valle del Cauca',
      starts_at:'2026-12-02T19:30:00-05:00', ends_at:'2026-12-02T22:00:00-05:00',
      total_capacity:800, base_price:52000, status:'Programado', observations:'' }
  ];
  function esDemo(){ return typeof tucketDemoMode !== 'undefined' && tucketDemoMode; }
  function avisoDemo(){
    setMessage('Modo prototipo: el backend no está disponible, así que trabajas con datos de muestra que no se guardan.', 'success');
  }
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
    if(esDemo()){
      setOptions(country, DEMO_GEO.paises, 'Selecciona un país', 'code');
      country.disabled = false; country.dataset.loaded = 'true';
      department.disabled = true; city.disabled = true;
      return;
    }
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
    if(esDemo()){
      setOptions(department, DEMO_GEO.departamentos[country.value] || [], 'Selecciona un departamento', 'code');
      department.disabled = false;
      return;
    }
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
    if(esDemo()){
      setOptions(city, DEMO_GEO.ciudades[department.value] || [], 'Selecciona una ciudad', 'id');
      city.disabled = false;
      return;
    }
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
  var aficheSeleccionado = null;   /* dataURL del archivo elegido */

  function limpiarAfiche(){
    aficheSeleccionado = null;
    var input = el('event-image');
    var caja = el('event-image-preview');
    var img = el('event-image-thumb');
    var quitar = el('event-image-clear');
    var pista = el('event-image-hint');
    if(input) input.value = '';
    if(img){ img.hidden = true; img.removeAttribute('src'); img.alt = ''; }
    if(caja) caja.dataset.empty = 'true';
    if(quitar) quitar.hidden = true;
    if(pista) pista.textContent = 'Sin afiche';
  }

  function elegirAfiche(){
    var input = el('event-image');
    var archivo = input && input.files ? input.files[0] : null;
    if(!archivo){ limpiarAfiche(); return; }

    /* Se valida aquí para avisar antes de subir 4 MB al servidor; el
       backend vuelve a validarlo igual, porque esto es solo comodidad. */
    if(TIPOS_AFICHE.indexOf(archivo.type) === -1){
      setMessage('El afiche debe ser una imagen JPG, PNG o WEBP.', 'error');
      limpiarAfiche();
      return;
    }
    if(archivo.size > MAX_AFICHE){
      setMessage('El afiche pesa ' + (archivo.size / 1048576).toFixed(1) + ' MB. El máximo es 4 MB.', 'error');
      limpiarAfiche();
      return;
    }

    var lector = new FileReader();
    lector.onload = function(){
      aficheSeleccionado = String(lector.result || '');
      var img = el('event-image-thumb');
      var caja = el('event-image-preview');
      var quitar = el('event-image-clear');
      var pista = el('event-image-hint');
      if(img){
        img.src = aficheSeleccionado;
        img.alt = 'Vista previa del afiche seleccionado';
        img.hidden = false;
      }
      if(caja) caja.dataset.empty = 'false';
      if(quitar) quitar.hidden = false;
      if(pista) pista.textContent = archivo.name;
      setMessage('', '');
    };
    lector.onerror = function(){
      setMessage('No se pudo leer la imagen. Intenta con otro archivo.', 'error');
      limpiarAfiche();
    };
    lector.readAsDataURL(archivo);
  }

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
      details.append(strong, code);
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
    if(nota) nota.textContent = esDemo() ? 'Datos de muestra en memoria' : 'Guardados en PostgreSQL';
    var origen = el('agent-api-state');
    if(origen) origen.textContent = esDemo() ? 'Modo prototipo' : 'PostgreSQL';
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

    if(ESTADOS_FINALES.indexOf(event.status) !== -1){
      var fin = document.createElement('span');
      fin.className = 'cell-muted';
      fin.textContent = 'Ciclo cerrado';
      celda.appendChild(fin);
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

    celda.appendChild(select);
    return celda;
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
    if(esDemo()){
      demoEvents = demoEvents.map(function(e){
        if(e.code !== code) return e;
        var copia = Object.assign({}, e, { status: status });
        copia.cancellation_reason = status === 'Cancelado' ? causa : null;
        return copia;
      });
      renderEvents(demoEvents);
      setMessage(status === 'Cancelado'
        ? 'Evento cancelado en modo prototipo. La causa quedó registrada en memoria.'
        : 'Estado actualizado a ' + status + ' (modo prototipo).', 'success');
      return;
    }
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
    if(esDemo()){ renderEvents(demoEvents); avisoDemo(); return; }
    try{
      var events = await tucketApi('/api/events/mine');
      renderEvents(events);
    }catch(error){
      if(apiNoDisponible(error)){
        tucketDemoMode = true;
        renderEvents(demoEvents);
        avisoDemo();
        return;
      }
      renderEvents([]);
      if(error.message.toLowerCase().includes('sesión') || error.message.toLowerCase().includes('inicia sesión')){
        setMessage('Inicia sesión con una cuenta de agente para consultar y registrar eventos.', 'error');
      }else{
        setMessage(error.message, 'error');
      }
    }
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

    var submit = el('event-submit');
    submit.disabled = true;
    submit.textContent = 'Guardando…';
    setMessage('', '');
    var payload = {
      code: el('event-code').value.trim(),
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
    /* El afiche solo viaja si el agente eligió uno. */
    if(aficheSeleccionado){
      payload.image = {
        data: aficheSeleccionado,
        alt: el('event-image-alt') ? el('event-image-alt').value.trim() : ''
      };
    }
    if(esDemo()){
      if(demoEvents.some(function(e){ return e.code === payload.code; })){
        setMessage('Ese código ya está registrado. Usa un código único.', 'error');
        submit.disabled = false; submit.textContent = 'Publicar evento';
        return false;
      }
      var depSel = el('event-department'), citySel = el('agent-event-city');
      demoEvents.unshift({
        code: payload.code, name: payload.name, description: payload.description,
        venue: payload.venue,
        city: citySel.options[citySel.selectedIndex] ? citySel.options[citySel.selectedIndex].textContent : '',
        department: depSel.options[depSel.selectedIndex] ? depSel.options[depSel.selectedIndex].textContent : '',
        starts_at: payload.startsAt, ends_at: payload.endsAt,
        total_capacity: payload.totalCapacity, base_price: payload.basePrice,
        status: payload.status, observations: payload.observations,
        image_path: aficheSeleccionado || null,
        image_alt: payload.image ? payload.image.alt : ''
      });
      form.reset();
      limpiarAfiche();
      el('agent-event-status').value = 'Programado';
      el('event-department').disabled = true;
      el('agent-event-city').disabled = true;
      setLoading(el('event-department'), 'Selecciona primero un país');
      setLoading(el('agent-event-city'), 'Selecciona primero un departamento');
      el('event-country').dataset.loaded = '';
      loadCountries();
      renderEvents(demoEvents);
      setMessage('Evento registrado en modo prototipo. No se guarda en base de datos.', 'success');
      submit.disabled = false; submit.textContent = 'Publicar evento';
      return false;
    }
    try{
      var result = await tucketApi('/api/events', { method: 'POST', body: JSON.stringify(payload) });
      setMessage(result.message, 'success');
      form.reset();
      limpiarAfiche();
      el('agent-event-status').value = 'Programado';
      el('event-department').disabled = true;
      el('agent-event-city').disabled = true;
      setLoading(el('event-department'), 'Selecciona primero un país');
      setLoading(el('agent-event-city'), 'Selecciona primero un departamento');
      await loadAgentEvents();
    }catch(error){
      setMessage(error.message, 'error');
    }finally{
      submit.disabled = false;
      submit.textContent = 'Publicar evento';
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
    }
    var imagen = el('event-image');
    if(imagen && imagen.dataset.listener !== 'true'){
      imagen.addEventListener('change', elegirAfiche);
      var quitar = el('event-image-clear');
      if(quitar) quitar.addEventListener('click', limpiarAfiche);
      imagen.dataset.listener = 'true';
      limpiarAfiche();
    }
    loadCountries();
    loadAgentEvents();
  };
})();
