/* TUCKET — Vista Inicio de sesión (necesita auth.js, api.js, validation.js y navigation.js) */

var selectedRole = 'cliente';

/* Mostrar u ocultar la contraseña.

   El icono lo decide el CSS a partir de aria-pressed, así que aquí solo se
   cambia el estado: ojo cuando está oculta, ojo tachado cuando se ve. El
   botón no lleva texto, por eso aria-label y title cargan el significado
   para lectores de pantalla y para quien pase el cursor por encima.

   Se conserva la posición del cursor porque cambiar el type la manda al
   final del texto. */
function alternarContrasena(idCampo, boton){
  var campo = document.getElementById(idCampo);
  if(!campo) return false;

  var oculta = campo.type === 'password';
  var cursor = campo.selectionStart;
  campo.type = oculta ? 'text' : 'password';
  try{ campo.setSelectionRange(cursor, cursor); }catch(_e){}

  if(boton){
    boton.setAttribute('aria-pressed', oculta ? 'true' : 'false');
    var etiqueta = oculta ? 'Ocultar la contraseña' : 'Mostrar la contraseña';
    boton.setAttribute('aria-label', etiqueta);
    boton.title = etiqueta;
  }
  campo.focus();
  return false;
}

/* Al salir del login la contraseña vuelve a ocultarse: dejarla visible
   sería una sorpresa desagradable para quien vuelva a entrar. */
function reiniciarContrasena(){
  var campo = document.getElementById('pass');
  var boton = document.getElementById('pass-toggle');
  if(campo) campo.type = 'password';
  if(boton){
    boton.setAttribute('aria-pressed', 'false');
    boton.setAttribute('aria-label', 'Mostrar la contraseña');
    boton.title = 'Mostrar la contraseña';
  }
}
function setRole(btn, role){
  var wrap = btn.closest('.role-switch');
  wrap.querySelectorAll('button').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  selectedRole = role;
}
async function ingresar(){
  var message = document.getElementById('login-message');
  if(message){ message.textContent = ''; message.hidden = true; }

  /* Primero la validación de forma, con el error junto al campo */
  var ok = validarCampos([
    { id:'email', test:function(i){ return esCorreo(i.value); },
      mensaje:'Escribe un correo válido, por ejemplo nombre@correo.com.' },
    { id:'pass',  test:noVacio, mensaje:'Escribe tu contraseña.' }
  ]);
  if(!ok){ return false; }

  /* Los tres roles se autentican contra la API. Una contraseña rechazada por
     el servidor SÍ bloquea el acceso: el respaldo de abajo solo cubre que la
     API no esté levantada, nunca unas credenciales incorrectas. */
  var inicioPorRol = { agente:'agent-events', cliente:'events', administrador:'admin-dashboard' };
  try{
    var sesion = await tucketApi('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('email').value.trim(),
        password: document.getElementById('pass').value
      })
    });
    /* El rol siempre lo dice el servidor, nunca la pestaña. Pero la pestaña
       tampoco se ignora: si alguien eligió «Agente» y la cuenta resulta ser
       de administrador, entrar igual al panel de administración es una
       sorpresa, y en la práctica deja entrar al panel con más permisos a
       quien pidió otra cosa. Se rechaza y se cierra la sesión que el
       servidor acaba de abrir, para no dejar la cookie viva. */
    var rol = rolDeSesion(sesion);
    if(rol !== selectedRole){
      await tucketApi('/api/auth/logout', { method: 'POST' }).catch(function(){});
      setAuthState(false);
      if(message){
        message.textContent = 'Esa cuenta es de ' + (ROLE_LABEL[rol] || rol) +
          ', no de ' + (ROLE_LABEL[selectedRole] || selectedRole) +
          '. Elige el perfil correcto antes de entrar.';
        message.hidden = false;
      }
      return false;
    }

    tucketDemoMode = false;
    setAuthState(true, rol);
    var destino = pendingView || inicioPorRol[rol];
    pendingView = null;
    return nav(destino);
  }catch(error){
    if(!apiNoDisponible(error)){
      /* El servidor respondió y rechazó las credenciales */
      if(message){ message.textContent = error.message; message.hidden = false; }
      return false;
    }

    /* Ya no hay «modo prototipo»: la aplicación dejó de traer eventos
       escritos en el código, así que entrar sin servidor solo mostraría
       paneles vacíos y daría la falsa impresión de que la sesión está
       abierta. Si no hay backend, no hay sesión. */
    if(message){
      message.textContent = 'No pudimos contactar con el servidor de TUCKET. Enciende el backend e inténtalo de nuevo.';
      message.hidden = false;
    }
    return false;
  }
}

function submitLogin(event){
  if(event) event.preventDefault();
  ingresar();
  return false;
}

/* «¿Olvidaste tu contraseña?»
   Era un enlace muerto: prometía una recuperación que no existe. Mandar
   un correo de restablecimiento exige un servicio de envío y credenciales,
   y eso es una historia aparte.
   Mientras tanto dice la verdad y explica el camino que sí funciona hoy,
   que es distinto según el rol: un cliente se registra de nuevo con otro
   correo, y a un agente o a un administrador le recrean la cuenta desde
   la terminal. */
function explicarRecuperacion(){
  var message = document.getElementById('login-message');
  if(message){
    message.className = 'form-message form-message-success';
    message.textContent = 'Todavía no hay recuperación por correo. Si eres agente o administrador, '
      + 'pídele a quien administra el sistema que te vuelva a generar la cuenta desde la terminal. '
      + 'Si eres cliente, puedes crear una cuenta nueva desde «Regístrate».';
    message.hidden = false;
  }
  return false;
}
