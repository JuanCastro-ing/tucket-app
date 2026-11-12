/* Rutas de reservas: /api/reservations/*
   Toda reserva se escribe dentro de una transacción: o quedan la reserva y
   sus boletas, o no queda nada. */
const express = require('express');
const pool = require('../db');
const { requireClient } = require('../auth');

const router = express.Router();
router.use(express.json({ limit: '32kb' }));

const MAX_POR_RESERVA = 10;
/* En qué estados se admite reservar lo dice la columna allows_reservation
   del catálogo, no una lista escrita aquí. */
const { cargar: estadosDelSistema } = require('../estados');

/* Crear una reserva */
router.post('/', requireClient, async (req, res, next) => {
  const eventCode = String(req.body?.eventCode || '').trim().toUpperCase();
  const quantity = Number(req.body?.quantity);

  /* Peticiones del cliente: silla de ruedas, acceso preferencial… Son
     opcionales, pero si vienen hay que guardarlas: el agente las necesita
     para preparar la sala. */
  const observations = String(req.body?.observations || '').trim();

  if (!eventCode) return res.status(400).json({ error: 'Indica el evento que quieres reservar.' });
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_POR_RESERVA) {
    return res.status(400).json({ error: `Puedes reservar entre 1 y ${MAX_POR_RESERVA} entradas por reserva.` });
  }
  if (observations.length > 500) {
    return res.status(400).json({ error: 'Las observaciones no pueden superar los 500 caracteres.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* FOR UPDATE bloquea la fila del evento: dos clientes que reservan a la
       vez se atienden uno después del otro y no pueden pasarse del cupo. */
    const evento = await client.query(
      `SELECT id, nombre AS "name", precio_base AS "base_price", capacidad_total AS "total_capacity", estado AS "status", fecha_inicio AS "starts_at", fecha_fin AS "ends_at"
       FROM eventos WHERE codigo = $1 FOR UPDATE`,
      [eventCode]
    );
    if (!evento.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No encontramos ese evento.' });
    }
    const e = evento.rows[0];

    if (!(await estadosDelSistema()).eventosReservables.has(e.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `El evento está ${e.status} y ya no admite reservas.` });
    }
    if (new Date(e.starts_at) <= new Date()) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'El evento ya comenzó: no se pueden hacer más reservas.' });
    }

    const ocupados = await client.query(
      `SELECT COALESCE(SUM(cantidad), 0)::int AS total
       FROM reservas
       WHERE id_evento = $1 AND estado IN ('Reservada', 'Confirmada', 'Usada')`,
      [e.id]
    );
    const disponibles = e.total_capacity - ocupados.rows[0].total;
    if (quantity > disponibles) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: disponibles > 0
          ? `Solo quedan ${disponibles} entradas disponibles.`
          : 'El evento está agotado.'
      });
    }

    const unitPrice = Number(e.base_price);
    const reserva = await client.query(
      `INSERT INTO reservas (id_cliente, id_evento, cantidad, precio_unitario, valor_total, observaciones)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, codigo AS "code", cantidad AS "quantity", precio_unitario AS "unit_price", valor_total AS "total_amount", estado AS "status", observaciones AS "observations", fecha_creacion AS "created_at"`,
      [req.client.id, e.id, quantity, unitPrice, (unitPrice * quantity).toFixed(2), observations || null]
    );
    const nueva = reserva.rows[0];

    /* Una boleta por entrada, numeradas RES-00842-01, -02, … */
    const seriales = Array.from({ length: quantity }, (_, i) => `${nueva.code}-${String(i + 1).padStart(2, '0')}`);
    await client.query(
      `INSERT INTO boletas (id_reserva, serial)
       SELECT $1, s FROM unnest($2::text[]) AS s`,
      [nueva.id, seriales]
    );

    await client.query('COMMIT');
    return res.status(201).json({
      message: `Reserva ${nueva.code} creada para ${e.name}.`,
      reservation: { ...nueva, event_code: eventCode, event_name: e.name, tickets: seriales }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    /* El trigger de capacidad es la última línea de defensa. */
    if (error.code === '23514' || /Sin cupo/.test(error.message || '')) {
      return res.status(409).json({ error: 'No hay cupo suficiente para esa cantidad de entradas.' });
    }
    return next(error);
  } finally {
    client.release();
  }
});

