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

    /* Documento, comisión y experiencia: los datos del agente que pide el
       enunciado. Se preguntan aquí porque es quien administra la
       plataforma el que los fija, no el agente sobre sí mismo. */
    const documentNumber = (await rl.question('Número de identificación (vacío para omitir): ')).trim();
    const documentType = documentNumber
      ? ((await rl.question('Tipo de documento [CC/PAS] (CC): ')).trim().toUpperCase() || 'CC')
      : null;
    if (documentType && !['CC', 'PAS'].includes(documentType)) {
      throw new Error('El tipo de documento debe ser CC o PAS.');
    }

    const comision = Number((await rl.question('Comisión en porcentaje (0): ')).trim() || '0');
    if (!Number.isFinite(comision) || comision < 0 || comision > 100) {
      throw new Error('La comisión debe ser un número entre 0 y 100.');
    }

    const experiencia = Number((await rl.question('Años de experiencia (0): ')).trim() || '0');
    if (!Number.isInteger(experiencia) || experiencia < 0 || experiencia > 70) {
      throw new Error('La experiencia debe ser un número entero de años entre 0 y 70.');
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
      `INSERT INTO agentes (nombre_completo, correo, clave_hash,
                           tipo_documento, numero_documento,
                           comision, anios_experiencia)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [fullName, email, passwordHash,
        documentType, documentNumber || null, comision, experiencia]
    );
    console.log(`Agente ${email} creado con ${comision}% de comisión y ${experiencia} años de experiencia.`);
    console.log('Ya puede iniciar sesión en TUCKET.');
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
