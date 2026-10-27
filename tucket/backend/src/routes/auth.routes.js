/* Rutas de sesión: /api/auth/*
   Un mismo formulario sirve para agentes y clientes: se busca el correo
   primero en `agents` y luego en `clients`, y el rol sale de la tabla en la
   que aparezca. */
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { abrirSesion, cerrarSesion, leerSesion, requireAgent } = require('../auth');

const router = express.Router();
router.use(express.json({ limit: '32kb' }));

async function buscarCuenta(email) {
  const agente = await pool.query(
    'SELECT id, full_name, email, password_hash FROM agents WHERE email = $1 AND active = TRUE',
    [email]
  );
  if (agente.rowCount) return { ...agente.rows[0], role: 'agente' };

  const cliente = await pool.query(
    'SELECT id, full_name, email, password_hash FROM clients WHERE email = $1 AND active = TRUE',
    [email]
  );
  if (cliente.rowCount) return { ...cliente.rows[0], role: 'cliente' };

  return null;
}

router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return res.status(400).json({ error: 'Escribe el correo y la contraseña.' });
    }

    const cuenta = await buscarCuenta(email);
    /* Mismo mensaje para "no existe" y "clave incorrecta": no se le revela a
       nadie qué correos están registrados. */
    if (!cuenta || !(await bcrypt.compare(password, cuenta.password_hash))) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }

    abrirSesion(res, { id: Number(cuenta.id), email: cuenta.email, role: cuenta.role });
    return res.json({
      role: cuenta.role,
      user: { id: cuenta.id, name: cuenta.full_name, email: cuenta.email },
      /* Se mantiene `agent` por compatibilidad con el frontend existente. */
      agent: cuenta.role === 'agente'
        ? { id: cuenta.id, name: cuenta.full_name, email: cuenta.email }
        : undefined
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/logout', (_req, res) => {
  cerrarSesion(res);
  res.status(204).end();
});

/* Quién soy: sirve para cualquiera de los dos roles. */
router.get('/me', async (req, res, next) => {
  try {
    const payload = leerSesion(req);
    if (!payload) return res.status(401).json({ error: 'No hay una sesión activa.' });

    if (payload.role === 'agente') {
      const result = await pool.query(
        'SELECT id, full_name AS name, email FROM agents WHERE id = $1 AND active = TRUE',
        [payload.agentId]
      );
      if (!result.rowCount) return res.status(401).json({ error: 'La cuenta de agente ya no está activa.' });
      return res.json({ role: 'agente', user: result.rows[0], agent: result.rows[0] });
    }

    const result = await pool.query(
      'SELECT id, full_name AS name, email FROM clients WHERE id = $1 AND active = TRUE',
      [payload.clientId]
    );
    if (!result.rowCount) return res.status(401).json({ error: 'La cuenta de cliente ya no está activa.' });
    return res.json({ role: 'cliente', user: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

/* Alias explícito para el panel del agente. */
router.get('/me/agent', requireAgent, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, full_name AS name, email FROM agents WHERE id = $1 AND active = TRUE',
      [req.agent.id]
    );
    if (!result.rowCount) return res.status(401).json({ error: 'La cuenta de agente ya no está activa.' });
    return res.json({ agent: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
