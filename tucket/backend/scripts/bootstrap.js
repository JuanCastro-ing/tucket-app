/* Puesta en marcha completa en un solo comando:  npm run setup
     1. Verifica backend/.env (lo crea desde .env.example si falta).
     2. Prueba la conexión y explica cualquier fallo.
     3. Instala el esquema y carga la geografía.
     4. Crea la primera cuenta de agente si todavía no hay ninguna.
     5. Carga los 7 eventos de ejemplo con sus afiches.
   Se puede repetir las veces que haga falta: no borra nada. */
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');

const RAIZ = path.join(__dirname, '..');
const ENV = path.join(RAIZ, '.env');
const EJEMPLO = path.join(RAIZ, '.env.example');

function titulo(texto) {
  console.log(`\n${texto}\n${'─'.repeat(texto.length)}`);
}

/* Paso 0: el archivo .env debe existir y estar completo antes de cargar
   src/db.js, que lanza si falta DATABASE_URL. */
function revisarEnv() {
  if (!fs.existsSync(ENV)) {
    fs.copyFileSync(EJEMPLO, ENV);
    console.log('Se creó backend/.env a partir de .env.example.');
    console.log('\nFalta completarlo antes de seguir:');
    console.log('  1. DATABASE_URL → la "Pooled connection" de tu proyecto en Neon');
    console.log('     (Neon → Connect → Connection string → Pooled connection)');
    console.log('  2. JWT_SECRET   → genera uno con:');
    console.log('     node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
    console.log('\nCuando lo tengas, vuelve a correr: npm run setup');
    return false;
  }

  require('dotenv').config({ path: ENV });

  const faltantes = [];
  const url = process.env.DATABASE_URL || '';
  const secreto = process.env.JWT_SECRET || '';
  if (!url || /CAMBIA|USUARIO:CLAVE|ep-xxxx/i.test(url)) faltantes.push('DATABASE_URL (pega la cadena de Neon)');
  if (!secreto || secreto.length < 32 || secreto.includes('CAMBIA')) {
    faltantes.push('JWT_SECRET (mínimo 32 caracteres)\n     node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  }
  if (faltantes.length) {
    console.log('Hay que completar backend/.env:');
    faltantes.forEach((f) => console.log(`  · ${f}`));
    return false;
  }
  return true;
}

async function main() {
  titulo('TUCKET · puesta en marcha');

  if (!revisarEnv()) {
    process.exitCode = 1;
    return;
  }

  /* Se cargan después de validar .env: estos módulos leen las variables. */
  const pool = require('../src/db');
  const { probarConexion, hostSeguro } = require('./diagnostico');
  const { setup } = require('./setup-db');
  const { seed } = require('./seed-events');
  const bcrypt = require('bcryptjs');

  try {
    titulo('1 · Conexión');
    const info = await probarConexion();
    console.log(`  Servidor : ${hostSeguro(process.env.DATABASE_URL)}`);
    console.log(`  Base     : ${info.base}  ·  usuario: ${info.usuario}`);
    console.log(`  Tipo     : ${info.esNeon ? 'Neon (TLS)' : 'PostgreSQL'}  ·  ${info.ms} ms`);
    info.avisos.forEach((a) => console.log(`  Aviso    : ${a.texto}`));

    titulo('2 · Esquema y geografía');
    const esquema = await setup();
    console.log(`  ${esquema.tablas.length} tablas · ${esquema.departamentos} departamentos · ${esquema.municipios} municipios`);

    titulo('3 · Cuenta de agente');
    const agentes = await pool.query('SELECT count(*)::int AS total FROM agents WHERE active = TRUE');
    if (agentes.rows[0].total > 0) {
      console.log(`  Ya existen ${agentes.rows[0].total} agente(s). No se crea ninguno.`);
    } else {
      const rl = readline.createInterface({ input: stdin, output: stdout });
      /* Si la entrada se cierra (por ejemplo al correr el script con una
         tubería), se avisa en vez de terminar en silencio. */
      const preguntar = async (texto) => {
        const respuesta = await rl.question(texto);
        if (respuesta === undefined || respuesta === null) {
          throw new Error('Este paso necesita una terminal interactiva. Corre "npm run setup" directamente, o crea el agente con "npm run agent:create".');
        }
        return respuesta;
      };
      try {
        console.log('  No hay agentes todavía. Vamos a crear el primero.');
        const fullName = (await preguntar('  Nombre del agente: ')).trim();
        const email = (await preguntar('  Correo: ')).trim().toLowerCase();
        const password = await preguntar('  Contraseña (mínimo 10 caracteres): ');
        if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10) {
          throw new Error('Nombre, correo válido y contraseña de al menos 10 caracteres son obligatorios.');
        }
        await pool.query(
          'INSERT INTO agents (full_name, email, password_hash) VALUES ($1, $2, $3)',
          [fullName, email, await bcrypt.hash(password, 12)]
        );
        console.log(`  Agente ${email} creado.`);
      } finally {
        rl.close();
      }
    }

    titulo('4 · Eventos de ejemplo');
    const eventos = await seed();
    console.log(`  ${eventos.creados} creados · ${eventos.actualizados} actualizados · agente: ${eventos.agente}`);

    titulo('Listo');
    console.log('  Arranca el servidor con:  npm start');
    console.log('  Y abre:                   http://localhost:' + (process.env.PORT || 8000));
  } catch (error) {
    console.error('\nSe detuvo la puesta en marcha:\n  ' + error.message);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
