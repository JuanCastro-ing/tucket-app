/* Crea una cuenta de administrador.
   Uso:  npm run admin:create
   O sin preguntas:  node scripts/create-admin.js "Nombre" correo@dominio.co "contraseña"

   Igual que los agentes, los administradores no se auto-registran: si el
   panel que aprueba las solicitudes pudiera crearse a sí mismo desde la
   web, no serviría de filtro. */
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const readline = require('node:readline/promises');
const { stdin, stdout, argv } = require('node:process');
const bcrypt = require('bcryptjs');
const pool = require('../src/db');
const { rolQueYaUsaElCorreo } = require('../src/correos');

async function pedirDatos() {
  /* Los tres argumentos permiten crearlo desde un script. Sin ellos se
     pregunta por teclado, que es el uso normal. */
  if (argv.length >= 5) {
    return { fullName: argv[2].trim(), email: argv[3].trim().toLowerCase(), password: argv[4] };
  }
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    return {
      fullName: (await rl.question('Nombre del administrador: ')).trim(),
      email: (await rl.question('Correo del administrador: ')).trim().toLowerCase(),
      password: await rl.question('Contraseña (mínimo 10 caracteres): ')
    };
  } finally {
    rl.close();
  }
}

async function createAdmin() {
  const { fullName, email, password } = await pedirDatos();
  if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10) {
    throw new Error('Nombre, correo válido y contraseña de al menos 10 caracteres son obligatorios.');
  }

  /* Un correo no puede ser administrador y agente o cliente a la vez: el
     login busca en las tres tablas y el rol saldría de cuál se consulte
     primero, que es justo el tipo de ambigüedad que no debe existir. */
  const ocupado = await rolQueYaUsaElCorreo(email);
  if (ocupado) {
    throw new Error(`ese correo ya está registrado como ${ocupado}. Usa otro.`);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await pool.query(
    'INSERT INTO admins (full_name, email, password_hash) VALUES ($1, $2, $3)',
    [fullName, email, passwordHash]
  );
  console.log(`Administrador ${email} creado. Ya puede iniciar sesión en TUCKET.`);
}

createAdmin()
  .catch((error) => {
    console.error('No se pudo crear el administrador:',
      error.code === '23505' ? 'ese correo ya está registrado.' : error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
