/* Rutas de solicitudes de cuenta de agente: /api/agent-requests/*

   Quien quiere publicar espectáculos manda el formulario público. Un
   administrador la aprueba —y entonces nace la cuenta de agente con una
   contraseña temporal— o la rechaza dejando por escrito el motivo. */
const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();
router.use(express.json({ limit: '32kb' }));

const ESTADOS = new Set(['Pendiente', 'Aprobada', 'Rechazada']);

/* Alfabeto sin caracteres que se confunden al dictarlos por teléfono
   (0/O, 1/l/I): la contraseña temporal se la pasa el administrador a la
   persona a mano, así que tiene que poder leerse en voz alta. */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function claveTemporal(longitud = 14) {
  const bytes = crypto.randomBytes(longitud);
  let salida = '';
  for (let i = 0; i < longitud; i += 1) salida += ALFABETO[bytes[i] % ALFABETO.length];
  return salida;
}

const SELECT_SOLICITUD = `
  SELECT s.id, s.full_name, s.document_number, s.email, s.phone,
         s.organization, s.nit, s.justification,
         s.status, s.review_notes, s.reviewed_at, s.created_at,
         s.agent_id, a.full_name AS reviewed_by_name
    FROM agent_requests s
    LEFT JOIN admins a ON a.id = s.reviewed_by`;

/* ------------------------------------------------------------------
   Crear una solicitud — público
------------------------------------------------------------------ */
router.post('/', async (req, res, next) => {
  const body = req.body || {};
  const fullName = String(body.fullName || '').trim();
  const documentNumber = String(body.documentNumber || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const organization = String(body.organization || '').trim();
  const nit = String(body.nit || '').trim();
  const justification = String(body.justification || '').trim();

  if (!fullName || fullName.length > 160) {
    return res.status(400).json({ error: 'Escribe tu nombre completo.' });
  }
  if (!/^[0-9A-Za-z.\-]{5,32}$/.test(documentNumber)) {
    return res.status(400).json({ error: 'El número de documento no es válido.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Escribe un correo electrónico válido.' });
  }
  if (!/^[0-9+\s()\-]{7,32}$/.test(phone)) {
    return res.status(400).json({ error: 'El teléfono debe tener al menos 7 dígitos.' });
  }
  if (!organization || organization.length > 180) {
    return res.status(400).json({ error: 'Escribe el teatro, productora o empresa que representas.' });
  }
  if (nit && !/^[0-9.\-]{5,32}$/.test(nit)) {
    return res.status(400).json({ error: 'El NIT no es válido. Déjalo vacío si no aplica.' });
  }
  if (justification.length < 30 || justification.length > 1000) {
    return res.status(400).json({ error: 'La justificación debe tener entre 30 y 1000 caracteres.' });
  }

  try {
    /* Un correo no puede tener dos cuentas en el sistema: el login lo
       buscaría en las tres tablas y el rol dependería de cuál se consulte
       primero. Mejor rechazarlo aquí con un mensaje claro que crear una
       cuenta que deje a la persona sin poder entrar a la que ya tenía. */
    const existente = await pool.query(
      `SELECT 'agente' AS rol FROM agents WHERE email = $1
       UNION ALL SELECT 'cliente' FROM clients WHERE email = $1
       UNION ALL SELECT 'administrador' FROM admins WHERE email = $1`,
      [email]
    );
    if (existente.rowCount) {
      return res.status(409).json({
        error: `Ese correo ya tiene una cuenta de ${existente.rows[0].rol} en TUCKET. Solicita con otro correo.`
      });
    }

    const result = await pool.query(
      `INSERT INTO agent_requests
        (full_name, document_number, email, phone, organization, nit, justification)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, full_name, email, status, created_at`,
      [fullName, documentNumber, email, phone, organization, nit || null, justification]
    );

    return res.status(201).json({
      message: 'Solicitud enviada. Un administrador la revisará y te escribirá al correo registrado.',
      request: result.rows[0]
    });
  } catch (error) {
    /* El índice parcial impide dos solicitudes pendientes del mismo correo. */
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'Ya tienes una solicitud en revisión con ese correo. Espera la respuesta antes de enviar otra.'
      });
    }
    return next(error);
  }
});

