/* TUCKET — Estado de sesión (isLoggedIn, pendingView, requireAuth, logout) */

var isLoggedIn = false;
var pendingView = null;
function setAuthState(state){
  isLoggedIn = state;
  document.documentElement.setAttribute('data-auth', state ? 'in' : 'out');
}

/* Cualquier vista que requiera cuenta (reservar, panel de agente, panel admin)
   pasa por aquí primero. Si no hay sesión, manda a login y recuerda a dónde iba. */
function requireAuth(viewId){
  if(isLoggedIn){ return nav(viewId); }
  pendingView = viewId;
  return nav('login');
}

function logout(){
  setAuthState(false);
  pendingView = null;
  return nav('home');
}
