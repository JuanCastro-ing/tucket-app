/* TUCKET — Panel de administración: reportes con datos reales
   (necesita api.js y navigation.js)

   Todo lo de este archivo sale de GET /api/admin/stats. Antes las cifras,
   las gráficas y las tablas estaban escritas a mano en el HTML: se veían
   siempre iguales aunque la base estuviera vacía.

   Las gráficas se dibujan como SVG con las mismas clases que ya traía la
   maqueta (g-grid, g-line, g-bar, …), así que el estilo lo sigue poniendo
   admin-dashboard.css y aquí solo se calculan coordenadas.

   Va en archivo aparte de admin-dashboard.js, que se ocupa de la bandeja
   de solicitudes: son dos cosas distintas del mismo panel. */

var MESES = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
var admAnio = null;

/* Utilidades */
function admNumero(valor){
  return new Intl.NumberFormat('es-CO').format(Number(valor) || 0);
}
function admMoneda(valor){
  return new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 })
    .format(Number(valor) || 0);
}
/* Los ejes de dinero en pesos colombianos se vuelven ilegibles con todos
   los dígitos, así que se abrevian. */
function admCorto(valor){
  var n = Number(valor) || 0;
  if(n >= 1000000) return '$' + (n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace('.', ',') + 'M';
  if(n >= 1000) return '$' + Math.round(n / 1000) + 'K';
  return '$' + Math.round(n);
}
function admFecha(valor){
  var d = new Date(valor);
  return isNaN(d.getTime()) ? '—'
    : new Intl.DateTimeFormat('es-CO', { dateStyle:'medium', timeZone:'America/Bogota' }).format(d);
}
function admMensaje(texto, tipo){
  var caja = document.getElementById('adm-message');
  if(!caja) return;
  if(!texto){ caja.hidden = true; caja.textContent = ''; return; }
  caja.textContent = texto;
  caja.className = 'form-message form-message-' + (tipo === 'error' ? 'error' : 'success');
  caja.hidden = false;
}

/* Crear nodos SVG necesita el espacio de nombres; createElement no sirve. */
var SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tipo, atributos){
  var nodo = document.createElementNS(SVG_NS, tipo);
  Object.keys(atributos || {}).forEach(function(k){ nodo.setAttribute(k, atributos[k]); });
  return nodo;
}
function svgTexto(x, y, texto, clase, anclaje){
  var t = svgEl('text', { x:x, y:y, class:clase, 'text-anchor': anclaje || 'middle' });
  t.textContent = texto;
  return t;
}
function svgVacio(svg, mensaje){
  svg.replaceChildren();
  var caja = svg.viewBox.baseVal;
  svg.append(svgTexto(caja.width / 2, caja.height / 2, mensaje, 'g-axis'));
}

/* Gráfica de línea: ingresos por mes */
function admLinea(svg, datos){
  svg.replaceChildren();
  var total = datos.reduce(function(a, d){ return a + d.total; }, 0);
  if(!total){ return svgVacio(svg, 'Sin ingresos registrados en este año'); }

  var x0 = 48, x1 = 446, yTope = 20, yBase = 176;
  var max = Math.max.apply(null, datos.map(function(d){ return d.total; })) || 1;
  var paso = (x1 - x0) / Math.max(1, datos.length - 1);
  var y = function(v){ return yBase - (v / max) * (yBase - yTope); };

  /* Cuatro líneas de referencia bastan para leer la escala sin ruido. */
  for(var i = 1; i <= 4; i++){
    var valor = (max / 4) * i;
    svg.append(svgEl('line', { x1:x0, y1:y(valor), x2:x1, y2:y(valor), class:'g-grid' }));
    svg.append(svgTexto(x0 - 8, y(valor) + 3.5, admCorto(valor), 'g-axis', 'end'));
  }

  var puntos = datos.map(function(d, i){ return (x0 + paso * i).toFixed(1) + ',' + y(d.total).toFixed(1); });
  svg.append(svgEl('polygon', { points: puntos.join(' ') + ' ' + x1 + ',' + yBase + ' ' + x0 + ',' + yBase, class:'g-area' }));
  svg.append(svgEl('polyline', { points: puntos.join(' '), class:'g-line' }));

  datos.forEach(function(d, i){
    var cx = x0 + paso * i;
    var punto = svgEl('circle', { cx:cx.toFixed(1), cy:y(d.total).toFixed(1), r:4.5, class:'g-dot' });
    var titulo = svgEl('title', {});
    titulo.textContent = MESES[d.mes - 1] + ': ' + admMoneda(d.total);
    punto.append(titulo);
    svg.append(punto);
    /* Con doce meses las etiquetas se pisan: se muestra una sí y una no. */
    if(datos.length <= 7 || i % 2 === 0){
      svg.append(svgTexto(cx, 196, MESES[d.mes - 1], 'g-axis'));
    }
  });
}

