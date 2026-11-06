/* Rutas de eventos: /api/events/*
   Incluye el afiche del evento (se recibe en base64 dentro del JSON). */
const express = require('express');
const pool = require('../db');
const { requireAgent } = require('../auth');
const { guardarAfiche, borrarAfiche, normalizarAlt, ImagenInvalida, ErrorDeAlmacenamiento } = require('../images');
const { cargar: estadosDelSistema } = require('../estados');

/* Las dos cosas que pueden salir mal al guardar una imagen y que no son
   un fallo del sistema: que el archivo no sirva (culpa de quien lo sube)
   o que el servicio de imágenes no responda (culpa de la red). Las dos
   se le explican al agente en vez de devolver un 500 sin más. */
function respuestaDeImagen(res, error, prefijo) {
  if (error instanceof ImagenInvalida) {
    return res.status(400).json({ error: prefijo + error.message });
  }
  if (error instanceof ErrorDeAlmacenamiento) {
    return res.status(502).json({ error: prefijo + error.message });
  }
  return null;
}

const router = express.Router();

/* El cuerpo puede traer una imagen de hasta 4 MB; en base64 ocupa ~4/3 más,
   más el resto del formulario. 7 MB deja margen suficiente. */
router.use(express.json({ limit: '7mb' }));

/* Estados admitidos al CREAR un evento */
/* Estados admitidos al ACTUALIZAR: el ciclo de vida completo */
/* Los estados y sus reglas salen del catálogo de la base (tablas
   event_statuses y reservation_statuses), no de listas escritas aquí.
   Agregar un estado es un INSERT: este archivo no se toca. */
/* Una vez aquí, el evento no cambia más */

/* Código del evento.
   Lo asigna el sistema con una secuencia de PostgreSQL, no el agente.
   nextval() nunca devuelve el mismo número dos veces, ni aunque dos
   agentes guarden en el mismo instante, así que el código es único por
   construcción y además queda ordenado por antigüedad.
   La comprobación contra la tabla es por si la base ya traía un evento
   con ese mismo código escrito a mano: en ese caso se pide el siguiente
   número en vez de fallar. */
const PREFIJO_CODIGO = 'EVT-';
function formatearCodigo(numero) {
  return PREFIJO_CODIGO + String(numero).padStart(5, '0');
}

async function reservarCodigo(ejecutor) {
  for (let intento = 0; intento < 10; intento += 1) {
    const siguiente = await ejecutor.query("SELECT nextval('events_code_seq') AS n");
    const code = formatearCodigo(siguiente.rows[0].n);
    const ocupado = await ejecutor.query('SELECT 1 FROM events WHERE code = $1', [code]);
    if (!ocupado.rowCount) return code;
  }
  throw new Error('No se pudo asignar un código de evento libre.');
}

/* El estado que se muestra se calcula con la hora del servidor: un evento
   cuya fecha ya pasó aparece Finalizado aunque nadie lo haya tocado. */
const ESTADO_CALCULADO = `
  CASE
    WHEN e.status IN ('Cancelado', 'Finalizado') THEN e.status
    WHEN e.ends_at   <= NOW() THEN 'Finalizado'
    WHEN e.starts_at <= NOW() THEN 'En Vivo'
    ELSE e.status
  END`;

