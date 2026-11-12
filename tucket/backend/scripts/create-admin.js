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
    /* Desde script solo llegan los tres datos básicos; el salario y el
       horario se completan después desde la base o volviendo a correrlo
       en modo interactivo. */
    return {
      fullName: argv[2].trim(), email: argv[3].trim().toLowerCase(), password: argv[4],
      documentType: null, documentNumber: null, salary: null, workSchedule: null
    };
  }
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const fullName = (await rl.question('Nombre del administrador: ')).trim();
    const email = (await rl.question('Correo del administrador: ')).trim().toLowerCase();
    const password = await rl.question('Contraseña (mínimo 10 caracteres): ');

    /* Documento, salario y horario: los datos del administrador que pide
       el enunciado. Son opcionales por si la cuenta se crea de afán. */
    const documentNumber = (await rl.question('Número de identificación (vacío para omitir): ')).trim();
    const documentType = documentNumber
      ? ((await rl.question('Tipo de documento [CC/PAS] (CC): ')).trim().toUpperCase() || 'CC')
      : null;
    if (documentType && !['CC', 'PAS'].includes(documentType)) {
      throw new Error('El tipo de documento debe ser CC o PAS.');
    }

    const salarioTexto = (await rl.question('Salario en pesos (vacío para omitir): ')).trim();
    const salary = salarioTexto ? Number(salarioTexto.replace(/[.\s]/g, '')) : null;
    if (salary !== null && (!Number.isFinite(salary) || salary <= 0)) {
      throw new Error('El salario debe ser un número mayor que cero.');
    }

    const workSchedule =
      (await rl.question('Horario (ej. Lunes a viernes, 8:00 a 17:00): ')).trim() || null;

    return { fullName, email, password, documentType,
      documentNumber: documentNumber || null, salary, workSchedule };
  } finally {
    rl.close();
  }
}

async function createAdmin() {
  const { fullName, email, password, documentType, documentNumber,
    salary, workSchedule } = await pedirDatos();
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
    `INSERT INTO admins (full_name, email, password_hash,
                         document_type, document_number, salary, work_schedule)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [fullName, email, passwordHash, documentType, documentNumber, salary, workSchedule]
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
