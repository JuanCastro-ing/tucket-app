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
  kicker.textContent = slide.event ? slide.genero + ' destacado' : slide.genero;

  var titulo = document.createElement('h2');
  titulo.className = 'hero-headline';

  var lead = document.createElement('p');
  lead.className = 'hero-lead';

  var facts = document.createElement('ul');
  facts.className = 'hero-facts';

  var cta = document.createElement('a');
  cta.href = '#';
  cta.className = 'btn btn-gold hero-cta';

  if(slide.event){
    var ev = slide.event;
    titulo.textContent = ev.name;
    lead.textContent = ev.description || '';
    facts.append(
      heroDato('Recinto', [ev.venue, ev.city].filter(Boolean).join(', ')),
      heroDato('Fecha', heroFecha(ev.starts_at) || 'Por confirmar'),
      heroDato('Desde', heroMoney(ev.base_price), true)
    );
    cta.textContent = 'Ver evento y reservar';
    cta.addEventListener('click', function(e){
      e.preventDefault();
      if(typeof openEventDetails === 'function') openEventDetails(ev.code);
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
  wrap.append(inner);
  return wrap;
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

  /* Solo la diapositiva visible reproduce su entrada escalonada */
  document.querySelectorAll('#hero-track .hero-slide').forEach(function(s, n){
    s.classList.toggle('is-current', n === heroIndex);
    s.setAttribute('aria-hidden', n === heroIndex ? 'false' : 'true');
  });

  document.querySelectorAll('#hero-dots .hero-dot').forEach(function(d, n){
    d.classList.toggle('is-active', n === heroIndex);
    d.setAttribute('aria-current', n === heroIndex ? 'true' : 'false');
  });
  return false;
}

function heroPrev(){ goHero(heroIndex - 1); return false; }
function heroNext(){ goHero(heroIndex + 1); return false; }

/* Punto de entrada para los datos reales cuando existan eventos destacados. */
function setHeroFeatured(events){
  var lista = Array.isArray(events) ? events : [];
  heroSlides = lista.length
    ? lista.slice(0, 6).map(function(ev, i){
        var base = heroScenes[i % heroScenes.length];
        return { scene:base.scene, genero:base.genero, event:ev };
      })
    : heroScenes.map(function(s){
        return { scene:s.scene, genero:s.genero, vacioTitulo:s.vacioTitulo,
                 vacioTexto:s.vacioTexto, event:null };
      });
  renderHero();
}

function initHeroSlider(){
  var slider = document.getElementById('hero-feature');
  if(!slider || slider.dataset.ready === 'true') return;
  slider.dataset.ready = 'true';

  setHeroFeatured([]);   // sin destacados todavía: prototipo con la ficha en blanco

  var hero = document.querySelector('.home-hero');
  if(!hero) return;

  /* Teclado cuando el foco está dentro del hero */
  hero.addEventListener('keydown', function(e){
    if(e.key === 'ArrowLeft'){ e.preventDefault(); heroPrev(); }
    if(e.key === 'ArrowRight'){ e.preventDefault(); heroNext(); }
  });

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