/* Gráfica de barras: reservas por mes */
function admBarras(svg, datos){
  svg.replaceChildren();
  var total = datos.reduce(function(a, d){ return a + d.total; }, 0);
  if(!total){ return svgVacio(svg, 'Sin reservas registradas en este año'); }

  var x0 = 34, x1 = 350, yTope = 20, yBase = 176;
  var max = Math.max.apply(null, datos.map(function(d){ return d.total; })) || 1;
  var ancho = (x1 - x0) / datos.length;
  var grosor = Math.max(6, ancho * 0.6);

  for(var i = 1; i <= 3; i++){
    var valor = (max / 3) * i;
    var yv = yBase - (valor / max) * (yBase - yTope);
    svg.append(svgEl('line', { x1:x0, y1:yv, x2:x1, y2:yv, class:'g-grid' }));
    svg.append(svgTexto(x0 - 6, yv + 3.5, Math.round(valor), 'g-axis', 'end'));
  }

  datos.forEach(function(d, i){
    var alto = (d.total / max) * (yBase - yTope);
    var cx = x0 + ancho * i + ancho / 2;
    var barra = svgEl('rect', {
      x:(cx - grosor / 2).toFixed(1), y:(yBase - alto).toFixed(1),
      width:grosor.toFixed(1), height:Math.max(0, alto).toFixed(1), rx:2, class:'g-bar'
    });
    var titulo = svgEl('title', {});
    titulo.textContent = MESES[d.mes - 1] + ': ' + admNumero(d.total) + (d.total === 1 ? ' reserva' : ' reservas');
    barra.append(titulo);
    svg.append(barra);
    if(datos.length <= 7 || i % 2 === 0){
      svg.append(svgTexto(cx, 196, MESES[d.mes - 1], 'g-axis'));
    }
  });
}

/* Barras horizontales: ingresos por agente */
function admBarrasHorizontales(svg, filas){
  svg.replaceChildren();
  if(!filas.length){ return svgVacio(svg, 'Ningún agente ha recaudado todavía'); }

  var max = Math.max.apply(null, filas.map(function(f){ return f.total; })) || 1;
  var alto = 30, inicio = 18, xEtiqueta = 8, xBarra = 150, anchoMax = 230;

  filas.forEach(function(f, i){
    var y = inicio + i * alto;
    svg.append(svgTexto(xEtiqueta, y + 11, f.agente.length > 22 ? f.agente.slice(0, 21) + '…' : f.agente, 'g-label', 'start'));
    var ancho = Math.max(2, (f.total / max) * anchoMax);
    var barra = svgEl('rect', { x:xBarra, y:y, width:ancho.toFixed(1), height:15, rx:2, class:'g-bar' });
    var titulo = svgEl('title', {});
    titulo.textContent = f.agente + ': ' + admMoneda(f.total);
    barra.append(titulo);
    svg.append(barra);
    svg.append(svgTexto(xBarra + ancho + 8, y + 12, admCorto(f.total), 'g-value', 'start'));
  });
}

