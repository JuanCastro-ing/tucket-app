/* TUCKET — Vista Registro (necesita auth.js, login.js y navigation.js) */

var selectedRegType = 'cliente';
function setRegType(el){
  var wrap = el.closest('.type-switch');
  wrap.querySelectorAll('.type-card').forEach(function(c){ c.classList.remove('active'); });
  el.classList.add('active');
  var label = el.querySelector('.t');
  selectedRegType = (label && label.textContent.trim() === 'Agente') ? 'agente' : 'cliente';
}
function goRegisterAs(role){
  var cards = document.querySelectorAll('#view-register .type-card');
  if(cards.length){ setRegType(cards[role === 'agente' ? 1 : 0]); }
  return nav('register');
}
function completeRegistration(){
  setAuthState(true);
  selectedRole = selectedRegType;
  var map = { cliente: 'events', agente: 'agent-events' };
  var target = pendingView || map[selectedRegType] || 'events';
  pendingView = null;
  return nav(target);
}
