/* Rutas de reservas: /api/reservations/*
   Toda reserva se escribe dentro de una transacción: o quedan la reserva y
   sus boletas, o no queda nada. */
const express = require('express');
const pool = require('../db');
const { requireClient } = require('../auth');

const router = express.Router();
router.use(express.json({ limit: '32kb' }));

const MAX_POR_RESERVA = 10;
/* Solo se puede reservar un evento que todavía no empieza y está abierto. */
const ESTADOS_RESERVABLES = new Set(['Programado', 'En Boletería']);

/* ------------------------------------------------------------------
   Crear una reserva
------------------------------------------------------------------ */
router.post('/', requireClient, async (req, res, next) => {
  const eventCode = String(req.body?.eventCode || '').trim().toUpperCase();
  const quantity = Number(req.body?.quantity);

  if (!eventCode) return res.status(400).json({ error: 'Indica el evento que quieres reservar.' });
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_POR_RESERVA) {
    return res.status(400).json({ error: `Puedes reservar entre 1 y ${MAX_POR_RESERVA} entradas por reserva.` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* FOR UPDATE bloquea la fila del evento: dos clientes que reservan a la
       vez se atienden uno después del otro y no pueden pasarse del cupo. */
    const evento = await client.query(
      `SELECT id, name, base_price, total_capacity, status, starts_at, ends_at
       FROM events WHERE code = $1 FOR UPDATE`,
      [eventCode]
    );
    if (!evento.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No encontramos ese evento.' });
    }
    const e = evento.rows[0];

    if (!ESTADOS_RESERVABLES.has(e.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `El evento está ${e.status} y ya no admite reservas.` });
    }
    if (new Date(e.starts_at) <= new Date()) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'El evento ya comenzó: no se pueden hacer más reservas.' });
    }

    const ocupados = await client.query(
      `SELECT COALESCE(SUM(quantity), 0)::int AS total
       FROM reservations
       WHERE event_id = $1 AND status IN ('Reservada', 'Confirmada', 'Usada')`,
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
      `INSERT INTO reservations (client_id, event_id, quantity, unit_price, total_amount)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, code, quantity, unit_price, total_amount, status, created_at`,
      [req.client.id, e.id, quantity, unitPrice, (unitPrice * quantity).toFixed(2)]
    );
    const nueva = reserva.rows[0];

    /* Una boleta por entrada, numeradas RES-00842-01, -02, … */
    const seriales = Array.from({ length: quantity }, (_, i) => `${nueva.code}-${String(i + 1).padStart(2, '0')}`);
    await client.query(
      `INSERT INTO tickets (reservation_id, serial)
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

/* ------------------------------------------------------------------
   Mis reservas
------------------------------------------------------------------ */
router.get('/mine', requireClient, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT r.code, r.quantity, r.unit_price, r.total_amount, r.status,
              r.created_at, r.cancellation_reason,
              e.code AS event_code, e.name AS event_name, e.venue, e.starts_at,
              e.image_path, e.image_alt,
              ci.name AS city,
              (SELECT COUNT(*) FROM tickets t WHERE t.reservation_id = r.id)::int AS ticket_count
       FROM reservations r
       JOIN events e ON e.id = r.event_id
       JOIN cities ci ON ci.id = e.city_id
       WHERE r.client_id = $1
       ORDER BY r.created_at DESC`,
      [req.client.id]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

/* ------------------------------------------------------------------
   Detalle con las boletas
------------------------------------------------------------------ */
router.get('/:code', requireClient, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();
    const reserva = await pool.query(
      `SELECT r.id, r.code, r.quantity, r.unit_price, r.total_amount, r.status, r.created_at,
              e.code AS event_code, e.name AS event_name, e.venue, e.starts_at,
              e.image_path, e.image_alt
       FROM reservations r
       JOIN events e ON e.id = r.event_id
       WHERE r.code = $1 AND r.client_id = $2`,
      [code, req.client.id]
    );
    if (!reserva.rowCount) return res.status(404).json({ error: 'No encontramos esa reserva.' });

    const boletas = await pool.query(
      'SELECT serial, holder_name, seat_label, used_at FROM tickets WHERE reservation_id = $1 ORDER BY serial',
      [reserva.rows[0].id]
    );
    return res.json({ ...reserva.rows[0], tickets: boletas.rows });
  } catch (error) { return next(error); }
});

/* ------------------------------------------------------------------
   Cancelar una reserva (el cupo vuelve al evento)
------------------------------------------------------------------ */
router.patch('/:code/cancel', requireClient, async (req, res, next) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const crudo = req.body?.reason;
  const motivo = crudo === undefined || crudo === null ? null : String(crudo).trim().slice(0, 500) || null;

  try {
    const actual = await pool.query(
      `SELECT r.id, r.status, e.starts_at
       FROM reservations r JOIN events e ON e.id = r.event_id
       WHERE r.code = $1 AND r.client_id = $2`,
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
      `UPDATE reservations SET status = 'Cancelada', cancellation_reason = $1
        WHERE id = $2 RETURNING code, status, status_updated_at`,
      [motivo, id]
    );
    return res.json({ message: 'Reserva cancelada. El cupo volvió a quedar disponible.', reservation: result.rows[0] });
  } catch (error) { return next(error); }
});

module.exports = router;