/* Dona: eventos por ciudad */
function admDona(svg, filas, total){
  svg.replaceChildren();
  if(!filas.length || !total){ return svgVacio(svg, 'Todavía no hay eventos publicados'); }

  /* Más de cuatro porciones no se distinguen; el resto se agrupa. */
  var principales = filas.slice(0, 4);
  var resto = filas.slice(4).reduce(function(a, f){ return a + f.total; }, 0);
  if(resto) principales.push({ ciudad:'Otras ciudades', total:resto });

  var cx = 110, cy = 110, r = 70, grosor = 26;
  var circunferencia = 2 * Math.PI * r;
  var acumulado = 0;

  principales.forEach(function(f, i){
    var porcion = f.total / total;
    var arco = svgEl('circle', {
      cx:cx, cy:cy, r:r, fill:'none',
      'stroke-width':grosor,
      class:'g-c' + ((i % 4) + 1) + '-stroke',
      'stroke-dasharray': (porcion * circunferencia).toFixed(2) + ' ' + circunferencia.toFixed(2),
      'stroke-dashoffset': (-acumulado * circunferencia).toFixed(2),
      transform:'rotate(-90 ' + cx + ' ' + cy + ')'
    });
    var titulo = svgEl('title', {});
    titulo.textContent = f.ciudad + ': ' + f.total + ' (' + Math.round(porcion * 100) + '%)';
    arco.append(titulo);
    svg.append(arco);
    acumulado += porcion;
  });

  svg.append(svgTexto(cx, cy + 4, admNumero(total), 'g-donut-n'));
  svg.append(svgTexto(cx, cy + 20, 'EVENTOS', 'g-donut-l'));

  principales.forEach(function(f, i){
    var y = 36 + i * 24;
    svg.append(svgEl('rect', { x:230, y:y - 9, width:10, height:10, rx:2,
      class:'g-c' + ((i % 4) + 1) + '-fill' }));
    svg.append(svgTexto(248, y, f.ciudad + ' — ' + f.total + ' (' + Math.round((f.total / total) * 100) + '%)', 'g-label', 'start'));
  });
}

/* Tablas */
function admFilaVacia(cuerpo, columnas, texto){
  var tr = document.createElement('tr');
  var td = document.createElement('td');
  td.colSpan = columnas; td.className = 'cell-muted'; td.textContent = texto;
  tr.append(td); cuerpo.append(tr);
}

function admTabla(id, filas, columnas, vacio, pintar){
  var cuerpo = document.getElementById(id);
  if(!cuerpo) return;
  cuerpo.replaceChildren();
  if(!filas.length) return admFilaVacia(cuerpo, columnas, vacio);
  filas.forEach(function(fila){ cuerpo.append(pintar(fila)); });
}

function admCelda(texto, clase){
  var td = document.createElement('td');
  if(clase) td.className = clase;
  td.textContent = texto === null || texto === undefined || texto === '' ? '—' : texto;
  return td;
}
function admCeldaCausa(texto){
  var td = document.createElement('td');
  if(!texto){ td.className = 'cell-muted'; td.textContent = 'Sin causa registrada'; return td; }
  var tag = document.createElement('span');
  tag.className = 'cause-tag';
  tag.textContent = texto;
  td.append(tag);
  return td;
}

