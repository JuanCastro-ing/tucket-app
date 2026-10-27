/* Diagnóstico de la conexión a la base de datos.
   Traduce los errores crudos de PostgreSQL y de Neon a algo accionable. */
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });

/* El pool se carga cuando se necesita: src/db.js lanza si falta
   DATABASE_URL, y aquí ese caso debe salir como un mensaje claro y no
   como un volcado de pila. */
function obtenerPool() {
  return require('../src/db');
}

/* Pistas sobre la cadena de conexión, antes de intentar conectarse. */
function revisarCadena(url) {
  const avisos = [];
  const esNeon = /\.neon\.tech/i.test(url);

  if (!/^postgres(ql)?:\/\//i.test(url)) {
    avisos.push({ nivel: 'error', texto: 'DATABASE_URL debe empezar por postgresql://' });
  }
  if (/CAMBIA|USUARIO:CLAVE|ep-xxxx/i.test(url)) {
    avisos.push({ nivel: 'error', texto: 'DATABASE_URL todavía tiene el valor de ejemplo: pega la cadena real de Neon.' });
  }
  if (esNeon && !/-pooler\./i.test(url)) {
    avisos.push({
      nivel: 'aviso',
      texto: 'Estás usando la conexión DIRECTA de Neon. Copia la "Pooled connection" (el host lleva -pooler): la directa se queda sin conexiones.'
    });
  }
  if (esNeon && !/sslmode=require/i.test(url)) {
    avisos.push({ nivel: 'aviso', texto: 'A la cadena le falta ?sslmode=require al final.' });
  }
  return { esNeon, avisos };
}

/* Mensaje útil según el error que devuelve el driver. */
function explicar(error) {
  const codigo = error.code || '';
  const mensaje = error.message || '';

  if (codigo === 'ENOTFOUND' || /getaddrinfo/i.test(mensaje)) {
    return 'No se pudo resolver el servidor. Revisa que el host de la cadena esté completo y que tengas internet.';
  }
  if (codigo === 'ETIMEDOUT' || /timeout/i.test(mensaje)) {
    return 'La conexión se agotó. Si el proyecto de Neon estaba suspendido, espera unos segundos y vuelve a intentar; si persiste, revisa tu firewall para el puerto 5432.';
  }
  if (codigo === 'ECONNREFUSED') {
    return 'El servidor rechazó la conexión. Si apuntas a PostgreSQL local, verifica que el servicio esté arrancado.';
  }
  if (codigo === '28P01') return 'Usuario o contraseña incorrectos. Vuelve a copiar la cadena desde Neon (la clave se muestra una sola vez).';
  if (codigo === '3D000') return 'La base indicada no existe. Revisa el nombre que va después de la última barra de la cadena.';
  if (codigo === '28000' && /SSL off/i.test(mensaje)) return 'El servidor exige TLS: agrega ?sslmode=require al final de la cadena.';
  if (/self.signed|certificate/i.test(mensaje)) return 'El certificado no se pudo verificar. Como último recurso, pon DB_SSL_INSECURE=true en backend/.env.';
  if (codigo === '53300' || /too many clients|remaining connection slots/i.test(mensaje)) {
    return 'Se acabaron las conexiones: estás usando la cadena directa de Neon. Cambia a la "Pooled connection".';
  }
  return mensaje;
}

/* Intenta conectarse y devuelve datos del servidor. Lanza con mensaje claro. */
async function probarConexion() {
  const url = process.env.DATABASE_URL || '';
  if (!url) {
    throw new Error('Falta DATABASE_URL en backend/.env. Copia .env.example a .env y pega la cadena de Neon.');
  }
  const { esNeon, avisos } = revisarCadena(url);

  const bloqueantes = avisos.filter((a) => a.nivel === 'error');
  if (bloqueantes.length) {
    throw new Error(bloqueantes.map((a) => a.texto).join('\n'));
  }

  const pool = obtenerPool();
  const inicio = Date.now();
  try {
    const { rows } = await pool.query(
      "SELECT current_database() AS base, current_user AS usuario, version() AS version"
    );
    return { ...rows[0], ms: Date.now() - inicio, esNeon, avisos };
  } catch (error) {
    const detalle = new Error(explicar(error));
    detalle.original = error;
    throw detalle;
  }
}

/* Nombre del host sin credenciales: nunca se imprime la contraseña. */
function hostSeguro(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return '(cadena no válida)';
  }
}

module.exports = { probarConexion, revisarCadena, explicar, hostSeguro };

/* Ejecutado directamente: npm run db:check */
if (require.main === module) {
  probarConexion()
    .then((info) => {
      console.log(`Conexión correcta (${info.ms} ms)`);
      console.log(`  Servidor : ${hostSeguro(process.env.DATABASE_URL)}`);
      console.log(`  Base     : ${info.base}`);
      console.log(`  Usuario  : ${info.usuario}`);
      console.log(`  Tipo     : ${info.esNeon ? 'Neon (PostgreSQL en la nube, TLS)' : 'PostgreSQL'}`);
      info.avisos.forEach((a) => console.log(`  Aviso    : ${a.texto}`));
      return obtenerPool().end();
    })
    .catch((error) => {
      console.error('No se pudo conectar:\n  ' + error.message);
      process.exitCode = 1;
      if (process.env.DATABASE_URL) obtenerPool().end();
    });
}
