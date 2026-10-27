/* TUCKET — Vista Inicio de sesión (necesita auth.js, api.js, validation.js y navigation.js) */

var selectedRole = 'cliente';
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

  /* El agente se autentica contra la API cuando el backend está levantado.
     Si no hay backend (todavía no se monta PostgreSQL), entra en modo prototipo
     igual que cliente y administrador. Una contraseña rechazada por el servidor
     SÍ bloquea el acceso: el respaldo solo cubre la ausencia de API. */
  if(selectedRole === 'agente' || selectedRole === 'cliente'){
    var inicioPorRol = { agente: 'agent-events', cliente: 'events' };
    try{
      var sesion = await tucketApi('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('email').value.trim(),
          password: document.getElementById('pass').value
        })
      });
      /* Manda el rol que dice el servidor, no la pestaña que eligió la
         persona: la cuenta es de agente o de cliente, no las dos. */
      var rol = (sesion && sesion.role) === 'cliente' ? 'cliente' : 'agente';
      tucketDemoMode = false;
      setAuthState(true, rol);
      selectedRole = rol;
      var destino = pendingView || inicioPorRol[rol];
      pendingView = null;
      return nav(destino);
    }catch(error){
      if(!apiNoDisponible(error)){
        /* El servidor respondió y rechazó las credenciales */
        if(message){ message.textContent = error.message; message.hidden = false; }
        return false;
      }
      tucketDemoMode = true;
      if(typeof showAccessNotice === 'function'){
        showAccessNotice(selectedRole === 'cliente'
          ? 'Backend no disponible: entraste como cliente en modo prototipo, con datos de muestra.'
          : 'Backend no disponible: entraste al panel de agente en modo prototipo, con datos de muestra.');
      }
      setAuthState(true, selectedRole);
      var respaldo = pendingView || inicioPorRol[selectedRole];
      pendingView = null;
      return nav(respaldo);
    }
  }
  setAuthState(true, selectedRole);
  var map = { cliente: 'events', agente: 'agent-events', administrador: 'admin-dashboard' };
  var target = pendingView || map[selectedRole] || 'events';
  pendingView = null;
  return nav(target);
}

function submitLogin(event){
  if(event) event.preventDefault();
  ingresar();
  return false;
}
