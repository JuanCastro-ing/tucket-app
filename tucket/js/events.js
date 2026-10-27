/* TUCKET — Catálogo público, filtros y estado calculado con hora real */
var publicEvents = [];
var selectedEventCity = '';
var publicEventsServerTime = Date.now();
var publicEventsReceivedAt = Date.now();
var publicEventsTimer = null;
var publicEventsLoading = false;
var DEMO_EVENTS = [
  {code:'DEMO-001',name:'Noche de Salsa — Grupo Niche Tributo',description:'Una noche de salsa en vivo para disfrutar los clásicos de la música caleña.',venue:'Teatro Los Cristales',city:'Cali',department:'Valle del Cauca',starts_at:'2026-11-14T20:00:00-05:00',ends_at:'2026-11-14T23:00:00-05:00',total_capacity:1200,base_price:85000,status:'En Boletería',observations:'Apertura de puertas una hora antes.',image_path:'/img/events/demo-001.jpg',image_alt:'Afiche del evento Noche de Salsa — Grupo Niche Tributo'},
  {code:'DEMO-002',name:'Festival Rock a la Cañada',description:'Festival de música al aire libre.',venue:'Parque de la Salsa',city:'Cali',department:'Valle del Cauca',starts_at:'2026-10-10T21:00:00-05:00',ends_at:'2026-10-11T02:00:00-05:00',total_capacity:3000,base_price:120000,status:'En Boletería',observations:'',image_path:'/img/events/demo-002.jpg',image_alt:'Afiche del evento Festival Rock a la Cañada'},
  {code:'DEMO-003',name:'Romeo y Julieta — Compañía Nacional de Teatro',description:'Una puesta en escena de la obra clásica de Shakespeare.',venue:'Teatro Municipal Enrique Buenaventura',city:'Cali',department:'Valle del Cauca',starts_at:'2026-12-02T19:30:00-05:00',ends_at:'2026-12-02T22:00:00-05:00',total_capacity:800,base_price:52000,status:'Programado',observations:'',image_path:'/img/events/demo-003.jpg',image_alt:'Afiche del evento Romeo y Julieta — Compañía Nacional de Teatro'},
  {code:'DEMO-004',name:'Concierto de Fin de Año — Orquesta Filarmónica',description:'Concierto especial de temporada.',venue:'Teatro Jorge Isaacs',city:'Cali',department:'Valle del Cauca',starts_at:'2026-12-20T18:00:00-05:00',ends_at:'2026-12-20T21:00:00-05:00',total_capacity:900,base_price:65000,status:'Programado',observations:'',image_path:'/img/events/demo-004.jpg',image_alt:'Afiche del evento Concierto de Fin de Año — Orquesta Filarmónica'},
  {code:'DEMO-007',name:'Noche de Orquesta — Banda Sinfónica de Tuluá',description:'Concierto de la banda sinfónica en el marco de la temporada cultural.',venue:'Teatro Municipal Ángel María Camacho',city:'Tuluá',department:'Valle del Cauca',starts_at:'2026-11-21T19:00:00-05:00',ends_at:'2026-11-21T21:30:00-05:00',total_capacity:650,base_price:38000,status:'En Boletería',observations:'Entrada libre para estudiantes con carné.',image_path:'/img/events/demo-007.jpg',image_alt:'Afiche del evento Noche de Orquesta — Banda Sinfónica de Tuluá'},
  {code:'DEMO-005',name:'Stand Up Comedy Night',description:'Una noche de comedia en vivo.',venue:'Sala Beethoven',city:'Bogotá',department:'Bogotá D.C.',starts_at:'2026-11-28T20:30:00-05:00',ends_at:'2026-11-28T22:30:00-05:00',total_capacity:350,base_price:40000,status:'En Boletería',observations:'',image_path:'/img/events/demo-005.jpg',image_alt:'Afiche del evento Stand Up Comedy Night'},
  {code:'DEMO-006',name:'Feria de Cali — Show de Salsódromo',description:'Espectáculo de salsa y tradición caleña.',venue:'Autódromo de Palmaseca',city:'Cali',department:'Valle del Cauca',starts_at:'2026-09-03T19:00:00-05:00',ends_at:'2026-09-03T23:00:00-05:00',total_capacity:5000,base_price:95000,status:'Finalizado',observations:'',image_path:'/img/events/demo-006.jpg',image_alt:'Afiche del evento Feria de Cali — Show de Salsódromo'}
];

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
    badge.className = 'badge ' + ({'En Boletería':'badge-boleteria','Programado':'badge-programado','En Vivo':'badge-vivo','Finalizado':'badge-finalizado','Cancelado':'badge-cancelado'}[status] || 'badge-programado');
    badge.textContent = status;
    var serial = document.createElement('span');
    serial.className = 'ev-serial'; serial.textContent = event.code || '';
    head.append(badge, serial);

    /* Cuerpo */
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
    link.addEventListener('click', function(ev){ ev.preventDefault(); openEventDetails(event.code); });
    stub.append(price, link);

    card.append(head, body, stub);
    grid.append(card);
  });
  grid.setAttribute('aria-busy','false');
  if(!shown.length){var empty=document.createElement('p');empty.className='events-empty';empty.textContent=publicEvents.length?'No hay eventos que coincidan con estos filtros.':'Todavía no hay eventos publicados.';grid.append(empty);}
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
async function loadPublicEvents(){
  if(publicEventsLoading)return;
  publicEventsLoading=true;
  var grid=document.getElementById('events-grid');
  if(grid && publicEvents.length===0){grid.setAttribute('aria-busy','true');grid.innerHTML='<div class="events-loading" role="status" aria-label="Cargando eventos"><span class="loading-spinner" aria-hidden="true"></span><span>Cargando eventos…</span></div>';}
  try{
    var result=await tucketApi('/api/events');
    publicEvents=Array.isArray(result.events)&&result.events.length ? result.events : DEMO_EVENTS.slice();
    publicEventsServerTime=result.serverTime ? new Date(result.serverTime).getTime() : Date.now();
    publicEventsReceivedAt=Date.now();
    var updated=document.getElementById('events-updated-at');
    if(updated)updated.textContent='a las '+new Intl.DateTimeFormat('es-CO',{hour:'2-digit',minute:'2-digit',timeZone:'America/Bogota'}).format(new Date());
    renderExploreEvents();
  }catch(error){
    publicEvents=DEMO_EVENTS.slice();
    publicEventsServerTime=Date.now(); publicEventsReceivedAt=Date.now();
    var updated=document.getElementById('events-updated-at'); if(updated)updated.textContent='cartelera de muestra';
  }finally{
    publicEventsLoading=false;
    renderExploreEvents();
  }
}
function initExploreEvents(){
  if(!publicEvents.length && !publicEventsLoading) loadPublicEvents();
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

function openEventDetails(code){
  var event=publicEvents.find(function(item){return item.code===code;}); if(!event)return false;
  window.selectedPublicEvent=event;
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
  if(detailBadge){var status=eventStatus(event);detailBadge.className='badge '+({'En Boletería':'badge-boleteria','Programado':'badge-programado','En Vivo':'badge-vivo','Finalizado':'badge-finalizado'}[status]||'badge-programado');}
  var address=document.getElementById('detail-address');if(address)address.textContent=[event.venue,event.city,event.department].filter(Boolean).join(' · ');
  /* Afiche del evento, si lo tiene */
  var poster=document.getElementById('detail-poster');
  var posterImg=document.getElementById('detail-poster-img');
  if(poster&&posterImg){
    if(event.image_path){
      posterImg.src=event.image_path;
      posterImg.alt=event.image_alt||('Afiche del evento '+event.name);
      posterImg.onerror=function(){poster.hidden=true;};
      poster.hidden=false;
    }else{
      poster.hidden=true;
      posterImg.removeAttribute('src');
    }
  }
  if(typeof setEventPrice==='function')setEventPrice(event.base_price);
  nav('event-detail');return false;
}
