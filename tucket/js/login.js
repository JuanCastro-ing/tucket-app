/* TUCKET — Vista Inicio de sesión (necesita auth.js y navigation.js) */

var selectedRole = 'cliente';
function setRole(btn, role){
  var wrap = btn.closest('.role-switch');
  wrap.querySelectorAll('button').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  selectedRole = role;
}
function ingresar(){
  setAuthState(true);
  var map = { cliente: 'events', agente: 'agent-events', administrador: 'admin-dashboard' };
  var target = pendingView || map[selectedRole] || 'events';
  pendingView = null;
  return nav(target);
}
