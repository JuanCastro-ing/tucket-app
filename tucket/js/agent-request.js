/* TUCKET — Vista Solicitud de cuenta de agente
   (necesita api.js, validation.js y navigation.js)

   Formulario público: cualquiera puede pedir una cuenta de agente, pero
   nadie se la otorga a sí mismo. La solicitud queda Pendiente y un
   administrador la resuelve desde su panel. */

function solMensaje(texto, tipo){
  var caja = document.getElementById('sol-message');
  if(!caja) return;
  if(!texto){ caja.hidden = true; caja.textContent = ''; return; }
  caja.textContent = texto;
  caja.className = 'form-message form-message-' + (tipo === 'error' ? 'error' : 'success');
  caja.hidden = false;
}

/* Contador de caracteres de la justificación: el mínimo de 30 sorprende si
   no se ve venir. */
function solContarJustificacion(){
  var campo = document.getElementById('sol-just');
  var cuenta = document.getElementById('sol-just-count');
  if(campo && cuenta) cuenta.textContent = campo.value.trim().length;
}

/* La confirmación y los datos escritos son de UN envío concreto, no de la
   vista. Como las nueve vistas conviven en el DOM, si no se limpian aquí
   quedan pegadas: quien entrara después — otra cuenta, o nadie — vería la
   solicitud de la persona anterior. Por eso cada entrada arranca en blanco. */
function initAgentRequest(){
  var campo = document.getElementById('sol-just');
  if(campo && campo.dataset.ready !== 'true'){
    campo.dataset.ready = 'true';
    campo.addEventListener('input', solContarJustificacion);
  }

  var formulario = document.getElementById('sol-form');
  var confirmacion = document.getElementById('sol-ok');
  if(formulario){
    formulario.hidden = false;
    formulario.reset();
    /* reset() no borra los avisos de validación que se colgaron de cada
       campo, así que se quitan a mano. */
    formulario.querySelectorAll('.field-error').forEach(function(aviso){ aviso.remove(); });
    formulario.querySelectorAll('.input-invalid').forEach(function(input){
      input.classList.remove('input-invalid');
      input.removeAttribute('aria-invalid');
    });
  }
  if(confirmacion) confirmacion.hidden = true;

  solMensaje('');
  solContarJustificacion();
}

async function enviarSolicitudAgente(event){
  if(event) event.preventDefault();
  solMensaje('');

  /* Las mismas reglas que valida el servidor, para que el error aparezca
     junto al campo y no haya que esperar la respuesta. El servidor las
     vuelve a comprobar: esto es comodidad, no seguridad. */
  var ok = validarCampos([
    { id:'sol-doc',    test:noVacio, mensaje:'Ingresa tu número de identificación.' },
    { id:'sol-nombre', test:noVacio, mensaje:'Ingresa tu nombre completo.' },
    { id:'sol-correo', test:function(i){ return esCorreo(i.value); },
      mensaje:'Escribe un correo válido, por ejemplo nombre@correo.com.' },
    { id:'sol-tel',    test:function(i){ return i.value.replace(/\D/g,'').length >= 7; },
      mensaje:'Ingresa un teléfono de al menos 7 dígitos.' },
    { id:'sol-org',    test:noVacio, mensaje:'Escribe el teatro, productora o empresa que representas.' },
    { id:'sol-just',   test:function(i){ return i.value.trim().length >= 30; },
      mensaje:'Cuéntanos un poco más: la justificación necesita al menos 30 caracteres.' }
  ]);
  if(!ok) return false;

  var boton = document.getElementById('sol-submit');
  if(boton){ boton.disabled = true; boton.textContent = 'Enviando…'; }

  var datos = {
    fullName:       document.getElementById('sol-nombre').value.trim(),
    documentNumber: document.getElementById('sol-doc').value.trim(),
    email:          document.getElementById('sol-correo').value.trim(),
    phone:          document.getElementById('sol-tel').value.trim(),
    organization:   document.getElementById('sol-org').value.trim(),
    nit:            document.getElementById('sol-nit').value.trim(),
    justification:  document.getElementById('sol-just').value.trim()
  };

  try{
    await tucketApi('/api/agent-requests', { method:'POST', body: JSON.stringify(datos) });

    /* Se reemplaza el formulario por la confirmación: dejarlo lleno invita a
       mandar la misma solicitud otra vez, y el servidor ya no la aceptaría. */
    document.getElementById('sol-ok-nombre').textContent = datos.fullName;
    document.getElementById('sol-ok-correo').textContent = datos.email;
    document.getElementById('sol-form').hidden = true;
    document.getElementById('sol-ok').hidden = false;
    window.scrollTo({ top:0, behavior:'smooth' });
  }catch(error){
    solMensaje(
      apiNoDisponible(error)
        ? 'No pudimos contactar con el servidor. Intenta de nuevo en un momento.'
        : error.message,
      'error'
    );
  }finally{
    if(boton){ boton.disabled = false; boton.textContent = 'Enviar solicitud'; }
  }
  return false;
}
