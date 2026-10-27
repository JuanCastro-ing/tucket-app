/* TUCKET — Validación de formularios (compartida por Inicio de sesión y Registro).
   Muestra el error junto al campo; nunca usa window.alert(). */

/* El mensaje se cuelga del .field; si no hay (p. ej. la casilla de términos,
   que vive dentro de su propio <label>), se usa el contenedor directo. */
function contenedorDe(input){
  return input.closest('.field') || input.parentNode;
}

function clearFieldError(input){
  if(!input) return;
  input.classList.remove('input-invalid');
  input.removeAttribute('aria-invalid');
  var msg = contenedorDe(input).querySelector('.field-error');
  if(msg){ msg.remove(); }
}

function showFieldError(input, texto){
  if(!input) return;
  clearFieldError(input);
  input.classList.add('input-invalid');
  input.setAttribute('aria-invalid', 'true');
  var campo = contenedorDe(input);
  var msg = document.createElement('p');
  msg.className = 'field-error';
  msg.setAttribute('role', 'alert');
  msg.textContent = texto;
  /* Justo debajo del control, no al final del bloque: si el campo trae extras
     (como «+ Agregar otro número») el error quedaba descolgado. */
  var ancla = input.parentNode === campo ? input : input.parentNode;
  ancla.insertAdjacentElement('afterend', msg);
  /* El error desaparece en cuanto la persona corrige el campo */
  var evento = input.type === 'checkbox' ? 'change' : 'input';
  input.addEventListener(evento, function limpiar(){
    clearFieldError(input);
    input.removeEventListener(evento, limpiar);
  });
}

function esCorreo(valor){
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor.trim());
}

/* reglas = [{ id, test, mensaje }] — devuelve true si todo pasa.
   Enfoca el primer campo con problema para no dejar a nadie perdido. */
function validarCampos(reglas){
  var primero = null;
  reglas.forEach(function(regla){
    var input = document.getElementById(regla.id);
    if(!input) return;
    clearFieldError(input);
    if(!regla.test(input)){
      showFieldError(input, regla.mensaje);
      if(!primero){ primero = input; }
    }
  });
  if(primero){ primero.focus(); return false; }
  return true;
}

var noVacio = function(i){ return i.value.trim() !== ''; };
