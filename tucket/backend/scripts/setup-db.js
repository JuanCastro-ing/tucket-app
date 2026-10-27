/* Instala el esquema completo y carga el catálogo de geografía.
   Es idempotente: se puede volver a correr sobre una base ya creada.
   Uso: npm run db:setup */
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db');

const dbDir = path.join(__dirname, '..', 'db');

/* Los módulos del esquema se ejecutan en orden numérico: la geografía debe
   existir antes que los eventos, y los clientes antes que las reservas. */
function schemaFiles() {
  return fs.readdirSync(dbDir)
    .filter((file) => /^\d{2}-.+\.sql$/.test(file))
    .sort();
}

function titleCase(value) {
  return String(value).toLocaleLowerCase('es-CO')
    .replace(/(^|[\s-])(\p{L})/gu, (_m, separator, letter) => separator + letter.toLocaleUpperCase('es-CO'));
}

async function setup() {
  const files = schemaFiles();
  if (!files.length) throw new Error('No se encontraron archivos de esquema en backend/db.');

  const geography = JSON.parse(
    fs.readFileSync(path.join(dbDir, 'colombia-divipola.json'), 'utf8').replace(/^﻿/, '')
  );
  if (!Array.isArray(geography) || geography.length < 1000) {
    throw new Error('El catálogo DIVIPOLA está vacío o incompleto.');
  }

  const departments = Array.from(new Map(geography.map((row) => [row.cod_dpto, {
    code: `CO-${row.cod_dpto}`, name: titleCase(row.dpto)
  }])).values());
  const cities = geography.map((row) => ({
    dane_code: row.cod_mpio,
    department_code: `CO-${row.cod_dpto}`,
    name: titleCase(row.nom_mpio)
  }));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const file of files) {
      await client.query(fs.readFileSync(path.join(dbDir, file), 'utf8'));
      console.log(`  ✓ ${file}`);
    }

    await client.query(
      "INSERT INTO countries (code, name) VALUES ('CO', 'Colombia') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name"
    );
    await client.query(
      `INSERT INTO departments (code, country_code, name)
       SELECT d.code, 'CO', d.name
       FROM jsonb_to_recordset($1::jsonb) AS d(code text, name text)
       ON CONFLICT (code) DO UPDATE SET country_code = EXCLUDED.country_code, name = EXCLUDED.name`,
      [JSON.stringify(departments)]
    );
    await client.query(
      `INSERT INTO cities (country_code, department_code, dane_code, name)
       SELECT 'CO', c.department_code, c.dane_code, c.name
       FROM jsonb_to_recordset($1::jsonb) AS c(dane_code text, department_code text, name text)
       ON CONFLICT (dane_code) DO UPDATE
       SET department_code = EXCLUDED.department_code, country_code = EXCLUDED.country_code, name = EXCLUDED.name`,
      [JSON.stringify(cities)]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
  );
  console.log(`\nTablas en la base: ${rows.map((r) => r.table_name).join(', ')}`);
  console.log(`${departments.length} departamentos y ${cities.length} municipios cargados.`);
  console.log(pool.isNeon ? 'Conectado a Neon (TLS).' : 'Conectado a PostgreSQL.');
  return { departamentos: departments.length, municipios: cities.length, tablas: rows.map((r) => r.table_name) };
}

module.exports = { setup };

/* Ejecutado directamente: npm run db:setup */
if (require.main === module) {
  setup()
    .then(() => {
      console.log('\nSiguiente paso: npm run agent:create  y luego  npm run db:seed');
      return pool.end();
    })
    .catch((error) => {
      console.error('No se pudo preparar la base de datos:', error.message);
      process.exitCode = 1;
      pool.end();
    });
}
