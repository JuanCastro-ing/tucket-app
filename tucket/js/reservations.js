/* TUCKET — Vista Mis reservas (cancelar reserva) */

function cancelReserva(link){
  var ticketMain = link.closest('.ticket-main');
  if(!ticketMain) return false;
  var badge = ticketMain.querySelector('.badge');
  if(badge){
    badge.className = 'badge badge-cancelado';
    badge.textContent = 'Cancelada';
  }
  var ticket = ticketMain.closest('.ticket');
  if(ticket){ ticket.style.opacity = '.6'; }
  link.remove();
  return false;
}
