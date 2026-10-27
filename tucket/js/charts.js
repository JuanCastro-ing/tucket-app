/* TUCKET — Tooltip compartido por las gráficas del panel administrativo.
   Cualquier marca con data-tip lo muestra al pasar el cursor o al enfocarla. */

(function tooltipGraficas(){
  var tip = null;

  function caja(){
    if(!tip){
      tip = document.createElement('div');
      tip.className = 'chart-tip';
      tip.setAttribute('role', 'status');
      document.body.appendChild(tip);
    }
    return tip;
  }

  function mostrar(marca){
    var texto = marca.getAttribute('data-tip');
    if(!texto) return;
    var t = caja();
    t.textContent = texto;
    var r = marca.getBoundingClientRect();
    t.style.left = (r.left + r.width / 2) + 'px';
    t.style.top  = r.top + 'px';
    t.classList.add('visible');
  }

  function ocultar(){
    if(tip){ tip.classList.remove('visible'); }
  }

  document.addEventListener('mouseover', function(e){
    var marca = e.target.closest ? e.target.closest('[data-tip]') : null;
    if(marca){ mostrar(marca); }
  });
  document.addEventListener('mouseout', function(e){
    if(e.target.closest && e.target.closest('[data-tip]')){ ocultar(); }
  });
  document.addEventListener('focusin', function(e){
    var marca = e.target.closest ? e.target.closest('[data-tip]') : null;
    if(marca){ mostrar(marca); }
  });
  document.addEventListener('focusout', ocultar);
  window.addEventListener('scroll', ocultar, { passive:true });
})();
