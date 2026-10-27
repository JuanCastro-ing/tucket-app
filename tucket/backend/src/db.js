const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('Falta DATABASE_URL. Copia backend/.env.example a backend/.env y pega la cadena de conexión de Neon.');
}

const connectionString = process.env.DATABASE_URL;

/* ¿Hay que hablar por TLS?
   Neon solo acepta conexiones cifradas, así que se detecta por la propia
   cadena (host .neon.tech o sslmode=require) y no hace falta configurar nada
   a mano. Un PostgreSQL local sin TLS sigue funcionando igual.
     DB_SSL=true|false      fuerza o desactiva TLS.
     DB_SSL_INSECURE=true   acepta certificados no verificables (último recurso). */
function resolveSsl() {
  if (process.env.DB_SSL === 'false') return false;
  const required = process.env.DB_SSL === 'true'
    || /\.neon\.tech/i.test(connectionString)
    || /sslmode=require/i.test(connectionString);
  if (!required) return false;
  return { rejectUnauthorized: process.env.DB_SSL_INSECURE !== 'true' };
}

const isNeon = /\.neon\.tech/i.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: resolveSsl(),
  /* Neon cobra por tiempo de cómputo y suspende el proyecto cuando no hay
     tráfico: conviene un pool pequeño que suelte las conexiones pronto.
     El primer query después de una suspensión tarda unos segundos en
     despertar la base, de ahí el timeout de conexión más holgado. */
  max: isNeon ? 5 : 10,
  idleTimeoutMillis: isNeon ? 10_000 : 30_000,
  connectionTimeoutMillis: isNeon ? 15_000 : 5_000,
  keepAlive: true
});

pool.on('error', (error) => {
  console.error('Error inesperado en el pool de PostgreSQL:', error.message);
});

module.exports = pool;
module.exports.isNeon = isNeon;
