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

  guardarCliente();
  return false;
}

/* Crea la cuenta en PostgreSQL. Si el backend no está disponible se sigue
   permitiendo recorrer la aplicación en modo prototipo, igual que el resto
   de las vistas. */
async function guardarCliente(){
  var boton = document.querySelector('#view-register button[type="submit"]');
  var textoOriginal = boton ? boton.textContent : '';
  if(boton){ boton.disabled = true; boton.textContent = 'Creando cuenta…'; }

  var valor = function(id){
    var campo = document.getElementById(id);
    return campo ? campo.value.trim() : '';
  };
  var payload = {
    documentNumber: valor('doc'),
    fullName: valor('name'),
    email: valor('mail').toLowerCase(),
    password: document.getElementById('pw') ? document.getElementById('pw').value : '',
    phone: valor('phone1'),
    address: valor('addr'),
    acceptedTerms: true
  };

  try{
    await tucketApi('/api/clients/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    entrarComoCliente();
  }catch(error){
    if(apiNoDisponible(error)){
      /* Sin servidor: se entra en modo prototipo y se avisa. */
      entrarComoCliente();
      return;
    }
    mostrarErrorRegistro(error.message);
  }finally{
    if(boton){ boton.disabled = false; boton.textContent = textoOriginal; }
  }
}

function entrarComoCliente(){
  setAuthState(true, 'cliente');
  selectedRole = 'cliente';
  var target = pendingView || 'events';
  pendingView = null;
  nav(target);
}

/* El error del servidor (correo repetido, documento ya registrado…) se
   muestra junto al campo que lo causó, no en una alerta suelta. */
function mostrarErrorRegistro(mensaje){
  var texto = mensaje || 'No se pudo crear la cuenta. Intenta de nuevo.';
  var destino = 'mail';
  if(/documento/i.test(texto)) destino = 'doc';
  else if(/contraseña/i.test(texto)) destino = 'pw';
  else if(/teléfono|telefono/i.test(texto)) destino = 'phone1';

  if(typeof showFieldError === 'function'){
    showFieldError(document.getElementById(destino), texto);
  }else{
    var campo = document.getElementById(destino);
    if(campo && campo.focus) campo.focus();
  }
}
