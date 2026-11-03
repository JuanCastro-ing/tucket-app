/* TUCKET — Perfil: cambiar la contraseña
   (necesita api.js, login.js para alternarContrasena, y navigation.js)

   En archivo aparte de profile.js a propósito: son dos formularios con dos
   rutas distintas, y así se puede revisar uno sin leer el otro.

   Se pide la contraseña actual aunque la sesión esté abierta. Tener sesión
   prueba que alguien entró con esa cuenta, no que siga siendo su dueño: un
   equipo prestado bastaría para cambiarle la clave a otro y dejarlo fuera.
   El servidor la vuelve a comprobar; esto es solo el formulario. */

function pwdMensaje(texto, tipo){
  var caja = document.getElementById('pwd-message');
  if(!caja) return;
  if(!texto){ caja.hidden = true; caja.textContent = ''; return; }
  caja.textContent = texto;
  caja.className = 'form-message form-message-' + (tipo === 'error' ? 'error' : 'success');
  caja.hidden = false;
}

/* Al entrar al perfil los campos arrancan vacíos y ocultos: una contraseña
   escrita y visible no debe sobrevivir a un cambio de vista. */
function initProfilePassword(){
  var form = document.getElementById('pwd-form');
  if(form) form.reset();
  ['pwd-actual', 'pwd-nueva', 'pwd-repetir'].forEach(function(id){
    var campo = document.getElementById(id);
    if(campo) campo.type = 'password';
  });
  document.querySelectorAll('#pwd-form .pw-toggle').forEach(function(boton){
    boton.setAttribute('aria-pressed', 'false');
    boton.setAttribute('aria-label', 'Mostrar la contraseña');
    boton.title = 'Mostrar la contraseña';
  });
  pwdMensaje('');
}

async function cambiarContrasenaPerfil(event){
  if(event) event.preventDefault();
  pwdMensaje('');

  var actual = document.getElementById('pwd-actual');
  var nueva = document.getElementById('pwd-nueva');
  var repetir = document.getElementById('pwd-repetir');

  var ok = validarCampos([
    { id:'pwd-actual', test:noVacio, mensaje:'Escribe tu contraseña actual.' },
    { id:'pwd-nueva',  test:function(i){ return i.value.length >= 8; },
      mensaje:'La nueva contraseña debe tener al menos 8 caracteres.' },
    { id:'pwd-repetir', test:function(i){ return i.value === nueva.value && i.value !== ''; },
      mensaje:'Las dos contraseñas no coinciden.' }
  ]);
  if(!ok) return false;

  /* Se avisa aquí para no gastar una petición en algo que el servidor
     también rechazaría. */
  if(nueva.value === actual.value){
    showFieldError(nueva, 'La nueva contraseña debe ser distinta de la actual.');
    nueva.focus();
    return false;
  }

  var boton = document.getElementById('pwd-submit');
  if(boton){ boton.disabled = true; boton.textContent = 'Cambiando…'; }

  try{
    var r = await tucketApi('/api/profile/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword: actual.value, newPassword: nueva.value })
    });
    initProfilePassword();      // limpia los tres campos
    pwdMensaje(r.message, 'success');
  }catch(error){
    if(apiNoDisponible(error)){
      pwdMensaje('No pudimos contactar con el servidor. Intenta de nuevo en un momento.', 'error');
    }else if(/actual no es correcta/i.test(error.message)){
      /* El error es de un campo concreto, así que se muestra junto a él. */
      showFieldError(actual, error.message);
      actual.focus();
    }else{
      pwdMensaje(error.message, 'error');
    }
  }finally{
    if(boton){ boton.disabled = false; boton.textContent = 'Cambiar contraseña'; }
  }
  return false;
}
