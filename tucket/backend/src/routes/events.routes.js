/* Rutas de eventos: /api/events/*
   Incluye el afiche del evento (se recibe en base64 dentro del JSON). */
const express = require('express');
const pool = require('../db');
const { requireAgent } = require('../auth');
const { guardarAfiche, borrarAfiche, normalizarAlt, ImagenInvalida } = require('../images');

const router = express.Router();

/* El cuerpo puede traer una imagen de hasta 4 MB; en base64 ocupa ~4/3 más,
   más el resto del formulario. 7 MB deja margen suficiente. */
router.use(express.json({ limit: '7mb' }));

/* Estados admitidos al CREAR un evento */
const estadosIniciales = new Set(['Programado', 'En Boletería']);
/* Estados admitidos al ACTUALIZAR: el ciclo de vida completo */
const estadosCicloVida = new Set(['Programado', 'En Boletería', 'En Vivo', 'Finalizado', 'Cancelado']);
/* Una vez aquí, el evento no cambia más */
const estadosFinales = new Set(['Finalizado', 'Cancelado']);

/* El estado que se muestra se calcula con la hora del servidor: un evento
   cuya fecha ya pasó aparece Finalizado aunque nadie lo haya tocado. */
const ESTADO_CALCULADO = `
  CASE
    WHEN e.status IN ('Cancelado', 'Finalizado') THEN e.status
    WHEN e.ends_at   <= NOW() THEN 'Finalizado'
    WHEN e.starts_at <= NOW() THEN 'En Vivo'
    ELSE e.status
  END`;

