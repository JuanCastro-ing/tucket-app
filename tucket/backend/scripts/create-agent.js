require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const bcrypt = require('bcryptjs');
const pool = require('../src/db');
const { rolQueYaUsaElCorreo } = require('../src/correos');

async function createAgent() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const fullName = (await rl.question('Nombre del agente: ')).trim();
    const email = (await rl.question('Correo del agente: ')).trim().toLowerCase();
    const password = await rl.question('Contraseña (mínimo 10 caracteres): ');
    if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10) {
      throw new Error('Nombre, correo válido y contraseña de al menos 10 caracteres son obligatorios.');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    /* El correo debe estar libre en las tres tablas: si ya existe en
       otra, la cuenta nueva nacería inaccesible. */
    const ocupado = await rolQueYaUsaElCorreo(email);
    if (ocupado) {
      console.error(`Ese correo ya tiene una cuenta de ${ocupado}. Usa otro correo.`);
      process.exit(1);
    }

    await pool.query(
      'INSERT INTO agents (full_name, email, password_hash) VALUES ($1, $2, $3)',
      [fullName, email, passwordHash]
    );
    console.log(`Agente ${email} creado. Ya puede iniciar sesión en TUCKET.`);
  } finally {
    rl.close();
    await pool.end();
  }
}

createAgent().catch((error) => {
  console.error('No se pudo crear el agente:', error.code === '23505' ? 'ese correo ya está registrado.' : error.message);
  process.exitCode = 1;
  pool.end();
});
