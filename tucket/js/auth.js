/* TUCKET — Estado de sesión y permisos por rol
   (isLoggedIn, currentRole, requireAuth, control de acceso a vistas, logout) */

var isLoggedIn = false;
var currentRole = null;
var pendingView = null;

/* La pastilla del rol que se ve arriba, junto a «Mi perfil».

   Cada vista trae escrito en su HTML el rol que le corresponde, y eso
   bastaba mientras cada quien veía solo las suyas. El problema aparecía
   al cambiar de cuenta sin recargar: las vistas ya cargadas conservaban
   la pastilla de la sesión anterior, así que un cliente podía ver
   «AGENTE» encima si antes había entrado un agente en esa pestaña.

   Se repinta aquí, que es el único sitio por el que pasan el inicio de
   sesión, el cierre y la restauración al recargar. */
function pintarPastillasDeRol(){
  var etiqueta = (currentRole && ROLE_LABEL[currentRole])
    ? ROLE_LABEL[currentRole].toUpperCase()
    : 'CUENTA';
  document.querySelectorAll('.nav-user .role-pill').forEach(function(item){
    item.textContent = etiqueta;
  });
}

function setAuthState(state, role){
  isLoggedIn = state;
  currentRole = state ? (role || currentRole || null) : null;
  document.documentElement.setAttribute('data-auth', state ? 'in' : 'out');
  if(currentRole) document.documentElement.setAttribute('data-role', currentRole);
  else document.documentElement.removeAttribute('data-role');
  pintarPastillasDeRol();
}

/* ------------------------------------------------------------------
   HU — Cada rol solo entra a sus vistas.
   Una vista sin entrada en el mapa es pública. El control vive aquí y lo
   consulta nav(), de modo que ningún enlace, menú ni llamada directa pueda
   saltárselo desde la interfaz.

   Aviso importante: esto protege la INTERFAZ, no los datos. La barrera real
   son los endpoints del backend (requireAgent, requireClient y requireAdmin
   sobre la cookie de sesión firmada), que es donde se decide de verdad quién
   puede leer y escribir qué.
------------------------------------------------------------------ */
var VIEW_ROLES = {
  'profile':           ['cliente', 'agente', 'administrador'],
  'reservations':      ['cliente'],
  'agent-events':      ['agente'],
  'agent-reservations':['agente'],
  'admin-dashboard':   ['administrador']
};

function rolesFor(viewId){ return VIEW_ROLES[viewId] || null; }

function canAccess(viewId){
  var roles = rolesFor(viewId);
  if(!roles) return true;                       // vista pública
  return isLoggedIn && roles.indexOf(currentRole) !== -1;
}

function homeForRole(role){
  return ({ cliente:'events', agente:'agent-events', administrador:'admin-dashboard' })[role] || 'home';
}

var ROLE_LABEL = { cliente:'cliente', agente:'agente', administrador:'administrador' };

/* Se llama cuando alguien intenta entrar donde no le corresponde. Siempre
   redirige a una vista permitida, así que no puede realimentarse. */
function denyAccess(viewId){
  var roles = rolesFor(viewId) || [];
  if(!isLoggedIn){
    pendingView = viewId;
    showAccessNotice('Inicia sesión como ' + roles.map(function(r){ return ROLE_LABEL[r]; }).join(' o ') + ' para abrir esa sección.');
    return nav('login');
  }
  showAccessNotice('Tu cuenta de ' + (ROLE_LABEL[currentRole] || 'usuario') +
                   ' no tiene acceso a esa sección. Es exclusiva del rol ' +
                   roles.map(function(r){ return ROLE_LABEL[r]; }).join(' o ') + '.');
  return nav(homeForRole(currentRole));
}

var accessNoticeTimer = null;
function showAccessNotice(text){
  var box = document.getElementById('access-notice');
  if(!box){ return; }
  box.textContent = text;
  box.hidden = false;
  box.classList.add('is-visible');
  clearTimeout(accessNoticeTimer);
  accessNoticeTimer = setTimeout(function(){
    box.classList.remove('is-visible');
    setTimeout(function(){ box.hidden = true; }, 300);
  }, 5200);
}

/* El rol SIEMPRE sale de lo que responde el servidor, nunca de la pestaña
   que la persona eligió en el formulario de login. */
function rolDeSesion(sesion){
  var rol = sesion && sesion.role;
  return (rol === 'cliente' || rol === 'administrador') ? rol : 'agente';
}

/* Restaura la sesión guardada en la cookie al recargar la página.
   El rol lo decide el servidor: en la base hay agentes y clientes, así que
   no se puede asumir que quien tiene sesión es un agente. */
async function restoreAgentSession(){
  if(typeof tucketApi !== 'function') return;
  try{
    var sesion = await tucketApi('/api/auth/me');
    var rol = rolDeSesion(sesion);
    setAuthState(true, rol);   /* repinta las pastillas del rol */
  }catch(_error){
    setAuthState(false);
  }
}

/* Cualquier vista que requiera cuenta pasa por aquí primero. Si no hay sesión,
   manda a login y recuerda a dónde iba; si hay sesión pero el rol no encaja,
   lo resuelve denyAccess. */
function requireAuth(viewId){
  if(canAccess(viewId)){ return nav(viewId); }
  return denyAccess(viewId);
}

function logout(){
  if(typeof tucketApi === 'function') tucketApi('/api/auth/logout', { method: 'POST' }).catch(function(){});
  setAuthState(false);
  pendingView = null;
  /* Volver atrás después de salir no debe devolver a la vista privada de la
     cuenta que se acaba de cerrar. */
  if(typeof olvidarHistorialDeVistas === 'function') olvidarHistorialDeVistas();
  return nav('home');
}
