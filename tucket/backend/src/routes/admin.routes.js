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
          (SELECT COUNT(*) FROM clientes WHERE activo) ::int AS clientes,
          (SELECT COUNT(*) FROM agentes  WHERE activo) ::int AS agentes,
          (SELECT COUNT(*) FROM administradores  WHERE activo) ::int AS administradores,
          (SELECT COUNT(*) FROM eventos)               ::int AS eventos,
          (SELECT COUNT(*) FROM reservas)         ::int AS reservas,
          (SELECT COUNT(*) FROM clientes
            WHERE activo AND fecha_creacion >= date_trunc('month', NOW()))::int AS clientes_mes`),

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
               COALESCE(SUM(r.valor_total), 0)::float AS total
          FROM meses m
          LEFT JOIN reservas r
            ON date_trunc('month', r.fecha_creacion AT TIME ZONE 'America/Bogota') = m.mes
           AND r.estado IN ${RESERVAS_VIGENTES}
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
          LEFT JOIN reservas r
            ON date_trunc('month', r.fecha_creacion AT TIME ZONE 'America/Bogota') = m.mes
         GROUP BY m.mes
         ORDER BY m.mes`, [anio]),

      /* ---- Ingresos por agente ----
         La maqueta decía «comisión»; el sistema no tiene comisiones, así
         que se informa lo que sí existe: lo recaudado por sus eventos. */
      pool.query(`
        SELECT a.nombre_completo AS agente,
               COALESCE(SUM(r.valor_total), 0)::float AS total
          FROM agentes a
          LEFT JOIN eventos e ON e.id_agente = a.id
          LEFT JOIN reservas r
            ON r.id_evento = e.id
           AND r.estado IN ${RESERVAS_VIGENTES}
           AND EXTRACT(YEAR FROM r.fecha_creacion AT TIME ZONE 'America/Bogota') = $1
         WHERE a.activo
         GROUP BY a.id, a.nombre_completo
         /* Sin HAVING: un agente sin ventas sale en cero, no desaparece.
            Que no aparezca es indistinguible de que no exista, y el
            administrador necesita poder ver justamente eso. */
         ORDER BY total DESC, a.nombre_completo
         LIMIT 8`, [anio]),

      /* ---- Agentes registrados ----
         Histórico, no filtrado por año: es la nómina de quién publica y
         cuánto ha movido desde que entró. Los conteos usan DISTINCT
         porque al unir eventos con reservas cada evento se repite una vez
         por reserva. Las banderas de los catálogos deciden qué cuenta:
         occupies_seat para las entradas vendidas, allows_reservation
         para los eventos que hoy están a la venta. */
      pool.query(`
        SELECT a.nombre_completo AS agente,
               a.correo AS "email",
               a.fecha_creacion AS desde,
               a.comision::float AS comision,
               a.anios_experiencia::int   AS experiencia,
               COUNT(DISTINCT e.id)::int AS eventos,
               COUNT(DISTINCT e.id) FILTER (
                 WHERE e.estado IN (SELECT codigo FROM estados_evento WHERE permite_reservar)
               )::int AS en_venta,
               COALESCE(SUM(r.cantidad) FILTER (
                 WHERE r.estado IN (SELECT codigo AS "code" FROM estados_reserva WHERE ocupa_silla)
               ), 0)::int AS entradas,
               COALESCE(SUM(r.valor_total) FILTER (
                 WHERE r.estado IN (SELECT codigo AS "code" FROM estados_reserva WHERE ocupa_silla)
               ), 0)::float AS ingresos
          FROM agentes a
          LEFT JOIN eventos e       ON e.id_agente = a.id
          LEFT JOIN reservas r ON r.id_evento = e.id
         WHERE a.activo
         GROUP BY a.id, a.nombre_completo, a.correo, a.fecha_creacion,
                  a.comision, a.anios_experiencia
         ORDER BY eventos DESC, ingresos DESC, a.nombre_completo`),

      /* ---- Eventos por ciudad ---- */
      pool.query(`
        SELECT c.nombre AS ciudad, COUNT(*)::int AS total
          FROM eventos e
          JOIN ciudades c ON c.id = e.id_ciudad
         GROUP BY c.nombre
         ORDER BY total DESC, c.nombre`),

      /* ---- Cobertura: eventos y reservas por ubicación ---- */
      pool.query(`
        SELECT co.nombre AS pais, d.nombre AS departamento, c.nombre AS ciudad,
               COUNT(DISTINCT e.id)::int AS eventos,
               COUNT(r.id)::int AS reservas
          FROM eventos e
          JOIN ciudades c      ON c.id = e.id_ciudad
          JOIN departamentos d ON d.codigo = e.codigo_departamento AND d.codigo_pais = e.codigo_pais
          JOIN paises co  ON co.codigo = e.codigo_pais
          LEFT JOIN reservas r ON r.id_evento = e.id
         GROUP BY co.nombre, d.nombre, c.nombre
         ORDER BY eventos DESC, c.nombre
         LIMIT 12`),

      /* ---- Reservas canceladas y su causa ---- */
      pool.query(`
        SELECT r.codigo AS "code", cl.nombre_completo AS cliente, e.nombre AS evento,
               r.fecha_cambio_estado AS fecha, r.motivo_cancelacion AS causa
          FROM reservas r
          JOIN clientes cl ON cl.id = r.id_cliente
          JOIN eventos e   ON e.id = r.id_evento
         WHERE r.estado = 'Cancelada'
         ORDER BY r.fecha_cambio_estado DESC
         LIMIT 30`),

      /* ---- Eventos cancelados y su causa ---- */
      pool.query(`
        SELECT e.nombre AS evento, c.nombre AS ciudad,
               e.fecha_cambio_estado AS fecha, e.motivo_cancelacion AS causa
          FROM eventos e
          JOIN ciudades c ON c.id = e.id_ciudad
         WHERE e.estado = 'Cancelado'
         ORDER BY e.fecha_cambio_estado DESC
         LIMIT 30`),

      /* ---- Años con movimiento, para el selector ---- */
      pool.query(`
        SELECT DISTINCT EXTRACT(YEAR FROM fecha_creacion AT TIME ZONE 'America/Bogota')::int AS anio
          FROM reservas
         UNION
        SELECT DISTINCT EXTRACT(YEAR FROM fecha_inicio AT TIME ZONE 'America/Bogota')::int
          FROM eventos
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
