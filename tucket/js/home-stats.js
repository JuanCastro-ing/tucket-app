/* TUCKET — Cifras de la portada y del inicio de sesión
   (necesita api.js)

   Los tres recuadros —eventos activos, reservas del año y ciudades—
   estaban escritos a mano en el HTML. Cualquiera que abriera la base veía
   que no cuadraban, y en una sustentación es lo primero que se compara.

   Los dos sitios donde aparecen comparten el mismo marcado, así que se
   rellenan por atributo y no por id: un id tiene que ser único en la
   página y aquí hay seis recuadros, dos por cifra.

   Si el servidor no responde, los recuadros se quedan con su guion. Es
   preferible a inventar un número. */

var cifrasPortadaCargadas = false;

function pintarCifrasPortada(datos){
  var numero = new Intl.NumberFormat('es-CO');

  document.querySelectorAll('[data-cifra]').forEach(function(nodo){
    var valor = datos[nodo.dataset.cifra];
    if(valor === undefined || valor === null) return;
    nodo.textContent = numero.format(valor);
  });

  /* La etiqueta llevaba el año quemado («RESERVAS 2026»). Ahora lo pone el
     servidor, que es quien sabe en qué año está contando. */
  document.querySelectorAll('[data-cifra-etiqueta="reservas"]').forEach(function(nodo){
    nodo.textContent = 'RESERVAS ' + datos.year;
  });
}

async function cargarCifrasPortada(){
  if(cifrasPortadaCargadas || typeof tucketApi !== 'function') return;
  try{
    var datos = await tucketApi('/api/stats/home');
    pintarCifrasPortada(datos);
    cifrasPortadaCargadas = true;
  }catch(_error){
    /* Sin servidor no hay cifras que mostrar, y eso es justo lo que se ve. */
  }
}
