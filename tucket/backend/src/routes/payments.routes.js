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
      `SELECT codigo AS "code", etiqueta AS "label", requiere_tarjeta AS "needsCard", inmediato AS "instant"
         FROM metodos_pago
        WHERE activo
        ORDER BY orden`
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
      `SELECT codigo AS "code", etiqueta AS "label", requiere_tarjeta AS "needs_card", inmediato AS "instant"
         FROM metodos_pago WHERE codigo = $1 AND activo`, [method]
    );
    if (!metodo.rowCount) {
      await conexion.query('ROLLBACK');
      return res.status(400).json({ error: 'Ese método de pago no está disponible.' });
    }
    const { needs_card: necesitaTarjeta, instant: inmediato } = metodo.rows[0];

    /* La reserva tiene que ser del cliente de la sesión. FOR UPDATE evita
       que dos pestañas abiertas paguen la misma reserva a la vez. */
    const reserva = await conexion.query(
      `SELECT r.id, r.codigo AS "code", r.estado AS "status", r.valor_total AS "total_amount"
         FROM reservas r
        WHERE r.codigo = $1 AND r.id_cliente = $2
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
      `SELECT ocupa_silla AS "occupies_seat" FROM estados_reserva WHERE codigo = $1`, [estadoReserva]
    );
    if (!ocupa.rowCount || !ocupa.rows[0].occupies_seat) {
      await conexion.query('ROLLBACK');
      return res.status(409).json({ error: `La reserva está ${estadoReserva.toLowerCase()} y no admite pagos.` });
    }

    const yaPagada = await conexion.query(
      `SELECT codigo AS "code" FROM pagos WHERE id_reserva = $1 AND estado = 'Aprobado'`, [reservaId]
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
      `INSERT INTO pagos
         (id_reserva, codigo_metodo, estado, monto, referencia,
          ultimos4_tarjeta, marca_tarjeta, motivo_rechazo, fecha_pago)
       /* El molde ::varchar es necesario: $3 se usa como valor de la
          columna y dentro de una comparación, y sin él PostgreSQL deduce
          dos tipos distintos para el mismo parámetro y rechaza la
          consulta (42P08). */
       VALUES ($1, $2, $3::varchar, $4, $5, $6, $7, $8,
               CASE WHEN $3::varchar = 'Aprobado' THEN NOW() ELSE NULL END)
       RETURNING codigo AS "code", estado AS "status", monto AS "amount", referencia AS "reference", fecha_creacion AS "created_at"`,
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
      `SELECT p.codigo AS "code", p.estado AS "status", p.monto AS "amount", p.referencia AS "reference", p.ultimos4_tarjeta AS "card_last4", p.marca_tarjeta AS "card_brand",
              p.motivo_rechazo AS "decline_reason", p.fecha_pago AS "paid_at", p.fecha_creacion AS "created_at",
              pm.etiqueta AS method,
              ps.etiqueta AS estado_etiqueta, ps.clase_insignia AS "badge_class",
              r.codigo AS reservation, r.cantidad AS "quantity", r.precio_unitario AS "unit_price", r.id_cliente AS "client_id",
              e.codigo AS codigo_evento, e.nombre AS event_nombre, e.teatro AS "venue",
              e.fecha_inicio AS "starts_at", c.nombre AS city,
              cl.nombre_completo AS client_nombre, cl.numero_documento AS "document_number"
         FROM pagos p
         JOIN metodos_pago  pm ON pm.codigo = p.codigo_metodo
         JOIN estados_pago ps ON ps.codigo = p.estado
         JOIN reservas r ON r.id = p.id_reserva
         JOIN eventos e       ON e.id = r.id_evento
         JOIN ciudades c       ON c.id = e.id_ciudad
         JOIN clientes cl     ON cl.id = r.id_cliente
        WHERE p.codigo = $1`, [code]
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
