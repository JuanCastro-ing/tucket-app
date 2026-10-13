require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db');

async function setup() {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const geography = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'db', 'colombia-divipola.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (!Array.isArray(geography) || geography.length < 1000) {
    throw new Error('El catálogo DIVIPOLA está vacío o incompleto.');
  }
  const titleCase = (value) => String(value).toLocaleLowerCase('es-CO')
    .replace(/(^|[\s-])(\p{L})/gu, (_match, separator, letter) => separator + letter.toLocaleUpperCase('es-CO'));
  const departments = Array.from(new Map(geography.map((row) => [row.cod_dpto, {
    code: `CO-${row.cod_dpto}`, name: titleCase(row.dpto)
  }])).values());
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(schema);
    await client.query("INSERT INTO countries (code, name) VALUES ('CO', 'Colombia') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name");
    await client.query(
      `INSERT INTO departments (code, country_code, name)
       SELECT d.code, 'CO', d.name
       FROM jsonb_to_recordset($1::jsonb) AS d(code text, name text)
       ON CONFLICT (code) DO UPDATE SET country_code = EXCLUDED.country_code, name = EXCLUDED.name`,
      [JSON.stringify(departments)]
    );
    const cities = geography.map((row) => ({
      daneCode: row.cod_mpio,
      departmentCode: `CO-${row.cod_dpto}`,
      name: titleCase(row.nom_mpio)
    }));
    await client.query(
      `INSERT INTO cities (country_code, department_code, dane_code, name)
       SELECT 'CO', c.department_code, c.dane_code, c.name
       FROM jsonb_to_recordset($1::jsonb) AS c(dane_code text, department_code text, name text)
       ON CONFLICT (dane_code) DO UPDATE
       SET department_code = EXCLUDED.department_code, country_code = EXCLUDED.country_code, name = EXCLUDED.name`,
      [JSON.stringify(cities)]
    );
    await client.query('COMMIT');
    console.log(`Esquema instalado; ${departments.length} departamentos y ${cities.length} municipios cargados.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

setup().catch((error) => {
  console.error('No se pudo preparar la base de datos:', error.message);
  process.exitCode = 1;
  pool.end();
});
