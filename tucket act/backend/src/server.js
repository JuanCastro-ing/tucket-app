require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });

const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('node:path');
const pool = require('./db');
const { requireAgent } = require('./auth');

const app = express();
const projectRoot = path.resolve(__dirname, '..', '..');
/* Estados admitidos al CREAR un evento */
const allowedStatuses = new Set(['Programado', 'En Boletería']);
/* Estados admitidos al ACTUALIZAR: el ciclo de vida completo */
const lifecycleStatuses = new Set(['Programado', 'En Boletería', 'En Vivo', 'Finalizado', 'Cancelado']);
/* Una vez aquí, el evento no cambia más */
const finalStatuses = new Set(['Finalizado', 'Cancelado']);

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use('/backend', (_req, res) => res.status(404).end());
app.use(express.static(projectRoot, { index: 'index.html' }));

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Escribe el correo y la contraseña.' });

    const result = await pool.query(
      'SELECT id, full_name, email, password_hash FROM agents WHERE email = $1 AND active = TRUE',
      [email]
    );
    const agent = result.rows[0];
    if (!agent || !(await bcrypt.compare(password, agent.password_hash))) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32 || secret.includes('CAMBIA')) {
      return res.status(500).json({ error: 'Configura JWT_SECRET con al menos 32 caracteres.' });
    }
    const agentId = Number(agent.id);
    if (!Number.isSafeInteger(agentId) || agentId < 1) {
      return res.status(500).json({ error: 'El identificador de agente no es válido.' });
    }
    const token = jwt.sign({ agentId, email: agent.email, role: 'agente' }, secret, {
      algorithm: 'HS256', expiresIn: '8h', issuer: 'tucket-api', audience: 'tucket-web'
    });
    res.cookie('tucket_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000,
      path: '/api'
    });
    return res.json({ agent: { id: agent.id, name: agent.full_name, email: agent.email } });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('tucket_session', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api'
  });
  res.status(204).end();
});

app.get('/api/auth/me', requireAgent, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, full_name AS name, email FROM agents WHERE id = $1 AND active = TRUE',
      [req.agent.id]
    );
    if (!result.rowCount) return res.status(401).json({ error: 'La cuenta de agente ya no está activa.' });
    return res.json({ agent: result.rows[0] });
  } catch (error) { next(error); }
});

