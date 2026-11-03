/* Rutas de perfil: /api/profile
   HU: el usuario autenticado consulta y modifica sus datos personales.

   Un solo módulo sirve a los dos roles. Clientes y agentes viven en tablas
   distintas pero editan los mismos campos, así que la tabla se elige con el
   rol que trae la sesión y nunca con algo que mande el navegador. */
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requireSession } = require('../auth');

const router = express.Router();
router.use(express.json({ limit: '32kb' }));

/* El rol decide la tabla. Se usa una lista fija: así ningún valor que venga
   de afuera puede terminar dentro de una consulta.

   El administrador entra aquí con un perfil reducido: su tabla solo tiene
   nombre y correo, porque no necesita teléfonos ni dirección para hacer su
   trabajo. Puede cambiar su nombre y su contraseña, y nada más. */
const TABLAS = { cliente: 'clients', agente: 'agents', administrador: 'admins' };

/* Los campos de contacto y ubicación solo existen en clients y agents. */
function tienePerfilCompleto(rol){ return rol === 'cliente' || rol === 'agente'; }

/* Campos que el usuario puede tocar. El correo y el documento quedan fuera
   a propósito: identifican la cuenta y cambiarlos es otra historia. */
function tablaDe(req) {
  return TABLAS[req.user.role] || null;
}

function consultaPerfil(tabla) {
  /* La tabla admins no tiene las columnas de contacto ni de ubicación, así
     que su consulta se escribe aparte en vez de inventarlas con NULL en el
     SELECT: si algún día se agregan, el cambio queda en un solo sitio. */
  if (tabla === 'admins') {
    return `
      SELECT u.id, u.full_name AS "fullName", u.email,
             u.created_at AS "createdAt", u.updated_at AS "updatedAt"
        FROM admins u
       WHERE u.id = $1 AND u.active = TRUE`;
  }
  return `
    SELECT u.id, u.full_name AS "fullName", u.email,
           u.phone, u.phone_alt AS "phoneAlt", u.address,
           u.country_code AS "countryCode", u.department_code AS "departmentCode",
           u.city_id AS "cityId",
           co.name AS country, d.name AS department, ci.name AS city,
           u.created_at AS "createdAt", u.updated_at AS "updatedAt"
      FROM ${tabla} u
      LEFT JOIN cities ci      ON ci.id = u.city_id
      LEFT JOIN departments d  ON d.code = u.department_code
      LEFT JOIN countries co   ON co.code = u.country_code
     WHERE u.id = $1 AND u.active = TRUE`;
}

/* ------------------------------------------------------------------
   Ver mi perfil
------------------------------------------------------------------ */
router.get('/', requireSession, async (req, res, next) => {
  try {
    const tabla = tablaDe(req);
    if (!tabla) return res.status(403).json({ error: 'Este rol no tiene perfil editable.' });

    const result = await pool.query(consultaPerfil(tabla), [req.user.id]);
    if (!result.rowCount) return res.status(401).json({ error: 'La cuenta ya no está activa.' });

    /* El documento solo lo tienen los clientes; se envía para mostrarlo
       como dato de solo lectura. */
    const perfil = { ...result.rows[0], role: req.user.role };
    if (req.user.role === 'cliente') {
      const doc = await pool.query(
        'SELECT document_type AS "documentType", document_number AS "documentNumber" FROM clients WHERE id = $1',
        [req.user.id]
      );
      Object.assign(perfil, doc.rows[0] || {});
    }
    return res.json(perfil);
  } catch (error) { return next(error); }
});

