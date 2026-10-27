/* Rutas de clientes: /api/clients/*
   Es el registro que antes solo validaba en el navegador y no guardaba nada. */
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { abrirSesion, requireClient } = require('../auth');

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
    /* Coste 12: el estándar razonable hoy para bcrypt. */
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO clients
        (document_type, document_number, full_name, email, password_hash, phone, address,
         country_code, department_code, city_id, accepted_terms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE)
       RETURNING id, full_name AS name, email, created_at`,
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
      `SELECT c.id, c.document_type, c.document_number, c.full_name AS name, c.email,
              c.phone, c.address, ci.name AS city, d.name AS department, c.created_at
       FROM clients c
       LEFT JOIN cities ci ON ci.id = c.city_id
       LEFT JOIN departments d ON d.code = c.department_code
       WHERE c.id = $1 AND c.active = TRUE`,
      [req.client.id]
    );
    if (!result.rowCount) return res.status(401).json({ error: 'La cuenta ya no está activa.' });
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

module.exports = router;
