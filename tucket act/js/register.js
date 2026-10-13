/* TUCKET — Vista Registro (necesita auth.js, login.js, validation.js y navigation.js) */

var selectedRegType = 'cliente';
function setRegType(el){
  var wrap = el.closest('.type-switch');
  wrap.querySelectorAll('.type-card').forEach(function(c){
    c.classList.remove('active');
    c.setAttribute('aria-checked', 'false');
  });
  el.classList.add('active');
  el.setAttribute('aria-checked', 'true');
  var label = el.querySelector('.t');
  selectedRegType = (label && label.textContent.trim() === 'Agente') ? 'agente' : 'cliente';
}
function goRegisterAs(role){
  var cards = document.querySelectorAll('#view-register .type-card');
  if(cards.length){ setRegType(cards[role === 'agente' ? 1 : 0]); }
  return nav('register');
}
function completeRegistration(event){
  if(event){ event.preventDefault(); }

  /* Validación propia: el mensaje se muestra junto al campo, nunca en una burbuja del navegador */
  var pw = document.getElementById('pw');
  var ok = validarCampos([
    { id:'doc',   test:noVacio, mensaje:'Ingresa tu número de identificación.' },
    { id:'name',  test:noVacio, mensaje:'Ingresa tu nombre completo.' },
    { id:'mail',  test:function(i){ return esCorreo(i.value); },
      mensaje:'Escribe un correo válido, por ejemplo nombre@correo.com.' },
    { id:'addr',  test:noVacio, mensaje:'Ingresa tu dirección.' },
    { id:'phone1',test:function(i){ return i.value.replace(/\D/g,'').length >= 7; },
      mensaje:'Ingresa un número de teléfono de al menos 7 dígitos.' },
    { id:'pw',    test:function(i){ return i.value.length >= 8; },
      mensaje:'La contraseña debe tener mínimo 8 caracteres.' },
    { id:'pw2',   test:function(i){ return pw && i.value === pw.value && i.value !== ''; },
      mensaje:'Las dos contraseñas no coinciden.' },
    { id:'terms', test:function(i){ return i.checked; },
      mensaje:'Debes aceptar los términos para continuar.' }
  ]);
  if(!ok){ return false; }

  /* Las cuentas de agente no se crean desde el formulario: viven en la base de datos */
  if(selectedRegType === 'agente'){
    selectedRole = 'agente';
    nav('login');
    var loginMessage = document.getElementById('login-message');
    if(loginMessage){
      loginMessage.textContent = 'Las cuentas de agente se crean en la base de datos. Ejecuta INICIAR PAGINA.bat para crear la primera cuenta y luego inicia sesión aquí.';
      loginMessage.hidden = false;
    }
    return false;
  }

  setAuthState(true, 'cliente');
  selectedRole = selectedRegType;
  var map = { cliente: 'events', agente: 'agent-events' };
  var target = pendingView || map[selectedRegType] || 'events';
  pendingView = null;
  return nav(target);
}
