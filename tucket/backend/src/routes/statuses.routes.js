/* Rutas del catálogo de estados: /api/statuses

   Lo consume el navegador para dos cosas que antes estaban escritas a
   mano en el HTML y el JavaScript: el contenido de los desplegables de
   estado y el color de cada etiqueta.

   Es pública porque no revela nada: son las mismas etiquetas que
   cualquiera ve en la cartelera. */
const express = require('express');
const { cargar } = require('../estados');

const router = express.Router();

router.get('/', async (_req, res, next) => {
  try {
    const catalogo = await cargar();

    /* Se devuelven solo las columnas que el navegador necesita. Las
       banderas de comportamiento que solo usa el servidor —como
       occupies_seat, que gobierna la disponibilidad— no salen de aquí:
       quien decide sobre butacas es la base, no el navegador. */
    res.set('Cache-Control', 'public, max-age=300');
    return res.json({
      eventos: catalogo.eventos.map((e) => ({
        code: e.code, label: e.label, badgeClass: e.badge_class,
        allowsReservation: e.allows_reservation, isFinal: e.is_final,
        allowedAsInitial: e.allowed_as_initial,
        requiresReason: e.requires_reason
      })),
      reservas: catalogo.reservas.map((r) => ({
        code: r.code, label: r.label, badgeClass: r.badge_class, isFinal: r.is_final
      })),
      solicitudes: catalogo.solicitudes.map((s) => ({
        code: s.code, label: s.label, badgeClass: s.badge_class
      }))
    });
  } catch (error) { return next(error); }
});

module.exports = router;
