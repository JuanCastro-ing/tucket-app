/* TUCKET — Navegación entre vistas */

function nav(viewId){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  var target = document.getElementById('view-' + viewId);
  if(target){ target.classList.add('active'); }
  window.scrollTo({top:0, behavior:'auto'});
  return false;
}
