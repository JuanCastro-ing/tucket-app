/* TUCKET — Vista Detalle de evento (cantidad y total) */

var eventQty = 2;
var eventUnitPrice = 85000;
function changeQty(delta){
  eventQty = Math.max(1, eventQty + delta);
  var qtyEl = document.getElementById('qty-val');
  var totalEl = document.getElementById('total-val');
  if(qtyEl){ qtyEl.textContent = eventQty; }
  if(totalEl){ totalEl.textContent = '$' + (eventQty * eventUnitPrice).toLocaleString('es-CO'); }
  return false;
}
