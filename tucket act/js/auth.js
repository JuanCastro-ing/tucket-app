/* TUCKET — Estado de sesión y permisos por rol
   (isLoggedIn, currentRole, requireAuth, control de acceso a vistas, logout) */

var isLoggedIn = false;
var currentRole = null;
var pendingView = null;

function setAuthState(state, role){
  isLoggedIn = state;
  currentRole = state ? (role || currentRole || null) : null;
  document.documentElement.setAttribute('data-auth', state ? 'in' : 'out');
  if(currentRole) document.documentElement.setAttribute('data-role', currentRole);
  else document.documentElement.removeAttribute('data-role');
}

/* ------------------------------------------------------------------
   HU — Cada rol solo entra a sus vistas.
   Una vista sin entrada en el mapa es pública. El control vive aquí y lo
   consulta nav(), de modo que ningún enlace, menú ni llamada directa pueda
   saltárselo desde la interfaz.

   Aviso importante: esto protege la INTERFAZ, no los datos. La barrera real
   son los endpoints del backend (requireAgent + cookie de sesión firmada).
   Cuando exista el rol de administrador en la base de datos, su panel deberá
   protegerse igual en el servidor.
------------------------------------------------------------------ */
var VIEW_ROLES = {
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

async function restoreAgentSession(){
  if(typeof tucketApi !== 'function') return;
  try{
    await tucketApi('/api/auth/me');
    setAuthState(true, 'agente');
    document.querySelectorAll('.nav-user .role-pill').forEach(function(item){ item.textContent = 'AGENTE'; });
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
  return nav('home');
}
