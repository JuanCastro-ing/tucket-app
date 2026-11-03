/* Cliente HTTP del mismo origen: la cookie de sesión es HttpOnly y no se lee desde JS. */

/* Se conserva en false y declarado porque alguna vista todavía lo consulta.
   El modo prototipo se retiró: la aplicación no trae datos escritos en el
   código, así que sin backend no hay nada que mostrar ni sesión que abrir. */
var tucketDemoMode = false;

async function tucketApi(path, options){
  options = options || {};
  var headers = new Headers(options.headers || {});
  if(options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  var response;
  try{
    response = await fetch(path, Object.assign({}, options, {
      headers: headers,
      credentials: 'same-origin'
    }));
  }catch(networkError){
    /* Sin servidor: no hay respuesta siquiera. Se marca para que quien llama
       pueda distinguirlo de un rechazo legítimo de credenciales. */
    var offline = new Error('No se pudo contactar con el servidor de TUCKET.');
    offline.offline = true;
    throw offline;
  }

  if(response.status === 204) return null;
  var payload = await response.json().catch(function(){ return {}; });
  if(!response.ok){
    var error = new Error(payload.error || 'No se pudo completar la solicitud.');
    error.status = response.status;
    /* 404 y 5xx significan que la API no está servida o está caída, no que las
       credenciales sean incorrectas. 400, 401 y 403 sí son respuestas reales. */
    error.offline = response.status === 404 || response.status >= 500;
    throw error;
  }
  return payload;
}

/* ¿El fallo viene de que no hay backend, y no de un rechazo del servidor? */
function apiNoDisponible(error){
  return !!(error && error.offline);
}

/* Caso distinto y muy común mientras se desarrolla: el servidor responde,
   pero esa ruta no existe en la versión que está corriendo. Pasa al copiar
   archivos nuevos sin reiniciar el backend. Decir «no se pudo contactar con
   el servidor» ahí manda a buscar el problema donde no está. */
function rutaNoMontada(error){
  return !!(error && error.status === 404);
}