/* ------------------------------------------------------------------
   Bandeja del administrador
------------------------------------------------------------------ */
router.get('/', requireAdmin, async (req, res, next) => {
  const estado = String(req.query.status || '').trim();
  try {
    const where = ESTADOS.has(estado) ? 'WHERE s.status = $1' : '';
    const result = await pool.query(
      `${SELECT_SOLICITUD} ${where} ORDER BY s.created_at DESC`,
      ESTADOS.has(estado) ? [estado] : []
    );

    /* Los conteos van siempre completos, no filtrados: alimentan el
       contador de pendientes del panel y las pestañas de la bandeja. */
    const conteos = await pool.query(
      `SELECT status, COUNT(*)::int AS total FROM agent_requests GROUP BY status`
    );
    const totales = { Pendiente: 0, Aprobada: 0, Rechazada: 0 };
    conteos.rows.forEach((fila) => { totales[fila.status] = fila.total; });

    return res.json({ requests: result.rows, counts: totales });
  } catch (error) { return next(error); }
});

/* ------------------------------------------------------------------
   Aprobar: crea la cuenta de agente
------------------------------------------------------------------ */
router.patch('/:id/approve', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Solicitud no válida.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* FOR UPDATE: si dos administradores aprueban la misma solicitud a la
       vez, el segundo espera y encuentra que ya está resuelta. Sin esto se
       crearían dos cuentas para la misma persona. */
    const actual = await client.query(
      'SELECT id, full_name, email, status FROM agent_requests WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (!actual.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No encontramos esa solicitud.' });
    }
    const solicitud = actual.rows[0];
    if (solicitud.status !== 'Pendiente') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Esa solicitud ya está ${solicitud.status}.` });
    }

    const temporal = claveTemporal();
    const hash = await bcrypt.hash(temporal, 12);

    const agente = await client.query(
      'INSERT INTO agents (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [solicitud.full_name, solicitud.email, hash]
    );

    const result = await client.query(
      `UPDATE agent_requests
          SET status = 'Aprobada', agent_id = $1, reviewed_by = $2, reviewed_at = NOW()
        WHERE id = $3
      RETURNING id, full_name, email, status, reviewed_at`,
      [agente.rows[0].id, req.admin.id, id]
    );

    await client.query('COMMIT');
    return res.json({
      message: `Cuenta de agente creada para ${solicitud.email}.`,
      request: result.rows[0],
      /* La contraseña temporal se muestra UNA sola vez: en la base queda
         solo su hash, así que ni el administrador puede volver a verla.
         Si se pierde, se repite el proceso con agent:create. */
      temporaryPassword: temporal
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Ese correo ya tiene una cuenta de agente.' });
    }
    return next(error);
  } finally {
    client.release();
  }
});

/* ------------------------------------------------------------------
   Rechazar: exige el motivo
------------------------------------------------------------------ */
router.patch('/:id/reject', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const motivo = String((req.body || {}).reviewNotes || '').trim();

  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Solicitud no válida.' });
  }
  if (motivo.length < 10 || motivo.length > 500) {
    return res.status(400).json({ error: 'Para rechazar debes escribir el motivo, entre 10 y 500 caracteres.' });
  }

  try {
    const result = await pool.query(
      `UPDATE agent_requests
          SET status = 'Rechazada', review_notes = $1, reviewed_by = $2, reviewed_at = NOW()
        WHERE id = $3 AND status = 'Pendiente'
      RETURNING id, full_name, email, status, review_notes, reviewed_at`,
      [motivo, req.admin.id, id]
    );

    if (!result.rowCount) {
      /* O no existe, o alguien ya la resolvió: se distingue para que el
         administrador sepa cuál de las dos cosas pasó. */
      const existe = await pool.query('SELECT status FROM agent_requests WHERE id = $1', [id]);
      if (!existe.rowCount) return res.status(404).json({ error: 'No encontramos esa solicitud.' });
      return res.status(409).json({ error: `Esa solicitud ya está ${existe.rows[0].status}.` });
    }

    return res.json({ message: 'Solicitud rechazada. El motivo quedó registrado.', request: result.rows[0] });
  } catch (error) { return next(error); }
});

module.exports = router;
