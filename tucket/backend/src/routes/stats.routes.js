/* Cifras públicas de la portada: /api/stats/*

   La portada y el inicio de sesión mostraban «128 eventos activos ·
   4.930 reservas · 36 ciudades» escritos a mano. Quedaban desmentidos por
   cualquiera que abriera la base, y en una sustentación eso es justo lo
   que se mira.

   No lleva guardia de sesión a propósito: son datos agregados que ya se
   deducen de la cartelera pública, y los ve quien todavía no ha entrado. */
const express = require('express');
const pool = require('../db');

const router = express.Router();

router.get('/home', async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        /* Activo = todavía se puede asistir: ni cancelado, ni terminado. */
        (SELECT COUNT(*) FROM events
          WHERE status NOT IN ('Cancelado', 'Finalizado')
            AND ends_at > NOW())::int AS eventos_activos,

        /* Las canceladas no cuentan: no representan una asistencia. */
        (SELECT COUNT(*) FROM reservations
          WHERE status <> 'Cancelada'
            AND EXTRACT(YEAR FROM created_at AT TIME ZONE 'America/Bogota')
                = EXTRACT(YEAR FROM NOW() AT TIME ZONE 'America/Bogota'))::int AS reservas_anio,

        /* Ciudades donde hay cartelera, no las 1.122 del catálogo DANE. */
        (SELECT COUNT(DISTINCT city_id) FROM events)::int AS ciudades
    `);

    return res.json({
      year: new Date().getFullYear(),
      ...result.rows[0]
    });
  } catch (error) { return next(error); }
});

module.exports = router;
