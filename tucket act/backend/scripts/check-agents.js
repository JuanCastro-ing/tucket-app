require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const pool = require('../src/db');

async function checkAgents() {
  try {
    const result = await pool.query('SELECT EXISTS (SELECT 1 FROM agents WHERE active = TRUE) AS exists');
    if (!result.rows[0].exists) {
      console.log('No hay agentes activos; se necesita crear la primera cuenta.');
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

checkAgents().catch((error) => {
  console.error('No se pudieron consultar las cuentas de agentes:', error.message);
  process.exitCode = 1;
  pool.end();
});
