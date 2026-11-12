/* Asigna una contraseña nueva a una cuenta existente.

   Tucket no tiene recuperación por correo: no hay servidor de envío ni
   tabla de tokens, y montar eso para un proyecto de aula sería más
   superficie de la que se puede defender. La alternativa honesta es esta:
   quien administra la base asigna una contraseña provisional y la entrega
   por fuera del sistema, igual que hacen muchas intranets.

   Sirve para las tres tablas de cuentas. El correo identifica la cuenta
   en todo el sistema (ver src/correos.js), así que basta con buscar en
   cuál de las tres está.

   Uso:
     npm run pass:reset

   La contraseña se escribe en la consola y no se guarda en ninguna parte:
   lo que se almacena es su hash bcrypt, igual que al crear la cuenta. */

require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const bcrypt = require('bcryptjs');
const pool = require('../src/db');

const TABLAS = [
  { tabla: 'clientes', rol: 'cliente' },
  { tabla: 'agentes',  rol: 'agente' },
  { tabla: 'administradores',  rol: 'administrador' }
];

const MINIMO = 10;   /* el mismo mínimo que exige el registro */

async function buscarCuenta(correo) {
  for (const { tabla, rol } of TABLAS) {
    const r = await pool.query(
      `SELECT id, nombre_completo AS "full_name" FROM ${tabla} WHERE correo = $1`, [correo]
    );
    if (r.rowCount) return { tabla, rol, ...r.rows[0] };
  }
  return null;
}

async function resetPassword() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const correo = (await rl.question('Correo de la cuenta: ')).trim().toLowerCase();
    if (!correo) throw new Error('Hace falta el correo.');

    const cuenta = await buscarCuenta(correo);
    if (!cuenta) {
      console.error(`No hay ninguna cuenta con el correo ${correo}.`);
      process.exit(1);
    }

    console.log(`Cuenta encontrada: ${cuenta.full_name} (${cuenta.rol}).`);
    const nueva = await rl.question(`Contraseña nueva (mínimo ${MINIMO} caracteres): `);
    if (nueva.length < MINIMO) {
      throw new Error(`La contraseña debe tener al menos ${MINIMO} caracteres.`);
    }
    const repetida = await rl.question('Repítela: ');
    if (nueva !== repetida) throw new Error('Las dos contraseñas no coinciden.');

    const hash = await bcrypt.hash(nueva, 12);
    await pool.query(
      `UPDATE ${cuenta.tabla} SET clave_hash = $1 WHERE id = $2`,
      [hash, cuenta.id]
    );

    console.log(`\nListo. ${cuenta.full_name} ya puede entrar con la contraseña nueva.`);
    console.log('Entrégasela por un medio directo y pídele que la cambie');
    console.log('desde Mi perfil en cuanto entre.');
  } finally {
    rl.close();
    await pool.end();
  }
}

/* El pool se cierra en el finally de arriba, pase lo que pase. Volver a
   cerrarlo aquí lanzaría «Called end on pool more than once» y taparía el
   error real con uno falso. */
resetPassword().catch((error) => {
  console.error('No se pudo cambiar la contraseña:', error.message);
  process.exitCode = 1;
});