/* Catálogo público */
router.get('/', async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT e.code, e.name, e.description, e.venue, e.starts_at, e.ends_at,
              e.total_capacity, e.base_price, e.observations,
              e.image_path, e.image_alt, e.banner_path, e.banner_alt,
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

/* Eventos del agente autenticado */
router.get('/mine', requireAgent, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT e.code, e.name, e.description, e.venue, e.starts_at, e.ends_at,
              e.total_capacity, e.base_price, e.observations, e.status,
              e.image_path, e.image_alt, e.banner_path, e.banner_alt,
              e.cancellation_reason, e.status_updated_at,
              /* Los códigos de la ubicación, además de los nombres: el
                 formulario de edición los necesita para volver a dejar
                 seleccionados país, departamento y ciudad. */
              e.country_code, e.department_code, e.city_id,
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

/* Vista previa del próximo código.
   Solo para mostrarlo en el formulario: el código definitivo se asigna
   al guardar, porque entre que se abre el formulario y se envía puede
   haber guardado otro agente. Va declarada antes que /:code porque
   Express resuelve por orden y si no «next-code» se leería como el
   código de un evento. */
router.get('/next-code', requireAgent, async (_req, res, next) => {
  try {
    /* last_value con is_called = false significa que ese número todavía
       no se ha entregado, así que el próximo es ese mismo. */
    const { rows } = await pool.query(
      "SELECT last_value, is_called FROM events_code_seq"
    );
    const siguiente = rows[0].is_called ? Number(rows[0].last_value) + 1 : Number(rows[0].last_value);
    return res.json({ code: formatearCodigo(siguiente), preview: true });
  } catch (error) { return next(error); }
});

/* Detalle de un evento */
router.get('/:code', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT e.code, e.name, e.description, e.venue, e.starts_at, e.ends_at,
              e.total_capacity, e.base_price, e.observations,
              e.image_path, e.image_alt, e.banner_path, e.banner_alt,
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

/* Crear evento (con afiche opcional) */
router.post('/', requireAgent, async (req, res, next) => {
  const body = req.body || {};
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

  /* El código ya no se lee del cuerpo: si el navegador manda uno, se
     ignora. Lo asigna el servidor más abajo, cuando el formulario ya
     pasó todas las validaciones, para no quemar números de la secuencia
     en intentos que iban a fallar igual. */
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
  /* Un evento nuevo no puede quedar en el pasado: el estado que se muestra
     se calcula con la hora del servidor, así que nacería Finalizado y
     parecería un fallo. Se admite un margen de un minuto para que no falle
     por el desfase entre el reloj del navegador y el del servidor. */
  if (startsAt.getTime() < Date.now() - 60_000) {
    return res.status(400).json({ error: 'La fecha de inicio ya pasó. Elige una fecha y hora futuras.' });
  }
  const catalogo = await estadosDelSistema();
  const iniciales = catalogo.eventos.filter((e) => e.allowed_as_initial).map((e) => e.code);
  if (!iniciales.includes(status)) {
    return res.status(400).json({ error: `El estado inicial debe ser ${iniciales.join(' o ')}.` });
  }

  /* Con el formulario ya validado se pide el código a la secuencia. Hace
     falta tenerlo antes de guardar las imágenes porque el nombre del
     archivo lo lleva dentro. */
  let code;
  try {
    code = await reservarCodigo(pool);
  } catch (error) { return next(error); }

  /* El afiche es opcional. Se guarda ANTES del INSERT porque la ruta del
     archivo es uno de los campos; si el INSERT falla, se borra el archivo
     para no dejar basura en disco. */
  let imagePath = null;
  let imageAlt = null;
  let bannerPath = null;
  let bannerAlt = null;
  if (body.image?.data) {
    try {
      imagePath = (await guardarAfiche(body.image.data, code)).rutaPublica;
      imageAlt = normalizarAlt(body.image.alt, name);
    } catch (error) {
      return respuestaDeImagen(res, error, '') || next(error);
    }
  }

  /* El banner es la imagen ancha del fondo del detalle. Opcional: si no
     viene, el detalle usa el afiche. Se guarda con el sufijo -banner para
     no confundir los dos archivos del mismo evento. */
  if (body.banner?.data) {
    try {
      bannerPath = (await guardarAfiche(body.banner.data, code + '-banner')).rutaPublica;
      bannerAlt = normalizarAlt(body.banner.alt, name);
    } catch (error) {
      borrarAfiche(imagePath);
      return respuestaDeImagen(res, error, 'Banner: ') || next(error);
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
      borrarAfiche(bannerPath);
      return res.status(400).json({ error: 'La ciudad no corresponde al departamento y país elegidos. Vuelve a seleccionar la ubicación.' });
    }

    const result = await pool.query(
      `INSERT INTO events
        (code, name, description, venue, starts_at, ends_at, total_capacity,
         base_price, observations, status, country_code, department_code, city_id, agent_id,
         image_path, image_alt, banner_path, banner_alt)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING id, code, name, status, image_path, image_alt, banner_path, banner_alt, created_at`,
      [code, name, description, venue, startsAt.toISOString(), endsAt.toISOString(),
        totalCapacity, basePrice, observations, status, countryCode, departmentCode, cityId,
        req.agent.id, imagePath, imageAlt, bannerPath, bannerAlt]
    );
    return res.status(201).json({
      message: `Evento registrado correctamente con el código ${code}.`,
      event: result.rows[0]
    });
  } catch (error) {
    borrarAfiche(imagePath);
    borrarAfiche(bannerPath);
    if (error.code === '23505' && error.constraint === 'events_code_key') {
      return res.status(409).json({ error: 'El código asignado quedó ocupado. Vuelve a intentarlo.' });
    }
    return next(error);
  }
});

/* Editar un evento ya publicado.
   Corrige los datos sin tener que crear otro evento: el código y el
   agente dueño no se tocan, así que las reservas ya hechas siguen
   apuntando al mismo espectáculo.
   Dos reglas cuidan a quien ya compró:
   · Un evento Finalizado o Cancelado no se edita. Cambiar la fecha de
     algo que ya terminó solo sirve para confundir.
   · La capacidad no puede bajar de las butacas ya reservadas, porque
     dejaría reservas vendidas sin silla. */
router.put('/:code', requireAgent, async (req, res, next) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const body = req.body || {};
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

  if (!name || name.length > 160 || !description || description.length > 5000 ||
      !venue || venue.length > 180 || !observations || observations.length > 3000) {
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

  const client = await pool.connect();
  /* Las imágenes nuevas se guardan dentro del try para poder borrarlas si
     la transacción termina mal. */
  let imagenNueva = null;
  let bannerNuevo = null;
  let imagenVieja = null;
  let bannerViejo = null;

  try {
    await client.query('BEGIN');
    /* El bloqueo va en una consulta propia: event_availability es una
       vista con GROUP BY y PostgreSQL no admite FOR UPDATE sobre una
       consulta con agregados. Las butacas ocupadas se piden aparte, ya
       con la fila del evento bloqueada. */
    const actual = await client.query(
      `SELECT id, status, starts_at, image_path, image_alt, banner_path, banner_alt
         FROM events
        WHERE code = $1 AND agent_id = $2
          FOR UPDATE`,
      [code, req.agent.id]
    );
    if (!actual.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No encontramos ese evento entre los tuyos.' });
    }
    const evento = actual.rows[0];

    const ocupadas = await client.query(
      `SELECT COALESCE(SUM(quantity), 0)::int AS reservadas
         FROM reservations
        WHERE event_id = $1 AND status IN ('Reservada', 'Confirmada', 'Usada')`,
      [evento.id]
    );
    evento.reserved_seats = ocupadas.rows[0].reservadas;

    if ((await estadosDelSistema()).eventosFinales.has(evento.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `El evento está ${evento.status} y ya no se puede editar.` });
    }
    if (totalCapacity < Number(evento.reserved_seats)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Ya hay ${evento.reserved_seats} butacas reservadas: la capacidad no puede quedar por debajo de esa cifra.`
      });
    }
    /* Mover la fecha al pasado dejaría el evento Finalizado al instante.
       Si no se cambió la fecha, se deja pasar aunque ya esté encima: eso
       es un evento en curso, no un error de quien edita. */
    const cambioFecha = startsAt.getTime() !== new Date(evento.starts_at).getTime();
    if (cambioFecha && startsAt.getTime() < Date.now() - 60_000) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La fecha de inicio ya pasó. Elige una fecha y hora futuras.' });
    }

    const ubicacion = await client.query(
      `SELECT 1
         FROM cities c
         JOIN departments d ON d.code = c.department_code AND d.country_code = c.country_code
        WHERE c.id = $1 AND d.code = $2 AND d.country_code = $3`,
      [cityId, departmentCode, countryCode]
    );
    if (!ubicacion.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La ciudad no corresponde al departamento y país elegidos. Vuelve a seleccionar la ubicación.' });
    }

    /* Las imágenes tienen tres caminos: mandar una nueva la reemplaza,
       pedir que se quite la borra, y no decir nada la deja como está.
       Así el formulario no tiene que reenviar la foto en cada edición. */
    let imagePath = evento.image_path;
    let imageAlt = evento.image_alt;
    if (body.image?.data) {
      imagenNueva = (await guardarAfiche(body.image.data, code)).rutaPublica;
      imagenVieja = evento.image_path;
      imagePath = imagenNueva;
      imageAlt = normalizarAlt(body.image.alt, name);
    } else if (body.removeImage === true) {
      imagenVieja = evento.image_path;
      imagePath = null;
      imageAlt = null;
    } else if (imagePath && typeof body.image?.alt === 'string') {
      imageAlt = normalizarAlt(body.image.alt, name);
    }

    let bannerPath = evento.banner_path;
    let bannerAlt = evento.banner_alt;
    if (body.banner?.data) {
      bannerNuevo = (await guardarAfiche(body.banner.data, code + '-banner')).rutaPublica;
      bannerViejo = evento.banner_path;
      bannerPath = bannerNuevo;
      bannerAlt = normalizarAlt(body.banner.alt, name);
    } else if (body.removeBanner === true) {
      bannerViejo = evento.banner_path;
      bannerPath = null;
      bannerAlt = null;
    } else if (bannerPath && typeof body.banner?.alt === 'string') {
      bannerAlt = normalizarAlt(body.banner.alt, name);
    }

    const result = await client.query(
      `UPDATE events
          SET name = $1, description = $2, venue = $3,
              starts_at = $4, ends_at = $5,
              total_capacity = $6, base_price = $7, observations = $8,
              country_code = $9, department_code = $10, city_id = $11,
              image_path = $12, image_alt = $13, banner_path = $14, banner_alt = $15
        WHERE id = $16
      RETURNING code, name, status, image_path, image_alt, banner_path, banner_alt`,
      [name, description, venue, startsAt.toISOString(), endsAt.toISOString(),
        totalCapacity, basePrice, observations, countryCode, departmentCode, cityId,
        imagePath, imageAlt, bannerPath, bannerAlt, evento.id]
    );

    await client.query('COMMIT');

    /* Los archivos viejos se borran recién cuando la base confirmó el
       cambio: si se borraran antes y la transacción fallara, el evento
       quedaría apuntando a una imagen que ya no existe. */
    if (imagenVieja && imagenVieja !== imagePath) borrarAfiche(imagenVieja);
    if (bannerViejo && bannerViejo !== bannerPath) borrarAfiche(bannerViejo);

    return res.json({ message: 'Evento actualizado correctamente.', event: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    borrarAfiche(imagenNueva);
    borrarAfiche(bannerNuevo);
    const respuesta = respuestaDeImagen(res, error, '');
    if (respuesta) return respuesta;
    if (error.code === '23503') {
      return res.status(400).json({ error: 'La ciudad no corresponde al departamento y país elegidos.' });
    }
    return next(error);
  } finally {
    client.release();
  }
});

/* Eliminar un evento.
   Borrar no es lo mismo que cancelar: cancelar deja el registro y avisa
   a quien tenía boleta, borrar lo hace desaparecer. Por eso solo se
   permite cuando nadie tiene una reserva viva ni usada; si las hay, el
   camino correcto es cancelar el evento, que ya avisa a los clientes.
   Las reservas canceladas sí se van con el evento: no son boletas de
   nadie, solo el rastro de algo que ya no existe. */
router.delete('/:code', requireAgent, async (req, res, next) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const actual = await client.query(
      'SELECT id, name, image_path, banner_path FROM events WHERE code = $1 AND agent_id = $2 FOR UPDATE',
      [code, req.agent.id]
    );
    if (!actual.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No encontramos ese evento entre los tuyos.' });
    }
    const evento = actual.rows[0];

    const vivas = await client.query(
      `SELECT COUNT(*)::int AS total
         FROM reservations
        WHERE event_id = $1 AND status IN ('Reservada', 'Confirmada', 'Usada')`,
      [evento.id]
    );
    if (vivas.rows[0].total > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `El evento tiene ${vivas.rows[0].total} reserva(s) activas, así que no se puede eliminar. Cancélalo: las reservas quedan canceladas con su causa y el cliente se entera.`
      });
    }

    await client.query('DELETE FROM reservations WHERE event_id = $1', [evento.id]);
    await client.query('DELETE FROM events WHERE id = $1', [evento.id]);
    await client.query('COMMIT');

    borrarAfiche(evento.image_path);
    borrarAfiche(evento.banner_path);

    return res.json({ message: `El evento «${evento.name}» (${code}) se eliminó definitivamente.` });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23503') {
      return res.status(409).json({ error: 'El evento tiene información asociada y no se puede eliminar. Cancélalo en vez de borrarlo.' });
    }
    return next(error);
  } finally {
    client.release();
  }
});

/* Cambiar o quitar el afiche de un evento ya creado */
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
      guardado = await guardarAfiche(body.data, code);
    } catch (error) {
      const respuesta = respuestaDeImagen(res, error, '');
      if (respuesta) return respuesta;
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

/* Ciclo de vida del espectáculo.
   Estados finales no admiten más cambios, y cancelar exige el motivo. */
router.patch('/:code/status', requireAgent, async (req, res, next) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const status = String((req.body || {}).status || '').trim();
  const crudo = (req.body || {}).cancellationReason;
  const motivo = crudo === undefined || crudo === null ? '' : String(crudo).trim();

  if (!(await estadosDelSistema()).eventosValidos.has(status)) {
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
    if ((await estadosDelSistema()).eventosFinales.has(anterior)) {
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

/* Reservas de TODOS los eventos del agente.
   Alimenta el panel «Reservas», que antes mostraba filas escritas a mano.
   El filtro por agent_id va en el JOIN: un agente no puede ver, ni por
   accidente ni a propósito, las reservas de los eventos de otro.
   Esta ruta va declarada ANTES que /:code/reservations porque Express
   resuelve por orden: si estuviera después, «mine» se leería como un
   código de evento y nunca llegaría aquí. */
router.get('/mine/reservations', requireAgent, async (req, res, next) => {
  const estado = String(req.query.status || '').trim();
  const estadosValidos = (await estadosDelSistema()).reservasValidos;

  try {
    const filtro = estadosValidos.has(estado) ? 'AND r.status = $2' : '';
    const result = await pool.query(
      `SELECT r.code, r.quantity, r.unit_price, r.total_amount, r.status, r.observations,
              r.created_at, r.status_updated_at, r.cancellation_reason,
              e.code AS event_code, e.name AS event_name, e.starts_at,
              ci.name AS event_city,
              c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone
         FROM reservations r
         JOIN events e  ON e.id = r.event_id AND e.agent_id = $1
         JOIN cities ci ON ci.id = e.city_id
         JOIN clients c ON c.id = r.client_id
        WHERE TRUE ${filtro}
        ORDER BY r.created_at DESC`,
      estadosValidos.has(estado) ? [req.agent.id, estado] : [req.agent.id]
    );

    /* Los totales se calculan sobre todas las reservas del agente, no sobre
       las filtradas: alimentan las pestañas y las tarjetas de resumen. */
    const totales = await pool.query(
      `SELECT r.status, COUNT(*)::int AS total,
              COALESCE(SUM(r.total_amount), 0)::float AS monto
         FROM reservations r
         JOIN events e ON e.id = r.event_id AND e.agent_id = $1
        GROUP BY r.status`,
      [req.agent.id]
    );
    const counts = { Reservada: 0, Confirmada: 0, Cancelada: 0, Usada: 0 };
    let ingresos = 0;
    totales.rows.forEach((fila) => {
      counts[fila.status] = fila.total;
      if (fila.status !== 'Cancelada') ingresos += fila.monto;
    });

    return res.json({ reservations: result.rows, counts, revenue: ingresos });
  } catch (error) { return next(error); }
});

/* Reservas de UN evento del agente */
router.get('/:code/reservations', requireAgent, async (req, res, next) => {
  const code = String(req.params.code).trim().toUpperCase();
  try {
    /* Se comprueba primero de quién es el evento para poder responder 404
       cuando no es suyo, igual que hacen el cambio de estado y el afiche.
       Antes devolvía 200 con una lista vacía, que se confunde con «este
       evento no tiene reservas todavía». */
    const propio = await pool.query(
      'SELECT 1 FROM events WHERE code = $1 AND agent_id = $2',
      [code, req.agent.id]
    );
    if (!propio.rowCount) {
      return res.status(404).json({ error: 'No encontramos ese evento entre los tuyos.' });
    }

    const result = await pool.query(
      `SELECT r.code, r.quantity, r.unit_price, r.total_amount, r.status, r.created_at, r.observations,
              c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone
       FROM reservations r
       JOIN events e ON e.id = r.event_id
       JOIN clients c ON c.id = r.client_id
       WHERE e.code = $1 AND e.agent_id = $2
       ORDER BY r.created_at DESC`,
      [code, req.agent.id]
    );
    return res.json(result.rows);
  } catch (error) { return next(error); }
});

module.exports = router;
