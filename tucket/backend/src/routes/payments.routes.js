/* Rutas de pagos: /api/payments/*

   SIMULACIÓN: ver src/pagos.js. No se mueve dinero y no se almacena
   ningún dato de tarjeta aparte de los cuatro últimos dígitos.

   El pago lo registra el cliente dueño de la reserva. La confirmación de
   la reserva no se hace aquí: la dispara la base cuando el pago queda
   aprobado (disparador payments_confirm_reservation_trg), de modo que no
   pueda quedar un pago aprobado con la reserva sin confirmar. */
const express = require('express');
const pool = require('../db');
const { requireClient, requireSession } = require('../auth');
const { procesarTarjeta, referenciaNueva } = require('../pagos');

const router = express.Router();
router.use(express.json({ limit: '32kb' }));

/* ---------- Catálogo de métodos ---------- */
router.get('/methods', async (_req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT code, label, needs_card AS "needsCard", instant
         FROM payment_methods
        WHERE active
        ORDER BY display_order`
    );
    res.set('Cache-Control', 'public, max-age=300');
    return res.json({ methods: r.rows });
  } catch (error) { return next(error); }
});

/* ---------- Pagar una reserva ---------- */
router.post('/', requireClient, async (req, res, next) => {
  const reservationCode = String(req.body?.reservationCode || '').trim().toUpperCase();
  const method = String(req.body?.method || '').trim();

  if (!reservationCode) return res.status(400).json({ error: 'Indica la reserva que vas a pagar.' });
  if (!method) return res.status(400).json({ error: 'Elige un método de pago.' });

  const conexion = await pool.connect();
  try {
    await conexion.query('BEGIN');

    /* El método tiene que existir y estar activo; sus reglas salen del
       catálogo, no de una lista escrita aquí. */
    const metodo = await conexion.query(
      `SELECT code, label, needs_card, instant
         FROM payment_methods WHERE code = $1 AND active`, [method]
    );
    if (!metodo.rowCount) {
      await conexion.query('ROLLBACK');
      return res.status(400).json({ error: 'Ese método de pago no está disponible.' });
    }
    const { needs_card: necesitaTarjeta, instant: inmediato } = metodo.rows[0];

    /* La reserva tiene que ser del cliente de la sesión. FOR UPDATE evita
       que dos pestañas abiertas paguen la misma reserva a la vez. */
    const reserva = await conexion.query(
      `SELECT r.id, r.code, r.status, r.total_amount
         FROM reservations r
        WHERE r.code = $1 AND r.client_id = $2
        FOR UPDATE`,
      [reservationCode, req.client.id]
    );
    if (!reserva.rowCount) {
      await conexion.query('ROLLBACK');
      /* Mismo mensaje exista o no la reserva: si fuera distinto, cualquiera
         podría averiguar qué códigos existen probando uno por uno. */
      return res.status(404).json({ error: 'No encontramos esa reserva entre las tuyas.' });
    }
    const { id: reservaId, status: estadoReserva, total_amount: total } = reserva.rows[0];

    const ocupa = await conexion.query(
      `SELECT occupies_seat FROM reservation_statuses WHERE code = $1`, [estadoReserva]
    );
    if (!ocupa.rowCount || !ocupa.rows[0].occupies_seat) {
      await conexion.query('ROLLBACK');
      return res.status(409).json({ error: `La reserva está ${estadoReserva.toLowerCase()} y no admite pagos.` });
    }

    const yaPagada = await conexion.query(
      `SELECT code FROM payments WHERE reservation_id = $1 AND status = 'Aprobado'`, [reservaId]
    );
    if (yaPagada.rowCount) {
      await conexion.query('ROLLBACK');
      return res.status(409).json({
        error: 'Esa reserva ya está pagada.',
        payment: yaPagada.rows[0].code
      });
    }

    /* ----- Resultado del intento ----- */
    let estado = 'Pendiente';
    let motivo = null;
    let marca = null;
    let ultimos4 = null;
    let referencia = referenciaNueva();

    if (necesitaTarjeta) {
      const intento = procesarTarjeta({
        numero: req.body?.cardNumber,
        vencimiento: req.body?.cardExpiry,
        cvv: req.body?.cardCvv,
        titular: req.body?.cardHolder
      });
      if (!intento.ok) {
        await conexion.query('ROLLBACK');
        return res.status(400).json({ error: intento.error });
      }
      estado = intento.estado;
      motivo = intento.motivo;
      marca = intento.marca;
      ultimos4 = intento.ultimos4;
      referencia = intento.referencia;
    } else if (inmediato) {
      /* PSE: en una integración real aquí se redirige al banco. En la
         simulación se aprueba al instante. */
      estado = 'Aprobado';
    }
    /* Taquilla no es inmediato: el pago queda Pendiente hasta que el
       agente lo confirme, que es como funcionaba Tucket antes. */

    const pago = await conexion.query(
      `INSERT INTO payments
         (reservation_id, method_code, status, amount, reference,
          card_last4, card_brand, decline_reason, paid_at)
       /* El molde ::varchar es necesario: $3 se usa como valor de la
          columna y dentro de una comparación, y sin él PostgreSQL deduce
          dos tipos distintos para el mismo parámetro y rechaza la
          consulta (42P08). */
       VALUES ($1, $2, $3::varchar, $4, $5, $6, $7, $8,
               CASE WHEN $3::varchar = 'Aprobado' THEN NOW() ELSE NULL END)
       RETURNING code, status, amount, reference, created_at`,
      [reservaId, method, estado, total, referencia, ultimos4, marca, motivo]
    );

    await conexion.query('COMMIT');

    const fila = pago.rows[0];
    /* Un rechazo no es un error del sistema: la petición se atendió bien y
       el resultado es que el banco dijo que no. Por eso 201 y no 4xx. */
    return res.status(201).json({
      payment: {
        code: fila.code,
        status: fila.status,
        amount: Number(fila.amount),
        reference: fila.reference,
        reservation: reservationCode,
        declineReason: motivo,
        createdAt: fila.created_at
      }
    });
  } catch (error) {
    await conexion.query('ROLLBACK').catch(() => {});
    /* Los disparadores de la base hablan en español y con mensajes
       pensados para el usuario: se devuelven tal cual. */
    if (error.code === '23514' || error.code === '23503') {
      return res.status(409).json({ error: error.message.replace(/^.*?:\s*/, '') });
    }
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Esa reserva ya está pagada.' });
    }
    return next(error);
  } finally {
    conexion.release();
  }
});

/* ---------- Comprobante ---------- */
router.get('/:code', requireSession, async (req, res, next) => {
  const code = String(req.params.code || '').trim().toUpperCase();

  try {
    const r = await pool.query(
      `SELECT p.code, p.status, p.amount, p.reference, p.card_last4, p.card_brand,
              p.decline_reason, p.paid_at, p.created_at,
              pm.label AS method,
              ps.label AS status_label, ps.badge_class,
              r.code AS reservation, r.quantity, r.unit_price, r.client_id,
              e.code AS event_code, e.name AS event_name, e.venue,
              e.starts_at, c.name AS city,
              cl.full_name AS client_name, cl.document_number
         FROM payments p
         JOIN payment_methods  pm ON pm.code = p.method_code
         JOIN payment_statuses ps ON ps.code = p.status
         JOIN reservations r ON r.id = p.reservation_id
         JOIN events e       ON e.id = r.event_id
         JOIN cities c       ON c.id = e.city_id
         JOIN clients cl     ON cl.id = r.client_id
        WHERE p.code = $1`, [code]
    );

    if (!r.rowCount) return res.status(404).json({ error: 'No encontramos ese comprobante.' });
    const p = r.rows[0];

    /* El comprobante lleva datos personales, así que lo ve su dueño o un
       administrador. Un agente no: le basta el estado de la reserva. */
    /* client_id es BIGINT y el driver lo entrega como texto, así que hay
       que convertirlo: comparar 2 con "2" con === siempre da falso. */
    const esDueno = req.user.role === 'cliente' && Number(p.client_id) === Number(req.user.id);
    if (!esDueno && req.user.role !== 'administrador') {
      return res.status(403).json({ error: 'Ese comprobante no es tuyo.' });
    }

    return res.json({
      payment: {
        code: p.code,
        status: p.status,
        statusLabel: p.status_label,
        badgeClass: p.badge_class,
        amount: Number(p.amount),
        reference: p.reference,
        method: p.method,
        cardBrand: p.card_brand,
        cardLast4: p.card_last4,
        declineReason: p.decline_reason,
        paidAt: p.paid_at,
        createdAt: p.created_at
      },
      reservation: {
        code: p.reservation,
        quantity: p.quantity,
        unitPrice: Number(p.unit_price)
      },
      event: {
        code: p.event_code,
        name: p.event_name,
        venue: p.venue,
        city: p.city,
        startsAt: p.starts_at
      },
      client: {
        name: p.client_name,
        document: p.document_number
      }
    });
  } catch (error) { return next(error); }
});

module.exports = router;
