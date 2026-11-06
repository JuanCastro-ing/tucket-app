#!/usr/bin/env node
/* Revisión de la base de datos: busca incoherencias en los datos.

   Es de SOLO LECTURA. No modifica ni borra nada: solo consulta y reporta.
   Se puede correr contra Neon sin ningún riesgo.

       cd backend
       npm run db:revisar

   Cada comprobación responde a algo que puede haberse colado con el tiempo:
   datos de prueba olvidados, imágenes que quedaron apuntando a archivos que
   ya no existen, eventos con la fecha pasada que siguen vendiendo, cuentas
   repetidas entre tablas… Lo que salga aquí hay que mirarlo a mano: el
   script señala, no arregla. */

require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const pool = require('../src/db');

let problemas = 0;
let avisos = 0;

function titulo(texto) {
  console.log(`\n${texto}`);
  console.log('─'.repeat(texto.length));
}

/* nivel: 'error' = hay que corregirlo; 'aviso' = conviene mirarlo */
function reportar(nivel, mensaje, filas) {
  const marca = nivel === 'error' ? '  ✗' : '  !';
  console.log(`${marca} ${mensaje}`);
  if (filas && filas.length) {
    filas.slice(0, 10).forEach((f) => console.log(`       · ${f}`));
    if (filas.length > 10) console.log(`       … y ${filas.length - 10} más`);
  }
  if (nivel === 'error') problemas += 1; else avisos += 1;
}

function bien(mensaje) {
  console.log(`  ✓ ${mensaje}`);
}

async function filas(sql, params) {
  const r = await pool.query(sql, params || []);
  return r.rows;
}

