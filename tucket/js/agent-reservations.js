/* TUCKET — Vista Reservas del agente (cambiar estado) */

function setSelectValue(id, value){
  var sel = document.getElementById(id);
  if(!sel) return;
  for(var i = 0; i < sel.options.length; i++){
    if(sel.options[i].text === value){ sel.selectedIndex = i; break; }
  }
}
