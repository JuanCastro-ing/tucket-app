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
  if(selectedRole === 'agente'){
    try{
      await tucketApi('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('email').value.trim(),
          password: document.getElementById('pass').value
        })
      });
      tucketDemoMode = false;
      setAuthState(true, 'agente');
      pendingView = null;
      return nav('agent-events');
    }catch(error){
      if(!apiNoDisponible(error)){
        /* El servidor respondió y rechazó las credenciales */
        if(message){ message.textContent = error.message; message.hidden = false; }
        return false;
      }
      tucketDemoMode = true;
      if(typeof showAccessNotice === 'function'){
        showAccessNotice('Backend no disponible: entraste al panel de agente en modo prototipo, con datos de muestra.');
      }
      setAuthState(true, 'agente');
      pendingView = null;
      return nav('agent-events');
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
