/* Rutas de solicitudes de cuenta de agente: /api/agent-requests/*

   Quien quiere publicar espectáculos manda el formulario público. Un
   administrador la aprueba —y entonces nace la cuenta de agente con una
   contraseña temporal— o la rechaza dejando por escrito el motivo. */
const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requireAdmin } = require('../auth');
const { rolQueYaUsaElCorreo } = require('../correos');

const router = express.Router();
router.use(express.json({ limit: '32kb' }));

const { cargar: estadosDelSistema } = require('../estados');

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
  SELECT s.id, s.nombre_completo AS "full_name", s.numero_documento AS "document_number", s.correo AS "email", s.telefono AS "phone",
         s.organizacion AS "organization", s.nit, s.justificacion AS "justification",
         s.estado AS "status", s.notas_revision AS "review_notes", s.fecha_revision AS "reviewed_at", s.fecha_creacion AS "created_at",
         s.id_agente AS "agent_id", a.nombre_completo AS revisado_por_nombre
    FROM solicitudes_agente s
    LEFT JOIN administradores a ON a.id = s.revisado_por`;

/* Crear una solicitud — público */
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
      `SELECT 'agente' AS rol FROM agentes WHERE correo = $1
       UNION ALL SELECT 'cliente' FROM clientes WHERE correo = $1
       UNION ALL SELECT 'administrador' FROM administradores WHERE correo = $1`,
      [email]
    );
    if (existente.rowCount) {
      return res.status(409).json({
        error: `Ese correo ya tiene una cuenta de ${existente.rows[0].rol} en TUCKET. Solicita con otro correo.`
      });
    }

    const result = await pool.query(
      `INSERT INTO solicitudes_agente
        (nombre_completo, numero_documento, correo, telefono, organizacion, nit, justificacion)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, nombre_completo AS "full_name", correo AS "email", estado AS "status", fecha_creacion AS "created_at"`,
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

/* Bandeja del administrador */
router.get('/', requireAdmin, async (req, res, next) => {
  const estado = String(req.query.status || '').trim();
  try {
    const where = (await estadosDelSistema()).solicitudesValidos.has(estado) ? 'WHERE s.estado = $1' : '';
    const result = await pool.query(
      `${SELECT_SOLICITUD} ${where} ORDER BY s.fecha_creacion DESC`,
      (await estadosDelSistema()).solicitudesValidos.has(estado) ? [estado] : []
    );

    /* Los conteos van siempre completos, no filtrados: alimentan el
       contador de pendientes del panel y las pestañas de la bandeja. */
    const conteos = await pool.query(
      `SELECT estado AS "status", COUNT(*)::int AS total FROM solicitudes_agente GROUP BY estado`
    );
    const totales = { Pendiente: 0, Aprobada: 0, Rechazada: 0 };
    conteos.rows.forEach((fila) => { totales[fila.status] = fila.total; });

    return res.json({ requests: result.rows, counts: totales });
  } catch (error) { return next(error); }
});

/* Aprobar: crea la cuenta de agente */
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
      'SELECT id, nombre_completo AS "full_name", correo AS "email", estado AS "status" FROM solicitudes_agente WHERE id = $1 FOR UPDATE',
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

    /* Puede que entre el envío de la solicitud y su aprobación esa
       persona se haya registrado como cliente. Crear ahora el agente
       dejaría dos cuentas con el mismo correo y la de cliente quedaría
       inaccesible, así que se avisa al administrador en vez de hacerlo. */
    const ocupado = await rolQueYaUsaElCorreo(solicitud.email, client);
    if (ocupado) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Ese correo ya tiene una cuenta de ${ocupado} en TUCKET. No se puede crear otra con el mismo correo: pide a la persona que use uno distinto, o rechaza la solicitud explicándoselo.`
      });
    }

    const temporal = claveTemporal();
    const hash = await bcrypt.hash(temporal, 12);

    const agente = await client.query(
      'INSERT INTO agentes (nombre_completo, correo, clave_hash) VALUES ($1, $2, $3) RETURNING id',
      [solicitud.full_name, solicitud.email, hash]
    );

    const result = await client.query(
      `UPDATE solicitudes_agente
          SET estado = 'Aprobada', id_agente = $1, revisado_por = $2, fecha_revision = NOW()
        WHERE id = $3
      RETURNING id, nombre_completo AS "full_name", correo AS "email", estado AS "status", fecha_revision AS "reviewed_at"`,
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

/* Rechazar: exige el motivo */
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
      `UPDATE solicitudes_agente
          SET estado = 'Rechazada', notas_revision = $1, revisado_por = $2, fecha_revision = NOW()
        WHERE id = $3 AND estado = 'Pendiente'
      RETURNING id, nombre_completo AS "full_name", correo AS "email", estado AS "status", notas_revision AS "review_notes", fecha_revision AS "reviewed_at"`,
      [motivo, req.admin.id, id]
    );

    if (!result.rowCount) {
      /* O no existe, o alguien ya la resolvió: se distingue para que el
         administrador sepa cuál de las dos cosas pasó. */
      const existe = await pool.query('SELECT estado AS "status" FROM solicitudes_agente WHERE id = $1', [id]);
      if (!existe.rowCount) return res.status(404).json({ error: 'No encontramos esa solicitud.' });
      return res.status(409).json({ error: `Esa solicitud ya está ${existe.rows[0].status}.` });
    }

    return res.json({ message: 'Solicitud rechazada. El motivo quedó registrado.', request: result.rows[0] });
  } catch (error) { return next(error); }
});

module.exports = router;
