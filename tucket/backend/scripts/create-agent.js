require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const bcrypt = require('bcryptjs');
const pool = require('../src/db');

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
