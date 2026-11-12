/* TUCKET — Catálogo público, filtros y estado calculado con hora real */
var publicEvents = [];
var selectedEventCity = '';
var publicEventsServerTime = Date.now();
var publicEventsReceivedAt = Date.now();
var publicEventsTimer = null;
var publicEventsLoading = false;
var publicEventsSinConexion = false;
/* El catálogo de muestra que vivía aquí se eliminó: la cartelera muestra
   únicamente los eventos guardados en la base de datos. Si la API no
   responde, la cartelera queda vacía y se dice por qué, en vez de enseñar
   espectáculos que no existen. */

function eventNow(){ return publicEventsServerTime + (Date.now() - publicEventsReceivedAt); }
function eventDate(value){ var date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
function eventMonthKey(date){var parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit'}).formatToParts(date);return parts.find(function(p){return p.type==='year';}).value+'-'+parts.find(function(p){return p.type==='month';}).value;}
function eventStatus(event){
  var start = eventDate(event.starts_at), end = eventDate(event.ends_at), now = eventNow();
  if(end && end.getTime() <= now) return 'Finalizado';
  if(start && start.getTime() <= now) return 'En Vivo';
  return event.status || 'Programado';
}
function eventMoney(value){ return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(value)||0); }
function eventDateText(value, options){ var date = eventDate(value); return date ? new Intl.DateTimeFormat('es-CO',Object.assign({timeZone:'America/Bogota'},options)).format(date) : 'Fecha por confirmar'; }

/* Construye la tarjeta de un evento, con forma de boleto: marquesina con el
   afiche, estado y código arriba, datos en el medio y el talón con el precio.
   La usan la cartelera y los destacados de la portada, para que una tarjeta
   se vea y se comporte igual en los dos sitios. */
function tarjetaDeEvento(event){
  var status = eventStatus(event);
  var card = document.createElement('article');
  card.className = 'ev-card';

  /* Cabecera del boleto: estado + código, sobre la marquesina troquelada */
  var head = document.createElement('div'); head.className = 'ev-head';

  /* Afiche del evento: viene de la base (image_path). Si el evento no
     tiene imagen, la marquesina queda como antes, en azul. */
  if(event.image_path){
    var poster = document.createElement('img');
    poster.className = 'ev-poster';
    poster.src = event.image_path;
    poster.alt = event.image_alt || ('Afiche del evento ' + event.name);
    poster.loading = 'lazy';
    poster.decoding = 'async';
    /* Si el archivo no está, se quita la imagen y vuelve la marquesina. */
    poster.addEventListener('error', function(){
      head.classList.remove('has-poster');
      poster.remove();
    });
    head.classList.add('has-poster');
    head.append(poster);
  }

  var badge = document.createElement('span');
  badge.className = claseDeEstado('eventos', status);
  badge.textContent = status;
  var serial = document.createElement('span');
  serial.className = 'ev-serial'; serial.textContent = event.code || '';
  head.append(badge, serial);

  var body = document.createElement('div'); body.className = 'ev-body';
  var title = document.createElement('h3'); title.textContent = event.name;
  var location = document.createElement('p'); location.className = 'ev-loc';
  location.textContent = [event.venue, event.city, event.department].filter(Boolean).join(' · ');
  var date = document.createElement('p'); date.className = 'ev-date';
  date.textContent = eventDateText(event.starts_at, {dateStyle:'medium', timeStyle:'short'});
  body.append(title, location, date);

  /* Talón: precio y acceso al evento */
  var stub = document.createElement('div'); stub.className = 'ev-stub';
  var price = document.createElement('p'); price.className = 'ev-price';
  var label = document.createElement('span'); label.textContent = 'DESDE';
  price.append(label, document.createTextNode(eventMoney(event.base_price)));
  var link = document.createElement('a');
  link.href = '#'; link.className = 'btn btn-gold btn-sm'; link.textContent = 'Ver evento';
  link.setAttribute('aria-label', 'Ver el evento ' + event.name);
  link.addEventListener('click', function(ev){ ev.preventDefault(); abrirEventoPorCodigo(event.code); });
  stub.append(price, link);

  card.append(head, body, stub);
  return card;
}

function renderExploreEvents(){
  var grid = document.getElementById('events-grid');
  if(!grid) return;
  var query = (document.getElementById('event-search')?.value || '').trim().toLocaleLowerCase('es-CO');
  var citySelect = document.getElementById('event-city'), monthSelect = document.getElementById('event-month');
  var statusSelect = document.getElementById('event-status');
  var previousCity = selectedEventCity || (citySelect && citySelect.value) || '';
  var cities = Array.from(new Set(publicEvents.map(function(e){return e.city;}).filter(Boolean))).sort(function(a,b){return a.localeCompare(b,'es');});
  if(citySelect){
    citySelect.replaceChildren(new Option('Todas las ciudades',''));
    cities.forEach(function(city){citySelect.add(new Option(city,city));});
    citySelect.value = cities.includes(previousCity) ? previousCity : '';
    selectedEventCity = citySelect.value;
  }
  var months = Array.from(new Set(publicEvents.map(function(e){var d=eventDate(e.starts_at);return d ? eventMonthKey(d) : ''}).filter(Boolean))).sort();
  if(monthSelect){
    var previousMonth = monthSelect.value;
    monthSelect.replaceChildren(new Option('Todos los meses',''));
    months.forEach(function(key){var parts=key.split('-');var d=new Date(Date.UTC(Number(parts[0]),Number(parts[1])-1,1,12));monthSelect.add(new Option(new Intl.DateTimeFormat('es-CO',{month:'long',year:'numeric',timeZone:'America/Bogota'}).format(d),key));});
    monthSelect.value = months.includes(previousMonth) ? previousMonth : '';
  }
  var wantedCity = citySelect ? citySelect.value : previousCity;
  var wantedMonth = monthSelect ? monthSelect.value : '';
  var wantedStatus = statusSelect ? statusSelect.value : '';
  var shown = publicEvents.filter(function(e){
    var searchable=[e.name,e.venue,e.city,e.department,e.description].filter(Boolean).join(' ').toLocaleLowerCase('es-CO');
    var d=eventDate(e.starts_at), month=d ? eventMonthKey(d) : '';
    return (!query || searchable.includes(query)) && (!wantedCity || e.city===wantedCity) && (!wantedMonth || month===wantedMonth) && (!wantedStatus || eventStatus(e)===wantedStatus);
  });
  grid.replaceChildren();
  shown.forEach(function(event){
    grid.append(tarjetaDeEvento(event));
  });

  grid.setAttribute('aria-busy','false');
  if(!shown.length){var empty=document.createElement('p');empty.className='events-empty';empty.textContent=publicEvents.length
    ? 'No hay eventos que coincidan con estos filtros.'
    : (publicEventsSinConexion
        ? 'No pudimos contactar con el servidor, así que no hay cartelera que mostrar. Enciende el backend y recarga la página.'
        : 'Todavía no hay eventos publicados.');grid.append(empty);}
  var count=document.getElementById('event-results-count'); if(count) count.textContent=shown.length+' '+(shown.length===1?'evento encontrado':'eventos encontrados');
  updateEventClock();
}

function filterEvents(){ renderExploreEvents(); }

/* Entrada a la cartelera ya filtrada por un término (chips del hero y columna
   "Cartelera" del pie). Deja el término escrito en el buscador para que se vea
   de dónde viene el resultado y se pueda editar. */
function exploreCategory(term){
  nav('events');
  var input = document.getElementById('event-search');
  if(input){ input.value = term || ''; }
  ['event-city','event-month','event-status'].forEach(function(id){
    var el = document.getElementById(id); if(el){ el.value = ''; }
  });
  selectedEventCity = '';
  renderExploreEvents();
  return false;
}
function clearEventFilters(){
  ['event-search','event-city','event-month','event-status'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  selectedEventCity=''; renderExploreEvents();
}
function updateEventClock(){
  var clock=document.getElementById('events-live-clock');
  if(clock) clock.textContent=new Intl.DateTimeFormat('es-CO',{dateStyle:'medium',timeStyle:'medium',timeZone:'America/Bogota'}).format(new Date());
}
/* Guarda en memoria la cartelera recién traída. Lo usan la pantalla de
   eventos y también la portada, que pide la misma lista para el carrusel:
   así una sola respuesta sirve a las dos y, sobre todo, «Ver evento»
   funciona desde el inicio sin volver a pedir nada. */
function guardarCartelera(result){
  publicEvents = Array.isArray(result && result.events) ? result.events : [];
  publicEventsSinConexion = false;
  publicEventsServerTime = (result && result.serverTime) ? new Date(result.serverTime).getTime() : Date.now();
  publicEventsReceivedAt = Date.now();
}

/* Abre el detalle de un evento aunque la cartelera no esté en memoria.
   Pasa al entrar directo a la portada: el carrusel y las rejillas están
   pintados, pero la lista todavía no se ha guardado. */
async function abrirEventoPorCodigo(code){
  if(typeof openEventDetails !== 'function') return nav('events');
  var hay = publicEvents.some(function(e){ return e.code === code; });
  if(!hay){
    try{ await loadPublicEvents(); }catch(_e){}
  }
  if(publicEvents.some(function(e){ return e.code === code; })) return openEventDetails(code);
  return nav('events');
}

async function loadPublicEvents(){
  if(publicEventsLoading)return;
  publicEventsLoading=true;
  var grid=document.getElementById('events-grid');
  if(grid && publicEvents.length===0){grid.setAttribute('aria-busy','true');grid.innerHTML='<div class="events-loading" role="status" aria-label="Cargando eventos"><span class="loading-spinner" aria-hidden="true"></span><span>Cargando eventos…</span></div>';}
  try{
    var result=await tucketApi('/api/events');
    guardarCartelera(result);
    var updated=document.getElementById('events-updated-at');
    if(updated)updated.textContent='a las '+new Intl.DateTimeFormat('es-CO',{hour:'2-digit',minute:'2-digit',timeZone:'America/Bogota'}).format(new Date());
    renderExploreEvents();
  }catch(error){
    publicEvents=[];
    publicEventsSinConexion=apiNoDisponible(error);
    publicEventsServerTime=Date.now(); publicEventsReceivedAt=Date.now();
    var updated=document.getElementById('events-updated-at');
    if(updated)updated.textContent = apiNoDisponible(error) ? 'sin conexión con el servidor' : 'no se pudo actualizar';
  }finally{
    publicEventsLoading=false;
    renderExploreEvents();
  }
}
function initExploreEvents(){
  /* El filtro de estado se llena con el catálogo de la base. */
  cargarEstados().then(function(){
    llenarSelectDeEstados(document.getElementById('event-status'), 'eventos', {
      incluirTodos: true, textoTodos: 'Todos los estados', excluir: ['Cancelado']
    });
  });
  /* El reloj y la cartelera se pintan de una, sin esperar al refresco.

     Antes solo se pedían los eventos cuando no había ninguno en memoria.
     El problema es que la portada ya los pide para su carrusel, así que
     al entrar a Eventos desde el inicio la lista ya estaba cargada, no
     se pedía de nuevo y tampoco se dibujaba: la pantalla se quedaba en
     «Cargando eventos…» hasta que corriera el temporizador de los 15
     segundos. Si ya están en memoria, se dibujan ahora mismo.

     Si no hay nada en memoria y ya se está pidiendo, no se dibuja: se
     deja el «Cargando eventos…» puesto, porque dibujar la lista vacía
     mostraría «no se encontraron eventos» por un instante y enseguida
     aparecerían. De eso se encarga la propia petición al terminar. */
  updateEventClock();
  if(!publicEvents.length && !publicEventsLoading) loadPublicEvents();
  else if(publicEvents.length) renderExploreEvents();
  if(!publicEventsTimer){
    publicEventsTimer=setInterval(function(){updateEventClock();renderExploreEvents();},15000);
    setInterval(loadPublicEvents,120000);
  }
}
function searchEvents(event){
  if(event)event.preventDefault();
  var input=document.getElementById('home-search-input'), city=document.getElementById('home-search-city');
  selectedEventCity=city && city.value && city.value!=='Todas las ciudades' ? city.value : '';
  nav('events');
  var eventSearch=document.getElementById('event-search'); if(eventSearch)eventSearch.value=input?input.value:'';
  renderExploreEvents(); return false;
}

/* Pone (o quita) la imagen de fondo de la cabecera.

   Si el evento tiene banner propio se usa ese, y se desenfoca menos:
   está hecho para verse. Si solo hay afiche, se desenfoca un poco más,
   porque un afiche vertical estirado a lo ancho se ve raro si queda
   demasiado nítido.

   Se precarga antes de asignarlo: si se pusiera directo, el fondo
   aparecería en blanco y se llenaría a trozos mientras descarga, que
   encima del azul se nota mucho. Si la imagen falla, la cabecera se queda
   con su fondo de siempre. */
function fondoDelEvento(ruta, esBanner){
  var capa=document.getElementById('detail-hero-bg');
  if(!capa)return;
  capa.classList.toggle('es-banner', !!esBanner);
  if(!ruta){
    capa.classList.remove('is-visible');
    capa.style.backgroundImage='';
    return;
  }
  var previa=new Image();
  previa.onload=function(){
    capa.style.backgroundImage='url("'+ruta.replace(/"/g,'%22')+'")';
    capa.classList.add('is-visible');
  };
  previa.onerror=function(){
    capa.classList.remove('is-visible');
    capa.style.backgroundImage='';
  };
  previa.src=ruta;
}

function openEventDetails(code){
  var event=publicEvents.find(function(item){return item.code===code;}); if(!event)return false;
  window.selectedPublicEvent=event;
  /* El aviso de la reserva es de UN intento concreto: si no se borra aquí,
     el «este evento está cancelado» del evento anterior sigue en pantalla
     al abrir el siguiente, como si el nuevo también lo estuviera. */
  if(typeof reservaMensaje==='function') reservaMensaje('');
  var values={
    'detail-crumb':event.name,'detail-status':eventStatus(event),'detail-title':event.name,
    'detail-venue':[event.venue,event.city,event.department].filter(Boolean).join(' · '),
    'detail-start':eventDateText(event.starts_at,{dateStyle:'medium',timeStyle:'short'}),
    'detail-end':eventDateText(event.ends_at,{dateStyle:'medium',timeStyle:'short'}),
    'detail-capacity':new Intl.NumberFormat('es-CO').format(Number(event.total_capacity)||0)+' personas',
    'detail-code':event.code,'detail-description':event.description||'Sin descripción registrada.',
    'detail-observations':event.observations||'Sin observaciones.'
  };
  Object.keys(values).forEach(function(id){var el=document.getElementById(id);if(el)el.textContent=values[id];});
  var detailBadge=document.getElementById('detail-status');
  if(detailBadge){var status=eventStatus(event);detailBadge.className=claseDeEstado('eventos', status);}
  var address=document.getElementById('detail-address');if(address)address.textContent=[event.venue,event.city,event.department].filter(Boolean).join(' · ');
  /* Afiche del evento, si lo tiene. El mismo archivo se usa dos veces: la
     ficha de la cabecera y el fondo difuminado de la sección. */
  var poster=document.getElementById('detail-poster');
  var posterImg=document.getElementById('detail-poster-img');
  if(poster&&posterImg){
    if(event.image_path){
      posterImg.src=event.image_path;
      posterImg.alt=event.image_alt||('Afiche del evento '+event.name);
      posterImg.onerror=function(){poster.hidden=true;fondoDelEvento(event.banner_path||null, true);};
      poster.hidden=false;
    }else{
      poster.hidden=true;
      posterImg.removeAttribute('src');
    }
  }
  /* El banner manda; el afiche es el respaldo. */
  fondoDelEvento(event.banner_path || event.image_path, !!event.banner_path);
  if(typeof setEventPrice==='function')setEventPrice(event.base_price);
  nav('event-detail');return false;
}
