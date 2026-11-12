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

/* El DANE entrega los nombres en mayúscula sostenida ("VALLE DEL CAUCA").
   Pasarlos a capitular palabra por palabra dejaba "Valle Del Cauca" y
   "Santiago De Cali", que no es como se escriben ni como aparecen en el
   resto de la aplicación. Los conectores van en minúscula salvo cuando
   abren el nombre. */
const CONECTORES = new Set(['de', 'del', 'la', 'las', 'lo', 'los', 'y', 'e', 'el', 'en']);

function titleCase(value) {
  return String(value).toLocaleLowerCase('es-CO')
    .replace(/(^|[\s-])([\p{L}\p{M}]+(?:\.[\p{L}\p{M}]+)*\.?)/gu, (completo, separador, palabra, posicion) => {
      /* Siglas con punto ("d.c." → "D.C.") van completas en mayúscula. */
      if (palabra.includes('.')) return separador + palabra.toLocaleUpperCase('es-CO');
      if (posicion > 0 && CONECTORES.has(palabra)) return separador + palabra;
      return separador + palabra.charAt(0).toLocaleUpperCase('es-CO') + palabra.slice(1);
    });
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
    codigo: `CO-${row.cod_dpto}`, nombre: titleCase(row.dpto)
  }])).values());
  const cities = geography.map((row) => ({
    codigo_dane: row.cod_mpio,
    codigo_departamento: `CO-${row.cod_dpto}`,
    nombre: titleCase(row.nom_mpio)
  }));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const file of files) {
      await client.query(fs.readFileSync(path.join(dbDir, file), 'utf8'));
      console.log(`  ✓ ${file}`);
    }

    await client.query(
      "INSERT INTO paises (codigo, nombre) VALUES ('CO', 'Colombia') ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre"
    );
    await client.query(
      `INSERT INTO departamentos (codigo, codigo_pais, nombre)
       SELECT d.codigo AS "code", 'CO', d.nombre AS "name"
       FROM jsonb_to_recordset($1::jsonb) AS d(codigo text, nombre text)
       ON CONFLICT (codigo) DO UPDATE SET codigo_pais = EXCLUDED.codigo_pais, nombre = EXCLUDED.nombre`,
      [JSON.stringify(departments)]
    );
    await client.query(
      `INSERT INTO ciudades (codigo_pais, codigo_departamento, codigo_dane, nombre)
       SELECT 'CO', c.codigo_departamento AS "department_code", c.codigo_dane AS "dane_code", c.nombre AS "name"
       FROM jsonb_to_recordset($1::jsonb) AS c(codigo_dane text, codigo_departamento text, nombre text)
       ON CONFLICT (codigo_dane) DO UPDATE
       SET codigo_departamento = EXCLUDED.codigo_departamento, codigo_pais = EXCLUDED.codigo_pais, nombre = EXCLUDED.nombre`,
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
