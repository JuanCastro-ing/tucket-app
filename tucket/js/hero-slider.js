/* TUCKET — Hero deslizante de eventos destacados (portada).

   La sección entera se mueve en horizontal: cada diapositiva trae su propia
   escena de fondo, su titular y la ficha del evento. El buscador queda fuera
   del carril, fijo, porque es la acción principal de la página.

   Todavía no existe "evento destacado" en la base de datos, así que arranca
   con una diapositiva por género y los datos en blanco. Cuando exista el dato
   real, setHeroFeatured(listaDeEventos) rellena el carrusel. */

var heroScenes = [
  { scene:'concierto', genero:'Concierto',
    vacioTitulo:'Vive el concierto del año.',
    vacioTexto:'Cuando un concierto se marque como destacado aparecerá en esta portada con su recinto, su fecha y su precio.' },
  { scene:'teatro', genero:'Teatro',
    vacioTitulo:'El telón sube para ti.',
    vacioTexto:'Las obras destacadas ocuparán este espacio apenas se publiquen desde el panel de agente.' },
  { scene:'festival', genero:'Festival',
    vacioTitulo:'Festivales de noche entera.',
    vacioTexto:'Aquí irá el festival destacado del momento, con el aforo y la boletería al día.' },
  { scene:'comedia', genero:'Comedia',
    vacioTitulo:'Una noche de pura comedia.',
    vacioTexto:'Los shows destacados se mostrarán en esta portada con su sala y su hora de inicio.' }
];

var heroSlides = [];
var heroIndex = 0;

function heroMoney(value){
  return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0})
    .format(Number(value) || 0);
}
function heroFecha(value){
  var d = new Date(value);
  return isNaN(d.getTime()) ? null
    : new Intl.DateTimeFormat('es-CO',{dateStyle:'long',timeStyle:'short',timeZone:'America/Bogota'}).format(d);
}
function heroHueco(extra){
  var s = document.createElement('span');
  s.className = 'hero-ghost' + (extra ? ' ' + extra : '');
  s.setAttribute('aria-hidden','true');
  return s;
}
function heroDato(etiqueta, valor, fuerte){
  var li = document.createElement('li');
  var k = document.createElement('span'); k.className = 'k'; k.textContent = etiqueta;
  var v = document.createElement('span'); v.className = 'v' + (fuerte ? ' is-strong' : '');
  if(typeof valor === 'string') v.textContent = valor; else v.append(valor);
  li.append(k, v);
  return li;
}

function heroSlideNode(slide, i){
  var wrap = document.createElement('div');
  wrap.className = 'hero-slide';
  wrap.setAttribute('role','group');
  wrap.setAttribute('aria-roledescription','diapositiva');
  wrap.setAttribute('aria-label', (i+1) + ' de ' + heroSlides.length + ': ' + slide.genero);

  var inner = document.createElement('div');
  inner.className = 'container hero-slide-inner';

  var kicker = document.createElement('p');
  kicker.className = 'hero-kicker';
  kicker.textContent = slide.event
    ? (slide.etiqueta || slide.genero + ' destacado')
    : slide.genero;

  var titulo = document.createElement('h2');
  titulo.className = 'hero-headline';

  var lead = document.createElement('p');
  lead.className = 'hero-lead';

  var facts = document.createElement('ul');
  facts.className = 'hero-facts';

  var cta = document.createElement('a');
  cta.href = '#';
  cta.className = 'btn btn-gold hero-cta';

  /* Afiche del evento. Va fuera del texto para que la animación escalonada
     de .hero-slide-inner > * lo trate como un elemento más. */
  var afiche = null;

  if(slide.event){
    var ev = slide.event;
    titulo.textContent = ev.name;
    lead.textContent = ev.description || '';
    facts.append(
      heroDato('Recinto', [ev.venue, ev.city].filter(Boolean).join(', ')),
      heroDato('Fecha', heroFecha(ev.starts_at) || 'Por confirmar'),
      heroDato('Desde', heroMoney(ev.base_price), true)
    );
    if(ev.image_path){
      afiche = document.createElement('figure');
      afiche.className = 'hero-poster';
      var img = document.createElement('img');
      img.src = ev.image_path;
      img.alt = ev.image_alt || ('Afiche de ' + ev.name);
      /* Sin carga diferida: las diapositivas no visibles están fuera de
         cuadro por un transform, y con loading="lazy" el navegador puede no
         descargarlas nunca, dejando el hueco en blanco al deslizar. */
      img.loading = 'eager';
      /* Si el archivo no está, se quita la ficha entera en vez de dejar el
         icono de imagen rota sobre la portada. */
      img.addEventListener('error', function(){ afiche.remove(); });
      afiche.append(img);
    }
    cta.textContent = 'Ver evento y reservar';
    cta.addEventListener('click', function(e){
      e.preventDefault();
      heroAbrirEvento(ev.code);
    });
  }else{
    titulo.textContent = slide.vacioTitulo;
    lead.textContent = slide.vacioTexto;
    facts.append(
      heroDato('Recinto', heroHueco()),
      heroDato('Fecha', heroHueco()),
      heroDato('Desde', heroHueco('w-sm'), true)
    );
    cta.textContent = 'Explorar la cartelera';
    cta.addEventListener('click', function(e){ e.preventDefault(); nav('events'); });
  }

  inner.append(kicker, titulo, lead, facts, cta);
  if(afiche) inner.append(afiche);
  wrap.append(inner);
  if(afiche) wrap.classList.add('has-poster');
  return wrap;
}

