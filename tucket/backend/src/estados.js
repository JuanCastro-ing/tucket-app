/* Catálogo de estados, leído de la base.

   Antes cada regla estaba escrita en el código:

       const ESTADOS_RESERVABLES = new Set(['Programado', 'En Boletería']);
       const estadosFinales = new Set(['Finalizado', 'Cancelado']);

   Eso obligaba a tocar varios archivos para agregar un estado, y olvidar
   uno fallaba en silencio. Ahora esas reglas son columnas de las tablas
   event_statuses, reservation_statuses y request_statuses, y este módulo
   las trae.

   Se guardan en memoria tras la primera consulta: son tres tablas de
   cinco filas que no cambian mientras el servidor corre, y consultarlas
   en cada petición sería gasto sin sentido. Si alguien agrega un estado
   en la base con el servidor encendido, basta reiniciarlo. */

const pool = require('./db');

let cache = null;

async function cargar() {
  if (cache) return cache;

  const [eventos, reservas, solicitudes] = await Promise.all([
    pool.query('SELECT * FROM event_statuses ORDER BY display_order'),
    pool.query('SELECT * FROM reservation_statuses ORDER BY display_order'),
    pool.query('SELECT * FROM request_statuses ORDER BY display_order')
  ]);

  cache = {
    eventos: eventos.rows,
    reservas: reservas.rows,
    solicitudes: solicitudes.rows,

    /* Conjuntos listos para preguntar, que es como se usan en las rutas. */
    eventosReservables: new Set(eventos.rows.filter((e) => e.allows_reservation).map((e) => e.code)),
    eventosFinales:     new Set(eventos.rows.filter((e) => e.is_final).map((e) => e.code)),
    eventosValidos:     new Set(eventos.rows.map((e) => e.code)),
    reservasOcupan:     new Set(reservas.rows.filter((r) => r.occupies_seat).map((r) => r.code)),
    reservasValidos:    new Set(reservas.rows.map((r) => r.code)),
    solicitudesValidos: new Set(solicitudes.rows.map((s) => s.code))
  };
  return cache;
}

/* Para las pruebas y para cuando se agregue un estado sin reiniciar. */
function olvidar() { cache = null; }

module.exports = { cargar, olvidar };
