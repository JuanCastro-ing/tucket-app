/* TUCKET — Navegación entre vistas */

/* El enlace "Saltar al contenido" apunta al <main> de la vista visible.
   Antes solo existía #main-content en la vista de inicio, así que en las
   demás vistas el enlace saltaba a contenido oculto. */
function syncSkipLink(view){
  var link = document.querySelector('.skip-link');
  if(!link){ return; }
  var main = view ? view.querySelector('main') : null;
  if(!main){ link.hidden = true; return; }
  if(!main.id){ main.id = view.id + '-main'; }
  main.setAttribute('tabindex', '-1');
  link.setAttribute('href', '#' + main.id);
  link.hidden = false;
}

/* Historial de vistas
   No se usa el historial del navegador porque las vistas no cambian la
   URL: todas viven en la misma página. Se lleva una pila propia con las
   vistas por las que se ha pasado.
   Se guarda un tope de 20: suficiente para deshacer un recorrido y sin
   crecer sin control en una sesión larga. */
var historialVistas = [];
var navegandoAtras = false;

function vistaActual(){
  var activa = document.querySelector('.view.active');
  return activa ? activa.id.replace(/^view-/, '') : null;
}

/* Vuelve a la vista anterior. Si no hay ninguna —se entró directo a esta—
   lleva al inicio, para que el botón nunca quede sin hacer nada. */
function navAtras(){
  var anterior = historialVistas.pop();
  if(!anterior){ return nav('home'); }
  navegandoAtras = true;
  var resultado = nav(anterior);
  navegandoAtras = false;
  return resultado;
}

/* El botón se inyecta desde aquí y no se escribe en cada vista: así vive
   en un solo lugar y no hay nueve copias que se desincronicen.

   Se coloca junto al «Volver al inicio» que ya existe, y en las vistas con
   barra superior, dentro del bloque de usuario. El de inicio se conserva:
   son dos destinos distintos. */
function montarBotonesVolver(){
  document.querySelectorAll('.view').forEach(function(vista){
    if(vista.id === 'view-home') return;            // el inicio es el principio
    if(vista.querySelector('.btn-volver')) return;  // ya montado

    var anclas = vista.querySelectorAll('.back-home');
    if(anclas.length){
      anclas.forEach(function(ancla){
        ancla.parentNode.insertBefore(botonVolver(ancla.classList.contains('back-home-light')), ancla);
      });
      return;
    }
    var usuario = vista.querySelector('.marquee-inner .nav-user');
    if(usuario){ usuario.insertBefore(botonVolver(true), usuario.firstChild); }
  });
}

function botonVolver(claro){
  var boton = document.createElement('a');
  boton.href = '#';
  boton.className = 'btn-volver' + (claro ? ' btn-volver-light' : '');
  boton.setAttribute('aria-label', 'Volver a la vista anterior');
  boton.innerHTML = '<span aria-hidden="true">←</span> Volver';
  boton.addEventListener('click', function(e){ e.preventDefault(); navAtras(); });
  return boton;
}

function nav(viewId){
  /* Puerta única de acceso: cualquier enlace, menú o llamada directa pasa por
     aquí, así que el permiso se comprueba en este punto y no en cada enlace. */
  if(typeof canAccess === 'function' && !canAccess(viewId)){
    return denyAccess(viewId);
  }

  /* Se apila la vista que se deja atrás. Volver no apila (si no, el botón
     haría ir y venir entre dos vistas), y repetir la misma vista tampoco. */
  var actual = vistaActual();
  if(!navegandoAtras && actual && actual !== viewId){
    historialVistas.push(actual);
    if(historialVistas.length > 20) historialVistas.shift();
  }

  /* Al salir del login la contraseña vuelve a ocultarse. */
  if(actual === 'login' && typeof reiniciarContrasena === 'function') reiniciarContrasena();

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  var target = document.getElementById('view-' + viewId);
  if(target){ target.classList.add('active'); }
  syncSkipLink(target);
  /* Las vistas se cargan la primera vez que se entra en ellas, o sea
     después del inicio de sesión, y llegan con la pastilla del rol
     escrita a mano en su HTML. Se repinta al mostrarlas para que diga
     la de la cuenta que está dentro. */
  if(typeof pintarPastillasDeRol === 'function') pintarPastillasDeRol();
  if(viewId === 'agent-events' && typeof initAgentEvents === 'function') initAgentEvents();
  if(viewId === 'events' && typeof initExploreEvents === 'function') initExploreEvents();
  if(viewId === 'profile' && typeof initProfile === 'function') initProfile();
  if(viewId === 'profile' && typeof initProfilePassword === 'function') initProfilePassword();
  if(viewId === 'reservations' && typeof initReservations === 'function') initReservations();
  if(viewId === 'agent-request' && typeof initAgentRequest === 'function') initAgentRequest();
  if(viewId === 'admin-dashboard' && typeof initAdminDashboard === 'function') initAdminDashboard();
  if(viewId === 'agent-reservations' && typeof initAgentReservations === 'function') initAgentReservations();
  window.scrollTo({top:0, behavior:'auto'});
  return false;
}

/* Cerrar sesión limpia el historial: volver atrás no debe llevar a la vista
   privada de la cuenta que acaba de salir. */
function olvidarHistorialDeVistas(){
  historialVistas = [];
}

/* Enlaces del pie que todavía no tienen contenido
   Eran href="#" sin más: al pulsarlos no pasaba nada y parecía que la
   página estaba rota. Ahora dicen lo que son. Se resuelve en un solo
   sitio porque son once por vista y siete vistas.
   El texto del enlace entra en el aviso para que quede claro cuál se
   pulsó, que con once juntos no es obvio. */
/* Abre el centro de ayuda en una sección concreta.

   Los enlaces del pie de página —«Cómo reservar», «Preguntas frecuentes»,
   «Política de privacidad»…— apuntan todos a la misma vista y se
   diferencian por el trozo al que saltan. Antes solo avisaban de que la
   sección no existía todavía.

   El salto se hace después de que nav() muestre la vista: mientras está
   oculta no tiene altura y el navegador no puede desplazarse hasta ella. */
function irAAyuda(seccion){
  nav('ayuda');
  var destino = document.getElementById(seccion || 'ayuda-titulo');
  if(!destino) return false;
  /* requestAnimationFrame espera al primer pintado con la vista ya visible. */
  requestAnimationFrame(function(){
    destino.scrollIntoView({ behavior:'smooth', block:'start' });
    /* Para quien navega con teclado o lector de pantalla: además de mover
       la página, se lleva el foco al título de la sección. */
    if(!destino.hasAttribute('tabindex')) destino.setAttribute('tabindex', '-1');
    destino.focus({ preventScroll:true });
  });
  return false;
}
