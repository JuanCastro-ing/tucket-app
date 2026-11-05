/* TUCKET — Vista Mi perfil
   HU: el usuario autenticado (cliente o agente) edita sus datos personales.
   Necesita api.js, auth.js, validation.js y navigation.js. */
(function(){
  var perfilActual = null;      /* lo último confirmado por el servidor */
  var perfilCargando = false;
  var modoPrototipo = false;    /* sin backend: se edita solo en memoria */

  function el(id){ return document.getElementById(id); }

  function setMessage(texto, tipo){
    var caja = el('profile-message');
    if(!caja) return;
    caja.textContent = texto || '';
    caja.hidden = !texto;
    caja.className = 'form-message' + (tipo ? ' form-message-' + tipo : '');
  }

  function iniciales(nombre){
    var partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
    if(!partes.length) return '··';
    return (partes[0][0] + (partes[1] ? partes[1][0] : '')).toLocaleUpperCase('es-CO');
  }

  function fechaLarga(valor){
    if(!valor) return '—';
    var fecha = new Date(valor);
    if(Number.isNaN(fecha.getTime())) return '—';
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'long', timeZone: 'America/Bogota'
    }).format(fecha);
  }

  /* Selects encadenados: país → departamento → ciudad.
     Mismo comportamiento que el formulario de eventos, pero aquí los
     tres pueden quedar vacíos porque la ubicación es opcional. */
  function llenarSelect(select, filas, textoVacio, valorElegido){
    select.replaceChildren(new Option(textoVacio, ''));
    filas.forEach(function(fila){
      select.add(new Option(fila.name, String(fila.code != null ? fila.code : fila.id)));
    });
    select.value = valorElegido != null ? String(valorElegido) : '';
    select.disabled = false;
  }

  function bloquear(select, texto){
    select.replaceChildren(new Option(texto, ''));
    select.value = '';
    select.disabled = true;
  }

  async function cargarPaises(elegido){
    var select = el('profile-country');
    if(!select) return;
    try{
      var filas = await tucketApi('/api/geography/countries');
      llenarSelect(select, filas, 'Sin especificar', elegido);
    }catch(error){
      bloquear(select, 'No se pudieron cargar los países');
    }
  }

  async function cargarDepartamentos(pais, elegido){
    var select = el('profile-department');
    if(!select) return;
    if(!pais){ bloquear(select, 'Selecciona primero un país'); bloquear(el('profile-city'), 'Selecciona primero un departamento'); return; }
    bloquear(select, 'Cargando…');
    try{
      var filas = await tucketApi('/api/geography/countries/' + encodeURIComponent(pais) + '/departments');
      llenarSelect(select, filas, 'Sin especificar', elegido);
    }catch(error){
      bloquear(select, 'No se pudieron cargar los departamentos');
    }
  }

  async function cargarCiudades(departamento, elegido){
    var select = el('profile-city');
    if(!select) return;
    if(!departamento){ bloquear(select, 'Selecciona primero un departamento'); return; }
    bloquear(select, 'Cargando…');
    try{
      var filas = await tucketApi('/api/geography/departments/' + encodeURIComponent(departamento) + '/cities');
      llenarSelect(select, filas, 'Sin especificar', elegido);
    }catch(error){
      bloquear(select, 'No se pudieron cargar las ciudades');
    }
  }

  /* Pintar el perfil en pantalla */
  /* El administrador tiene un perfil reducido: su tabla solo guarda nombre
     y correo. Se marca en el <html> para que el CSS esconda las secciones
     de contacto y ubicación, y para que guardar() se salte sus reglas. */
  function esAdministrador(perfil){
    return (perfil && perfil.role) === 'administrador';
  }

  function pintar(perfil){
    perfilActual = perfil;

    var reducido = esAdministrador(perfil);
    document.documentElement.setAttribute('data-perfil', reducido ? 'reducido' : 'completo');

    /* El texto de arriba habla de teléfonos y dirección, que el
       administrador no tiene. */
    var intro = el('profile-intro');
    if(intro){
      intro.textContent = reducido
        ? 'Actualiza tu nombre y cambia tu contraseña. La cuenta de administrador no guarda teléfonos ni dirección.'
        : 'Actualiza tu nombre, tus teléfonos de contacto y tu dirección. Los cambios quedan guardados en tu cuenta de TUCKET.';
    }

    el('profile-name').value = perfil.fullName || '';
    el('profile-phone').value = perfil.phone || '';
    el('profile-phone-alt').value = perfil.phoneAlt || '';
    el('profile-address').value = perfil.address || '';

    el('profile-email').textContent = perfil.email || '—';
    var nombreRol = { agente:'Agente', administrador:'Administrador', cliente:'Cliente' };
    el('profile-role').textContent = nombreRol[perfil.role] || 'Cliente';
    el('profile-created').textContent = fechaLarga(perfil.createdAt);
    el('profile-updated').textContent = perfil.updatedAt ? fechaLarga(perfil.updatedAt) : 'Sin cambios todavía';

    var pill = el('profile-role-pill');
    if(pill) pill.textContent = (nombreRol[perfil.role] || 'Cliente').toUpperCase();
    var avatar = el('profile-avatar');
    if(avatar) avatar.textContent = iniciales(perfil.fullName);

    var filaDoc = el('profile-doc-row');
    if(filaDoc){
      if(perfil.documentNumber){
        el('profile-doc').textContent = (perfil.documentType || 'CC') + ' ' + perfil.documentNumber;
        filaDoc.hidden = false;
      }else{
        filaDoc.hidden = true;
      }
    }
  }

  async function pintarUbicacion(perfil){
    await cargarPaises(perfil.countryCode || '');
    if(perfil.countryCode){
      await cargarDepartamentos(perfil.countryCode, perfil.departmentCode || '');
      if(perfil.departmentCode){
        await cargarCiudades(perfil.departmentCode, perfil.cityId || '');
      }
    }else{
      bloquear(el('profile-department'), 'Selecciona primero un país');
      bloquear(el('profile-city'), 'Selecciona primero un departamento');
    }
  }

  /* Perfil de muestra para recorrer la vista sin backend. */
  function perfilDemo(){
    return {
      fullName: currentRole === 'agente' ? 'Agente de muestra' : 'Cliente de muestra',
      email: currentRole === 'agente' ? 'agente@tucket.co' : 'cliente@tucket.co',
      phone: '+57 300 000 0000', phoneAlt: '', address: 'Calle 5 # 23-10',
      countryCode: '', departmentCode: '', cityId: null,
      role: currentRole === 'agente' ? 'agente' : 'cliente',
      createdAt: new Date().toISOString(), updatedAt: null
    };
  }

  async function cargarPerfil(){
    if(perfilCargando) return;
    perfilCargando = true;
    setMessage('', '');
    try{
      var perfil = await tucketApi('/api/profile');
      modoPrototipo = false;
      pintar(perfil);
      await pintarUbicacion(perfil);
    }catch(error){
      if(apiNoDisponible(error) || error.status === 401 || error.status === 403){
        modoPrototipo = true;
        var demo = perfilDemo();
        pintar(demo);
        bloquear(el('profile-country'), 'Sin conexión con el servidor');
        bloquear(el('profile-department'), 'Selecciona primero un país');
        bloquear(el('profile-city'), 'Selecciona primero un departamento');
        setMessage('Backend no disponible: estás viendo un perfil de muestra. Los cambios no se guardan.', 'error');
      }else{
        setMessage(error.message, 'error');
      }
    }finally{
      perfilCargando = false;
    }
  }

  /* Guardar */
  function soloDigitos(valor){ return String(valor).replace(/\D/g, '').length; }

  async function guardar(evento){
    if(evento) evento.preventDefault();

    /* El administrador solo envía el nombre: no tiene los demás campos. */
    if(esAdministrador(perfilActual)){
      var okNombre = validarCampos([
        { id:'profile-name', test:noVacio, mensaje:'Ingresa tu nombre completo.' }
      ]);
      if(!okNombre) return false;
      return guardarPayload({ fullName: el('profile-name').value.trim() });
    }

    var telefono = el('profile-phone');
    var alterno = el('profile-phone-alt');
    var ok = validarCampos([
      { id:'profile-name',  test:noVacio, mensaje:'Ingresa tu nombre completo.' },
      { id:'profile-phone', test:function(i){ return soloDigitos(i.value) >= 7; },
        mensaje:'Ingresa un teléfono de al menos 7 dígitos.' },
      { id:'profile-phone-alt', test:function(i){ return !i.value.trim() || soloDigitos(i.value) >= 7; },
        mensaje:'El segundo teléfono debe tener al menos 7 dígitos, o déjalo vacío.' }
    ]);
    if(!ok) return false;

    if(alterno.value.trim() && alterno.value.trim() === telefono.value.trim()){
      showFieldError(alterno, 'Los dos teléfonos son iguales. Escribe uno distinto o déjalo vacío.');
      return false;
    }

    /* La ubicación va completa o no va: así lo exige la base. */
    var pais = el('profile-country').value;
    var departamento = el('profile-department').value;
    var ciudad = el('profile-city').value;
    if((pais || departamento || ciudad) && !(pais && departamento && ciudad)){
      showFieldError(el('profile-city'), 'Selecciona país, departamento y ciudad, o deja los tres vacíos.');
      return false;
    }

    return guardarPayload({
      fullName: el('profile-name').value.trim(),
      phone: telefono.value.trim(),
      phoneAlt: alterno.value.trim(),
      address: el('profile-address').value.trim(),
      countryCode: pais || null,
      departmentCode: departamento || null,
      cityId: ciudad ? Number(ciudad) : null
    });
  }

  /* El envío está aparte de la validación porque hay dos formas de llegar
     aquí: el formulario completo de cliente y agente, y el reducido del
     administrador, que solo manda el nombre. */
  async function guardarPayload(payload){
    var boton = el('profile-submit');
    boton.disabled = true;
    boton.textContent = 'Guardando…';
    setMessage('', '');

    if(modoPrototipo){
      pintar(Object.assign({}, perfilActual, payload, { updatedAt: new Date().toISOString() }));
      setMessage('Guardado en modo prototipo. No se escribió en la base de datos.', 'error');
      boton.disabled = false; boton.textContent = 'Guardar cambios';
      return false;
    }

    try{
      var respuesta = await tucketApi('/api/profile', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      pintar(respuesta.profile);
      setMessage(respuesta.message, 'success');
      /* El nombre sale en la cabecera de otras vistas: se refresca el avatar. */
      document.querySelectorAll('.nav-user .avatar').forEach(function(nodo){
        nodo.textContent = iniciales(respuesta.profile.fullName);
      });
    }catch(error){
      setMessage(error.message, 'error');
    }finally{
      boton.disabled = false;
      boton.textContent = 'Guardar cambios';
    }
    return false;
  }

  function descartar(){
    if(!perfilActual) return;
    pintar(perfilActual);
    pintarUbicacion(perfilActual);
    setMessage('Se descartaron los cambios sin guardar.', '');
  }

  /* Arranque de la vista */
  window.initProfile = function(){
    var vista = el('view-profile');
    if(!vista) return;

    var form = el('profile-form');
    if(form && form.dataset.listener !== 'true'){
      form.addEventListener('submit', guardar);
      el('profile-reset').addEventListener('click', descartar);
      el('profile-country').addEventListener('change', function(){
        cargarDepartamentos(this.value, '');
        bloquear(el('profile-city'), 'Selecciona primero un departamento');
      });
      el('profile-department').addEventListener('change', function(){
        cargarCiudades(this.value, '');
      });
      form.dataset.listener = 'true';
    }
    cargarPerfil();
  };
})();
