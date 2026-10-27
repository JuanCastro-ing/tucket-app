/* TUCKET — Servidor.
   Este archivo solo arma la aplicación: cada módulo de la API vive en
   src/routes/. Para tocar una funcionalidad se va directo a su archivo.

     src/routes/auth.routes.js          sesión (agentes y clientes)
     src/routes/geography.routes.js     país → departamento → ciudad
     src/routes/events.routes.js        eventos y afiches
     src/routes/clients.routes.js       registro de clientes
     src/routes/reservations.routes.js  reservas y boletas
*/
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('node:path');
const pool = require('./db');
const { DIRECTORIO: DIRECTORIO_AFICHES } = require('./images');

const app = express();
const projectRoot = path.resolve(__dirname, '..', '..');

app.disable('x-powered-by');
app.use(cookieParser());

/* El código del backend nunca se sirve como estático. */
app.use('/backend', (_req, res) => res.status(404).end());

/* Afiches subidos por los agentes. Viven fuera del árbol del frontend para
   que un `git clean` del sitio no se lleve los archivos de los usuarios. */
app.use('/uploads/events', express.static(DIRECTORIO_AFICHES, {
  maxAge: '7d',
  index: false,
  dotfiles: 'ignore'
}));

app.use(express.static(projectRoot, { index: 'index.html' }));

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', host: pool.isNeon ? 'neon' : 'postgres' });
  } catch {
    res.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/geography', require('./routes/geography.routes'));
app.use('/api/events', require('./routes/events.routes'));
app.use('/api/clients', require('./routes/clients.routes'));
app.use('/api/reservations', require('./routes/reservations.routes'));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta de API no encontrada.' }));

app.use((error, _req, res, _next) => {
  /* Cuerpo demasiado grande: casi siempre es un afiche pesado. */
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'El contenido es demasiado grande. Si estás subiendo un afiche, usa una imagen de menos de 4 MB.' });
  }
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ error: 'La solicitud no tiene un formato válido.' });
  }
  console.error(error);
  return res.status(500).json({ error: 'Ocurrió un error interno. Revisa la conexión con PostgreSQL.' });
});

async function start() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32 || secret.includes('CAMBIA')) {
    throw new Error('Configura JWT_SECRET en backend/.env con un secreto aleatorio de al menos 32 caracteres.');
  }
  await pool.query('SELECT 1');
  const port = Number(process.env.PORT || 8000);
  app.listen(port, () => {
    console.log(`TUCKET listo en http://localhost:${port}`);
    console.log(pool.isNeon ? 'Base de datos: Neon (PostgreSQL en la nube)' : 'Base de datos: PostgreSQL');
  });
}

start().catch((error) => {
  console.error('No se pudo iniciar TUCKET:', error.message);
  process.exitCode = 1;
  pool.end();
});