/* El detalle del evento se arma con la lista pública de events.js. Si todavía
   no está cargada (alguien entra directo a la portada y hace clic), se carga
   antes de abrir, y si aun así no aparece se cae a la cartelera. */
async function heroAbrirEvento(code){
  if(typeof openEventDetails !== 'function') return nav('events');
  var hay = typeof publicEvents !== 'undefined'
    && publicEvents.some(function(e){ return e.code === code; });
  if(!hay && typeof loadPublicEvents === 'function'){
    try{ await loadPublicEvents(); }catch(_e){}
  }
  if(typeof publicEvents !== 'undefined'
     && publicEvents.some(function(e){ return e.code === code; })){
    return openEventDetails(code);
  }
  return nav('events');
}

function renderHero(){
  var track = document.getElementById('hero-track');
  var dots  = document.getElementById('hero-dots');
  if(!track) return;

  track.replaceChildren();
  heroSlides.forEach(function(slide, i){ track.append(heroSlideNode(slide, i)); });

  if(dots){
    dots.replaceChildren();
    heroSlides.forEach(function(slide, i){
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'hero-dot';
      b.setAttribute('aria-label','Ir a la diapositiva ' + (i+1) + ': ' + slide.genero);
      b.addEventListener('click', function(){ goHero(i); });
      dots.append(b);
    });
  }
  heroIndex = 0;
  goHero(0);
}

function goHero(i){
  if(!heroSlides.length) return false;
  heroIndex = (i + heroSlides.length) % heroSlides.length;

  var track = document.getElementById('hero-track');
  if(track) track.style.transform = 'translate3d(-' + (heroIndex * 100) + '%,0,0)';

  /* La escena de fondo acompaña a la diapositiva */
  var escena = heroSlides[heroIndex].scene;
  document.querySelectorAll('.hero-bg-layer').forEach(function(layer){
    layer.classList.toggle('is-active', layer.dataset.scene === escena);
  });

  /* Y encima, la imagen del evento: su banner, o el afiche si no tiene. */
  var ev = heroSlides[heroIndex].event;
  fondoDelHero(ev && (ev.banner_path || ev.image_path));

  /* Solo la diapositiva visible reproduce su entrada escalonada */
  document.querySelectorAll('#hero-track .hero-slide').forEach(function(s, n){
    s.classList.toggle('is-current', n === heroIndex);
    s.setAttribute('aria-hidden', n === heroIndex ? 'false' : 'true');
  });

  document.querySelectorAll('#hero-dots .hero-dot').forEach(function(d, n){
    d.classList.toggle('is-active', n === heroIndex);
    d.setAttribute('aria-current', n === heroIndex ? 'true' : 'false');
  });

  /* Si alguien cambió de diapositiva a mano, el reloj vuelve a empezar
     para darle los 5 segundos completos de lectura. */
  if(typeof reiniciarHeroAuto === 'function') reiniciarHeroAuto();
  return false;
}

/* Pinta la imagen del evento destacado detrás de la diapositiva.

   Se precarga igual que en el detalle: asignarla directa deja el fondo en
   blanco mientras descarga, y sobre la escena oscura se nota. Si el evento
   no trae imagen, o falla, se quita y queda la escena dibujada, que para
   eso está. */
