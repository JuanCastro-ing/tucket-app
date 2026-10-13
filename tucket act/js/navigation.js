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

function nav(viewId){
  /* Puerta única de acceso: cualquier enlace, menú o llamada directa pasa por
     aquí, así que el permiso se comprueba en este punto y no en cada enlace. */
  if(typeof canAccess === 'function' && !canAccess(viewId)){
    return denyAccess(viewId);
  }
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  var target = document.getElementById('view-' + viewId);
  if(target){ target.classList.add('active'); }
  syncSkipLink(target);
  if(viewId === 'agent-events' && typeof initAgentEvents === 'function') initAgentEvents();
  if(viewId === 'events' && typeof initExploreEvents === 'function') initExploreEvents();
  window.scrollTo({top:0, behavior:'auto'});
  return false;
}