/* ------------------------------------------------------------------
   Catálogo público
------------------------------------------------------------------ */
router.get('/', async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT e.code, e.name, e.description, e.venue, e.starts_at, e.ends_at,
              e.total_capacity, e.base_price, e.observations,
              e.image_path, e.image_alt,
              ${ESTADO_CALCULADO} AS status,
              a.available_seats,
              ci.name AS city, d.name AS department, co.name AS country
       FROM events e
       JOIN cities ci ON ci.id = e.city_id
       JOIN departments d ON d.code = e.department_code AND d.country_code = e.country_code
       JOIN countries co ON co.code = e.country_code
       LEFT JOIN event_availability a ON a.event_id = e.id
       ORDER BY CASE WHEN e.ends_at <= NOW() THEN 1 ELSE 0 END, e.starts_at ASC`
    );
    return res.json({ serverTime: new Date().toISOString(), events: result.rows });
  } catch (error) { return next(error); }
});

/* ------------------------------------------------------------------
   Eventos del agente autenticado
------------------------------------------------------------------ */
router.get('/mine', requireAgent, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT e.code, e.name, e.description, e.venue, e.starts_at, e.ends_at,
              e.total_capacity, e.base_price, e.observations, e.status,
              e.image_path, e.image_alt,
              e.cancellation_reason, e.status_updated_at,
              a.reserved_seats, a.available_seats,
              ci.name AS city, d.name AS department, co.name AS country
       FROM events e
       JOIN cities ci ON ci.id = e.city_id
       JOIN departments d ON d.code = e.department_code AND d.country_code = e.country_code
       JOIN countries co ON co.code = e.country_code
       LEFT JOIN event_availability a ON a.event_id = e.id
       WHERE e.agent_id = $1
       ORDER BY e.created_at DESC`,
      [req.agent.id]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

/* ------------------------------------------------------------------
   Detalle de un evento
------------------------------------------------------------------ */
router.get('/:code', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT e.code, e.name, e.description, e.venue, e.starts_at, e.ends_at,
              e.total_capacity, e.base_price, e.observations,
              e.image_path, e.image_alt,
              ${ESTADO_CALCULADO} AS status,
              a.available_seats,
              ci.name AS city, d.name AS department, co.name AS country
       FROM events e
       JOIN cities ci ON ci.id = e.city_id
       JOIN departments d ON d.code = e.department_code AND d.country_code = e.country_code
       JOIN countries co ON co.code = e.country_code
       LEFT JOIN event_availability a ON a.event_id = e.id
       WHERE e.code = $1`,
      [String(req.params.code).trim().toUpperCase()]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'No encontramos ese evento.' });
    return res.json(result.rows[0]);
  } catch (error) { return next(error); }
});

/* ------------------------------------------------------------------
   Crear evento (con afiche opcional)
------------------------------------------------------------------ */
router.post('/', requireAgent, async (req, res, next) => {
  const body = req.body || {};
  const code = String(body.code || '').trim().toUpperCase();
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const venue = String(body.venue || '').trim();
  const observations = String(body.observations || '').trim();
  const countryCode = String(body.countryCode || '').trim().toUpperCase();
  const departmentCode = String(body.departmentCode || '').trim().toUpperCase();
  const cityId = Number(body.cityId);
  const totalCapacity = Number(body.totalCapacity);
  const basePrice = Number(body.basePrice);
  const startsAt = new Date(body.startsAt);
  const endsAt = new Date(body.endsAt);
  const status = String(body.status || 'Programado').trim();

  if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code)) {
    return res.status(400).json({ error: 'El código debe tener entre 3 y 32 caracteres: letras, números, guion o guion bajo.' });
  }
  if (!name || name.length > 160 || !description || description.length > 5000 || !venue || venue.length > 180 || !observations || observations.length > 3000) {
    return res.status(400).json({ error: 'Completa nombre, descripción, teatro y observaciones respetando los límites indicados.' });
  }
  if (!countryCode || !departmentCode || !Number.isInteger(cityId) || cityId <= 0) {
    return res.status(400).json({ error: 'Selecciona país, departamento y ciudad válidos.' });
  }
  if (!Number.isInteger(totalCapacity) || totalCapacity < 1 || !Number.isFinite(basePrice) || basePrice < 0) {
    return res.status(400).json({ error: 'La capacidad debe ser un entero mayor que cero y el precio no puede ser negativo.' });
  }
  const tieneZonaHoraria = (valor) => typeof valor === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(valor);
  if (!tieneZonaHoraria(body.startsAt) || !tieneZonaHoraria(body.endsAt) ||
      !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
    return res.status(400).json({ error: 'La fecha y hora de finalización debe ser posterior al inicio.' });
  }
  if (!estadosIniciales.has(status)) {
    return res.status(400).json({ error: 'El estado inicial debe ser Programado o En Boletería.' });
  }

  /* El afiche es opcional. Se guarda ANTES del INSERT porque la ruta del
     archivo es uno de los campos; si el INSERT falla, se borra el archivo
     para no dejar basura en disco. */
  let imagePath = null;
  let imageAlt = null;
  if (body.image?.data) {
    try {
      imagePath = guardarAfiche(body.image.data, code).rutaPublica;
      imageAlt = normalizarAlt(body.image.alt, name);
    } catch (error) {
      if (error instanceof ImagenInvalida) return res.status(400).json({ error: error.message });
      return next(error);
    }
  }

  try {
    /* La ciudad debe pertenecer al departamento y país elegidos.
       Se comprueba en una consulta aparte y no dentro del INSERT: al
       reutilizar los mismos parámetros en un `INSERT ... SELECT ... WHERE
       EXISTS`, PostgreSQL tenía que deducir su tipo en dos contextos a la
       vez (text en la lista del SELECT, varchar en la comparación) y
       rechazaba la consulta entera. */
    const ubicacion = await pool.query(
      `SELECT 1
         FROM cities c
         JOIN departments d ON d.code = c.department_code AND d.country_code = c.country_code
        WHERE c.id = $1 AND d.code = $2 AND d.country_code = $3`,
      [cityId, departmentCode, countryCode]
    );
    if (!ubicacion.rowCount) {
      borrarAfiche(imagePath);
      return res.status(400).json({ error: 'La ciudad no corresponde al departamento y país elegidos. Vuelve a seleccionar la ubicación.' });
    }

    const result = await pool.query(
      `INSERT INTO events
        (code, name, description, venue, starts_at, ends_at, total_capacity,
         base_price, observations, status, country_code, department_code, city_id, agent_id,
         image_path, image_alt)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id, code, name, status, image_path, image_alt, created_at`,
      [code, name, description, venue, startsAt.toISOString(), endsAt.toISOString(),
        totalCapacity, basePrice, observations, status, countryCode, departmentCode, cityId,
        req.agent.id, imagePath, imageAlt]
    );
    return res.status(201).json({ message: 'Evento registrado correctamente.', event: result.rows[0] });
  } catch (error) {
    borrarAfiche(imagePath);
    if (error.code === '23505' && error.constraint === 'events_code_key') {
      return res.status(409).json({ error: 'Ese código ya está registrado. Usa un código único.' });
    }
    return next(error);
  }
});

/* ------------------------------------------------------------------
   Cambiar o quitar el afiche de un evento ya creado
------------------------------------------------------------------ */
router.put('/:code/image', requireAgent, async (req, res, next) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const body = req.body || {};

  try {
    const actual = await pool.query(
      'SELECT id, name, image_path FROM events WHERE code = $1 AND agent_id = $2',
      [code, req.agent.id]
    );
    if (!actual.rowCount) return res.status(404).json({ error: 'No encontramos ese evento entre los tuyos.' });
    const anterior = actual.rows[0].image_path;

    /* Sin datos = quitar el afiche. */
    if (!body.data) {
      await pool.query('UPDATE events SET image_path = NULL, image_alt = NULL WHERE id = $1', [actual.rows[0].id]);
      borrarAfiche(anterior);
      return res.json({ message: 'Afiche eliminado.', event: { code, image_path: null, image_alt: null } });
    }

    let guardado;
    try {
      guardado = guardarAfiche(body.data, code);
    } catch (error) {
      if (error instanceof ImagenInvalida) return res.status(400).json({ error: error.message });
      throw error;
    }
    const alt = normalizarAlt(body.alt, actual.rows[0].name);

    const result = await pool.query(
      'UPDATE events SET image_path = $1, image_alt = $2 WHERE id = $3 RETURNING code, image_path, image_alt',
      [guardado.rutaPublica, alt, actual.rows[0].id]
    );
    /* Recién cuando la base confirma se borra el afiche viejo. */
    if (anterior && anterior !== guardado.rutaPublica) borrarAfiche(anterior);

    return res.json({ message: 'Afiche actualizado.', event: result.rows[0] });
  } catch (error) { return next(error); }
});

/* ------------------------------------------------------------------
   Ciclo de vida del espectáculo.
   Estados finales no admiten más cambios, y cancelar exige el motivo.
------------------------------------------------------------------ */
router.patch('/:code/status', requireAgent, async (req, res, next) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const status = String((req.body || {}).status || '').trim();
  const crudo = (req.body || {}).cancellationReason;
  const motivo = crudo === undefined || crudo === null ? '' : String(crudo).trim();

  if (!estadosCicloVida.has(status)) {
    return res.status(400).json({ error: 'Estado no válido. Usa Programado, En Boletería, En Vivo, Finalizado o Cancelado.' });
  }
  if (status === 'Cancelado' && (motivo.length < 10 || motivo.length > 500)) {
    return res.status(400).json({ error: 'Para cancelar debes registrar la causa, entre 10 y 500 caracteres.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const actual = await client.query(
      'SELECT id, status FROM events WHERE code = $1 AND agent_id = $2 FOR UPDATE',
      [code, req.agent.id]
    );
    if (!actual.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No encontramos ese evento entre los tuyos.' });
    }
    const anterior = actual.rows[0].status;
    if (estadosFinales.has(anterior)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `El evento ya está ${anterior} y no admite más cambios de estado.` });
    }
    if (anterior === status) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `El evento ya está en estado ${status}.` });
    }

    /* El motivo se decide en JavaScript y no con un CASE dentro del SQL:
       comparar el parámetro contra un literal obligaba a PostgreSQL a
       deducir dos tipos distintos para el mismo parámetro. */
    const result = await client.query(
      `UPDATE events
          SET status = $1,
              cancellation_reason = $2,
              status_updated_at = NOW()
        WHERE id = $3
      RETURNING code, status, cancellation_reason, status_updated_at`,
      [status, status === 'Cancelado' ? motivo : null, actual.rows[0].id]
    );

    /* Cancelar el evento cancela las reservas vigentes: si no, quedarían
       boletas activas de algo que no va a ocurrir. */
    let reservasCanceladas = 0;
    if (status === 'Cancelado') {
      const cascada = await client.query(
        `UPDATE reservations
            SET status = 'Cancelada', cancellation_reason = $1
          WHERE event_id = $2 AND status IN ('Reservada', 'Confirmada')`,
        [`Evento cancelado: ${motivo}`.slice(0, 500), actual.rows[0].id]
      );
      reservasCanceladas = cascada.rowCount;
    }

    await client.query('COMMIT');
    return res.json({
      message: status === 'Cancelado'
        ? `Evento cancelado. La causa quedó registrada${reservasCanceladas ? ` y se cancelaron ${reservasCanceladas} reservas` : ''}.`
        : `Estado actualizado a ${status}.`,
      event: result.rows[0],
      cancelledReservations: reservasCanceladas
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
});

/* ------------------------------------------------------------------
   Reservas de un evento del agente (para el panel de reservas)
------------------------------------------------------------------ */
router.get('/:code/reservations', requireAgent, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT r.code, r.quantity, r.unit_price, r.total_amount, r.status, r.created_at,
              c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone
       FROM reservations r
       JOIN events e ON e.id = r.event_id
       JOIN clients c ON c.id = r.client_id
       WHERE e.code = $1 AND e.agent_id = $2
       ORDER BY r.created_at DESC`,
      [String(req.params.code).trim().toUpperCase(), req.agent.id]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

module.exports = router;