async function revisar() {
  console.log('\n═══ REVISIÓN DE LA BASE DE DATOS DE TUCKET ═══');
  const quien = await filas('SELECT current_database() AS db, version() AS v');
  console.log(`Base: ${quien[0].db} · ${quien[0].v.split(',')[0]}`);

  /* ---------------------------------------------------------------- */
  titulo('1. Qué hay dentro');
  const conteos = await filas(`
    SELECT 'clientes' AS tabla, COUNT(*)::int AS n FROM clients
    UNION ALL SELECT 'agentes', COUNT(*)::int FROM agents
    UNION ALL SELECT 'administradores', COUNT(*)::int FROM admins
    UNION ALL SELECT 'eventos', COUNT(*)::int FROM events
    UNION ALL SELECT 'reservas', COUNT(*)::int FROM reservations
    UNION ALL SELECT 'boletas', COUNT(*)::int FROM tickets
    UNION ALL SELECT 'solicitudes de agente', COUNT(*)::int FROM agent_requests
    UNION ALL SELECT 'ciudades', COUNT(*)::int FROM cities`);
  conteos.forEach((c) => console.log(`    ${String(c.n).padStart(6)}  ${c.tabla}`));

  /* ---------------------------------------------------------------- */
  titulo('2. Cuentas');

  const correosCruzados = await filas(`
    SELECT email, string_agg(origen, ' + ') AS tablas FROM (
      SELECT email, 'cliente' AS origen FROM clients WHERE active
      UNION ALL SELECT email, 'agente' FROM agents WHERE active
      UNION ALL SELECT email, 'administrador' FROM admins WHERE active
    ) t GROUP BY email HAVING COUNT(*) > 1`);
  if (correosCruzados.length) {
    reportar('error',
      'Hay correos registrados en más de una tabla. Al iniciar sesión solo entra el rol de mayor privilegio (administrador > agente > cliente) y la otra cuenta queda inaccesible:',
      correosCruzados.map((c) => `${c.email} → ${c.tablas}`));
  } else bien('Ningún correo está repetido entre clientes, agentes y administradores.');

  const docsRepetidos = await filas(`
    SELECT document_number, COUNT(*)::int AS n FROM clients
     GROUP BY document_number HAVING COUNT(*) > 1`);
  if (docsRepetidos.length) {
    reportar('error', 'Documentos de identidad repetidos entre clientes:',
      docsRepetidos.map((d) => `${d.document_number} (${d.n} cuentas)`));
  } else bien('No hay documentos de identidad repetidos.');

  const inactivos = await filas(`
    SELECT 'clientes' AS t, COUNT(*)::int AS n FROM clients WHERE NOT active
    UNION ALL SELECT 'agentes', COUNT(*)::int FROM agents WHERE NOT active
    UNION ALL SELECT 'administradores', COUNT(*)::int FROM admins WHERE NOT active`);
  const totalInactivos = inactivos.reduce((a, b) => a + b.n, 0);
  if (totalInactivos) {
    reportar('aviso', `Hay ${totalInactivos} cuenta(s) desactivadas (no pueden iniciar sesión):`,
      inactivos.filter((i) => i.n).map((i) => `${i.n} ${i.t}`));
  } else bien('Todas las cuentas están activas.');

  const sinAdmin = await filas('SELECT COUNT(*)::int AS n FROM admins WHERE active');
  if (!sinAdmin[0].n) {
    reportar('error', 'No hay ningún administrador activo: nadie puede aprobar solicitudes de agente ni ver los reportes. Se crea con `npm run admin:create`.');
  } else bien(`Hay ${sinAdmin[0].n} administrador(es) activo(s).`);

  /* ---------------------------------------------------------------- */
  titulo('3. Códigos de evento');

  const secuencia = await filas(`
    SELECT last_value, is_called FROM events_code_seq`);
  const maxNuevo = await filas(`
    SELECT COALESCE(MAX(SUBSTRING(code FROM '^EVT-([0-9]{5,})$')::BIGINT), 0) AS m
      FROM events WHERE code ~ '^EVT-[0-9]{5,}$'`);
  const sig = secuencia[0].is_called ? Number(secuencia[0].last_value) + 1 : Number(secuencia[0].last_value);
  console.log(`    Próximo código a entregar: EVT-${String(sig).padStart(5, '0')}`);
  if (Number(maxNuevo[0].m) >= sig) {
    reportar('error',
      `La secuencia va por detrás de los códigos que ya existen (el mayor es EVT-${String(maxNuevo[0].m).padStart(5, '0')}). Los próximos intentos chocarán. Se corrige volviendo a correr \`npm run db:setup\`.`);
  } else bien('La secuencia de códigos va por delante de lo que ya existe.');

  const codigosViejos = await filas(`
    SELECT code, name FROM events WHERE code !~ '^EVT-[0-9]{5,}$' ORDER BY code`);
  if (codigosViejos.length) {
    reportar('aviso',
      `${codigosViejos.length} evento(s) con códigos del formato antiguo, escritos a mano. No es un error —siguen siendo únicos— pero conviven dos formatos:`,
      codigosViejos.map((c) => `${c.code} · ${c.name}`));
  } else bien('Todos los eventos usan el formato de código nuevo.');

  const codigosDuplicados = await filas(`
    SELECT code, COUNT(*)::int AS n FROM events GROUP BY code HAVING COUNT(*) > 1`);
  if (codigosDuplicados.length) {
    reportar('error', 'CÓDIGOS DE EVENTO REPETIDOS:',
      codigosDuplicados.map((c) => `${c.code} (${c.n} veces)`));
  } else bien('No hay códigos de evento repetidos.');

  /* ---------------------------------------------------------------- */
  titulo('4. Imágenes');

  const enDisco = await filas(`
    SELECT code, name,
           (image_path LIKE '/uploads/%') AS afiche,
           (banner_path LIKE '/uploads/%') AS banner
      FROM events
     WHERE image_path LIKE '/uploads/%' OR banner_path LIKE '/uploads/%'
     ORDER BY code`);
  if (enDisco.length) {
    reportar('error',
      `${enDisco.length} evento(s) con imágenes guardadas en el disco del servidor. En el servidor publicado ese disco se borra en cada despliegue, así que esas imágenes probablemente ya no existen y se ven rotas. Hay que volver a subirlas para que vayan a Cloudinary:`,
      enDisco.map((e) => `${e.code} · ${e.name} ${e.afiche ? '[afiche]' : ''}${e.banner ? '[banner]' : ''}`));
  } else bien('Ninguna imagen depende del disco del servidor.');

  const enNube = await filas(`
    SELECT COUNT(*)::int AS n FROM events WHERE image_path LIKE 'https://res.cloudinary.com/%'`);
  console.log(`    ${enNube[0].n} evento(s) con el afiche en Cloudinary.`);

  const sinAfiche = await filas(`
    SELECT code, name FROM events WHERE image_path IS NULL ORDER BY code`);
  if (sinAfiche.length) {
    reportar('aviso', `${sinAfiche.length} evento(s) sin afiche (se ven con la marquesina azul):`,
      sinAfiche.map((e) => `${e.code} · ${e.name}`));
  } else bien('Todos los eventos tienen afiche.');

  const altVacio = await filas(`
    SELECT code FROM events WHERE image_path IS NOT NULL AND (image_alt IS NULL OR btrim(image_alt) = '')`);
  if (altVacio.length) {
    reportar('aviso', `${altVacio.length} afiche(s) sin texto alternativo (accesibilidad):`,
      altVacio.map((e) => e.code));
  } else bien('Todos los afiches tienen texto alternativo.');

  /* ---------------------------------------------------------------- */
  titulo('5. Eventos');

  const fechasAlReves = await filas(`
    SELECT code, name, starts_at, ends_at FROM events WHERE ends_at <= starts_at`);
  if (fechasAlReves.length) {
    reportar('error', 'Eventos que terminan antes de empezar:',
      fechasAlReves.map((e) => `${e.code} · inicia ${e.starts_at.toISOString()} termina ${e.ends_at.toISOString()}`));
  } else bien('Todas las fechas de fin son posteriores al inicio.');

  const vendiendoPasado = await filas(`
    SELECT code, name, starts_at, status FROM events
     WHERE status IN ('En Boletería','Programado') AND ends_at < NOW() ORDER BY starts_at`);
  if (vendiendoPasado.length) {
    reportar('aviso',
      `${vendiendoPasado.length} evento(s) con estado "${'En Boletería/Programado'}" pero cuya fecha ya pasó. La página los muestra como Finalizados, pero en la base siguen con el estado viejo:`,
      vendiendoPasado.map((e) => `${e.code} · ${e.name} · fue el ${e.starts_at.toISOString().slice(0,10)}`));
  } else bien('Ningún evento pasado sigue marcado como vigente.');

  const canceladoSinCausa = await filas(`
    SELECT code, name FROM events
     WHERE status = 'Cancelado' AND (cancellation_reason IS NULL OR btrim(cancellation_reason) = '')`);
  if (canceladoSinCausa.length) {
    reportar('error', 'Eventos cancelados sin causa registrada:',
      canceladoSinCausa.map((e) => `${e.code} · ${e.name}`));
  } else bien('Todo evento cancelado tiene su causa.');

  const precioCero = await filas(`SELECT code, name FROM events WHERE base_price = 0`);
  if (precioCero.length) {
    reportar('aviso', `${precioCero.length} evento(s) con precio 0 (¿son gratuitos a propósito?):`,
      precioCero.map((e) => `${e.code} · ${e.name}`));
  } else bien('Ningún evento tiene precio cero.');

  const sobrevendidos = await filas(`
    SELECT e.code, e.name, e.total_capacity,
           COALESCE(SUM(r.quantity), 0)::int AS reservadas
      FROM events e
      LEFT JOIN reservations r ON r.event_id = e.id AND r.status IN ('Reservada','Confirmada','Usada')
     GROUP BY e.id, e.code, e.name, e.total_capacity
    HAVING COALESCE(SUM(r.quantity), 0) > e.total_capacity`);
  if (sobrevendidos.length) {
    reportar('error', 'EVENTOS SOBREVENDIDOS (más butacas reservadas que capacidad):',
      sobrevendidos.map((e) => `${e.code} · capacidad ${e.total_capacity} · reservadas ${e.reservadas}`));
  } else bien('Ningún evento está sobrevendido.');

  const huerfanos = await filas(`
    SELECT e.code, e.name FROM events e
     LEFT JOIN agents a ON a.id = e.agent_id
     WHERE a.id IS NULL OR NOT a.active`);
  if (huerfanos.length) {
    reportar('aviso', 'Eventos cuyo agente ya no existe o está desactivado:',
      huerfanos.map((e) => `${e.code} · ${e.name}`));
  } else bien('Todos los eventos tienen un agente activo.');

  /* ---------------------------------------------------------------- */
  titulo('6. Reservas');

  const cuentasMal = await filas(`
    SELECT code, quantity, unit_price, total_amount FROM reservations
     WHERE total_amount <> unit_price * quantity`);
  if (cuentasMal.length) {
    reportar('error', 'Reservas cuyo total no coincide con precio × cantidad:',
      cuentasMal.map((r) => `${r.code} · ${r.quantity} × ${r.unit_price} ≠ ${r.total_amount}`));
  } else bien('Todos los totales cuadran con precio × cantidad.');

  const boletasMal = await filas(`
    SELECT r.code, r.quantity, COUNT(t.id)::int AS boletas
      FROM reservations r LEFT JOIN tickets t ON t.reservation_id = r.id
     WHERE r.status <> 'Cancelada'
     GROUP BY r.id, r.code, r.quantity
    HAVING COUNT(t.id) <> r.quantity`);
  if (boletasMal.length) {
    reportar('error', 'Reservas con un número de boletas distinto a la cantidad reservada:',
      boletasMal.map((r) => `${r.code} · ${r.quantity} entradas pero ${r.boletas} boletas`));
  } else bien('Cada reserva vigente tiene una boleta por entrada.');

  const vivasEnCancelado = await filas(`
    SELECT r.code, e.code AS evento FROM reservations r
      JOIN events e ON e.id = r.event_id
     WHERE e.status = 'Cancelado' AND r.status IN ('Reservada','Confirmada')`);
  if (vivasEnCancelado.length) {
    reportar('error',
      'Reservas todavía vigentes en eventos cancelados. El cliente cree que tiene entrada para algo que no se hará:',
      vivasEnCancelado.map((r) => `reserva ${r.code} · evento ${r.evento}`));
  } else bien('Ningún evento cancelado deja reservas vigentes.');

  const resSinCausa = await filas(`
    SELECT code FROM reservations
     WHERE status = 'Cancelada' AND (cancellation_reason IS NULL OR btrim(cancellation_reason) = '')`);
  if (resSinCausa.length) {
    /* No es un fallo: cuando el cliente cancela su propia reserva el motivo
       es opcional. Sí lo es cuando la cancelación vino de arriba, al
       cancelarse el evento, porque ahí el cliente merece una explicación. */
    console.log(`  · ${resSinCausa.length} reserva(s) cancelada(s) sin motivo. Es normal si las canceló el propio cliente: ahí el motivo es opcional.`);
  } else bien('Toda reserva cancelada tiene su causa.');

  const precioDesfasado = await filas(`
    SELECT r.code, r.unit_price, e.base_price, e.code AS evento
      FROM reservations r JOIN events e ON e.id = r.event_id
     WHERE r.status IN ('Reservada','Confirmada') AND r.unit_price <> e.base_price`);
  if (precioDesfasado.length) {
    reportar('aviso',
      'Reservas cuyo precio por entrada ya no coincide con el del evento (normal si el agente cambió el precio después; se respeta el precio del momento de reservar):',
      precioDesfasado.map((r) => `${r.code} · pagó ${r.unit_price}, hoy vale ${r.base_price} (${r.evento})`));
  } else bien('Los precios de las reservas coinciden con los de sus eventos.');

  /* ---------------------------------------------------------------- */
  titulo('7. Solicitudes de agente');

  const aprobadaSinCuenta = await filas(`
    SELECT id, email FROM agent_requests WHERE status = 'Aprobada' AND agent_id IS NULL`);
  if (aprobadaSinCuenta.length) {
    reportar('error', 'Solicitudes aprobadas que no crearon la cuenta de agente:',
      aprobadaSinCuenta.map((s) => `#${s.id} · ${s.email}`));
  } else bien('Toda solicitud aprobada tiene su cuenta de agente.');

  const pendientes = await filas(`SELECT COUNT(*)::int AS n FROM agent_requests WHERE status = 'Pendiente'`);
  if (pendientes[0].n) {
    reportar('aviso', `${pendientes[0].n} solicitud(es) pendientes de revisar en el panel de administrador.`);
  } else bien('No hay solicitudes pendientes.');

  /* ---------------------------------------------------------------- */
  titulo('8. Datos de prueba');

  const prueba = await filas(`
    SELECT code, name FROM events
     WHERE code LIKE 'DEMO-%' OR code LIKE 'TEST%' OR code LIKE 'VERIF%' OR code LIKE 'HERO-%'
        OR lower(name) LIKE '%prueba%' OR lower(name) LIKE '%test%'
     ORDER BY code`);
  if (prueba.length) {
    reportar('aviso',
      `${prueba.length} evento(s) que parecen de prueba. Si van a presentar el proyecto, conviene decidir cuáles se quedan:`,
      prueba.map((e) => `${e.code} · ${e.name}`));
  } else bien('No se ven eventos de prueba.');

  const cuentasPrueba = await filas(`
    SELECT email, 'cliente' AS rol FROM clients WHERE lower(email) LIKE '%prueba%' OR lower(email) LIKE '%test%'
    UNION ALL
    SELECT email, 'agente' FROM agents WHERE lower(email) LIKE '%prueba%' OR lower(email) LIKE '%test%'`);
  if (cuentasPrueba.length) {
    reportar('aviso', 'Cuentas que parecen de prueba:',
      cuentasPrueba.map((c) => `${c.email} (${c.rol})`));
  } else bien('No se ven cuentas de prueba.');

  /* ---------------------------------------------------------------- */
  titulo('9. Geografía');

  const geo = await filas(`
    SELECT (SELECT COUNT(*)::int FROM countries) AS paises,
           (SELECT COUNT(*)::int FROM departments) AS deptos,
           (SELECT COUNT(*)::int FROM cities) AS ciudades`);
  console.log(`    ${geo[0].paises} país(es) · ${geo[0].deptos} departamentos · ${geo[0].ciudades} ciudades`);
  if (geo[0].ciudades < 1000) {
    reportar('error',
      `Solo hay ${geo[0].ciudades} ciudades: el archivo DIVIPOLA no se cargó completo. Se arregla con \`npm run db:setup\`.`);
  } else bien('El listado de municipios está completo.');

  /* ---------------------------------------------------------------- */
  console.log('\n═══ RESUMEN ═══');
  console.log(`  ${problemas} problema(s) que conviene corregir`);
  console.log(`  ${avisos} aviso(s) para revisar\n`);
}

revisar()
  .catch((e) => { console.error('\nFalló la revisión:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