/* ------------------------------------------------------------------
   Actualizar mi perfil
------------------------------------------------------------------ */
router.put('/', requireSession, async (req, res, next) => {
  const tabla = tablaDe(req);
  if (!tabla) return res.status(403).json({ error: 'Este rol no tiene perfil editable.' });

  /* El administrador solo puede cambiar su nombre: su tabla no tiene los
     demás campos. Se resuelve aquí y no más abajo para no pasar por las
     validaciones de teléfono y ubicación, que para él no aplican. */
  if (!tienePerfilCompleto(req.user.role)) {
    const nombre = String((req.body || {}).fullName || '').trim();
    if (!nombre || nombre.length > 160) {
      return res.status(400).json({ error: 'Escribe tu nombre completo (máximo 160 caracteres).' });
    }
    const guardado = await pool.query(
      `UPDATE ${tabla} SET full_name = $1 WHERE id = $2 AND active = TRUE RETURNING id`,
      [nombre, req.user.id]
    );
    if (!guardado.rowCount) return res.status(401).json({ error: 'La cuenta ya no está activa.' });
    const actualizado = await pool.query(consultaPerfil(tabla), [req.user.id]);
    return res.json({
      message: 'Datos actualizados correctamente.',
      profile: { ...actualizado.rows[0], role: req.user.role }
    });
  }

  const body = req.body || {};
  const fullName = String(body.fullName || '').trim();
  const phone = String(body.phone || '').trim();
  const phoneAlt = String(body.phoneAlt || '').trim();
  const address = String(body.address || '').trim();

  /* La ubicación es opcional, pero no a medias: o están los tres datos o
     ninguno, porque la FK compuesta valida el trío completo. */
  const countryCode = body.countryCode ? String(body.countryCode).trim().toUpperCase() : '';
  const departmentCode = body.departmentCode ? String(body.departmentCode).trim().toUpperCase() : '';
  const cityId = body.cityId ? Number(body.cityId) : 0;

  if (!fullName || fullName.length > 160) {
    return res.status(400).json({ error: 'Escribe tu nombre completo (máximo 160 caracteres).' });
  }
  const digitos = (valor) => valor.replace(/\D/g, '').length;
  if (!phone || digitos(phone) < 7 || phone.length > 32) {
    return res.status(400).json({ error: 'Escribe un teléfono de contacto con al menos 7 dígitos.' });
  }
  if (phoneAlt && (digitos(phoneAlt) < 7 || phoneAlt.length > 32)) {
    return res.status(400).json({ error: 'El segundo teléfono debe tener al menos 7 dígitos.' });
  }
  if (phoneAlt && phoneAlt === phone) {
    return res.status(400).json({ error: 'Los dos teléfonos son iguales. Escribe uno distinto o deja el segundo vacío.' });
  }
  if (address.length > 180) {
    return res.status(400).json({ error: 'La dirección no puede superar los 180 caracteres.' });
  }

  const hayUbicacion = Boolean(countryCode && departmentCode && Number.isInteger(cityId) && cityId > 0);
  if ((countryCode || departmentCode || cityId) && !hayUbicacion) {
    return res.status(400).json({ error: 'Selecciona país, departamento y ciudad, o deja la ubicación vacía.' });
  }

  try {
    if (hayUbicacion) {
      const ubicacion = await pool.query(
        `SELECT 1
           FROM cities c
           JOIN departments d ON d.code = c.department_code AND d.country_code = c.country_code
          WHERE c.id = $1 AND d.code = $2 AND d.country_code = $3`,
        [cityId, departmentCode, countryCode]
      );
      if (!ubicacion.rowCount) {
        return res.status(400).json({ error: 'La ciudad no corresponde al departamento y país elegidos.' });
      }
    }

    const actualizado = await pool.query(
      `UPDATE ${tabla}
          SET full_name = $1,
              phone = $2,
              phone_alt = $3,
              address = $4,
              country_code = $5,
              department_code = $6,
              city_id = $7
        WHERE id = $8 AND active = TRUE
      RETURNING id`,
      [fullName, phone, phoneAlt || null, address || null,
        hayUbicacion ? countryCode : null,
        hayUbicacion ? departmentCode : null,
        hayUbicacion ? cityId : null,
        req.user.id]
    );
    if (!actualizado.rowCount) return res.status(401).json({ error: 'La cuenta ya no está activa.' });

    /* Se devuelve el perfil ya guardado para que la vista se refresque con
       lo que quedó en la base y no con lo que creía el formulario. */
    const result = await pool.query(consultaPerfil(tabla), [req.user.id]);
    return res.json({
      message: 'Datos actualizados correctamente.',
      profile: { ...result.rows[0], role: req.user.role }
    });
  } catch (error) {
    if (error.code === '23503') {
      return res.status(400).json({ error: 'La ciudad no corresponde al departamento y país elegidos.' });
    }
    return next(error);
  }
});

/* ------------------------------------------------------------------
   Cambiar mi contraseña

   Se exige la actual aunque haya sesión abierta. La sesión demuestra que
   alguien entró con esa cuenta, no que siga siendo su dueño: un equipo
   prestado o desatendido basta para cambiarle la clave a otro y dejarlo
   fuera. Pedir la anterior lo impide.
------------------------------------------------------------------ */
router.put('/password', requireSession, async (req, res, next) => {
  const tabla = tablaDe(req);
  if (!tabla) return res.status(403).json({ error: 'Este rol no tiene perfil editable.' });

  const actual = String((req.body || {}).currentPassword || '');
  const nueva = String((req.body || {}).newPassword || '');

  if (!actual || !nueva) {
    return res.status(400).json({ error: 'Escribe tu contraseña actual y la nueva.' });
  }
  /* Mismo mínimo que el registro: si aquí fuera más laxo, bastaría con
     cambiarla para saltarse la regla. */
  if (nueva.length < 8 || nueva.length > 128) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener entre 8 y 128 caracteres.' });
  }
  if (nueva === actual) {
    return res.status(400).json({ error: 'La nueva contraseña debe ser distinta de la actual.' });
  }

  try {
    const cuenta = await pool.query(
      `SELECT password_hash FROM ${tabla} WHERE id = $1 AND active = TRUE`,
      [req.user.id]
    );
    if (!cuenta.rowCount) return res.status(401).json({ error: 'La cuenta ya no está activa.' });

    if (!(await bcrypt.compare(actual, cuenta.rows[0].password_hash))) {
      return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
    }

    const hash = await bcrypt.hash(nueva, 12);
    await pool.query(
      `UPDATE ${tabla} SET password_hash = $1 WHERE id = $2`,
      [hash, req.user.id]
    );

    /* La sesión sigue abierta a propósito: quien cambia su propia clave no
       tiene por qué volver a entrar. Si alguna vez se quisiera cerrar las
       demás sesiones, haría falta versionar el token, que hoy no existe. */
    return res.json({ message: 'Contraseña actualizada. Úsala la próxima vez que inicies sesión.' });
  } catch (error) { return next(error); }
});

module.exports = router;