function fondoDelHero(ruta){
  var capa = document.getElementById('hero-bg-photo');
  if(!capa) return;
  if(!ruta){
    capa.classList.remove('is-visible');
    capa.style.backgroundImage = '';
    return;
  }
  var previa = new Image();
  previa.onload = function(){
    capa.style.backgroundImage = 'url("' + ruta.replace(/"/g, '%22') + '")';
    capa.classList.add('is-visible');
  };
  previa.onerror = function(){
    capa.classList.remove('is-visible');
    capa.style.backgroundImage = '';
  };
  previa.src = ruta;
}

function heroPrev(){ goHero(heroIndex - 1); return false; }
function heroNext(){ goHero(heroIndex + 1); return false; }

/* Avance automático
   El carrusel pasa solo cada 5 segundos. Tres reglas para que no
   moleste en vez de ayudar:
   · Se detiene mientras el cursor está encima o el foco está dentro.
     Nada peor que leer un evento y que la página lo cambie a media
     frase, o intentar pulsar «Ver evento» y que se mueva el botón.
   · Se detiene cuando la pestaña no está visible: avanzar para nadie
     solo gasta batería, y al volver se encontrarían ocho vueltas dadas.
   · Respeta «reducir movimiento» del sistema operativo. Quien lo activa
     suele hacerlo porque el movimiento le produce mareo, y un carrusel
     que se mueve solo es justo lo que pidió evitar.
   Tras tocar una flecha o un punto, el reloj se reinicia: así no cambia
   de diapositiva medio segundo después de que alguien eligió una. */
var HERO_INTERVALO = 5000;
var heroReloj = null;
var heroEnPausa = false;

