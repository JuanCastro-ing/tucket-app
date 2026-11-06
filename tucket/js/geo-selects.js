/* TUCKET — Selector de ubicación en cascada (país → departamento → ciudad).

   Las tres listas salen de la base: la tabla de municipios del DANE que
   carga `npm run db:setup`. Cada una depende de la anterior, y hasta que
   no se elige la de arriba la siguiente está deshabilitada, para que no
   se pueda mandar una combinación imposible como «Cali, Antioquia».

   La misma validación existe en el servidor y, por debajo, una clave
   foránea compuesta en la base impide guardar un trío que no exista.
   Tres barreras: la de aquí es comodidad, la de la base es la que manda.

   Uso:
       var ubic = montarUbicacion({
         pais: 'reg-country', departamento: 'reg-department', ciudad: 'reg-city'
       });
       await ubic.cargar();              // llena las listas
       var datos = ubic.valores();       // {countryCode, departmentCode, cityId}
*/

function montarUbicacion(ids, opciones){
  var cfg = opciones || {};
  var textoVacio = cfg.textoVacio || 'Sin especificar';

  function el(id){ return document.getElementById(id); }

  function bloquear(select, texto){
    if(!select) return;
    select.innerHTML = '';
    var o = document.createElement('option');
    o.value = ''; o.textContent = texto;
    select.append(o);
    select.disabled = true;
  }

  function llenar(select, filas, elegido){
    if(!select) return;
    select.innerHTML = '';
    var vacio = document.createElement('option');
    vacio.value = ''; vacio.textContent = textoVacio;
    select.append(vacio);
    filas.forEach(function(f){
      var o = document.createElement('option');
      /* Las ciudades se identifican por id numérico y los países y
         departamentos por su código. */
      o.value = String(f.id !== undefined ? f.id : f.code);
      o.textContent = f.name;
      select.append(o);
    });
    select.disabled = false;
    if(elegido !== undefined && elegido !== null && elegido !== '') select.value = String(elegido);
  }

  async function cargarPaises(elegido){
    var select = el(ids.pais);
    if(!select) return;
    bloquear(select, 'Cargando…');
    try{
      llenar(select, await tucketApi('/api/geography/countries'), elegido);
    }catch(error){
      bloquear(select, 'No se pudieron cargar los países');
    }
  }

  async function cargarDepartamentos(pais, elegido){
    var select = el(ids.departamento);
    if(!select) return;
    if(!pais){
      bloquear(select, 'Selecciona primero un país');
      bloquear(el(ids.ciudad), 'Selecciona primero un departamento');
      return;
    }
    bloquear(select, 'Cargando…');
    try{
      llenar(select, await tucketApi('/api/geography/countries/' + encodeURIComponent(pais) + '/departments'), elegido);
    }catch(error){
      bloquear(select, 'No se pudieron cargar los departamentos');
    }
  }

  async function cargarCiudades(departamento, elegido){
    var select = el(ids.ciudad);
    if(!select) return;
    if(!departamento){ bloquear(select, 'Selecciona primero un departamento'); return; }
    bloquear(select, 'Cargando…');
    try{
      llenar(select, await tucketApi('/api/geography/departments/' + encodeURIComponent(departamento) + '/cities'), elegido);
    }catch(error){
      bloquear(select, 'No se pudieron cargar las ciudades');
    }
  }

  /* Al cambiar un nivel, los de abajo se reinician: dejar la ciudad
     anterior al cambiar de departamento es la forma más fácil de guardar
     una ubicación que no existe. */
  function conectar(){
    var pais = el(ids.pais), depto = el(ids.departamento);
    if(pais) pais.addEventListener('change', function(){
      cargarDepartamentos(this.value, '');
      bloquear(el(ids.ciudad), 'Selecciona primero un departamento');
    });
    if(depto) depto.addEventListener('change', function(){ cargarCiudades(this.value, ''); });
  }

  return {
    /* Carga inicial. Si se pasan valores, deja esa ubicación seleccionada
       (lo usa el perfil, que muestra la que ya tenía el usuario). */
    cargar: async function(valores){
      var v = valores || {};
      await cargarPaises(v.countryCode);
      if(v.countryCode){
        await cargarDepartamentos(v.countryCode, v.departmentCode);
        if(v.departmentCode) await cargarCiudades(v.departmentCode, v.cityId);
      }else{
        bloquear(el(ids.departamento), 'Selecciona primero un país');
        bloquear(el(ids.ciudad), 'Selecciona primero un departamento');
      }
      conectar();
    },

    /* Devuelve los tres datos listos para enviar, o null si está vacío.
       La ubicación es opcional, pero no a medias: o van los tres o ninguno,
       porque la clave foránea de la base valida el trío completo. */
    valores: function(){
      var pais = el(ids.pais), depto = el(ids.departamento), ciudad = el(ids.ciudad);
      var countryCode = pais ? pais.value.trim() : '';
      var departmentCode = depto ? depto.value.trim() : '';
      var cityId = ciudad ? Number(ciudad.value) : 0;
      if(!countryCode && !departmentCode && !cityId) return null;
      return { countryCode: countryCode, departmentCode: departmentCode, cityId: cityId || 0 };
    },

    /* true cuando están los tres o no hay ninguno. */
    completaOVacia: function(){
      var v = this.valores();
      return v === null || Boolean(v.countryCode && v.departmentCode && v.cityId);
    }
  };
}
