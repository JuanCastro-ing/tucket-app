/* El correo identifica la cuenta, y debe ser único en TODO el sistema.

   Cada tabla tiene su propio UNIQUE, pero eso solo impide repetirlo
   dentro de la misma tabla. Nada impedía que el mismo correo existiera a
   la vez como cliente y como agente, y entonces al iniciar sesión solo
   entraba el rol de mayor privilegio: la otra cuenta quedaba inaccesible
   sin que nadie supiera por qué.

   Esta comprobación se hace antes de crear cualquier cuenta. No sustituye
   al UNIQUE de cada tabla: entre que se consulta y se inserta podrían
   colarse dos peticiones simultáneas, y ahí es la base la que manda. Esto
   da el mensaje claro; el UNIQUE da la garantía. */

const pool = require('./db');

const TABLAS = [
  { tabla: 'clientes', rol: 'cliente' },
  { tabla: 'agentes',  rol: 'agente' },
  { tabla: 'administradores',  rol: 'administrador' }
];

/* Devuelve el rol que ya usa ese correo, o null si está libre.
   `ejecutor` permite pasar el cliente de una transacción en curso. */
async function rolQueYaUsaElCorreo(email, ejecutor) {
  const db = ejecutor || pool;
  const correo = String(email || '').trim().toLowerCase();
  if (!correo) return null;

  for (const { tabla, rol } of TABLAS) {
    const r = await db.query(`SELECT 1 FROM ${tabla} WHERE correo = $1`, [correo]);
    if (r.rowCount) return rol;
  }
  return null;
}

/* Mensaje para el usuario. No dice en qué rol está registrado cuando el
   que pregunta no tiene por qué saberlo: basta con que el correo ya está
   en uso. */
function mensajeCorreoOcupado() {
  return 'Ese correo ya está registrado en TUCKET. Inicia sesión o usa otro correo.';
}

module.exports = { rolQueYaUsaElCorreo, mensajeCorreoOcupado };