function heroSinMovimiento(){
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function detenerHeroAuto(){
  if(heroReloj){ clearInterval(heroReloj); heroReloj = null; }
}

function arrancarHeroAuto(){
  detenerHeroAuto();
  if(heroEnPausa || heroSinMovimiento() || heroSlides.length < 2) return;
  heroReloj = setInterval(function(){
    if(document.hidden) return;
    goHero(heroIndex + 1);
  }, HERO_INTERVALO);
}

/* Lo llaman las flechas, los puntos y el teclado. */
function reiniciarHeroAuto(){
  if(heroReloj) arrancarHeroAuto();
}

/* La escena de fondo y la etiqueta salen del propio evento.

   La base no guarda el género del espectáculo, así que se deduce de su
   nombre y su descripción. Si no se reconoce ninguna palabra, se usa
   "Concierto", que es la escena más neutra. Es una aproximación consciente:
   el día que exista un campo de categoría, basta con leerlo aquí. */
var heroPalabras = [
  { scene:'comedia',   genero:'Comedia',   etiqueta:'Comedia destacada',   claves:['comedia','stand up','stand-up','humor','risa','comediante'] },
  { scene:'festival',  genero:'Festival',  etiqueta:'Festival destacado',  claves:['festival','feria','carnaval','salsódromo','salsodromo','encuentro'] },
  { scene:'teatro',    genero:'Teatro',    etiqueta:'Obra destacada',      claves:['teatro','obra','drama','monólogo','monologo','compañía nacional','romeo'] },
  { scene:'concierto', genero:'Concierto', etiqueta:'Concierto destacado', claves:['concierto','orquesta','banda','sinfónic','sinfonic','filarmónic','filarmonic','salsa','rock','tributo','boleros','música','musica','gala'] }
];

function heroEscenaPara(ev){
  var texto = ((ev && ev.name) + ' ' + (ev && ev.description || '')).toLowerCase();
  for(var i = 0; i < heroPalabras.length; i++){
    var grupo = heroPalabras[i];
    for(var j = 0; j < grupo.claves.length; j++){
      if(texto.indexOf(grupo.claves[j]) !== -1){
        return { scene:grupo.scene, genero:grupo.genero, etiqueta:grupo.etiqueta };
      }
    }
  }
  return { scene:'concierto', genero:'Espectáculo', etiqueta:'Espectáculo destacado' };
}

/* Punto de entrada para los datos reales cuando existan eventos destacados. */
function setHeroFeatured(events){
  var lista = Array.isArray(events) ? events : [];
  heroSlides = lista.length
    ? lista.slice(0, 6).map(function(ev){
        var base = heroEscenaPara(ev);
        return { scene:base.scene, genero:base.genero, etiqueta:base.etiqueta, event:ev };
      })
    : heroScenes.map(function(s){
        return { scene:s.scene, genero:s.genero, vacioTitulo:s.vacioTitulo,
                 vacioTexto:s.vacioTexto, event:null };
      });
  renderHero();
}

/* Qué eventos salen en la portada.
   No existe una marca de "destacado" en la base, así que se decide con los
   datos que ya hay: primero los que más entradas llevan vendidas, y a
   igualdad de reservas, el que ocurre antes. Mientras nadie haya reservado
   todavía, el orden se reduce a los próximos espectáculos, que es justo lo
   que conviene mostrar en una cartelera recién estrenada.
   Quedan fuera los cancelados, los finalizados y los que ya pasaron: la
   portada es para lo que todavía se puede comprar. */
function heroDestacados(events){
  var ahora = Date.now();
  return (Array.isArray(events) ? events : [])
    .filter(function(ev){
      if(ev.status === 'Cancelado' || ev.status === 'Finalizado') return false;
      var fin = new Date(ev.ends_at).getTime();
      return !Number.isNaN(fin) && fin > ahora;
    })
    .map(function(ev){
      var cupo = Number(ev.total_capacity) || 0;
      var libres = ev.available_seats === null || ev.available_seats === undefined
        ? cupo : Number(ev.available_seats);
      return { ev: ev, vendidas: Math.max(0, cupo - libres),
               inicio: new Date(ev.starts_at).getTime() || Infinity };
    })
    .sort(function(a, b){
      return b.vendidas - a.vendidas || a.inicio - b.inicio;
    })
    .slice(0, 6)
    .map(function(item){ return item.ev; });
}

/* Trae la cartelera y rellena el carrusel. Cualquier fallo deja las
   diapositivas de presentación, que es el estado que ya existía. */
async function loadHeroFeatured(){
  if(typeof tucketApi !== 'function') return;
  try{
    var resultado = await tucketApi('/api/events');
    var destacados = heroDestacados(resultado && resultado.events);
    if(destacados.length) setHeroFeatured(destacados);

    /* Con la misma respuesta se llenan las dos rejillas de más abajo, para
       no pedir tres veces lo mismo al servidor. */
    if(typeof pintarDestacados === 'function') pintarDestacados(resultado && resultado.events);
  }catch(_error){
    /* Sin backend la portada se queda con su versión de presentación. */
    if(typeof portadaSinConexion === 'function') portadaSinConexion();
  }
}

function initHeroSlider(){
  var slider = document.getElementById('hero-feature');
  if(!slider || slider.dataset.ready === 'true') return;
  slider.dataset.ready = 'true';

  setHeroFeatured([]);   // se dibuja de inmediato y se reemplaza al llegar los datos
  loadHeroFeatured();

  var hero = document.querySelector('.home-hero');
  if(!hero) return;

  /* Teclado cuando el foco está dentro del hero */
  hero.addEventListener('keydown', function(e){
    if(e.key === 'ArrowLeft'){ e.preventDefault(); heroPrev(); }
    if(e.key === 'ArrowRight'){ e.preventDefault(); heroNext(); }
  });

  /* Pausa mientras alguien está mirando o usando el carrusel */
  function pausar(){ heroEnPausa = true; detenerHeroAuto(); }
  function reanudar(){ heroEnPausa = false; arrancarHeroAuto(); }
  hero.addEventListener('mouseenter', pausar);
  hero.addEventListener('mouseleave', reanudar);
  hero.addEventListener('focusin', pausar);
  hero.addEventListener('focusout', function(e){
    /* focusout salta también al moverse ENTRE elementos del hero: solo se
       reanuda cuando el foco se fue de verdad fuera. */
    if(!hero.contains(e.relatedTarget)) reanudar();
  });

  /* Al volver a la pestaña, el reloj empieza de cero en vez de disparar
     de golpe todo lo que se acumuló mientras no se veía. */
  document.addEventListener('visibilitychange', function(){
    if(!document.hidden) arrancarHeroAuto();
  });

  arrancarHeroAuto();

  /* Arrastre horizontal en pantallas táctiles */
  var x0 = null, y0 = null;
  hero.addEventListener('touchstart', function(e){
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, {passive:true});
  hero.addEventListener('touchend', function(e){
    if(x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    var dy = e.changedTouches[0].clientY - y0;
    /* Solo si el gesto es claramente horizontal, para no robar el scroll */
    if(Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.6){
      dx < 0 ? heroNext() : heroPrev();
    }
    x0 = null; y0 = null;
  }, {passive:true});
}
