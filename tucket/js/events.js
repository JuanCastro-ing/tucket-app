/* TUCKET — Vista Explorar eventos (buscador) */

function filterEvents(query){
  query = query.trim().toLowerCase();
  var cards = document.querySelectorAll('#view-events .ev-card');
  cards.forEach(function(card){
    var match = card.textContent.toLowerCase().indexOf(query) !== -1;
    card.style.display = match ? '' : 'none';
  });
}