app.get('/api/geography/countries', async (_req, res, next) => {
  try {
    const result = await pool.query('SELECT code, name FROM countries ORDER BY name');
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.get('/api/geography/countries/:countryCode/departments', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT code, name FROM departments WHERE country_code = $1 ORDER BY name',
      [String(req.params.countryCode).toUpperCase()]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.get('/api/geography/departments/:departmentCode/cities', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, name FROM cities WHERE department_code = $1 ORDER BY name',
      [String(req.params.departmentCode).toUpperCase()]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.get('/api/events', async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT e.code, e.name, e.description, e.venue, e.starts_at, e.ends_at,
              e.total_capacity, e.base_price, e.observations,
              CASE
                WHEN e.ends_at <= NOW() THEN 'Finalizado'
                WHEN e.starts_at <= NOW() THEN 'En Vivo'
                ELSE e.status
              END AS status,
              ci.name AS city, d.name AS department, co.name AS country
       FROM events e
       JOIN cities ci ON ci.id = e.city_id
       JOIN departments d ON d.code = e.department_code AND d.country_code = e.country_code
       JOIN countries co ON co.code = e.country_code
       ORDER BY CASE WHEN e.ends_at <= NOW() THEN 1 ELSE 0 END, e.starts_at ASC`
    );
    return res.json({ serverTime: new Date().toISOString(), events: result.rows });
  } catch (error) { return next(error); }
});

app.get('/api/events/mine', requireAgent, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT e.code, e.name, e.description, e.venue, e.starts_at, e.ends_at,
              e.total_capacity, e.base_price, e.observations, e.status,
              e.cancellation_reason, e.status_updated_at,
              ci.name AS city, d.name AS department, co.name AS country
       FROM events e
       JOIN cities ci ON ci.id = e.city_id
       JOIN departments d ON d.code = e.department_code
       JOIN countries co ON co.code = e.country_code
       WHERE e.agent_id = $1
       ORDER BY e.created_at DESC`,
      [req.agent.id]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.post('/api/events', requireAgent, async (req, res, next) => {
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
  const hasExplicitTimezone = (value) => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  if (!hasExplicitTimezone(body.startsAt) || !hasExplicitTimezone(body.endsAt) ||
      !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
    return res.status(400).json({ error: 'La fecha y hora de finalización debe ser posterior al inicio.' });
  }
  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ error: 'El estado inicial debe ser Programado o En Boletería.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO events
        (code, name, description, venue, starts_at, ends_at, total_capacity,
         base_price, observations, status, country_code, department_code, city_id, agent_id)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
       WHERE EXISTS (
         SELECT 1 FROM cities c
         JOIN departments d ON d.code = c.department_code AND d.country_code = c.country_code
         WHERE c.id = $13 AND d.code = $12 AND d.country_code = $11
       )
       RETURNING id, code, name, status, created_at`,
      [code, name, description, venue, startsAt.toISOString(), endsAt.toISOString(),
        totalCapacity, basePrice, observations, status, countryCode, departmentCode, cityId, req.agent.id]
    );
    if (!result.rowCount) return res.status(400).json({ error: 'La ciudad no corresponde al departamento y país elegidos. Vuelve a seleccionar la ubicación.' });
    return res.status(201).json({ message: 'Evento registrado correctamente.', event: result.rows[0] });
  } catch (error) {
    if (error.code === '23505' && error.constraint === 'events_code_key') {
      return res.status(409).json({ error: 'Ese código ya está registrado. Usa un código único.' });
    }
    return next(error);
  }
});

/* ------------------------------------------------------------------
   HU — El agente controla el ciclo de vida de su espectáculo.
   Estados finales (Finalizado y Cancelado) no admiten más cambios, y
   cancelar exige dejar constancia del motivo.
------------------------------------------------------------------ */
app.patch('/api/events/:code/status', requireAgent, async (req, res, next) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const status = String((req.body || {}).status || '').trim();
  const rawReason = (req.body || {}).cancellationReason;
  const reason = rawReason === undefined || rawReason === null ? '' : String(rawReason).trim();

  if (!lifecycleStatuses.has(status)) {
    return res.status(400).json({ error: 'Estado no válido. Usa Programado, En Boletería, En Vivo, Finalizado o Cancelado.' });
  }
  if (status === 'Cancelado' && (reason.length < 10 || reason.length > 500)) {
    return res.status(400).json({ error: 'Para cancelar debes registrar la causa, entre 10 y 500 caracteres.' });
  }

  try {
    const actual = await pool.query(
      'SELECT status FROM events WHERE code = $1 AND agent_id = $2',
      [code, req.agent.id]
    );
    if (!actual.rowCount) {
      return res.status(404).json({ error: 'No encontramos ese evento entre los tuyos.' });
    }
    const anterior = actual.rows[0].status;
    if (finalStatuses.has(anterior)) {
      return res.status(409).json({ error: `El evento ya está ${anterior} y no admite más cambios de estado.` });
    }
    if (anterior === status) {
      return res.status(409).json({ error: `El evento ya está en estado ${status}.` });
    }

    const result = await pool.query(
      `UPDATE events
          SET status = $1,
              cancellation_reason = CASE WHEN $1 = 'Cancelado' THEN $2 ELSE NULL END,
              status_updated_at = NOW()
        WHERE code = $3 AND agent_id = $4
      RETURNING code, status, cancellation_reason, status_updated_at`,
      [status, reason, code, req.agent.id]
    );
    return res.json({
      message: status === 'Cancelado'
        ? 'Evento cancelado. La causa quedó registrada.'
        : `Estado actualizado a ${status}.`,
      event: result.rows[0]
    });
  } catch (error) { return next(error); }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta de API no encontrada.' }));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Ocurrió un error interno. Revisa la conexión con PostgreSQL.' });
});

async function start() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32 || secret.includes('CAMBIA')) throw new Error('Configura JWT_SECRET en backend/.env con un secreto aleatorio de al menos 32 caracteres.');
  await pool.query('SELECT 1');
  const port = Number(process.env.PORT || 8000);
  app.listen(port, () => console.log(`TUCKET listo en http://localhost:${port}`));
}

start().catch((error) => {
  console.error('No se pudo iniciar TUCKET:', error.message);
  process.exitCode = 1;
  pool.end();
});