/* Mis reservas */
router.get('/mine', requireClient, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT r.codigo AS "code", r.cantidad AS "quantity", r.precio_unitario AS "unit_price", r.valor_total AS "total_amount", r.estado AS "status",
              r.fecha_creacion AS "created_at", r.motivo_cancelacion AS "cancellation_reason", r.observaciones AS "observations",
              e.codigo AS codigo_evento, e.nombre AS event_nombre, e.teatro AS "venue", e.fecha_inicio AS "starts_at",
              e.ruta_imagen AS "image_path", e.texto_imagen AS "image_alt",
              ci.nombre AS city,
              (SELECT COUNT(*) FROM boletas t WHERE t.id_reserva = r.id)::int AS ticket_count
       FROM reservas r
       JOIN eventos e ON e.id = r.id_evento
       JOIN ciudades ci ON ci.id = e.id_ciudad
       WHERE r.id_cliente = $1
       ORDER BY r.fecha_creacion DESC`,
      [req.client.id]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

/* Detalle con las boletas */
router.get('/:code', requireClient, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();
    const reserva = await pool.query(
      `SELECT r.id, r.codigo AS "code", r.cantidad AS "quantity", r.precio_unitario AS "unit_price", r.valor_total AS "total_amount", r.estado AS "status", r.fecha_creacion AS "created_at", r.observaciones AS "observations",
              e.codigo AS codigo_evento, e.nombre AS event_nombre, e.teatro AS "venue", e.fecha_inicio AS "starts_at",
              e.ruta_imagen AS "image_path", e.texto_imagen AS "image_alt", c.nombre AS city
       FROM reservas r
       JOIN eventos e ON e.id = r.id_evento
       JOIN ciudades c ON c.id = e.id_ciudad
       WHERE r.codigo = $1 AND r.id_cliente = $2`,
      [code, req.client.id]
    );
    if (!reserva.rowCount) return res.status(404).json({ error: 'No encontramos esa reserva.' });

    const boletas = await pool.query(
      'SELECT serial, nombre_titular AS "holder_name", silla AS "seat_label", fecha_uso AS "used_at" FROM boletas WHERE id_reserva = $1 ORDER BY serial',
      [reserva.rows[0].id]
    );
    return res.json({ ...reserva.rows[0], tickets: boletas.rows });
  } catch (error) { return next(error); }
});

/* Cancelar una reserva (el cupo vuelve al evento) */
router.patch('/:code/cancel', requireClient, async (req, res, next) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const crudo = req.body?.reason;
  const motivo = crudo === undefined || crudo === null ? null : String(crudo).trim().slice(0, 500) || null;

  try {
    const actual = await pool.query(
      `SELECT r.id, r.estado AS "status", e.fecha_inicio AS "starts_at"
       FROM reservas r JOIN eventos e ON e.id = r.id_evento
       WHERE r.codigo = $1 AND r.id_cliente = $2`,
      [code, req.client.id]
    );
    if (!actual.rowCount) return res.status(404).json({ error: 'No encontramos esa reserva.' });

    const { id, status, starts_at: inicio } = actual.rows[0];
    if (status === 'Cancelada') return res.status(409).json({ error: 'Esa reserva ya estaba cancelada.' });
    if (status === 'Usada') return res.status(409).json({ error: 'Esa reserva ya se usó y no se puede cancelar.' });
    if (new Date(inicio) <= new Date()) {
      return res.status(409).json({ error: 'El evento ya comenzó: la reserva no se puede cancelar.' });
    }

    const result = await pool.query(
      `UPDATE reservas SET estado = 'Cancelada', motivo_cancelacion = $1
        WHERE id = $2 RETURNING codigo AS "code", estado AS "status", fecha_cambio_estado AS "status_updated_at"`,
      [motivo, id]
    );
    return res.json({ message: 'Reserva cancelada. El cupo volvió a quedar disponible.', reservation: result.rows[0] });
  } catch (error) { return next(error); }
});

module.exports = router;