/* Pintar todo */
function admPintar(datos){
  admAnio = datos.year;

  /* Selector de año, con los años que de verdad tienen movimiento. */
  var selector = document.getElementById('adm-anio');
  if(selector){
    selector.replaceChildren();
    datos.years.forEach(function(a){ selector.add(new Option('Año ' + a, a)); });
    selector.value = String(datos.year);
  }

  var c = datos.counts || {};
  var poner = function(id, valor){ var el = document.getElementById(id); if(el) el.textContent = valor; };
  poner('adm-clientes', admNumero(c.clientes));
  poner('adm-agentes', admNumero(c.agentes));
  poner('adm-admins', admNumero(c.administradores));
  poner('adm-eventos', admNumero(c.eventos));
  poner('adm-clientes-mes', c.clientes_mes ? '+' + c.clientes_mes + ' este mes' : 'Ninguno este mes');

  var titulo = document.getElementById('adm-ingresos-titulo');
  if(titulo) titulo.textContent = 'Ingresos totales por mes — ' + datos.year;

  var totalReservas = datos.reservationsByMonth.reduce(function(a, d){ return a + d.total; }, 0);
  var hintReservas = document.getElementById('adm-reservas-hint');
  if(hintReservas){
    hintReservas.textContent = totalReservas
      ? admNumero(totalReservas) + (totalReservas === 1 ? ' reserva registrada en ' : ' reservas registradas en ') + datos.year
      : 'Sin reservas en ' + datos.year;
  }

  var totalEventos = datos.eventsByCity.reduce(function(a, f){ return a + f.total; }, 0);
  var hintCiudades = document.getElementById('adm-ciudades-hint');
  if(hintCiudades){
    hintCiudades.textContent = totalEventos
      ? admNumero(totalEventos) + ' eventos publicados en ' + datos.eventsByCity.length +
        (datos.eventsByCity.length === 1 ? ' ciudad' : ' ciudades')
      : 'Todavía no hay eventos publicados';
  }

  var g = function(id){ return document.getElementById(id); };
  if(g('adm-ingresos')) admLinea(g('adm-ingresos'), datos.revenueByMonth);
  if(g('adm-reservas')) admBarras(g('adm-reservas'), datos.reservationsByMonth);
  if(g('adm-agentes-chart')) admBarrasHorizontales(g('adm-agentes-chart'), datos.revenueByAgent);
  if(g('adm-ciudades')) admDona(g('adm-ciudades'), datos.eventsByCity, totalEventos);

  admTabla('adm-cobertura', datos.coverage, 5, 'Todavía no hay eventos publicados.', function(f){
    var tr = document.createElement('tr');
    tr.append(admCelda(f.pais), admCelda(f.departamento), admCelda(f.ciudad, 'cell-strong'),
              admCelda(admNumero(f.eventos)), admCelda(admNumero(f.reservas)));
    return tr;
  });

  admTabla('adm-res-canceladas', datos.cancelledReservations, 5, 'No hay reservas canceladas.', function(f){
    var tr = document.createElement('tr');
    tr.append(admCelda(f.code, 'cell-strong'), admCelda(f.cliente), admCelda(f.evento),
              admCelda(admFecha(f.fecha)), admCeldaCausa(f.causa));
    return tr;
  });

  admTabla('adm-ev-cancelados', datos.cancelledEvents, 4, 'No hay eventos cancelados.', function(f){
    var tr = document.createElement('tr');
    tr.append(admCelda(f.evento, 'cell-strong'), admCelda(f.ciudad),
              admCelda(admFecha(f.fecha)), admCeldaCausa(f.causa));
    return tr;
  });
}

/* Carga */
async function cargarPanelAdmin(anio){
  admMensaje('');
  try{
    var ruta = '/api/admin/stats' + (anio ? '?year=' + encodeURIComponent(anio) : '');
    admPintar(await tucketApi(ruta));
  }catch(error){
    admMensaje(
      rutaNoMontada(error)
        ? 'El servidor está encendido pero no reconoce esta ruta: quedó con una versión anterior del código. Deténlo con Ctrl+C y vuelve a correr npm start.'
        : apiNoDisponible(error)
        ? 'No se pudo contactar con el servidor, así que el panel no tiene datos que mostrar.'
        : error.message,
      'error'
    );
  }
}

function cambiarAnioPanel(anio){
  cargarPanelAdmin(anio);
  return false;
}

function initAdminStats(){
  cargarPanelAdmin(admAnio);
}
