/* Rutas del panel de administración: /api/admin/*

   Todo lo que aquí se devuelve sale de consultas sobre la base: el panel
   dejó de mostrar cifras de ejemplo. Si una sección aparece vacía es
   porque todavía no hay datos, no porque no esté conectada.

   Un solo endpoint y no diez: el panel se abre entero de una vez, así que
   diez peticiones solo añadirían latencia. Neon cobra por tiempo de
   cómputo, y una consulta de más por cada tarjeta se nota. */
const express = require('express');
const pool = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();
router.use(express.json({ limit: '32kb' }));

/* Las reservas que representan dinero: una cancelada no ingresó nada. */
const RESERVAS_VIGENTES = "('Reservada', 'Confirmada', 'Usada')";

function anioPedido(valor) {
  const n = Number(valor);
  const actual = new Date().getFullYear();
  /* Se acota a un rango sensato: el año llega por la URL y no vale la pena
     dejar que alguien pida el año 900000 y nos haga recorrer la tabla. */
  return Number.isInteger(n) && n >= 2000 && n <= actual + 5 ? n : actual;
}

router.get('/stats', requireAdmin, async (req, res, next) => {
  const anio = anioPedido(req.query.year);

  try {
    const [
      conteos, ingresos, reservasMes, porAgente, agentes,
      porCiudad, cobertura, reservasCanceladas, eventosCancelados, anios
    ] = await Promise.all([

      /* ---- Tarjetas de arriba ---- */
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM clients WHERE active) ::int AS clientes,
          (SELECT COUNT(*) FROM agents  WHERE active) ::int AS agentes,
          (SELECT COUNT(*) FROM admins  WHERE active) ::int AS administradores,
          (SELECT COUNT(*) FROM events)               ::int AS eventos,
          (SELECT COUNT(*) FROM reservations)         ::int AS reservas,
          (SELECT COUNT(*) FROM clients
            WHERE active AND created_at >= date_trunc('month', NOW()))::int AS clientes_mes`),

      /* ---- Ingresos por mes ----
         generate_series rellena los meses sin reservas: sin eso la gráfica
         saltaría de marzo a junio y parecería que faltan datos. */
      pool.query(`
        WITH meses AS (
          SELECT generate_series(
            make_date($1::int, 1, 1),
            make_date($1::int, 12, 1),
            interval '1 month') AS mes
        )
        SELECT EXTRACT(MONTH FROM m.mes)::int AS mes,
               COALESCE(SUM(r.total_amount), 0)::float AS total
          FROM meses m
          LEFT JOIN reservations r
            ON date_trunc('month', r.created_at AT TIME ZONE 'America/Bogota') = m.mes
           AND r.status IN ${RESERVAS_VIGENTES}
         GROUP BY m.mes
         ORDER BY m.mes`, [anio]),

      /* ---- Reservas por mes (todas, incluidas las canceladas) ---- */
      pool.query(`
        WITH meses AS (
          SELECT generate_series(
            make_date($1::int, 1, 1),
            make_date($1::int, 12, 1),
            interval '1 month') AS mes
        )
        SELECT EXTRACT(MONTH FROM m.mes)::int AS mes,
               COUNT(r.id)::int AS total
          FROM meses m
          LEFT JOIN reservations r
            ON date_trunc('month', r.created_at AT TIME ZONE 'America/Bogota') = m.mes
         GROUP BY m.mes
         ORDER BY m.mes`, [anio]),

      /* ---- Ingresos por agente ----
         La maqueta decía «comisión»; el sistema no tiene comisiones, así
         que se informa lo que sí existe: lo recaudado por sus eventos. */
      pool.query(`
        SELECT a.full_name AS agente,
               COALESCE(SUM(r.total_amount), 0)::float AS total
          FROM agents a
          LEFT JOIN events e ON e.agent_id = a.id
          LEFT JOIN reservations r
            ON r.event_id = e.id
           AND r.status IN ${RESERVAS_VIGENTES}
           AND EXTRACT(YEAR FROM r.created_at AT TIME ZONE 'America/Bogota') = $1
         WHERE a.active
         GROUP BY a.id, a.full_name
         /* Sin HAVING: un agente sin ventas sale en cero, no desaparece.
            Que no aparezca es indistinguible de que no exista, y el
            administrador necesita poder ver justamente eso. */
         ORDER BY total DESC, a.full_name
         LIMIT 8`, [anio]),

      /* ---- Agentes registrados ----
         Histórico, no filtrado por año: es la nómina de quién publica y
         cuánto ha movido desde que entró. Los conteos usan DISTINCT
         porque al unir eventos con reservas cada evento se repite una vez
         por reserva. Las banderas de los catálogos deciden qué cuenta:
         occupies_seat para las entradas vendidas, allows_reservation
         para los eventos que hoy están a la venta. */
      pool.query(`
        SELECT a.full_name AS agente,
               a.email,
               a.created_at AS desde,
               a.commission_rate::float AS comision,
               a.experience_years::int   AS experiencia,
               COUNT(DISTINCT e.id)::int AS eventos,
               COUNT(DISTINCT e.id) FILTER (
                 WHERE e.status IN (SELECT code FROM event_statuses WHERE allows_reservation)
               )::int AS en_venta,
               COALESCE(SUM(r.quantity) FILTER (
                 WHERE r.status IN (SELECT code FROM reservation_statuses WHERE occupies_seat)
               ), 0)::int AS entradas,
               COALESCE(SUM(r.total_amount) FILTER (
                 WHERE r.status IN (SELECT code FROM reservation_statuses WHERE occupies_seat)
               ), 0)::float AS ingresos
          FROM agents a
          LEFT JOIN events e       ON e.agent_id = a.id
          LEFT JOIN reservations r ON r.event_id = e.id
         WHERE a.active
         GROUP BY a.id, a.full_name, a.email, a.created_at,
                  a.commission_rate, a.experience_years
         ORDER BY eventos DESC, ingresos DESC, a.full_name`),

      /* ---- Eventos por ciudad ---- */
      pool.query(`
        SELECT c.name AS ciudad, COUNT(*)::int AS total
          FROM events e
          JOIN cities c ON c.id = e.city_id
         GROUP BY c.name
         ORDER BY total DESC, c.name`),

      /* ---- Cobertura: eventos y reservas por ubicación ---- */
      pool.query(`
        SELECT co.name AS pais, d.name AS departamento, c.name AS ciudad,
               COUNT(DISTINCT e.id)::int AS eventos,
               COUNT(r.id)::int AS reservas
          FROM events e
          JOIN cities c      ON c.id = e.city_id
          JOIN departments d ON d.code = e.department_code AND d.country_code = e.country_code
          JOIN countries co  ON co.code = e.country_code
          LEFT JOIN reservations r ON r.event_id = e.id
         GROUP BY co.name, d.name, c.name
         ORDER BY eventos DESC, c.name
         LIMIT 12`),

      /* ---- Reservas canceladas y su causa ---- */
      pool.query(`
        SELECT r.code, cl.full_name AS cliente, e.name AS evento,
               r.status_updated_at AS fecha, r.cancellation_reason AS causa
          FROM reservations r
          JOIN clients cl ON cl.id = r.client_id
          JOIN events e   ON e.id = r.event_id
         WHERE r.status = 'Cancelada'
         ORDER BY r.status_updated_at DESC
         LIMIT 30`),

      /* ---- Eventos cancelados y su causa ---- */
      pool.query(`
        SELECT e.name AS evento, c.name AS ciudad,
               e.status_updated_at AS fecha, e.cancellation_reason AS causa
          FROM events e
          JOIN cities c ON c.id = e.city_id
         WHERE e.status = 'Cancelado'
         ORDER BY e.status_updated_at DESC
         LIMIT 30`),

      /* ---- Años con movimiento, para el selector ---- */
      pool.query(`
        SELECT DISTINCT EXTRACT(YEAR FROM created_at AT TIME ZONE 'America/Bogota')::int AS anio
          FROM reservations
         UNION
        SELECT DISTINCT EXTRACT(YEAR FROM starts_at AT TIME ZONE 'America/Bogota')::int
          FROM events
         ORDER BY anio DESC`)
    ]);

    const listaAnios = anios.rows.map((f) => f.anio);
    if (!listaAnios.includes(anio)) listaAnios.unshift(anio);

    return res.json({
      year: anio,
      years: listaAnios,
      counts: conteos.rows[0],
      revenueByMonth: ingresos.rows,
      reservationsByMonth: reservasMes.rows,
      revenueByAgent: porAgente.rows,
      agents: agentes.rows,
      eventsByCity: porCiudad.rows,
      coverage: cobertura.rows,
      cancelledReservations: reservasCanceladas.rows,
      cancelledEvents: eventosCancelados.rows
    });
  } catch (error) { return next(error); }
});

module.exports = router;
