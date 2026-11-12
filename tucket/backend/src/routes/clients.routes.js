/* Rutas de clientes: /api/clients/*
   Es el registro que antes solo validaba en el navegador y no guardaba nada. */
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { abrirSesion, requireClient } = require('../auth');
const { rolQueYaUsaElCorreo, mensajeCorreoOcupado } = require('../correos');

const router = express.Router();
router.use(express.json({ limit: '32kb' }));

const TIPOS_DOCUMENTO = new Set(['CC', 'CE', 'TI', 'PAS', 'NIT']);
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

router.post('/register', async (req, res, next) => {
  const body = req.body || {};
  const documentType = String(body.documentType || 'CC').trim().toUpperCase();
  const documentNumber = String(body.documentNumber || '').trim();
  const fullName = String(body.fullName || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const phone = String(body.phone || '').trim();
  const address = String(body.address || '').trim() || null;
  const acceptedTerms = body.acceptedTerms === true;

  /* Ubicación opcional: o vienen los tres datos, o no viene ninguno. */
  const countryCode = body.countryCode ? String(body.countryCode).trim().toUpperCase() : null;
  const departmentCode = body.departmentCode ? String(body.departmentCode).trim().toUpperCase() : null;
  const cityId = body.cityId ? Number(body.cityId) : null;

  if (!TIPOS_DOCUMENTO.has(documentType)) {
    return res.status(400).json({ error: 'Tipo de documento no válido.' });
  }
  if (!/^[A-Za-z0-9.-]{4,32}$/.test(documentNumber)) {
    return res.status(400).json({ error: 'El número de identificación debe tener entre 4 y 32 caracteres.' });
  }
  if (!fullName || fullName.length > 160) {
    return res.status(400).json({ error: 'Escribe tu nombre completo.' });
  }
  if (!CORREO.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Escribe un correo válido, por ejemplo nombre@correo.com.' });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 128 caracteres.' });
  }
  if (!phone || phone.length > 32) {
    return res.status(400).json({ error: 'Escribe un número de teléfono.' });
  }
  if (!acceptedTerms) {
    return res.status(400).json({ error: 'Debes aceptar los términos y el tratamiento de datos.' });
  }
  const ubicacionCompleta = Boolean(countryCode && departmentCode && Number.isInteger(cityId) && cityId > 0);
  if ((countryCode || departmentCode || cityId) && !ubicacionCompleta) {
    return res.status(400).json({ error: 'Selecciona país, departamento y ciudad, o deja la ubicación vacía.' });
  }

  try {
    /* El correo debe estar libre en las tres tablas, no solo en clients:
       si ya existe como agente o administrador, esta cuenta nacería
       inaccesible (al iniciar sesión entraría siempre la otra). */
    if (await rolQueYaUsaElCorreo(email)) {
      return res.status(409).json({ error: mensajeCorreoOcupado() });
    }

    /* Coste 12: el estándar razonable hoy para bcrypt. */
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO clientes
        (tipo_documento, numero_documento, nombre_completo, correo, clave_hash, telefono, direccion,
         codigo_pais, codigo_departamento, id_ciudad, acepto_terminos)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE)
       RETURNING id, nombre_completo AS nombre, correo AS "email", fecha_creacion AS "created_at"`,
      [documentType, documentNumber, fullName, email, passwordHash, phone, address,
        ubicacionCompleta ? countryCode : null,
        ubicacionCompleta ? departmentCode : null,
        ubicacionCompleta ? cityId : null]
    );

    const cliente = result.rows[0];
    /* Queda con la sesión abierta: se registró y entra directo. */
    abrirSesion(res, { id: Number(cliente.id), email: cliente.email, role: 'cliente' });

    return res.status(201).json({
      message: 'Cuenta creada. ¡Bienvenido a TUCKET!',
      role: 'cliente',
      user: cliente
    });
  } catch (error) {
    if (error.code === '23505') {
      if (error.constraint === 'clients_email_key') {
        return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
      }
      return res.status(409).json({ error: 'Ya existe una cuenta con ese documento.' });
    }
    if (error.code === '23503') {
      return res.status(400).json({ error: 'La ciudad no corresponde al departamento y país elegidos.' });
    }
    return next(error);
  }
});

router.get('/me', requireClient, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.tipo_documento AS "document_type", c.numero_documento AS "document_number", c.nombre_completo AS nombre, c.correo AS "email",
              c.telefono AS "phone", c.direccion AS "address", ci.nombre AS city, d.nombre AS department, c.fecha_creacion AS "created_at"
       FROM clientes c
       LEFT JOIN ciudades ci ON ci.id = c.id_ciudad
       LEFT JOIN departamentos d ON d.codigo = c.codigo_departamento
       WHERE c.id = $1 AND c.activo = TRUE`,
      [req.client.id]
    );
    if (!result.rowCount) return res.status(401).json({ error: 'La cuenta ya no está activa.' });
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

module.exports = router;
