/* TUCKET — Vista Detalle de evento (cantidad y total) */

var eventQty = 2;
var eventUnitPrice = 85000;
function setEventPrice(price){
  eventUnitPrice = Number(price) || 0;
  var priceEl=document.getElementById('detail-price');
  if(priceEl)priceEl.textContent=new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(eventUnitPrice);
  eventQty=1;
  changeQty(0);
}
function changeQty(delta){
  eventQty = Math.max(1, eventQty + delta);
  var qtyEl = document.getElementById('qty-val');
  var totalEl = document.getElementById('total-val');
  if(qtyEl){ qtyEl.textContent = eventQty; }
  if(totalEl){ totalEl.textContent = new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(eventQty * eventUnitPrice); }
  return false;
}
