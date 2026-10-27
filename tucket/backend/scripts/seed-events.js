/* Carga en la base los 7 eventos que antes estaban escritos a mano en
   js/events.js, cada uno con su afiche de img/events/.
   Es idempotente: si el código ya existe, actualiza en vez de duplicar.
   Uso: npm run db:seed */
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const pool = require('../src/db');

/* dane_code evita ambigüedades: hay varios municipios con el mismo nombre. */
const EVENTOS = [
  {
    code: 'DEMO-001', name: 'Noche de Salsa — Grupo Niche Tributo',
    description: 'Una noche de salsa en vivo para disfrutar los clásicos de la música caleña.',
    venue: 'Teatro Los Cristales', dane: '76001',
    startsAt: '2026-11-14T20:00:00-05:00', endsAt: '2026-11-14T23:00:00-05:00',
    capacity: 1200, price: 85000, status: 'En Boletería',
    observations: 'Apertura de puertas una hora antes.'
  },
  {
    code: 'DEMO-002', name: 'Festival Rock a la Cañada',
    description: 'Festival de música al aire libre con bandas locales y nacionales.',
    venue: 'Parque de la Salsa', dane: '76001',
    startsAt: '2026-10-10T21:00:00-05:00', endsAt: '2026-10-11T02:00:00-05:00',
    capacity: 3000, price: 120000, status: 'En Boletería',
    observations: 'Evento al aire libre. Se suspende solo por condiciones climáticas extremas.'
  },
  {
    code: 'DEMO-003', name: 'Romeo y Julieta — Compañía Nacional de Teatro',
    description: 'Una puesta en escena de la obra clásica de Shakespeare.',
    venue: 'Teatro Municipal Enrique Buenaventura', dane: '76001',
    startsAt: '2026-12-02T19:30:00-05:00', endsAt: '2026-12-02T22:00:00-05:00',
    capacity: 800, price: 52000, status: 'Programado',
    observations: 'Recomendado para mayores de 12 años.'
  },
  {
    code: 'DEMO-004', name: 'Concierto de Fin de Año — Orquesta Filarmónica',
    description: 'Concierto especial de temporada con el repertorio clásico de fin de año.',
    venue: 'Teatro Jorge Isaacs', dane: '76001',
    startsAt: '2026-12-20T18:00:00-05:00', endsAt: '2026-12-20T21:00:00-05:00',
    capacity: 900, price: 65000, status: 'Programado',
    observations: 'Código de vestimenta formal.'
  },
  {
    code: 'DEMO-005', name: 'Stand Up Comedy Night',
    description: 'Una noche de comedia en vivo con comediantes invitados.',
    venue: 'Sala Beethoven', dane: '11001',
    startsAt: '2026-11-28T20:30:00-05:00', endsAt: '2026-11-28T22:30:00-05:00',
    capacity: 350, price: 40000, status: 'En Boletería',
    observations: 'Contenido para mayores de 18 años.'
  },
  {
    code: 'DEMO-006', name: 'Feria de Cali — Show de Salsódromo',
    description: 'Espectáculo de salsa y tradición caleña en el marco de la Feria.',
    venue: 'Autódromo de Palmaseca', dane: '76001',
    startsAt: '2026-09-03T19:00:00-05:00', endsAt: '2026-09-03T23:00:00-05:00',
    capacity: 5000, price: 95000, status: 'Programado',
    observations: 'Ingreso por las puertas 3 y 4.'
  },
  {
    code: 'DEMO-007', name: 'Noche de Orquesta — Banda Sinfónica de Tuluá',
    description: 'Concierto de la banda sinfónica en el marco de la temporada cultural.',
    venue: 'Teatro Municipal Ángel María Camacho', dane: '76834',
    startsAt: '2026-11-21T19:00:00-05:00', endsAt: '2026-11-21T21:30:00-05:00',
    capacity: 650, price: 38000, status: 'En Boletería',
    observations: 'Entrada libre para estudiantes con carné.'
  }
];

async function seed() {
  const agente = await pool.query('SELECT id, full_name FROM agents WHERE active = TRUE ORDER BY id LIMIT 1');
  if (!agente.rowCount) {
    throw new Error('No hay agentes en la base. Crea uno primero con: npm run agent:create');
  }
  const agentId = agente.rows[0].id;

  const client = await pool.connect();
  let creados = 0;
  let actualizados = 0;
  try {
    await client.query('BEGIN');
    for (const evento of EVENTOS) {
      const ciudad = await client.query(
        'SELECT id, country_code, department_code, name FROM cities WHERE dane_code = $1',
        [evento.dane]
      );
      if (!ciudad.rowCount) {
        throw new Error(`No se encontró el municipio ${evento.dane}. Corre primero: npm run db:setup`);
      }
      const c = ciudad.rows[0];
      /* El afiche vive en el árbol del frontend porque viene con el proyecto;
         los que suba un agente van a /uploads/events/. */
      const imagePath = `/img/events/${evento.code.toLowerCase()}.jpg`;
      const imageAlt = `Afiche del evento ${evento.name}`;

      const resultado = await client.query(
        `INSERT INTO events
          (code, name, description, venue, starts_at, ends_at, total_capacity, base_price,
           observations, status, country_code, department_code, city_id, agent_id,
           image_path, image_alt)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (code) DO UPDATE SET
           name = EXCLUDED.name, description = EXCLUDED.description, venue = EXCLUDED.venue,
           starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
           total_capacity = EXCLUDED.total_capacity, base_price = EXCLUDED.base_price,
           observations = EXCLUDED.observations,
           image_path = EXCLUDED.image_path, image_alt = EXCLUDED.image_alt
         RETURNING (xmax = 0) AS insertado`,
        [evento.code, evento.name, evento.description, evento.venue, evento.startsAt, evento.endsAt,
          evento.capacity, evento.price, evento.observations, evento.status,
          c.country_code, c.department_code, c.id, agentId, imagePath, imageAlt]
      );
      if (resultado.rows[0].insertado) creados++; else actualizados++;
      console.log(`  ✓ ${evento.code}  ${evento.name}  (${c.name})`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  console.log(`\n${creados} eventos creados, ${actualizados} actualizados.`);
  return { creados, actualizados, agente: agente.rows[0].full_name };
}

module.exports = { seed };

/* Ejecutado directamente: npm run db:seed */
if (require.main === module) {
  seed()
    .then((r) => {
      console.log(`Quedaron a nombre del agente: ${r.agente}`);
      return pool.end();
    })
    .catch((error) => {
      console.error('No se pudieron cargar los eventos:', error.message);
      process.exitCode = 1;
      pool.end();
    });
}
